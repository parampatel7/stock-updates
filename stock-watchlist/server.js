/**
 * server.js — Stock Watchlist Dashboard Backend (v2)
 * New in v2:
 *   - /api/corporate/:symbol  — all NSE corporate event categories
 *   - /api/indicators/:symbol — RSI, SMA20/50/200, MACD, Bollinger Bands
 *   - /api/symbols/search     — NSE autocomplete for search dropdown
 */

require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── Caches ────────────────────────────────────────────────────────────────────
const priceCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const newsCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const corpCache = new NodeCache({ stdTTL: 1800, checkperiod: 180 });
const indicCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const headlineCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });
const symbolCache = new NodeCache({ stdTTL: 86400 });  // 24h

const rssParser = new Parser({ timeout: 10000 });

// ─── NSE Session ───────────────────────────────────────────────────────────────
let nseSessionCookies = '';
let nseSessionExpiry = 0;

async function getNseSession() {
  if (Date.now() < nseSessionExpiry && nseSessionCookies) return nseSessionCookies;
  try {
    const res = await axios.get('https://www.nseindia.com', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 12000,
    });
    const raw = res.headers['set-cookie'] || [];
    nseSessionCookies = raw.map(c => c.split(';')[0]).join('; ');
    nseSessionExpiry = Date.now() + 10 * 60 * 1000;
    console.log('[NSE] Session refreshed');
  } catch (err) {
    console.warn('[NSE] Session fetch failed:', err.message);
  }
  return nseSessionCookies;
}

async function nseGet(url) {
  const cookies = await getNseSession();
  return axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.nseindia.com/',
      'Cookie': cookies,
    },
    timeout: 15000,
  });
}

// ─── Utility Helpers ───────────────────────────────────────────────────────────
function stripHtml(str) {
  return (str || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return dateStr || ''; }
}

