const state = {
  inventory: null,
  planning: null,
  customers: [],
  selectedCustomerId: null,
  customerCatalog: null,
  syncState: null,
  expandedBrands: new Set(),
  selectedProducts: new Set(),
  activeInvTool: null,
  activeTab: 'inventory',
  activity: null,
  actBranchFilter: '',
  actProductType: 'ALL',
  actSaleMode: 'ALL',
  catalogBranchId: 'ALL',
  catalogData: null,
  expandedCatalogBrands: new Set(),
};

const fmtCurrency = (n) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(n || 0);

const fmtNum = (n) => (Number(n) || 0).toLocaleString('en-PH');

const fmtTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

// Hamburger menu toggle + Main Tabs (lazy-load data only when tab is opened)
const menuToggleBtn = document.getElementById('menuToggleBtn');
const mainTabsMenu = document.getElementById('mainTabsMenu');
const currentTabLabel = document.getElementById('currentTabLabel');

function setMenuOpen(open) {
  mainTabsMenu.classList.toggle('hidden', !open);
  menuToggleBtn.setAttribute('aria-expanded', String(open));
}

menuToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setMenuOpen(mainTabsMenu.classList.contains('hidden'));
});

document.addEventListener('click', (e) => {
  if (!mainTabsMenu.classList.contains('hidden') && !mainTabsMenu.contains(e.target) && e.target !== menuToggleBtn) {
    setMenuOpen(false);
  }
});

function switchTab(tab) {
  const btn = document.querySelector(`.tab[data-tab="${tab}"]`);
  document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
    currentTabLabel.textContent = btn.textContent.trim();
  }
  state.activeTab = tab;
  document.getElementById(`tab-${tab}`).classList.add('active');
  const isInv = tab === 'inventory';
  document.getElementById('productTypeFilter').classList.toggle('hidden', !isInv);
  document.getElementById('inventorySummaryGrid').classList.toggle('hidden', !isInv);

  document.querySelectorAll('.mnav-btn[data-tab]').forEach((mb) => {
    mb.classList.toggle('active', mb.dataset.tab === tab);
  });

  setMenuOpen(false);
  refreshActiveTab();
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.querySelectorAll('.mnav-btn[data-tab]').forEach((mb) => {
  mb.addEventListener('click', () => switchTab(mb.dataset.tab));
});

document.getElementById('mobileMoreBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  setMenuOpen(mainTabsMenu.classList.contains('hidden'));
});

async function refreshActiveTab() {
  const tab = state.activeTab;
  if (tab === 'inventory') {
    await loadInventory();
    if (state.activeInvTool === 'restock') await loadPlanning();
  } else if (tab === 'receivables') {
    await loadReceivables();
  } else if (tab === 'finance') {
    await loadFinance();
  } else if (tab === 'websiteStock') {
    await loadSyncLogs();
  } else if (tab === 'catalogs') {
    await loadBranchCatalog();
  } else if (tab === 'activity') {
    await loadActivity();
  }
}

// Inventory 4 Sub-tool toggles (6-dot Facebook-style menu)
const invToolsMenuBtn = document.getElementById('invToolsMenuBtn');
const invToolsMenu = document.getElementById('invToolsMenu');
const invToolsLabel = document.getElementById('invToolsLabel');

function setInvToolsMenuOpen(open) {
  invToolsMenu.classList.toggle('hidden', !open);
  invToolsMenuBtn.setAttribute('aria-expanded', String(open));
}

invToolsMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setInvToolsMenuOpen(invToolsMenu.classList.contains('hidden'));
});

document.addEventListener('click', (e) => {
  if (!invToolsMenu.classList.contains('hidden') && !invToolsMenu.contains(e.target) && !invToolsMenuBtn.contains(e.target)) {
    setInvToolsMenuOpen(false);
  }
});

document.querySelectorAll('.inv-tool-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    const isSame = state.activeInvTool === tool;
    state.activeInvTool = isSame ? null : tool;
    invToolsLabel.textContent = state.activeInvTool ? `TOOLS: ${btn.textContent.trim()}` : 'INVENTORY TOOLS';
    document.querySelectorAll('.inv-tool-btn').forEach((b) => {
      b.setAttribute('aria-expanded', String(b.dataset.tool === state.activeInvTool));
    });
    ['filters', 'restock', 'health', 'lifecycle'].forEach((t) => {
      document.getElementById(`tool-${t}`).classList.toggle('hidden', t !== state.activeInvTool);
    });
    setInvToolsMenuOpen(false);
    if (state.activeInvTool === 'restock' && !state.planning) loadPlanning();
  });
});

// Stock Change Sub-tabs
document.querySelectorAll('.sc-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sc-tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.sc-panel').forEach((p) => p.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`sc-${btn.dataset.sc}`).classList.remove('hidden');
  });
});

const IS_STATIC_GH = window.location.hostname.endsWith('github.io');
const LOGO_SQUARE_SRC = IS_STATIC_GH ? '../ab-logo-square.png' : '/ab-logo-square.png';
let ghBundleCache = null;
let ghBundleFetchedAt = 0;

async function getGhBundle(force = false) {
  if (!force && ghBundleCache && Date.now() - ghBundleFetchedAt < 30000) return ghBundleCache;
  const res = await fetch(`../data/admin-bundle.json?v=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to load cloud bundle (HTTP ${res.status})`);
  ghBundleCache = await res.json();
  ghBundleFetchedAt = Date.now();
  return ghBundleCache;
}

async function verifyGhOwnerPin(pin) {
  const salt = 'b2b93565-ecda-4421-8869-9b8e0a689dd4';
  const expected = 'WoqyJ8xhvUMB3110oE1lkqUeZm53MSMWRkMIh/jkLB4=';
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return b64 === expected;
}

async function staticGhApi(url, opts = {}) {
  const u = new URL(url, window.location.origin);
  const pathname = u.pathname;
  const method = (opts.method || 'GET').toUpperCase();

  if (pathname === '/api/auth/status') {
    return { pinConfigured: true, authenticated: localStorage.getItem('bs_gh_auth') === '1' };
  }
  if (pathname === '/api/auth/login' || pathname === '/api/auth/setup') {
    const body = JSON.parse(opts.body || '{}');
    const ok = await verifyGhOwnerPin(String(body.pin || '').trim());
    if (!ok) throw new Error('Incorrect Owner PIN.');
    localStorage.setItem('bs_gh_auth', '1');
    return { ok: true };
  }
  if (pathname === '/api/auth/logout') {
    localStorage.removeItem('bs_gh_auth');
    return { ok: true };
  }
  if (pathname === '/api/catalog/views') {
    const slugs = [['br-molave', 'molave'], ['br-tambulig', 'tambulig'], ['br-bonifacio', 'bonifacio']];
    const byBranch = {};
    let total = 0, weekly = 0, monthly = 0;
    await Promise.all(
      slugs.map(async ([bid, slug]) => {
        try {
          const r = await fetch(`https://hits.sh/api/urns/maynardrdelossantos.github.io/ab-gadgetz-catalog-views/${slug}`);
          if (r.ok) {
            const j = await r.json();
            const t = Number(j.total) || 0, w = Number(j.weekly) || 0, m = Number(j.monthly) || 0;
            byBranch[bid] = { total: t, weekly: w, monthly: m };
            total += t; weekly += w; monthly += m;
            return;
          }
        } catch {}
        byBranch[bid] = { total: 0, weekly: 0, monthly: 0 };
      })
    );
    return { byBranch, total, weekly, monthly };
  }
  if (pathname === '/api/sync/now') {
    await getGhBundle(true);
    window.open('https://github.com/ab-gadgetz/ab-gadgetz.github.io/actions/workflows/deploy-catalog.yml', '_blank');
    return { ok: true };
  }
  if (method !== 'GET') {
    throw new Error('Make edits in your Local Admin Portal (http://localhost:3456), then click 🚀 Publish Catalogs.');
  }

  const bundle = await getGhBundle();
  if (pathname === '/api/inventory') return bundle.inventory;
  if (pathname === '/api/sync/status') {
    return {
      state: {
        running: false,
        paused: false,
        lastSyncAt: bundle.syncedAt,
        lastStatus: bundle.liveSynced ? 'OK' : 'WARN',
        adapterMode: 'ABGADGETZ_LIVE (GITHUB)',
      },
      logs: [
        {
          created_at: bundle.syncedAt,
          status: bundle.liveSynced ? 'OK' : 'WARN',
          records_updated: bundle.inventory.items.length,
          session_refreshed: 1,
          message: bundle.liveSyncNote,
        },
      ],
    };
  }
  if (pathname === '/api/planning') {
    const reorderSuggestions = [];
    for (const item of bundle.inventory.items) {
      if (item.lifecycle_status !== 'Active') continue;
      for (const b of bundle.inventory.branches) {
        const cell = item.byBranch[b.id];
        if (!cell) continue;
        if (cell.qtyAvailable <= cell.reorderPoint) {
          const suggestedOrderQty = Math.max(0, cell.maxStock - cell.qtyAvailable);
          if (suggestedOrderQty > 0) {
            reorderSuggestions.push({
              branchId: b.id, branchName: b.name, productId: item.id, sku: item.sku,
              productName: item.name, qtyAvailable: cell.qtyAvailable, reorderPoint: cell.reorderPoint,
              suggestedOrderQty, estimatedCost: suggestedOrderQty * (item.cost_price || 0),
              urgency: cell.qtyAvailable === 0 ? 'CRITICAL' : 'HIGH',
            });
          }
        }
      }
    }
    return { reorderSuggestions: reorderSuggestions.slice(0, 60), transferSuggestions: [] };
  }
  if (pathname === '/api/budget') {
    const items = bundle.orderBudgetItems || [];
    let totalBanks = 0, totalUndeposited = 0, totalCreditCards = 0;
    for (const i of items) {
      if (i.section === 'BANK') totalBanks += Number(i.amount) || 0;
      else if (i.section === 'UNDEPOSITED') totalUndeposited += Number(i.amount) || 0;
      else if (i.section === 'CREDIT_CARD') totalCreditCards += Number(i.amount) || 0;
    }
    const totalCash = totalBanks + totalUndeposited;
    return { items, summary: { totalBanks, totalUndeposited, totalCash, totalCreditCards, netOrderBudget: totalCash - totalCreditCards } };
  }
  const catMatch = pathname.match(/^\/api\/catalog\/branch\/([^/]+)$/);
  if (catMatch) {
    const branchId = catMatch[1];
    const isAll = branchId === 'ALL';
    const branch = isAll ? { id: 'ALL', name: 'All Branches', cash_discount_pct: 5 } : bundle.inventory.branches.find((b) => b.id === branchId);
    const targetProfiles = isAll ? bundle.inventory.branches.map((b) => `cat-${b.id}`) : [`cat-${branchId}`];
    const ruleMap = new Map();
    for (const r of bundle.catalogRules || []) {
      if (!targetProfiles.includes(r.customer_id)) continue;
      const prev = ruleMap.get(r.product_id);
      ruleMap.set(r.product_id, prev === undefined ? Boolean(r.is_visible) : prev || Boolean(r.is_visible));
    }
    const discountRate = ((branch?.cash_discount_pct || 5) / 100);
    const catalog = bundle.inventory.items.map((p) => {
      const branchAvailable = isAll
        ? bundle.inventory.branches.reduce((s, b) => s + (p.byBranch[b.id]?.qtyAvailable || 0), 0)
        : (p.byBranch[branchId]?.qtyAvailable || 0);
      return {
        productId: p.id, sku: p.sku, brand: p.brand, model: p.model || p.name, name: p.name,
        productType: p.product_type || 'Cellphones', websiteCodes: p.website_codes || p.sku,
        lifecycleStatus: p.lifecycle_status || 'Active', basePrice: p.base_price,
        cashPrice: Math.round(p.base_price * (1 - discountRate)),
        imageUrl: p.imageUrl || '', imageUrls: p.imageUrls || [],
        isVisible: ruleMap.has(p.id) ? ruleMap.get(p.id) : true, branchAvailable,
      };
    });
    return { branch, catalog, installmentRates: bundle.installmentRates || [] };
  }
  if (pathname === '/api/activity') {
    const start = u.searchParams.get('start') || '';
    const end = u.searchParams.get('end') || '9999-99-99';
    const branchId = u.searchParams.get('branchId') || '';
    const toManilaDate = (iso) => {
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      } catch {
        return String(iso).slice(0, 10);
      }
    };
    const allMovements = (bundle.allMovements || []).filter((m) => {
      const d = toManilaDate(m.recorded_at);
      return (!start || d >= start) && (!end || d <= end);
    });
    const allInstallments = (bundle.allInstallments || []).filter((i) => {
      const d = String(i.sale_date || '').slice(0, 10);
      return (!start || d >= start) && (!end || d <= end);
    });
    return {
      start, end, allMovements, allInstallments,
      movements: branchId ? allMovements.filter((m) => m.branch_id === branchId) : allMovements,
      installmentSales: branchId ? allInstallments.filter((i) => i.branch_id === branchId) : allInstallments,
    };
  }
  if (pathname === '/api/finance/summary') {
    const start = u.searchParams.get('start') || '';
    const end = u.searchParams.get('end') || '9999-99-99';
    const branchId = u.searchParams.get('branchId') || '';
    const payRows = (bundle.allPayments || []).filter((p) => (!start || p.payment_date >= start) && (!end || p.payment_date <= end) && (!branchId || p.branch_id === branchId));
    const expRows = (bundle.allExpenses || []).filter((e) => (!start || e.expense_date >= start) && (!end || e.expense_date <= end) && (!branchId || e.branch_id === branchId));
    const totals = { collections: 0, principal: 0, interest: 0, penalties: 0, rebates: 0, financingIncome: 0, expenses: 0, netCashFlow: 0 };
    const branchStats = new Map(bundle.inventory.branches.map((b) => [b.id, { branchId: b.id, branchName: b.name, collections: 0, principal: 0, financingIncome: 0, expenses: 0, netCashFlow: 0 }]));
    for (const p of payRows) {
      totals.collections += p.amount; totals.principal += p.principal; totals.interest += p.interest;
      totals.penalties += p.penalties; totals.rebates += p.rebates;
      const finInc = p.interest + p.penalties - p.rebates;
      totals.financingIncome += finInc;
      const bs = branchStats.get(p.branch_id);
      if (bs) { bs.collections += p.amount; bs.principal += p.principal; bs.financingIncome += finInc; }
    }
    const expByTypeMap = new Map();
    for (const e of expRows) {
      totals.expenses += e.amount;
      const bs = branchStats.get(e.branch_id);
      if (bs) bs.expenses += e.amount;
      expByTypeMap.set(e.expense_type, (expByTypeMap.get(e.expense_type) || 0) + e.amount);
    }
    totals.netCashFlow = totals.collections - totals.expenses;
    for (const bs of branchStats.values()) bs.netCashFlow = bs.collections - bs.expenses;
    return {
      totals,
      byBranch: Array.from(branchStats.values()),
      expensesByType: Array.from(expByTypeMap.entries()).map(([expenseType, amount]) => ({ expenseType, amount })).sort((a, b) => b.amount - a.amount),
      recentPayments: payRows.slice(0, 100),
      recentExpenses: expRows.slice(0, 100),
    };
  }
  if (pathname === '/api/receivables/summary') {
    const branchId = u.searchParams.get('branchId') || '';
    const instRows = (bundle.allInstallments || []).filter((i) => !branchId || i.branch_id === branchId);
    const dueRows = (bundle.allPastDues || []).filter((d) => !branchId || d.branch_id === branchId);
    let totalPortfolio = 0, totalPrincipal = 0, totalDeposits = 0, totalMonthlyExpected = 0;
    const branchMap = new Map(bundle.inventory.branches.map((b) => [b.id, { branchId: b.id, branchName: b.name, installmentCount: 0, portfolio: 0, principal: 0, dueAccounts: 0 }]));
    for (const i of instRows) {
      totalPortfolio += i.amount; totalPrincipal += i.principal_amount;
      totalDeposits += i.deposit; totalMonthlyExpected += i.monthly;
      const bs = branchMap.get(i.branch_id);
      if (bs) { bs.installmentCount++; bs.portfolio += i.amount; bs.principal += i.principal_amount; }
    }
    for (const d of dueRows) {
      const bs = branchMap.get(d.branch_id);
      if (bs) bs.dueAccounts++;
    }
    return {
      totals: { installmentCount: instRows.length, totalPortfolio, totalPrincipal, totalDeposits, totalMonthlyExpected, dueAccountsCount: dueRows.length },
      byBranch: Array.from(branchMap.values()),
      pastDues: dueRows.slice(0, 120),
      installments: instRows.slice(0, 100),
    };
  }
  return {};
}

