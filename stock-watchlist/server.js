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
// RSS sources for per-symbol news
const NEWS_RSS_SOURCES = [
  { url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', source: 'Economic Times' },
  { url: 'https://www.moneycontrol.com/rss/marketsnews.xml', source: 'Moneycontrol' },
  { url: 'https://www.livemint.com/rss/markets', source: 'Mint' },
  { url: 'https://www.business-standard.com/rss/markets-106.rss', source: 'Business Standard' },
  { url: 'https://www.financialexpress.com/market/feed/', source: 'Financial Express' },
  { url: 'https://www.zeebiz.com/markets/rss', source: 'Zee Business' },
  { url: 'https://www.cnbctv18.com/commonfeeds/v1/eng/rss/market.xml', source: 'CNBC TV18' },
  { url: 'https://feeds.feedburner.com/NdtvProfit-Markets', source: 'NDTV Profit' },
];

async function fetchRSSForSymbol(url, sourceName, sym) {
  try {
    const feed = await rssParser.parseURL(url);
    return (feed.items || [])
      .filter(i => (i.title || '').toLowerCase().includes(sym))
      .slice(0, 4)
      .map(i => ({ title: stripHtml(i.title), link: i.link, pubDate: formatDate(i.pubDate || i.isoDate), source: sourceName }));
  } catch (e) {
    console.warn(`[NEWS] ${sourceName} RSS failed:`, e.message);
    return [];
  }
}

app.get('/api/news/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = newsCache.get(symbol);
  if (cached) return res.json(cached);

  const sym = symbol.toLowerCase();
  let articles = [];

  // Optional paid APIs
  if (process.env.NEWS_API_KEY) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    try {
      const { data } = await axios.get('https://newsapi.org/v2/everything', {
        params: { q: `${symbol} NSE stock`, language: 'en', sortBy: 'publishedAt', pageSize: 10, from: sevenDaysAgo, apiKey: process.env.NEWS_API_KEY },
        timeout: 8000,
      });
      (data.articles || []).forEach(a => articles.push({ title: stripHtml(a.title), link: a.url, pubDate: formatDate(a.publishedAt), source: a.source?.name || 'NewsAPI' }));
    } catch (e) { console.warn('[NEWS] NewsAPI failed:', e.message); }
  }

  if (process.env.GNEWS_API_KEY) {
    try {
      const { data } = await axios.get('https://gnews.io/api/v4/search', {
        params: { q: `${symbol} stock`, lang: 'en', country: 'in', max: 10, token: process.env.GNEWS_API_KEY },
        timeout: 8000,
      });
      (data.articles || []).forEach(a => articles.push({ title: stripHtml(a.title), link: a.url, pubDate: formatDate(a.publishedAt), source: a.source?.name || 'GNews' }));
    } catch (e) { console.warn('[NEWS] GNews failed:', e.message); }
  }

  // Fetch all 8 RSS sources in parallel
  const rssResults = await Promise.allSettled(
    NEWS_RSS_SOURCES.map(({ url, source }) => fetchRSSForSymbol(url, source, sym))
  );
  rssResults.forEach(r => { if (r.status === 'fulfilled') articles.push(...r.value); });

  // Google News fallback (always runs, doesn't need symbol filter)
  try {
    const q = encodeURIComponent(`${symbol} NSE stock`);
    const feed = await rssParser.parseURL(`https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`);
    (feed.items || []).slice(0, 8).forEach(i => articles.push({ title: stripHtml(i.title), link: i.link, pubDate: formatDate(i.pubDate || i.isoDate), source: 'Google News' }));
  } catch (e) { console.warn('[NEWS] Google News RSS failed:', e.message); }

  // Deduplicate by title
  const seen = new Set();
  const unique = articles.filter(a => {
    const key = (a.title || '').toLowerCase().trim().slice(0, 80);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 15);

  newsCache.set(symbol, unique);
  res.json(unique);
});

// ─────────────────────────────────────────────────────────────────────────────
//  ENDPOINT 3: /api/corporate/:symbol — NSE Corporate Events via Bulk APIs
// ─────────────────────────────────────────────────────────────────────────────

// 30-day cutoff helper
function isWithin30Days(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  return (Date.now() - d.getTime()) <= 30 * 24 * 60 * 60 * 1000;
}