function toNseDateStr(date) {
  // Returns DD-MM-YYYY
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();
  return `${d}-${m}-${y}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ENDPOINT 1: /api/stock/:symbol — Live NSE quote
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/stock/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = priceCache.get(symbol);
  if (cached) return res.json(cached);

  try {
    const { data } = await nseGet(`https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(symbol)}`);
    const pd = data.priceInfo || {};
    const info = data.info || {};
    const meta = data.metadata || {};

    const payload = {
      symbol,
      companyName: info.companyName || symbol,
      series: info.series || meta.series || 'EQ',
      industry: info.industry || '',
      sector: info.sector || '',
      lastPrice: pd.lastPrice,
      change: pd.change,
      pChange: pd.pChange,
      open: pd.open,
      close: pd.close,
      previousClose: pd.previousClose || pd.close,
      dayHigh: pd.intraDayHighLow?.max,
      dayLow: pd.intraDayHighLow?.min,
      weekHigh52: pd.weekHighLow?.max,
      weekLow52: pd.weekHighLow?.min,
      totalTradedVolume: data.marketDeptOrderBook?.totalBuyQuantity,
      totalTradedValue: pd.totalTradedValue,
      timestamp: new Date().toISOString(),
    };

    priceCache.set(symbol, payload);
    res.json(payload);
  } catch (err) {
    console.error(`[STOCK] ${symbol}:`, err.message);
    res.status(502).json({ error: `Could not fetch NSE data for ${symbol}`, detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ENDPOINT 2: /api/news/:symbol — Aggregated news (APIs + RSS)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/news/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = newsCache.get(symbol);
  if (cached) return res.json(cached);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  let articles = [];

  // Source 1: NewsAPI.org
  if (process.env.NEWS_API_KEY) {
    try {
      const { data } = await axios.get('https://newsapi.org/v2/everything', {
        params: { q: `${symbol} NSE stock`, language: 'en', sortBy: 'publishedAt', pageSize: 10, from: sevenDaysAgo, apiKey: process.env.NEWS_API_KEY },
        timeout: 8000,
      });
      (data.articles || []).forEach(a => articles.push({ title: stripHtml(a.title), link: a.url, pubDate: formatDate(a.publishedAt), source: a.source?.name || 'NewsAPI', tag: 'latest' }));
    } catch (e) { console.warn('[NEWS] NewsAPI failed:', e.message); }
  }

  // Source 2: GNews
  if (process.env.GNEWS_API_KEY && articles.length < 8) {
    try {
      const { data } = await axios.get('https://gnews.io/api/v4/search', {
        params: { q: `${symbol} stock`, lang: 'en', country: 'in', max: 10, token: process.env.GNEWS_API_KEY },
        timeout: 8000,
      });
      (data.articles || []).forEach(a => articles.push({ title: stripHtml(a.title), link: a.url, pubDate: formatDate(a.publishedAt), source: a.source?.name || 'GNews', tag: 'latest' }));
    } catch (e) { console.warn('[NEWS] GNews failed:', e.message); }
  }

  // Source 3: ET Markets RSS
  if (articles.length < 8) {
    try {
      const feed = await rssParser.parseURL('https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms');
      const sym = symbol.toLowerCase();
      (feed.items || []).filter(i => (i.title || '').toLowerCase().includes(sym)).slice(0, 4)
        .forEach(i => articles.push({ title: stripHtml(i.title), link: i.link, pubDate: formatDate(i.pubDate || i.isoDate), source: 'Economic Times', tag: 'ET Markets' }));
    } catch (e) { console.warn('[NEWS] ET RSS failed:', e.message); }
  }

  // Source 4: Moneycontrol RSS
  if (articles.length < 8) {
    try {
      const feed = await rssParser.parseURL('https://www.moneycontrol.com/rss/marketsnews.xml');
      const sym = symbol.toLowerCase();
      (feed.items || []).filter(i => (i.title || '').toLowerCase().includes(sym)).slice(0, 4)
        .forEach(i => articles.push({ title: stripHtml(i.title), link: i.link, pubDate: formatDate(i.pubDate || i.isoDate), source: 'Moneycontrol', tag: 'Moneycontrol' }));
    } catch (e) { console.warn('[NEWS] Moneycontrol RSS failed:', e.message); }
  }

  // Source 5: Mint RSS
  if (articles.length < 8) {
    try {
      const feed = await rssParser.parseURL('https://www.livemint.com/rss/markets');
      const sym = symbol.toLowerCase();
      (feed.items || []).filter(i => (i.title || '').toLowerCase().includes(sym)).slice(0, 4)
        .forEach(i => articles.push({ title: stripHtml(i.title), link: i.link, pubDate: formatDate(i.pubDate || i.isoDate), source: 'Mint', tag: 'Mint' }));
    } catch (e) { console.warn('[NEWS] Mint RSS failed:', e.message); }
  }

  // Source 6: Google News RSS fallback
  if (articles.length < 5) {
    try {
      const q = encodeURIComponent(`${symbol} NSE stock`);
      const feed = await rssParser.parseURL(`https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`);
      (feed.items || []).slice(0, 6).forEach(i => articles.push({ title: stripHtml(i.title), link: i.link, pubDate: formatDate(i.pubDate || i.isoDate), source: 'Google News', tag: 'Google News' }));
    } catch (e) { console.warn('[NEWS] Google News RSS failed:', e.message); }
  }

  // Deduplicate
  const seen = new Set();
  const unique = articles.filter(a => {
    const key = a.title.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);

  newsCache.set(symbol, unique);
  res.json(unique);
});

// ─────────────────────────────────────────────────────────────────────────────
//  ENDPOINT 3: /api/corporate/:symbol — All NSE corporate event categories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generically parse NSE corp-info API response into a clean array.
 * Different corpType values return different field names — this handles them all.
 */
function parseCorporateData(data, corpType) {
  // Most types expose an array at data.corporate; some differ
  const arr = data.corporate || data.data || data.announcements || [];
  if (!Array.isArray(arr)) return [];

  return arr.slice(0, 15).map(item => {
    const base = {
      date: formatDate(item.an_dt || item.bm_date || item.exDt || item.date || item.recordDt || ''),
      link: item.attchmntFile ? `https://www.nseindia.com${item.attchmntFile}` : '',
      type: corpType,
    };

    switch (corpType) {
      case 'announcement':
        return { ...base, title: stripHtml(item.subject || item.desc || item.headline || 'Announcement'), category: 'Announcement' };

      case 'board-meeting':
        return { ...base, title: stripHtml(item.purpose || item.bm_desc || 'Board Meeting'), category: 'Board Meeting', details: stripHtml(item.bm_desc || '') };

      case 'actions':
        return {
          ...base,
          title: stripHtml(item.subject || item.purpose || 'Corporate Action'),
          exDate: formatDate(item.exDt || item.exDate || item.ex_date || ''),
          recordDate: formatDate(item.recDt || item.recordDate || item.record_date || ''),
          category: 'Corporate Action',
          faceValue: item.faceVal || '',
          remarks: stripHtml(item.remarks || ''),
        };

      case 'financial-results':
        return { ...base, title: stripHtml(item.subject || item.desc || 'Financial Result'), category: 'Financial Result' };

      case 'annual-report':
        return { ...base, title: stripHtml(item.subject || item.desc || 'Annual Report'), category: 'Annual Report' };

      case 'bonus':
        return { ...base, title: `Bonus Issue: ${item.purpose || ''}`, exDate: formatDate(item.exDt || ''), category: 'Bonus' };

      case 'rights':
        return { ...base, title: `Rights Issue: ${item.purpose || ''}`, exDate: formatDate(item.exDt || ''), category: 'Rights' };

      case 'credit-rating':
        return { ...base, title: stripHtml(item.subject || item.desc || 'Credit Rating'), category: 'Credit Rating' };

      case 'voting-results':
        return { ...base, title: stripHtml(item.subject || item.desc || 'Voting Result'), category: 'Voting Result' };

      default:
        return { ...base, title: stripHtml(item.subject || item.desc || item.purpose || JSON.stringify(item).slice(0, 80)), category: corpType };
    }
  }).filter(x => x.title);
}

