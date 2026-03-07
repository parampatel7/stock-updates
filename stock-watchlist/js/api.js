/**
 * api.js — API client (v2) for Stock Watchlist backend
 */

const BASE_URL = window.location.origin;

async function apiFetch(url, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        return await res.json();
    } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') throw new Error('Request timed out');
        throw err;
    }
}

/** Live NSE quote */
async function fetchStockPrice(symbol) {
    return apiFetch(`${BASE_URL}/api/stock/${encodeURIComponent(symbol)}`);
}

/** Aggregated news from all sources */
async function fetchNews(symbol) {
    return apiFetch(`${BASE_URL}/api/news/${encodeURIComponent(symbol)}`);
}

/** All NSE corporate event categories */
async function fetchCorporate(symbol) {
    return apiFetch(`${BASE_URL}/api/corporate/${encodeURIComponent(symbol)}`, 20000);
}

/** Technical indicators (RSI, SMA, MACD, BB) */
async function fetchIndicators(symbol) {
    return apiFetch(`${BASE_URL}/api/indicators/${encodeURIComponent(symbol)}`, 20000);
}

/** Screener.in key ratios */
async function fetchScreener(symbol) {
    return apiFetch(`${BASE_URL}/api/screener/${encodeURIComponent(symbol)}`);
}

/** Market-wide headlines */
async function fetchMarketHeadlines() {
    return apiFetch(`${BASE_URL}/api/headlines`);
}

/** Symbol autocomplete search */
async function searchSymbols(query) {
    if (!query || query.trim().length < 1) return [];
    return apiFetch(`${BASE_URL}/api/symbols/search?q=${encodeURIComponent(query.trim())}`, 5000);
}

/** Upcoming corporate events (dividends, splits, board meetings) — next 30 days */
async function fetchUpcomingEvents(symbol) {
    return apiFetch(`${BASE_URL}/api/upcoming-events/${encodeURIComponent(symbol)}`, 12000);
}

/** Bulk upcoming events for watchlist — next 30 days */
async function fetchBulkUpcomingEvents(symbols) {
    if (!symbols || symbols.length === 0) return { events: [] };
    const query = symbols.join(',');
    return apiFetch(`${BASE_URL}/api/upcoming-events?symbols=${encodeURIComponent(query)}`, 15000);
}

/**
 * Fetch all data for a single symbol in parallel.
 * Returns partial data even if some sources fail.
 */
async function fetchAll(symbol) {
    const [price, news, corporate, indicators, screener] = await Promise.allSettled([
        fetchStockPrice(symbol),
        fetchNews(symbol),
        fetchCorporate(symbol),
        fetchIndicators(symbol),
        fetchScreener(symbol),
    ]);

    const errors = [price, news, corporate, indicators, screener]
        .filter(r => r.status === 'rejected')
        .map(r => r.reason?.message || 'Unknown error');

    return {
        price: price.status === 'fulfilled' ? price.value : null,
        news: news.status === 'fulfilled' ? news.value : [],
        corporate: corporate.status === 'fulfilled' ? corporate.value : null,
        indicators: indicators.status === 'fulfilled' ? indicators.value : null,
        screener: screener.status === 'fulfilled' ? screener.value : null,
        errors,
    };
}