// Map NSE category description to a clean filing category
function mapCategory(desc) {
  const d = (desc || '').toLowerCase();
  if (d.includes('dividend')) return 'Dividend';
  if (d.includes('bonus')) return 'Bonus Issue';
  if (d.includes('split') || d.includes('sub-division')) return 'Stock Split';
  if (d.includes('buyback') || d.includes('buy-back')) return 'Buyback';
  if (d.includes('rights')) return 'Rights Issue';
  if (d.includes('merger') || d.includes('amalgamation') || d.includes('acquisition')) return 'Merger/Acquisition';
  if (d.includes('preferential') || d.includes('allotment')) return 'Preferential Allotment';
  if (d.includes('esop') || d.includes('esps') || d.includes('employee stock')) return 'ESOP/ESPS';
  if (d.includes('board meeting')) return 'Board Meeting';
  if (d.includes('financial result') || d.includes('quarterly result')) return 'Financial Results';
  if (d.includes('insider') || d.includes('pit ') || d.includes('sast')) return 'Insider Trading (PIT)';
  if (d.includes('shareholding')) return 'Shareholding Pattern';
  return 'Corporate Disclosure';
}

async function fetchBulkAnnouncements(symbol) {
  const key = `BULKANN_${symbol}`;
  const c = corpCache.get(key);
  if (c) return c;
  try {
    const { data } = await nseGet(`https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`);
    const arr = Array.isArray(data) ? data : (data.corpann || data.data || []);
    corpCache.set(key, arr);
    console.log(`[CORP] ${symbol}: ${arr.length} announcements from NSE bulk`);
    return arr;
  } catch (e) {
    console.warn('[CORP] Bulk announcements failed:', e.message);
    return [];
  }
}

async function fetchBulkActions(symbol) {
  const key = `BULKACT_${symbol}`;
  const c = corpCache.get(key);
  if (c) return c;
  try {
    const { data } = await nseGet(`https://www.nseindia.com/api/corporate-actions?index=equities&symbol=${encodeURIComponent(symbol)}`);
    const arr = Array.isArray(data) ? data : (data.corpact || data.data || []);
    corpCache.set(key, arr);
    console.log(`[CORP] ${symbol}: ${arr.length} actions from NSE bulk`);
    return arr;
  } catch (e) {
    console.warn('[CORP] Bulk actions failed:', e.message);
    return [];
  }
}

async function fetchBulkBoardMeetings(symbol) {
  const key = `BULKBM_${symbol}`;
  const c = corpCache.get(key);
  if (c) return c;
  try {
    const { data } = await nseGet(`https://www.nseindia.com/api/corporate-board-meetings?index=equities&symbol=${encodeURIComponent(symbol)}`);
    const arr = Array.isArray(data) ? data : (data.board || data.data || []);
    corpCache.set(key, arr);
    console.log(`[CORP] ${symbol}: ${arr.length} board meetings from NSE bulk`);
    return arr;
  } catch (e) {
    console.warn('[CORP] Bulk board meetings failed:', e.message);
    return [];
  }
}

