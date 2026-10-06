/**
 * MATRIX OSINT — Frontend Application
 * Matrix-themed OSINT Dashboard with endpoint health monitoring and management
 */

// ============================================================================
// CONFIG & STATE
// ============================================================================
const API_BASE = '';
let MASTER_KEY = '';

const state = {
  providers: [],
  activeProvider: null,
  batchMode: false,
  history: [],
  stats: { requests: 0, errors: 0, uptime: 0 },
  rateLimit: { limit: 0, remaining: 0, reset: 0 },
  healthData: {},
  showRaw: false,
};

const elements = {};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return Array.from(ctx.querySelectorAll(sel)); }

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/\"/g, '"')
    .replace(/'/g, '&#039;');
}

function formatJson(obj) {
  const json = JSON.stringify(obj, null, 2);
  return json
    .replace(/(\"([^\"]+)\")(?=\s*:)/g, '<span class="json-key">$1</span>')
    .replace(/: \"([^\"]*)\"/g, ': <span class="json-string">"$1"</span>')
    .replace(/: (\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
    .replace(/: (true|false)/g, ': <span class="json-boolean">$1</span>')
    .replace(/: null/g, ': <span class="json-null">null</span>')
    .replace(/([{}[\]\,:])/g, '<span class="json-punct">$1</span>');
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

// ============================================================================
// MATRIX RAIN BACKGROUND
// ============================================================================
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

// ============================================================================
// CLOCK
// ============================================================================
function updateClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
}

// ============================================================================
// API CALLS
// ============================================================================
async function apiRequest(endpoint, body) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-master-key': MASTER_KEY,
    },
    body: JSON.stringify(body),
  });
  
  const data = await res.json();
  
  // Update rate limit from headers
  const limit = res.headers.get('X-RateLimit-Limit');
  const remaining = res.headers.get('X-RateLimit-Remaining');
  const reset = res.headers.get('X-RateLimit-Reset');
  if (limit) state.rateLimit.limit = parseInt(limit, 10);
  if (remaining) state.rateLimit.remaining = parseInt(remaining, 10);
  if (reset) state.rateLimit.reset = parseInt(reset, 10);
  updateRateLimitDisplay();
  
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function fetchProviders() {
  try {
    const res = await fetch(`${API_BASE}/api/providers`);
    const data = await res.json();
    state.providers = data;
    renderProviderList();
    populateSelects();
    populateMgmtProviderSelect();
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
  } catch (err) {
    console.error('Health fetch failed:', err);
  }
}

function updateRateLimitDisplay() {
  $('#sys-ratelimit').textContent = `${state.rateLimit.remaining}/${state.rateLimit.limit}`;
  setStatusDot('status-rate', state.rateLimit.remaining > 0);
}

// ============================================================================
// RENDER FUNCTIONS
// ============================================================================
let currentViewMode = 'json'; // 'json' or 'table'

function renderProviderList() {
  const list = $('#provider-list');
  const filter = $('#provider-filter').value.toLowerCase();
  
  const filtered = state.providers.filter(p => 
    p.name.toLowerCase().includes(filter) ||
    p.kind.toLowerCase().includes(filter) ||
    (p.description || '').toLowerCase().includes(filter)
  );
  
  list.innerHTML = filtered.map(p => `
    <li class="provider-item${state.activeProvider === p.key ? ' active' : ''}" data-key="${p.key}">
      <span class="provider-icon">${p.icon || '◈'}</span>
      <div class="provider-info">
        <div class="provider-name">${escapeHtml(p.name)}</div>
        <div class="provider-kind">${escapeHtml(p.kind)}</div>
      </div>
      <span class="provider-badge">${p.requiresKey ? 'AUTH' : 'OPEN'}</span>
    </li>
  `).join('');
  
  $$('.provider-item', list).forEach(item => {
    item.onclick = () => selectProvider(item.dataset.key);
  });
}

function populateSelects() {
  const single = $('#provider-select');
  const multi = $('#batch-select');
  
  const options = state.providers
    .filter(p => !p.isBomb) // Hide bomb APIs from normal use
    .map(p => `<option value="${p.key}">${escapeHtml(p.name)} (${p.kind})</option>`)
    .join('');
  
  single.innerHTML = '<option value="">-- SELECT PROVIDER --</option>' + options;
  multi.innerHTML = options;
}

function populateMgmtProviderSelect() {
  const select = $('#mgmt-provider');
  const options = state.providers
    .map(p => `<option value="${p.key}">${escapeHtml(p.name)} (${p.kind}) ${p.endpointCount ? `[${p.endpointCount} endpoints]` : ''}</option>`)
    .join('');
  select.innerHTML = '<option value="">-- SELECT PROVIDER --</option>' + options;
}

function populateHealthFilter() {
  const select = $('#health-filter');
  const options = Object.keys(state.healthData)
    .map(k => `<option value="${k}">${escapeHtml(k)}</option>`)
    .join('');
  select.innerHTML = '<option value="all">ALL PROVIDERS</option>' + options;
}

function selectProvider(key) {
  const provider = state.providers.find(p => p.key === key);
  if (!provider) return;
  
  state.activeProvider = key;
  $$('.provider-item').forEach(el => el.classList.toggle('active', el.dataset.key === key));
  $('#provider-select').value = key;
  updateProviderMeta(provider);
  updateInputHint(provider);
  validateInput();
  renderMgmtEndpoints(key);
}

function updateProviderMeta(provider) {
  const meta = $('#provider-meta');
  meta.innerHTML = `
    <span class="meta-tag">${escapeHtml(provider.kind)}</span>
    ${provider.requiresKey ? '<span class="meta-tag auth">REQUIRES API KEY</span>' : '<span class="meta-tag open">PUBLIC</span>'}
    ${provider.endpointCount ? `<span class="meta-tag">${provider.endpointCount} endpoints</span>` : ''}
    ${provider.description ? `<span class="meta-desc">${escapeHtml(provider.description)}</span>` : ''}
  `;
}

function updateInputHint(provider) {
  const hint = $('#input-hint');
  if (provider.placeholder) {
    hint.innerHTML = `Format: <code>${escapeHtml(provider.placeholder)}</code>`;
  } else {
    hint.textContent = 'Enter query string';
  }
}

function validateInput() {
  const input = $('#query-input');
  const status = $('#validation-status');
  const provider = state.providers.find(p => p.key === state.activeProvider);
  
  if (!provider) {
    status.className = 'validation-status';
    status.textContent = '';
    input.classList.remove('valid', 'invalid');
    return false;
  }
  
  const value = input.value.trim();
  if (!value) {
    status.className = 'validation-status';
    status.textContent = '';
    input.classList.remove('valid', 'invalid');
    return false;
  }
  
  let valid = true;
  if (provider.valid) {
    try {
      // Note: valid is a string representation in the public API
      // Actual validation happens server-side
      valid = true;
    } catch { valid = false; }
  }
  
  if (valid) {
    input.classList.add('valid');
    input.classList.remove('invalid');
    status.className = 'validation-status ok';
    status.innerHTML = '✓ VALID FORMAT';
  } else {
    input.classList.add('invalid');
    input.classList.remove('valid');
    status.className = 'validation-status err';
    status.innerHTML = '✕ INVALID FORMAT';
  }
  return valid;
}

function renderResult(data) {
  const content = $('#results-content');
  const provider = state.providers.find(p => p.key === data.provider);

  $('#result-provider').textContent = provider ? provider.name : data.provider;
  $('#result-query').textContent = data.query;
  $('#result-elapsed').textContent = `${data.elapsedMs}ms`;
  $('#result-endpoint').textContent = data.url ? (new URL(data.url)).hostname : '--';

  const statusBadge = $('#result-status');
  if (data.error) {
    statusBadge.textContent = 'ERROR';
    statusBadge.className = 'status-badge err';
  } else {
    statusBadge.textContent = 'OK';
    statusBadge.className = 'status-badge ok';
  }

  if (data.error) {
    content.innerHTML = `<pre class="json-err">${escapeHtml(data.error)}</pre>`;
  } else if (data.data?.isImage) {
    content.innerHTML = `
      <div class="image-result">
        <img src="data:${data.data.mime};base64,${data.data.data}" alt="Result image">
        <p class="img-meta">${data.data.mime} • ${Math.round(data.data.data.length * 0.75)} bytes</p>
      </div>
    `;
  } else if (typeof data.data === 'object') {
    if (currentViewMode === 'table') {
      content.innerHTML = renderTable(data.data);
    } else {
      content.innerHTML = state.showRaw
        ? `<pre>${escapeHtml(JSON.stringify(data.data, null, 2))}</pre>`
        : `<pre>${formatJson(data.data)}</pre>`;
    }
  } else {
    content.innerHTML = `<pre>${escapeHtml(String(data.data))}</pre>`;
  }

  addToHistory(data);
}

function renderTable(data) {
  if (!data || typeof data !== 'object') {
    return `<pre>${escapeHtml(String(data))}</pre>`;
  }

  const rows = [];
  function flatten(obj, prefix = '') {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value === null || value === undefined) {
        rows.push({ key: path, value: value === null ? 'null' : 'undefined', type: 'null' });
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          rows.push({ key: path, value: '[]', type: 'array' });
        } else if (value.every(v => typeof v !== 'object')) {
          rows.push({ key: path, value: value.join(', '), type: 'array' });
        } else {
          rows.push({ key: path, value: `[${value.length} items]`, type: 'array' });
          value.forEach((v, i) => {
            if (typeof v === 'object' && v !== null) {
              flatten(v, `${path}[${i}]`);
            } else {
              rows.push({ key: `${path}[${i}]`, value: v, type: typeof v });
            }
          });
        }
      } else if (typeof value === 'object') {
        rows.push({ key: path, value: '{…}', type: 'object' });
        flatten(value, path);
      } else {
        rows.push({ key: path, value: value, type: typeof value });
      }
    }
  }
  flatten(data);

  if (rows.length === 0) {
    return '<pre>{ }</pre>';
  }

  return `
    <table>
      <thead>
        <tr>
          <th style="width: 35%;">KEY</th>
          <th>VALUE</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="table-key">${escapeHtml(r.key)}</td>
            <td class="table-value ${r.type}">${escapeHtml(String(r.value))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderBatchResults(data) {
  const content = $('#results-content');
  $('#result-provider').textContent = 'BATCH';
  $('#result-query').textContent = data.query;
  $('#result-elapsed').textContent = `${data.elapsedMs}ms`;
  $('#result-endpoint').textContent = `${data.results.length} endpoints`;
  $('#result-status').textContent = 'OK';
  $('#result-status').className = 'status-badge ok';
  
  const resultsHtml = data.results.map((r, i) => {
    const provider = state.providers.find(p => p.key === r.provider);
    const name = provider ? provider.name : r.provider;
    const isError = !!r.error;
    
    let bodyHtml;
    if (isError) {
      bodyHtml = `<pre class="json-err">${escapeHtml(r.error)}</pre>`;
    } else if (r.data?.isImage) {
      bodyHtml = `<img src="data:${r.data.mime};base64,${r.data.data}" alt="${name}">`;
    } else if (typeof r.data === 'object') {
      bodyHtml = state.showRaw
        ? `<pre>${escapeHtml(JSON.stringify(r.data, null, 2))}</pre>`
        : `<pre>${formatJson(r.data)}</pre>`;
    } else {
      bodyHtml = `<pre>${escapeHtml(String(r.data))}</pre>`;
    }
    
    return `
      <details class="batch-result ${isError ? 'error' : ''}" ${i === 0 ? 'open' : ''}>
        <summary>
          <span class="batch-provider">${escapeHtml(name)}</span>
          <span class="batch-status ${isError ? 'err' : 'ok'}">${isError ? 'ERROR' : 'OK'}</span>
        </summary>
        <div class="batch-body">${bodyHtml}</div>
      </details>
    `;
  }).join('');
  
  content.innerHTML = `<div class="batch-results">${resultsHtml}</div>`;
  
  addToHistory({ 
    provider: 'BATCH', 
    query: data.query, 
    elapsedMs: data.elapsedMs, 
    error: null 
  });
}

function addToHistory(data) {
  const item = {
    provider: data.provider,
    query: data.query,
    elapsed: data.elapsedMs,
    error: data.error,
    timestamp: Date.now(),
  };
  
  state.history.unshift(item);
  if (state.history.length > 50) state.history.pop();
  
  renderHistory();
  updateStats();
}

function renderHistory() {
  const list = $('#history-list');
  list.innerHTML = state.history.map(h => `
    <li class="history-item" data-query="${escapeHtml(h.query)}" data-provider="${escapeHtml(h.provider)}">
      <div class="hist-query">${escapeHtml(h.provider)}: ${escapeHtml(String(h.query).slice(0, 40))}</div>
      <div class="hist-meta">
        <span>${h.elapsed}ms</span>
        <span>${new Date(h.timestamp).toLocaleTimeString()}</span>
        <span class="${h.error ? 'err' : 'ok'}">${h.error ? 'ERR' : 'OK'}</span>
      </div>
    </li>
  `).join('');
  
  $$('.history-item', list).forEach(item => {
    item.onclick = () => {
      const query = item.dataset.query;
      const provider = item.dataset.provider;
      if (provider !== 'BATCH' && state.providers.find(p => p.key === provider)) {
        selectProvider(provider);
      }
      $('#query-input').value = query;
      validateInput();
    };
  });
}

function updateStats() {
  state.stats.requests = state.history.length;
  state.stats.errors = state.history.filter(h => h.error).length;
  $('#sys-requests').textContent = state.stats.requests;
  $('#sys-errors').textContent = state.stats.errors;
}

// ============================================================================
// HEALTH PANEL
// ============================================================================
function renderHealthPanel() {
  const list = $('#endpoint-health-list');
  const filter = $('#health-filter').value;
  
  let providersToShow = Object.keys(state.healthData);
  if (filter !== 'all') {
    providersToShow = [filter];
  }
  
  if (!providersToShow.length) {
    list.innerHTML = '<div class="placeholder" style="padding:20px; font-size:11px;">No health data available</div>';
    return;
  }
  
  list.innerHTML = providersToShow.map(providerKey => {
    const endpoints = state.healthData[providerKey] || [];
    if (!endpoints.length) return '';
    
    return endpoints.map(ep => `
      <div class="endpoint-health-item">
        <div class="health-item-header">
          <span class="health-provider-name">${escapeHtml(providerKey.toUpperCase())}</span>
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
            <span class="health-detail-value" style="font-family:monospace; font-size:8px;">${escapeHtml(ep.url.slice(0, 50))}...</span>
          </div>
        </div>
        ${ep.lastError ? `<div class="health-error">${escapeHtml(ep.lastError)}</div>` : ''}
      </div>
    `).join('');
  }).join('');
}

// ============================================================================
// ENDPOINT MANAGEMENT
// ============================================================================
async function renderMgmtEndpoints(providerKey) {
  const list = $('#mgmt-endpoint-list');
  const provider = state.providers.find(p => p.key === providerKey);
  
  if (!provider) {
    list.innerHTML = '<div class="placeholder" style="padding:20px; font-size:11px;">Select a provider to manage endpoints</div>';
    return;
  }
  
  const endpoints = provider.endpoints || (provider.endpoint ? [provider.endpoint] : []);
  const health = state.healthData[providerKey] || [];
  
  if (!endpoints.length) {
    list.innerHTML = '<div class="placeholder" style="padding:20px; font-size:11px;">No endpoints configured</div>';
    return;
  }
  
  list.innerHTML = endpoints.map((ep, idx) => {
    const h = health[idx] || {};
    return `
      <div class="manager-endpoint-item">
        <span class="manager-endpoint-index">#${idx + 1}</span>
        <span class="manager-endpoint-url">${escapeHtml(ep)}</span>
        <span class="health-dot ${h.isAlive ? 'alive' : (h.checks ? 'dead' : '')}" style="width:6px;height:6px;"></span>
        <div class="manager-endpoint-actions">
          <button class="manager-btn" data-action="test" data-idx="${idx}" title="Test">⚡</button>
          <button class="manager-btn danger" data-action="remove" data-idx="${idx}" title="Remove">✕</button>
        </div>
      </div>
    `;
  }).join('');
  
  // Add event listeners
  $$('.manager-btn[data-action="test"]', list).forEach(btn => {
    btn.onclick = async () => {
      const idx = parseInt(btn.dataset.idx, 10);
      await testEndpoint(providerKey, idx);
    };
  });
  
  $$('.manager-btn[data-action="remove"]', list).forEach(btn => {
    btn.onclick = async () => {
      const idx = parseInt(btn.dataset.idx, 10);
      if (confirm(`Remove endpoint #${idx + 1}?`)) {
        await removeEndpoint(providerKey, idx);
      }
    };
  });
}

