/**
 * ui.js (v2) — DOM rendering for Stock Watchlist Dashboard
 * Covers: price cards, technical indicators, corporate tabs, autocomplete, toasts
 */

/* ─── Price Formatters ─────────────────────────────────────────────────────── */

function fmtPrice(num) {
    if (num == null || isNaN(num)) return '—';
    return '₹' + Number(num).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNum(num) {
    if (num == null || isNaN(num)) return '—';
    return Number(num).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(num) {
    if (num == null || isNaN(num)) return '—';
    const n = parseFloat(num);
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function signClass(num) {
    const n = parseFloat(num);
    if (isNaN(n) || n === 0) return 'neu';
    return n > 0 ? 'pos' : 'neg';
}

function fmtVolume(n) {
    if (!n) return '—';
    if (n >= 10000000) return (n / 10000000).toFixed(2) + ' Cr';
    if (n >= 100000) return (n / 100000).toFixed(2) + ' L';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

/* ─── Source Tag CSS class ────────────────────────────────────────────────── */
function sourceTagClass(source) {
    const s = (source || '').toLowerCase();
    if (s.includes('economic') || s.includes('et ') || s.includes('et market')) return 'tag-et';
    if (s.includes('moneycontrol')) return 'tag-mc';
    if (s.includes('mint') || s.includes('livemint')) return 'tag-mint';
    if (s.includes('google')) return 'tag-gnews';
    if (s.includes('newsapi') || s.includes('reuters') || s.includes('bloomberg')) return 'tag-newsapi';
    if (s.includes('nse') || s.includes('bse')) return 'tag-nse';
    return 'tag-other';
}

/* ─── Toast ────────────────────────────────────────────────────────────────── */
const toastContainer = document.getElementById('toast-container');

function showToast(message, type = 'info', duration = 4000) {
    const icons = {
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    };
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('hide');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
}

/* ─── Theme ────────────────────────────────────────────────────────────────── */
function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('sw_theme', isDark ? 'light' : 'dark');
}

function loadTheme() {
    const saved = localStorage.getItem('sw_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
}

/* ─── Market Status ────────────────────────────────────────────────────────── */
function updateMarketStatus() {
    const dot = document.getElementById('market-dot');
    const lbl = document.getElementById('market-label');
    if (!dot || !lbl) return;
    const now = new Date();
    const ist = new Date(now.getTime() + (5.5 * 60 - now.getTimezoneOffset()) * 60000);
    const day = ist.getDay();
    const mins = ist.getHours() * 60 + ist.getMinutes();
    const isWeekday = day >= 1 && day <= 5;
    const isOpen = isWeekday && mins >= 555 && mins < 930; // 9:15–15:30
    dot.className = 'market-dot ' + (isOpen ? 'open' : 'closed');
    lbl.textContent = isOpen ? 'NSE Open' : 'NSE Closed';
}

/* ─── Shimmer ──────────────────────────────────────────────────────────────── */
function insertShimmerCard(symbol) {
    const tmpl = document.getElementById('shimmer-template');
    const node = tmpl.content.cloneNode(true);
    const card = node.querySelector('.shimmer-card');
    card.dataset.symbol = symbol;
    card.id = `shimmer-${symbol}`;
    document.getElementById('cards-grid').appendChild(card);
}

function removeShimmerCard(symbol) {
    const el = document.getElementById(`shimmer-${symbol}`);
    if (el) el.remove();
}

/* ─── Card Render ──────────────────────────────────────────────────────────── */
function renderCard(symbol, onRemove, onRefresh) {
    const existing = document.getElementById(`card-${symbol}`);
    if (existing && !existing.classList.contains('shimmer-card')) existing.remove();

    const tmpl = document.getElementById('card-template');
    const node = tmpl.content.cloneNode(true);
    const card = node.querySelector('.stock-card');

    card.dataset.symbol = symbol;
    card.id = `card-${symbol}`;
    card.querySelector('.card__symbol').textContent = symbol;
    card.querySelector('.card__company').textContent = 'Loading…';

    // Remove / refresh buttons
    card.querySelector('.card__remove-btn').addEventListener('click', () => onRemove(symbol));
    card.querySelector('.card__refresh-btn').addEventListener('click', () => onRefresh(symbol));

    // News toggle
    _setupToggle(card.querySelector('.card__news-section .news-toggle'),
        card.querySelector('.card__news-list'));

    // Screener toggle
    _setupToggle(
        card.querySelector('.card__ratios-section .news-toggle'),
        card.querySelector('.ratios-body')
    );

    // Indicators toggle
    _setupToggle(
        card.querySelector('.card__indicators-section .news-toggle'),
        card.querySelector('.indicators-body')
    );

    // Corporate section toggle
    _setupToggle(
        card.querySelector('.card__corporate-section .news-toggle'),
        card.querySelector('.corporate-body'),
        false  // starts collapsed
    );

    // Corporate tab switching
    card.querySelectorAll('.corp-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const targetPanel = tab.dataset.tab;
            card.querySelectorAll('.corp-tab').forEach(t => t.classList.remove('corp-tab--active'));
            card.querySelectorAll('.corp-panel').forEach(p => p.classList.remove('corp-panel--active'));
            tab.classList.add('corp-tab--active');
            card.querySelector(`.corp-panel[data-panel="${targetPanel}"]`)?.classList.add('corp-panel--active');
        });
    });

    document.getElementById('cards-grid').appendChild(card);
    return card;
}

function _setupToggle(btn, body, startExpanded = true) {
    if (!btn || !body) return;
    btn.setAttribute('aria-expanded', String(startExpanded));
    if (!startExpanded) body.style.display = 'none';
    btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
        body.style.display = expanded ? 'none' : '';
    });
}