function parseInsiderTrading(data) {
  const arr = data.data || data.insiderTrading || data.corporate || [];
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 12).map(t => ({
    date: formatDate(t.tradingDt || t.date || ''),
    title: `${stripHtml(t.personName || t.name || 'Insider')}: ${stripHtml(t.acqMode || '')} ${(+t.secAcq || +t.noSecAcq || 0).toLocaleString('en-IN')} shares`,
    details: `Before: ${(+t.beforeAcqSharesNo || 0).toLocaleString('en-IN')} (${t.befAcqSharesPer || ''}%) → After: ${(+t.afterAcqSharesNo || 0).toLocaleString('en-IN')} (${t.aftAcqSharesPer || ''}%)`,
    type: 'insider',
    category: 'Insider Trading',
    link: '',
  })).filter(x => x.title);
}

function parseShareholding(data) {
  const arr = data.shareholding || data.data || data.corporate || [];
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 8).map(item => ({
    date: formatDate(item.period || item.quarter || item.date || ''),
    title: `${stripHtml(item.category || item.name || 'Holder')}: ${item.per || item.holdingPercentage || ''}%`,
    details: `No. of shares: ${(+item.noOfShares || 0).toLocaleString('en-IN') || '—'}`,
    type: 'shareholding',
    category: 'Shareholding',
    link: '',
  })).filter(x => x.title);
}

app.get('/api/corporate/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cacheKey = `CORP_${symbol}`;
  const cached = corpCache.get(cacheKey);
  if (cached) return res.json(cached);

  // All NSE corporate event types to fetch in parallel
  const categories = [
    { key: 'announcements', corpType: 'announcement' },
    { key: 'boardMeetings', corpType: 'board-meeting' },
    { key: 'corporateActions', corpType: 'actions' },
    { key: 'financialResults', corpType: 'financial-results' },
    { key: 'annualReports', corpType: 'annual-report' },
    { key: 'creditRatings', corpType: 'credit-rating' },
    { key: 'votingResults', corpType: 'voting-results' },
  ];

  const result = {};

  // Fetch all standard categories in parallel
  await Promise.all(categories.map(async ({ key, corpType }) => {
    try {
      const { data } = await nseGet(
        `https://www.nseindia.com/api/corp-info?symbol=${encodeURIComponent(symbol)}&corpType=${corpType}&market=equities`
      );
      result[key] = parseCorporateData(data, corpType);
    } catch (e) {
      console.warn(`[CORPORATE] ${symbol}/${corpType}:`, e.message);
      result[key] = [];
    }
  }));

  // Insider trading - separate endpoint
  try {
    const { data } = await nseGet(
      `https://www.nseindia.com/api/corp-info?symbol=${encodeURIComponent(symbol)}&corpType=insider-trading-per&market=equities`
    );
    result.insiderTrading = parseInsiderTrading(data);
  } catch (e) {
    console.warn(`[CORPORATE] ${symbol}/insider-trading:`, e.message);
    result.insiderTrading = [];
  }

  // Shareholding pattern - may have a different format
  try {
    const { data } = await nseGet(
      `https://www.nseindia.com/api/corp-info?symbol=${encodeURIComponent(symbol)}&corpType=shareholding-pattern&market=equities`
    );
    result.shareholdingPattern = parseShareholding(data);
    // Also try to get latest shareholding summary
    const arr = data.shareholding || data.data || data.corporate || [];
    result.shareholdingSummary = arr.slice(0, 8).map(item => ({
      category: stripHtml(item.category || item.name || ''),
      percentage: item.per || item.holdingPercentage || '',
      shares: item.noOfShares || '',
    })).filter(x => x.category);
  } catch (e) {
    console.warn(`[CORPORATE] ${symbol}/shareholding:`, e.message);
    result.shareholdingPattern = [];
    result.shareholdingSummary = [];
  }

  corpCache.set(cacheKey, result);
  res.json(result);
});

