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
    const isEmpty = watchlist.length === 0;
    showEmptyState(isEmpty);
    const dashControls = document.getElementById('dashboard-controls');
    if (dashControls) dashControls.style.display = isEmpty ? 'none' : 'flex';
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

/* ─── Restore & Sort Watchlist ─────────────────────────────────────────────── */

function sortWatchlist(criteria) {
    if (!watchlist || watchlist.length === 0) return;

    watchlist.sort((a, b) => {
        const pA = priceMap.get(a);
        const pB = priceMap.get(b);

        if (criteria === 'symbol') return a.localeCompare(b);
        if (!pA && !pB) return a.localeCompare(b);
        if (!pA) return 1;
        if (!pB) return -1;

        if (criteria === 'priceDesc') return pB.lastPrice - pA.lastPrice;
        if (criteria === 'priceAsc') return pA.lastPrice - pB.lastPrice;
        if (criteria === 'changeDesc') return pB.pChange - pA.pChange;
        if (criteria === 'changeAsc') return pA.pChange - pB.pChange;

        return 0;
    });

    saveWatchlist(watchlist);

    // Reorder DOM elements in cards-grid
    const grid = document.getElementById('cards-grid');
    watchlist.forEach(sym => {
        const card = document.getElementById(`card-${sym}`);
        const shimmer = document.getElementById(`shimmer-${sym}`);
        if (card) grid.appendChild(card);
        else if (shimmer) grid.appendChild(shimmer);
    });

    refreshSidebarWatchlist();
}

function initWatchlist() {
    updateEmptyState();
    watchlist.forEach(symbol => {
        insertShimmerCard(symbol);
        renderCard(symbol, removeStock, refreshSingleStock);
        removeShimmerCard(symbol);
    });
    refreshSidebarWatchlist();
}

/* ─── Preloader ────────────────────────────────────────────────────────────── */

function initPreloader() {
    const preloader = document.getElementById('preloader');
    const video = document.getElementById('preloader-video');
    if (!preloader || !video) return;

    let preloaderHidden = false;
    const hidePreloader = () => {
        if (preloaderHidden) return;
        preloaderHidden = true;
        preloader.classList.add('preloader--hidden');
        document.body.classList.remove('preload-active');
        setTimeout(() => {
            preloader.remove();
        }, 500); // Wait for transition
    };

    video.addEventListener('ended', hidePreloader);

    // Max wait time or fallback
    setTimeout(hidePreloader, 5000);
}

/* ─── Background Slider ────────────────────────────────────────────────────── */

const bgThemeImages = {
    dark: [
        'Media/Dark Theme/India.jpg',
        'Media/Dark Theme/Indian2.jpg',
        'Media/Dark Theme/Indian3.png',
        'Media/Dark Theme/Indian4.jpg',
        'Media/Dark Theme/Indian5.jpg'
    ],
    light: [
        'Media/Light Theme/light.png',
        'Media/Light Theme/light2.png',
        'Media/Light Theme/light5.png',
        'Media/Light Theme/light6.png',
        'Media/Light Theme/light7.png'
    ]
};

const modalBgImages = {
    dalalStreet: { dark: 'Media/Dark Theme/DalalStreet.png', light: 'Media/Light Theme/Dalal Street.png' },
    international: { dark: 'Media/Dark Theme/International news.png', light: 'Media/Light Theme/International news.png' },
    commodities: { dark: 'Media/Dark Theme/commodities.png', light: 'Media/Light Theme/Commodities.png' }
};

let bgIntervalId = null;
let currentBgIndex = 0;

function initBackgroundSlider() {
    updateBackgrounds();
}

function updateBackgrounds() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const images = isDark ? bgThemeImages.dark : bgThemeImages.light;

    // Reset slider
    clearInterval(bgIntervalId);
    currentBgIndex = 0;

    const slide1 = document.getElementById('bg-slide-1');
    const slide2 = document.getElementById('bg-slide-2');
    if (!slide1 || !slide2) return;

    slide1.style.backgroundImage = `url('${images[0]}')`;
    slide1.classList.add('active');
    slide2.classList.remove('active');

    if (images.length > 1) {
        bgIntervalId = setInterval(() => {
            currentBgIndex = (currentBgIndex + 1) % images.length;
            const nextImage = images[currentBgIndex];

            // Toggle active class to crossfade
            if (slide1.classList.contains('active')) {
                slide2.style.backgroundImage = `url('${nextImage}')`;
                slide2.classList.add('active');
                slide1.classList.remove('active');
            } else {
                slide1.style.backgroundImage = `url('${nextImage}')`;
                slide1.classList.add('active');
                slide2.classList.remove('active');
            }
        }, 5000);
    }

    // Update Modal Backgrounds
    const overlayColor = isDark ? 'rgba(15, 23, 42, 0.45)' : 'rgba(244, 247, 249, 0.75)'; // Increased image visibility

    const dalalModalContent = document.querySelector('#modal-dalal-street .modal-window');
    if (dalalModalContent) {
        const bgUrl = isDark ? modalBgImages.dalalStreet.dark : modalBgImages.dalalStreet.light;
        dalalModalContent.style.backgroundImage = `linear-gradient(${overlayColor}, ${overlayColor}), url('${bgUrl}')`;
        dalalModalContent.style.backgroundSize = 'cover';
        dalalModalContent.style.backgroundPosition = 'center';
    }

    const intlModalContent = document.querySelector('#modal-international .modal-window');
    if (intlModalContent) {
        const bgUrl = isDark ? modalBgImages.international.dark : modalBgImages.international.light;
        intlModalContent.style.backgroundImage = `linear-gradient(${overlayColor}, ${overlayColor}), url('${bgUrl}')`;
        intlModalContent.style.backgroundSize = 'cover';
        intlModalContent.style.backgroundPosition = 'center';
    }

    const commodModalContent = document.querySelector('#modal-commodities .modal-window');
    if (commodModalContent) {
        const bgUrl = isDark ? modalBgImages.commodities.dark : modalBgImages.commodities.light;
        commodModalContent.style.backgroundImage = `linear-gradient(${overlayColor}, ${overlayColor}), url('${bgUrl}')`;
        commodModalContent.style.backgroundSize = 'cover';
        commodModalContent.style.backgroundPosition = 'center';
    }
}