/* ─── Card Data Update ─────────────────────────────────────────────────────── */
function updateCard(symbol, price, news, corporate, indicators, screener) {
    const card = document.getElementById(`card-${symbol}`);
    if (!card) return;

    // ── Price ──────────────────────────────────────────────────
    if (price) {
        card.querySelector('.card__company').textContent = price.companyName || symbol;
        card.querySelector('.card__price').textContent = fmtPrice(price.lastPrice);

        const chEl = card.querySelector('.card__change');
        chEl.textContent = `${fmtPct(price.pChange)} (${fmtPrice(price.change)})`;
        chEl.className = `card__change badge-change ${signClass(price.pChange)}`;

        card.querySelector('.card__open').textContent = fmtPrice(price.open);
        card.querySelector('.card__close').textContent = fmtPrice(price.close || price.previousClose);
        card.querySelector('.card__high').textContent = fmtPrice(price.dayHigh);
        card.querySelector('.card__low').textContent = fmtPrice(price.dayLow);
        card.querySelector('.card__52h').textContent = fmtPrice(price.weekHigh52);
        card.querySelector('.card__52l').textContent = fmtPrice(price.weekLow52);
        if (price.series) card.querySelector('.card__series').textContent = price.series;
    } else {
        card.querySelector('.card__company').textContent = 'Price data unavailable';
    }

    // ── Indicators ─────────────────────────────────────────────
    if (indicators) {
        const sec = card.querySelector('.card__indicators-section');
        sec.classList.remove('card__indicators-section--hidden');

        // Signals
        const sigContainer = card.querySelector('.card__ind-signals');
        sigContainer.innerHTML = '';
        (indicators.signals || []).forEach(s => {
            const span = document.createElement('span');
            span.className = `signal-badge signal-${s.sentiment}`;
            span.textContent = s.label;
            sigContainer.appendChild(span);
        });

        // RSI
        const rsi = parseFloat(indicators.rsi14);
        const rsiEl = card.querySelector('.card__rsi');
        const rsiBar = card.querySelector('.card__rsi-bar');
        if (!isNaN(rsi)) {
            rsiEl.textContent = rsi.toFixed(1);
            rsiBar.style.width = rsi + '%';
            const cls = rsi >= 70 ? 'rsi-overbought' : (rsi <= 30 ? 'rsi-oversold' : 'rsi-neutral');
            rsiEl.className = `ind-block__value card__rsi ${cls}`;
            rsiBar.className = `rsi-bar ${cls === 'rsi-overbought' ? 'rsi-bearish' : cls === 'rsi-oversold' ? 'rsi-bullish' : 'rsi-neutral'}`;
        }

        // MACD
        const macd = indicators.macd;
        if (macd) {
            const mNum = parseFloat(macd.macdLine);
            const macdEl = card.querySelector('.card__macd');
            macdEl.textContent = macd.macdLine;
            macdEl.className = `ind-block__value card__macd ${mNum >= 0 ? 'pos-macd' : 'neg-macd'}`;
            card.querySelector('.card__macd-signal').textContent =
                macd.signal ? `Signal: ${macd.signal} | Hist: ${macd.histogram}` : 'Signal: —';
        }

        // Moving Averages
        const lastPrice = parseFloat(indicators.lastClose);
        const maTable = card.querySelector('.card__ma-table');
        maTable.innerHTML = '';
        const maEntries = [
            ['EMA 9', indicators.ema?.ema9],
            ['EMA 20', indicators.ema?.ema20],
            ['SMA 20', indicators.sma?.sma20],
            ['SMA 50', indicators.sma?.sma50],
            ['SMA 200', indicators.sma?.sma200],
        ];
        maEntries.forEach(([label, val]) => {
            if (!val) return;
            const v = parseFloat(val);
            const above = lastPrice > v;
            const row = document.createElement('div');
            row.className = 'ma-row';
            row.innerHTML = `
        <span class="ma-row__label">${label}</span>
        <span class="ma-row__val">₹${fmtNum(v)}</span>
        <span class="ma-row__signal ${above ? 'above' : 'below'}">${above ? '▲ Above' : '▼ Below'}</span>`;
            maTable.appendChild(row);
        });

        // Bollinger Bands
        const bb = indicators.bollingerBands;
        if (bb) {
            card.querySelector('.card__bb-upper').textContent = fmtPrice(bb.upper);
            card.querySelector('.card__bb-mid').textContent = fmtPrice(bb.middle);
            card.querySelector('.card__bb-lower').textContent = fmtPrice(bb.lower);
        }

        // ATR + Volume
        card.querySelector('.card__atr').textContent = indicators.atr14 ? `₹${indicators.atr14}` : '—';
        card.querySelector('.card__avgvol').textContent = `Avg Vol 20d: ${fmtVolume(indicators.avgVolume20)}`;
    }

    // ── Screener ratios ────────────────────────────────────────
    if (screener && Object.keys(screener.ratios || {}).length > 0) {
        const sec = card.querySelector('.card__ratios-section');
        sec.classList.remove('card__ratios-section--hidden');
        const grid = card.querySelector('.card__ratios-grid');
        grid.innerHTML = '';
        Object.entries(screener.ratios || {}).slice(0, 9).forEach(([k, v]) => {
            const item = document.createElement('div');
            item.className = 'ratio-item';
            item.innerHTML = `<div class="ratio-item__label">${k}</div><div class="ratio-item__value">${v}</div>`;
            grid.appendChild(item);
        });
        card.querySelector('.card__pros').innerHTML = (screener.pros || []).map(p => `<li>${p}</li>`).join('');
        card.querySelector('.card__cons').innerHTML = (screener.cons || []).map(c => `<li>${c}</li>`).join('');
    }

    // ── News ───────────────────────────────────────────────────
    const newsEl = card.querySelector('.card__news-list');
    newsEl.innerHTML = '';
    if (news && news.length > 0) {
        news.slice(0, 6).forEach(item => newsEl.appendChild(_buildNewsItem(item)));
    } else {
        newsEl.innerHTML = '<li class="muted-text" style="padding:8px 10px">No recent news found.</li>';
    }

    // ── Corporate Events (Tabs) ────────────────────────────────
    if (corporate) {
        _renderCorporateTab(card, 'announcements', corporate.announcements, 'Announcement', 'cat-announcement');
        _renderCorporateTab(card, 'boardMeetings', corporate.boardMeetings, 'Board Meeting', 'cat-board');
        _renderCorporateTab(card, 'corporateActions', corporate.corporateActions, 'Corp Action', 'cat-action');
        _renderCorporateTab(card, 'financialResults', corporate.financialResults, 'Results', 'cat-results');
        _renderInsiderTab(card, corporate.insiderTrading);
        _renderShareholdingTab(card, corporate.shareholdingSummary || corporate.shareholdingPattern);
    }

    // ── Timestamp ──────────────────────────────────────────────
    const now = new Date();
    card.querySelector('.card__timestamp').textContent =
        'Updated ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function _buildNewsItem(item) {
    const li = document.createElement('li');
    li.className = 'news-item';
    li.innerHTML = `
    <div class="news-item__title">
      <a href="${item.link || '#'}" target="_blank" rel="noopener">${item.title || 'Untitled'}</a>
    </div>
    <div class="news-item__meta">
      <span class="news-source-tag ${sourceTagClass(item.source)}">${item.source || 'News'}</span>
      <span class="news-item__date">${item.pubDate || ''}</span>
    </div>`;
    return li;
}

