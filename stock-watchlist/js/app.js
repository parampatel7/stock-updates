/**
 * app.js (v2) — Core application logic for Stock Watchlist Dashboard
 * Manages: watchlist state, LocalStorage, data orchestration, sidebar, autocomplete
 */

const LS_KEY = 'stock_watchlist';
const priceMap = new Map();

function loadWatchlist() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; } }
function saveWatchlist(s) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }

let watchlist = loadWatchlist();

/* ─── Core Operations ──────────────────────────────────────────────────────── */

function addStock(rawInput) {
    const symbol = rawInput.trim().toUpperCase().replace(/[^A-Z0-9&-]/g, '');
    if (!symbol) { showToast('Please enter a valid ticker.', 'error'); return; }
    if (watchlist.includes(symbol)) { showToast(`${symbol} already in watchlist.`, 'info'); return; }

    watchlist.push(symbol);
    saveWatchlist(watchlist);
    updateEmptyState();

    insertShimmerCard(symbol);
    const card = renderCard(symbol, removeStock, refreshSingleStock);
    removeShimmerCard(symbol);
    setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

    refreshSingleStock(symbol);
    refreshSidebarWatchlist();
    showToast(`${symbol} added to watchlist.`, 'success');
}

function removeStock(symbol) {
    watchlist = watchlist.filter(s => s !== symbol);
    saveWatchlist(watchlist);
    priceMap.delete(symbol);

    const card = document.getElementById(`card-${symbol}`);
    if (card) {
        card.style.cssText += 'opacity:0;transform:scale(0.95);transition:opacity 0.25s,transform 0.25s;';
        setTimeout(() => card.remove(), 260);
    }

    updateEmptyState();
    refreshSidebarWatchlist();
    showToast(`${symbol} removed.`, 'info');
}

function scrollToCard(symbol) {
    document.getElementById(`card-${symbol}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (window.innerWidth <= 768) closeMobileSidebar();
}

/* ─── Data Fetching ────────────────────────────────────────────────────────── */

async function refreshSingleStock(symbol) {
    setCardRefreshing(symbol, true);
    try {
        const { price, news, corporate, indicators, screener, errors } = await fetchAll(symbol);
        updateCard(symbol, price, news, corporate, indicators, screener);

        if (price) priceMap.set(symbol, price);
        refreshSidebarWatchlist();

        if (errors.length > 0) {
            // Only show toast if ALL data failed
            if (!price && !news.length && !corporate && !indicators) {
                showToast(`${symbol}: Could not load data. ${errors[0]}`, 'error');
            }
        }
    } catch (err) {
        showToast(`Failed to load ${symbol}: ${err.message}`, 'error');
    } finally {
        setCardRefreshing(symbol, false);
    }
}

async function fetchAllStocks() {
    if (watchlist.length === 0) { showToast('Add stocks first.', 'info'); return; }

    const fetchBtn = document.getElementById('fetch-btn');
    const fetchIcon = document.getElementById('fetch-icon');
    const refreshBtn = document.getElementById('refresh-all-btn');
    const refreshIcon = document.getElementById('refresh-icon');

    fetchBtn?.classList.add('btn--loading');
    if (fetchIcon) fetchIcon.style.animation = 'spin 0.8s linear infinite';
    if (refreshBtn) refreshBtn.classList.add('spin');
    if (refreshIcon) refreshIcon.style.animation = 'spin 0.8s linear infinite';

    showToast(`Fetching data for ${watchlist.length} stock(s)…`, 'info', 2000);

    try {
        await Promise.all(watchlist.map(refreshSingleStock));

        // Also load market headlines
        try {
            const headlines = await fetchMarketHeadlines();
            renderMarketHeadlines(headlines);
        } catch { /* silent */ }

        showToast(`All ${watchlist.length} stock(s) updated!`, 'success');
    } catch (err) {
        showToast(`Fetch error: ${err.message}`, 'error');
    } finally {
        fetchBtn?.classList.remove('btn--loading');
        if (fetchIcon) fetchIcon.style.animation = '';
        if (refreshBtn) refreshBtn.classList.remove('spin');
        if (refreshIcon) refreshIcon.style.animation = '';
    }
}

/* ─── UI Helpers ───────────────────────────────────────────────────────────── */

function updateEmptyState() {
    showEmptyState(watchlist.length === 0);
}

function refreshSidebarWatchlist() {
    renderSidebarWatchlist(watchlist, priceMap, removeStock, scrollToCard);
}

/* ─── Sidebar Toggle ───────────────────────────────────────────────────────── */

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (window.innerWidth <= 768) {
        sidebar.classList.toggle('sidebar--open');
        overlay.classList.toggle('active');
    } else {
        sidebar.classList.toggle('sidebar--collapsed');
    }
}

function closeMobileSidebar() {
    document.getElementById('sidebar')?.classList.remove('sidebar--open');
    document.getElementById('sidebar-overlay')?.classList.remove('active');
}

/* ─── Restore Watchlist ────────────────────────────────────────────────────── */

function initWatchlist() {
    updateEmptyState();
    watchlist.forEach(symbol => {
        insertShimmerCard(symbol);
        renderCard(symbol, removeStock, refreshSingleStock);
        removeShimmerCard(symbol);
    });
    refreshSidebarWatchlist();
}

/* ─── DOMContentLoaded ─────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    updateMarketStatus();
    setInterval(updateMarketStatus, 60000);

    initWatchlist();

    // Autocomplete setup
    const input = document.getElementById('stock-input');
    const acList = document.getElementById('autocomplete-list');

    initAutocomplete(input, acList, (symbol) => {
        // When user selects a symbol from dropdown, auto-add it
        addStock(symbol);
        input.value = '';
    }, searchSymbols);

    // Add stock form submit (for manual Enter / submit)
    document.getElementById('add-stock-form')?.addEventListener('submit', e => {
        e.preventDefault();
        // If dropdown is open and something is highlighted, autocomplete handles it
        const val = input.value.trim();
        if (val) { addStock(val); input.value = ''; }
    });

    // Fetch all
    document.getElementById('fetch-btn')?.addEventListener('click', fetchAllStocks);
    document.getElementById('refresh-all-btn')?.addEventListener('click', fetchAllStocks);

    // Theme
    document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
    document.getElementById('mobile-theme-btn')?.addEventListener('click', toggleTheme);

    // Sidebar
    document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-overlay')?.addEventListener('click', closeMobileSidebar);

    // Mobile bottom nav
    document.getElementById('mobile-watchlist-btn')?.addEventListener('click', () => {
        document.getElementById('sidebar')?.classList.add('sidebar--open');
        document.getElementById('sidebar-overlay')?.classList.add('active');
    });
    document.getElementById('mobile-fetch-btn')?.addEventListener('click', fetchAllStocks);

    // Empty state pill buttons
    document.querySelectorAll('.pill-btn').forEach(btn => {
        btn.addEventListener('click', () => { if (btn.dataset.ticker) addStock(btn.dataset.ticker); });
    });

    // Keyboard: / to focus search
    document.addEventListener('keydown', e => {
        if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input?.focus(); }
    });

    // Auto-fetch on load
    if (watchlist.length > 0) setTimeout(fetchAllStocks, 600);
});
