/* ════════════════════════════════════════════
   IMFSMA — main.js
   All UI logic, API calls, and Plotly chart rendering
   ════════════════════════════════════════════ */

'use strict';

// ── State ─────────────────────────────────────
const state = {
    activePage: 'dashboard',
    dashSymbol: '^NSEI',
    dashPeriod: '6mo',
    analyzerTicker: null,
};

// ── DOM helpers ────────────────────────────────
const $ = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);

// ── Day / Night Mode Toggle ────────────────────
(function initTheme() {
    const btn = document.getElementById('theme-toggle-btn');
    const body = document.body;

    // Restore saved preference
    if (localStorage.getItem('imfsma-theme') === 'day') {
        body.classList.add('day-mode');
        if (btn) btn.textContent = '☀️ Day';
    }

    if (!btn) return;

    btn.addEventListener('click', () => {
        const isDay = body.classList.toggle('day-mode');
        btn.textContent = isDay ? '☀️ Day' : '🌙 Night';
        localStorage.setItem('imfsma-theme', isDay ? 'day' : 'night');
        
        // Dynamically repaint the main charts if actively viewing them
        if (state.activePage === 'portfolio') loadPortfolio();
        if (state.activePage === 'dashboard') loadDashChart();
    });
})();

// ── Plotly default layout shared config ────────────
function getLayoutBase() {
    const isDay = document.body.classList.contains('day-mode');
    const gridColor = isDay ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
    const spikeColor = isDay ? '#000000' : '#63b3ed'; // solid black for day, solid bright blue for night
    const fontColor = isDay ? '#4a5568' : '#8896a9';
    const hoverBg = isDay ? '#ffffff' : '#0b1222';
    const hoverFont = isDay ? '#1a202c' : '#f0f4ff';
    const hoverBorder = isDay ? 'rgba(0,0,0,0.1)' : 'rgba(99,179,237,0.3)';

    return {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { family: "'Inter', sans-serif", color: fontColor, size: 11 },
        margin: { t: 20, b: 40, l: 60, r: 30 },
        xaxis: {
            gridcolor: gridColor,
            linecolor: gridColor,
            showspikes: true, spikecolor: spikeColor, spikethickness: 2,
            rangeslider: { visible: false },
        },
        yaxis: {
            gridcolor: gridColor,
            linecolor: gridColor,
            showspikes: true, spikecolor: spikeColor, spikethickness: 2,
            side: 'right',
        },
        legend: { bgcolor: 'rgba(0,0,0,0)', borderwidth: 0, x: 0, y: 1.05, orientation: 'h' },
        hovermode: 'x unified',
        hoverlabel: {
            bgcolor: hoverBg, bordercolor: hoverBorder,
            font: { family: "'Inter', sans-serif", color: hoverFont, size: 12 }
        },
    };
}

const PLOTLY_CONFIG = {
    displayModeBar: true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d', 'resetScale2d', 'toImage'],
    displaylogo: false,
    responsive: true,
};

// ══════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════
function switchPage(page) {
    state.activePage = page;
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-tab, .mobile-tab').forEach(el => {
        el.classList.toggle('active', el.dataset.page === page);
    });
    const pageEl = $('page-' + page);
    if (pageEl) pageEl.classList.add('active');

    if (page === 'dashboard') loadDashboard();
    if (page === 'news')      loadMarketNews();
    if (page === 'portfolio') loadPortfolio();
    if (page === 'history')   loadHistory();
}

document.querySelectorAll('.nav-tab, .mobile-tab').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