function _renderCorporateTab(card, panelKey, items, categoryLabel, catClass) {
    const panel = card.querySelector(`.corp-panel[data-panel="${panelKey}"]`);
    if (!panel) return;
    panel.innerHTML = '';
    if (!items || items.length === 0) {
        panel.innerHTML = '<p class="muted-text" style="padding:8px">No recent data found.</p>';
        return;
    }
    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'corp-item';
        const link = item.link
            ? `<a href="${item.link}" target="_blank" rel="noopener">${item.title}</a>`
            : item.title;
        const extra = item.exDate
            ? `Ex-Date: ${item.exDate}` + (item.recordDate ? ` · Record: ${item.recordDate}` : '')
            : (item.details || '');
        div.innerHTML = `
      <div class="corp-item__title">${link}</div>
      <div class="corp-item__meta">
        <span class="corp-type-badge ${catClass}">${categoryLabel}</span>
        ${item.date ? `<span class="corp-item__date">${item.date}</span>` : ''}
        ${extra ? `<span class="corp-item__details">${extra}</span>` : ''}
      </div>`;
        panel.appendChild(div);
    });
}

function _renderInsiderTab(card, items) {
    const panel = card.querySelector('.corp-panel[data-panel="insiderTrading"]');
    if (!panel) return;
    panel.innerHTML = '';
    if (!items || items.length === 0) {
        panel.innerHTML = '<p class="muted-text" style="padding:8px">No insider trading data found.</p>';
        return;
    }
    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'corp-item';
        div.innerHTML = `
      <div class="corp-item__title">${item.title}</div>
      <div class="corp-item__meta">
        <span class="corp-type-badge cat-insider">Insider</span>
        ${item.date ? `<span class="corp-item__date">${item.date}</span>` : ''}
      </div>
      ${item.details ? `<div class="corp-item__details" style="padding:2px 0 0">${item.details}</div>` : ''}`;
        panel.appendChild(div);
    });
}