async function api(url, opts = {}) {
  if (IS_STATIC_GH) return staticGhApi(url, opts);
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function loadInventory() {
  state.inventory = await api('/api/inventory');
  populateSelects();
  renderInventory();
  renderHealth();
}

function populateSelects() {
  const { branches, items } = state.inventory;

  const populateBranchSelect = (id, includeAll) => {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML =
      (includeAll ? '<option value="">All Branches</option>' : '') +
      branches.map((b) => `<option value="${b.id}">${b.name}</option>`).join('');
    if (cur) sel.value = cur;
  };

  populateBranchSelect('globalBranch', true);
  populateBranchSelect('recBranch', false);
  populateBranchSelect('recDestBranch', false);
  populateBranchSelect('addBranch', false);

  const cats = [...new Set(items.map((i) => i.brand || i.category))].sort();
  const catSel = document.getElementById('invCategory');
  const curCat = catSel.value;
  catSel.innerHTML = '<option value="">All Brands / Categories</option>' +
    cats.map((c) => `<option value="${c}">${c}</option>`).join('');
  catSel.value = curCat;

  const prodOptions = items
    .map((p) => `<option value="${p.id}">${p.name} (${p.sku})</option>`)
    .join('');
  ['lifecycleProduct', 'recProduct', 'priceProduct', 'costProduct', 'photoProduct'].forEach((id) => {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = prodOptions;
    if (cur) sel.value = cur;
  });
  syncCostInputs();
  renderPhotoEditor();
}

function syncCostInputs() {
  if (!state.inventory) return;
  const pid = document.getElementById('costProduct').value;
  const prod = state.inventory.items.find((i) => i.id === pid);
  if (!prod) return;
  document.getElementById('costAb').value = prod.cost_ab ?? '';
  document.getElementById('costAk').value = prod.cost_ak ?? '';
  document.getElementById('costOnline').value = prod.cost_online ?? '';
}

function renderPhotoEditor() {
  if (!state.inventory) return;
  const pid = document.getElementById('photoProduct').value;
  const prod = state.inventory.items.find((i) => i.id === pid);
  const grid = document.getElementById('photoPreviewGrid');
  if (!prod) {
    grid.innerHTML = '';
    return;
  }
  const urls = prod.imageUrls || [];
  if (!urls.length) {
    grid.innerHTML = '<div class="muted small">No photos added for this product yet.</div>';
    return;
  }
  grid.innerHTML = urls
    .map(
      (u, idx) => `
      <div style="background:#171c23;border:1px solid var(--border-soft);border-radius:8px;padding:6px;display:flex;flex-direction:column;align-items:center;gap:6px;width:96px;">
        <img src="${u}" alt="${prod.name}" style="width:76px;height:76px;object-fit:contain;background:#fff;border-radius:6px;" />
        <button type="button" class="danger remove-photo-btn" data-idx="${idx}" style="width:100%;padding:4px;font-size:10px;">Remove</button>
      </div>`
    )
    .join('');

  grid.querySelectorAll('.remove-photo-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextUrls = urls.filter((_, i) => i !== Number(btn.dataset.idx));
      await api('/api/products/photos', {
        method: 'PATCH',
        body: JSON.stringify({ productId: prod.id, imageUrls: nextUrls }),
      });
      document.getElementById('photoMsg').textContent = 'Photo removed.';
      await loadInventory();
      if (state.selectedCustomerId) await loadCustomerCatalog(state.selectedCustomerId);
    });
  });
}

document.getElementById('photoProduct').addEventListener('change', renderPhotoEditor);
document.getElementById('addPhotoBtn').addEventListener('click', async () => {
  const pid = document.getElementById('photoProduct').value;
  const url = document.getElementById('photoUrlInput').value.trim();
  const msg = document.getElementById('photoMsg');
  if (!pid || !url) {
    msg.textContent = 'Select a product and paste an image address first.';
    return;
  }
  const prod = state.inventory.items.find((i) => i.id === pid);
  const nextUrls = [...(prod?.imageUrls || []), url];
  try {
    await api('/api/products/photos', {
      method: 'PATCH',
      body: JSON.stringify({ productId: pid, imageUrls: nextUrls }),
    });
    document.getElementById('photoUrlInput').value = '';
    msg.textContent = 'Photo added!';
    await loadInventory();
    if (state.selectedCustomerId) await loadCustomerCatalog(state.selectedCustomerId);
  } catch (err) {
    msg.textContent = err.message;
  }
});

function getSelectedStockView() {
  return document.getElementById('stockViewSelect')?.value || 'available';
}

function getSelectedProductTypes() {
  return [...document.querySelectorAll('input[name="productType"]:checked')].map((el) => el.value);
}

function updateBulkBar() {
  const bar = document.getElementById('bulkActionBar');
  const count = state.selectedProducts.size;
  bar.classList.toggle('hidden', count === 0);
  document.getElementById('bulkSelectedCount').textContent = `${count} model(s) selected`;
}

function renderModelCard(item, visibleBranches) {
  const pills = visibleBranches
    .map((b) => {
      const cell = item.byBranch[b.id];
      const cls = cell.qtyAvailable > 0 ? 'ok' : 'zero';
      return `<span class="branch-pill ${cls}">${b.name}: ${fmtNum(cell.qtyAvailable)}</span>`;
    })
    .join('');
  const lifecycleBadge =
    item.lifecycle_status && item.lifecycle_status !== 'Active'
      ? `<span class="lifecycle-pill">${item.lifecycle_status}</span>`
      : '';
  const thumb = item.imageUrl
    ? `<img src="${item.imageUrl}" alt="${item.name}" style="width:52px;height:52px;object-fit:contain;background:#fff;border-radius:9px;padding:2px;flex:0 0 52px;box-shadow:0 2px 8px rgba(0,0,0,.3);" loading="lazy" />`
    : `<div style="width:52px;height:52px;border-radius:9px;background:#171c23;border:1px solid var(--border-soft);display:grid;place-items:center;color:var(--gold);font-size:20px;flex:0 0 52px;">📱</div>`;
  const isSel = state.selectedProducts.has(item.id);
  const qtyCls = item.scopedAvail === 0 ? 'model-card-qty zero' : 'model-card-qty';
  return `
    <div class="model-card" style="${isSel ? 'border-color:var(--gold);background:linear-gradient(165deg,#332f20 0%,#1f1d16 100%);' : ''}">
      <div class="model-card-head">
        <div style="display:flex;gap:9px;align-items:center;min-width:0;">
          <input type="checkbox" class="model-select-chk" data-id="${item.id}" ${isSel ? 'checked' : ''} style="width:16px;height:16px;flex:0 0 16px;cursor:pointer;accent-color:var(--gold);" />
          ${thumb}
          <div style="min-width:0;">
            <div class="model-card-name">${item.model || item.name}</div>
            <div class="model-card-code">${item.website_codes || item.sku}</div>
          </div>
        </div>
        <div class="${qtyCls}">${fmtNum(item.scopedAvail)} ${item.scopedAvail === 1 ? 'unit' : 'units'}</div>
      </div>
      <div class="model-branch-pills">${pills}</div>
      <div class="model-price-row" style="padding-top:6px;border-top:1px solid rgba(255,255,255,.06);">
        <span>SRP: <strong style="color:var(--gold-bright);font-size:12.5px;">${fmtCurrency(item.base_price)}</strong></span>
        <span>Cost: <strong style="color:var(--green);">${item.cost_price > 0 ? fmtCurrency(item.cost_price) : '—'}</strong></span>
      </div>
      ${lifecycleBadge}
    </div>
  `;
}