// ══════════════════════════════════════════════
//  LIVE CLOCK
// ══════════════════════════════════════════════
function updateClock() {
    const now = new Date();
    const el = $('live-time');
    if (el) el.textContent = now.toLocaleTimeString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ══════════════════════════════════════════════
//  TOAST NOTIFICATION
// ══════════════════════════════════════════════
function showToast(msg, type = 'success', duration = 3500) {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(16px)'; t.style.transition = '0.3s'; setTimeout(() => t.remove(), 350); }, duration);
}

// ══════════════════════════════════════════════
//  DASHBOARD PAGE
// ══════════════════════════════════════════════
async function loadDashboard() {
    // Fire all in parallel — index metrics, chart, top movers, and sector heatmap
    await Promise.all([
        loadIndexMetric('^NSEI', 'metric-nifty'),
        loadIndexMetric('^BSESN', 'metric-sensex'),
        loadDashChart(),
        loadTopMovers(),
        loadSectorHeatmap(),
    ]);
}

// ══════════════════════════════════════════════
//  SECTOR HEATMAP
// ══════════════════════════════════════════════
async function loadSectorHeatmap() {
    const grid = $('sector-heatmap-grid');
    if (!grid) return;

    try {
        const res  = await fetch('/api/sector-heatmap');
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        grid.innerHTML = data.sectors.map((s, i) => {
            const pct      = s.change_pct;
            const sign     = pct >= 0 ? '+' : '';
            const absVal   = Math.abs(pct);

            // Intensity: 0–1 capped at ±3%
            const intensity = Math.min(absVal / 3, 1);

            let bg, border, textColor;
            if (pct > 0.05) {
                // Green family
                const g = Math.round(197 - (197 - 80) * intensity);
                const r = Math.round(22  + (10) * (1 - intensity));
                bg      = `rgba(${r}, ${g}, 94, ${0.15 + intensity * 0.35})`;
                border  = `rgba(34, 197, 94, ${0.25 + intensity * 0.55})`;
                textColor = `rgb(${r + 10}, ${g + 30}, 94)`;
            } else if (pct < -0.05) {
                // Red family
                const r = Math.round(239 - (239 - 180) * (1 - intensity));
                bg      = `rgba(${r}, 68, 68, ${0.15 + intensity * 0.35})`;
                border  = `rgba(239, 68, 68, ${0.25 + intensity * 0.55})`;
                textColor = `rgb(${r}, 90, 90)`;
            } else {
                // Neutral
                bg        = 'rgba(255,255,255,0.04)';
                border    = 'rgba(255,255,255,0.10)';
                textColor = 'var(--text-muted)';
            }

            return `
            <div class="heatmap-tile" style="
                background:${bg};
                border-color:${border};
                animation-delay:${i * 45}ms
            " title="${s.ticker} — ₹${s.price.toLocaleString('en-IN')}">
              <div class="heatmap-sector-name">${s.name.replace('Nifty ', '')}</div>
              <div class="heatmap-pct" style="color:${textColor}">${sign}${pct.toFixed(2)}%</div>
              <div class="heatmap-bar-track">
                <div class="heatmap-bar-fill" style="
                  width:${Math.min(intensity * 100, 100)}%;
                  background:${textColor};
                "></div>
              </div>
            </div>`;
        }).join('');

    } catch (err) {
        grid.innerHTML = `<div class="empty-state" style="padding:1.5rem;grid-column:1/-1">
            <p>Could not load sector data.<br><small>${err.message}</small></p>
        </div>`;
    }
}

// ══════════════════════════════════════════════
//  TOP MOVERS
// ══════════════════════════════════════════════
function renderMoverRow(stock, rank, isGainer) {
    const sign = stock.change_pct >= 0 ? '+' : '';
    const cls = isGainer ? 'pos' : 'neg';
    return `
    <div class="mover-row" title="Click to analyze ${stock.name}" onclick="quickPick('${stock.ticker}')" style="cursor:pointer">
      <div class="mover-rank">${rank}</div>
      <div class="mover-info">
        <div class="mover-name">${stock.name}</div>
        <div class="mover-price">₹${stock.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}&nbsp;&nbsp;${sign}₹${Math.abs(stock.change).toFixed(2)}</div>
      </div>
      <div class="mover-change ${cls}">${sign}${stock.change_pct.toFixed(2)}%</div>
    </div>`;
}

async function loadTopMovers() {
    const gainersEl = $('gainers-list');
    const losersEl = $('losers-list');
    try {
        const res = await fetch('/api/top-movers');
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        if (gainersEl) {
            gainersEl.innerHTML = data.gainers
                .map((s, i) => renderMoverRow(s, i + 1, true)).join('');
        }
        if (losersEl) {
            losersEl.innerHTML = data.losers
                .map((s, i) => renderMoverRow(s, i + 1, false)).join('');
        }
    } catch (err) {
        const errHtml = `<div class="empty-state" style="padding:1.5rem"><p>Could not load mover data.<br><small>${err.message}</small></p></div>`;
        if (gainersEl) gainersEl.innerHTML = errHtml;
        if (losersEl) losersEl.innerHTML = errHtml;
    }
}


// ══════════════════════════════════════════════
//  NEWS MODULE
// ══════════════════════════════════════════════
function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        const diffMs = new Date() - d;
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHrs = Math.floor(diffMins / 60);
        if (diffHrs < 24) return `${diffHrs}h ago`;
        const diffDays = Math.floor(diffHrs / 24);
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays}d ago`;
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    } catch (e) {
        return dateStr;
    }
}

function renderNewsList(news, containerEl) {
    if (!containerEl) return;
    if (!news || news.length === 0) {
        containerEl.innerHTML = `
        <div class="empty-state" style="padding:1.5rem;grid-column:1/-1">
          <div class="empty-icon">📰</div>
          <p>No news updates found for this symbol at the moment.</p>
        </div>`;
        return;
    }
    
    containerEl.innerHTML = news.map(item => {
        const timeAgo = formatTimeAgo(item.pubDate);
        const imageHtml = item.thumbnail 
            ? `<div class="news-image" style="background-image:url('${item.thumbnail}')"></div>`
            : `<div class="news-image news-no-image">📰</div>`;
            
        return `
        <a href="${item.link}" target="_blank" class="news-card">
          ${imageHtml}
          <div class="news-card-body">
            <div class="news-card-meta">
              <span class="news-card-provider">${item.provider || 'News'}</span>
              <span>${timeAgo}</span>
            </div>
            <h4 class="news-card-title">${item.title}</h4>
            <p class="news-card-summary">${item.summary || ''}</p>
          </div>
        </a>`;
    }).join('');
}

async function loadMarketNews() {
    const listEl = $('market-news-list');
    if (!listEl) return;
    try {
        const res = await fetch('/api/market-news');
        const data = await res.json();
        renderNewsList(data.news, listEl);
    } catch (e) {
        listEl.innerHTML = `
        <div class="empty-state" style="padding:1.5rem;grid-column:1/-1">
          <div class="empty-icon">⚠️</div>
          <p>Could not load market news.<br><small>${e.message}</small></p>
        </div>`;
    }
}

async function loadStockNews(ticker) {
    const listEl = $('stock-news-list');
    if (!listEl) return;
    try {
        const res = await fetch(`/api/stock-news?ticker=${encodeURIComponent(ticker)}`);
        const data = await res.json();
        renderNewsList(data.news, listEl);
    } catch (e) {
        listEl.innerHTML = `
        <div class="empty-state" style="padding:1.5rem;grid-column:1/-1">
          <div class="empty-icon">⚠️</div>
          <p>Could not load stock-specific news.<br><small>${e.message}</small></p>
        </div>`;
    }
}

async function loadIndexMetric(symbol, containerId) {
    const el = $(containerId);
    if (!el) return;
    el.innerHTML = `<div class="loader-wrap"><div class="spinner"></div></div>`;
    try {
        const res = await fetch(`/api/index-data?symbol=${encodeURIComponent(symbol)}&period=5d`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const up = data.change_pct >= 0;
        const arrow = up ? '▲' : '▼';
        const cls = up ? 'up' : 'down';
        const name = symbol === '^NSEI' ? 'NIFTY 50' : 'SENSEX';
        el.innerHTML = `
      <div class="metric-label">${name}</div>
      <div class="metric-value">${data.close.toLocaleString('en-IN')}</div>
      <div class="metric-change ${cls}">${arrow} ${Math.abs(data.change).toLocaleString('en-IN')} (${data.change_pct > 0 ? '+' : ''}${data.change_pct}%)</div>
    `;
    } catch (e) {
        el.innerHTML = `<div class="metric-label" style="color:var(--red)">${e.message}</div>`;
    }
}

async function loadDashChart() {
    const el = $('dash-chart');
    if (!el) return;
    el.innerHTML = `<div class="loader-wrap"><div class="spinner"></div><span class="loader-text">Fetching market data…</span></div>`;
    try {
        const res = await fetch(`/api/index-data?symbol=${encodeURIComponent(state.dashSymbol)}&period=${state.dashPeriod}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const c = data.chart;
        const name = state.dashSymbol === '^NSEI' ? 'NIFTY 50' : 'SENSEX';

        const candle = {
            type: 'candlestick',
            x: c.dates, open: c.open, high: c.high, low: c.low, close: c.close,
            name,
            increasing: { line: { color: '#48bb78' }, fillcolor: 'rgba(72,187,120,0.7)' },
            decreasing: { line: { color: '#fc8181' }, fillcolor: 'rgba(252,129,129,0.7)' },
        };

        // Volume as bar on secondary y
        const vol = {
            type: 'bar', x: c.dates, y: c.volume,
            name: 'Volume',
            yaxis: 'y2',
            marker: { color: 'rgba(99,179,237,0.15)', line: { width: 0 } },
            hoverinfo: 'x+y',
        };

        const layout = {
            ...getLayoutBase(),
            height: 500,
            yaxis2: {
                overlaying: 'y', side: 'left',
                showgrid: false, showticklabels: false,
                range: [0, Math.max(...c.volume) * 5],
            },
        };

        el.innerHTML = '';
        Plotly.newPlot(el, [vol, candle], layout, PLOTLY_CONFIG);
    } catch (e) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${e.message}</p></div>`;
    }
}

// Dashboard controls
document.querySelectorAll('.idx-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.idx-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.dashSymbol = btn.dataset.symbol;
        loadDashChart();
    });
});

// Scope to ONLY the dashboard chart-controls, not the quick-pick chips
document.querySelectorAll('.chart-controls .period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.chart-controls .period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.dashPeriod = btn.dataset.period;
        loadDashChart();
    });
});

// ══════════════════════════════════════════════
//  STOCK ANALYZER PAGE
// ══════════════════════════════════════════════
const analyzeBtn = $('analyze-btn');
const tickerInput = $('ticker-input');
const analyzerResult = $('analyzer-result');

analyzeBtn && analyzeBtn.addEventListener('click', runAnalysis);
tickerInput && tickerInput.addEventListener('keydown', e => { if (e.key === 'Enter') runAnalysis(); });

async function runAnalysis() {
    let ticker = (tickerInput.value || '').trim().toUpperCase();
    if (!ticker) { showToast('Please enter a ticker symbol.', 'error'); return; }

    // Auto-append .NS if user typed a bare symbol (no dot) — covers most NSE stocks
    if (!ticker.includes('.')) {
        ticker = ticker + '.NS';
        tickerInput.value = ticker;
    }

    analyzerResult.innerHTML = `<div class="loader-wrap"><div class="spinner"></div><span class="loader-text">Analyzing ${ticker}…</span></div>`;
    analyzeBtn.disabled = true;

    try {
        const res = await fetch(`/api/analyze?ticker=${encodeURIComponent(ticker)}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        state.analyzerTicker = ticker;
        renderAnalysis(data);
    } catch (e) {
        analyzerResult.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>${e.message}<br><span style="font-size:0.8rem;opacity:0.7">Tip: Use NSE format like <strong>TCS.NS</strong> or <strong>RELIANCE.NS</strong></span></p></div>`;
    } finally {
        analyzeBtn.disabled = false;
    }
}
// Expose globally so inline onclick quickPick() in HTML can call it
window.runAnalysis = runAnalysis;

function renderAnalysis(data) {
    const { signal, summary, reasons, fundamentals, technicals, chart } = data;

    const signalColor = { BUY: 'var(--green)', SELL: 'var(--red)', HOLD: 'var(--yellow)' }[signal];
    const signalEmoji = { BUY: '🟢', SELL: '🔴', HOLD: '🟡' }[signal];

    // Fundamentals grid (exclude metadata fields)
    const fundSkip = ['Company Name', 'Sector', 'Industry'];
    const fundCells = Object.entries(fundamentals)
        .filter(([k]) => !fundSkip.includes(k))
        .map(([k, v]) => `
      <div class="data-cell">
        <div class="data-cell-label">${k}</div>
        <div class="data-cell-value">${v}</div>
      </div>`).join('');

    // Technical pills
    const techItems = [
        ['Price', `₹${(technicals.close || 0).toLocaleString('en-IN')}`],
        ['SMA 50', technicals.sma50 ? `₹${technicals.sma50.toFixed(2)}` : 'N/A'],
        ['SMA 200', technicals.sma200 ? `₹${technicals.sma200.toFixed(2)}` : 'N/A'],
        ['RSI (14)', technicals.rsi ? technicals.rsi : 'N/A'],
        ['MACD', technicals.macd],
        ['Signal', technicals.macd_signal],
        ['Histogram', technicals.macd_hist],
    ];

    const techPills = techItems.map(([l, v]) => `
    <div class="tech-pill">
      <span class="tech-pill-label">${l}</span>
      <span class="tech-pill-value">${v}</span>
    </div>`).join('');

    // Reasons list
    const reasonsHtml = reasons.map(r => `
    <li><span class="reason-icon">›</span> ${r}</li>`).join('');

    const companyName = fundamentals['Company Name'] || data.ticker;
    const sector = fundamentals['Sector'] || '';
    const industry = fundamentals['Industry'] || '';

    analyzerResult.innerHTML = `
    <!-- Company header -->
    <div style="margin-bottom:1.5rem">
      <h2 style="font-family:'Space Grotesk',sans-serif;font-size:1.5rem;font-weight:700">${companyName}</h2>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-top:3px">${data.ticker}${sector ? ' · ' + sector : ''}${industry ? ' · ' + industry : ''}</p>
    </div>

    <!-- Signal + Summary row -->
    <div class="signal-section">
      <div class="signal-badge ${signal}">
        <div>${signal}</div>
        <div class="signal-label">Score: ${data.score != null ? data.score : '—'}/100</div>
      </div>
      <div class="card summary-card">
        <div class="card-body">
          <div class="card-title">Analysis Summary</div>
          <p class="summary-text">${summary.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>
          <ul class="reasons-list">${reasonsHtml}</ul>
        </div>
      </div>
    </div>

    <!-- Fundamental metrics -->
    <div class="card" style="margin-bottom:1.5rem">
      <div class="card-body">
        <div class="card-title">Fundamental Metrics</div>
        <div class="data-grid">${fundCells}</div>
      </div>
    </div>

    <!-- Technical indicators row -->
    <div class="card" style="margin-bottom:1.5rem">
      <div class="card-body">
        <div class="card-title">Technical Indicators</div>
        <div class="tech-grid">${techPills}</div>
      </div>
    </div>

    <!-- Chart -->
    <div class="card chart-card">
      <div class="card-body">
        <div class="chart-header">
          <h3>${data.ticker} — Price Chart with SMA Overlays</h3>
        </div>
        <div id="analyzer-chart"></div>
      </div>
    </div>

    <!-- ML Price Prediction (loads asynchronously below) -->
    <div class="card" id="prediction-card" style="margin-top:1.5rem">
      <div class="card-body">
        <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <span>🤖 ML Price Prediction — Next 30 Trading Days</span>
          <span style="font-size:0.7rem;color:var(--text-muted);text-transform:none;letter-spacing:0;font-weight:400">Polynomial Regression · For educational purposes only</span>
        </div>
        <div id="prediction-chart">
          <div class="loader-wrap"><div class="spinner"></div><span class="loader-text">Running ML model…</span></div>
        </div>
        <div id="prediction-summary"></div>
      </div>
    </div>

    <!-- Latest Stock-Specific News -->
    <div class="card" id="stock-news-card" style="margin-top:1.5rem">
      <div class="card-body">
        <div class="card-title">📰 Latest News for ${companyName}</div>
        <div id="stock-news-list" class="news-grid">
          <div class="loader-wrap"><div class="spinner"></div><span class="loader-text">Fetching latest news…</span></div>
        </div>
      </div>
    </div>
  `;

    renderAnalyzerChart(chart, technicals);
    // Fire the ML prediction asynchronously — doesn't block the main result
    loadPrediction(data.ticker);
    loadStockNews(data.ticker);
}

// ══════════════════════════════════════════════
//  ML PRICE PREDICTION
// ══════════════════════════════════════════════
async function loadPrediction(ticker) {
    const chartEl = $('prediction-chart');
    const summaryEl = $('prediction-summary');
    if (!chartEl) return;

    try {
        const res = await fetch(`/api/predict?ticker=${encodeURIComponent(ticker)}&days=30`);
        const data = await res.json();

        if (data.error) {
            chartEl.innerHTML = `<div class="empty-state" style="padding:1.5rem"><p>${data.error}</p></div>`;
            return;
        }

        renderPredictionChart(data);

        // Summary pill below chart
        const isUp = data.change_pct >= 0;
        const arrow = isUp ? '▲' : '▼';
        const color = isUp ? 'var(--green)' : 'var(--red)';
        const bgCol = isUp ? 'var(--green-glow)' : 'var(--red-glow)';
        if (summaryEl) {
            summaryEl.innerHTML = `
            <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-top:1rem;align-items:center">
              <div style="font-size:0.82rem;color:var(--text-muted)">
                <strong style="color:var(--text-primary)">Last Close:</strong> ₹${data.last_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              <div style="font-size:0.82rem;color:var(--text-muted)">
                <strong style="color:var(--text-primary)">30-Day Target:</strong> ₹${data.target_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              <div style="padding:4px 12px;border-radius:8px;background:${bgCol};color:${color};font-size:0.82rem;font-weight:700;font-family:'Space Grotesk',sans-serif">
                ${arrow} ${data.change_pct >= 0 ? '+' : ''}${data.change_pct.toFixed(2)}% projected
              </div>
              <div style="font-size:0.72rem;color:var(--text-muted);font-style:italic">${data.model_info}</div>
            </div>`;
        }
    } catch (err) {
        if (chartEl) chartEl.innerHTML = `<div class="empty-state" style="padding:1.5rem"><p>Prediction unavailable: ${err.message}</p></div>`;
    }
}

function renderPredictionChart(data) {
    const el = $('prediction-chart');
    if (!el) return;
    el.innerHTML = '';

    // ── Traces ────────────────────────────────────────────────────────────
    // 1. Shaded confidence band (upper → lower fill)
    const bandUpper = {
        type: 'scatter', mode: 'lines',
        x: data.pred_dates, y: data.upper_band,
        name: 'Upper Bound',
        line: { color: 'rgba(245,158,11,0)', width: 0 },
        showlegend: false,
        hoverinfo: 'skip',
    };
    const bandLower = {
        type: 'scatter', mode: 'lines',
        x: data.pred_dates, y: data.lower_band,
        name: 'Confidence Band',
        fill: 'tonexty',
        fillcolor: 'rgba(245,158,11,0.1)',
        line: { color: 'rgba(245,158,11,0)', width: 0 },
        showlegend: true,
        hoverinfo: 'skip',
    };

    // 2. Historical actual prices (solid blue line)
    const historical = {
        type: 'scatter', mode: 'lines',
        x: data.hist_dates, y: data.hist_prices,
        name: 'Actual Price',
        line: { color: '#3b82f6', width: 2 },
        hovertemplate: '₹%{y:,.2f}<extra>Actual</extra>',
    };

    // 3. Connector dot at the boundary (last historical → first predicted)
    const connector = {
        type: 'scatter', mode: 'lines',
        x: [data.hist_dates[data.hist_dates.length - 1], data.pred_dates[0]],
        y: [data.hist_prices[data.hist_prices.length - 1], data.pred_prices[0]],
        name: 'Bridge',
        line: { color: '#f59e0b', width: 1.5, dash: 'dot' },
        showlegend: false, hoverinfo: 'skip',
    };

    // 4. Predicted price line (dashed amber)
    const predicted = {
        type: 'scatter', mode: 'lines+markers',
        x: data.pred_dates, y: data.pred_prices,
        name: 'ML Forecast',
        line: { color: '#f59e0b', width: 2.5, dash: 'dash' },
        marker: { color: '#f59e0b', size: 4 },
        hovertemplate: '₹%{y:,.2f}<extra>ML Forecast</extra>',
    };

    const layout = {
        ...getLayoutBase(),
        height: 360,
        shapes: [{
            // vertical line separating historical vs forecast
            type: 'line',
            x0: data.hist_dates[data.hist_dates.length - 1],
            x1: data.hist_dates[data.hist_dates.length - 1],
            y0: 0, y1: 1, yref: 'paper',
            line: { color: 'rgba(255,255,255,0.15)', width: 1, dash: 'dot' },
        }],
        annotations: [{
            x: data.hist_dates[data.hist_dates.length - 2],
            y: 1, yref: 'paper',
            text: 'Historical', showarrow: false,
            font: { size: 10, color: 'rgba(255,255,255,0.3)' },
            xanchor: 'right',
        }, {
            x: data.pred_dates[1],
            y: 1, yref: 'paper',
            text: '← ML Forecast →', showarrow: false,
            font: { size: 10, color: 'rgba(245,158,11,0.5)' },
            xanchor: 'left',
        }],
    };

    Plotly.newPlot(el, [bandUpper, bandLower, historical, connector, predicted], layout, PLOTLY_CONFIG);
}

function renderAnalyzerChart(chart, technicals) {
    const el = $('analyzer-chart');
    if (!el) return;

    const candle = {
        type: 'candlestick',
        x: chart.dates, open: chart.open, high: chart.high, low: chart.low, close: chart.close,
        name: 'Price',
        increasing: { line: { color: '#48bb78' }, fillcolor: 'rgba(72,187,120,0.7)' },
        decreasing: { line: { color: '#fc8181' }, fillcolor: 'rgba(252,129,129,0.7)' },
    };

    const traces = [candle];

    if (chart.sma50 && chart.sma50.length) {
        traces.push({
            type: 'scatter', mode: 'lines',
            x: chart.dates, y: chart.sma50,
            name: 'SMA 50',
            line: { color: '#63b3ed', width: 1.5, dash: 'dot' },
        });
    }
    if (chart.sma200 && chart.sma200.length) {
        traces.push({
            type: 'scatter', mode: 'lines',
            x: chart.dates, y: chart.sma200,
            name: 'SMA 200',
            line: { color: '#b794f4', width: 1.5, dash: 'dash' },
        });
    }

    Plotly.newPlot(el, traces, { ...getLayoutBase(), height: 450 }, PLOTLY_CONFIG);
}

// ══════════════════════════════════════════════
//  PORTFOLIO MANAGER PAGE
// ══════════════════════════════════════════════
const portfolioForm = $('portfolio-form');
portfolioForm && portfolioForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ticker = $('p-ticker').value.trim().toUpperCase();
    const units = parseFloat($('p-units').value);
    const buyPrice = parseFloat($('p-buyprice').value);

    if (!ticker || isNaN(units) || isNaN(buyPrice)) {
        showToast('All fields are required.', 'error'); return;
    }

    const btn = portfolioForm.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
        const res = await fetch('/api/portfolio/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker, units, buy_price: buyPrice }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showToast(`${ticker} added to portfolio.`);
        portfolioForm.reset();
        loadPortfolio();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        btn.disabled = false;
    }
});

async function loadPortfolio() {
    const tableWrap = $('portfolio-table-wrap');
    const summaryEl = $('portfolio-summary');
    const pieEl = $('portfolio-pie');

    if (tableWrap) tableWrap.innerHTML = `<div class="loader-wrap"><div class="spinner"></div><span class="loader-text">Fetching live prices…</span></div>`;

    try {
        const res = await fetch('/api/portfolio');
        const data = await res.json();
        const { holdings, summary } = data;

        // Summary cards
        if (summaryEl) {
            const s = summary;
            const pnlCls = s.total_pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
            const arrow = s.total_pnl >= 0 ? '▲' : '▼';
            summaryEl.innerHTML = `
        <div class="summary-card-sm"><div class="label">Total Invested</div><div class="value">₹${s.total_invested.toLocaleString('en-IN')}</div></div>
        <div class="summary-card-sm"><div class="label">Current Value</div><div class="value">₹${s.total_current.toLocaleString('en-IN')}</div></div>
        <div class="summary-card-sm"><div class="label">Total P&amp;L</div><div class="value ${pnlCls}">${arrow} ₹${Math.abs(s.total_pnl).toLocaleString('en-IN')}</div></div>
        <div class="summary-card-sm"><div class="label">Overall Return</div><div class="value ${pnlCls}">${s.total_pnl_pct >= 0 ? '+' : ''}${s.total_pnl_pct.toFixed(2)}%</div></div>
      `;
        }

        // Table
        if (tableWrap) {
            if (!holdings.length) {
                tableWrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><p>No holdings yet.<br>Add a stock using the form above.</p></div>`;
            } else {
                const rows = holdings.map(h => {
                    const pnlCls = h.pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
                    const arrow = h.pnl >= 0 ? '▲' : '▼';
                    return `
            <tr>
              <td class="ticker-cell">${h.ticker}</td>
              <td>${h.units}</td>
              <td>₹${h.buy_price.toLocaleString('en-IN')}</td>
              <td>₹${h.current_price.toLocaleString('en-IN')}</td>
              <td>₹${h.market_value.toLocaleString('en-IN')}</td>
              <td class="${pnlCls}">${arrow} ₹${Math.abs(h.pnl).toLocaleString('en-IN')}</td>
              <td class="${pnlCls}">${h.pnl_pct >= 0 ? '+' : ''}${h.pnl_pct.toFixed(2)}%</td>
              <td><button class="btn-danger" onclick="removeHolding(${h.index})">Remove</button></td>
            </tr>
          `;
                }).join('');
                tableWrap.innerHTML = `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ticker</th><th>Units</th><th>Buy Price</th><th>Current</th>
                  <th>Market Value</th><th>P&amp;L</th><th>Return</th><th>Action</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        `;
            }
        }

        // Advanced Dash
        const advDash = $('adv-portfolio-dash');
        if (advDash) {
            if (holdings.length > 0 && data.advanced) {
                advDash.style.display = 'block';
                const adv = data.advanced;

                // Today's Gain
                $('tg-gain-count').textContent = `${adv.gaining_count} of ${adv.total_holdings} Gaining`;
                $('tg-lose-count').textContent = `${adv.losing_count} of ${adv.total_holdings} Losing`;
                if (summary.todays_gain >= 0) {
                    $('tg-gain-val').innerHTML = `₹${Math.abs(summary.todays_gain).toLocaleString('en-IN')} <small>▲${summary.todays_gain_pct}%</small>`;
                    $('tg-lose-val').textContent = '—';
                } else {
                    $('tg-gain-val').textContent = '—';
                    $('tg-lose-val').innerHTML = `-₹${Math.abs(summary.todays_gain).toLocaleString('en-IN')} <small>▼${Math.abs(summary.todays_gain_pct)}%</small>`;
                }

                // Unrealized Gain
                $('ug-profit-count').textContent = `${adv.profit_count} of ${adv.total_holdings} In Profit`;
                $('ug-loss-count').textContent = `${adv.loss_count} of ${adv.total_holdings} In Loss`;
                if (summary.total_pnl >= 0) {
                    $('ug-profit-val').innerHTML = `₹${Math.abs(summary.total_pnl).toLocaleString('en-IN')} <small>▲${summary.total_pnl_pct}%</small>`;
                    $('ug-loss-val').textContent = '—';
                } else {
                    $('ug-profit-val').textContent = '—';
                    $('ug-loss-val').innerHTML = `-₹${Math.abs(summary.total_pnl).toLocaleString('en-IN')} <small>▼${Math.abs(summary.total_pnl_pct)}%</small>`;
                }

                // Lists
                const renderList = (items, isGain, key) => items.map(t => `<div class="adv-list-item"><div>${t.ticker}</div><div class="${isGain ? 'green' : 'red'}">${isGain ? '▲' : '▼'}${Math.abs(t[key]).toFixed(2)}%</div></div>`).join('');
                $('list-gaining').innerHTML = renderList(adv.top_day_gainers, true, 'day_gain_pct');
                $('list-losing').innerHTML  = renderList(adv.top_day_losers, false, 'day_gain_pct');
                $('list-profit').innerHTML  = renderList(adv.top_profits, true, 'pnl_pct');
                $('list-loss').innerHTML    = renderList(adv.top_losses, false, 'pnl_pct');

                // Scores
                $('sc-quality').textContent = adv.score.quality;
                $('sc-momentum').textContent = adv.score.momentum;
                $('sc-diversification').textContent = adv.score.diversification;

                // Donuts
                const dLayout = { paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', margin: {t:0,b:0,l:0,r:0}, showlegend: false };
                Plotly.newPlot('donut-today', [{
                    type: 'pie', labels: ['Gaining', 'Losing'], values: [adv.gaining_count || 0.1, adv.losing_count || 0.1],
                    hole: 0.75, marker: { colors: ['#48bb78', '#fc8181'] }, textinfo: 'none', hoverinfo: 'none'
                }], dLayout, {staticPlot: true});

                Plotly.newPlot('donut-unrealized', [{
                    type: 'pie', labels: ['Profit', 'Loss'], values: [adv.profit_count || 0.1, adv.loss_count || 0.1],
                    hole: 0.75, marker: { colors: ['#48bb78', '#fc8181'] }, textinfo: 'none', hoverinfo: 'none'
                }], dLayout, {staticPlot: true});

                // dynamic color based on score
                let scColor = '#48bb78';
                if (adv.score.total < 40) scColor = '#fc8181';
                else if (adv.score.total < 70) scColor = '#ed8936';

                Plotly.newPlot('donut-score', [{
                    type: 'pie', labels: ['Score', 'Remaining'], values: [adv.score.total, 100 - adv.score.total],
                    hole: 0.8, marker: { colors: [scColor, 'rgba(255,255,255,0.05)'] }, textinfo: 'none', hoverinfo: 'none'
                }], { ...dLayout, annotations: [{text: `${adv.score.total}/100`, font:{size:16, color:scColor, family:'Space Grotesk'}, showarrow:false}] }, {staticPlot: true});

            } else {
                advDash.style.display = 'none';
            }
        }

        // Pie chart
        if (pieEl && holdings.length > 0) {
            const labels = holdings.map(h => h.ticker);
            const values = holdings.map(h => h.market_value);
            const colors = ['#63b3ed', '#4fd1c5', '#b794f4', '#f6e05e', '#fc8181', '#48bb78', '#ed8936', '#76e4f7'];

            const isDay = document.body.classList.contains('day-mode');
            const mainText = isDay ? '#0f172a' : '#f0f4ff';
            const subText = isDay ? '#334155' : '#8896a9';
            const sliceBorder = isDay ? '#ffffff' : '#050a14';

            const pie = [{
                type: 'pie', labels, values,
                hole: 0.45,
                textinfo: 'label+percent',
                textfont: { family: "'Inter',sans-serif", size: 12, color: mainText },
                marker: { colors: colors.slice(0, labels.length), line: { color: sliceBorder, width: 2 } },
                hovertemplate: '<b>%{label}</b><br>₹%{value:,.2f}<br>%{percent}<extra></extra>',
            }];

            const pieLayout = {
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                font: { family: "'Inter',sans-serif", color: subText },
                margin: { t: 30, b: 30, l: 30, r: 30 },
                legend: { orientation: 'v', x: 1, y: 0.5, bgcolor: 'rgba(0,0,0,0)', font: { color: mainText } },
                height: 380,
                annotations: [{
                    text: 'Portfolio<br>Distribution',
                    font: { size: 13, color: subText },
                    showarrow: false, x: 0.5, y: 0.5,
                }],
            };

            pieEl.innerHTML = '';
            Plotly.newPlot(pieEl, pie, pieLayout, PLOTLY_CONFIG);
        } else if (pieEl) {
            pieEl.innerHTML = `<div class="empty-state" style="height:200px; display:flex; align-items:center; justify-content:center;"><p style="color:var(--text-muted)">Add holdings to see the distribution chart.</p></div>`;
        }

    } catch (e) {
        if (tableWrap) tableWrap.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${e.message}</p></div>`;
    }
}

async function removeHolding(index) {
    if (!confirm('Remove this holding from your portfolio?')) return;
    try {
        const res = await fetch(`/api/portfolio/remove?index=${index}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showToast('Holding removed.');
        loadPortfolio();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// ══════════════════════════════════════════════
//  HISTORY PAGE
// ══════════════════════════════════════════════
async function loadHistory() {
    const wrap   = $('history-table-wrap');
    const totEl  = $('hist-total');
    const buyEl  = $('hist-buy');
    const holdEl = $('hist-hold');
    const sellEl = $('hist-sell');

    if (wrap) wrap.innerHTML = `<div class="loader-wrap"><div class="spinner"></div><span class="loader-text">Loading history…</span></div>`;

    try {
        const res  = await fetch('/api/history');
        const data = await res.json();
        const records = data.history || [];

        // Stats
        const total = records.length;
        const buys  = records.filter(r => r.recommendation === 'BUY').length;
        const holds = records.filter(r => r.recommendation === 'HOLD').length;
        const sells = records.filter(r => r.recommendation === 'SELL').length;
        if (totEl)  totEl.textContent  = total;
        if (buyEl)  buyEl.textContent  = buys;
        if (holdEl) holdEl.textContent = holds;
        if (sellEl) sellEl.textContent = sells;

        if (!wrap) return;

        if (!records.length) {
            wrap.innerHTML = `
            <div class="empty-state">
              <div class="empty-icon">📋</div>
              <p>No analysis history yet.<br>Run a stock analysis to start logging results.</p>
            </div>`;
            return;
        }

        const rows = records.map((r, i) => {
            const sigClass = { BUY: 'sig-buy', SELL: 'sig-sell', HOLD: 'sig-hold' }[r.recommendation] || '';
            const sigEmoji = { BUY: '🟢', SELL: '🔴', HOLD: '🟡' }[r.recommendation] || '⬜';
            const priceStr = (r.price && !isNaN(r.price))
                ? '₹' + parseFloat(r.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : '—';
            const scoreBar = (r.score != null && !isNaN(r.score))
                ? `<div class="score-bar-wrap"><div class="score-bar" style="width:${r.score}%"></div><span>${r.score}/100</span></div>`
                : '—';
            return `
            <tr class="history-row" style="animation-delay:${i * 30}ms">
              <td class="hist-date">${r.date || '—'}</td>
              <td class="ticker-cell">${r.ticker || '—'}</td>
              <td class="hist-price">${priceStr}</td>
              <td>${scoreBar}</td>
              <td><span class="sig-badge ${sigClass}">${sigEmoji} ${r.recommendation || '—'}</span></td>
              <td><button class="btn-danger" onclick="removeHistory(${r.index})">Remove</button></td>
            </tr>`;
        }).join('');

        wrap.innerHTML = `
        <div class="table-wrap">
          <table id="history-table">
            <thead>
              <tr>
                <th>📅 Date &amp; Time</th>
                <th>📈 Stock (Ticker)</th>
                <th>💰 Price at Analysis</th>
                <th>🎯 Score</th>
                <th>🧠 Recommendation</th>
                <th>⚡ Action</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;

    } catch (err) {
        if (wrap) wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>Could not load history: ${err.message}</p></div>`;
    }
}
window.loadHistory = loadHistory;

async function clearHistory() {
    if (!confirm('Are you sure you want to clear all analysis history? This cannot be undone.')) return;
    try {
        const res  = await fetch('/api/history/clear', { method: 'DELETE' });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showToast('History cleared successfully.');
        loadHistory();
    } catch (err) {
        showToast('Failed to clear history: ' + err.message, 'error');
    }
}
window.clearHistory = clearHistory;

async function removeHistory(index) {
    if (!confirm('Remove this entry from the analysis history?')) return;
    try {
        const res = await fetch(`/api/history/remove?index=${index}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showToast('History entry removed.');
        loadHistory();
    } catch (e) {
        showToast(e.message, 'error');
    }
}
window.removeHistory = removeHistory;

// ══════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════
switchPage('dashboard');

// ══════════════════════════════════════════════
//  EXPORT ENGINE (CSV/PDF)
// ══════════════════════════════════════════════
window.exportData = async function(type, format) {
    try {
        const res = await fetch(`/api/${type}`);
        const data = await res.json();
        const records = type === 'portfolio' ? data.holdings : data.history;
        if (!records || records.length === 0) {
            showToast('No data to export.', 'error');
            return;
        }

        let headers, rows;
        if (type === 'portfolio') {
            headers = ['Ticker', 'Units', 'Buy Price', 'Current Price', 'Market Value', 'P&L', 'Return %'];
            rows = records.map(r => [
                r.ticker, r.units, r.buy_price, r.current_price, r.market_value, r.pnl, r.pnl_pct
            ]);
        } else {
            headers = ['Date', 'Ticker', 'Price', 'Score', 'Recommendation'];
            rows = records.map(r => [
                r.date, r.ticker, r.price, r.score, r.recommendation
            ]);
        }

        const fileName = `IMFSMA_${type}_export`;

        if (format === 'csv') {
            let csvContent = headers.join(",") + "\n" 
                + rows.map(e => e.join(",")).join("\n");
            
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", fileName + ".csv");
            document.body.appendChild(link);
            link.click();
            link.remove();
        } else if (format === 'pdf') {
            if (!window.jspdf) throw new Error("PDF engine not loaded yet. Try again in a moment.");
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            
            doc.setFontSize(18);
            doc.text(`IMFSMA ${type.charAt(0).toUpperCase() + type.slice(1)} Report`, 14, 15);
            doc.setFontSize(10);
            const dateStr = new Date().toLocaleString();
            doc.text(`Generated on: ${dateStr}`, 14, 22);

            doc.autoTable({
                head: [headers],
                body: rows,
                startY: 28,
                theme: 'striped',
                headStyles: { fillColor: [37, 99, 235] }
            });
            doc.save(fileName + ".pdf");
        }
    } catch (e) {
        showToast('Export failed: ' + e.message, 'error');
    }
}

// ══════════════════════════════════════════════
//  FLOATING AI CHAT
// ══════════════════════════════════════════════
const chatToggleBtn = document.getElementById('chat-toggle-btn');
const chatWidget = document.getElementById('chat-widget');
const chatCloseBtn = document.getElementById('chat-close-btn');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatBody = document.getElementById('chat-body');

function toggleChat() {
    if (!chatWidget) return;
    chatWidget.classList.toggle('active');
    if (chatWidget.classList.contains('active')) {
        chatInput.focus();
    }
}

if (chatToggleBtn) chatToggleBtn.addEventListener('click', toggleChat);
if (chatCloseBtn) chatCloseBtn.addEventListener('click', toggleChat);

function appendMessage(sender, text) {
    if (!chatBody) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${sender}`;
    msgDiv.innerHTML = `<div class="msg-content">${text}</div>`;
    chatBody.appendChild(msgDiv);
    chatBody.scrollTop = chatBody.scrollHeight;
}

function showChatLoader() {
    if (!chatBody) return;
    const loaderId = 'chat-loader-temp';
    if(document.getElementById(loaderId)) return;
    const loaderDiv = document.createElement('div');
    loaderDiv.id = loaderId;
    loaderDiv.className = 'chat-loader';
    loaderDiv.innerHTML = `<span></span><span></span><span></span>`;
    chatBody.appendChild(loaderDiv);
    chatBody.scrollTop = chatBody.scrollHeight;
}

function removeChatLoader() {
    const loader = document.getElementById('chat-loader-temp');
    if(loader) loader.remove();
}

async function handleChatSubmit() {
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if(!text) return;
    
    appendMessage('user', text);
    chatInput.value = '';
    chatSendBtn.disabled = true;
    showChatLoader();

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text }) // For simplicity, sending raw message
        });
        const data = await res.json();
        removeChatLoader();
        
        if (data.error) {
            appendMessage('bot', "⚠️ " + data.error);
        } else {
            appendMessage('bot', data.reply);
        }
    } catch(e) {
        removeChatLoader();
        appendMessage('bot', "⚠️ Connection to AI failed. Please try again.");
    } finally {
        chatSendBtn.disabled = false;
        chatInput.focus();
    }
}

if (chatSendBtn) chatSendBtn.addEventListener('click', handleChatSubmit);
if (chatInput) chatInput.addEventListener('keypress', (e) => {
    if(e.key === 'Enter') handleChatSubmit();
});