app.get('/api/corporate/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cacheKey = `CORP2_${symbol}`;
  const cached = corpCache.get(cacheKey);
  if (cached) return res.json(cached);

  // Fetch all symbol-specific bulk feeds in parallel
  const [announcements, actions, boardMeetings] = await Promise.all([
    fetchBulkAnnouncements(symbol),
    fetchBulkActions(symbol),
    fetchBulkBoardMeetings(symbol),
  ]);

  const thirty = 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - thirty;

  // Map announcements — real field names: symbol, desc, sort_date, attchmntFile (full URL), sm_name, seq_id
  const symAnn = announcements
    .filter(a => {
      const d = new Date(a.sort_date || a.an_dt || '');
      return !isNaN(d.getTime()) && d.getTime() >= cutoff;
    })
    .slice(0, 25)
    .map(a => ({
      company_name: stripHtml(a.sm_name || a.symbol || symbol),
      symbol: (a.symbol || symbol).toUpperCase(),
      date: formatDate(a.sort_date || a.an_dt || ''),
      category: mapCategory(a.desc || ''),
      title: stripHtml(a.desc || 'Announcement'),
      description: stripHtml(a.attchmntText || a.desc || ''),
      document_link: a.attchmntFile || '',  // already a full URL from NSE archives
      reference_no: String(a.seq_id || a.seqno || ''),
    }));

  // Map corporate actions
  const symActions = actions
    .filter(a => {
      const d = new Date(a.exDt || a.ex_date || a.exDate || a.sort_date || '');
      return !isNaN(d.getTime()) && d.getTime() >= (cutoff - thirty);
    })
    .slice(0, 10)
    .map(a => ({
      company_name: stripHtml(a.comp || a.sm_name || a.symbol || symbol),
      symbol: (a.symbol || symbol).toUpperCase(),
      date: formatDate(a.exDt || a.ex_date || ''),
      category: mapCategory(a.subject || a.purpose || ''),
      title: stripHtml(a.subject || a.purpose || 'Corporate Action'),
      description: `Ex-Date: ${formatDate(a.exDt || '')}${a.recDt ? ' · Record: ' + formatDate(a.recDt) : ''}${a.remarks ? ' · ' + stripHtml(a.remarks) : ''}`,
      document_link: '',
      reference_no: '',
    }));

  // Map board meetings — real field names: bm_symbol, bm_date, bm_purpose, bm_desc, sm_name, attachment
  // bm_date can be future (scheduled) — include ±30 days window
  const futureWindow = Date.now() + thirty;
  const symBoard = boardMeetings
    .filter(a => {
      const d = new Date(a.bm_date || '');
      return !isNaN(d.getTime()) && d.getTime() >= cutoff && d.getTime() <= futureWindow;
    })
    .slice(0, 10)
    .map(a => ({
      company_name: stripHtml(a.sm_name || a.bm_symbol || symbol),
      symbol: (a.bm_symbol || symbol).toUpperCase(),
      date: formatDate(a.bm_date || ''),
      category: 'Board Meeting',
      title: stripHtml(a.bm_purpose || 'Board Meeting'),
      description: stripHtml(a.bm_desc || ''),
      document_link: a.attachment || '',
      reference_no: '',
    }));

  // Deduplicate by title+date
  const seen = new Set();
  const dedup = (arr) => arr.filter(x => {
    const k = `${x.date}|${x.title}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Merge & sort all by date desc
  const allItems = dedup([...symAnn, ...symBoard, ...symActions])
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const actionCategories = ['Dividend', 'Bonus Issue', 'Stock Split', 'Buyback', 'Rights Issue'];
  const result = {
    announcements: allItems.filter(x => x.category !== 'Board Meeting' && !actionCategories.includes(x.category)),
    boardMeetings: symBoard,
    corporateActions: [...symActions, ...allItems.filter(x => actionCategories.includes(x.category))],
    financialResults: allItems.filter(x => x.category === 'Financial Results'),
    insiderTrading: allItems.filter(x => x.category === 'Insider Trading (PIT)'),
    shareholdingPattern: allItems.filter(x => x.category === 'Shareholding Pattern'),
    shareholdingSummary: [],
    allFilings: allItems,
  };

  // If announcements tab is empty but we have raw announcements, show all of them
  if (result.announcements.length === 0 && symAnn.length > 0) {
    result.announcements = symAnn;
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
// Fetch OHLCV from Yahoo Finance (primary) or NSE (fallback)
async function fetchOHLCV(symbol) {
  // ── Primary: Yahoo Finance ───────────────────────────────────────
  try {
    const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?range=1y&interval=1d&includePrePost=false`;
    const { data: yfData } = await axios.get(yfUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        'Accept': 'application/json',
      },
      timeout: 15000,
    });
    const result = yfData?.chart?.result?.[0];
    if (!result) throw new Error('No chart data from Yahoo');
    const timestamps = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const closes = q.close || [];
    const highs = q.high || [];
    const lows = q.low || [];
    const volumes = q.volume || [];
    // Filter out nulls
    const rows = timestamps
      .map((ts, i) => ({ ts, close: closes[i], high: highs[i], low: lows[i], vol: volumes[i] }))
      .filter(r => r.close != null && r.high != null && r.low != null);
    if (rows.length < 15) throw new Error('Insufficient Yahoo data');
    console.log(`[INDICATORS] ${symbol}: Yahoo Finance — ${rows.length} days`);
    return {
      closes: rows.map(r => r.close),
      highs: rows.map(r => r.high),
      lows: rows.map(r => r.low),
      volumes: rows.map(r => r.vol || 0),
      count: rows.length,
    };
  } catch (yfErr) {
    console.warn(`[INDICATORS] ${symbol}: Yahoo failed (${yfErr.message}), trying NSE…`);
  }

  // ── Fallback: NSE Historical ─────────────────────────────────────
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - 380 * 24 * 60 * 60 * 1000);
  const url = `https://www.nseindia.com/api/historical/cm/equity?symbol=${encodeURIComponent(symbol)}&series[]=EQ&from=${toNseDateStr(fromDate)}&to=${toNseDateStr(toDate)}`;
  const { data } = await nseGet(url);
  const rows = (data.data || []).sort((a, b) => new Date(a.CH_TIMESTAMP) - new Date(b.CH_TIMESTAMP));
  if (rows.length < 15) throw new Error(`Insufficient historical data for ${symbol}`);
  console.log(`[INDICATORS] ${symbol}: NSE fallback — ${rows.length} days`);
  return {
    closes: rows.map(r => parseFloat(r.CH_CLOSING_PRICE)),
    highs: rows.map(r => parseFloat(r.CH_HIGH_PRICE)),
    lows: rows.map(r => parseFloat(r.CH_LOW_PRICE)),
    volumes: rows.map(r => parseInt(r.CH_TOT_TRADED_QTY || 0)),
    count: rows.length,
  };
}