function _renderShareholdingTab(card, items) {
    const panel = card.querySelector('.corp-panel[data-panel="shareholdingPattern"]');
    if (!panel) return;
    panel.innerHTML = '';

    if (!items || items.length === 0) {
        panel.innerHTML = '<p class="muted-text" style="padding:8px">No shareholding data found.</p>';
        return;
    }

    // Render as a clean table if we have structured summary data
    if (items[0] && items[0].category !== undefined) {
        const table = document.createElement('table');
        table.className = 'shareholding-table';
        table.innerHTML = `<thead><tr><th>Category</th><th>% Holding</th></tr></thead>`;
        const tbody = document.createElement('tbody');
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${item.category || item.title || '—'}</td><td>${item.percentage || item.per || '—'}%</td>`;
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        panel.appendChild(table);
    } else {
        // Fallback: render as corp items
        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'corp-item';
            div.innerHTML = `
        <div class="corp-item__title">${item.title}</div>
        <div class="corp-item__meta">
          <span class="corp-type-badge cat-shareholding">Shareholding</span>
          ${item.date ? `<span class="corp-item__date">${item.date}</span>` : ''}
        </div>`;
            panel.appendChild(div);
        });
    }
}

/* ─── Card Refresh Spinner ────────────────────────────────────────────────── */
function setCardRefreshing(symbol, spinning) {
    const card = document.getElementById(`card-${symbol}`);
    if (!card) return;
    card.querySelector('.card__refresh-btn').classList.toggle('spin', spinning);
}

/* ─── Empty State ──────────────────────────────────────────────────────────── */
function showEmptyState(show) {
    const empty = document.getElementById('empty-state');
    const grid = document.getElementById('cards-grid');
    if (empty) empty.style.display = show ? 'flex' : 'none';
    if (grid) grid.style.display = show ? 'none' : 'grid';
}

/* ─── Sidebar Watchlist ────────────────────────────────────────────────────── */
function renderSidebarWatchlist(symbols, priceMap, onRemove, onScrollTo) {
    const ul = document.getElementById('watchlist-items');
    const badge = document.getElementById('watchlist-count');
    if (!ul) return;
    ul.innerHTML = '';
    if (badge) badge.textContent = symbols.length;

    symbols.forEach(sym => {
        const price = priceMap.get(sym);
        const li = document.createElement('li');
        li.className = 'watchlist-item';
        const pChange = price?.pChange;
        const cls = signClass(pChange);
        const changeStr = (pChange != null && !isNaN(pChange))
            ? (pChange >= 0 ? '+' : '') + parseFloat(pChange).toFixed(2) + '%' : '—';
        li.innerHTML = `
      <span class="watchlist-item__name">${sym}</span>
      <span class="watchlist-item__change ${cls}">${changeStr}</span>
      <button class="watchlist-item__remove" aria-label="Remove ${sym}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>`;
        li.querySelector('.watchlist-item__name').addEventListener('click', () => onScrollTo(sym));
        li.querySelector('.watchlist-item__change').addEventListener('click', () => onScrollTo(sym));
        li.querySelector('.watchlist-item__remove').addEventListener('click', e => { e.stopPropagation(); onRemove(sym); });
        ul.appendChild(li);
    });
}