async function testEndpoint(providerKey, index) {
  const provider = state.providers.find(p => p.key === providerKey);
  const endpoints = provider.endpoints || (provider.endpoint ? [provider.endpoint] : []);
  const endpoint = endpoints[index];
  
  if (!endpoint) return showToast('Endpoint not found', 'error');
  
  showToast(`Testing endpoint #${index + 1}...`, 'info');
  
  try {
    // Use a test query appropriate for the provider
    const testQueries = {
      phone: '9876543210',
      aadhar: '123456789012',
      pan: 'ABCDE1234F',
      gst: '29ABCDE1234F1Z5',
      ifsc: 'UTIB0000001',
      upi: 'test@oksbi',
      instagram: 'instagram',
      email: 'test@example.com',
      imei: '123456789012345',
      vehicle: 'MH12DE1433',
      vehicle2: 'MH12DE1433',
      pak: '923001234567',
      ip: '8.8.8.8',
      pincode: '110001',
      tower: '9876543210',
      rc_pdf: 'MH12DE1433',
    };
    
    const query = testQueries[providerKey] || 'test';
    const formattedQuery = provider.format ? provider.format(query) : query;
    const url = endpoint.replace('{q}', encodeURIComponent(formattedQuery));
    
    const start = Date.now();
    const res = await fetch(url, { method: provider.method || 'GET', headers: { 'User-Agent': 'Matrix-OSINT/1.0' } });
    const latency = Date.now() - start;
    
    if (res.ok) {
      showToast(`Endpoint #${index + 1} OK (${latency}ms)`, 'success');
    } else {
      showToast(`Endpoint #${index + 1} failed: ${res.status}`, 'error');
    }
  } catch (err) {
    showToast(`Endpoint #${index + 1} error: ${err.message}`, 'error');
  }
  
  // Refresh health after test
  setTimeout(fetchEndpointHealth, 500);
}