app.get('/api/indicators/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cacheKey = `IND_${symbol}`;
  const cached = indicCache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { closes, highs, lows, volumes, count } = await fetchOHLCV(symbol);

    const lastClose = closes[closes.length - 1];
    const sma20 = calcSMA(closes, 20);
    const sma50 = calcSMA(closes, 50);
    const sma200 = calcSMA(closes, 200);
    const rsi14 = calcRSI(closes, 14);
    const macd = calcMACD(closes);
    const bb = calcBollingerBands(closes, 20);
    const ema9 = calcEMA(closes, 9);
    const ema20 = calcEMA(closes, 20);

    const avgVol20 = volumes.length >= 20
      ? Math.round(volumes.slice(-20).reduce((a, b) => a + b, 0) / 20)
      : Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length);

    let atrSum = 0, atrCount = 0;
    for (let i = Math.max(1, closes.length - 14); i < closes.length; i++) {
      atrSum += Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
      atrCount++;
    }
    const atr14 = atrCount > 0 ? (atrSum / atrCount).toFixed(2) : null;

    const signals = [];
    if (rsi14 != null) {
      if (rsi14 >= 70) signals.push({ label: 'RSI Overbought', sentiment: 'bearish' });
      else if (rsi14 <= 30) signals.push({ label: 'RSI Oversold', sentiment: 'bullish' });
      else signals.push({ label: 'RSI Neutral', sentiment: 'neutral' });
    }
    if (sma20 && sma50) {
      signals.push(sma20 > sma50
        ? { label: 'Golden Cross (SMA20 > SMA50)', sentiment: 'bullish' }
        : { label: 'Death Cross (SMA20 < SMA50)', sentiment: 'bearish' });
    }
    if (sma200 && lastClose) {
      signals.push({ label: lastClose > sma200 ? 'Price Above SMA200' : 'Price Below SMA200', sentiment: lastClose > sma200 ? 'bullish' : 'bearish' });
    }
    if (macd?.signal != null) {
      const mNum = parseFloat(macd.macdLine), sNum = parseFloat(macd.signal);
      signals.push({ label: mNum > sNum ? 'MACD Bullish Crossover' : 'MACD Bearish Crossover', sentiment: mNum > sNum ? 'bullish' : 'bearish' });
    }
    if (bb && lastClose) {
      if (lastClose >= parseFloat(bb.upper)) signals.push({ label: 'Near Upper Bollinger Band', sentiment: 'bearish' });
      else if (lastClose <= parseFloat(bb.lower)) signals.push({ label: 'Near Lower Bollinger Band', sentiment: 'bullish' });
    }

    const payload = {
      symbol, dataPoints: count,
      lastClose: lastClose.toFixed(2),
      sma: { sma20: sma20?.toFixed(2) || null, sma50: sma50?.toFixed(2) || null, sma200: sma200?.toFixed(2) || null },
      ema: { ema9: ema9?.toFixed(2) || null, ema20: ema20?.toFixed(2) || null },
      rsi14: rsi14?.toFixed(1) || null,
      macd, bollingerBands: bb, atr14, avgVolume20: avgVol20, signals,
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

  const HEADLINE_SOURCES = [
    { key: 'et', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', name: 'Economic Times' },
    { key: 'moneycontrol', url: 'https://www.moneycontrol.com/rss/marketsnews.xml', name: 'Moneycontrol' },
    { key: 'mint', url: 'https://www.livemint.com/rss/markets', name: 'Mint' },
    { key: 'businessStd', url: 'https://www.business-standard.com/rss/markets-106.rss', name: 'Business Standard' },
    { key: 'financialExp', url: 'https://www.financialexpress.com/market/feed/', name: 'Financial Express' },
    { key: 'zeeBiz', url: 'https://www.zeebiz.com/markets/rss', name: 'Zee Business' },
    { key: 'cnbcTv18', url: 'https://www.cnbctv18.com/commonfeeds/v1/eng/rss/market.xml', name: 'CNBC TV18' },
    { key: 'ndtvProfit', url: 'https://feeds.feedburner.com/NdtvProfit-Markets', name: 'NDTV Profit' },
  ];

  const results = await Promise.allSettled(
    HEADLINE_SOURCES.map(({ url, name }) => fetchRSS(url, name, 6))
  );

  const result = {};
  HEADLINE_SOURCES.forEach(({ key }, i) => {
    result[key] = results[i].status === 'fulfilled' ? results[i].value : [];
  });

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