/* ─── Market Headlines ─────────────────────────────────────────────────────── */
function renderMarketHeadlines(data) {
    const container = document.getElementById('market-headlines');
    if (!container) return;
    container.innerHTML = '';
    const all = [
        ...(data.et || []).slice(0, 3).map(h => ({ ...h, source: 'ET Markets' })),
        ...(data.moneycontrol || []).slice(0, 3).map(h => ({ ...h, source: 'Moneycontrol' })),
        ...(data.mint || []).slice(0, 3).map(h => ({ ...h, source: 'Mint' })),
    ];
    if (all.length === 0) {
        container.innerHTML = '<p class="muted-text">No headlines available.</p>';
        return;
    }
    all.forEach(h => {
        const div = document.createElement('div');
        div.className = 'headline-item';
        div.innerHTML = `
      <a href="${h.link || '#'}" target="_blank" rel="noopener">${h.title || ''}</a>
      <div class="headline-item__source">${h.source} · ${h.pubDate || ''}</div>`;
        container.appendChild(div);
    });
}

/* ─── Autocomplete Dropdown ────────────────────────────────────────────────── */
/**
 * Initialise the autocomplete on the stock search input.
 * @param {HTMLInputElement} inputEl
 * @param {HTMLUListElement} listEl
 * @param {Function} onSelect  callback(symbol, companyName)
 * @param {Function} searchFn  async (q) => [{symbol,companyName,series}]
 */
function initAutocomplete(inputEl, listEl, onSelect, searchFn) {
    let debounceTimer = null;
    let highlighted = -1;
    let currentResults = [];

    function openList(results) {
        currentResults = results;
        highlighted = -1;
        listEl.innerHTML = '';

        results.forEach((item, idx) => {
            const li = document.createElement('li');
            li.className = 'autocomplete-item';
            li.setAttribute('role', 'option');
            li.dataset.idx = idx;
            li.innerHTML = `
        <span class="ac-symbol">${item.symbol}</span>
        <span class="ac-name">${item.companyName || ''}</span>
        <span class="ac-badge">${item.series || 'EQ'}</span>`;
            li.addEventListener('mousedown', e => {
                e.preventDefault(); // prevent input blur
                selectItem(item);
            });
            listEl.appendChild(li);
        });

        listEl.classList.add('open');
    }

    function closeList() {
        listEl.classList.remove('open');
        highlighted = -1;
        currentResults = [];
    }

    function selectItem(item) {
        inputEl.value = item.symbol;
        closeList();
        onSelect(item.symbol, item.companyName);
    }

    function highlightItem(idx) {
        const items = listEl.querySelectorAll('.autocomplete-item');
        items.forEach((el, i) => el.classList.toggle('highlighted', i === idx));
        highlighted = idx;
    }

    inputEl.addEventListener('input', () => {
        const q = inputEl.value.trim();
        clearTimeout(debounceTimer);
        if (q.length < 1) { closeList(); return; }
        debounceTimer = setTimeout(async () => {
            try {
                const results = await searchFn(q);
                if (results.length > 0) openList(results);
                else closeList();
            } catch { closeList(); }
        }, 280);
    });

    inputEl.addEventListener('keydown', e => {
        if (!listEl.classList.contains('open')) return;
        const count = currentResults.length;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightItem(Math.min(highlighted + 1, count - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightItem(Math.max(highlighted - 1, 0));
        } else if (e.key === 'Enter' && highlighted >= 0) {
            e.preventDefault();
            selectItem(currentResults[highlighted]);
        } else if (e.key === 'Escape') {
            closeList();
        }
    });

    inputEl.addEventListener('blur', () => setTimeout(closeList, 150));
}