function renderInventory() {
  const data = state.inventory;
  if (!data) return;

  const { branches, items } = data;
  const globalBranchId = document.getElementById('globalBranch').value;
  const visibleBranches = globalBranchId
    ? branches.filter((b) => b.id === globalBranchId)
    : branches;

  const search = document.getElementById('invSearch').value.trim().toLowerCase();
  const cat = document.getElementById('invCategory').value;
  const stockView = getSelectedStockView();
  const selectedTypes = getSelectedProductTypes();
  const productTypeLabel = selectedTypes.length === 2 ? 'CELLPHONES & ACCESSORIES' : (selectedTypes[0] || 'NONE').toUpperCase();
  const groupingMode = document.getElementById('cardGroupingMode').value;

  // Compute AVAILABLE, TOTAL, POTENTIAL SALES (Net of Cash Discount) scoped to selected Product Type(s) & Branch
  let availableModels = 0;
  let totalUnits = 0;
  let potentialSales = 0;
  let totalCostVal = 0;

  const scopedItems = [];
  for (const item of items) {
    const itemType = item.product_type || 'Cellphones';
    if (!selectedTypes.includes(itemType)) continue;

    let itemAvail = 0;
    let itemCashSales = 0;
    let itemCostVal = 0;
    let anyLow = false;

    for (const b of visibleBranches) {
      const cell = item.byBranch[b.id];
      if (!cell) continue;
      itemAvail += cell.qtyAvailable;
      itemCashSales += cell.potentialCashSales || 0;
      itemCostVal += cell.qtyOnHand * (item.cost_price || 0);
      if (cell.status === 'LOW' || cell.status === 'OUT') anyLow = true;
    }

    if (itemAvail > 0) availableModels++;
    totalUnits += itemAvail;
    potentialSales += itemCashSales;
    totalCostVal += itemCostVal;

    const matchSearch =
      !search ||
      item.name.toLowerCase().includes(search) ||
      item.sku.toLowerCase().includes(search) ||
      (item.website_codes || '').toLowerCase().includes(search);
    const matchCat = !cat || (item.brand || item.category) === cat;
    if (!matchSearch || !matchCat) continue;

    let matchView = true;
    if (stockView === 'available') matchView = itemAvail > 0;
    else if (stockView === 'phaseout') matchView = item.lifecycle_status !== 'Active';
    else if (stockView === 'unavailable') matchView = itemAvail === 0;
    else if (stockView === 'reorder') matchView = anyLow && item.lifecycle_status === 'Active';

    if (matchView) {
      scopedItems.push({ ...item, scopedAvail: itemAvail, scopedCashSales: itemCashSales });
    }
  }

  // Sort models by selling price (lowest to highest), then name
  scopedItems.sort(
    (a, b) =>
      (Number(a.base_price) || 0) - (Number(b.base_price) || 0) ||
      String(a.model || a.name).localeCompare(String(b.model || b.name))
  );

  document.getElementById('inventorySummaryGrid').innerHTML = `
    <div class="mini-kpi">
      <div class="mini-kpi-top">
        <span class="mini-kpi-label">TOTAL</span>
        <span class="mini-kpi-val">${totalUnits.toLocaleString()} units</span>
      </div>
      <div class="mini-kpi-sub">${fmtNum(availableModels)} models available • Cost: ${fmtCurrency(totalCostVal)}</div>
    </div>
    <div class="mini-kpi">
      <div class="mini-kpi-top">
        <span class="mini-kpi-label">POTENTIAL SALES</span>
        <span class="mini-kpi-val">${fmtCurrency(potentialSales)}</span>
      </div>
      <div class="mini-kpi-sub">Net of cash discount (5% / 3%)</div>
    </div>
  `;

  const grid = document.getElementById('brandGrid');
  if (scopedItems.length === 0) {
    grid.innerHTML = '<div class="muted small">No products match the current filters.</div>';
    updateBulkBar();
    return;
  }

  if (groupingMode === 'flat') {
    grid.innerHTML = `
      <div class="brand-group expanded">
        <div class="brand-tile" style="cursor:default;">
          <span class="brand-tile-name">${productTypeLabel} (${scopedItems.length})</span>
          <label style="display:flex;align-items:center;gap:6px;margin:0;color:var(--gold-bright);cursor:pointer;font-size:12px;">
            <input type="checkbox" id="flatSelectAll" ${scopedItems.every((x) => state.selectedProducts.has(x.id)) ? 'checked' : ''} style="width:16px;height:16px;margin:0;" />
            Select All Shown
          </label>
        </div>
        ${scopedItems.map((item) => renderModelCard(item, visibleBranches)).join('')}
      </div>
    `;
    document.getElementById('flatSelectAll')?.addEventListener('change', (e) => {
      for (const x of scopedItems) {
        if (e.target.checked) state.selectedProducts.add(x.id);
        else state.selectedProducts.delete(x.id);
      }
      renderInventory();
    });
  } else {
    const groups = new Map();
    for (const item of scopedItems) {
      const brand = item.brand || item.category || 'Other';
      if (!groups.has(brand)) groups.set(brand, []);
      groups.get(brand).push(item);
    }

    const BRAND_ORDER = [
      'infinix', 'tecno', 'realme', 'itel', 'redmi', 'vivo',
      'honor', 'samsung', 'nubia', 'zte', 'poco', 'oppo', 'apple',
    ];
    const BRAND_THEMES = {
      infinix: { label: 'Infinix', accent: '#77e82a', bg: '#1e2c1b', style: 'font-style:italic;letter-spacing:-0.5px;' },
      tecno:   { label: 'TECNO',   accent: '#3b82f6', bg: '#192438', style: 'letter-spacing:1.5px;' },
      realme:  { label: 'realme',  accent: '#ffd600', bg: '#2e2917', style: 'text-transform:lowercase;letter-spacing:-0.5px;' },
      itel:    { label: 'itel',    accent: '#ff3355', bg: '#2f1a20', style: 'text-transform:lowercase;font-style:italic;' },
      redmi:   { label: 'Redmi',   accent: '#ff6900', bg: '#2e2018', style: 'letter-spacing:0.2px;' },
      vivo:    { label: 'vivo',    accent: '#60a5fa', bg: '#1a2536', style: 'text-transform:lowercase;letter-spacing:1px;' },
      honor:   { label: 'HONOR',   accent: '#38bdf8', bg: '#182834', style: 'letter-spacing:2.5px;font-weight:700;' },
      samsung: { label: 'SAMSUNG', accent: '#3b82f6', bg: '#17233b', style: 'letter-spacing:2px;font-size:18px;' },
      nubia:   { label: 'nubia',   accent: '#ef4444', bg: '#2f191b', style: 'text-transform:lowercase;letter-spacing:1px;' },
      zte:     { label: 'ZTE',     accent: '#06b6d4', bg: '#172a30', style: 'letter-spacing:2px;' },
      poco:    { label: 'POCO',    accent: '#facc15', bg: '#2c2817', style: 'letter-spacing:1.5px;background:#facc15;color:#111;padding:3px 10px;border-radius:6px;font-size:18px;' },
      oppo:    { label: 'oppo',    accent: '#10b981', bg: '#162b24', style: 'text-transform:lowercase;letter-spacing:2px;' },
      apple:   {
        label: `<svg width="20" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.33c.64-.78 1.08-1.86.96-2.94-.93.04-2.06.62-2.72 1.4-.58.68-1.1 1.78-.96 2.84 1.04.08 2.08-.52 2.72-1.3"/></svg> Apple`,
        accent: '#f8fafc',
        bg: '#232830',
        style: 'letter-spacing:0.3px;',
      },
    };
    grid.innerHTML = Array.from(groups.entries())
      .sort((a, b) => {
        const ra = BRAND_ORDER.indexOf(a[0].toLowerCase());
        const rb = BRAND_ORDER.indexOf(b[0].toLowerCase());
        const oa = ra < 0 ? BRAND_ORDER.length : ra;
        const ob = rb < 0 ? BRAND_ORDER.length : rb;
        return oa - ob || a[0].localeCompare(b[0]);
      })
      .map(([brand, list]) => {
        const units = list.reduce((s, x) => s + x.scopedAvail, 0);
        const isExpanded = state.expandedBrands.has(brand) || Boolean(search);
        const allSelected = list.length > 0 && list.every((x) => state.selectedProducts.has(x.id));
        const theme = BRAND_THEMES[brand.toLowerCase()] || { label: brand, accent: '#e7c55f', bg: '#252c35', style: '' };

        const selectAllControl = isExpanded
          ? `<label class="brand-select-all" data-brand="${brand}" style="display:flex;align-items:center;gap:5px;margin:0;color:var(--text);font-size:11px;cursor:pointer;" onclick="event.stopPropagation()">
               <input type="checkbox" class="brand-select-all-chk" data-brand="${brand}" ${allSelected ? 'checked' : ''} style="width:15px;height:15px;margin:0;" />
               Select All
             </label>`
          : '';

        const cardsHtml = isExpanded
          ? list.map((item) => renderModelCard(item, visibleBranches)).join('')
          : '';

        return `
          <div class="brand-group ${isExpanded ? 'expanded' : ''}">
            <button type="button" class="brand-tile" data-brand="${brand}" style="--brand-accent:${theme.accent};--brand-bg:${theme.bg};">
              <span class="brand-tile-name" style="${theme.style}">${theme.label}</span>
              <span style="display:flex;align-items:center;gap:12px;">
                ${selectAllControl}
                <span class="brand-tile-meta">${fmtNum(list.length)} models • ${fmtNum(units)} units ${isExpanded ? '▲' : '▼'}</span>
              </span>
            </button>
            ${cardsHtml}
          </div>
        `;
      })
      .join('');

    grid.querySelectorAll('.brand-tile').forEach((btn) => {
      btn.addEventListener('click', () => {
        const b = btn.dataset.brand;
        if (state.expandedBrands.has(b)) state.expandedBrands.delete(b);
        else state.expandedBrands.add(b);
        renderInventory();
      });
    });

    grid.querySelectorAll('.brand-select-all-chk').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        const list = groups.get(e.target.dataset.brand) || [];
        for (const x of list) {
          if (e.target.checked) state.selectedProducts.add(x.id);
          else state.selectedProducts.delete(x.id);
        }
        renderInventory();
      });
    });
  }

  grid.querySelectorAll('.model-select-chk').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) state.selectedProducts.add(id);
      else state.selectedProducts.delete(id);
      renderInventory();
    });
  });

  updateBulkBar();
}

