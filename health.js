/**
 * MATRIX OSINT — Health Monitoring Page
 * Standalone endpoint health monitoring
 */

const API_BASE = 'https://matrix-osint-backend-production.up.railway.app';
let MASTER_KEY = '';

const state = {
  providers: [],
  healthData: {},
  stats: { requests: 0, errors: 0, uptime: 0 },
  rateLimit: { limit: 0, remaining: 0, reset: 0 },
  selectedEndpoint: null,
};

const elements = {};

function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return Array.from(ctx.querySelectorAll(sel)); }

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

function formatTime(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function showToast(message, type = 'info') {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-msg">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Close">✕</button>
  `;
  toast.querySelector('.toast-close').onclick = () => toast.remove();
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function setStatusDot(id, active) {
  const el = $(`#${id}`);
  if (el) el.classList.toggle('active', active);
}

function initMatrixRain() {
  const canvas = $('#matrix-bg');
  const ctx = canvas.getContext('2d');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*()';
  const fontSize = 14;
  let columns = 0;
  let drops = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    columns = Math.floor(canvas.width / fontSize);
    drops = Array(columns).fill(0).map(() => Math.random() * -100);
  }

  function draw() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = '#00ff41';
    
    for (let i = 0; i < drops.length; i++) {
      const char = chars[Math.floor(Math.random() * chars.length)];
      const x = i * fontSize;
      const y = drops[i] * fontSize;
      
      if (y > 0 && y < canvas.height && Math.random() > 0.98) {
        ctx.fillText(char, x, y);
      }
      
      if (y > canvas.height && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i]++;
    }
  }

  resize();
  window.addEventListener('resize', resize);
  setInterval(draw, 50);
}

function updateClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
}

async function fetchProviders() {
  try {
    const res = await fetch(`${API_BASE}/api/providers`);
    const data = await res.json();
    state.providers = data;
    renderProviderList();
    $('#provider-count').textContent = data.length;
    setStatusDot('status-conn', true);
  } catch (err) {
    console.error('Failed to fetch providers:', err);
    showToast('Failed to load providers', 'error');
    setStatusDot('status-conn', false);
  }
}

async function fetchSystemStats() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    const data = await res.json();
    state.stats.uptime = data.uptime;
    $('#sys-uptime').textContent = formatUptime(state.stats.uptime);
  } catch (err) {
    console.error('Stats fetch failed:', err);
  }
}