/* ─── DOMContentLoaded ─────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
    initPreloader();
    loadTheme();
    initBackgroundSlider();
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
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
        toggleTheme();
        updateBackgrounds();
    });
    document.getElementById('mobile-theme-btn')?.addEventListener('click', () => {
        toggleTheme();
        updateBackgrounds();
    });

    // Sidebar
    document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-overlay')?.addEventListener('click', closeMobileSidebar);

    // Sort Dropdown
    document.getElementById('sort-select')?.addEventListener('change', e => {
        sortWatchlist(e.target.value);
    });

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

    // ─── Upcoming Events Drawer Logic ──────────────────────────────────────────
    const eventsBtn = document.getElementById('floating-events-btn');
    const eventsBadge = document.getElementById('floating-events-badge');
    const eventsDrawer = document.getElementById('events-drawer');
    const eventsOverlay = document.getElementById('events-drawer-overlay');
    const eventsClose = document.getElementById('events-drawer-close');
    const eventsBody = document.getElementById('events-drawer-body');

    let eventsCacheData = null;
    let eventsLastFetched = 0;

    function openEventsDrawer() {
        eventsDrawer.classList.add('active');
        eventsOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Fetch if no cache or older than 10 mins
        if (watchlist.length > 0) {
            const now = Date.now();
            if (!eventsCacheData || now - eventsLastFetched > 10 * 60 * 1000) {
                loadUpcomingEvents();
            } else {
                renderEventsDrawer(eventsCacheData);
            }
        } else {
            eventsBody.innerHTML = '<div class="events-drawer__empty"><p>Your watchlist is empty.</p></div>';
            eventsBadge.style.display = 'none';
        }
    }

    function closeEventsDrawer() {
        eventsDrawer.classList.remove('active');
        eventsOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    async function loadUpcomingEvents() {
        eventsBody.innerHTML = '<div class="drawer-loading"><div class="spinner"></div><span>Loading events…</span></div>';
        try {
            const res = await fetchBulkUpcomingEvents(watchlist);
            eventsCacheData = res.events || [];
            eventsLastFetched = Date.now();
            renderEventsDrawer(eventsCacheData);
        } catch (e) {
            eventsBody.innerHTML = `<div class="events-drawer__empty" style="color:var(--red);"><p>Error: ${e.message}</p></div>`;
        }
    }

    function renderEventsDrawer(events) {
        if (!events || events.length === 0) {
            eventsBody.innerHTML = '<div class="events-drawer__empty"><p>No upcoming events for your watchlist in the next 30 days.</p></div>';
            eventsBadge.style.display = 'none';
            return;
        }

        eventsBadge.textContent = events.length;
        eventsBadge.style.display = 'block';

        // Group by symbol
        const grouped = {};
        events.forEach(e => {
            if (!grouped[e.symbol]) grouped[e.symbol] = { company: e.company, list: [] };
            grouped[e.symbol].list.push(e);
        });

        let html = '';
        for (const [sym, data] of Object.entries(grouped)) {
            html += `
                <div class="event-group">
                    <div class="event-group__header">
                        <span class="event-group__symbol">${sym}</span>
                        <span class="event-group__company">${data.company}</span>
                    </div>
                    <div class="event-group__list">
            `;
            data.list.forEach(item => {
                const typeClass = item.type === 'Dividend' ? 'type-dividend'
                    : item.type === 'Stock Split' ? 'type-split'
                        : item.type === 'Bonus Issue' ? 'type-bonus'
                            : item.type === 'Board Meeting' ? 'type-meeting' : 'type-default';

                // Parse date (e.g. "27-Mar-2026")
                let day = '--', month = '---';
                if (item.rawDate) {
                    const parts = item.rawDate.split('-');
                    if (parts.length >= 2) {
                        day = parts[0];
                        month = parts[1];
                    }
                }

                html += `
                        <div class="drawer-event-item">
                            <div class="drawer-event-date">
                                <span class="day">${day}</span>
                                <span class="month">${month}</span>
                            </div>
                            <div class="drawer-event-content">
                                <div class="drawer-event-type ${typeClass}">${item.event_type}</div>
                                <div class="drawer-event-label">${item.label || item.event_type}</div>
                            </div>
                        </div>
                `;
            });
            html += `</div></div>`;
        }
        eventsBody.innerHTML = html;
    }

    eventsBtn?.addEventListener('click', openEventsDrawer);
    eventsOverlay?.addEventListener('click', closeEventsDrawer);
    eventsClose?.addEventListener('click', closeEventsDrawer);

    // Auto-fetch upcoming events in background to update badge
    async function initEventsBadge() {
        if (watchlist.length > 0) {
            try {
                const res = await fetchBulkUpcomingEvents(watchlist);
                eventsCacheData = res.events || [];
                eventsLastFetched = Date.now();
                if (eventsCacheData.length > 0) {
                    eventsBadge.textContent = eventsCacheData.length;
                    eventsBadge.style.display = 'block';
                }
            } catch (e) { }
        }
    }
    setTimeout(initEventsBadge, 3000); // 3 seconds after load

    // Auto-fetch on load
    if (watchlist.length > 0) setTimeout(fetchAllStocks, 600);
});