function renderHealth() {
  if (!state.inventory) return;
  const globalBranchId = document.getElementById('globalBranch').value;
  const branches = globalBranchId
    ? state.inventory.branches.filter((b) => b.id === globalBranchId)
    : state.inventory.branches;

  const alerts = [];
  for (const item of state.inventory.items) {
    if (item.lifecycle_status !== 'Active') continue;
    for (const b of branches) {
      const cell = item.byBranch[b.id];
      if (!cell) continue;
      if (cell.status === 'LOW' || cell.status === 'OUT') {
        alerts.push({
          name: item.name,
          branch: b.name,
          avail: cell.qtyAvailable,
          status: cell.status,
          price: item.base_price,
        });
      }
    }
  }

  const box = document.getElementById('healthList');
  if (!alerts.length) {
    box.innerHTML = '<div class="muted small">All active models are healthy.</div>';
    return;
  }
  box.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Model</th><th>Branch</th><th>SRP</th><th>Available</th><th>State</th></tr></thead>
      <tbody>
        ${alerts.slice(0, 60).map((a) => `
          <tr>
            <td>${a.name}</td>
            <td>${a.branch}</td>
            <td>${fmtCurrency(a.price)}</td>
            <td><strong>${a.avail}</strong></td>
            <td><span class="badge ${a.status === 'OUT' ? 'badge-danger' : 'badge-warn'}">${a.status}</span></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function loadPlanning() {
  const [planning, budget] = await Promise.all([api('/api/planning'), api('/api/budget')]);
  state.planning = planning;
  state.budget = budget;
  renderPlanning();
}

function renderPlanning() {
  if (state.budget) {
    const s = state.budget.summary;
    document.getElementById('budgetSummaryGrid').innerHTML = `
      <div class="summary-box">
        TOTAL CASH + UNDEPOSITED
        <strong>${fmtCurrency(s.totalCash)}</strong>
        <span class="summary-note">Banks: ${fmtCurrency(s.totalBanks)} • Undeposited: ${fmtCurrency(s.totalUndeposited)}</span>
      </div>
      <div class="summary-box">
        CREDIT CARD BILLS
        <strong style="color:var(--danger);">${fmtCurrency(s.totalCreditCards)}</strong>
        <span class="summary-note">Deducted before ordering</span>
      </div>
      <div class="summary-box">
        NET ORDER BUDGET
        <strong>${fmtCurrency(s.netOrderBudget)}</strong>
        <span class="summary-note">Available for supplier POs</span>
      </div>
    `;
  }
  const { reorderSuggestions, transferSuggestions } = state.planning;
  const globalBranchId = document.getElementById('globalBranch').value;

  const filteredReorders = globalBranchId
    ? reorderSuggestions.filter((r) => r.branchId === globalBranchId)
    : reorderSuggestions;

  document.querySelector('#reorderTable tbody').innerHTML = filteredReorders.length
    ? filteredReorders.slice(0, 50).map((r) => `
        <tr>
          <td><strong>${r.sku}</strong> — ${r.productName}</td>
          <td>${r.branchName}</td>
          <td>${fmtNum(r.qtyAvailable)} / ${fmtNum(r.reorderPoint)}</td>
          <td><strong>+${fmtNum(r.suggestedOrderQty)}</strong></td>
          <td>${fmtCurrency(r.estimatedCost)}</td>
        </tr>`).join('')
    : '<tr><td colspan="5" class="muted">No reorder suggestions right now.</td></tr>';

  document.querySelector('#transferTable tbody').innerHTML = transferSuggestions.length
    ? transferSuggestions.map((t) => `
        <tr>
          <td><strong>${t.sku}</strong> — ${t.productName}</td>
          <td>${t.fromBranch} <span class="badge badge-ok">${t.fromAvailable}</span></td>
          <td>${t.toBranch} <span class="badge badge-warn">${t.toAvailable}</span></td>
          <td><strong>Transfer ${t.suggestedTransferQty}</strong></td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="muted">No inter-branch transfers needed right now.</td></tr>';
}

async function loadCustomers() {
  return loadBranchCatalog();
}

async function loadCustomerCatalog() {
  return loadBranchCatalog();
}

async function loadBranchCatalog() {
  state.catalogData = await api(`/api/catalog/branch/${state.catalogBranchId}`);
  renderBranchCatalog();
}

function suggestedDownPayment(price) {
  if (price <= 3999) return 500;
  if (price <= 5999) return 600;
  if (price <= 6999) return 700;
  if (price <= 7999) return 800;
  if (price <= 8999) return 900;
  if (price <= 10999) return 1000;
  if (price <= 12999) return 2000;
  if (price <= 14999) return 3000;
  if (price <= 16999) return 4000;
  if (price <= 19999) return 5000;
  return price * 0.5;
}

function calc4MoAmortization(price, rates) {
  const r4 = (rates || []).find((r) => r.months === 4)?.monthly_rate || 0.09;
  if (!price || price <= 0) return 0;
  const dp = suggestedDownPayment(price);
  const bal = Math.max(0, price - dp);
  const raw = (bal + bal * r4 * 4) / 4;
  return Math.ceil((raw - 1e-9) / 5) * 5;
}

function detectAppleRam(modelStr) {
  const s = String(modelStr || '');
  if (/\biphone\s*xr\b/i.test(s)) return 3;
  if (/\biphone\s*17\s*pro/i.test(s)) return 12;
  if (/\biphone\s*(16|17)\b/i.test(s)) return 8;
  if (/\biphone\s*15\s*pro/i.test(s)) return 8;
  if (/\biphone\s*(14|15)\b/i.test(s)) return 6;
  if (/\biphone\s*(12|13)\s*pro/i.test(s)) return 6;
  if (/\biphone\s*(11|12|13)\b/i.test(s)) return 4;
  if (/\biphone\s*se\s*5g\b/i.test(s)) return 4;
  if (/\biphone\s*xs\b/i.test(s)) return 4;
  if (/\biphone\s*x\b/i.test(s)) return 3;
  if (/\biphone\s*(7|8)\s*plus\b/i.test(s)) return 3;
  if (/\biphone\s*(7|8)\b/i.test(s)) return 2;
  if (/\bipad\b.*\b(a16|11th)\b/i.test(s)) return 6;
  if (/\bipad\b.*\bair\b/i.test(s)) return 8;
  return 0;
}

function extractRamRom(modelStr, brandStr) {
  const s = String(modelStr || '');
  const slashMatch = s.match(/\b(\d{1,2})\s*\/\s*(\d{2,4})\s*(?:gb)?\b/i);
  if (slashMatch) {
    return `${slashMatch[1]}/${slashMatch[2]}GB`;
  }
  const isApple = /\b(iphone|ipad|apple)\b/i.test(s) || /^apple$/i.test(String(brandStr || '').trim());
  if (isApple) {
    const ram = detectAppleRam(s);
    const romMatch = s.match(/\b(32|64|128|256|512|1024)\s*(?:gb)?\b/i);
    const rom = romMatch ? romMatch[1] : '';
    if (ram && rom) return `${ram}/${rom}GB`;
    if (ram) return `${ram}GB RAM`;
    if (rom) return `${rom}GB`;
    return '';
  }
  const romMatch = s.match(/\b(32|64|128|256|512|1024)\s*gb\b/i);
  if (romMatch) {
    return `${romMatch[1]}GB`;
  }
  return '';
}

function renderBranchCatalog() {
  const data = state.catalogData;
  if (!data) return;
  const { branch, catalog, installmentRates } = data;

  const isEditMode = document.getElementById('catEditMode').checked;
  document.getElementById('catEditControls').classList.toggle('hidden', !isEditMode);

  const pType = document.getElementById('catProductType').value;
  const includeUnavail = isEditMode ? document.getElementById('catIncludeUnavailable').checked : false;
  const showHidden = isEditMode ? document.getElementById('showHiddenToggle').checked : false;
  const priceRangeEl = document.getElementById('catPriceRange');
  const ramRomEl = document.getElementById('catRamRom');

  if (ramRomEl) {
    ramRomEl.classList.toggle('hidden', pType === 'Accessories');
    if (pType === 'Accessories') {
      ramRomEl.value = 'ALL';
    } else {
      const prevVal = ramRomEl.value || 'ALL';
      const specsSet = new Set();
      catalog.forEach((item) => {
        if (item.productType !== 'Cellphones') return;
        if (!includeUnavail && item.branchAvailable <= 0) return;
        if (!showHidden && !item.isVisible) return;
        const spec = extractRamRom(item.model, item.brand);
        if (spec) specsSet.add(spec);
      });
      const sortedSpecs = Array.from(specsSet).sort((a, b) => {
        const parseSpec = (s) => {
          const m = s.match(/^(\d+)\/(\d+)GB$/i);
          if (m) return [Number(m[1]), Number(m[2])];
          const ramOnly = s.match(/^(\d+)GB RAM$/i);
          if (ramOnly) return [Number(ramOnly[1]), 0];
          const r = s.match(/^(\d+)GB$/i);
          return [999, r ? Number(r[1]) : 0];
        };
        const [aRam, aRom] = parseSpec(a);
        const [bRam, bRom] = parseSpec(b);
        return aRam - bRam || aRom - bRom || a.localeCompare(b);
      });
      ramRomEl.innerHTML = `<option value="ALL">All RAM/ROM</option>${sortedSpecs
        .map((s) => `<option value="${s}">${s}</option>`)
        .join('')}`;
      ramRomEl.value = sortedSpecs.includes(prevVal) ? prevVal : 'ALL';
    }
  }

  const priceRangeVal = priceRangeEl ? priceRangeEl.value : 'ALL';
  let minPrice = 0;
  let maxPrice = Infinity;
  if (priceRangeVal && priceRangeVal !== 'ALL') {
    const [lo, hi] = priceRangeVal.split('-').map(Number);
    if (Number.isFinite(lo)) minPrice = lo;
    if (Number.isFinite(hi)) maxPrice = hi;
  }
  const selectedRamRom = ramRomEl && pType !== 'Accessories' ? ramRomEl.value : 'ALL';

  const priceSortAsc = state.catalogPriceSort !== 'desc';
  const sortBtn = document.getElementById('catPriceSortBtn');
  if (sortBtn) sortBtn.textContent = priceSortAsc ? 'Price ↑' : 'Price ↓';

  const filtered = catalog
    .filter((item) => {
      if (pType !== 'ALL' && item.productType !== pType) return false;
      if (!includeUnavail && item.branchAvailable <= 0) return false;
      if (!showHidden && !item.isVisible) return false;
      const price = Number(item.basePrice) || 0;
      if (priceRangeVal !== 'ALL' && (price < minPrice || price > maxPrice)) return false;
      if (selectedRamRom !== 'ALL' && extractRamRom(item.model, item.brand) !== selectedRamRom) return false;
      return true;
    })
    .sort((a, b) => {
      const diff = (Number(a.basePrice) || 0) - (Number(b.basePrice) || 0);
      return (priceSortAsc ? diff : -diff) || a.model.localeCompare(b.model);
    });

  const visibleCount = filtered.filter((i) => i.isVisible).length;
  const selectAllEl = document.getElementById('catSelectAllVisible');
  if (selectAllEl) {
    selectAllEl.checked = filtered.length > 0 && visibleCount === filtered.length;
    selectAllEl.indeterminate = visibleCount > 0 && visibleCount < filtered.length;
  }
  state.lastFilteredCatalogIds = filtered.map((i) => i.productId);
  document.getElementById('catalogBranchMeta').textContent = isEditMode
    ? `${branch.name} Catalog (Edit Mode) • ${fmtNum(filtered.length)} model(s) shown • ${fmtNum(visibleCount)} visible to customers`
    : `${branch.name} Customer Catalog • ${fmtNum(filtered.length)} available model(s)`;

  const BRAND_ORDER = [
    'infinix', 'tecno', 'realme', 'itel', 'redmi', 'vivo',
    'honor', 'samsung', 'nubia', 'zte', 'poco', 'oppo', 'apple',
  ];
  const BRAND_THEMES = {
    infinix: { label: 'Infinix', accent: '#77e82a', bg: '#1e2c1b', style: 'font-style:italic;letter-spacing:-0.5px;' },
    tecno:   { label: 'TECNO',   accent: '#3b82f6', bg: '#192438', style: 'letter-spacing:1.5px;' },
    realme:  { label: 'realme',  accent: '#ffd600', bg: '#2e2917', style: 'text-transform:lowercase;letter-spacing:-0.5px;' },
    itel:    { label: 'itel',    accent: '#ff3355', bg: '#2f1a20', style: 'text-transform:lowercase;font-style:italic;' },
    redmi:   { label: 'Redmi',   accent: '#ff6900', bg: '#2e2018', style: 'letter-spacing:0.2px;' },
    vivo:    { label: 'vivo',    accent: '#60a5fa', bg: '#1a2536', style: 'text-transform:lowercase;letter-spacing:1px;' },
    honor:   { label: 'HONOR',   accent: '#38bdf8', bg: '#182834', style: 'letter-spacing:2.5px;font-weight:700;' },
    samsung: { label: 'SAMSUNG', accent: '#3b82f6', bg: '#17233b', style: 'letter-spacing:2px;font-size:18px;' },
    nubia:   { label: 'nubia',   accent: '#ef4444', bg: '#2f191b', style: 'text-transform:lowercase;letter-spacing:1px;' },
    zte:     { label: 'ZTE',     accent: '#06b6d4', bg: '#172a30', style: 'letter-spacing:2px;' },
    poco:    { label: 'POCO',    accent: '#facc15', bg: '#2c2817', style: 'letter-spacing:1.5px;background:#facc15;color:#111;padding:3px 10px;border-radius:6px;font-size:18px;' },
    oppo:    { label: 'oppo',    accent: '#10b981', bg: '#162b24', style: 'text-transform:lowercase;letter-spacing:2px;' },
    apple:   {
      label: `<svg width="20" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.33c.64-.78 1.08-1.86.96-2.94-.93.04-2.06.62-2.72 1.4-.58.68-1.1 1.78-.96 2.84 1.04.08 2.08-.52 2.72-1.3"/></svg> Apple`,
      accent: '#f8fafc',
      bg: '#232830',
      style: 'letter-spacing:0.3px;',
    },
  };

  const groups = new Map();
  for (const item of filtered) {
    const brand = item.brand || 'Other';
    if (!groups.has(brand)) groups.set(brand, []);
    groups.get(brand).push(item);
  }

  const grid = document.getElementById('catalogBrandGrid');
  const brandStrip = document.getElementById('catBrandStrip');
  const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
    const ra = BRAND_ORDER.indexOf(a[0].toLowerCase());
    const rb = BRAND_ORDER.indexOf(b[0].toLowerCase());
    const oa = ra < 0 ? BRAND_ORDER.length : ra;
    const ob = rb < 0 ? BRAND_ORDER.length : rb;
    return oa - ob || a[0].localeCompare(b[0]);
  });

  if (!groups.size) {
    if (brandStrip) brandStrip.classList.add('hidden');
    grid.className = 'brand-grid';
    grid.innerHTML = '<div class="muted small">No available units match this filter in this branch.</div>';
    return;
  }

  if (!isEditMode) {
    const selectedBrand = state.catalogSelectedBrand || 'ALL';
    if (selectedBrand !== 'ALL' && !groups.has(selectedBrand)) {
      state.catalogSelectedBrand = 'ALL';
    }
    const activeBrand = state.catalogSelectedBrand || 'ALL';

    if (brandStrip) {
      brandStrip.classList.remove('hidden');
      brandStrip.innerHTML = [
        `<button type="button" class="shopee-brand-chip ${activeBrand === 'ALL' ? 'active' : ''}" data-brand="ALL">All (${filtered.length})</button>`,
        ...sortedGroups.map(([b, list]) => {
          const t = BRAND_THEMES[b.toLowerCase()] || { label: b };
          const labelText = b.toLowerCase() === 'apple' ? 'Apple' : t.label;
          return `<button type="button" class="shopee-brand-chip ${activeBrand === b ? 'active' : ''}" data-brand="${b}">${labelText} (${list.length})</button>`;
        }),
      ].join('');
      brandStrip.querySelectorAll('.shopee-brand-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          state.catalogSelectedBrand = chip.dataset.brand;
          renderBranchCatalog();
        });
      });
    }

    const displayItems = activeBrand === 'ALL' ? filtered : (groups.get(activeBrand) || []);
    const cashPct = branch && /bonifacio/i.test(branch.name) ? 3 : 5;
    grid.className = 'shopee-grid';
    grid.innerHTML = displayItems
      .map((item) => {
        const theme = BRAND_THEMES[(item.brand || '').toLowerCase()] || { label: item.brand || '', accent: '#e7c55f' };
        const brandLabel = (item.brand || '').toLowerCase() === 'apple' ? 'Apple' : theme.label;
        const mo4 = calc4MoAmortization(item.basePrice, installmentRates);
        const imgHtml = item.imageUrl
          ? `<img src="${item.imageUrl}" alt="${item.name}" loading="lazy" />`
          : `<div style="font-size:40px;color:var(--gold);">📱</div>`;
        const installBanner = mo4 > 0
          ? `<div class="shopee-badge-installment"><span>4-Mo Est</span><span>${fmtCurrency(mo4)}/mo</span></div>`
          : '';
        return `
          <div class="shopee-card" data-calc-id="${item.productId}">
            <div class="shopee-thumb">
              ${imgHtml}
              <span class="shopee-badge-brand" style="color:${theme.accent};">${brandLabel}</span>
              <span class="shopee-badge-avail">Available</span>
              ${installBanner}
            </div>
            <div class="shopee-body">
              <div class="shopee-title"><img src="${LOGO_SQUARE_SRC}" alt="Logo" class="shopee-mall-logo" />${item.model}</div>
              <div>
                <div class="shopee-price-row">
                  <span class="shopee-price-main">${fmtCurrency(item.cashPrice)}</span>
                  <span class="shopee-discount-pill">-${cashPct}% Cash</span>
                </div>
                <div class="shopee-srp-sub">
                  <span>SRP ${fmtCurrency(item.basePrice)}</span>
                  <span style="color:var(--gold);">Installment ›</span>
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    grid.querySelectorAll('.shopee-card[data-calc-id]').forEach((card) => {
      card.addEventListener('click', () => {
        const item = catalog.find((c) => c.productId === card.dataset.calcId);
        if (item) openCustomerCalcModal(item, branch, installmentRates);
      });
    });
    return;
  }

  if (brandStrip) brandStrip.classList.add('hidden');
  grid.className = 'brand-grid';
  grid.innerHTML = sortedGroups
    .map(([brand, list]) => {
      const units = list.reduce((s, x) => s + x.branchAvailable, 0);
      const isExpanded = state.expandedCatalogBrands.has(brand);
      const allVisible = list.every((x) => x.isVisible);
      const theme = BRAND_THEMES[brand.toLowerCase()] || { label: brand, accent: '#e7c55f', bg: '#252c35', style: '' };

      const brandVisToggle = isEditMode
        ? `<label style="display:flex;align-items:center;gap:5px;margin:0;color:var(--text);font-size:11px;cursor:pointer;" onclick="event.stopPropagation()">
             <input type="checkbox" class="cat-brand-vis" data-brand="${brand}" ${allVisible ? 'checked' : ''} style="width:15px;height:15px;margin:0;accent-color:var(--gold);" />
             Visible
           </label>`
        : '';

      const cardsHtml = isExpanded
        ? list
            .map((item) => {
              const thumb = item.imageUrl
                ? `<img src="${item.imageUrl}" alt="${item.name}" style="width:52px;height:52px;object-fit:contain;background:#fff;border-radius:9px;padding:2px;flex:0 0 52px;box-shadow:0 2px 8px rgba(0,0,0,.3);" loading="lazy" />`
                : `<div style="width:52px;height:52px;border-radius:9px;background:#171c23;border:1px solid var(--border-soft);display:grid;place-items:center;color:var(--gold);font-size:20px;flex:0 0 52px;">📱</div>`;
              const mo4 = calc4MoAmortization(item.basePrice, installmentRates);
              const qtyCls = item.branchAvailable === 0 ? 'model-card-qty zero' : 'model-card-qty';
              const unitVisHtml = isEditMode
                ? `<label style="display:flex;align-items:center;gap:5px;margin:0;color:var(--text);font-size:11px;cursor:pointer;">
                     <input type="checkbox" class="cat-unit-vis" data-id="${item.productId}" ${item.isVisible ? 'checked' : ''} style="width:15px;height:15px;margin:0;accent-color:var(--gold);" />
                     Visible
                   </label>`
                : `<span class="badge badge-ok">In Stock</span>`;
              const subCodeHtml = isEditMode ? `<div class="model-card-code">${item.websiteCodes}</div>` : '';
              const cardStyle = `${isEditMode && !item.isVisible ? 'opacity:0.55;' : ''}${!isEditMode ? 'cursor:pointer;' : ''}`;
              const calcAttr = !isEditMode ? `data-calc-id="${item.productId}"` : '';
              return `
                <div class="model-card" ${calcAttr} style="${cardStyle}">
                  <div class="model-card-head">
                    <div style="display:flex;gap:9px;align-items:center;min-width:0;">
                      ${thumb}
                      <div style="min-width:0;">
                        <div class="model-card-name">${item.model}</div>
                        ${subCodeHtml}
                      </div>
                    </div>
                    <div class="${qtyCls}">${item.branchAvailable} avail</div>
                  </div>
                  <div class="model-price-row" style="margin-top:8px;">
                    <span>SRP: <strong style="color:var(--gold-bright);">${fmtCurrency(item.basePrice)}</strong></span>
                    <span>Cash: <strong style="color:var(--green);">${fmtCurrency(item.cashPrice)}</strong></span>
                  </div>
                  <div class="model-price-row" style="padding-top:6px;border-top:1px solid rgba(255,255,255,.06);align-items:center;">
                    <span>4-Mo Est: <strong>${mo4 > 0 ? fmtCurrency(mo4) + '/mo' : '—'}</strong></span>
                    ${unitVisHtml}
                  </div>
                </div>
              `;
            })
            .join('')
        : '';

      const collapseBar = isExpanded
        ? `<div class="brand-collapse-bar"><button type="button" class="secondary cat-back-brands-btn" data-brand="${brand}">▲ Collapse ${theme.label} / Back to Brands</button></div>`
        : '';

      return `
        <div class="brand-group ${isExpanded ? 'expanded' : ''}">
          <button type="button" class="brand-tile cat-brand-tile" data-brand="${brand}" style="--brand-accent:${theme.accent};--brand-bg:${theme.bg};">
            <span class="brand-tile-name" style="${theme.style}">${theme.label}</span>
            <span style="display:flex;align-items:center;gap:12px;margin-top:${isExpanded ? '0' : '8px'};">
              ${brandVisToggle}
              <span class="brand-tile-meta" style="margin-top:0;">${fmtNum(list.length)} models • ${fmtNum(units)} units ${isExpanded ? '▲' : '▼'}</span>
            </span>
          </button>
          ${cardsHtml}
          ${collapseBar}
        </div>
      `;
    })
    .join('');

  grid.querySelectorAll('.cat-brand-tile').forEach((btn) => {
    btn.addEventListener('click', () => {
      const b = btn.dataset.brand;
      const wasExpanded = state.expandedCatalogBrands.has(b);
      if (wasExpanded) {
        state.expandedCatalogBrands.delete(b);
        renderBranchCatalog();
        document.getElementById('catalogBranchTabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        if (!isEditMode) state.expandedCatalogBrands.clear();
        state.expandedCatalogBrands.add(b);
        renderBranchCatalog();
        const expandedBtn = grid.querySelector(`.cat-brand-tile[data-brand="${b}"]`);
        expandedBtn?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });

  grid.querySelectorAll('.cat-back-brands-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.expandedCatalogBrands.delete(btn.dataset.brand);
      renderBranchCatalog();
      document.getElementById('catalogBranchTabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  grid.querySelectorAll('.cat-brand-vis').forEach((chk) => {
    chk.addEventListener('change', async (e) => {
      const list = groups.get(e.target.dataset.brand) || [];
      const ids = list.map((x) => x.productId);
      await api(`/api/catalog/branch/${state.catalogBranchId}/visibility`, {
        method: 'PATCH',
        body: JSON.stringify({ productIds: ids, isVisible: e.target.checked }),
      });
      await loadBranchCatalog();
    });
  });

  grid.querySelectorAll('.cat-unit-vis').forEach((chk) => {
    chk.addEventListener('change', async (e) => {
      await api(`/api/catalog/branch/${state.catalogBranchId}/visibility`, {
        method: 'PATCH',
        body: JSON.stringify({ productIds: [e.target.dataset.id], isVisible: e.target.checked }),
      });
      await loadBranchCatalog();
    });
  });

  if (!isEditMode) {
    grid.querySelectorAll('.model-card[data-calc-id]').forEach((card) => {
      card.addEventListener('click', () => {
        const item = catalog.find((c) => c.productId === card.dataset.calcId);
        if (item) openCustomerCalcModal(item, branch, installmentRates);
      });
    });
  }
}

const calcModalState = {
  item: null,
  branch: null,
  rates: [],
  photos: [],
  photoIdx: 0,
  selectedMonths: null,
};

function computeInstallmentPlan(srp, dp, months, monthlyRate) {
  const balance = Math.max(0, srp - dp);
  const rawMonthly = (balance + balance * monthlyRate * months) / months;
  const monthlyAmortization = Math.ceil((rawMonthly - 1e-9) / 5) * 5;
  const rebate = Math.round(monthlyAmortization * 0.025);
  const onTimePayment = monthlyAmortization - rebate;
  const totalInstallments = monthlyAmortization * months;
  const totalInterestPayable = totalInstallments - balance;
  const totalContractPrice = dp + totalInstallments;
  const totalWithRebates = dp + onTimePayment * months;
  return {
    months,
    monthlyRate,
    dp,
    balance,
    monthlyAmortization,
    rebate,
    onTimePayment,
    totalInstallments,
    totalInterestPayable,
    totalContractPrice,
    totalWithRebates,
  };
}

function renderCalcModalPhoto() {
  const img = document.getElementById('calcModalImg');
  const noImg = document.getElementById('calcModalNoImg');
  const zoomBtn = document.getElementById('calcZoomBtn');
  const nav = document.getElementById('calcPhotoNav');
  const count = document.getElementById('calcPhotoCount');
  const photos = calcModalState.photos;

  if (!photos.length) {
    img.classList.add('hidden');
    img.removeAttribute('src');
    noImg.classList.remove('hidden');
    zoomBtn.classList.add('hidden');
    nav.classList.add('hidden');
    return;
  }

  noImg.classList.add('hidden');
  img.classList.remove('hidden');
  zoomBtn.classList.remove('hidden');
  img.src = photos[calcModalState.photoIdx];
  if (photos.length > 1) {
    nav.classList.remove('hidden');
    count.textContent = `${calcModalState.photoIdx + 1} / ${photos.length}`;
  } else {
    nav.classList.add('hidden');
  }
}

function renderCalcBreakdown(plan) {
  const box = document.getElementById('calcBreakdownBox');
  if (!plan) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = `
    <div style="font-weight:700;color:var(--gold-bright);margin-bottom:8px;">${plan.months}-Month Summary</div>
    <div class="calc-bd-row"><span>Down Payment</span><strong>${fmtCurrency(plan.dp)}</strong></div>
    <div class="calc-bd-row"><span>Monthly Payment</span><strong>${fmtCurrency(plan.monthlyAmortization)} / mo</strong></div>
    <div class="calc-bd-row"><span>On-Time Payment (2.5% Rebate)</span><strong style="color:var(--green);">${fmtCurrency(plan.onTimePayment)} / mo</strong></div>
    <div class="calc-bd-row" style="border-top:1px solid rgba(255,255,255,0.1);padding-top:6px;margin-top:4px;">
      <span>Total Contract Price</span><strong>${fmtCurrency(plan.totalContractPrice)}</strong>
    </div>
    <div class="calc-bd-row">
      <span>Total if Paid On Time</span><strong style="color:var(--gold-bright);">${fmtCurrency(plan.totalWithRebates)}</strong>
    </div>
  `;
}

function parseCommaNum(val) {
  const cleaned = String(val || '').replace(/[^\d]/g, '');
  return cleaned === '' ? NaN : Number(cleaned);
}

function formatCommaInput(el) {
  const cleaned = String(el.value || '').replace(/[^\d]/g, '');
  el.value = cleaned === '' ? '' : Number(cleaned).toLocaleString('en-PH');
  return cleaned === '' ? NaN : Number(cleaned);
}

function renderCalcTerms() {
  const item = calcModalState.item;
  const grid = document.getElementById('calcTermsGrid');
  const errEl = document.getElementById('calcDpError');
  const dpInput = document.getElementById('calcDpInput');
  if (!item) return;

  const srp = Number(item.basePrice) || 0;
  const minDp = suggestedDownPayment(srp);
  const dpVal = parseCommaNum(dpInput.value);

  if (!Number.isFinite(dpVal) || dpVal < minDp || dpVal >= srp) {
    errEl.textContent = srp > 0
      ? `Enter a down payment between ${fmtCurrency(minDp)} and ${fmtCurrency(Math.max(minDp, srp - 1))}.`
      : 'Pricing unavailable for this unit.';
    errEl.classList.remove('hidden');
    grid.innerHTML = '';
    renderCalcBreakdown(null);
    return;
  }

  errEl.classList.add('hidden');
  const rates = (calcModalState.rates || []).slice().sort((a, b) => a.months - b.months);
  if (!rates.length) {
    grid.innerHTML = '<div class="muted">No installment terms configured.</div>';
    renderCalcBreakdown(null);
    return;
  }

  if (!calcModalState.selectedMonths || !rates.some((r) => r.months === calcModalState.selectedMonths)) {
    calcModalState.selectedMonths = rates[0].months;
  }

  const plans = rates.map((r) => computeInstallmentPlan(srp, dpVal, r.months, Number(r.monthly_rate) || 0));
  grid.innerHTML = plans
    .map((p) => {
      const active = p.months === calcModalState.selectedMonths;
      return `
        <button type="button" class="calc-term-card ${active ? 'active' : ''}" data-months="${p.months}">
          <div class="calc-term-badge">${p.months} Months</div>
          <div style="font-size:1.15rem;font-weight:800;color:var(--gold-bright);">${fmtCurrency(p.monthlyAmortization)}<span style="font-size:0.75rem;font-weight:500;color:var(--muted);">/mo</span></div>
          <div style="font-size:0.78rem;color:var(--green);margin-top:3px;">On-time: ${fmtCurrency(p.onTimePayment)}/mo</div>
        </button>
      `;
    })
    .join('');

  grid.querySelectorAll('.calc-term-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      calcModalState.selectedMonths = Number(btn.dataset.months);
      renderCalcTerms();
    });
  });

  const activePlan = plans.find((p) => p.months === calcModalState.selectedMonths) || plans[0];
  renderCalcBreakdown(activePlan);
}

function openCustomerCalcModal(item, branch, installmentRates) {
  const modal = document.getElementById('customerCalcModal');
  const srp = Number(item.basePrice) || 0;
  const minDp = suggestedDownPayment(srp);
  const cashDiscountPct = branch && /bonifacio/i.test(branch.name) ? 3 : 5;

  calcModalState.item = item;
  calcModalState.branch = branch;
  calcModalState.rates = installmentRates || [];
  calcModalState.photos = Array.isArray(item.imageUrls) && item.imageUrls.length
    ? item.imageUrls
    : (item.imageUrl ? [item.imageUrl] : []);
  calcModalState.photoIdx = 0;
  calcModalState.selectedMonths = 4;

  document.getElementById('calcModalTitle').textContent = `${item.brand ? item.brand + ' ' : ''}${item.model}`;
  document.getElementById('calcModalSub').textContent = `${branch ? branch.name : ''} • ${item.branchAvailable > 0 ? 'Available' : 'Out of stock'}`;
  document.getElementById('calcSrpText').textContent = fmtCurrency(srp);
  document.getElementById('calcCashText').textContent = `${fmtCurrency(item.cashPrice)} (${cashDiscountPct}% off)`;
  document.getElementById('calcMinDpText').textContent = `Min DP: ${fmtCurrency(minDp)}`;

  const dpInput = document.getElementById('calcDpInput');
  dpInput.value = fmtNum(minDp);

  renderCalcModalPhoto();
  renderCalcTerms();
  modal.classList.remove('hidden');
}

document.getElementById('closeCalcModalBtn').addEventListener('click', () => {
  document.getElementById('customerCalcModal').classList.add('hidden');
});
document.getElementById('customerCalcModal').addEventListener('click', (e) => {
  if (e.target.id === 'customerCalcModal') {
    document.getElementById('customerCalcModal').classList.add('hidden');
  }
});
document.getElementById('calcPrevPhoto').addEventListener('click', () => {
  if (!calcModalState.photos.length) return;
  calcModalState.photoIdx = (calcModalState.photoIdx - 1 + calcModalState.photos.length) % calcModalState.photos.length;
  renderCalcModalPhoto();
});
document.getElementById('calcNextPhoto').addEventListener('click', () => {
  if (!calcModalState.photos.length) return;
  calcModalState.photoIdx = (calcModalState.photoIdx + 1) % calcModalState.photos.length;
  renderCalcModalPhoto();
});
document.getElementById('calcDpInput').addEventListener('input', (e) => {
  formatCommaInput(e.target);
  renderCalcTerms();
});

const lightboxState = {
  scale: 1,
  tx: 0,
  ty: 0,
  dragging: false,
  startX: 0,
  startY: 0,
  pinchDist: 0,
  pinchScale: 1,
};

function applyLightboxTransform() {
  const wrap = document.getElementById('lightboxMediaWrap');
  const img = document.getElementById('lightboxImg');
  const pct = document.getElementById('lightboxZoomPct');
  if (lightboxState.scale <= 1) {
    lightboxState.scale = 1;
    lightboxState.tx = 0;
    lightboxState.ty = 0;
  }
  wrap.style.transform = `translate(${lightboxState.tx}px, ${lightboxState.ty}px) scale(${lightboxState.scale})`;
  img.style.cursor = lightboxState.scale > 1 ? 'grab' : 'zoom-in';
  pct.textContent = `${Math.round(lightboxState.scale * 100)}%`;
}

function setLightboxZoom(nextScale) {
  lightboxState.scale = Math.min(4, Math.max(1, nextScale));
  applyLightboxTransform();
}

function renderLightboxPhoto() {
  const photos = calcModalState.photos || [];
  if (!photos.length) return;
  const img = document.getElementById('lightboxImg');
  const count = document.getElementById('lightboxCount');
  const prevBtn = document.getElementById('lightboxPrev');
  const nextBtn = document.getElementById('lightboxNext');

  img.src = photos[calcModalState.photoIdx];
  count.textContent = photos.length > 1 ? `Photo ${calcModalState.photoIdx + 1} of ${photos.length}` : '1 photo';
  prevBtn.classList.toggle('hidden', photos.length <= 1);
  nextBtn.classList.toggle('hidden', photos.length <= 1);

  lightboxState.scale = 1;
  lightboxState.tx = 0;
  lightboxState.ty = 0;
  applyLightboxTransform();
}

function openPhotoLightbox() {
  const photos = calcModalState.photos || [];
  if (!photos.length) return;
  const item = calcModalState.item;
  document.getElementById('lightboxTitle').textContent = item ? `${item.brand ? item.brand + ' ' : ''}${item.model}` : 'Photo';
  renderLightboxPhoto();
  document.getElementById('photoLightboxModal').classList.remove('hidden');
}

document.getElementById('calcModalImg').addEventListener('click', openPhotoLightbox);
document.getElementById('calcZoomBtn').addEventListener('click', openPhotoLightbox);
document.getElementById('closeLightboxBtn').addEventListener('click', () => {
  document.getElementById('photoLightboxModal').classList.add('hidden');
});
document.getElementById('lightboxZoomIn').addEventListener('click', () => setLightboxZoom(lightboxState.scale + 0.5));
document.getElementById('lightboxZoomOut').addEventListener('click', () => setLightboxZoom(lightboxState.scale - 0.5));
document.getElementById('lightboxZoomReset').addEventListener('click', () => setLightboxZoom(1));
document.getElementById('lightboxPrev').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!calcModalState.photos.length) return;
  calcModalState.photoIdx = (calcModalState.photoIdx - 1 + calcModalState.photos.length) % calcModalState.photos.length;
  renderCalcModalPhoto();
  renderLightboxPhoto();
});
document.getElementById('lightboxNext').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!calcModalState.photos.length) return;
  calcModalState.photoIdx = (calcModalState.photoIdx + 1) % calcModalState.photos.length;
  renderCalcModalPhoto();
  renderLightboxPhoto();
});

const lightboxStageEl = document.getElementById('lightboxStage');
const lightboxImgEl = document.getElementById('lightboxImg');
lightboxStageEl.addEventListener('click', (e) => {
  if (e.target === lightboxStageEl) {
    document.getElementById('photoLightboxModal').classList.add('hidden');
  }
});
lightboxImgEl.addEventListener('dblclick', (e) => {
  e.preventDefault();
  setLightboxZoom(lightboxState.scale > 1.1 ? 1 : 2.2);
});
lightboxStageEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  setLightboxZoom(lightboxState.scale + (e.deltaY < 0 ? 0.25 : -0.25));
}, { passive: false });

lightboxImgEl.addEventListener('mousedown', (e) => {
  if (lightboxState.scale <= 1) return;
  lightboxState.dragging = true;
  lightboxState.startX = e.clientX - lightboxState.tx;
  lightboxState.startY = e.clientY - lightboxState.ty;
  lightboxImgEl.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', (e) => {
  if (!lightboxState.dragging) return;
  lightboxState.tx = e.clientX - lightboxState.startX;
  lightboxState.ty = e.clientY - lightboxState.startY;
  applyLightboxTransform();
});
window.addEventListener('mouseup', () => {
  if (!lightboxState.dragging) return;
  lightboxState.dragging = false;
  applyLightboxTransform();
});

let lbSwipeStartX = null;
lightboxStageEl.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    lightboxState.pinchDist = Math.hypot(dx, dy);
    lightboxState.pinchScale = lightboxState.scale;
    lightboxState.dragging = false;
    lbSwipeStartX = null;
  } else if (e.touches.length === 1 && lightboxState.scale > 1) {
    lightboxState.dragging = true;
    lightboxState.startX = e.touches[0].clientX - lightboxState.tx;
    lightboxState.startY = e.touches[0].clientY - lightboxState.ty;
    lbSwipeStartX = null;
  } else if (e.touches.length === 1) {
    lbSwipeStartX = e.touches[0].clientX;
  }
}, { passive: true });
lightboxStageEl.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && lightboxState.pinchDist > 0) {
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    setLightboxZoom(lightboxState.pinchScale * (dist / lightboxState.pinchDist));
  } else if (e.touches.length === 1 && lightboxState.dragging) {
    e.preventDefault();
    lightboxState.tx = e.touches[0].clientX - lightboxState.startX;
    lightboxState.ty = e.touches[0].clientY - lightboxState.startY;
    applyLightboxTransform();
  }
}, { passive: false });
lightboxStageEl.addEventListener('touchend', (e) => {
  if (lbSwipeStartX !== null && lightboxState.scale <= 1 && calcModalState.photos.length > 1 && e.changedTouches?.length) {
    const dx = e.changedTouches[0].clientX - lbSwipeStartX;
    if (Math.abs(dx) > 40) {
      calcModalState.photoIdx = dx < 0
        ? (calcModalState.photoIdx + 1) % calcModalState.photos.length
        : (calcModalState.photoIdx - 1 + calcModalState.photos.length) % calcModalState.photos.length;
      renderCalcModalPhoto();
      renderLightboxPhoto();
    }
  }
  lbSwipeStartX = null;
  lightboxState.dragging = false;
  lightboxState.pinchDist = 0;
});

const calcPhotoBoxEl = document.querySelector('.calc-photo-box');
if (calcPhotoBoxEl) {
  let calcSwipeX = null;
  calcPhotoBoxEl.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) calcSwipeX = e.touches[0].clientX;
  }, { passive: true });
  calcPhotoBoxEl.addEventListener('touchend', (e) => {
    if (calcSwipeX !== null && calcModalState.photos.length > 1 && e.changedTouches?.length) {
      const dx = e.changedTouches[0].clientX - calcSwipeX;
      if (Math.abs(dx) > 35) {
        calcModalState.photoIdx = dx < 0
          ? (calcModalState.photoIdx + 1) % calcModalState.photos.length
          : (calcModalState.photoIdx - 1 + calcModalState.photos.length) % calcModalState.photos.length;
        renderCalcModalPhoto();
      }
    }
    calcSwipeX = null;
  });
}

document.querySelectorAll('.cat-branch-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.cat-branch-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.catalogBranchId = btn.dataset.branch;
    await loadBranchCatalog();
  });
});
document.getElementById('catEditMode').addEventListener('change', renderBranchCatalog);
document.getElementById('catProductType').addEventListener('change', renderBranchCatalog);
document.getElementById('catPriceRange').addEventListener('change', renderBranchCatalog);
document.getElementById('catRamRom').addEventListener('change', renderBranchCatalog);
document.getElementById('catPriceSortBtn').addEventListener('click', () => {
  state.catalogPriceSort = state.catalogPriceSort === 'desc' ? 'asc' : 'desc';
  renderBranchCatalog();
});
document.getElementById('catIncludeUnavailable').addEventListener('change', renderBranchCatalog);
document.getElementById('catSelectAllVisible').addEventListener('change', async (e) => {
  const ids = state.lastFilteredCatalogIds || [];
  if (!ids.length) return;
  await api(`/api/catalog/branch/${state.catalogBranchId}/visibility`, {
    method: 'PATCH',
    body: JSON.stringify({ productIds: ids, isVisible: e.target.checked }),
  });
  await loadBranchCatalog();
});

document.querySelectorAll('.publish-github-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Publishing...';
    const catMsg = document.getElementById('publishCatalogMsg');
    const photoMsg = document.getElementById('photoMsg');
    try {
      const res = await api('/api/catalog/publish-github', { method: 'POST', body: '{}' });
      if (catMsg) catMsg.textContent = res.message;
      if (photoMsg) photoMsg.textContent = res.message;
      btn.textContent = '✓ Published!';
      setTimeout(() => { btn.textContent = origText; }, 3000);
    } catch (err) {
      const errText = `Publish failed: ${err.message}`;
      if (catMsg) catMsg.textContent = errText;
      if (photoMsg) photoMsg.textContent = errText;
      alert(errText);
      btn.textContent = origText;
    } finally {
      btn.disabled = false;
    }
  });
});

async function loadSyncLogs() {
  const data = await api('/api/sync/status');
  updateSyncPill(data.state);
  document.getElementById('adapterModeBadge').textContent = data.state.adapterMode;

  document.querySelector('#syncLogsTable tbody').innerHTML = data.logs
    .map((l) => `
      <tr>
        <td>${fmtTime(l.created_at)}</td>
        <td><span class="badge ${l.status === 'OK' ? 'badge-ok' : 'badge-danger'}">${l.status}</span></td>
        <td>${l.records_updated}</td>
        <td>${l.session_refreshed ? '<span class="badge badge-info">Auto Re-Authed</span>' : 'Active'}</td>
        <td>${l.message}</td>
      </tr>`).join('');
}

async function loadActivity() {
  const start = document.getElementById('actStart').value;
  const end = document.getElementById('actEnd').value;
  const globalBranch = document.getElementById('globalBranch').value;
  if (globalBranch) state.actBranchFilter = globalBranch;
  const [activity, catalogViews] = await Promise.all([
    api(`/api/activity?start=${start}&end=${end}`),
    api('/api/catalog/views').catch(() => null),
  ]);
  state.activity = activity;
  state.catalogViews = catalogViews;
  renderActivity();
}

function renderActivity() {
  const data = state.activity;
  if (!data) return;

  const pType = state.actProductType;
  const mode = state.actSaleMode;
  const branchFilter = state.actBranchFilter;

  const filterMovementType = (m) => pType === 'ALL' || (m.product_type || 'Cellphones') === pType;
  const isCashSale = (m) => m.delta_qty < 0 && m.movement_type.includes('SALE');

  // Compute clickable branch sold totals (Installment mode counts installment sales; otherwise cash/all sales)
  const soldByBranch = { 'br-molave': 0, 'br-tambulig': 0, 'br-bonifacio': 0 };
  if (mode === 'INSTALLMENT') {
    if (pType !== 'Accessories') {
      for (const i of data.allInstallments || []) {
        if (soldByBranch[i.branch_id] !== undefined) soldByBranch[i.branch_id] += 1;
      }
    }
  } else {
    for (const m of data.allMovements || []) {
      if (isCashSale(m) && filterMovementType(m) && soldByBranch[m.branch_id] !== undefined) {
        soldByBranch[m.branch_id] += Math.abs(m.delta_qty);
      }
    }
  }

  const totalSold = Object.values(soldByBranch).reduce((a, b) => a + b, 0);
  const views = state.catalogViews?.byBranch || {};
  const vMol = views['br-molave'] || { total: 0, weekly: 0, monthly: 0 };
  const vTam = views['br-tambulig'] || { total: 0, weekly: 0, monthly: 0 };
  const vBon = views['br-bonifacio'] || { total: 0, weekly: 0, monthly: 0 };
  const vTot = state.catalogViews || { total: 0, weekly: 0, monthly: 0 };
  const viewsGrid = document.getElementById('activityViewsGrid');
  if (viewsGrid) {
    viewsGrid.innerHTML = `
      <div class="summary-box">
        Molave CATALOG VIEWS<strong>${fmtNum(vMol.total)} views</strong>
        <span class="summary-note">7d: ${fmtNum(vMol.weekly)} • 30d: ${fmtNum(vMol.monthly)}</span>
      </div>
      <div class="summary-box">
        Tambulig CATALOG VIEWS<strong>${fmtNum(vTam.total)} views</strong>
        <span class="summary-note">7d: ${fmtNum(vTam.weekly)} • 30d: ${fmtNum(vTam.monthly)}</span>
      </div>
      <div class="summary-box">
        Bonifacio CATALOG VIEWS<strong>${fmtNum(vBon.total)} views</strong>
        <span class="summary-note">7d: ${fmtNum(vBon.weekly)} • 30d: ${fmtNum(vBon.monthly)}</span>
      </div>
      <div class="summary-box">
        ALL CATALOG VIEWS<strong>${fmtNum(vTot.total)} views</strong>
        <span class="summary-note">7d: ${fmtNum(vTot.weekly)} • 30d: ${fmtNum(vTot.monthly)}</span>
      </div>
    `;
  }
  document.getElementById('activitySalesGrid').innerHTML = `
    <button type="button" class="summary-box act-summary-btn ${branchFilter === 'br-molave' ? 'active' : ''}" data-branch="br-molave">
      Molave SOLD<strong>${fmtNum(soldByBranch['br-molave'] || 0)} pcs</strong>
    </button>
    <button type="button" class="summary-box act-summary-btn ${branchFilter === 'br-tambulig' ? 'active' : ''}" data-branch="br-tambulig">
      Tambulig SOLD<strong>${fmtNum(soldByBranch['br-tambulig'] || 0)} pcs</strong>
    </button>
    <button type="button" class="summary-box act-summary-btn ${branchFilter === 'br-bonifacio' ? 'active' : ''}" data-branch="br-bonifacio">
      Bonifacio SOLD<strong>${fmtNum(soldByBranch['br-bonifacio'] || 0)} pcs</strong>
    </button>
    <button type="button" class="summary-box act-summary-btn ${branchFilter === '' ? 'active' : ''}" data-branch="">
      ALL BRANCHES<strong>${fmtNum(totalSold)} pcs</strong>
    </button>
  `;

  document.querySelectorAll('.act-summary-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.actBranchFilter = btn.dataset.branch;
      renderActivity();
    });
  });

  const dpBox = document.getElementById('installmentDpSummary');
  const thead = document.querySelector('#activityTable thead');
  const tbody = document.querySelector('#activityTable tbody');

  if (mode === 'INSTALLMENT') {
    const instList = (data.allInstallments || []).filter((i) => {
      if (pType === 'Accessories') return false;
      return !branchFilter || i.branch_id === branchFilter;
    });
    const totalDp = instList.reduce((s, i) => s + (Number(i.deposit) || 0), 0);
    dpBox.classList.remove('hidden');
    document.getElementById('installmentCountNote').textContent = `${instList.length} installment sale(s)`;
    document.getElementById('totalDownpaymentVal').textContent = fmtCurrency(totalDp);

    thead.innerHTML = `
      <tr>
        <th>Date</th>
        <th>Branch</th>
        <th>Unit</th>
        <th>Term</th>
        <th>Downpayment</th>
        <th>Monthly</th>
        <th>Contract Amt</th>
      </tr>`;
    tbody.innerHTML = instList.length
      ? instList
          .map(
            (i) => `
          <tr>
            <td>${i.sale_date}</td>
            <td>${i.branch_name}</td>
            <td><strong>${i.unit}</strong></td>
            <td>${i.term} mos</td>
            <td style="color:var(--green);"><strong>${fmtCurrency(i.deposit)}</strong></td>
            <td>${fmtCurrency(i.monthly)}</td>
            <td>${fmtCurrency(i.amount)}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="7" class="muted">No installment sales in this date range / filter.</td></tr>';
  } else {
    dpBox.classList.add('hidden');
    const movList = (data.allMovements || []).filter((m) => {
      if (branchFilter && m.branch_id !== branchFilter) return false;
      if (!filterMovementType(m)) return false;
      if (mode === 'CASH') return isCashSale(m);
      return true;
    });

    thead.innerHTML = `
      <tr>
        <th>Time</th>
        <th>Branch</th>
        <th>Product</th>
        <th>Category</th>
        <th>Type</th>
        <th>Delta</th>
      </tr>`;
    tbody.innerHTML = movList.length
      ? movList
          .map(
            (m) => `
          <tr>
            <td>${fmtTime(m.recorded_at)}</td>
            <td>${m.branch_name}</td>
            <td>${m.product_name}</td>
            <td><span class="badge badge-info">${m.product_type || 'Cellphones'}</span></td>
            <td>${m.movement_type}</td>
            <td><strong>${m.delta_qty > 0 ? '+' + m.delta_qty : m.delta_qty}</strong></td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="muted">No activity recorded for this filter.</td></tr>';
  }
}

document.querySelectorAll('.act-type-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.act-type-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.actProductType = btn.dataset.type;
    renderActivity();
  });
});

document.querySelectorAll('.act-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.act-mode-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.actSaleMode = btn.dataset.mode;
    renderActivity();
  });
});

function updateSyncPill(s) {
  if (!s) return;
  state.syncState = s;
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncStatusText');
  const toggleBtn = document.getElementById('toggleSyncBtn');

  dot.className = 'dot' + (s.paused ? ' paused' : s.lastStatus === 'ERROR' ? ' error' : '');
  if (s.isSyncing) txt.textContent = 'Syncing portal...';
  else if (s.paused) txt.textContent = `Paused • ${fmtTime(s.lastSyncAt)}`;
  else txt.textContent = `${s.adapterMode} • Last: ${fmtTime(s.lastSyncAt)}`;
  toggleBtn.textContent = s.paused ? 'Resume' : 'Pause';
}

// Event bindings
document.getElementById('globalBranch').addEventListener('change', () => {
  renderInventory();
  renderHealth();
  renderPlanning();
  loadActivity();
  loadFinance();
  loadReceivables();
});
document.getElementById('invSearch').addEventListener('input', renderInventory);
document.getElementById('invCategory').addEventListener('change', renderInventory);
document.getElementById('stockViewSelect').addEventListener('change', renderInventory);

document.querySelectorAll('input[name="productType"]').forEach((r) => {
  r.addEventListener('change', () => {
    document.querySelectorAll('#productTypeFilter .stock-view-option').forEach((lbl) => lbl.classList.remove('selected'));
    r.closest('.stock-view-option').classList.add('selected');
    renderInventory();
  });
});

document.getElementById('cardGroupingMode').addEventListener('change', renderInventory);

async function runBulkGroup(payload) {
  const ids = Array.from(state.selectedProducts);
  if (!ids.length) return;
  await api('/api/products/group', {
    method: 'PATCH',
    body: JSON.stringify({ productIds: ids, ...payload }),
  });
  state.selectedProducts.clear();
  await loadInventory();
}

document.getElementById('bulkToCellphonesBtn').addEventListener('click', () => runBulkGroup({ productType: 'Cellphones' }));
document.getElementById('bulkToAccessoriesBtn').addEventListener('click', () => runBulkGroup({ productType: 'Accessories' }));
document.getElementById('bulkSetBrandBtn').addEventListener('click', () => {
  const brand = document.getElementById('bulkBrandInput').value.trim();
  if (brand) {
    runBulkGroup({ brand });
    document.getElementById('bulkBrandInput').value = '';
  }
});
document.getElementById('bulkClearBtn').addEventListener('click', () => {
  state.selectedProducts.clear();
  renderInventory();
});

document.getElementById('showHiddenToggle').addEventListener('change', renderBranchCatalog);
document.getElementById('costProduct').addEventListener('change', syncCostInputs);
document.getElementById('recAction').addEventListener('change', (e) => {
  document.getElementById('recDestWrap').classList.toggle('hidden', e.target.value !== 'Stock swap');
});

document.getElementById('saveLifecycleBtn').addEventListener('click', async () => {
  const productId = document.getElementById('lifecycleProduct').value;
  const status = document.getElementById('lifecycleStatus').value;
  const msg = document.getElementById('lifecycleMsg');
  try {
    await api('/api/products/lifecycle', { method: 'PATCH', body: JSON.stringify({ productIds: [productId], status }) });
    msg.textContent = `Updated lifecycle to ${status}.`;
    await Promise.all([loadInventory(), loadPlanning()]);
  } catch (err) { msg.textContent = err.message; }
});

document.getElementById('saveMovementBtn').addEventListener('click', async () => {
  const msg = document.getElementById('recMsg');
  try {
    await api('/api/movements', {
      method: 'POST',
      body: JSON.stringify({
        branchId: document.getElementById('recBranch').value,
        productId: document.getElementById('recProduct').value,
        action: document.getElementById('recAction').value,
        quantity: document.getElementById('recQty').value,
        destinationBranchId: document.getElementById('recDestBranch').value,
      }),
    });
    msg.textContent = 'Stock change saved.';
    document.getElementById('recQty').value = '';
    await Promise.all([loadInventory(), loadPlanning(), loadActivity()]);
  } catch (err) { msg.textContent = err.message; }
});

document.getElementById('savePriceBtn').addEventListener('click', async () => {
  const msg = document.getElementById('priceMsg');
  try {
    await api('/api/products/price', {
      method: 'PATCH',
      body: JSON.stringify({
        productId: document.getElementById('priceProduct').value,
        newPrice: document.getElementById('priceNewVal').value,
      }),
    });
    msg.textContent = 'Selling price updated.';
    await loadInventory();
  } catch (err) { msg.textContent = err.message; }
});

document.getElementById('saveAddProductBtn').addEventListener('click', async () => {
  const msg = document.getElementById('addMsg');
  try {
    await api('/api/products', {
      method: 'POST',
      body: JSON.stringify({
        branchId: document.getElementById('addBranch').value,
        brand: document.getElementById('addBrand').value,
        model: document.getElementById('addModel').value,
        websiteCodes: document.getElementById('addCode').value,
        price: document.getElementById('addPrice').value,
        quantity: document.getElementById('addQty').value,
      }),
    });
    msg.textContent = 'Product added.';
    await loadInventory();
  } catch (err) { msg.textContent = err.message; }
});

document.getElementById('saveCostBtn').addEventListener('click', async () => {
  const msg = document.getElementById('costMsg');
  try {
    const res = await api('/api/products/costs', {
      method: 'PATCH',
      body: JSON.stringify({
        productId: document.getElementById('costProduct').value,
        costAb: document.getElementById('costAb').value,
        costAk: document.getElementById('costAk').value,
        costOnline: document.getElementById('costOnline').value,
      }),
    });
    msg.textContent = `Saved! Best supplier: ${res.bestSupplier} (${fmtCurrency(res.bestCost)})`;
    await Promise.all([loadInventory(), loadPlanning()]);
  } catch (err) { msg.textContent = err.message; }
});

async function loadFinance() {
  const start = document.getElementById('finStart').value;
  const end = document.getElementById('finEnd').value;
  const branchId = document.getElementById('globalBranch').value;
  const data = await api(`/api/finance/summary?start=${start}&end=${end}&branchId=${branchId}`);

  const t = data.totals;
  document.getElementById('financeKpiGrid').innerHTML = `
    <div class="summary-box">
      TOTAL COLLECTIONS
      <strong>${fmtCurrency(t.collections)}</strong>
      <span class="summary-note">Principal: ${fmtCurrency(t.principal)}</span>
    </div>
    <div class="summary-box">
      FINANCING INCOME
      <strong style="color:var(--green);">${fmtCurrency(t.financingIncome)}</strong>
      <span class="summary-note">Interest + Penalties − Rebates</span>
    </div>
    <div class="summary-box">
      TOTAL EXPENSES
      <strong style="color:var(--danger);">${fmtCurrency(t.expenses)}</strong>
      <span class="summary-note">${data.expensesByType.length} expense categories</span>
    </div>
    <div class="summary-box">
      NET CASH FLOW
      <strong style="color:${t.netCashFlow >= 0 ? 'var(--green)' : 'var(--danger)'};">${fmtCurrency(t.netCashFlow)}</strong>
      <span class="summary-note">Collections − Expenses</span>
    </div>
  `;

  document.querySelector('#financeBranchTable tbody').innerHTML = data.byBranch
    .map((b) => `
      <tr>
        <td><strong>${b.branchName}</strong></td>
        <td>${fmtCurrency(b.collections)}</td>
        <td style="color:var(--green);">${fmtCurrency(b.financingIncome)}</td>
        <td style="color:var(--danger);">${fmtCurrency(b.expenses)}</td>
        <td><strong style="color:${b.netCashFlow >= 0 ? 'var(--green)' : 'var(--danger)'};">${fmtCurrency(b.netCashFlow)}</strong></td>
      </tr>`)
    .join('');

  document.querySelector('#financeExpenseTypeTable tbody').innerHTML = data.expensesByType.length
    ? data.expensesByType
        .map((e) => `<tr><td>${e.expenseType}</td><td><strong>${fmtCurrency(e.amount)}</strong></td></tr>`)
        .join('')
    : '<tr><td colspan="2" class="muted">No expenses synced for this date range yet.</td></tr>';

  document.querySelector('#financePaymentsTable tbody').innerHTML = data.recentPayments.length
    ? data.recentPayments
        .map((p) => `
          <tr>
            <td>${p.payment_date}</td>
            <td>${p.branch_name}</td>
            <td><strong>${p.customer_name}</strong><div class="small muted">${p.account_no}</div></td>
            <td><strong>${fmtCurrency(p.amount)}</strong></td>
            <td>${fmtCurrency(p.principal)}</td>
            <td style="color:var(--green);">${fmtCurrency(p.interest)}</td>
          </tr>`)
        .join('')
    : '<tr><td colspan="6" class="muted">No payments synced yet (click Sync Now).</td></tr>';

  document.querySelector('#financeExpensesTable tbody').innerHTML = data.recentExpenses.length
    ? data.recentExpenses
        .map((e) => `
          <tr>
            <td>${e.expense_date}</td>
            <td>${e.branch_name}</td>
            <td>${e.expense_type}</td>
            <td>${e.particular}</td>
            <td style="color:var(--danger);"><strong>${fmtCurrency(e.amount)}</strong></td>
          </tr>`)
        .join('')
    : '<tr><td colspan="5" class="muted">No expenses synced yet (click Sync Now).</td></tr>';
}

async function loadReceivables() {
  const branchId = document.getElementById('globalBranch').value;
  state.receivables = await api(`/api/receivables/summary?branchId=${branchId}`);
  renderReceivables();
}

function renderReceivables() {
  const data = state.receivables;
  if (!data) return;
  const t = data.totals;
  const q = document.getElementById('recSearchInput').value.trim().toLowerCase();

  document.getElementById('receivablesKpiGrid').innerHTML = `
    <div class="summary-box">
      INSTALLMENT PORTFOLIO
      <strong>${fmtCurrency(t.totalPortfolio)}</strong>
      <span class="summary-note">${fmtNum(t.installmentCount)} active contract(s)</span>
    </div>
    <div class="summary-box">
      PRINCIPAL FINANCED
      <strong>${fmtCurrency(t.totalPrincipal)}</strong>
      <span class="summary-note">Deposits: ${fmtCurrency(t.totalDeposits)}</span>
    </div>
    <div class="summary-box">
      EXPECTED MONTHLY
      <strong style="color:var(--green);">${fmtCurrency(t.totalMonthlyExpected)}</strong>
      <span class="summary-note">Combined monthly billing</span>
    </div>
    <div class="summary-box">
      OVERALL PAST-DUE ACCOUNTS
      <strong style="color:var(--gold-bright);">${fmtNum(t.dueAccountsCount)}</strong>
      <span class="summary-note">Tracked across branches</span>
    </div>
  `;

  document.querySelector('#receivablesBranchTable tbody').innerHTML = data.byBranch
    .map((b) => `
      <tr>
        <td><strong>${b.branchName}</strong></td>
        <td>${fmtNum(b.installmentCount)}</td>
        <td><strong>${fmtCurrency(b.portfolio)}</strong></td>
        <td>${fmtCurrency(b.principal)}</td>
        <td><span class="badge badge-warn">${fmtNum(b.dueAccounts)}</span></td>
      </tr>`)
    .join('');

  const filteredDues = data.pastDues.filter(
    (d) =>
      !q ||
      d.customer_name.toLowerCase().includes(q) ||
      d.account_no.toLowerCase().includes(q) ||
      (d.barangay || '').toLowerCase().includes(q) ||
      d.unit.toLowerCase().includes(q)
  );
  document.querySelector('#pastDuesTable tbody').innerHTML = filteredDues.length
    ? filteredDues
        .map((d) => `
          <tr>
            <td>${d.release_date}</td>
            <td>${d.branch_name}</td>
            <td><strong>${d.customer_name}</strong><div class="small muted">${d.account_no}</div></td>
            <td>${d.contact_no || '—'}<div class="small muted">${d.barangay || ''}</div></td>
            <td>${d.unit}</td>
          </tr>`)
        .join('')
    : '<tr><td colspan="5" class="muted">No matching past-due accounts synced yet.</td></tr>';

  const filteredInst = data.installments.filter(
    (i) => !q || i.unit.toLowerCase().includes(q) || i.branch_name.toLowerCase().includes(q)
  );
  document.querySelector('#installmentsTable tbody').innerHTML = filteredInst.length
    ? filteredInst
        .map((i) => `
          <tr>
            <td>${i.sale_date}</td>
            <td>${i.branch_name}</td>
            <td><strong>${i.unit}</strong></td>
            <td>${i.term} mos</td>
            <td>${fmtCurrency(i.monthly)}</td>
            <td><strong>${fmtCurrency(i.amount)}</strong></td>
          </tr>`)
        .join('')
    : '<tr><td colspan="6" class="muted">No installment sales synced yet (click Sync Now).</td></tr>';
}

document.getElementById('recSearchInput').addEventListener('input', renderReceivables);
document.getElementById('refreshFinanceBtn').addEventListener('click', loadFinance);
document.getElementById('refreshActivityBtn').addEventListener('click', loadActivity);
document.getElementById('syncNowBtn').addEventListener('click', () => api('/api/sync/now', { method: 'POST' }));
document.getElementById('toggleSyncBtn').addEventListener('click', async () => {
  const res = await api('/api/sync/toggle', { method: 'POST', body: JSON.stringify({ paused: !state.syncState?.paused }) });
  updateSyncPill(res.state);
});

document.getElementById('connectPortalBtn').addEventListener('click', async () => {
  const username = document.getElementById('portalUsername').value.trim();
  const password = document.getElementById('portalPassword').value;
  const msg = document.getElementById('connectPortalMsg');
  const btn = document.getElementById('connectPortalBtn');
  if (!username || !password) { msg.textContent = 'Please enter username and password.'; return; }
  btn.disabled = true;
  msg.textContent = 'Connecting to app.abgadgetz.com.ph...';
  try {
    const res = await api('/api/sync/connect', { method: 'POST', body: JSON.stringify({ username, password }) });
    msg.textContent = `Connected (${res.state.adapterMode})! Synced ${res.result.updatedCount} update(s).`;
    await Promise.all([loadInventory(), loadPlanning(), loadSyncLogs()]);
  } catch (err) {
    msg.textContent = `Connection failed: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

// Default dates for Activity Log & Finance
const todayStr = new Date().toISOString().slice(0, 10);
const monthStartStr = todayStr.slice(0, 7) + '-01';
document.getElementById('actStart').value = todayStr;
document.getElementById('actEnd').value = todayStr;
document.getElementById('finStart').value = monthStartStr;
document.getElementById('finEnd').value = todayStr;

let eventSource = null;

// SSE live updates (only refresh active tab when actual changes occur)
function connectEvents() {
  if (IS_STATIC_GH) {
    getGhBundle().then((b) => updateSyncPill({
      running: false, paused: false, lastSyncAt: b.syncedAt,
      lastStatus: b.liveSynced ? 'OK' : 'WARN', adapterMode: 'ABGADGETZ_LIVE (GITHUB)',
    })).catch(() => {});
    return;
  }
  if (eventSource) eventSource.close();
  eventSource = new EventSource('/api/events');
  eventSource.addEventListener('status', (e) => updateSyncPill(JSON.parse(e.data)));
  eventSource.addEventListener('sync', async (e) => {
    const payload = JSON.parse(e.data);
    updateSyncPill(payload);
    if (payload.updatedCount > 0 || state.activeTab === 'websiteStock') {
      await refreshActiveTab();
    }
  });
}

// Pause SSE when tab/phone screen is hidden to save requests & battery
document.addEventListener('visibilitychange', () => {
  if (!eventSource && document.hidden) return;
  if (document.hidden) {
    if (eventSource) { eventSource.close(); eventSource = null; }
  } else if (!document.getElementById('appShell').classList.contains('hidden')) {
    connectEvents();
    refreshActiveTab();
  }
});

async function bootApp() {
  document.getElementById('authGate').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  document.getElementById('mobileBottomNav')?.classList.remove('hidden');
  await Promise.all([loadInventory(), loadSyncLogs()]);
  connectEvents();
}

async function checkAuth() {
  const status = await api('/api/auth/status');
  if (status.authenticated) {
    await bootApp();
    return;
  }
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('authGate').classList.remove('hidden');
  const isSetup = !status.pinConfigured;
  document.getElementById('authTitle').textContent = isSetup ? 'Create Owner PIN (First-Time Setup)' : 'Owner Login';
  document.getElementById('authSubtitle').textContent = isSetup
    ? 'Set a 6–12 digit PIN to protect your portal for online/phone access.'
    : 'Enter your 6–12 digit Owner PIN to unlock the portal.';
  document.getElementById('authSubmitBtn').textContent = isSetup ? 'SAVE PIN & UNLOCK' : 'UNLOCK PORTAL';
  document.getElementById('authGate').dataset.mode = isSetup ? 'setup' : 'login';
}

document.getElementById('authSubmitBtn').addEventListener('click', async () => {
  const pin = document.getElementById('ownerPinInput').value.trim();
  const mode = document.getElementById('authGate').dataset.mode || 'login';
  const errEl = document.getElementById('authErrorMsg');
  errEl.textContent = '';
  try {
    await api(mode === 'setup' ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
    document.getElementById('ownerPinInput').value = '';
    await bootApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('ownerPinInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('authSubmitBtn').click();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (eventSource) { eventSource.close(); eventSource = null; }
  document.getElementById('mobileBottomNav')?.classList.add('hidden');
  await api('/api/auth/logout', { method: 'POST' });
  await checkAuth();
});

checkAuth();
