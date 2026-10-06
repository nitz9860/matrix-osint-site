/**
 * MATRIX OSINT — Endpoint Management Page
 * Runtime endpoint add/remove/reorder/test
 */

const API_BASE = '';
let MASTER_KEY = '';

const state = {
  providers: [],
  healthData: {},
  stats: { requests: 0, errors: 0, uptime: 0 },
  rateLimit: { limit: 0, remaining: 0, reset: 0 },
  activeMgmtProvider: null,
  testResults: [],
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
    renderMgmtHealthSidebar();
  } catch (err) {
    console.error('Health fetch failed:', err);
  }
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
    <li class="provider-item${state.activeMgmtProvider === p.key ? ' active' : ''}" data-key="${p.key}">
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
      state.activeMgmtProvider = item.dataset.key;
      $$('.provider-item', list).forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      $('#mgmt-provider').value = state.activeMgmtProvider;
      renderMgmtEndpoints(state.activeMgmtProvider);
      renderMgmtHealthSidebar();
      renderMgmtProviderInfo(state.activeMgmtProvider);
    };
  });
}

function populateMgmtProviderSelect() {
  const select = $('#mgmt-provider');
  const options = state.providers
    .map(p => `<option value="${p.key}">${escapeHtml(p.name)} (${p.kind}) ${p.endpointCount ? `[${p.endpointCount}]` : ''}</option>`)
    .join('');
  select.innerHTML = '<option value="">-- SELECT PROVIDER --</option>' + options;
}

async function renderMgmtEndpoints(providerKey) {
  const list = $('#mgmt-endpoint-list');
  const provider = state.providers.find(p => p.key === providerKey);
  const countEl = $('#mgmt-endpoint-count');
  
  if (!provider) {
    list.innerHTML = '<div class="placeholder" style="padding:20px; font-size:11px;">Select a provider to manage endpoints</div>';
    countEl.textContent = '0';
    return;
  }
  
  const endpoints = provider.endpoints || (provider.endpoint ? [provider.endpoint] : []);
  const health = state.healthData[providerKey] || [];
  
  countEl.textContent = endpoints.length;
  
  if (!endpoints.length) {
    list.innerHTML = '<div class="placeholder" style="padding:20px; font-size:11px;">No endpoints configured</div>';
    return;
  }
  
  list.innerHTML = endpoints.map((ep, idx) => {
    const h = health[idx] || {};
    return `
      <div class="manager-endpoint-item" draggable="true" data-index="${idx}">
        <span class="manager-endpoint-index">#${idx + 1}</span>
        <span class="manager-endpoint-url">${escapeHtml(ep)}</span>
        <span class="health-dot ${h.isAlive ? 'alive' : (h.checks ? 'dead' : '')}" style="width:6px;height:6px;" title="${h.isAlive ? 'Alive' : h.checks ? 'Dead' : 'Unknown'}"></span>
        <div class="manager-endpoint-actions">
          <button class="manager-btn" data-action="test" data-idx="${idx}" title="Test">⚡</button>
          <button class="manager-btn" data-action="move-up" data-idx="${idx}" title="Move Up" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button class="manager-btn" data-action="move-down" data-idx="${idx}" title="Move Down" ${idx === endpoints.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="manager-btn danger" data-action="remove" data-idx="${idx}" title="Remove">✕</button>
        </div>
      </div>
    `;
  }).join('');
  
  // Add drag and drop for reordering
  setupDragAndDrop(list, providerKey);
  
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
  
  $$('.manager-btn[data-action="move-up"]', list).forEach(btn => {
    btn.onclick = async () => {
      const idx = parseInt(btn.dataset.idx, 10);
      await moveEndpoint(providerKey, idx, idx - 1);
    };
  });
  
  $$('.manager-btn[data-action="move-down"]', list).forEach(btn => {
    btn.onclick = async () => {
      const idx = parseInt(btn.dataset.idx, 10);
      await moveEndpoint(providerKey, idx, idx + 1);
    };
  });
}

function setupDragAndDrop(list, providerKey) {
  let draggedItem = null;
  
  $$('.manager-endpoint-item', list).forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedItem = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      draggedItem = null;
    });
    
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const afterElement = getDragAfterElement(list, e.clientY);
      if (afterElement == null) {
        list.appendChild(draggedItem);
      } else {
        list.insertBefore(draggedItem, afterElement);
      }
    });
    
    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!draggedItem) return;
      
      const items = $$('.manager-endpoint-item', list);
      const fromIdx = parseInt(draggedItem.dataset.index, 10);
      const toIdx = items.indexOf(draggedItem);
      
      if (fromIdx !== toIdx) {
        await moveEndpoint(providerKey, fromIdx, toIdx);
      }
    });
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = $$('.manager-endpoint-item:not(.dragging)', container);
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