// ─────────────────────────────────────────────────────────────────────────────
//  Technical Indicator Math
// ─────────────────────────────────────────────────────────────────────────────
function calcSMA(prices, period) {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let emaVal = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    emaVal = prices[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

function calcRSI(prices, period = 14) {
  if (prices.length <= period) return null;
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? -c : 0);
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calcMACD(prices) {
  if (prices.length < 26) return null;
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  if (ema12 == null || ema26 == null) return null;
  const macdLine = ema12 - ema26;
  // Signal line = EMA(9) of MACD line — approximate using latest 9 MACD values
  const macdSeries = [];
  const k12 = 2 / 13, k26 = 2 / 27;
  let e12 = prices.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let e26 = prices.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  for (let i = 26; i < prices.length; i++) {
    e12 = prices[i] * k12 + e12 * (1 - k12);
    e26 = prices[i] * k26 + e26 * (1 - k26);
    macdSeries.push(e12 - e26);
  }
  const signal = macdSeries.length >= 9 ? calcEMA(macdSeries, 9) : null;
  return { macdLine: macdLine.toFixed(2), signal: signal ? signal.toFixed(2) : null, histogram: signal ? (macdLine - signal).toFixed(2) : null };
}

function calcBollingerBands(prices, period = 20) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, p) => s + Math.pow(p - mid, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return { upper: (mid + 2 * stdDev).toFixed(2), middle: mid.toFixed(2), lower: (mid - 2 * stdDev).toFixed(2) };
}

// ─────────────────────────────────────────────────────────────────────────────
//  ENDPOINT 4: /api/indicators/:symbol — Technical Indicators
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/indicators/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cacheKey = `IND_${symbol}`;
  const cached = indicCache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    // Fetch 1 year of daily OHLCV from NSE
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - 380 * 24 * 60 * 60 * 1000); // ~380 days for SMA200

    const url = `https://www.nseindia.com/api/historical/cm/equity?symbol=${encodeURIComponent(symbol)}&series[]=EQ&from=${toNseDateStr(fromDate)}&to=${toNseDateStr(toDate)}`;
    const { data } = await nseGet(url);

    const rows = (data.data || []).sort((a, b) => new Date(a.CH_TIMESTAMP) - new Date(b.CH_TIMESTAMP));
    if (rows.length < 15) {
      return res.status(502).json({ error: `Insufficient historical data for ${symbol}` });
    }

    const closes = rows.map(r => parseFloat(r.CH_CLOSING_PRICE));
    const highs = rows.map(r => parseFloat(r.CH_HIGH_PRICE));
    const lows = rows.map(r => parseFloat(r.CH_LOW_PRICE));
    const volumes = rows.map(r => parseInt(r.CH_TOT_TRADED_QTY || 0));

    const lastClose = closes[closes.length - 1];
    const sma20 = calcSMA(closes, 20);
    const sma50 = calcSMA(closes, 50);
    const sma200 = calcSMA(closes, 200);
    const rsi14 = calcRSI(closes, 14);
    const macd = calcMACD(closes);
    const bb = calcBollingerBands(closes, 20);
    const ema9 = calcEMA(closes, 9);
    const ema20 = calcEMA(closes, 20);

    // Average Volume (20d)
    const avgVol20 = volumes.length >= 20
      ? Math.round(volumes.slice(-20).reduce((a, b) => a + b, 0) / 20)
      : Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length);

    // ATR-14 (Average True Range) — volatility measure
    let atrSum = 0, atrCount = 0;
    for (let i = Math.max(1, rows.length - 14); i < rows.length; i++) {
      const high = highs[i];
      const low = lows[i];
      const prevC = closes[i - 1];
      atrSum += Math.max(high - low, Math.abs(high - prevC), Math.abs(low - prevC));
      atrCount++;
    }
    const atr14 = atrCount > 0 ? (atrSum / atrCount).toFixed(2) : null;

    // Signals
    const signals = [];
    if (rsi14 != null) {
      if (rsi14 >= 70) signals.push({ label: 'RSI Overbought', sentiment: 'bearish' });
      else if (rsi14 <= 30) signals.push({ label: 'RSI Oversold', sentiment: 'bullish' });
      else signals.push({ label: 'RSI Neutral', sentiment: 'neutral' });
    }
    if (sma20 && sma50) {
      if (sma20 > sma50) signals.push({ label: 'Golden Cross (SMA20 > SMA50)', sentiment: 'bullish' });
      else signals.push({ label: 'Death Cross (SMA20 < SMA50)', sentiment: 'bearish' });
    }
    if (sma200 && lastClose) {
      signals.push({ label: lastClose > sma200 ? 'Price Above SMA200' : 'Price Below SMA200', sentiment: lastClose > sma200 ? 'bullish' : 'bearish' });
    }
    if (macd) {
      const mNum = parseFloat(macd.macdLine), sNum = parseFloat(macd.signal || 0);
      if (macd.signal != null) signals.push({ label: mNum > sNum ? 'MACD Bullish Crossover' : 'MACD Bearish Crossover', sentiment: mNum > sNum ? 'bullish' : 'bearish' });
    }
    if (bb && lastClose) {
      const bbU = parseFloat(bb.upper), bbL = parseFloat(bb.lower);
      if (lastClose >= bbU) signals.push({ label: 'Near Upper Bollinger Band', sentiment: 'bearish' });
      else if (lastClose <= bbL) signals.push({ label: 'Near Lower Bollinger Band', sentiment: 'bullish' });
    }

    const payload = {
      symbol,
      dataPoints: rows.length,
      lastClose: lastClose.toFixed(2),
      sma: { sma20: sma20?.toFixed(2) || null, sma50: sma50?.toFixed(2) || null, sma200: sma200?.toFixed(2) || null },
      ema: { ema9: ema9?.toFixed(2) || null, ema20: ema20?.toFixed(2) || null },
      rsi14: rsi14?.toFixed(1) || null,
      macd,
      bollingerBands: bb,
      atr14,
      avgVolume20: avgVol20,
      signals,
    };

    indicCache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(`[INDICATORS] ${symbol}:`, err.message);
    res.status(502).json({ error: `Could not compute indicators for ${symbol}`, detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ENDPOINT 5: /api/symbols/search?q= — Stock search autocomplete
// ─────────────────────────────────────────────────────────────────────────────
// Cache the full NSE equity master list on first call
let nseSymbolMaster = null;

async function loadNseSymbolMaster() {
  if (nseSymbolMaster) return nseSymbolMaster;
  const cached = symbolCache.get('MASTER');
  if (cached) { nseSymbolMaster = cached; return nseSymbolMaster; }

  try {
    // NSE equity list endpoint - returns all listed equity symbols
    const { data } = await nseGet('https://www.nseindia.com/api/market-data-pre-open?key=NIFTY500');
    const arr = (data.data || []).map(item => ({
      symbol: (item.metadata?.symbol || '').toUpperCase(),
      companyName: item.metadata?.companyName || item.metadata?.symbol || '',
      series: item.metadata?.series || 'EQ',
    })).filter(x => x.symbol);

    if (arr.length > 0) {
      nseSymbolMaster = arr;
      symbolCache.set('MASTER', arr);
      console.log(`[SYMBOLS] Loaded ${arr.length} NSE symbols`);
      return arr;
    }
  } catch (e) {
    console.warn('[SYMBOLS] NIFTY500 master load failed, trying all-equities fallback:', e.message);
  }

  // Fallback: try NSE autocomplete directly
  return [];
}

app.get('/api/symbols/search', async (req, res) => {
  const q = (req.query.q || '').trim().toUpperCase();
  if (q.length < 1) return res.json([]);

  // First try NSE's own live autocomplete
  try {
    const { data } = await nseGet(`https://www.nseindia.com/api/search/autocomplete?q=${encodeURIComponent(q)}`);
    const symbols = (data.symbols || []).slice(0, 12).map(s => ({
      symbol: (s.symbol || s.SYMBOL || '').toUpperCase(),
      companyName: stripHtml(s.symbol_info || s.companyName || s.NAME || ''),
      series: s.series || s.SERIES || 'EQ',
    })).filter(s => s.symbol && (s.series === 'EQ' || !s.series));

    if (symbols.length > 0) return res.json(symbols);
  } catch (e) {
    console.warn('[SYMBOLS] NSE autocomplete failed:', e.message);
  }

  // Fallback: search master list
  const master = await loadNseSymbolMaster();
  const results = master.filter(s =>
    s.symbol.startsWith(q) || s.companyName.toUpperCase().includes(q)
  ).slice(0, 12);

  res.json(results);
});

// ─────────────────────────────────────────────────────────────────────────────
//  ENDPOINT 6: /api/screener/:symbol — Screener.in key ratios
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/screener/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = corpCache.get(`SCR_${symbol}`);
  if (cached) return res.json(cached);

  try {
    const { data: html } = await axios.get(`https://www.screener.in/company/${encodeURIComponent(symbol)}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/122', 'Accept-Language': 'en-US,en;q=0.9' },
      timeout: 12000,
    });
    const $ = cheerio.load(html);
    const ratios = {};
    $('#top-ratios li').each((_, el) => {
      const name = $(el).find('.name').text().trim();
      const value = $(el).find('.value, .number').first().text().trim();
      if (name && value) ratios[name] = value;
    });
    const pros = [], cons = [];
    $('#analysis .pros li').each((_, el) => pros.push($(el).text().trim()));
    $('#analysis .cons li').each((_, el) => cons.push($(el).text().trim()));
    const payload = { symbol, ratios, pros: pros.slice(0, 3), cons: cons.slice(0, 3) };
    corpCache.set(`SCR_${symbol}`, payload);
    res.json(payload);
  } catch (err) {
    console.error(`[SCREENER] ${symbol}:`, err.message);
    res.status(502).json({ error: `Could not fetch Screener data for ${symbol}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ENDPOINT 7: /api/headlines — Market-wide headlines from ET/MC/Mint
// ─────────────────────────────────────────────────────────────────────────────
async function fetchRSS(url, sourceName, maxItems = 6) {
  try {
    const feed = await rssParser.parseURL(url);
    return (feed.items || []).slice(0, maxItems).map(i => ({
      title: stripHtml(i.title), link: i.link, pubDate: formatDate(i.pubDate || i.isoDate), source: sourceName,
    }));
  } catch (e) { console.warn(`[HEADLINES] ${sourceName}:`, e.message); return []; }
}

app.get('/api/headlines', async (req, res) => {
  const cached = headlineCache.get('MARKET_HEADLINES');
  if (cached) return res.json(cached);
  const [et, mc, mint] = await Promise.all([
    fetchRSS('https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', 'Economic Times'),
    fetchRSS('https://www.moneycontrol.com/rss/marketsnews.xml', 'Moneycontrol'),
    fetchRSS('https://www.livemint.com/rss/markets', 'Mint'),
  ]);
  const result = { et, moneycontrol: mc, mint };
  headlineCache.set('MARKET_HEADLINES', result);
  res.json(result);
});

// ─── Serve index.html for all other routes ────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, async () => {
  console.log(`\n🚀 Stock Watchlist Server v2 running at http://localhost:${PORT}`);
  console.log(`   NewsAPI key: ${process.env.NEWS_API_KEY ? '✅ set' : '⚠️  not set (RSS active)'}`);
  console.log(`   GNews key:   ${process.env.GNEWS_API_KEY ? '✅ set' : '⚠️  not set (RSS active)'}`);
  console.log('   Press Ctrl+C to stop.\n');
  // Warm up NSE session
  await getNseSession();
});