async function fetchEndpointHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/health/endpoints`);
    const data = await res.json();
    state.healthData = data.summary || {};
    renderHealthPanel();
    populateHealthFilter();
    updateHealthStats();
  } catch (err) {
    console.error('Health fetch failed:', err);
  }
}

function updateRateLimitDisplay() {
  $('#sys-ratelimit').textContent = `${state.rateLimit.remaining}/${state.rateLimit.limit}`;
  setStatusDot('status-rate', state.rateLimit.remaining > 0);
}

function renderProviderList() {
  const list = $('#provider-list');
  const filter = $('#provider-filter').value.toLowerCase();
  
  const filtered = state.providers.filter(p => 
    p.name.toLowerCase().includes(filter) ||
    p.kind.toLowerCase().includes(filter) ||
    (p.description || '').toLowerCase().includes(filter)
  );
  
  list.innerHTML = filtered.map(p => `
    <li class="provider-item" data-key="${p.key}">
      <span class="provider-icon">${p.icon || '◈'}</span>
      <div class="provider-info">
        <div class="provider-name">${escapeHtml(p.name)}</div>
        <div class="provider-kind">${escapeHtml(p.kind)}</div>
      </div>
      <span class="provider-badge">${p.endpointCount || 0} eps</span>
    </li>
  `).join('');
  
  $$('.provider-item', list).forEach(item => {
    item.onclick = () => {
      $$('.provider-item', list).forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      $('#health-filter').value = item.dataset.key;
      renderHealthPanel();
    };
  });
}

function populateHealthFilter() {
  const select = $('#health-filter');
  const options = Object.keys(state.healthData)
    .map(k => `<option value="${k}">${escapeHtml(k)}</option>`)
    .join('');
  select.innerHTML = '<option value="all">ALL PROVIDERS</option>' + options;
}

function updateHealthStats() {
  const statsEl = $('#health-stats');
  let totalEndpoints = 0;
  let aliveEndpoints = 0;
  let totalChecks = 0;
  let totalErrors = 0;
  
  Object.values(state.healthData).forEach(endpoints => {
    endpoints.forEach(ep => {
      totalEndpoints++;
      totalChecks += ep.checks || 0;
      if (ep.isAlive) aliveEndpoints++;
      if (ep.lastError) totalErrors++;
    });
  });
  
  statsEl.innerHTML = `
    <span class="stat-item"><span class="stat-label">TOTAL:</span> <span class="stat-value">${totalEndpoints}</span></span>
    <span class="stat-item ok"><span class="stat-label">ALIVE:</span> <span class="stat-value">${aliveEndpoints}</span></span>
    <span class="stat-item err"><span class="stat-label">DEAD:</span> <span class="stat-value">${totalEndpoints - aliveEndpoints}</span></span>
    <span class="stat-item"><span class="stat-label">CHECKS:</span> <span class="stat-value">${totalChecks}</span></span>
    <span class="stat-item err"><span class="stat-label">ERRORS:</span> <span class="stat-value">${totalErrors}</span></span>
  `;
}

function renderHealthPanel() {
  const list = $('#endpoint-health-list');
  const filter = $('#health-filter').value;
  
  let providersToShow = Object.keys(state.healthData);
  if (filter !== 'all') {
    providersToShow = [filter];
  }
  
  if (!providersToShow.length) {
    list.innerHTML = '<div class="placeholder" style="padding:40px; font-size:11px; text-align:center;"><div class="placeholder-glyph">▓</div><p>NO HEALTH DATA</p><p class="placeholder-sub">Click refresh or wait for auto-poll</p></div>';
    return;
  }
  
  list.innerHTML = providersToShow.map(providerKey => {
    const endpoints = state.healthData[providerKey] || [];
    if (!endpoints.length) return '';
    
    const provider = state.providers.find(p => p.key === providerKey);
    const providerName = provider ? provider.name : providerKey.toUpperCase();
    
    return `
      <div class="health-provider-group">
        <div class="health-provider-header">
          <span class="health-provider-name">${escapeHtml(providerName)}</span>
          <span class="health-provider-count">${endpoints.length} endpoints</span>
        </div>
        ${endpoints.map((ep, idx) => `
          <div class="endpoint-health-item${state.selectedEndpoint === `${providerKey}:${idx}` ? ' selected' : ''}" 
               data-provider="${providerKey}" data-index="${idx}">
            <div class="health-item-header">
              <span class="health-endpoint-index">#${idx + 1}</span>
              <div class="health-status">
                <span class="health-dot ${ep.isAlive ? 'alive' : 'dead'}" title="${ep.isAlive ? 'Alive' : 'Dead'}"></span>
                <span class="health-latency">${ep.avgLatency !== null ? ep.avgLatency + 'ms' : '--'}</span>
              </div>
            </div>
            <div class="health-details">
              <div class="health-detail">
                <span class="health-detail-label">Success Rate</span>
                <span class="health-detail-value">${ep.successRate}%</span>
              </div>
              <div class="health-detail">
                <span class="health-detail-label">Checks</span>
                <span class="health-detail-value">${ep.checks}</span>
              </div>
              <div class="health-detail">
                <span class="health-detail-label">Last Ping</span>
                <span class="health-detail-value">${ep.lastPing ? new Date(ep.lastPing).toLocaleTimeString() : 'never'}</span>
              </div>
              <div class="health-detail">
                <span class="health-detail-label">Endpoint</span>
                <span class="health-detail-value" style="font-family:monospace; font-size:8px;">${escapeHtml(ep.url.slice(0, 60))}...</span>
              </div>
            </div>
            ${ep.lastError ? `<div class="health-error">${escapeHtml(ep.lastError)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
  
  $$('.endpoint-health-item', list).forEach(item => {
    item.onclick = () => {
      $$('.endpoint-health-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      const providerKey = item.dataset.provider;
      const index = parseInt(item.dataset.index, 10);
      state.selectedEndpoint = `${providerKey}:${index}`;
      renderEndpointDetail(providerKey, index);
    };
  });
}

function renderEndpointDetail(providerKey, index) {
  const content = $('#health-detail-content');
  const ep = (state.healthData[providerKey] || [])[index];
  const provider = state.providers.find(p => p.key === providerKey);
  const providerName = provider ? provider.name : providerKey.toUpperCase();
  
  if (!ep) {
    content.innerHTML = '<div class="placeholder" style="padding:20px; font-size:11px;">No data for this endpoint</div>';
    return;
  }
  
  content.innerHTML = `
    <div class="detail-panel">
      <div class="detail-header">
        <span class="detail-provider">${escapeHtml(providerName)}</span>
        <span class="detail-index">Endpoint #${index + 1}</span>
      </div>
      <div class="detail-grid">
        <div class="detail-row">
          <span class="detail-label">Status</span>
          <span class="detail-value ${ep.isAlive ? 'ok' : 'err'}">
            <span class="health-dot ${ep.isAlive ? 'alive' : 'dead'}" style="display:inline-block; margin-right:6px;"></span>
            ${ep.isAlive ? 'ALIVE' : 'DEAD'}
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Average Latency</span>
          <span class="detail-value">${ep.avgLatency !== null ? ep.avgLatency + 'ms' : 'N/A'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Success Rate</span>
          <span class="detail-value">${ep.successRate}%</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Total Checks</span>
          <span class="detail-value">${ep.checks}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Last Check</span>
          <span class="detail-value">${ep.lastPing ? new Date(ep.lastPing).toLocaleString() : 'Never'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Endpoint URL</span>
          <span class="detail-value" style="font-family:monospace; font-size:10px; word-break:break-all;">${escapeHtml(ep.url)}</span>
        </div>
        ${ep.lastError ? `
        <div class="detail-row">
          <span class="detail-label">Last Error</span>
          <span class="detail-value err" style="word-break:break-all;">${escapeHtml(ep.lastError)}</span>
        </div>
        ` : ''}
        <div class="detail-row">
          <span class="detail-label">Error Count</span>
          <span class="detail-value">${ep.errorCount || 0}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">First Check</span>
          <span class="detail-value">${ep.firstCheck ? new Date(ep.firstCheck).toLocaleString() : 'N/A'}</span>
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-primary btn-sm" id="btn-test-single">⚡ TEST THIS ENDPOINT</button>
        <button class="btn btn-ghost btn-sm" id="btn-clear-history">🗑 CLEAR HISTORY</button>
      </div>
    </div>
  `;
  
  $('#btn-test-single')?.addEventListener('click', () => testSingleEndpoint(providerKey, index));
  $('#btn-clear-history')?.addEventListener('click', () => clearEndpointHistory(providerKey, index));
}

function renderHealthSummary() {
  const summary = $('#health-summary');
  let totalEndpoints = 0;
  let aliveEndpoints = 0;
  let providersWithIssues = 0;
  
  Object.entries(state.healthData).forEach(([providerKey, endpoints]) => {
    const providerEndpoints = endpoints.length;
    const providerAlive = endpoints.filter(ep => ep.isAlive).length;
    totalEndpoints += providerEndpoints;
    aliveEndpoints += providerAlive;
    if (providerAlive < providerEndpoints) providersWithIssues++;
  });
  
  const healthPercent = totalEndpoints ? Math.round((aliveEndpoints / totalEndpoints) * 100) : 0;
  
  summary.innerHTML = `
    <div class="summary-grid">
      <div class="summary-card ${healthPercent === 100 ? 'ok' : healthPercent > 50 ? 'warning' : 'err'}">
        <span class="summary-value">${healthPercent}%</span>
        <span class="summary-label">OVERALL HEALTH</span>
      </div>
      <div class="summary-card">
        <span class="summary-value">${totalEndpoints}</span>
        <span class="summary-label">TOTAL ENDPOINTS</span>
      </div>
      <div class="summary-card ok">
        <span class="summary-value">${aliveEndpoints}</span>
        <span class="summary-label">HEALTHY</span>
      </div>
      <div class="summary-card err">
        <span class="summary-value">${totalEndpoints - aliveEndpoints}</span>
        <span class="summary-label">UNHEALTHY</span>
      </div>
      <div class="summary-card warning">
        <span class="summary-value">${providersWithIssues}</span>
        <span class="summary-label">PROVIDERS W/ ISSUES</span>
      </div>
      <div class="summary-card">
        <span class="summary-value">${state.providers.length}</span>
        <span class="summary-label">TOTAL PROVIDERS</span>
      </div>
    </div>
  `;
}

async function testSingleEndpoint(providerKey, index) {
  const provider = state.providers.find(p => p.key === providerKey);
  const endpoints = provider.endpoints || (provider.endpoint ? [provider.endpoint] : []);
  const endpoint = endpoints[index];
  
  if (!endpoint) return showToast('Endpoint not found', 'error');
  
  showToast(`Testing ${providerKey} #${index + 1}...`, 'info');
  
  const testQueries = {
    phone: '9876543210', aadhar: '123456789012', pan: 'ABCDE1234F',
    gst: '29ABCDE1234F1Z5', ifsc: 'UTIB0000001', upi: 'test@oksbi',
    instagram: 'instagram', email: 'test@example.com', imei: '123456789012345',
    vehicle: 'MH12DE1433', vehicle2: 'MH12DE1433', pak: '923001234567',
    ip: '8.8.8.8', pincode: '110001', tower: '9876543210',
    rc_pdf: 'MH12DE1433', leak_osint: 'test@example.com',
    num_to_info: '9876543210', personal_num_info: '9876543210',
    num_to_vehicle: '9876543210', tg: '9876543210',
  };
  
  const query = testQueries[providerKey] || 'test';
  const formattedQuery = provider.format ? provider.format(query) : query;
  const url = endpoint.replace('{q}', encodeURIComponent(formattedQuery));
  
  try {
    const start = Date.now();
    const res = await fetch(url, { method: provider.method || 'GET', headers: { 'User-Agent': 'Matrix-OSINT/1.0' } });
    const latency = Date.now() - start;
    
    if (res.ok) {
      showToast(`Endpoint OK (${latency}ms)`, 'success');
    } else {
      showToast(`Failed: ${res.status}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
  
  setTimeout(fetchEndpointHealth, 500);
}

async function clearEndpointHistory(providerKey, index) {
  if (!confirm('Clear health history for this endpoint?')) return;
  // Could implement an API call to clear history if needed
  showToast('History clear not implemented on server', 'warning');
}

async function testAllEndpointsGlobal() {
  let total = 0;
  state.providers.forEach(p => {
    const eps = p.endpoints || (p.endpoint ? [p.endpoint] : []);
    total += eps.length;
  });
  
  showToast(`Testing ${total} endpoints globally...`, 'info');
  
  for (const provider of state.providers) {
    const endpoints = provider.endpoints || (provider.endpoint ? [provider.endpoint] : []);
    for (let i = 0; i < endpoints.length; i++) {
      await testSingleEndpoint(provider.key, i);
      await new Promise(r => setTimeout(r, 150));
    }
  }
  
  showToast('Global test complete', 'success');
}

function setupEventListeners() {
  $('#provider-filter').addEventListener('input', renderProviderList);
  $('#health-filter').addEventListener('change', renderHealthPanel);
  $('#btn-refresh-health').addEventListener('click', fetchEndpointHealth);
  $('#btn-test-all-global').addEventListener('click', testAllEndpointsGlobal);
}

async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  MASTER_KEY = urlParams.get('key') || localStorage.getItem('matrix_osint_key') || '';
  
  if (!MASTER_KEY) {
    const key = prompt('Enter Master Key:');
    if (key) {
      MASTER_KEY = key;
      localStorage.setItem('matrix_osint_key', key);
    }
  }
  
  document.querySelectorAll('[id]').forEach(el => {
    elements[el.id] = el;
  });
  
  initMatrixRain();
  setupEventListeners();
  updateClock();
  setInterval(updateClock, 1000);
  
  fetchProviders();
  fetchSystemStats();
  fetchEndpointHealth();
  setInterval(fetchSystemStats, 30000);
  setInterval(fetchEndpointHealth, 60000);
  setInterval(renderHealthSummary, 10000);
  
  console.log('%c MATRIX OSINT HEALTH INITIALIZED ', 'background:#00ff41; color:#000; font-family:monospace; padding:4px 8px;');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}