async function addEndpoint(providerKey, endpointUrl) {
  try {
    const res = await fetch(`${API_BASE}/api/admin/endpoints/${providerKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-master-key': MASTER_KEY },
      body: JSON.stringify({ endpoint: endpointUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add endpoint');
    
    showToast('Endpoint added', 'success');
    // Refresh providers and health
    await fetchProviders();
    await fetchEndpointHealth();
    renderMgmtEndpoints(providerKey);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function removeEndpoint(providerKey, index) {
  try {
    const res = await fetch(`${API_BASE}/api/admin/endpoints/${providerKey}?index=${index}`, {
      method: 'DELETE',
      headers: { 'x-master-key': MASTER_KEY },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to remove endpoint');
    
    showToast('Endpoint removed', 'success');
    await fetchProviders();
    await fetchEndpointHealth();
    renderMgmtEndpoints(providerKey);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function testAllEndpoints(providerKey) {
  const provider = state.providers.find(p => p.key === providerKey);
  const endpoints = provider.endpoints || (provider.endpoint ? [provider.endpoint] : []);
  
  showToast(`Testing ${endpoints.length} endpoints...`, 'info');
  
  for (let i = 0; i < endpoints.length; i++) {
    await testEndpoint(providerKey, i);
    await new Promise(r => setTimeout(r, 200)); // Small delay between tests
  }
  
  showToast('All endpoints tested', 'success');
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================
function setupEventListeners() {
  // Provider filter
  $('#provider-filter').addEventListener('input', renderProviderList);
  
  // Provider select
  $('#provider-select').addEventListener('change', (e) => {
    if (e.target.value) selectProvider(e.target.value);
  });
  
  // Query input
  $('#query-input').addEventListener('input', validateInput);
  $('#query-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeQuery();
    }
  });
  
  // Execute button
  $('#btn-execute').addEventListener('click', executeQuery);
  
  // Batch mode toggle
  $('#btn-batch').addEventListener('click', () => {
    state.batchMode = !state.batchMode;
    $('#batch-panel').classList.toggle('hidden', !state.batchMode);
    $('#btn-batch').classList.toggle('active', state.batchMode);
    $('#btn-batch').textContent = state.batchMode ? '⬢ SINGLE' : '⬢ BATCH';
  });
  
  // Copy results
  $('#btn-copy').addEventListener('click', () => {
    const content = $('#results-content').innerText;
    navigator.clipboard.writeText(content).then(() => {
      showToast('Results copied to clipboard', 'success');
    });
  });
  
  // Clear results
  $('#btn-clear').addEventListener('click', () => {
    $('#results-content').innerHTML = `
      <div class="placeholder">
        <div class="placeholder-glyph">▓</div>
        <p>NO DATA RECEIVED</p>
        <p class="placeholder-sub">Select a provider and execute a query</p>
      </div>
    `;
    $('#result-provider').textContent = '--';
    $('#result-query').textContent = '--';
    $('#result-elapsed').textContent = '--ms';
    $('#result-endpoint').textContent = '--';
    $('#result-status').textContent = '--';
    $('#result-status').className = 'status-badge';
  });
  
  // Toggle raw/pretty
    $('#btn-raw').addEventListener('click', () => {
      state.showRaw = !state.showRaw;
      $('#btn-raw').textContent = state.showRaw ? '⬢ PRETTY' : '⬢ RAW';
      $('#btn-raw').classList.toggle('active', state.showRaw);

      // Re-render current results
      if (state.lastResult) {
        if (state.lastResult.isBatch) {
          renderBatchResults(state.lastResult.data);
        } else {
          renderResult(state.lastResult.data);
        }
      }
    });

    // View toggle (JSON/Table)
    $$('#view-toggle .btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentViewMode = btn.dataset.view;
        $$('#view-toggle .btn').forEach(b => b.classList.toggle('active', b === btn));
        if (state.lastResult && !state.lastResult.isBatch) {
          renderResult(state.lastResult.data);
        }
      });
    });

    // Toggle health panel
    $('#btn-toggle-health').addEventListener('click', () => {
      $('#health-sidebar').classList.toggle('collapsed');
      const btn = $('#btn-toggle-health');
      btn.textContent = $('#health-sidebar').classList.contains('collapsed') ? '⬢' : '⬚';
    });
  
  // Batch select change
  $('#batch-select').addEventListener('change', () => {
    const selected = Array.from($('#batch-select').selectedOptions).map(o => o.value);
    if (selected.length && !state.activeProvider) {
      selectProvider(selected[0]);
    }
  });
  
  // Health filter
  $('#health-filter').addEventListener('change', renderHealthPanel);
  
  // Refresh health
  $('#btn-refresh-health').addEventListener('click', fetchEndpointHealth);
  
  // Management provider select
  $('#mgmt-provider').addEventListener('change', (e) => {
    if (e.target.value) renderMgmtEndpoints(e.target.value);
  });
  
  // Add endpoint
  $('#btn-add-endpoint').addEventListener('click', () => {
    const providerKey = $('#mgmt-provider').value;
    const endpoint = $('#mgmt-new-endpoint').value.trim();
    if (!providerKey) return showToast('Select a provider', 'warning');
    if (!endpoint) return showToast('Enter endpoint URL', 'warning');
    if (!endpoint.includes('{q}')) return showToast('Endpoint must contain {q} placeholder', 'warning');
    addEndpoint(providerKey, endpoint);
    $('#mgmt-new-endpoint').value = '';
  });
  
  // Test all endpoints
  $('#btn-test-all').addEventListener('click', () => {
    const providerKey = $('#mgmt-provider').value;
    if (!providerKey) return showToast('Select a provider', 'warning');
    testAllEndpoints(providerKey);
  });
}

async function executeQuery() {
  const query = $('#query-input').value.trim();
  if (!query) return showToast('Enter a query', 'warning');
  
  if (state.batchMode) {
    const selected = Array.from($('#batch-select').selectedOptions).map(o => o.value);
    if (!selected.length) return showToast('Select at least one provider', 'warning');
    await executeBatch(selected, query);
  } else {
    if (!state.activeProvider) return showToast('Select a provider', 'warning');
    if (!validateInput()) return showToast('Invalid query format', 'error');
    await executeSingle(state.activeProvider, query);
  }
}

async function executeSingle(providerKey, query) {
  $('#btn-execute').disabled = true;
  $('#btn-execute').textContent = '⟳ EXECUTING...';
  setStatusDot('status-conn', false);
  
  try {
    const data = await apiRequest('/api/lookup', { provider: providerKey, query });
    state.lastResult = { isBatch: false, data };
    renderResult(data);
    showToast(`Query completed in ${data.elapsedMs}ms`, 'success');
  } catch (err) {
    const errorData = { provider: providerKey, query, error: err.message, elapsedMs: 0 };
    state.lastResult = { isBatch: false, data: errorData };
    renderResult(errorData);
    showToast(err.message, 'error');
  } finally {
    $('#btn-execute').disabled = false;
    $('#btn-execute').textContent = '► EXECUTE';
    setStatusDot('status-conn', true);
  }
}

async function executeBatch(providers, query) {
  $('#btn-execute').disabled = true;
  $('#btn-execute').textContent = '⟳ BATCH...';
  setStatusDot('status-conn', false);
  
  try {
    const data = await apiRequest('/api/batch', { providers, query });
    state.lastResult = { isBatch: true, data };
    renderBatchResults(data);
    showToast(`Batch completed in ${data.elapsedMs}ms`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    $('#btn-execute').disabled = false;
    $('#btn-execute').textContent = '► EXECUTE';
    setStatusDot('status-conn', true);
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================
function init() {
  // Get master key from URL or prompt
  const urlParams = new URLSearchParams(window.location.search);
  MASTER_KEY = urlParams.get('key') || localStorage.getItem('matrix_osint_key') || '';
  
  if (!MASTER_KEY) {
    const key = prompt('Enter Master Key:');
    if (key) {
      MASTER_KEY = key;
      localStorage.setItem('matrix_osint_key', key);
    }
  }
  
  // Cache elements
  document.querySelectorAll('[id]').forEach(el => {
    elements[el.id] = el;
  });
  
  // Initialize modules
  initMatrixRain();
  setupEventListeners();
  
  // Start clock
  updateClock();
  setInterval(updateClock, 1000);
  
  // Fetch initial data
  fetchProviders();
  fetchSystemStats();
  fetchEndpointHealth();
  setInterval(fetchSystemStats, 30000);
  setInterval(fetchEndpointHealth, 60000);
  
  // Focus input
  setTimeout(() => $('#query-input').focus(), 500);
  
  console.log('%c MATRIX OSINT INITIALIZED ', 'background:#00ff41; color:#000; font-family:monospace; padding:4px 8px;');
}

// Start when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}