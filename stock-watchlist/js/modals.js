/**
 * modals.js — Modal logic for Dalal Street News, International Markets, Commodities
 * Features: blur backdrop, index bar with sparklines, multi-column infinite scroll news
 */

/* ─── Formatters ────────────────────────────────────────────────────────────── */
function fmtIndexPrice(num, currency) {
    if (num == null || isNaN(num)) return '—';
    const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    const formatted = Number(num).toLocaleString('en-US', opts);
    return currency === 'INR' ? '₹' + formatted : formatted;
}

function fmtChange(pct) {
    if (pct == null || isNaN(pct)) return { text: '—', cls: 'neu' };
    const n = parseFloat(pct);
    const sign = n >= 0 ? '+' : '';
    const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : 'neu';
    return { text: `${sign}${n.toFixed(2)}%`, cls };
}

/* ─── Mini Sparkline SVG ────────────────────────────────────────────────────── */
function buildSparklineSVG(points, positive) {
    if (!points || points.length < 2) {
        return `<svg viewBox="0 0 60 30" width="60" height="24" fill="none" stroke="var(--text-muted)" stroke-width="1.5"><line x1="0" y1="15" x2="60" y2="15"/></svg>`;
    }
    const valid = points.filter(v => v != null && !isNaN(v));
    if (valid.length < 2) return '';
    const min = Math.min(...valid);
    const max = Math.max(...valid);
    const range = max - min || 1;
    const W = 60, H = 28, PAD = 2;
    const coords = valid.map((v, i) => {
        const x = PAD + (i / (valid.length - 1)) * (W - PAD * 2);
        const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const color = positive === true ? '#22c55e' : positive === false ? '#ef4444' : '#64748b';
    return `<svg viewBox="0 0 60 28" width="60" height="24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="${coords.join(' ')}"/></svg>`;
}

/* ─── Index Bar Renderer ────────────────────────────────────────────────────── */
function renderIndexBar(containerId, indices, opts = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    if (!indices || indices.length === 0) {
        container.innerHTML = '<div class="index-bar__empty">No data available</div>';
        return;
    }
    indices.forEach(idx => {
        const ch = fmtChange(idx.pChange);
        const isPos = idx.pChange > 0;
        const isNeg = idx.pChange < 0;
        const sparkSvg = buildSparklineSVG(idx.sparkline, isPos ? true : isNeg ? false : null);
        const tile = document.createElement('div');
        tile.className = `index-tile ${isPos ? 'pos' : isNeg ? 'neg' : ''}`;
        const flag = idx.flag ? `<span class="index-tile__flag">${idx.flag}</span>` : '';
        const currencyBadge = opts.showCurrency && idx.currency ? `<span class="index-tile__currency">${idx.currency}</span>` : '';
        const exchangeBadge = opts.showExchange && idx.exchange ? `<span class="index-tile__exchange">${idx.exchange}</span>` : '';
        tile.innerHTML = `
      <div class="index-tile__top">
        ${flag}
        <span class="index-tile__name">${idx.name}</span>
        ${currencyBadge}${exchangeBadge}
      </div>
      <div class="index-tile__price">${idx.lastPrice != null ? Number(idx.lastPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</div>
      <div class="index-tile__row">
        <span class="index-tile__change ${ch.cls}">${ch.text}</span>
        <div class="index-tile__sparkline">${sparkSvg}</div>
      </div>`;
        container.appendChild(tile);
    });
}

/* ─── Commodity Bar Renderer ────────────────────────────────────────────────── */
function renderCommodityBar(containerId, commodities) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    if (!commodities || commodities.length === 0) {
        container.innerHTML = '<div class="index-bar__empty">No data available</div>';
        return;
    }
    commodities.forEach(c => {
        const ch = fmtChange(c.pChange);
        const isPos = c.pChange > 0;
        const isNeg = c.pChange < 0;
        const sparkSvg = buildSparklineSVG(c.sparkline, isPos ? true : isNeg ? false : null);
        const tile = document.createElement('div');
        tile.className = `index-tile commodity-tile ${isPos ? 'pos' : isNeg ? 'neg' : ''}`;
        const currencySymbol = c.currency === 'INR' ? '₹' : '$';
        tile.innerHTML = `
      <div class="index-tile__top">
        <span class="index-tile__name">${c.name}</span>
        <span class="commodity-tile__currency">${currencySymbol}</span>
      </div>
      <div class="index-tile__price">${c.lastPrice != null ? Number(c.lastPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</div>
      <div class="index-tile__row">
        <span class="index-tile__change ${ch.cls}">${ch.text}</span>
        <div class="index-tile__sparkline">${sparkSvg}</div>
      </div>
      <div class="commodity-tile__exchange">${c.exchange}</div>`;
        container.appendChild(tile);
    });
}

/* ─── Source Tag CSS class ──────────────────────────────────────────────────── */
function modalSourceTagClass(source) {
    const s = (source || '').toLowerCase();
    if (s.includes('economic') || s.includes('et ')) return 'tag-et';
    if (s.includes('moneycontrol')) return 'tag-mc';
    if (s.includes('mint') || s.includes('livemint')) return 'tag-mint';
    if (s.includes('reuters')) return 'tag-newsapi';
    if (s.includes('bloomberg')) return 'tag-newsapi';
    if (s.includes('cnbc')) return 'tag-cnbc';
    if (s.includes('business standard')) return 'tag-bs';
    if (s.includes('marketwatch')) return 'tag-other';
    if (s.includes('yahoo')) return 'tag-gnews';
    if (s.includes('al jazeera')) return 'tag-other';
    if (s.includes('bbc')) return 'tag-other';
    if (s.includes('guardian')) return 'tag-other';
    if (s.includes('zee')) return 'tag-zee';
    if (s.includes('ndtv')) return 'tag-ndtv';
    if (s.includes('investing')) return 'tag-other';
    if (s.includes('oilprice')) return 'tag-other';
    return 'tag-other';
}

/* ─── Build news item element ───────────────────────────────────────────────── */
function buildModalNewsItem(item) {
    const div = document.createElement('div');
    div.className = 'modal-news-item';
    div.innerHTML = `
    <a class="modal-news-item__title" href="${item.link || '#'}" target="_blank" rel="noopener">${item.title || 'Untitled'}</a>
    <div class="modal-news-item__meta">
      <span class="news-source-tag ${modalSourceTagClass(item.source)}">${item.source || 'News'}</span>
      <span class="modal-news-item__date">${item.pubDate || ''}</span>
    </div>`;
    return div;
}

/* ─── Append news items to a column ─────────────────────────────────────────── */
function appendNewsToCol(listId, items) {
    const list = document.getElementById(listId);
    if (!list) return;
    // Remove loading state on first append
    const loading = list.querySelector('.news-loading');
    if (loading) loading.remove();
    if (!items || items.length === 0) {
        if (!list.querySelector('.modal-news-item')) {
            list.innerHTML = '<div class="modal-news-empty">No news available.</div>';
        }
        return;
    }
    const frag = document.createDocumentFragment();
    items.forEach(item => frag.appendChild(buildModalNewsItem(item)));
    list.appendChild(frag);
}

/* ─── Infinite Scroll Setup ─────────────────────────────────────────────────── */
function setupInfiniteScroll(loaderEl, onLoad) {
    if (!loaderEl) return;
    let loading = false;
    let done = false;

    const observer = new IntersectionObserver(async (entries) => {
        if (entries[0].isIntersecting && !loading && !done) {
            loading = true;
            loaderEl.innerHTML = '<div class="spinning-loader"><div class="spinner"></div></div>';
            try {
                const hasMore = await onLoad();
                if (!hasMore) { done = true; loaderEl.innerHTML = '<div class="no-more-news">All caught up ✓</div>'; observer.disconnect(); }
                else loaderEl.innerHTML = '';
            } catch { loaderEl.innerHTML = ''; }
            finally { loading = false; }
        }
    }, { threshold: 0.1 });

    observer.observe(loaderEl);
    return { stop: () => { done = true; observer.disconnect(); } };
}

/* ─── Dalal Street Modal ────────────────────────────────────────────────────── */
let dalalLoaded = false;
let dalalPage0 = 0, dalalPage1 = 0;

async function loadDalalStreet() {
    if (dalalLoaded) return;
    dalalLoaded = true;

    // Load indices
    try {
        const indices = await apiFetch('/api/dalal-street/indices', 20000);
        renderIndexBar('dalal-index-bar', indices);
    } catch (e) {
        const bar = document.getElementById('dalal-index-bar');
        if (bar) bar.innerHTML = '<div class="index-bar__empty">Could not load indices.</div>';
    }

    // Load news for both columns (split news in half across both)
    const loadDalalNews = async (page) => {
        const data = await apiFetch(`/api/dalal-street/news?page=${page}`, 20000);
        return data;
    };

    // Initial load
    try {
        const data = await loadDalalNews(0);
        const news = data.news || [];
        const half = Math.ceil(news.length / 2);
        appendNewsToCol('dalal-col0-list', news.slice(0, half));
        appendNewsToCol('dalal-col1-list', news.slice(half));
        dalalPage0 = 1;
        dalalPage1 = 1;

        // Setup infinite scroll
        let nextPage = 1;
        setupInfiniteScroll(document.getElementById('dalal-col0-loader'), async () => {
            try {
                const d = await loadDalalNews(nextPage++);
                const n = d.news || [];
                const h = Math.ceil(n.length / 2);
                appendNewsToCol('dalal-col0-list', n.slice(0, h));
                appendNewsToCol('dalal-col1-list', n.slice(h));
                return d.hasMore;
            } catch { return false; }
        });
    } catch (e) {
        appendNewsToCol('dalal-col0-list', []);
        appendNewsToCol('dalal-col1-list', []);
    }
}

/* ─── International Markets Modal ──────────────────────────────────────────── */
let intlLoaded = false;
let intlFinPage = 0, intlGeoPage = 0;

async function loadInternational() {
    if (intlLoaded) return;
    intlLoaded = true;

    // Load indices
    try {
        const indices = await apiFetch('/api/international/indices', 20000);
        renderIndexBar('intl-index-bar', indices, { showFlag: true });
    } catch (e) {
        const bar = document.getElementById('intl-index-bar');
        if (bar) bar.innerHTML = '<div class="index-bar__empty">Could not load indices.</div>';
    }

    // Cols 0+1 = financial news (split), Col 2 = geopolitical
    const loadFinNews = async (page) => apiFetch(`/api/international/news?type=financial&page=${page}`, 20000);
    const loadGeoNews = async (page) => apiFetch(`/api/international/news?type=geopolitical&page=${page}`, 20000);

    // Financial news -> split between col0 and col1
    try {
        const data = await loadFinNews(0);
        const news = data.news || [];
        const half = Math.ceil(news.length / 2);
        appendNewsToCol('intl-col0-list', news.slice(0, half));
        appendNewsToCol('intl-col1-list', news.slice(half));

        let finPage = 1;
        setupInfiniteScroll(document.getElementById('intl-col0-loader'), async () => {
            const d = await loadFinNews(finPage++);
            const n = d.news || [];
            const h = Math.ceil(n.length / 2);
            appendNewsToCol('intl-col0-list', n.slice(0, h));
            appendNewsToCol('intl-col1-list', n.slice(h));
            return d.hasMore;
        });
    } catch {
        appendNewsToCol('intl-col0-list', []);
        appendNewsToCol('intl-col1-list', []);
    }

    // Geopolitical news -> col2
    try {
        const data = await loadGeoNews(0);
        appendNewsToCol('intl-col2-list', data.news || []);
        let geoPage = 1;
        setupInfiniteScroll(document.getElementById('intl-col2-loader'), async () => {
            const d = await loadGeoNews(geoPage++);
            appendNewsToCol('intl-col2-list', d.news || []);
            return d.hasMore;
        });
    } catch {
        appendNewsToCol('intl-col2-list', []);
    }
}

/* ─── Commodities Modal ─────────────────────────────────────────────────────── */
let commodLoaded = false;

async function loadCommodities() {
    if (commodLoaded) return;
    commodLoaded = true;

    // Load commodity prices
    try {
        const commodities = await apiFetch('/api/commodities/prices', 20000);
        renderCommodityBar('commodities-bar', commodities);
    } catch (e) {
        const bar = document.getElementById('commodities-bar');
        if (bar) bar.innerHTML = '<div class="index-bar__empty">Could not load commodity prices.</div>';
    }

    // Indian commodities news -> col0
    const loadIndiaNews = async (page) => apiFetch(`/api/commodities/news?type=india&page=${page}`, 20000);
    const loadGlobalNews = async (page) => apiFetch(`/api/commodities/news?type=global&page=${page}`, 20000);

    try {
        const data = await loadIndiaNews(0);
        appendNewsToCol('commod-col0-list', data.news || []);
        let pg = 1;
        setupInfiniteScroll(document.getElementById('commod-col0-loader'), async () => {
            const d = await loadIndiaNews(pg++);
            appendNewsToCol('commod-col0-list', d.news || []);
            return d.hasMore;
        });
    } catch { appendNewsToCol('commod-col0-list', []); }

    try {
        const data = await loadGlobalNews(0);
        appendNewsToCol('commod-col1-list', data.news || []);
        let pg = 1;
        setupInfiniteScroll(document.getElementById('commod-col1-loader'), async () => {
            const d = await loadGlobalNews(pg++);
            appendNewsToCol('commod-col1-list', d.news || []);
            return d.hasMore;
        });
    } catch { appendNewsToCol('commod-col1-list', []); }
}

/* ─── Modal Open/Close ──────────────────────────────────────────────────────── */
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('modal-overlay--open');
    document.body.classList.add('modal-open');
    // Blur background
    const grid = document.getElementById('cards-grid');
    const emptyState = document.getElementById('empty-state');
    if (grid) grid.classList.add('content-blur');
    if (emptyState) emptyState.classList.add('content-blur');
    // Trap focus / close on escape
    modal._escHandler = (e) => { if (e.key === 'Escape') closeModal(modalId); };
    document.addEventListener('keydown', modal._escHandler);
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('modal-overlay--open');
    document.body.classList.remove('modal-open');
    const grid = document.getElementById('cards-grid');
    const emptyState = document.getElementById('empty-state');
    if (grid) grid.classList.remove('content-blur');
    if (emptyState) emptyState.classList.remove('content-blur');
    if (modal._escHandler) document.removeEventListener('keydown', modal._escHandler);
}

/* ─── DOMContentLoaded wiring ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    // Sidebar buttons
    document.getElementById('btn-dalal-street')?.addEventListener('click', () => {
        openModal('modal-dalal-street');
        loadDalalStreet();
    });
    document.getElementById('btn-international')?.addEventListener('click', () => {
        openModal('modal-international');
        loadInternational();
    });
    document.getElementById('btn-commodities')?.addEventListener('click', () => {
        openModal('modal-commodities');
        loadCommodities();
    });

    // Close buttons (delegated)
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.modal));
    });

    // Click on backdrop (outside modal-window) to close
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });
});