async function moveEndpoint(providerKey, fromIdx, toIdx) {
  if (fromIdx < 0 || toIdx < 0) return;
  
  try {
    const res = await fetch(`${API_BASE}/api/admin/endpoints/${providerKey}/reorder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-master-key': MASTER_KEY },
      body: JSON.stringify({ from: fromIdx, to: toIdx }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to reorder');
    
    showToast('Endpoint reordered', 'success');
    await fetchProviders();
    await fetchEndpointHealth();
    renderMgmtEndpoints(providerKey);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function testEndpoint(providerKey, index) {
  const provider = state.providers.find(p => p.key === providerKey);
  const endpoints = provider.endpoints || (provider.endpoint ? [provider.endpoint] : []);
  const endpoint = endpoints[index];
  
  if (!endpoint) return showToast('Endpoint not found', 'error');
  
  showToast(`Testing endpoint #${index + 1}...`, 'info');
  
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
    
    const result = {
      index: index + 1,
      endpoint: endpoint.slice(0, 60) + '...',
      status: res.ok ? 'OK' : `HTTP ${res.status}`,
      latency: `${latency}ms`,
      ok: res.ok,
    };
    
    state.testResults.unshift(result);
    if (state.testResults.length > 20) state.testResults.pop();
    renderTestResults();
    
    if (res.ok) {
      showToast(`Endpoint #${index + 1} OK (${latency}ms)`, 'success');
    } else {
      showToast(`Endpoint #${index + 1} failed: ${res.status}`, 'error');
    }
  } catch (err) {
    const result = {
      index: index + 1,
      endpoint: endpoint.slice(0, 60) + '...',
      status: `ERROR: ${err.message}`,
      latency: '--',
      ok: false,
    };
    state.testResults.unshift(result);
    if (state.testResults.length > 20) state.testResults.pop();
    renderTestResults();
    
    showToast(`Endpoint #${index + 1} error: ${err.message}`, 'error');
  }
  
  setTimeout(fetchEndpointHealth, 500);
}

function renderTestResults() {
  const container = $('#test-results');
  if (!state.testResults.length) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = `
    <div class="test-results-header">RECENT TESTS <span class="test-count">${state.testResults.length}</span></div>
    <div class="test-results-list">
      ${state.testResults.map(r => `
        <div class="test-result-item ${r.ok ? 'ok' : 'err'}">
          <span class="test-index">#${r.index}</span>
          <span class="test-endpoint">${escapeHtml(r.endpoint)}</span>
          <span class="test-status">${escapeHtml(r.status)}</span>
          <span class="test-latency">${r.latency}</span>
        </div>
      `).join('')}
    </div>
  `;
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
  
  if (!endpoints.length) return showToast('No endpoints to test', 'warning');
  
  showToast(`Testing ${endpoints.length} endpoints...`, 'info');
  state.testResults = [];
  renderTestResults();
  
  for (let i = 0; i < endpoints.length; i++) {
    await testEndpoint(providerKey, i);
    await new Promise(r => setTimeout(r, 200));
  }
  
  showToast('All endpoints tested', 'success');
}

function renderMgmtHealthSidebar() {
  const content = $('#mgmt-health-content');
  const providerKey = state.activeMgmtProvider;
  
  if (!providerKey) {
    content.innerHTML = '<div class="placeholder" style="padding:20px; font-size:11px;"><div class="placeholder-glyph">▓</div><p>SELECT A PROVIDER</p><p class="placeholder-sub">Health data will appear here</p></div>';
    return;
  }
  
  const endpoints = state.healthData[providerKey] || [];
  const provider = state.providers.find(p => p.key === providerKey);
  
  if (!endpoints.length) {
    content.innerHTML = '<div class="placeholder" style="padding:20px; font-size:11px;">No health data for this provider</div>';
    return;
  }
  
  let alive = 0, dead = 0, totalChecks = 0, totalErrors = 0;
  endpoints.forEach(ep => {
    totalChecks += ep.checks || 0;
    if (ep.isAlive) alive++; else dead++;
    if (ep.lastError) totalErrors++;
  });
  
  content.innerHTML = `
    <div class="health-summary-mini">
      <div class="summary-row">
        <span class="summary-label">Endpoints</span>
        <span class="summary-value">${endpoints.length}</span>
      </div>
      <div class="summary-row ok">
        <span class="summary-label">Alive</span>
        <span class="summary-value">${alive}</span>
      </div>
      <div class="summary-row err">
        <span class="summary-label">Dead</span>
        <span class="summary-value">${dead}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Total Checks</span>
        <span class="summary-value">${totalChecks}</span>
      </div>
      <div class="summary-row err">
        <span class="summary-label">Errors</span>
        <span class="summary-value">${totalErrors}</span>
      </div>
    </div>
    <div class="health-list-mini">
      ${endpoints.map((ep, idx) => `
        <div class="health-mini-item">
          <span class="health-mini-index">#${idx + 1}</span>
          <span class="health-mini-status">
            <span class="health-dot ${ep.isAlive ? 'alive' : 'dead'}" style="width:6px;height:6px;"></span>
            ${ep.isAlive ? 'UP' : 'DOWN'}
          </span>
          <span class="health-mini-latency">${ep.avgLatency !== null ? ep.avgLatency + 'ms' : '--'}</span>
          <span class="health-mini-rate">${ep.successRate}%</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderMgmtProviderInfo(providerKey) {
  const content = $('#mgmt-provider-info');
  const provider = state.providers.find(p => p.key === providerKey);
  
  if (!provider) {
    content.innerHTML = '<div class="placeholder" style="padding:20px; font-size:11px;">Select a provider</div>';
    return;
  }
  
  const endpoints = provider.endpoints || (provider.endpoint ? [provider.endpoint] : []);
  
  content.innerHTML = `
    <div class="provider-info-detail">
      <div class="info-row">
        <span class="info-label">Name</span>
        <span class="info-value">${escapeHtml(provider.name)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Kind</span>
        <span class="info-value">${escapeHtml(provider.kind)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Requires Key</span>
        <span class="info-value ${provider.requiresKey ? 'err' : 'ok'}">${provider.requiresKey ? 'YES' : 'NO'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Endpoints</span>
        <span class="info-value">${endpoints.length}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Method</span>
        <span class="info-value">${provider.method || 'GET'}</span>
      </div>
      ${provider.description ? `
      <div class="info-row">
        <span class="info-label">Description</span>
        <span class="info-value">${escapeHtml(provider.description)}</span>
      </div>
      ` : ''}
      ${provider.placeholder ? `
      <div class="info-row">
        <span class="info-label">Placeholder</span>
        <span class="info-value" style="font-family:monospace;">${escapeHtml(provider.placeholder)}</span>
      </div>
      ` : ''}
    </div>
  `;
}

async function saveEndpointOrder(providerKey) {
  // The order is already saved via drag-and-drop, but we can add a confirmation
  showToast('Order saved (drag to reorder)', 'success');
}

function setupEventListeners() {
  $('#provider-filter').addEventListener('input', renderProviderList);
  $('#mgmt-provider').addEventListener('change', (e) => {
    if (e.target.value) {
      state.activeMgmtProvider = e.target.value;
      $$('.provider-item').forEach(el => el.classList.toggle('active', el.dataset.key === e.target.value));
      renderMgmtEndpoints(e.target.value);
      renderMgmtHealthSidebar();
      renderMgmtProviderInfo(e.target.value);
    }
  });
  $('#btn-refresh-mgmt').addEventListener('click', async () => {
    await fetchProviders();
    await fetchEndpointHealth();
    if (state.activeMgmtProvider) {
      renderMgmtEndpoints(state.activeMgmtProvider);
      renderMgmtHealthSidebar();
      renderMgmtProviderInfo(state.activeMgmtProvider);
    }
    showToast('Refreshed', 'success');
  });
  $('#btn-add-endpoint').addEventListener('click', () => {
    const providerKey = $('#mgmt-provider').value;
    const endpoint = $('#mgmt-new-endpoint').value.trim();
    if (!providerKey) return showToast('Select a provider', 'warning');
    if (!endpoint) return showToast('Enter endpoint URL', 'warning');
    if (!endpoint.includes('{q}')) return showToast('Endpoint must contain {q} placeholder', 'warning');
    if (!endpoint.startsWith('http')) return showToast('Endpoint must start with http:// or https://', 'warning');
    addEndpoint(providerKey, endpoint);
    $('#mgmt-new-endpoint').value = '';
  });
  $('#btn-test-all').addEventListener('click', () => {
    const providerKey = $('#mgmt-provider').value;
    if (!providerKey) return showToast('Select a provider', 'warning');
    testAllEndpoints(providerKey);
  });
  $('#btn-reorder-save').addEventListener('click', () => {
    const providerKey = $('#mgmt-provider').value;
    if (!providerKey) return showToast('Select a provider', 'warning');
    saveEndpointOrder(providerKey);
  });
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
  
  console.log('%c MATRIX OSINT MANAGEMENT INITIALIZED ', 'background:#00ff41; color:#000; font-family:monospace; padding:4px 8px;');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}