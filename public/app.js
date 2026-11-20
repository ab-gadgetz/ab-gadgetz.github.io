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
  userRole: 'ADMIN',
  userBranchId: '',
};

const fmtCurrency = (n) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(n || 0);

const fmtNum = (n) => (Number(n) || 0).toLocaleString('en-PH');

const isFreebieAccessory = (item) => {
  const pType = item?.product_type || item?.productType || 'Cellphones';
  if (pType !== 'Accessories') return false;
  const p = Number(item?.base_price ?? item?.basePrice ?? 0);
  return p <= 5;
};

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
  if (state.userRole === 'CASHIER') return;
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
  } else if (tab === 'staffPins') {
    await loadStaffPins();
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
    ['filters', 'stockswap', 'restock', 'costcompare', 'health', 'lifecycle'].forEach((t) => {
      document.getElementById(`tool-${t}`)?.classList.toggle('hidden', t !== state.activeInvTool);
    });
    setInvToolsMenuOpen(false);
    if (state.activeInvTool === 'restock' && !state.planning) loadPlanning();
    if (state.activeInvTool === 'stockswap') renderStockSwapTool();
    if (state.activeInvTool === 'costcompare') renderCostCompareTool();
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

const DEFAULT_GH_STAFF_PINS = {
  'CASHIER::br-molave': '111111',
  'CASHIER::br-tambulig': '112222',
  'CASHIER::br-bonifacio': '113333',
  'CI::br-molave': '221111',
  'CI::br-tambulig': '222222',
  'CI::br-bonifacio': '223333',
};

async function getGhStaffPinsPayload() {
  const urls = [
    `https://raw.githubusercontent.com/ab-gadgetz/ab-gadgetz.github.io/main/public/staff-pins.json?v=${Date.now()}`,
    `../data/staff-pins.json?v=${Date.now()}`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && (j.hashes || j.encryptedPins)) return j;
      }
    } catch {}
  }
  try {
    const bundle = await getGhBundle(true);
    if (bundle?.staffPinHashes) {
      return { hashes: bundle.staffPinHashes, encryptedPins: null };
    }
  } catch {}
  return null;
}

async function deriveStaffEncKey() {
  const ownerHash = 'WoqyJ8xhvUMB3110oE1lkqUeZm53MSMWRkMIh/jkLB4=';
  const raw = new TextEncoder().encode(`abg-staff-enc:${ownerHash}`);
  const keyBytes = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function decryptGhStaffPins(encryptedPins) {
  if (!encryptedPins?.iv || !encryptedPins?.data) return null;
  const key = await deriveStaffEncKey();
  const iv = Uint8Array.from(atob(encryptedPins.iv), (c) => c.charCodeAt(0));
  const data = Uint8Array.from(atob(encryptedPins.data), (c) => c.charCodeAt(0));
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

async function encryptGhStaffPins(pinsObj) {
  const key = await deriveStaffEncKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(pinsObj));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return {
    iv: btoa(String.fromCharCode(...iv)),
    data: btoa(String.fromCharCode(...new Uint8Array(cipherBuf))),
  };
}

async function verifyGhStaffPin(role, branchId, pin) {
  const key = `${role}::${branchId}`;
  try {
    const payload = await getGhStaffPinsPayload();
    const hashes = payload?.hashes;
    if (hashes && hashes[key]) {
      const salt = 'abg-staff-pin-salt-v1';
      const bytes = new TextEncoder().encode(`${salt}:${pin}`);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
      return b64 === hashes[key];
    }
  } catch {}
  return pin === DEFAULT_GH_STAFF_PINS[key];
}

async function staticGhApi(url, opts = {}) {
  const u = new URL(url, window.location.origin);
  const pathname = u.pathname;
  const method = (opts.method || 'GET').toUpperCase();

  if (pathname === '/api/auth/status') {
    const isStaffPath = window.location.pathname.includes('/staff');
    const prefix = isStaffPath ? 'bs_gh_staff_' : 'bs_gh_';
    const auth = localStorage.getItem(`${prefix}auth`) === '1';
    const savedRole = localStorage.getItem(`${prefix}role`) || (isStaffPath ? 'CASHIER' : 'ADMIN');
    return {
      pinConfigured: true,
      authenticated: auth && (!isStaffPath || savedRole !== 'ADMIN'),
      role: savedRole,
      branchId: localStorage.getItem(`${prefix}branch`) || '',
    };
  }
  if (pathname === '/api/auth/login' || pathname === '/api/auth/setup') {
    const isStaffPath = window.location.pathname.includes('/staff');
    const prefix = isStaffPath ? 'bs_gh_staff_' : 'bs_gh_';
    const body = JSON.parse(opts.body || '{}');
    const pin = String(body.pin || '').trim();
    const role = String(body.role || (isStaffPath ? 'CASHIER' : 'ADMIN')).toUpperCase();
    const branchId = String(body.branchId || '');
    if (isStaffPath && role === 'ADMIN') {
      throw new Error('Please use the Admin Portal URL for Owner Admin login.');
    }
    if (role === 'CASHIER' || role === 'CI') {
      if (!['br-molave', 'br-tambulig', 'br-bonifacio'].includes(branchId)) throw new Error('Please select a branch.');
      const ok = await verifyGhStaffPin(role, branchId, pin);
      if (!ok) {
        const label = role === 'CASHIER' ? 'Cashier' : 'Credit Investigator';
        throw new Error(`Incorrect ${label} PIN for selected branch.`);
      }
    } else {
      const ok = await verifyGhOwnerPin(pin);
      if (!ok) throw new Error('Incorrect Owner PIN.');
    }
    localStorage.setItem(`${prefix}auth`, '1');
    localStorage.setItem(`${prefix}role`, role);
    localStorage.setItem(`${prefix}branch`, role === 'ADMIN' ? '' : branchId);
    return { ok: true, role, branchId: role === 'ADMIN' ? '' : branchId };
  }
  if (pathname === '/api/auth/logout') {
    const isStaffPath = window.location.pathname.includes('/staff');
    const prefix = isStaffPath ? 'bs_gh_staff_' : 'bs_gh_';
    localStorage.removeItem(`${prefix}auth`);
    localStorage.removeItem(`${prefix}role`);
    localStorage.removeItem(`${prefix}branch`);
    return { ok: true };
  }
  if (pathname === '/api/catalog/views') {
    const slugs = [['br-molave', 'molave'], ['br-tambulig', 'tambulig'], ['br-bonifacio', 'bonifacio']];
    let bundleViews = null;
    try {
      const b = await getGhBundle();
      bundleViews = b?.catalogViews || null;
    } catch {}
    const byBranch = {};
    let total = 0, weekly = 0, monthly = 0;
    await Promise.all(
      slugs.map(async ([bid, slug]) => {
        const base = bundleViews?.byBranch?.[bid] || { total: 0, weekly: 0, monthly: 0 };
        let liveVal = 0;
        try {
          const r = await fetch(`https://abacus.jasoncameron.dev/get/ab-gadgetz-views/${slug}?v=${Date.now()}`);
          if (r.ok) {
            const j = await r.json();
            liveVal = Number(j.value) > 0 ? Number(j.value) : 0;
          }
        } catch {}
        const t = Math.max(Number(base.total) || 0, liveVal);
        const w = Math.max(Number(base.weekly) || 0, liveVal);
        const m = Math.max(Number(base.monthly) || 0, liveVal);
        byBranch[bid] = { total: t, weekly: w, monthly: m };
        total += t; weekly += w; monthly += m;
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

function getLocalSupplierCostsMap() {
  try {
    return JSON.parse(localStorage.getItem('abg_supplier_costs_v1') || '{}');
  } catch {
    return {};
  }
}

async function saveProductSupplierCosts(productId, { costAb, costAk, costOnline }) {
  const prod = state.inventory?.items?.find((i) => i.id === productId);
  const nextAb = costAb !== '' && costAb !== undefined ? Math.max(0, Number(costAb) || 0) : (Number(prod?.cost_ab) || 0);
  const nextAk = costAk !== '' && costAk !== undefined ? Math.max(0, Number(costAk) || 0) : (Number(prod?.cost_ak) || 0);
  const nextOn = costOnline !== '' && costOnline !== undefined ? Math.max(0, Number(costOnline) || 0) : (Number(prod?.cost_online) || 0);

  const valid = [
    { name: 'AB Main Supplier', val: nextAb },
    { name: 'A&K', val: nextAk },
    { name: 'Online Purchase', val: nextOn },
  ].filter((c) => c.val > 0);
  valid.sort((a, b) => a.val - b.val);
  const bestCost = valid.length ? valid[0].val : 0;
  const bestSupplier = valid.length ? valid[0].name : (prod?.supplier || 'Portal Auto-Import');

  if (prod) {
    prod.cost_ab = nextAb;
    prod.cost_ak = nextAk;
    prod.cost_online = nextOn;
    if (bestCost > 0) {
      prod.supplier = bestSupplier;
    }
  }

  const map = getLocalSupplierCostsMap();
  map[productId] = { cost_ab: nextAb, cost_ak: nextAk, cost_online: nextOn };
  try {
    localStorage.setItem('abg_supplier_costs_v1', JSON.stringify(map));
  } catch {
    // ignore quota
  }

  if (!IS_STATIC_GH) {
    await api('/api/products/costs', {
      method: 'PATCH',
      body: JSON.stringify({ productId, costAb: nextAb, costAk: nextAk, costOnline: nextOn }),
    });
  }

  // Sync any active restock plan rows for this product
  if (state.restockPlan?.length && prod) {
    const mode = document.querySelector('input[name="restockSupplierMode"]:checked')?.value || 'LOWEST';
    const sup = resolveSupplierForProduct(prod, mode);
    for (const r of state.restockPlan) {
      if (r.productId === productId && sup) {
        r.supplier = sup.supplier;
        r.unitCost = sup.unitCost;
      }
    }
  }
  return { nextAb, nextAk, nextOn, bestCost, bestSupplier };
}

async function loadInventory() {
  state.inventory = await api('/api/inventory');
  if (IS_STATIC_GH && state.inventory?.items) {
    const localCosts = getLocalSupplierCostsMap();
    for (const item of state.inventory.items) {
      const ov = localCosts[item.id];
      if (ov) {
        item.cost_ab = ov.cost_ab;
        item.cost_ak = ov.cost_ak;
        item.cost_online = ov.cost_online;
      }
    }
  }
  populateSelects();
  renderInventory();
  renderHealth();
}

function populateSelects() {
  const { branches, items } = state.inventory;

  const populateBranchSelect = (id, includeAll) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML =
      (includeAll ? '<option value="">All Branches</option>' : '') +
      branches.map((b) => `<option value="${b.id}">${b.name}</option>`).join('');
    if (cur) sel.value = cur;
  };

  populateBranchSelect('globalBranch', state.userRole === 'ADMIN');
  populateBranchSelect('recBranch', false);
  populateBranchSelect('recDestBranch', false);
  populateBranchSelect('addBranch', false);
  if (state.userRole !== 'ADMIN' && state.userBranchId) {
    const gb = document.getElementById('globalBranch');
    if (gb) gb.value = state.userBranchId;
  }

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
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = prodOptions;
    if (cur) sel.value = cur;
  });
  syncCostInputs();
  renderPhotoEditor();
}

function syncCostInputs() {
  if (!state.inventory) return;
  const costSel = document.getElementById('costProduct');
  if (!costSel) return;
  const pid = costSel.value;
  const prod = state.inventory.items.find((i) => i.id === pid);
  if (!prod) return;
  document.getElementById('costAb').value = prod.cost_ab ?? '';
  document.getElementById('costAk').value = prod.cost_ak ?? '';
  document.getElementById('costOnline').value = prod.cost_online ?? '';
}

let activeAdminPhotoProductId = '';

function openAdminPhotoModal(productId) {
  if (state.userRole !== 'ADMIN' || !state.inventory) return;
  const prod = state.inventory.items.find((i) => i.id === productId);
  if (!prod) return;
  activeAdminPhotoProductId = productId;
  document.getElementById('adminPhotoModalTitle').textContent = `${prod.brand || ''} ${prod.model || prod.name}`.trim();
  document.getElementById('adminPhotoModalSub').textContent = `${prod.website_codes || prod.sku} • ${(prod.imageUrls || []).length} photo(s)`;
  document.getElementById('photoMsg').textContent = '';
  const abEl = document.getElementById('modalCostAb');
  const akEl = document.getElementById('modalCostAk');
  const onEl = document.getElementById('modalCostOnline');
  const costMsgEl = document.getElementById('modalCostsMsg');
  if (abEl) abEl.value = prod.cost_ab > 0 ? prod.cost_ab : '';
  if (akEl) akEl.value = prod.cost_ak > 0 ? prod.cost_ak : '';
  if (onEl) onEl.value = prod.cost_online > 0 ? prod.cost_online : '';
  if (costMsgEl) costMsgEl.textContent = '';
  renderPhotoEditor();
  document.getElementById('adminPhotoModal').classList.remove('hidden');
}

document.getElementById('saveModalCostsBtn')?.addEventListener('click', async () => {
  if (!activeAdminPhotoProductId) return;
  const msgEl = document.getElementById('modalCostsMsg');
  try {
    const res = await saveProductSupplierCosts(activeAdminPhotoProductId, {
      costAb: document.getElementById('modalCostAb')?.value ?? '',
      costAk: document.getElementById('modalCostAk')?.value ?? '',
      costOnline: document.getElementById('modalCostOnline')?.value ?? '',
    });
    if (msgEl) {
      msgEl.style.color = 'var(--gold-bright)';
      msgEl.textContent = res.bestCost > 0
        ? `Saved! Best: ${res.bestSupplier} (${fmtCurrency(res.bestCost)})`
        : 'Saved supplier costs.';
    }
    if (state.activeInvTool === 'restock') renderRestockCards();
    renderInventory();
  } catch (err) {
    if (msgEl) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = err.message;
    }
  }
});

function renderPhotoEditor() {
  if (!state.inventory) return;
  const pid = activeAdminPhotoProductId || document.getElementById('photoProduct')?.value;
  const prod = state.inventory.items.find((i) => i.id === pid);
  const grid = document.getElementById('photoPreviewGrid');
  if (!grid) return;
  if (!prod) {
    grid.innerHTML = '';
    return;
  }
  const subEl = document.getElementById('adminPhotoModalSub');
  if (subEl) subEl.textContent = `${prod.website_codes || prod.sku} • ${(prod.imageUrls || []).length} photo(s)`;

  const urls = prod.imageUrls || [];
  if (!urls.length) {
    grid.innerHTML = '<div class="muted small">No photos added for this product yet. Paste an image URL above to add one!</div>';
    return;
  }

  const saveOrderedUrls = async (nextUrls, statusText) => {
    const msg = document.getElementById('photoMsg');
    try {
      await api('/api/products/photos', {
        method: 'PATCH',
        body: JSON.stringify({ productId: prod.id, imageUrls: nextUrls }),
      });
      if (msg) msg.textContent = statusText;
      await loadInventory();
      if (state.selectedCustomerId) await loadCustomerCatalog(state.selectedCustomerId);
      renderPhotoEditor();
    } catch (err) {
      if (msg) msg.textContent = err.message;
    }
  };

  grid.innerHTML = urls
    .map(
      (u, idx) => `
      <div style="background:#171c23;border:${idx === 0 ? '2px solid var(--gold-bright)' : '1px solid var(--border-soft)'};border-radius:10px;padding:8px;display:flex;flex-direction:column;align-items:center;gap:6px;width:128px;">
        <div style="width:100%;display:flex;justify-content:space-between;align-items:center;font-size:10px;font-weight:800;color:${idx === 0 ? 'var(--gold-bright)' : 'var(--muted)'};">
          <span>${idx === 0 ? '★ 1ST COVER' : `#${idx + 1}`}</span>
          ${idx > 0 ? `<button type="button" class="secondary make-first-photo-btn" data-idx="${idx}" style="padding:2px 6px;font-size:9.5px;min-height:0;" title="Move to 1st">Make 1st</button>` : ''}
        </div>
        <img src="${u}" alt="${prod.name}" style="width:96px;height:96px;object-fit:contain;background:#fff;border-radius:6px;padding:2px;" />
        <div style="display:flex;gap:4px;width:100%;">
          <button type="button" class="secondary move-left-photo-btn" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} style="flex:1;padding:3px;font-size:11px;min-height:0;" title="Move left">◀</button>
          <button type="button" class="secondary move-right-photo-btn" data-idx="${idx}" ${idx === urls.length - 1 ? 'disabled' : ''} style="flex:1;padding:3px;font-size:11px;min-height:0;" title="Move right">▶</button>
          <button type="button" class="danger remove-photo-btn" data-idx="${idx}" style="flex:1;padding:3px;font-size:11px;min-height:0;" title="Remove photo">✕</button>
        </div>
      </div>`
    )
    .join('');

  grid.querySelectorAll('.make-first-photo-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.idx);
      const next = [urls[i], ...urls.filter((_, idx) => idx !== i)];
      saveOrderedUrls(next, 'Moved photo to 1st position!');
    });
  });

  grid.querySelectorAll('.move-left-photo-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.idx);
      if (i <= 0) return;
      const next = [...urls];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      saveOrderedUrls(next, 'Photo order updated.');
    });
  });

  grid.querySelectorAll('.move-right-photo-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.idx);
      if (i >= urls.length - 1) return;
      const next = [...urls];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      saveOrderedUrls(next, 'Photo order updated.');
    });
  });

  grid.querySelectorAll('.remove-photo-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextUrls = urls.filter((_, i) => i !== Number(btn.dataset.idx));
      saveOrderedUrls(nextUrls, 'Photo removed.');
    });
  });
}

document.getElementById('closeAdminPhotoModalBtn')?.addEventListener('click', () => {
  document.getElementById('adminPhotoModal')?.classList.add('hidden');
});
document.getElementById('adminPhotoModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'adminPhotoModal') {
    document.getElementById('adminPhotoModal').classList.add('hidden');
  }
});
document.getElementById('photoProduct')?.addEventListener('change', renderPhotoEditor);
document.getElementById('addPhotoBtn')?.addEventListener('click', async () => {
  const pid = activeAdminPhotoProductId || document.getElementById('photoProduct')?.value;
  const url = document.getElementById('photoUrlInput').value.trim();
  const msg = document.getElementById('photoMsg');
  if (!pid || !url) {
    msg.textContent = 'Paste an image address first.';
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
    renderPhotoEditor();
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
  if (!bar) return;
  if (state.userRole !== 'ADMIN') {
    bar.classList.add('hidden');
    return;
  }
  const count = state.selectedProducts.size;
  bar.classList.toggle('hidden', count === 0);
  document.getElementById('bulkSelectedCount').textContent = `${count} model(s) selected`;
}

function renderModelCard(item, visibleBranches) {
  const isCashier = state.userRole === 'CASHIER';
  const isAdmin = state.userRole === 'ADMIN';
  const branchObj = visibleBranches[0] || { id: 'br-molave', name: 'Molave', cash_discount_pct: 5 };
  const discountRate = (Number(branchObj.cash_discount_pct) || 5) / 100;
  const cashPrice = Math.round((Number(item.base_price) || 0) * (1 - discountRate));
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
  const isSel = isAdmin && state.selectedProducts.has(item.id);
  const qtyCls = item.scopedAvail === 0 ? 'model-card-qty zero' : 'model-card-qty';
  const isFreebie = isFreebieAccessory(item);
  return `
    <div class="model-card" ${isCashier ? `data-inv-calc-id="${item.id}" style="cursor:pointer;"` : isAdmin ? `data-admin-photo-id="${item.id}" style="cursor:pointer;${isSel ? 'border-color:var(--gold);background:linear-gradient(165deg,#332f20 0%,#1f1d16 100%);' : ''}"` : `style="${isSel ? 'border-color:var(--gold);background:linear-gradient(165deg,#332f20 0%,#1f1d16 100%);' : ''}"`}>
      <div class="model-card-head">
        <div style="display:flex;gap:9px;align-items:center;min-width:0;">
          ${isAdmin ? `<input type="checkbox" class="model-select-chk" data-id="${item.id}" ${isSel ? 'checked' : ''} style="width:16px;height:16px;flex:0 0 16px;cursor:pointer;accent-color:var(--gold);" />` : ''}
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
        ${isFreebie
          ? `<span style="color:var(--green);font-weight:800;font-size:12px;">FREEBIE</span>`
          : `<span>SRP: <strong style="color:var(--gold-bright);font-size:12.5px;">${fmtCurrency(item.base_price)}</strong></span>`}
        ${isAdmin ? `<span>Cost: <strong style="color:var(--green);">${item.cost_price > 0 ? fmtCurrency(item.cost_price) : '—'}</strong></span>` : ''}
        ${isCashier && !isFreebie ? `<span style="color:var(--green);">Cash: <strong>${fmtCurrency(cashPrice)}</strong> <span style="color:var(--gold);margin-left:4px;">Options ›</span></span>` : ''}
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

  const isAdmin = state.userRole === 'ADMIN';
  const isCashier = state.userRole === 'CASHIER';
  const isCellphonesView = selectedTypes.includes('Cellphones') && !selectedTypes.includes('Accessories');

  // Cashier integrated catalog filters (Price Range & RAM/ROM only when Cellphones is selected)
  let filteredScoped = scopedItems;

  if (isCashier) {
    const priceRangeEl = document.getElementById('invPriceRange');
    const ramRomEl = document.getElementById('invRamRom');
    const sortBtn = document.getElementById('invPriceSortBtn');
    if (priceRangeEl) priceRangeEl.classList.toggle('hidden', !isCellphonesView);
    if (ramRomEl) ramRomEl.classList.toggle('hidden', !isCellphonesView);
    if (sortBtn) sortBtn.textContent = state.invPriceSort === 'desc' ? 'Price ↓' : 'Price ↑';

    if (isCellphonesView && ramRomEl) {
      const specs = new Set();
      for (const x of scopedItems) {
        const rr = extractRamRom(x.model || x.name, x.brand);
        if (rr) specs.add(rr);
      }
      const prevSpec = ramRomEl.value || 'ALL';
      const sortedSpecs = Array.from(specs).sort((a, b) => {
        const na = parseInt(a, 10) || 0;
        const nb = parseInt(b, 10) || 0;
        return na - nb || a.localeCompare(b);
      });
      ramRomEl.innerHTML =
        '<option value="ALL">All RAM/ROM</option>' +
        sortedSpecs.map((s) => `<option value="${s}">${s}</option>`).join('');
      if (sortedSpecs.includes(prevSpec)) ramRomEl.value = prevSpec;
      else ramRomEl.value = 'ALL';
    }

    if (isCellphonesView) {
      const pr = priceRangeEl?.value || 'ALL';
      const rrFilter = ramRomEl?.value || 'ALL';
      filteredScoped = scopedItems.filter((x) => {
        const p = Number(x.base_price) || 0;
        if (pr !== 'ALL') {
          const [lo, hi] = pr.split('-').map(Number);
          if (p < lo || p > hi) return false;
        }
        if (rrFilter !== 'ALL') {
          if (extractRamRom(x.model || x.name, x.brand) !== rrFilter) return false;
        }
        return true;
      });
    }
  }

  // Sort freebies first at the very top, then sort models by selling price
  const sortDir = isCashier && state.invPriceSort === 'desc' ? -1 : 1;
  filteredScoped.sort((a, b) => {
    const fa = isFreebieAccessory(a) ? 0 : 1;
    const fb = isFreebieAccessory(b) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    if (fa === 0) return String(a.model || a.name).localeCompare(String(b.model || b.name));
    return (
      sortDir * ((Number(a.base_price) || 0) - (Number(b.base_price) || 0)) ||
      String(a.model || a.name).localeCompare(String(b.model || b.name))
    );
  });
  document.getElementById('inventorySummaryGrid').innerHTML = `
    <div class="mini-kpi">
      <div class="mini-kpi-top">
        <span class="mini-kpi-label">TOTAL</span>
        <span class="mini-kpi-val">${totalUnits.toLocaleString()} units</span>
      </div>
      <div class="mini-kpi-sub">${fmtNum(availableModels)} models available${isAdmin ? ` • Cost: ${fmtCurrency(totalCostVal)}` : ''}</div>
    </div>
    ${isAdmin ? `
    <div class="mini-kpi">
      <div class="mini-kpi-top">
        <span class="mini-kpi-label">POTENTIAL SALES</span>
        <span class="mini-kpi-val">${fmtCurrency(potentialSales)}</span>
      </div>
      <div class="mini-kpi-sub">Net of cash discount (5% / 3%)</div>
    </div>` : ''}
  `;

  const grid = document.getElementById('brandGrid');
  if (filteredScoped.length === 0) {
    grid.innerHTML = '<div class="muted small">No products match the current filters.</div>';
    updateBulkBar();
    return;
  }

  const branchObj = visibleBranches[0] || { id: 'br-molave', name: 'Molave', cash_discount_pct: 5 };
  const cashPct = Number(branchObj.cash_discount_pct) || 5;
  const discountRate = cashPct / 100;
  const rates = state.installmentRates || [
    { months: 4, monthly_rate: 0.09 },
    { months: 6, monthly_rate: 0.08 },
    { months: 9, monthly_rate: 0.07 },
    { months: 12, monthly_rate: 0.06 },
  ];

  const renderCashierShopeeCard = (item) => {
    const brandKey = String(item.brand || '').toLowerCase();
    const accMap = {
      infinix: '#77e82a', tecno: '#3b82f6', realme: '#ffd600', itel: '#ff3355',
      redmi: '#ff6900', vivo: '#60a5fa', honor: '#38bdf8', samsung: '#3b82f6',
      nubia: '#ef4444', zte: '#06b6d4', poco: '#facc15', oppo: '#10b981', apple: '#f8fafc',
    };
    const accent = accMap[brandKey] || '#e7c55f';
    const brandLabel = brandKey === 'apple' ? 'Apple' : (item.brand || '');
    const cashPrice = Math.round((Number(item.base_price) || 0) * (1 - discountRate));
    const isPhone = (item.product_type || 'Cellphones') === 'Cellphones';
    const mo4 = isPhone ? calc4MoAmortization(item.base_price, rates) : 0;
    const imgHtml = item.imageUrl
      ? `<img src="${item.imageUrl}" alt="${item.name}" loading="lazy" />`
      : `<div style="font-size:40px;color:var(--gold);">${isPhone ? '📱' : '🎧'}</div>`;
    const installBanner = mo4 > 0
      ? `<div class="shopee-badge-installment"><span>4-Mo Est</span><span>${fmtCurrency(mo4)}/mo</span></div>`
      : '';
    const availText = item.scopedAvail > 0 ? `${fmtNum(item.scopedAvail)} avail` : 'Out of stock';
    const availStyle = item.scopedAvail > 0 ? '' : 'color:#f87171;border-color:rgba(248,113,113,.35);';
    const isFreebie = isFreebieAccessory(item);
    return `
      <div class="shopee-card" data-inv-calc-id="${item.id}">
        <div class="shopee-thumb">
          ${imgHtml}
          <span class="shopee-badge-brand" style="color:${accent};">${isFreebie ? 'FREEBIE' : brandLabel}</span>
          <span class="shopee-badge-avail" style="${availStyle}">${availText}</span>
          ${installBanner}
        </div>
        <div class="shopee-body">
          <div class="shopee-title"><img src="${LOGO_SQUARE_SRC}" alt="Logo" class="shopee-mall-logo" />${item.model || item.name}</div>
          <div>
            ${isFreebie
              ? `<div class="shopee-price-row"><span class="shopee-price-main" style="color:var(--green);">FREEBIE</span></div>`
              : `<div class="shopee-price-row">
                  <span class="shopee-price-main">${fmtCurrency(cashPrice)}</span>
                  <span class="shopee-discount-pill">-${cashPct}% Cash</span>
                </div>
                <div class="shopee-srp-sub">
                  <span>SRP ${fmtCurrency(item.base_price)}</span>
                  <span style="color:var(--gold);">Installment ›</span>
                </div>`}
          </div>
        </div>
      </div>
    `;
  };

  if (groupingMode === 'flat') {
    grid.innerHTML = `
      <div class="brand-group expanded">
        <div class="brand-tile" style="cursor:default;">
          <span class="brand-tile-name">${productTypeLabel} (${filteredScoped.length})</span>
          ${isAdmin ? `
          <label style="display:flex;align-items:center;gap:6px;margin:0;color:var(--gold-bright);cursor:pointer;font-size:12px;">
            <input type="checkbox" id="flatSelectAll" ${filteredScoped.every((x) => state.selectedProducts.has(x.id)) ? 'checked' : ''} style="width:16px;height:16px;margin:0;" />
            Select All Shown
          </label>` : ''}
        </div>
        ${isCashier
          ? `<div class="shopee-grid inv-shopee-grid">${filteredScoped.map(renderCashierShopeeCard).join('')}</div>`
          : filteredScoped.map((item) => renderModelCard(item, visibleBranches)).join('')}
      </div>
    `;
    if (isAdmin) {
      document.getElementById('flatSelectAll')?.addEventListener('change', (e) => {
        for (const x of filteredScoped) {
          if (e.target.checked) state.selectedProducts.add(x.id);
          else state.selectedProducts.delete(x.id);
        }
        renderInventory();
      });
    }
  } else {
    const groups = new Map();
    for (const item of filteredScoped) {
      const brand = isFreebieAccessory(item) ? 'FREEBIES' : (item.brand || item.category || 'Other');
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
        if (a[0] === 'FREEBIES') return -1;
        if (b[0] === 'FREEBIES') return 1;
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

        const selectAllControl = isAdmin && isExpanded
          ? `<label class="brand-select-all" data-brand="${brand}" style="display:flex;align-items:center;gap:5px;margin:0;color:var(--text);font-size:11px;cursor:pointer;" onclick="event.stopPropagation()">
               <input type="checkbox" class="brand-select-all-chk" data-brand="${brand}" ${allSelected ? 'checked' : ''} style="width:15px;height:15px;margin:0;" />
               Select All
             </label>`
          : '';

        const cardsHtml = isExpanded
          ? isCashier
            ? `<div class="shopee-grid inv-shopee-grid">${list.map(renderCashierShopeeCard).join('')}</div>`
            : list.map((item) => renderModelCard(item, visibleBranches)).join('')
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

  if (isAdmin) {
    grid.querySelectorAll('.model-card[data-admin-photo-id]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.model-select-chk')) return;
        openAdminPhotoModal(card.dataset.adminPhotoId);
      });
    });
  }

  if (isCashier) {
    grid.querySelectorAll('[data-inv-calc-id]').forEach((card) => {
      card.addEventListener('click', async () => {
        const item = filteredScoped.find((x) => x.id === card.dataset.invCalcId);
        if (!item) return;
        const branchObj = visibleBranches[0] || { id: 'br-molave', name: 'Molave', cash_discount_pct: 5 };
        if (!state.installmentRates) {
          try {
            const catRes = await api(`/api/catalog/branch/${branchObj.id}`);
            state.installmentRates = catRes?.installmentRates || [];
          } catch {
            state.installmentRates = [
              { months: 4, monthly_rate: 0.09 },
              { months: 6, monthly_rate: 0.08 },
              { months: 9, monthly_rate: 0.07 },
              { months: 12, monthly_rate: 0.06 },
            ];
          }
        }
        const discountRate = (Number(branchObj.cash_discount_pct) || 5) / 100;
        const calcItem = {
          productId: item.id,
          brand: item.brand,
          model: item.model || item.name,
          name: item.name,
          productType: item.product_type || 'Cellphones',
          basePrice: item.base_price,
          cashPrice: Math.round((Number(item.base_price) || 0) * (1 - discountRate)),
          imageUrl: item.imageUrl || '',
          imageUrls: item.imageUrls || [],
          branchAvailable: item.scopedAvail,
        };
        openCustomerCalcModal(calcItem, branchObj, state.installmentRates);
      });
    });
  }

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

function computeStockSwapSuggestions({ typeFilter = 'Cellphones', targetBranchId = 'ALL', modeFilter = 'ZERO_ONLY' } = {}) {
  if (!state.inventory) return [];
  const { branches, items } = state.inventory;
  const suggestions = [];

  for (const item of items) {
    if ((item.lifecycle_status || 'Active') !== 'Active') continue;
    const pType = item.product_type || 'Cellphones';
    if (typeFilter !== 'ALL' && pType !== typeFilter) continue;

    // Build branch stock list for this product
    const branchStates = branches.map((b) => {
      const cell = item.byBranch[b.id] || { qtyAvailable: 0 };
      return {
        branchId: b.id,
        branchName: b.name,
        avail: Number(cell.qtyAvailable) || 0,
      };
    });

    // Donors: branches with surplus >= 2 (keep at least 1 in donor, or 2 if donor is Molave and has >= 3)
    const donors = branchStates
      .map((bs) => {
        const keepMin = bs.branchId === 'br-molave' && bs.avail >= 3 ? 2 : 1;
        const surplus = Math.max(0, bs.avail - keepMin);
        return { ...bs, remainingSurplus: surplus };
      })
      .filter((d) => d.remainingSurplus >= 1)
      .sort((a, b) => b.remainingSurplus - a.remainingSurplus || b.avail - a.avail);

    if (!donors.length) continue;

    // Needy branches: 0 stock (priority 1), or 1 stock when donor has >= 3 (priority 2)
    const needy = branchStates
      .filter((bs) => {
        if (targetBranchId !== 'ALL' && bs.branchId !== targetBranchId) return false;
        if (bs.avail === 0) return true;
        if (modeFilter === 'ALL_BALANCE' && bs.avail === 1 && donors.some((d) => d.branchId !== bs.branchId && d.avail >= 3)) {
          return true;
        }
        return false;
      })
      .sort((a, b) => a.avail - b.avail);

    for (const target of needy) {
      const donor = donors.find((d) => d.branchId !== target.branchId && d.remainingSurplus >= 1);
      if (!donor) continue;
      const desired = target.avail === 0 ? 1 : 1;
      const swapQty = Math.min(donor.remainingSurplus, desired);
      if (swapQty <= 0) continue;

      donor.remainingSurplus -= swapQty;
      suggestions.push({
        productId: item.id,
        sku: item.website_codes || item.sku,
        model: item.model || item.name,
        brand: item.brand || '',
        productType: pType,
        price: Number(item.base_price) || 0,
        fromBranchId: donor.branchId,
        fromBranch: donor.branchName,
        fromBefore: donor.avail,
        fromAfter: donor.avail - swapQty,
        toBranchId: target.branchId,
        toBranch: target.branchName,
        toBefore: target.avail,
        toAfter: target.avail + swapQty,
        swapQty,
        priority: target.avail === 0 ? '0-STOCK FILL' : 'BALANCE',
        reason: target.avail === 0
          ? `0 in ${target.branchName} • ${donor.branchName} has ${donor.avail}`
          : `Low (${target.avail}) in ${target.branchName} • ${donor.branchName} has ${donor.avail}`,
      });
    }
  }

  // Sort: 0-Stock Fills first, then highest donor stock, then lowest price
  suggestions.sort((a, b) => {
    if (a.toBefore !== b.toBefore) return a.toBefore - b.toBefore;
    if (b.fromBefore !== a.fromBefore) return b.fromBefore - a.fromBefore;
    return a.price - b.price || a.model.localeCompare(b.model);
  });
  return suggestions;
}

function formatSwapModelName(s) {
  const brand = String(s.brand || '').trim();
  const model = String(s.model || '').trim();
  if (!brand) return model;
  if (model.toLowerCase().startsWith(brand.toLowerCase())) return model;
  return `${brand} ${model}`;
}

function buildBranchSwapCopyText(branchName, swaps) {
  const outgoing = (swaps || []).filter((s) => s.fromBranch === branchName);
  if (!outgoing.length) return '';
  const byDest = new Map();
  for (const s of outgoing) {
    if (!byDest.has(s.toBranch)) byDest.set(s.toBranch, []);
    byDest.get(s.toBranch).push(s);
  }
  const blocks = [];
  for (const [toBranch, rows] of byDest.entries()) {
    const lines = rows.map((s) => `${formatSwapModelName(s)} - ${s.swapQty} ${s.swapQty === 1 ? 'pc' : 'pcs'}`);
    blocks.push(`Stockswap to ${toBranch}:\n${lines.join('\n')}`);
  }
  return `${branchName} Branch\n\n${blocks.join('\n\n')}`;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback below
    }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function renderStockSwapTool() {
  const typeFilter = document.getElementById('swapTypeFilter')?.value || 'Cellphones';
  const targetBranchId = document.getElementById('swapBranchFilter')?.value || 'ALL';
  const modeFilter = document.getElementById('swapModeFilter')?.value || 'ZERO_ONLY';
  const list = computeStockSwapSuggestions({ typeFilter, targetBranchId, modeFilter });
  state.lastStockSwaps = list;

  const branches = state.inventory?.branches || [
    { id: 'br-molave', name: 'Molave' },
    { id: 'br-tambulig', name: 'Tambulig' },
    { id: 'br-bonifacio', name: 'Bonifacio' },
  ];

  const stats = new Map(branches.map((b) => [b.name, { inQty: 0, outQty: 0 }]));
  for (const s of list) {
    if (stats.has(s.toBranch)) stats.get(s.toBranch).inQty += s.swapQty;
    if (stats.has(s.fromBranch)) stats.get(s.fromBranch).outQty += s.swapQty;
  }

  const copyIconSvg = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

  const sumEl = document.getElementById('stockSwapSummaryGrid');
  if (sumEl) {
    sumEl.innerHTML = branches
      .map((b) => {
        const st = stats.get(b.name) || { inQty: 0, outQty: 0 };
        const net = st.inQty - st.outQty;
        return `
          <div class="summary-box" style="display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;">
            <span class="small muted">${b.name} &middot; IN / OUT / NET</span>
            <strong style="font-size:15px;">${st.inQty} / ${st.outQty} / ${net} pcs</strong>
            <button type="button" class="btn btn-secondary btn-compact swap-copy-btn" data-branch="${b.name}" title="Copy ${b.name} Branch stockswap message" ${st.outQty === 0 ? 'disabled style="opacity:0.45;"' : ''}>
              ${copyIconSvg}
            </button>
          </div>
        `;
      })
      .join('');

    sumEl.querySelectorAll('.swap-copy-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const branchName = btn.dataset.branch;
        const text = buildBranchSwapCopyText(branchName, state.lastStockSwaps || []);
        const statusEl = document.getElementById('stockSwapCopyStatus');
        if (!text) {
          if (statusEl) statusEl.textContent = `No outgoing stockswaps for ${branchName} Branch.`;
          return;
        }
        const ok = await copyTextToClipboard(text);
        if (statusEl) {
          statusEl.textContent = ok
            ? `Copied ${branchName} Branch swaps. Paste the message to the other branch.`
            : `Unable to copy automatically. Please copy from the list above.`;
          statusEl.style.color = ok ? 'var(--gold-bright)' : 'var(--danger)';
        }
      });
    });
  }

  const listEl = document.getElementById('stockSwapGroupedList');
  if (!listEl) return;

  const statusEl = document.getElementById('stockSwapCopyStatus');
  if (statusEl) statusEl.textContent = '';

  if (!list.length) {
    listEl.innerHTML = '<div class="muted small" style="padding:10px 0;">All branches are balanced—no stock swaps needed right now.</div>';
    return;
  }

  const byFrom = new Map();
  for (const b of branches) byFrom.set(b.name, new Map());
  for (const s of list) {
    if (!byFrom.has(s.fromBranch)) byFrom.set(s.fromBranch, new Map());
    const destMap = byFrom.get(s.fromBranch);
    if (!destMap.has(s.toBranch)) destMap.set(s.toBranch, []);
    destMap.get(s.toBranch).push(s);
  }

  const sections = [];
  for (const [fromBranch, destMap] of byFrom.entries()) {
    if (!destMap.size) continue;
    const destHtml = [];
    for (const [toBranch, rows] of destMap.entries()) {
      destHtml.push(`
        <div style="margin-top:8px;">
          <div style="font-weight:700;font-size:13px;color:var(--text);margin-bottom:4px;">Stockswap to ${toBranch}:</div>
          ${rows
            .map(
              (s) => `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
              <span style="font-size:13px;">${formatSwapModelName(s)}</span>
              <strong style="color:var(--gold-bright);white-space:nowrap;">${s.swapQty} ${s.swapQty === 1 ? 'pc' : 'pcs'}</strong>
            </div>`
            )
            .join('')}
        </div>
      `);
    }
    sections.push(`
      <div class="sub-panel" style="margin-top:8px;padding:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <strong style="color:var(--gold-bright);font-size:14px;">${fromBranch} Branch</strong>
          <button type="button" class="btn btn-secondary btn-compact swap-copy-btn" data-branch="${fromBranch}" title="Copy ${fromBranch} Branch stockswap">
            ${copyIconSvg} <span>Copy</span>
          </button>
        </div>
        ${destHtml.join('')}
      </div>
    `);
  }
  listEl.innerHTML = sections.join('');

  listEl.querySelectorAll('.swap-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const branchName = btn.dataset.branch;
      const text = buildBranchSwapCopyText(branchName, state.lastStockSwaps || []);
      if (!text) return;
      const ok = await copyTextToClipboard(text);
      if (statusEl) {
        statusEl.textContent = ok
          ? `Copied ${branchName} Branch swaps. Paste the message to the other branch.`
          : `Unable to copy automatically.`;
        statusEl.style.color = ok ? 'var(--gold-bright)' : 'var(--danger)';
      }
    });
  });
}

function downloadStockSwapPdf() {
  const jspdfNs = window.jspdf;
  if (!jspdfNs || typeof jspdfNs.jsPDF !== 'function') {
    alert('PDF generator library is still loading. Please try again in a second.');
    return;
  }
  const list = state.lastStockSwaps || computeStockSwapSuggestions();
  if (!list.length) {
    alert('No stock swap suggestions to download right now.');
    return;
  }
  const doc = new jspdfNs.jsPDF({ orientation: 'portrait', unit: 'in', format: [8.5, 13], compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 24 / 72;
  const nowLabel = new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(27, 25, 19);
  doc.text('AB-GADGETZ · BRANCH STOCK SWAP SUMMARY', pageWidth / 2, 30 / 72, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(79, 73, 58);
  doc.text(`Prepared ${nowLabel}`, pageWidth / 2, 43 / 72, { align: 'center' });
  doc.text('Suggested transfers only · Record accepted swaps', pageWidth / 2, 54 / 72, { align: 'center' });

  const branches = state.inventory?.branches || [
    { id: 'br-molave', name: 'Molave' },
    { id: 'br-tambulig', name: 'Tambulig' },
    { id: 'br-bonifacio', name: 'Bonifacio' },
  ];
  const stats = new Map(branches.map((b) => [b.name, { inQty: 0, outQty: 0 }]));
  for (const s of list) {
    if (stats.has(s.toBranch)) stats.get(s.toBranch).inQty += s.swapQty;
    if (stats.has(s.fromBranch)) stats.get(s.fromBranch).outQty += s.swapQty;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(27, 25, 19);
  doc.text('BRANCH SUMMARY', margin, 72 / 72);

  doc.autoTable({
    startY: 78 / 72,
    margin: { left: margin, right: margin },
    head: [['Branch', 'Swap In', 'Swap Out', 'Net']],
    body: branches.map((b) => {
      const st = stats.get(b.name) || { inQty: 0, outQty: 0 };
      const net = st.inQty - st.outQty;
      return [b.name, `${st.inQty} pcs`, `${st.outQty} pcs`, `${net} pcs`];
    }),
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 4 / 72,
      textColor: [27, 25, 19],
      lineColor: [75, 70, 58],
      lineWidth: 0.65 / 72,
      halign: 'center',
    },
    columnStyles: { 0: { halign: 'left' } },
    headStyles: { fillColor: [235, 226, 190], textColor: [30, 30, 30], fontStyle: 'bold' },
  });

  const afterSummaryY = (doc.lastAutoTable?.finalY || 1.8) + 16 / 72;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(27, 25, 19);
  doc.text('SWAPS BY RECEIVING BRANCH', margin, afterSummaryY);

  const byDest = new Map();
  for (const s of list) {
    if (!byDest.has(s.toBranch)) byDest.set(s.toBranch, []);
    byDest.get(s.toBranch).push(s);
  }
  const detailBody = [];
  for (const [toBranch, rows] of byDest.entries()) {
    detailBody.push([
      {
        content: `${toBranch} RECEIVES`,
        colSpan: 3,
        styles: { fillColor: [235, 226, 190], fontStyle: 'bold', textColor: [27, 25, 19] },
      },
    ]);
    for (const s of rows) {
      detailBody.push([
        s.fromBranch,
        formatSwapModelName(s),
        `${s.swapQty} ${s.swapQty === 1 ? 'pc' : 'pcs'}`,
      ]);
    }
  }

  doc.autoTable({
    startY: afterSummaryY + 6 / 72,
    margin: { left: margin, right: margin, bottom: margin },
    head: [['From Branch', 'Brand / Model', 'Quantity']],
    body: detailBody,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 4 / 72,
      textColor: [27, 25, 19],
      lineColor: [75, 70, 58],
      lineWidth: 0.65 / 72,
    },
    columnStyles: { 2: { halign: 'center' } },
    headStyles: { fillColor: [235, 226, 190], textColor: [30, 30, 30], fontStyle: 'bold' },
  });

  doc.save(`AB_Gadgetz_Stock_Swap_Summary_${todayStr}.pdf`);
}

document.getElementById('swapTypeFilter')?.addEventListener('change', renderStockSwapTool);
document.getElementById('swapBranchFilter')?.addEventListener('change', renderStockSwapTool);
document.getElementById('swapModeFilter')?.addEventListener('change', renderStockSwapTool);
document.getElementById('stockSwapPdfBtn')?.addEventListener('click', downloadStockSwapPdf);

const SUPPLIER_ORDER = ['AB Main Supplier', 'A&K', 'Online Purchase'];
const BRANCH_ORDER = ['Molave', 'Tambulig', 'Bonifacio'];

function resolveSupplierForProduct(item, mode = 'LOWEST') {
  const ab = Number(item.cost_ab) || 0;
  const ak = Number(item.cost_ak) || 0;
  const on = Number(item.cost_online) || 0;
  const fallbackCost = Number(item.cost_price) || 0;

  if (mode === 'AB') return ab > 0 ? { supplier: 'AB Main Supplier', unitCost: ab } : null;
  if (mode === 'AK') return ak > 0 ? { supplier: 'A&K', unitCost: ak } : null;
  if (mode === 'ONLINE') return on > 0 ? { supplier: 'Online Purchase', unitCost: on } : null;

  const candidates = [];
  if (ab > 0) candidates.push({ supplier: 'AB Main Supplier', unitCost: ab });
  if (ak > 0) candidates.push({ supplier: 'A&K', unitCost: ak });
  if (on > 0) candidates.push({ supplier: 'Online Purchase', unitCost: on });
  if (candidates.length) {
    candidates.sort((a, b) => a.unitCost - b.unitCost);
    return candidates[0];
  }
  if (fallbackCost > 0) {
    return { supplier: 'AB Main Supplier', unitCost: fallbackCost };
  }
  return { supplier: 'AB Main Supplier', unitCost: 0 };
}

function buildRestockDraftPlan() {
  if (!state.inventory) return [];
  const mode = document.querySelector('input[name="restockSupplierMode"]:checked')?.value || 'LOWEST';
  const typeFilter = document.getElementById('restockTypeFilter')?.value || 'Cellphones';
  const budgetVal = Number(document.getElementById('restockBudgetInput')?.value) || 0;
  const globalBranchId = document.getElementById('globalBranch')?.value || '';

  const { branches, items } = state.inventory;
  const targetBranches = globalBranchId ? branches.filter((b) => b.id === globalBranchId) : branches;

  const candidates = [];
  for (const item of items) {
    if ((item.lifecycle_status || 'Active') !== 'Active') continue;
    const pType = item.product_type || 'Cellphones';
    if (typeFilter !== 'ALL' && pType !== typeFilter) continue;

    const sup = resolveSupplierForProduct(item, mode);
    if (!sup) continue;

    const price = Number(item.base_price) || 0;
    for (const b of targetBranches) {
      const cell = item.byBranch[b.id];
      if (!cell) continue;
      const avail = Number(cell.qtyAvailable) || 0;
      const defaultRp = price < 10000 ? (b.id === 'br-molave' ? 2 : 1) : price <= 20000 ? 2 : 1;
      const reorderPoint = Number(cell.reorderPoint) || defaultRp;
      if (avail > reorderPoint) continue;

      const targetQty = b.id === 'br-molave' ? Math.max(reorderPoint + 2, 3) : Math.max(reorderPoint + 1, 2);
      const suggestedQty = Math.max(1, targetQty - avail);
      const websiteCost = Number(item.cost_price) || 0;
      const savingsVsWebsite = websiteCost > 0 && sup.unitCost > 0 ? websiteCost - sup.unitCost : 0;

      candidates.push({
        key: `${item.id}::${b.id}`,
        productId: item.id,
        brand: item.brand || '',
        model: item.model || item.name,
        displayModel: formatSwapModelName({ brand: item.brand || '', model: item.model || item.name }),
        sku: item.website_codes || item.sku,
        imageUrl: item.imageUrl || '',
        branchId: b.id,
        branchName: b.name,
        supplier: sup.supplier,
        unitCost: sup.unitCost,
        websiteCost,
        savingsVsWebsite,
        avail,
        reorderPoint,
        qty: suggestedQty,
        selected: true,
      });
    }
  }

  // Prioritize priced 0-stock first, then supplier savings vs website cost, then lowest avail, then lowest unit cost
  candidates.sort((a, b) => {
    const ap = a.unitCost > 0 ? 0 : 1;
    const bp = b.unitCost > 0 ? 0 : 1;
    if (ap !== bp) return ap - bp;
    if ((a.avail === 0) !== (b.avail === 0)) return a.avail === 0 ? -1 : 1;
    if (a.savingsVsWebsite !== b.savingsVsWebsite) return b.savingsVsWebsite - a.savingsVsWebsite;
    if (a.avail !== b.avail) return a.avail - b.avail;
    return a.unitCost - b.unitCost || a.displayModel.localeCompare(b.displayModel);
  });

  if (budgetVal > 0) {
    let spent = 0;
    for (const c of candidates) {
      if (c.unitCost <= 0) {
        c.selected = false;
        continue;
      }
      if (spent + c.unitCost > budgetVal) {
        c.selected = false;
        continue;
      }
      const maxAffordable = Math.floor((budgetVal - spent) / c.unitCost);
      if (maxAffordable < c.qty) {
        c.qty = Math.max(1, maxAffordable);
      }
      spent += c.qty * c.unitCost;
    }
  }

  state.restockPlan = candidates;
  return candidates;
}

function getFilteredRestockRows() {
  const plan = state.restockPlan || [];
  const search = (document.getElementById('restockSearchInput')?.value || '').trim().toLowerCase();
  const brandFilter = document.getElementById('restockBrandFilter')?.value || 'ALL';
  const showFilter = document.getElementById('restockShowFilter')?.value || 'SELECTED';

  return plan
    .map((r, idx) => ({ ...r, _idx: idx }))
    .filter((r) => {
      if (showFilter === 'SELECTED' && !r.selected) return false;
      if (showFilter === 'ZERO' && r.avail > 0) return false;
      if (brandFilter !== 'ALL' && (r.brand || 'Other') !== brandFilter) return false;
      if (
        search &&
        !r.displayModel.toLowerCase().includes(search) &&
        !r.sku.toLowerCase().includes(search) &&
        !(r.brand || '').toLowerCase().includes(search)
      ) {
        return false;
      }
      return true;
    });
}

function renderRestockCards() {
  const plan = state.restockPlan || [];
  const grid = document.getElementById('reorderCardGrid');
  const sumEl = document.getElementById('restockDraftSummary');
  const brandSel = document.getElementById('restockBrandFilter');
  if (!grid) return;

  if (brandSel) {
    const prevBrand = brandSel.value || 'ALL';
    const brands = [...new Set(plan.map((r) => r.brand || 'Other'))].sort();
    brandSel.innerHTML =
      '<option value="ALL">All Brands</option>' +
      brands.map((b) => `<option value="${b}">${b}</option>`).join('');
    if (brands.includes(prevBrand)) brandSel.value = prevBrand;
  }

  const selected = plan.filter((r) => r.selected && r.qty > 0);
  const totalUnits = selected.reduce((s, r) => s + r.qty, 0);
  const totalCost = selected.reduce((s, r) => s + r.qty * r.unitCost, 0);
  if (sumEl) {
    sumEl.innerHTML = `Selected <strong>${fmtNum(selected.length)}</strong> line(s) • <strong>${fmtNum(totalUnits)} pcs</strong> • Est. Total: <strong style="color:var(--gold-bright);">${fmtCurrency(totalCost)}</strong>`;
  }

  const visible = getFilteredRestockRows();
  if (!visible.length) {
    grid.innerHTML = '<div class="muted small" style="padding:10px 0;">No products match. Try switching Show filter to "All Low-Stock" or clearing search.</div>';
    return;
  }

  if (!state.restockOpenBrands) state.restockOpenBrands = new Set();

  // Group by Brand -> Model
  const byBrand = new Map();
  for (const r of visible) {
    const bName = r.brand || 'Other';
    if (!byBrand.has(bName)) byBrand.set(bName, new Map());
    const modelMap = byBrand.get(bName);
    if (!modelMap.has(r.productId)) {
      modelMap.set(r.productId, {
        productId: r.productId,
        displayModel: r.displayModel,
        sku: r.sku,
        imageUrl: r.imageUrl,
        supplier: r.supplier,
        unitCost: r.unitCost,
        rows: [],
      });
    }
    modelMap.get(r.productId).rows.push(r);
  }

  const searchActive = Boolean((document.getElementById('restockSearchInput')?.value || '').trim());
  const cardsHtml = [];

  for (const [bName, modelMap] of byBrand.entries()) {
    const models = [...modelMap.values()];
    const brandRows = models.flatMap((m) => m.rows);
    const brandSelectedUnits = brandRows.filter((r) => r.selected).reduce((s, r) => s + r.qty, 0);
    const brandAllSelected = brandRows.length > 0 && brandRows.every((r) => r.selected);
    const isOpen = searchActive || byBrand.size <= 3 || state.restockOpenBrands.has(bName);
    const accent = typeof getBrandMeta === 'function' ? getBrandMeta(bName).color : 'var(--gold)';

    const modelsHtml = models
      .map((m) => {
        const thumbHtml = m.imageUrl
          ? `<img src="${m.imageUrl}" alt="${m.displayModel}" style="width:48px;height:48px;object-fit:contain;border-radius:8px;background:#fff;flex-shrink:0;padding:2px;" loading="lazy" />`
          : `<div style="width:48px;height:48px;border-radius:8px;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">📱</div>`;
        const branchRowsHtml = m.rows
          .map(
            (r) => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 0;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;">
              <label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer;">
                <input type="checkbox" class="reorder-row-chk" data-idx="${r._idx}" ${r.selected ? 'checked' : ''} style="width:14px;height:14px;margin:0;accent-color:var(--gold);" />
                <span>${r.branchName}</span>
                <span class="muted small">(${fmtNum(r.avail)}/${fmtNum(r.reorderPoint)})</span>
              </label>
              <div style="display:flex;align-items:center;gap:6px;">
                <input type="number" class="reorder-qty-inp" data-idx="${r._idx}" value="${r.qty}" min="1" max="99" style="width:52px;padding:2px 5px;font-size:12px;text-align:center;" />
                <span class="small muted" style="min-width:22px;">pcs</span>
              </div>
            </div>`
          )
          .join('');
        const prodObj = state.inventory?.items?.find((i) => i.id === m.productId) || {};
        const cAb = Number(prodObj.cost_ab) > 0 ? prodObj.cost_ab : '';
        const cAk = Number(prodObj.cost_ak) > 0 ? prodObj.cost_ak : '';
        const cOn = Number(prodObj.cost_online) > 0 ? prodObj.cost_online : '';
        const webCost = Number(prodObj.cost_price) || 0;
        const diffWeb = webCost > 0 && m.unitCost > 0 ? webCost - m.unitCost : 0;
        const diffBadge = diffWeb > 0
          ? `<span style="color:var(--green);font-size:10.5px;font-weight:700;">• Saves ${fmtCurrency(diffWeb)} vs Web</span>`
          : diffWeb < 0
            ? `<span style="color:#f59e0b;font-size:10.5px;font-weight:700;">• +${fmtCurrency(Math.abs(diffWeb))} vs Web</span>`
            : '';
        return `
          <div class="model-card" style="padding:10px;display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;gap:10px;align-items:center;">
              ${thumbHtml}
              <div style="min-width:0;flex:1;">
                <div style="font-weight:700;font-size:13px;line-height:1.25;">${m.displayModel}</div>
                <div class="small muted">${m.sku} • <span style="color:var(--gold-bright);">${m.supplier}</span></div>
                <div class="small" style="margin-top:2px;">Active Cost: <strong>${m.unitCost > 0 ? fmtCurrency(m.unitCost) : '—'}</strong> ${diffBadge}</div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:4px;align-items:end;padding-top:4px;border-top:1px solid rgba(255,255,255,0.06);">
              <div>
                <div style="font-size:9.5px;color:var(--muted);">AB ₱</div>
                <input type="number" class="restock-cost-ab" data-pid="${m.productId}" value="${cAb}" min="0" step="0.01" placeholder="0" style="width:100%;padding:3px 5px;font-size:11px;" />
              </div>
              <div>
                <div style="font-size:9.5px;color:var(--muted);">A&amp;K ₱</div>
                <input type="number" class="restock-cost-ak" data-pid="${m.productId}" value="${cAk}" min="0" step="0.01" placeholder="0" style="width:100%;padding:3px 5px;font-size:11px;" />
              </div>
              <div>
                <div style="font-size:9.5px;color:var(--muted);">Online ₱</div>
                <input type="number" class="restock-cost-on" data-pid="${m.productId}" value="${cOn}" min="0" step="0.01" placeholder="0" style="width:100%;padding:3px 5px;font-size:11px;" />
              </div>
              <button type="button" class="secondary restock-save-cost-btn" data-pid="${m.productId}" style="padding:4px 7px;font-size:10.5px;min-height:0;" title="Save supplier costs">Save</button>
            </div>
            <div>${branchRowsHtml}</div>
          </div>
        `;
      })
      .join('');

    cardsHtml.push(`
      <div class="brand-card ${isOpen ? 'open' : ''}" style="border-top:3px solid ${accent};grid-column:1 / -1;">
        <div class="brand-card-head restock-brand-toggle" data-brand="${bName}" style="cursor:pointer;">
          <div style="display:flex;align-items:center;gap:10px;">
            <input type="checkbox" class="restock-brand-chk" data-brand="${bName}" ${brandAllSelected ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--gold);" />
            <strong style="color:${accent};font-size:15px;">${bName}</strong>
            <span class="muted small">${models.length} model(s) • ${brandSelectedUnits} pcs selected</span>
          </div>
          <span class="muted small">${isOpen ? '▲ Hide' : '▼ Show'}</span>
        </div>
        ${isOpen ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-top:10px;">${modelsHtml}</div>` : ''}
      </div>
    `);
  }

  grid.innerHTML = cardsHtml.join('');

  grid.querySelectorAll('.restock-brand-toggle').forEach((hdr) => {
    hdr.addEventListener('click', (e) => {
      if (e.target.closest('.restock-brand-chk')) return;
      const b = hdr.dataset.brand;
      if (state.restockOpenBrands.has(b)) state.restockOpenBrands.delete(b);
      else state.restockOpenBrands.add(b);
      renderRestockCards();
    });
  });

  grid.querySelectorAll('.restock-brand-chk').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const b = e.target.dataset.brand;
      const checked = e.target.checked;
      for (const r of visible) {
        if ((r.brand || 'Other') === b && state.restockPlan?.[r._idx]) {
          state.restockPlan[r._idx].selected = checked;
        }
      }
      renderRestockCards();
    });
  });

  grid.querySelectorAll('.reorder-row-chk').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.idx);
      if (state.restockPlan?.[idx]) state.restockPlan[idx].selected = e.target.checked;
      renderRestockCards();
    });
  });

  grid.querySelectorAll('.reorder-qty-inp').forEach((inp) => {
    inp.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.idx);
      const val = Math.max(1, parseInt(e.target.value, 10) || 1);
      if (state.restockPlan?.[idx]) state.restockPlan[idx].qty = val;
      renderRestockCards();
    });
  });

  grid.querySelectorAll('.restock-save-cost-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pid = btn.dataset.pid;
      const card = btn.closest('.model-card');
      const costAb = card?.querySelector('.restock-cost-ab')?.value ?? '';
      const costAk = card?.querySelector('.restock-cost-ak')?.value ?? '';
      const costOnline = card?.querySelector('.restock-cost-on')?.value ?? '';
      btn.textContent = '...';
      try {
        await saveProductSupplierCosts(pid, { costAb, costAk, costOnline });
        renderRestockCards();
        renderInventory();
      } catch (err) {
        btn.textContent = 'Err';
        alert(err.message);
      }
    });
  });
}

function getGroupedReorderPlan() {
  const selected = (state.restockPlan || []).filter((r) => r.selected && r.qty > 0);
  const bySupplier = new Map();
  for (const sup of SUPPLIER_ORDER) bySupplier.set(sup, new Map());

  for (const r of selected) {
    if (!bySupplier.has(r.supplier)) bySupplier.set(r.supplier, new Map());
    const branchMap = bySupplier.get(r.supplier);
    if (!branchMap.has(r.branchName)) branchMap.set(r.branchName, []);
    branchMap.get(r.branchName).push(r);
  }

  const ordered = [];
  for (const [supplier, branchMap] of bySupplier.entries()) {
    if (!branchMap.size) continue;
    const branchesOut = [];
    const sortedBranchNames = [...branchMap.keys()].sort((a, b) => {
      const ia = BRANCH_ORDER.indexOf(a);
      const ib = BRANCH_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
    for (const bName of sortedBranchNames) {
      branchesOut.push({ branchName: bName, rows: branchMap.get(bName) });
    }
    ordered.push({ supplier, branches: branchesOut });
  }
  return { selected, grouped: ordered };
}

function buildReorderCopyText() {
  const { grouped } = getGroupedReorderPlan();
  if (!grouped.length) return '';
  const parts = ['Reorder request'];
  for (const supGroup of grouped) {
    parts.push(supGroup.supplier);
    for (const bGroup of supGroup.branches) {
      const lines = [bGroup.branchName];
      for (const r of bGroup.rows) {
        lines.push(`${r.displayModel} — ${r.qty} ${r.qty === 1 ? 'pc' : 'pcs'}`);
      }
      parts.push(lines.join('\n'));
    }
  }
  return parts.join('\n\n');
}

function renderReorderPreviewModal() {
  const modal = document.getElementById('reorderPreviewModal');
  if (!modal) return;
  const showCosts = Boolean(document.getElementById('reorderShowCostsChk')?.checked);
  const { selected, grouped } = getGroupedReorderPlan();

  const prepEl = document.getElementById('reorderPreviewPrepared');
  if (prepEl) {
    prepEl.textContent = `Prepared ${new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })}`;
  }

  const totalUnits = selected.reduce((s, r) => s + r.qty, 0);
  const totalCost = selected.reduce((s, r) => s + r.qty * r.unitCost, 0);
  const branchTotals = new Map(BRANCH_ORDER.map((b) => [b, { qty: 0, cost: 0 }]));
  for (const r of selected) {
    if (!branchTotals.has(r.branchName)) branchTotals.set(r.branchName, { qty: 0, cost: 0 });
    const bt = branchTotals.get(r.branchName);
    bt.qty += r.qty;
    bt.cost += r.qty * r.unitCost;
  }

  const metricsEl = document.getElementById('reorderPreviewMetrics');
  if (metricsEl) {
    const branchPills = [...branchTotals.entries()]
      .filter(([, v]) => v.qty > 0)
      .map(
        ([b, v]) =>
          `<span style="display:inline-block;padding:4px 8px;border-radius:6px;background:#fff;border:1px solid #d5ceb8;font-size:12px;"><strong>${b}:</strong> ${v.qty} pcs${showCosts ? ` (${fmtCurrency(v.cost)})` : ''}</span>`
      )
      .join(' ');
    metricsEl.innerHTML = `
      <div style="padding:8px 12px;border-radius:8px;background:#fff;border:1px solid #d5ceb8;min-width:130px;">
        <div style="font-size:10px;font-weight:700;color:#6b6351;">ORDER UNITS</div>
        <div style="font-size:18px;font-weight:800;color:#1b1913;">${fmtNum(totalUnits)}</div>
      </div>
      ${
        showCosts
          ? `<div style="padding:8px 12px;border-radius:8px;background:#fff;border:1px solid #d5ceb8;min-width:150px;">
              <div style="font-size:10px;font-weight:700;color:#6b6351;">EST. TOTAL COST</div>
              <div style="font-size:18px;font-weight:800;color:#1d6f42;">${fmtCurrency(totalCost)}</div>
            </div>`
          : ''
      }
      <div style="flex:1;min-width:220px;">
        <div style="font-size:10px;font-weight:700;color:#6b6351;margin-bottom:4px;">BRANCH SUBTOTALS</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">${branchPills || '<span style="font-size:12px;color:#6b6351;">None</span>'}</div>
      </div>
    `;
  }

  const bodyEl = document.getElementById('reorderPreviewBody');
  if (bodyEl) {
    if (!grouped.length) {
      bodyEl.innerHTML = '<div style="padding:16px;text-align:center;color:#6b6351;">No products selected in this reorder plan.</div>';
    } else {
      bodyEl.innerHTML = grouped
        .map(
          (sup) => `
          <div style="margin-bottom:12px;">
            <div style="background:#ebe2be;color:#1b1913;font-weight:700;font-size:12px;padding:6px 10px;border-radius:6px;">
              ${sup.supplier}
            </div>
            ${sup.branches
              .map(
                (b) => `
              <div style="margin-top:8px;padding:0 4px;">
                <div style="font-weight:700;font-size:12px;color:#1b1913;margin-bottom:4px;">${b.branchName}</div>
                ${b.rows
                  .map((r) => {
                    const nameLabel = r.brand && !r.model.toLowerCase().startsWith(r.brand.toLowerCase())
                      ? `${r.brand} · ${r.model}`
                      : r.model;
                    return `
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:4px 0;border-bottom:1px solid #e6e0ce;font-size:12.5px;">
                      <span>${nameLabel}</span>
                      <span style="display:flex;align-items:center;gap:12px;white-space:nowrap;">
                        ${showCosts ? `<span style="color:#4f493a;font-size:11.5px;">${fmtCurrency(r.unitCost)} × ${r.qty} = <strong>${fmtCurrency(r.unitCost * r.qty)}</strong></span>` : ''}
                        <strong style="color:#b45309;">${r.qty} ${r.qty === 1 ? 'pc' : 'pcs'}</strong>
                      </span>
                    </div>`;
                  })
                  .join('')}
              </div>`
              )
              .join('')}
          </div>`
        )
        .join('');
    }
  }
  const stEl = document.getElementById('reorderPreviewStatus');
  if (stEl) stEl.textContent = '';
}

function downloadReorderPlanPdf() {
  const jspdfNs = window.jspdf;
  if (!jspdfNs || typeof jspdfNs.jsPDF !== 'function') {
    alert('PDF generator library is still loading. Please try again.');
    return;
  }
  const { selected, grouped } = getGroupedReorderPlan();
  if (!selected.length) {
    alert('No products selected to download.');
    return;
  }
  const showCosts = Boolean(document.getElementById('reorderShowCostsChk')?.checked);
  const doc = new jspdfNs.jsPDF({ orientation: 'portrait', unit: 'in', format: [8.5, 13], compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 24 / 72;
  const nowLabel = new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(27, 25, 19);
  doc.text('AB-GADGETZ · REORDER PLAN', pageWidth / 2, 30 / 72, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(79, 73, 58);
  const totalUnits = selected.reduce((s, r) => s + r.qty, 0);
  const totalCost = selected.reduce((s, r) => s + r.qty * r.unitCost, 0);
  doc.text(
    `Prepared ${nowLabel} · ${totalUnits} pcs${showCosts ? ` · Est. Total PHP ${fmtNum(Math.round(totalCost))}` : ''}`,
    pageWidth / 2,
    43 / 72,
    { align: 'center' }
  );

  const head = showCosts
    ? [['Branch', 'Brand / Model', 'Qty', 'Unit Cost', 'Subtotal']]
    : [['Branch', 'Brand / Model', 'Qty']];
  const colsCount = showCosts ? 5 : 3;
  const body = [];

  for (const sup of grouped) {
    body.push([
      {
        content: sup.supplier,
        colSpan: colsCount,
        styles: { fillColor: [235, 226, 190], fontStyle: 'bold', textColor: [27, 25, 19] },
      },
    ]);
    for (const b of sup.branches) {
      for (const r of b.rows) {
        const row = [
          b.branchName,
          r.displayModel,
          `${r.qty} ${r.qty === 1 ? 'pc' : 'pcs'}`,
        ];
        if (showCosts) {
          row.push(r.unitCost > 0 ? `PHP ${fmtNum(Math.round(r.unitCost))}` : '—');
          row.push(r.unitCost > 0 ? `PHP ${fmtNum(Math.round(r.unitCost * r.qty))}` : '—');
        }
        body.push(row);
      }
    }
  }

  doc.autoTable({
    startY: 56 / 72,
    margin: { left: margin, right: margin, bottom: margin },
    head,
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 4 / 72,
      textColor: [27, 25, 19],
      lineColor: [75, 70, 58],
      lineWidth: 0.65 / 72,
    },
    columnStyles: showCosts
      ? { 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' } }
      : { 2: { halign: 'center' } },
    headStyles: { fillColor: [235, 226, 190], textColor: [30, 30, 30], fontStyle: 'bold' },
  });

  doc.save(`AB_Gadgetz_Reorder_Plan_${todayStr}.pdf`);
}

async function downloadReorderPlanExcel() {
  if (!window.ExcelJS) {
    alert('Excel library is still loading. Please try again in a second.');
    return;
  }
  const { selected, grouped } = getGroupedReorderPlan();
  if (!selected.length) {
    alert('No products selected to export.');
    return;
  }
  const showCosts = Boolean(document.getElementById('reorderShowCostsChk')?.checked);
  const wb = new window.ExcelJS.Workbook();
  const ws = wb.addWorksheet('Reorder Plan');

  ws.mergeCells(1, 1, 1, showCosts ? 5 : 3);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `AB-GADGETZ · REORDER PLAN (${todayStr})`;
  titleCell.font = { bold: true, size: 13 };
  titleCell.alignment = { horizontal: 'center' };

  const headers = showCosts
    ? ['Branch', 'Brand / Model', 'Qty', 'Unit Cost', 'Subtotal']
    : ['Branch', 'Brand / Model', 'Qty'];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((c) => {
    c.font = { bold: true, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBE2BE' } };
    c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });

  for (const sup of grouped) {
    const supRow = ws.addRow([sup.supplier]);
    ws.mergeCells(supRow.number, 1, supRow.number, showCosts ? 5 : 3);
    supRow.getCell(1).font = { bold: true, size: 10 };
    supRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F0DC' } };
    for (const b of sup.branches) {
      for (const r of b.rows) {
        const vals = showCosts
          ? [b.branchName, r.displayModel, r.qty, r.unitCost, r.unitCost * r.qty]
          : [b.branchName, r.displayModel, r.qty];
        const row = ws.addRow(vals);
        if (showCosts) {
          row.getCell(4).numFmt = '"₱"#,##0';
          row.getCell(5).numFmt = '"₱"#,##0';
        }
        row.eachCell((c) => {
          c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
        });
      }
    }
  }

  ws.columns = showCosts
    ? [{ width: 16 }, { width: 38 }, { width: 10 }, { width: 14 }, { width: 16 }]
    : [{ width: 16 }, { width: 42 }, { width: 12 }];

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `AB_Gadgetz_Reorder_Plan_${todayStr}.xlsx`;
  a.click();
}

async function loadPlanning() {
  try {
    const [planning, budget] = await Promise.all([api('/api/planning'), api('/api/budget')]);
    state.planning = planning;
    state.budget = budget;
  } catch {
    // static GitHub Pages bundle fallback
  }
  renderPlanning();
}

function getDefaultOrderFunds() {
  const s = state.budget?.summary;
  return {
    metrobank: s?.metrobank ? Number(s.metrobank) : 0,
    maribank: s?.maribank ? Number(s.maribank) : 0,
    gcash: s?.gcash ? Number(s.gcash) : 0,
    undeposited: [],
    creditCards: [
      { name: 'METROBANK CREDIT CARD', amount: 0, dueDate: '' },
      { name: 'EASTWEST GOLD CREDIT CARD', amount: 0, dueDate: '' },
      { name: 'EASTWEST PLATINUM CREDIT CARD', amount: 0, dueDate: '' },
    ],
    deductions: [
      { label: 'Molave Franchise Share', amount: 0 },
      { label: 'Tambulig Franchise Share', amount: 0 },
    ],
  };
}

function getOrderFundsState() {
  if (state.orderFunds) return state.orderFunds;
  try {
    const raw = localStorage.getItem('abg_order_funds_v1');
    if (raw) {
      state.orderFunds = JSON.parse(raw);
      return state.orderFunds;
    }
  } catch {
    // ignore
  }
  state.orderFunds = getDefaultOrderFunds();
  return state.orderFunds;
}

function saveOrderFundsState() {
  try {
    localStorage.setItem('abg_order_funds_v1', JSON.stringify(getOrderFundsState()));
  } catch {
    // ignore
  }
}

function computeOrderFundsTotals(f) {
  const metrobank = Number(f.metrobank) || 0;
  const maribank = Number(f.maribank) || 0;
  const gcash = Number(f.gcash) || 0;
  const undeposited = (f.undeposited || [])
    .filter((u) => !u.deposited)
    .reduce((s, u) => s + (Number(u.amount) || 0), 0);
  const totalCash = metrobank + maribank + gcash + undeposited;
  const totalCards = (f.creditCards || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const totalOther = (f.deductions || []).reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const totalBills = totalCards + totalOther;
  const netOrderBudget = totalCash - totalBills;
  const missingDueCount = (f.creditCards || []).filter((c) => !String(c.dueDate || '').trim()).length;
  return { totalCash, totalBills, netOrderBudget, undeposited, missingDueCount };
}

function updateOrderFundsSummaryUI(syncToInput = true) {
  const f = getOrderFundsState();
  const t = computeOrderFundsTotals(f);
  const netHeader = document.getElementById('orderFundsNetHeader');
  if (netHeader) netHeader.textContent = `Net ${fmtCurrency(t.netOrderBudget)}`;
  const missBadge = document.getElementById('orderFundsMissingBadge');
  if (missBadge) {
    missBadge.classList.toggle('hidden', t.missingDueCount === 0);
    missBadge.textContent = `${t.missingDueCount} due date missing`;
  }
  const sumGrid = document.getElementById('budgetSummaryGrid');
  if (sumGrid) {
    sumGrid.innerHTML = `
      <div class="summary-box">
        TOTAL CASH
        <strong>${fmtCurrency(t.totalCash)}</strong>
      </div>
      <div class="summary-box">
        TOTAL BILLS
        <strong style="color:var(--danger);">${fmtCurrency(t.totalBills)}</strong>
      </div>
      <div class="summary-box" style="border-color:var(--gold);">
        NET ORDER BUDGET
        <strong style="color:var(--gold-bright);">${fmtCurrency(t.netOrderBudget)}</strong>
      </div>
    `;
  }
  const budgetInp = document.getElementById('restockBudgetInput');
  if (budgetInp && syncToInput) {
    budgetInp.value = Math.max(0, t.netOrderBudget).toFixed(2);
  }
}

function renderOrderFundsPanel() {
  const f = getOrderFundsState();
  const mEl = document.getElementById('fundMetrobank');
  const mbEl = document.getElementById('fundMaribank');
  const gEl = document.getElementById('fundGcash');
  if (mEl) mEl.value = f.metrobank || '';
  if (mbEl) mbEl.value = f.maribank || '';
  if (gEl) gEl.value = f.gcash || '';

  const uList = document.getElementById('undepositedSalesList');
  if (uList) {
    uList.innerHTML = (f.undeposited || []).length
      ? f.undeposited
          .map(
            (u, idx) => `
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:rgba(255,255,255,0.03);padding:6px 8px;border-radius:8px;border:1px solid var(--border-soft);">
            <select class="fund-undep-branch" data-idx="${idx}" style="width:auto;padding:5px 8px;font-size:12px;">
              <option value="Molave" ${u.branch === 'Molave' ? 'selected' : ''}>Molave</option>
              <option value="Tambulig" ${u.branch === 'Tambulig' ? 'selected' : ''}>Tambulig</option>
              <option value="Bonifacio" ${u.branch === 'Bonifacio' ? 'selected' : ''}>Bonifacio</option>
            </select>
            <input type="date" class="fund-undep-date" data-idx="${idx}" value="${u.date || ''}" style="width:auto;padding:5px 8px;font-size:12px;" />
            <input type="number" class="fund-undep-amt" data-idx="${idx}" value="${u.amount || ''}" min="0" step="0.01" placeholder="Amount" style="flex:1;min-width:100px;padding:5px 8px;font-size:12px;" />
            <label style="display:flex;align-items:center;gap:5px;margin:0;font-size:11px;font-weight:700;cursor:pointer;">
              <input type="checkbox" class="fund-undep-dep" data-idx="${idx}" ${u.deposited ? 'checked' : ''} style="width:15px;height:15px;margin:0;accent-color:var(--gold);" />
              <span>DEPOSITED</span>
            </label>
            <button type="button" class="secondary fund-undep-del" data-idx="${idx}" style="padding:4px 8px;font-size:12px;min-height:0;">✕</button>
          </div>`
          )
          .join('')
      : '<div class="muted small">No undeposited branch sales recorded.</div>';

    uList.querySelectorAll('.fund-undep-branch').forEach((el) => {
      el.addEventListener('change', (e) => {
        f.undeposited[Number(e.target.dataset.idx)].branch = e.target.value;
        saveOrderFundsState();
      });
    });
    uList.querySelectorAll('.fund-undep-date').forEach((el) => {
      el.addEventListener('change', (e) => {
        f.undeposited[Number(e.target.dataset.idx)].date = e.target.value;
        saveOrderFundsState();
      });
    });
    uList.querySelectorAll('.fund-undep-amt').forEach((el) => {
      el.addEventListener('input', (e) => {
        f.undeposited[Number(e.target.dataset.idx)].amount = Number(e.target.value) || 0;
        saveOrderFundsState();
        updateOrderFundsSummaryUI(true);
      });
    });
    uList.querySelectorAll('.fund-undep-dep').forEach((el) => {
      el.addEventListener('change', (e) => {
        const idx = Number(e.target.dataset.idx);
        const row = f.undeposited[idx];
        const amt = Number(row.amount) || 0;
        if (e.target.checked && !row.deposited) {
          row.deposited = true;
          f.metrobank = Number(((Number(f.metrobank) || 0) + amt).toFixed(2));
        } else if (!e.target.checked && row.deposited) {
          row.deposited = false;
          f.metrobank = Math.max(0, Number(((Number(f.metrobank) || 0) - amt).toFixed(2)));
        }
        saveOrderFundsState();
        renderOrderFundsPanel();
      });
    });
    uList.querySelectorAll('.fund-undep-del').forEach((el) => {
      el.addEventListener('click', (e) => {
        f.undeposited.splice(Number(e.target.dataset.idx), 1);
        saveOrderFundsState();
        renderOrderFundsPanel();
      });
    });
  }

  const ccGrid = document.getElementById('creditCardsBudgetGrid');
  if (ccGrid) {
    ccGrid.innerHTML = (f.creditCards || [])
      .map(
        (c, idx) => `
        <div class="sub-panel" style="padding:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;margin-bottom:6px;">
            <strong style="font-size:11px;">${c.name}</strong>
            ${!String(c.dueDate || '').trim() ? '<span class="badge badge-danger" style="font-size:9px;">DUE DATE MISSING</span>' : ''}
          </div>
          <label style="font-size:10px;">BILL AMOUNT</label>
          <input type="number" class="fund-cc-amt" data-idx="${idx}" value="${c.amount || ''}" min="0" step="0.01" placeholder="₱0" style="padding:5px 8px;font-size:12px;margin-bottom:6px;" />
          <label style="font-size:10px;">DUE DATE</label>
          <input type="date" class="fund-cc-due" data-idx="${idx}" value="${c.dueDate || ''}" style="padding:5px 8px;font-size:12px;" />
        </div>`
      )
      .join('');

    ccGrid.querySelectorAll('.fund-cc-amt').forEach((el) => {
      el.addEventListener('input', (e) => {
        f.creditCards[Number(e.target.dataset.idx)].amount = Number(e.target.value) || 0;
        saveOrderFundsState();
        updateOrderFundsSummaryUI(true);
      });
    });
    ccGrid.querySelectorAll('.fund-cc-due').forEach((el) => {
      el.addEventListener('change', (e) => {
        f.creditCards[Number(e.target.dataset.idx)].dueDate = e.target.value;
        saveOrderFundsState();
        renderOrderFundsPanel();
      });
    });
  }

  const dList = document.getElementById('otherDeductionsList');
  if (dList) {
    dList.innerHTML = (f.deductions || [])
      .map(
        (d, idx) => `
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="text" class="fund-ded-lbl" data-idx="${idx}" value="${d.label || ''}" placeholder="Bill / Deduction name" style="flex:2;padding:5px 8px;font-size:12px;" />
          <input type="number" class="fund-ded-amt" data-idx="${idx}" value="${d.amount || ''}" min="0" step="0.01" placeholder="0.00" style="flex:1;padding:5px 8px;font-size:12px;" />
          <button type="button" class="secondary fund-ded-del" data-idx="${idx}" style="padding:4px 8px;font-size:12px;min-height:0;">✕</button>
        </div>`
      )
      .join('');

    dList.querySelectorAll('.fund-ded-lbl').forEach((el) => {
      el.addEventListener('input', (e) => {
        f.deductions[Number(e.target.dataset.idx)].label = e.target.value;
        saveOrderFundsState();
      });
    });
    dList.querySelectorAll('.fund-ded-amt').forEach((el) => {
      el.addEventListener('input', (e) => {
        f.deductions[Number(e.target.dataset.idx)].amount = Number(e.target.value) || 0;
        saveOrderFundsState();
        updateOrderFundsSummaryUI(true);
      });
    });
    dList.querySelectorAll('.fund-ded-del').forEach((el) => {
      el.addEventListener('click', (e) => {
        f.deductions.splice(Number(e.target.dataset.idx), 1);
        saveOrderFundsState();
        renderOrderFundsPanel();
      });
    });
  }

  updateOrderFundsSummaryUI(true);
}

function renderPlanning() {
  renderOrderFundsPanel();
  buildRestockDraftPlan();
  renderRestockCards();
}

document.getElementById('orderFundsToggle')?.addEventListener('click', () => {
  const body = document.getElementById('orderFundsBody');
  const caret = document.getElementById('orderFundsCaret');
  if (!body) return;
  const hidden = body.classList.toggle('hidden');
  if (caret) caret.textContent = hidden ? '+' : '−';
});

['fundMetrobank', 'fundMaribank', 'fundGcash'].forEach((id) => {
  document.getElementById(id)?.addEventListener('input', (e) => {
    const f = getOrderFundsState();
    if (id === 'fundMetrobank') f.metrobank = Number(e.target.value) || 0;
    if (id === 'fundMaribank') f.maribank = Number(e.target.value) || 0;
    if (id === 'fundGcash') f.gcash = Number(e.target.value) || 0;
    saveOrderFundsState();
    updateOrderFundsSummaryUI(true);
  });
});

document.getElementById('addUndepositedSaleBtn')?.addEventListener('click', () => {
  const f = getOrderFundsState();
  f.undeposited.push({ branch: 'Molave', date: todayStr, amount: 0, deposited: false });
  saveOrderFundsState();
  renderOrderFundsPanel();
});

document.getElementById('addDeductionBtn')?.addEventListener('click', () => {
  const f = getOrderFundsState();
  f.deductions.push({ label: '', amount: 0 });
  saveOrderFundsState();
  renderOrderFundsPanel();
});

document.getElementById('buildRestockPlanBtn')?.addEventListener('click', () => {
  buildRestockDraftPlan();
  renderRestockCards();
  renderReorderPreviewModal();
  document.getElementById('reorderPreviewModal')?.classList.remove('hidden');
});

document.getElementById('previewRestockPlanBtn')?.addEventListener('click', () => {
  if (!state.restockPlan) buildRestockDraftPlan();
  renderReorderPreviewModal();
  document.getElementById('reorderPreviewModal')?.classList.remove('hidden');
});

document.getElementById('restockTypeFilter')?.addEventListener('change', () => {
  buildRestockDraftPlan();
  renderRestockCards();
});

document.querySelectorAll('input[name="restockSupplierMode"]').forEach((r) => {
  r.addEventListener('change', () => {
    buildRestockDraftPlan();
    renderRestockCards();
  });
});

document.getElementById('restockSearchInput')?.addEventListener('input', renderRestockCards);
document.getElementById('restockBrandFilter')?.addEventListener('change', renderRestockCards);
document.getElementById('restockShowFilter')?.addEventListener('change', renderRestockCards);

document.getElementById('reorderSelectAllChk')?.addEventListener('change', (e) => {
  const checked = e.target.checked;
  for (const r of getFilteredRestockRows()) {
    if (state.restockPlan?.[r._idx]) state.restockPlan[r._idx].selected = checked;
  }
  renderRestockCards();
});

document.getElementById('reorderShowCostsChk')?.addEventListener('change', renderReorderPreviewModal);
document.getElementById('closeReorderPreviewBtn')?.addEventListener('click', () => {
  document.getElementById('reorderPreviewModal')?.classList.add('hidden');
});
document.getElementById('reorderBackToEditBtn')?.addEventListener('click', () => {
  document.getElementById('reorderPreviewModal')?.classList.add('hidden');
});
document.getElementById('reorderPrintBtn')?.addEventListener('click', () => window.print());
document.getElementById('reorderPdfBtn')?.addEventListener('click', downloadReorderPlanPdf);
document.getElementById('reorderExcelBtn')?.addEventListener('click', downloadReorderPlanExcel);
document.getElementById('reorderCopyBtn')?.addEventListener('click', async () => {
  const text = buildReorderCopyText();
  const stEl = document.getElementById('reorderPreviewStatus');
  if (!text) {
    if (stEl) {
      stEl.style.color = '#b91c1c';
      stEl.textContent = 'No products selected to copy.';
    }
    return;
  }
  const ok = await copyTextToClipboard(text);
  if (stEl) {
    stEl.style.color = ok ? '#1d6f42' : '#b91c1c';
    stEl.textContent = ok ? 'Copied Reorder request to clipboard.' : 'Unable to copy automatically.';
  }
});

function renderCostCompareTool() {
  if (!state.inventory) return;
  const search = (document.getElementById('costCompareSearch')?.value || '').trim().toLowerCase();
  const typeFilter = document.getElementById('costCompareType')?.value || 'Cellphones';
  const stockFilter = document.getElementById('costCompareStockFilter')?.value || 'IN_STOCK';
  const modeFilter = document.getElementById('costCompareFilter')?.value || 'ALL';
  const sortMode = document.getElementById('costCompareSort')?.value || 'SAVINGS_DESC';

  const { branches, items } = state.inventory;
  const rows = [];
  let comparedCount = 0;
  let savingsModels = 0;
  let totalUnitSavings = 0;
  let lowStockSavingsCount = 0;
  const supplierWins = { 'AB Main Supplier': 0, 'A&K': 0, 'Online Purchase': 0 };

  for (const item of items) {
    if ((item.lifecycle_status || 'Active') !== 'Active') continue;
    const pType = item.product_type || 'Cellphones';
    if (typeFilter !== 'ALL' && pType !== typeFilter) continue;

    const webCost = Number(item.cost_price) || 0;
    const cAb = Number(item.cost_ab) || 0;
    const cAk = Number(item.cost_ak) || 0;
    const cOn = Number(item.cost_online) || 0;

    const sups = [
      { name: 'AB Main Supplier', val: cAb },
      { name: 'A&K', val: cAk },
      { name: 'Online Purchase', val: cOn },
    ].filter((s) => s.val > 0);
    sups.sort((a, b) => a.val - b.val);
    const best = sups[0] || null;

    if (best) {
      comparedCount++;
      supplierWins[best.name] = (supplierWins[best.name] || 0) + 1;
    }

    const diffVsWeb = best && webCost > 0 ? webCost - best.val : 0; // positive = supplier saves money
    if (diffVsWeb > 0) {
      savingsModels++;
      totalUnitSavings += diffVsWeb;
    }

    let totalAvail = 0;
    let needsRestock = false;
    const price = Number(item.base_price) || 0;
    for (const b of branches) {
      const cell = item.byBranch[b.id];
      const av = Number(cell?.qtyAvailable) || 0;
      totalAvail += av;
      const defaultRp = price < 10000 ? (b.id === 'br-molave' ? 2 : 1) : price <= 20000 ? 2 : 1;
      const rp = Number(cell?.reorderPoint) || defaultRp;
      if (av <= rp) needsRestock = true;
    }

    if (needsRestock && diffVsWeb > 0) lowStockSavingsCount++;

    const displayModel = formatSwapModelName({ brand: item.brand || '', model: item.model || item.name });
    if (
      search &&
      !displayModel.toLowerCase().includes(search) &&
      !(item.brand || '').toLowerCase().includes(search) &&
      !(item.website_codes || item.sku || '').toLowerCase().includes(search)
    ) {
      continue;
    }

    if (modeFilter === 'SAVINGS' && diffVsWeb <= 0) continue;
    if (modeFilter === 'OVERPAY' && !(best && webCost > 0 && diffVsWeb < 0)) continue;
    if (modeFilter === 'LOW_STOCK_SAVINGS' && !(needsRestock && diffVsWeb > 0)) continue;
    if (modeFilter === 'MISSING' && best) continue;

    if (stockFilter === 'IN_STOCK' && totalAvail <= 0) continue;
    if (stockFilter === 'OUT_OF_STOCK' && totalAvail > 0) continue;

    const highestSup = sups.length > 1 ? sups[sups.length - 1] : null;
    const supplierSpread = best && highestSup ? highestSup.val - best.val : 0;

    rows.push({
      id: item.id,
      displayModel,
      sku: item.website_codes || item.sku,
      totalAvail,
      needsRestock,
      webCost,
      cAb,
      cAk,
      cOn,
      best,
      highestSup,
      supplierSpread,
      diffVsWeb,
    });
  }

  rows.sort((a, b) => {
    if (sortMode === 'NEED_SAVINGS') {
      if (a.needsRestock !== b.needsRestock) return a.needsRestock ? -1 : 1;
      if (a.diffVsWeb !== b.diffVsWeb) return b.diffVsWeb - a.diffVsWeb;
      return a.totalAvail - b.totalAvail;
    }
    if (sortMode === 'MODEL_ASC') return a.displayModel.localeCompare(b.displayModel);
    if (a.diffVsWeb !== b.diffVsWeb) return b.diffVsWeb - a.diffVsWeb;
    return (b.best ? 1 : 0) - (a.best ? 1 : 0) || a.displayModel.localeCompare(b.displayModel);
  });

  const topSupEntry = Object.entries(supplierWins).sort((a, b) => b[1] - a[1])[0];
  const sumGrid = document.getElementById('costCompareSummaryGrid');
  if (sumGrid) {
    sumGrid.innerHTML = `
      <div class="summary-box">MODELS WITH SUPPLIER COSTS<strong>${fmtNum(comparedCount)}</strong></div>
      <div class="summary-box">CHEAPER VIA SUPPLIER<strong style="color:var(--green);">${fmtNum(savingsModels)} (${fmtCurrency(totalUnitSavings)}/pc sum)</strong></div>
      <div class="summary-box">PRIORITY RESTOCK + SAVINGS<strong style="color:var(--gold-bright);">${fmtNum(lowStockSavingsCount)}</strong></div>
      <div class="summary-box">MOST COMPETITIVE SUPPLIER<strong>${topSupEntry && topSupEntry[1] > 0 ? `${topSupEntry[0]} (${topSupEntry[1]})` : '—'}</strong></div>
    `;
  }

  const bannerEl = document.getElementById('costCompareInsightBanner');
  if (bannerEl) {
    bannerEl.innerHTML = comparedCount > 0
      ? `<strong>Restock Strategy Impact:</strong> <strong>${fmtNum(lowStockSavingsCount)}</strong> low-stock model(s) can be ordered cheaper than their AB Website recorded cost. The <strong>RESTOCK</strong> plan automatically prioritizes these high-savings low-stock models first so your Net Order Budget yields higher profit margins.`
      : `<strong>Tip:</strong> Enter supplier costs (<strong>AB ₱</strong>, <strong>A&amp;K ₱</strong>, <strong>Online ₱</strong>) in <strong>RESTOCK</strong> or by clicking any product card in <strong>INVENTORY</strong> to compare against the AB Website recorded cost.`;
  }

  const fmtCell = (val, webCost, cls, pid) => {
    const d = val > 0 && webCost > 0 ? webCost - val : 0;
    const diffHtml = !(val > 0 && webCost > 0)
      ? ''
      : d > 0
        ? `<div class="small" style="color:var(--green);">-${fmtCurrency(d)}</div>`
        : d < 0
          ? `<div class="small" style="color:#f59e0b;">+${fmtCurrency(Math.abs(d))}</div>`
          : '<div class="small muted">Same</div>';
    return `
      <input type="number" class="${cls}" data-pid="${pid}" value="${val > 0 ? val : ''}" min="0" step="0.01" placeholder="0" style="width:82px;padding:4px 6px;font-size:12px;" />
      ${diffHtml}
    `;
  };

  const tbody = document.querySelector('#costCompareTable tbody');
  if (!tbody) return;
  tbody.innerHTML = rows.length
    ? rows
        .slice(0, 150)
        .map((r) => {
          const bestHtml = r.best
            ? r.diffVsWeb > 0
              ? `<span class="badge badge-ok">${r.best.name}</span><div class="small" style="color:var(--green);margin-top:2px;">Saves ${fmtCurrency(r.diffVsWeb)}/pc vs Web</div>`
              : r.diffVsWeb < 0
                ? `<span class="badge badge-warn">${r.best.name}</span><div class="small" style="color:#f59e0b;margin-top:2px;">+${fmtCurrency(Math.abs(r.diffVsWeb))}/pc vs Web</div>`
                : `<span class="badge badge-ok">${r.best.name}</span><div class="small" style="color:${r.supplierSpread > 0 ? 'var(--green)' : 'var(--muted)'};margin-top:2px;">${r.supplierSpread > 0 ? `Saves ${fmtCurrency(r.supplierSpread)} vs ${r.highestSup.name}` : 'Matches Web'}</div>`
            : '<span class="muted small">No supplier cost</span>';

          const actionHtml = !r.best
            ? '<span class="muted small">Add supplier costs to analyze</span>'
            : r.needsRestock && r.diffVsWeb > 0
              ? `<strong style="color:var(--gold-bright);">Order Now (${r.best.name})</strong><div class="small muted">${r.totalAvail} avail • Best margin gain</div>`
              : r.needsRestock
                ? `<span style="color:var(--text);">Restock Needed (${r.totalAvail} avail)</span><div class="small muted">Use ${r.best.name}</div>`
                : `<span class="muted small">Stock OK (${r.totalAvail} avail)</span>`;

          return `
            <tr data-pid="${r.id}">
              <td><strong>${r.displayModel}</strong><div class="small muted">${r.sku} • ${r.totalAvail} avail</div></td>
              <td><strong>${r.webCost > 0 ? fmtCurrency(r.webCost) : '—'}</strong></td>
              <td>${fmtCell(r.cAb, r.webCost, 'cc-ab-inp', r.id)}</td>
              <td>${fmtCell(r.cAk, r.webCost, 'cc-ak-inp', r.id)}</td>
              <td>${fmtCell(r.cOn, r.webCost, 'cc-on-inp', r.id)}</td>
              <td>${bestHtml}</td>
              <td>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                  <div>${actionHtml}</div>
                  <button type="button" class="secondary cc-save-btn" data-pid="${r.id}" style="padding:4px 8px;font-size:11px;min-height:0;">Save</button>
                </div>
              </td>
            </tr>`;
        })
        .join('')
    : '<tr><td colspan="7" class="muted">No products match the current filter.</td></tr>';

  tbody.querySelectorAll('.cc-save-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const pid = btn.dataset.pid;
      const costAb = tr?.querySelector('.cc-ab-inp')?.value ?? '';
      const costAk = tr?.querySelector('.cc-ak-inp')?.value ?? '';
      const costOnline = tr?.querySelector('.cc-on-inp')?.value ?? '';
      btn.textContent = '...';
      try {
        await saveProductSupplierCosts(pid, { costAb, costAk, costOnline });
        renderCostCompareTool();
        if (state.restockPlan) {
          buildRestockDraftPlan();
          renderRestockCards();
        }
      } catch (err) {
        btn.textContent = 'Err';
        alert(err.message);
      }
    });
  });
}

document.getElementById('costCompareSearch')?.addEventListener('input', renderCostCompareTool);
document.getElementById('costCompareType')?.addEventListener('change', renderCostCompareTool);
document.getElementById('costCompareStockFilter')?.addEventListener('change', renderCostCompareTool);
document.getElementById('costCompareFilter')?.addEventListener('change', renderCostCompareTool);
document.getElementById('costCompareSort')?.addEventListener('change', renderCostCompareTool);
document.getElementById('applyCostPriorityRestockBtn')?.addEventListener('click', () => {
  const restockBtn = document.querySelector('.inv-tool-btn[data-tool="restock"]');
  if (restockBtn) restockBtn.click();
});

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
  const isCashSale = (m) => m.delta_qty < 0 && m.movement_type.includes('SALE') && !m.movement_type.includes('INSTALLMENT');
  const isAnySale = (m) => m.delta_qty < 0 && m.movement_type.includes('SALE');

  // Compute clickable branch sold totals (Installment mode counts installment sales; Cash mode counts cash sales; All counts all sales)
  const soldByBranch = { 'br-molave': 0, 'br-tambulig': 0, 'br-bonifacio': 0 };
  if (mode === 'INSTALLMENT') {
    if (pType !== 'Accessories') {
      for (const i of data.allInstallments || []) {
        if (soldByBranch[i.branch_id] !== undefined) soldByBranch[i.branch_id] += 1;
      }
    }
  } else {
    const matchSale = mode === 'CASH' ? isCashSale : isAnySale;
    for (const m of data.allMovements || []) {
      if (matchSale(m) && filterMovementType(m) && soldByBranch[m.branch_id] !== undefined) {
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
  const viewsLbl = document.getElementById('catalogViewsToggleLabel');
  if (viewsLbl) {
    viewsLbl.textContent = `Catalog Views (${fmtNum(vTot.total)} views)`;
  }
  if (viewsGrid) {
    viewsGrid.innerHTML = `
      <div class="summary-box compact-act-box">
        Molave<strong>${fmtNum(vMol.total)} views</strong>
      </div>
      <div class="summary-box compact-act-box">
        Tambulig<strong>${fmtNum(vTam.total)} views</strong>
      </div>
      <div class="summary-box compact-act-box">
        Bonifacio<strong>${fmtNum(vBon.total)} views</strong>
      </div>
      <div class="summary-box compact-act-box">
        ALL<strong>${fmtNum(vTot.total)} views</strong>
      </div>
    `;
  }
  document.getElementById('activitySalesGrid').innerHTML = `
    <button type="button" class="summary-box compact-act-box act-summary-btn ${branchFilter === 'br-molave' ? 'active' : ''}" data-branch="br-molave">
      Molave<strong>${fmtNum(soldByBranch['br-molave'] || 0)} pcs</strong>
    </button>
    <button type="button" class="summary-box compact-act-box act-summary-btn ${branchFilter === 'br-tambulig' ? 'active' : ''}" data-branch="br-tambulig">
      Tambulig<strong>${fmtNum(soldByBranch['br-tambulig'] || 0)} pcs</strong>
    </button>
    <button type="button" class="summary-box compact-act-box act-summary-btn ${branchFilter === 'br-bonifacio' ? 'active' : ''}" data-branch="br-bonifacio">
      Bonifacio<strong>${fmtNum(soldByBranch['br-bonifacio'] || 0)} pcs</strong>
    </button>
    <button type="button" class="summary-box compact-act-box act-summary-btn ${branchFilter === '' ? 'active' : ''}" data-branch="">
      ALL<strong>${fmtNum(totalSold)} pcs</strong>
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
        <th>Date / Time</th>
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
            <td>${String(m.movement_type || '').startsWith('STOCKCARD_') ? String(m.recorded_at || '').slice(0, 10) : fmtTime(m.recorded_at)}</td>
            <td>${m.branch_name}</td>
            <td>${m.product_name}</td>
            <td><span class="badge badge-info">${m.product_type || 'Cellphones'}</span></td>
            <td>${String(m.movement_type || '').replace(/^STOCKCARD_SALE_ORDER$/, 'CASH SALE (ORDER)').replace(/^STOCKCARD_SALE_INSTALLMENT$/, 'INSTALLMENT SALE').replace(/^STOCKCARD_/, '')}</td>
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
  if (state.userRole !== 'ADMIN') {
    if (s.isSyncing) txt.textContent = 'Syncing...';
    else if (s.paused) txt.textContent = `Paused • ${fmtTime(s.lastSyncAt)}`;
    else txt.textContent = `LIVE • ${fmtTime(s.lastSyncAt)}`;
  } else {
    if (s.isSyncing) txt.textContent = 'Syncing portal...';
    else if (s.paused) txt.textContent = `Paused • ${fmtTime(s.lastSyncAt)}`;
    else txt.textContent = `${s.adapterMode} • Last: ${fmtTime(s.lastSyncAt)}`;
  }
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
document.getElementById('costProduct')?.addEventListener('change', syncCostInputs);
document.getElementById('recAction')?.addEventListener('change', (e) => {
  document.getElementById('recDestWrap')?.classList.toggle('hidden', e.target.value !== 'Stock swap');
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

document.getElementById('saveMovementBtn')?.addEventListener('click', async () => {
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

document.getElementById('savePriceBtn')?.addEventListener('click', async () => {
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

document.getElementById('saveAddProductBtn')?.addEventListener('click', async () => {
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

document.getElementById('saveCostBtn')?.addEventListener('click', async () => {
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
function shiftActivityDates(deltaDays) {
  const startEl = document.getElementById('actStart');
  const endEl = document.getElementById('actEnd');
  if (!startEl || !endEl) return;
  const baseStr = endEl.value || startEl.value || todayStr;
  const dt = new Date(`${baseStr}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return;
  dt.setDate(dt.getDate() + deltaDays);
  const nextStr = dt.toISOString().slice(0, 10);
  if (nextStr > todayStr) return;
  startEl.value = nextStr;
  endEl.value = nextStr;
  loadActivity();
}
document.getElementById('actPrevDayBtn')?.addEventListener('click', () => shiftActivityDates(-1));
document.getElementById('actNextDayBtn')?.addEventListener('click', () => shiftActivityDates(1));
document.getElementById('toggleCatalogViewsBtn')?.addEventListener('click', () => {
  const grid = document.getElementById('activityViewsGrid');
  const btn = document.getElementById('toggleCatalogViewsBtn');
  const arrow = document.getElementById('catalogViewsToggleArrow');
  if (!grid || !btn) return;
  const willOpen = grid.classList.contains('hidden');
  grid.classList.toggle('hidden', !willOpen);
  btn.setAttribute('aria-expanded', String(willOpen));
  if (arrow) arrow.textContent = willOpen ? '▲' : '▼';
});
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

// Default dates for Activity Log, Finance & Inventory Report Date
const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
const monthStartStr = todayStr.slice(0, 7) + '-01';
document.getElementById('actStart').value = todayStr;
document.getElementById('actEnd').value = todayStr;
document.getElementById('finStart').value = monthStartStr;
document.getElementById('finEnd').value = todayStr;
if (document.getElementById('inventoryReportDate')) {
  document.getElementById('inventoryReportDate').value = todayStr;
}

const PDF_BRAND_ORDER = [
  'infinix', 'tecno', 'realme', 'itel', 'redmi',
  'vivo', 'honor', 'samsung', 'nubia', 'zte',
  'poco', 'oppo', 'apple',
];

function groupInventoryForPdf(items) {
  const map = new Map();
  for (const item of items) {
    const isFreebie = isFreebieAccessory(item);
    const rawBrand = isFreebie ? 'FREEBIES' : (String(item.brand || item.category || 'OTHER').trim() || 'OTHER');
    const key = rawBrand.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { brand: rawBrand.toUpperCase(), items: [] });
    }
    map.get(key).items.push(item);
  }
  const groups = Array.from(map.values());
  groups.forEach((g) => {
    g.items.sort((a, b) => {
      if (g.brand === 'FREEBIES') {
        return String(a.model || a.name).localeCompare(String(b.model || b.name));
      }
      const pDiff = (Number(a.base_price) || 0) - (Number(b.base_price) || 0);
      if (pDiff !== 0) return pDiff;
      return String(a.model || a.name).localeCompare(String(b.model || b.name));
    });
  });
  groups.sort((a, b) => {
    if (a.brand === 'FREEBIES') return -1;
    if (b.brand === 'FREEBIES') return 1;
    const ia = PDF_BRAND_ORDER.indexOf(a.brand.toLowerCase());
    const ib = PDF_BRAND_ORDER.indexOf(b.brand.toLowerCase());
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.brand.localeCompare(b.brand);
  });
  return groups;
}

function getScopedInventoryForExport(productType) {
  if (!state.inventory) return { branchLabel: 'All Branches', items: [] };
  const { branches, items } = state.inventory;
  const globalBranchId = document.getElementById('globalBranch').value;
  const visibleBranches = globalBranchId
    ? branches.filter((b) => b.id === globalBranchId)
    : branches;
  const branchLabel = visibleBranches.length === 1 ? visibleBranches[0].name : 'All Branches';

  const result = [];
  for (const item of items) {
    const itemType = item.product_type || 'Cellphones';
    if (itemType !== productType) continue;
    let qty = 0;
    for (const b of visibleBranches) {
      const cell = item.byBranch[b.id];
      if (cell) qty += Number(cell.qtyAvailable) || 0;
    }
    result.push({
      ...item,
      exportQty: qty,
    });
  }
  return { branchLabel, visibleBranches, items: result };
}

function setInventoryDownloadMsg(text, isError) {
  const el = document.getElementById('inventoryDownloadMsg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('error', Boolean(isError && text));
}

function buildDailyInventoryReportData(productType, reportDateStr, movementsList = []) {
  const { branchLabel, visibleBranches, items } = getScopedInventoryForExport(productType);
  const visibleBranchIds = new Set((visibleBranches || []).map((b) => b.id));
  const dateParts = String(reportDateStr || todayStr).split('-').map(Number);
  const year = dateParts[0] || new Date().getFullYear();
  const monthIndex = (dateParts[1] || new Date().getMonth() + 1) - 1;
  const asOfDay = dateParts[2] || new Date().getDate();
  const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const monthStart = `${monthKey}-01`;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const monthName = new Date(year, monthIndex, 1).toLocaleDateString('en-US', { month: 'long' });

  const netChangesSinceMonthStart = new Map();
  const monthlyDailyChanges = new Map();
  for (const m of movementsList || []) {
    if (visibleBranchIds.size && m.branch_id && !visibleBranchIds.has(m.branch_id)) continue;
    const moveDate = String(m.recorded_at || '').slice(0, 10);
    if (!moveDate || moveDate < monthStart || moveDate > todayStr) continue;
    const pid = m.product_id;
    const delta = Number(m.delta_qty) || 0;
    if (!pid || delta === 0) continue;
    netChangesSinceMonthStart.set(pid, (netChangesSinceMonthStart.get(pid) || 0) + delta);
    if (moveDate.slice(0, 7) === monthKey) {
      const dayNum = Number(moveDate.slice(8, 10));
      if (dayNum >= 1 && dayNum <= daysInMonth) {
        if (!monthlyDailyChanges.has(pid)) {
          monthlyDailyChanges.set(pid, new Array(daysInMonth + 1).fill(0));
        }
        monthlyDailyChanges.get(pid)[dayNum] += delta;
      }
    }
  }

  const itemsWithDaily = items.map((item) => {
    const pid = item.id;
    const changes = monthlyDailyChanges.get(pid) || new Array(daysInMonth + 1).fill(0);
    let balance = (Number(item.exportQty) || 0) - (netChangesSinceMonthStart.get(pid) || 0);
    const daily = [];
    let hasPositiveDay = item.exportQty > 0;
    for (let day = 1; day <= daysInMonth; day++) {
      if (day <= asOfDay) {
        balance += changes[day];
        const cleanBal = Math.max(0, balance);
        if (cleanBal > 0) hasPositiveDay = true;
        daily.push(cleanBal);
      } else {
        daily.push(null);
      }
    }
    return { ...item, daily, hasPositiveDay };
  });

  const activeItems = itemsWithDaily.filter((i) => i.hasPositiveDay);
  const groups = groupInventoryForPdf(activeItems);
  const dailyTotals = new Array(daysInMonth).fill(0);
  for (const it of activeItems) {
    it.daily.forEach((val, idx) => {
      if (val !== null && val > 0) dailyTotals[idx] += val;
    });
  }

  return { branchLabel, year, monthIndex, asOfDay, daysInMonth, monthName, activeItems, groups, dailyTotals };
}

function generateInventoryPdfForType(productType, reportDateStr, movementsList = [], blankQuantities = false) {
  const jspdfNs = window.jspdf;
  if (!jspdfNs || typeof jspdfNs.jsPDF !== 'function') {
    throw new Error('PDF generator library is still loading. Please try again in a second.');
  }
  const { branchLabel, year, asOfDay, daysInMonth, monthName, groups, dailyTotals } =
    buildDailyInventoryReportData(productType, reportDateStr, movementsList);

  const doc = new jspdfNs.jsPDF({
    orientation: 'portrait',
    unit: 'in',
    format: [8.5, 13],
    compress: true,
  });

  if (typeof doc.autoTable !== 'function') {
    throw new Error('PDF table plugin is unavailable.');
  }

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16 / 72;
  const topY = 60 / 72;
  const bottomMargin = 24 / 72;
  const contentWidth = pageWidth - margin * 2;
  const modelWidth = 125 / 72;
  const priceWidth = 84 / 72;

  const isAccessories = productType === 'Accessories';
  const totalModelRows = groups.reduce((s, g) => s + g.items.length, 0);
  const totalVisualRows = Math.max(1, groups.length + totalModelRows + 2);
  const availableHeightPt = (pageHeight - topY - bottomMargin) * 72;
  const rowSlot = availableHeightPt / totalVisualRows;
  const fontSize = isAccessories ? 7.5 : Math.max(5.5, Math.min(9, rowSlot - 2.5));
  const cellPadding = isAccessories ? 2 / 72 : Math.max(0.6, Math.min(1.5, fontSize * 0.16)) / 72;

  const dayPanels = [
    Array.from({ length: Math.min(15, daysInMonth) }, (_, idx) => idx + 1),
    Array.from({ length: Math.max(0, daysInMonth - 15) }, (_, idx) => idx + 16),
  ].filter((panel) => panel.length > 0);

  dayPanels.forEach((panelDays, panelIndex) => {
    if (panelIndex > 0) {
      doc.addPage([8.5, 13], 'portrait');
    }

    const totalColumns = 2 + panelDays.length;
    const dayWidth = (contentWidth - modelWidth - priceWidth) / Math.max(1, panelDays.length);
    const columnStyles = {
      0: { cellWidth: modelWidth, halign: 'left' },
      1: { cellWidth: priceWidth, halign: 'right' },
    };
    panelDays.forEach((_, idx) => {
      columnStyles[idx + 2] = { cellWidth: dayWidth, halign: 'right' };
    });

    const bodyRows = [];
    groups.forEach((group) => {
      bodyRows.push([
        {
          content: group.brand,
          colSpan: totalColumns,
          styles: {
            fontStyle: 'bold',
            halign: 'left',
            fillColor: [242, 239, 224],
          },
        },
      ]);

      group.items.forEach((item) => {
        const priceNum = Number(item.base_price) || 0;
        const priceText = isFreebieAccessory(item)
          ? ''
          : 'P ' + priceNum.toLocaleString('en-PH', { maximumFractionDigits: 0 });
        const dayCells = panelDays.map((d) => {
          if (blankQuantities) return '';
          const val = item.daily ? item.daily[d - 1] : (d <= asOfDay ? item.exportQty : null);
          return val !== null && Number(val) > 0 ? Number(val).toLocaleString('en-PH') : '';
        });
        bodyRows.push([String(item.model || item.name || ''), priceText, ...dayCells]);
      });
    });

    const totalRow = [
      {
        content: 'TOTAL STOCK BALANCE',
        colSpan: 2,
        styles: {
          fontStyle: 'bold',
          halign: 'left',
        },
      },
      ...panelDays.map((d) => {
        if (blankQuantities) return '';
        const tot = dailyTotals[d - 1] || 0;
        return tot > 0 ? tot.toLocaleString('en-PH') : '';
      }),
    ];
    bodyRows.push(totalRow);

    const drawHeader = () => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(27, 25, 19);
      doc.text(`AB-Gadgetz-${branchLabel}: Daily Inventory of ${productType}`, margin, 25 / 72);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(79, 73, 58);
      doc.text(`Month of ${monthName} ${year}`, pageWidth / 2, 44 / 72, { align: 'center' });
    };
    drawHeader();

    doc.autoTable({
      startY: topY,
      margin: { top: topY, left: margin, right: margin, bottom: bottomMargin },
      tableWidth: contentWidth,
      head: [['Model', 'Unit Price (P)', ...panelDays.map((d) => String(d))]],
      body: bodyRows,
      theme: 'grid',
      showHead: 'everyPage',
      pageBreak: isAccessories ? 'auto' : 'avoid',
      rowPageBreak: 'avoid',
      didDrawPage: drawHeader,
      styles: {
        font: 'helvetica',
        fontSize,
        cellPadding,
        lineColor: [75, 70, 58],
        lineWidth: 0.65 / 72,
        textColor: [27, 25, 19],
        overflow: 'ellipsize',
        valign: 'middle',
      },
      headStyles: {
        fillColor: [235, 226, 190],
        textColor: [30, 30, 30],
        lineColor: [55, 50, 40],
        lineWidth: 0.75 / 72,
        fontStyle: 'bold',
        halign: 'center',
      },
      columnStyles,
      didParseCell(hookData) {
        if (hookData.section === 'body' && hookData.row.index === bodyRows.length - 1) {
          hookData.cell.styles.fillColor = [233, 228, 211];
          hookData.cell.styles.fontStyle = 'bold';
        }
      },
      didDrawCell(hookData) {
        if (hookData.column.index !== 1) return;
        const txt = String((hookData.cell.text && hookData.cell.text[0]) || '');
        if (!txt) return;
        const fs = hookData.cell.styles.fontSize || fontSize;
        const fIn = fs / 72;
        doc.setFont('helvetica', hookData.cell.styles.fontStyle || 'normal');
        doc.setFontSize(fs);
        doc.setDrawColor(27, 25, 19);
        doc.setLineWidth(Math.max(0.25, fs * 0.05) / 72);

        const drawCrossbars = (px, pW, midY) => {
          const x1 = px - 0.35 / 72;
          const x2 = px + pW + 0.45 / 72;
          doc.line(x1, midY - 0.16 * fIn, x2, midY - 0.16 * fIn);
          doc.line(x1, midY - 0.03 * fIn, x2, midY - 0.03 * fIn);
        };

        const midY = hookData.cell.y + hookData.cell.height / 2;
        if (hookData.section === 'head' && txt.includes('(P)')) {
          const totalW = doc.getTextWidth(txt);
          const beforeW = doc.getTextWidth(txt.slice(0, txt.indexOf('(P)') + 1));
          const pW = doc.getTextWidth('P');
          const startX = hookData.cell.x + (hookData.cell.width - totalW) / 2;
          drawCrossbars(startX + beforeW, pW, midY);
        } else if (hookData.section === 'body' && txt.startsWith('P ')) {
          const padR = hookData.cell.padding('right');
          const totalW = doc.getTextWidth(txt);
          const pW = doc.getTextWidth('P');
          const startX = hookData.cell.x + hookData.cell.width - padR - totalW;
          drawCrossbars(startX, pW, midY);
        }
      },
    });
  });

  const branchSlug = branchLabel.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  const dateSlug = reportDateStr || todayStr;
  const suffix = blankQuantities ? 'Blank_Count_Sheet' : 'Daily_Stock_Balances';
  const fileName = `AB_Gadgetz_${branchSlug}_${productType}_${suffix}_${dateSlug}.pdf`;
  doc.save(fileName);
  return fileName;
}

async function downloadInventoryPdf(blankQuantities = false) {
  try {
    setInventoryDownloadMsg(
      blankQuantities ? 'Generating blank physical count sheet PDF...' : 'Generating PDF with daily stock history...',
      false
    );
    const reportDateStr = document.getElementById('inventoryReportDate')?.value || todayStr;
    const monthStart = `${reportDateStr.slice(0, 7)}-01`;
    const globalBranchId = document.getElementById('globalBranch')?.value || '';
    let movementsList = [];
    if (!blankQuantities) {
      try {
        const actData = await api(`/api/activity?start=${monthStart}&end=${todayStr}&branchId=${globalBranchId}`);
        movementsList = actData?.allMovements || actData?.movements || [];
      } catch {}
    }
    const selectedTypes = getSelectedProductTypes();
    const typesToExport = selectedTypes.length ? selectedTypes : ['Cellphones'];
    const files = typesToExport.map((t) => generateInventoryPdfForType(t, reportDateStr, movementsList, blankQuantities));
    setInventoryDownloadMsg(`Downloaded: ${files.join(', ')}`, false);
  } catch (err) {
    setInventoryDownloadMsg(err.message || 'Unable to generate PDF.', true);
  }
}

async function downloadInventoryExcel() {
  try {
    if (!state.inventory) return;
    if (!window.ExcelJS) {
      throw new Error('Excel generator library is still loading. Please try again in a second.');
    }
    setInventoryDownloadMsg('Generating formatted Excel workbook...', false);
    const reportDateStr = document.getElementById('inventoryReportDate')?.value || todayStr;
    const monthStart = `${reportDateStr.slice(0, 7)}-01`;
    const globalBranchId = document.getElementById('globalBranch')?.value || '';
    let movementsList = [];
    try {
      const actData = await api(`/api/activity?start=${monthStart}&end=${todayStr}&branchId=${globalBranchId}`);
      movementsList = actData?.allMovements || actData?.movements || [];
    } catch {}

    const selectedTypes = getSelectedProductTypes();
    const typesToExport = selectedTypes.length ? selectedTypes : ['Cellphones'];
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = 'AB Gadgetz';
    workbook.created = new Date();

    const thinBorder = {
      top: { style: 'thin', color: { argb: 'FFD7D0BE' } },
      left: { style: 'thin', color: { argb: 'FFD7D0BE' } },
      bottom: { style: 'thin', color: { argb: 'FFD7D0BE' } },
      right: { style: 'thin', color: { argb: 'FFD7D0BE' } },
    };

    let branchSlug = 'All_Branches';
    for (const productType of typesToExport) {
      const { branchLabel, year, daysInMonth, monthName, groups, dailyTotals } =
        buildDailyInventoryReportData(productType, reportDateStr, movementsList);
      branchSlug = branchLabel.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');

      const sheet = workbook.addWorksheet(productType, {
        views: [{ state: 'frozen', xSplit: 2, ySplit: 3 }],
        pageSetup: { paperSize: 5, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      });

      const totalCols = 2 + daysInMonth;
      sheet.getColumn(1).width = 28;
      sheet.getColumn(2).width = 16;
      for (let d = 1; d <= daysInMonth; d++) {
        sheet.getColumn(2 + d).width = 5.5;
      }

      // Row 1: Title (Apps Script PDF layout)
      const titleRow = sheet.addRow([`AB-Gadgetz-${branchLabel}: Daily Inventory of ${productType}`]);
      sheet.mergeCells(1, 1, 1, totalCols);
      titleRow.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF1B1913' } };
      titleRow.alignment = { vertical: 'middle', horizontal: 'left' };
      titleRow.height = 22;

      // Row 2: Subtitle
      const subRow = sheet.addRow([`Month of ${monthName} ${year}`]);
      sheet.mergeCells(2, 1, 2, totalCols);
      subRow.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF4F493A' } };
      subRow.alignment = { vertical: 'middle', horizontal: 'center' };
      subRow.height = 18;

      // Row 3: Table Header
      const daysHeaders = Array.from({ length: daysInMonth }, (_, i) => i + 1);
      const headerRow = sheet.addRow(['Model', 'Unit Price (₱)', ...daysHeaders]);
      headerRow.height = 20;
      headerRow.eachCell((cell, colNumber) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBE2BE' } };
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF1E1E1E' } };
        cell.alignment = { vertical: 'middle', horizontal: colNumber === 1 ? 'left' : 'center' };
        cell.border = thinBorder;
      });

      // Brand groups + Model rows
      groups.forEach((group) => {
        const gRow = sheet.addRow([group.brand]);
        const rIdx = gRow.number;
        sheet.mergeCells(rIdx, 1, rIdx, totalCols);
        gRow.height = 17;
        for (let c = 1; c <= totalCols; c++) {
          const cell = gRow.getCell(c);
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2EFE0' } };
          cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF1B1913' } };
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
          cell.border = thinBorder;
        }

        group.items.forEach((item) => {
          const isFreebie = isFreebieAccessory(item);
          const priceNum = isFreebie ? null : (Number(item.base_price) || 0);
          const dayVals = daysHeaders.map((d) => {
            const val = item.daily ? item.daily[d - 1] : null;
            return val !== null && Number(val) > 0 ? Number(val) : null;
          });
          const mRow = sheet.addRow([String(item.model || item.name || ''), priceNum, ...dayVals]);
          mRow.height = 16;
          mRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            cell.font = { name: 'Arial', size: 8.5, color: { argb: 'FF1B1913' } };
            cell.border = thinBorder;
            if (colNumber === 1) {
              cell.alignment = { vertical: 'middle', horizontal: 'left' };
            } else if (colNumber === 2) {
              cell.alignment = { vertical: 'middle', horizontal: 'right' };
              if (priceNum !== null) cell.numFmt = '"₱"#,##0';
            } else {
              cell.alignment = { vertical: 'middle', horizontal: 'right' };
              if (cell.value !== null && cell.value !== '') cell.numFmt = '#,##0';
            }
          });
        });
      });

      // Footer Row: TOTAL STOCK BALANCE
      const totalRowVals = [
        'TOTAL STOCK BALANCE',
        null,
        ...daysHeaders.map((d) => (dailyTotals[d - 1] > 0 ? dailyTotals[d - 1] : null)),
      ];
      const fRow = sheet.addRow(totalRowVals);
      sheet.mergeCells(fRow.number, 1, fRow.number, 2);
      fRow.height = 19;
      for (let c = 1; c <= totalCols; c++) {
        const cell = fRow.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9E4D3' } };
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF1B1913' } };
        cell.border = thinBorder;
        cell.alignment = { vertical: 'middle', horizontal: c <= 2 ? 'left' : 'right' };
        if (c > 2 && cell.value !== null && cell.value !== '') cell.numFmt = '#,##0';
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fileName = `AB_Gadgetz_${branchSlug}_${typesToExport.join('_')}_Daily_Stock_Balances_${reportDateStr}.xlsx`;
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setInventoryDownloadMsg(`Downloaded Excel: ${fileName}`, false);
  } catch (err) {
    setInventoryDownloadMsg(err.message || 'Unable to export Excel.', true);
  }
}

function downloadReceivablesPdf() {
  try {
    const jspdfNs = window.jspdf;
    if (!jspdfNs || typeof jspdfNs.jsPDF !== 'function' || !state.receivables) return;
    const data = state.receivables;
    const globalBranchId = document.getElementById('globalBranch').value;
    const branchObj = (state.inventory?.branches || []).find((b) => b.id === globalBranchId);
    const branchLabel = branchObj ? branchObj.name : 'All Branches';
    const q = document.getElementById('recSearchInput').value.trim().toLowerCase();

    const filteredDues = (data.pastDues || []).filter(
      (d) =>
        !q ||
        d.customer_name.toLowerCase().includes(q) ||
        d.account_no.toLowerCase().includes(q) ||
        (d.barangay || '').toLowerCase().includes(q) ||
        d.unit.toLowerCase().includes(q)
    );

    const doc = new jspdfNs.jsPDF({ orientation: 'portrait', unit: 'in', format: [8.5, 13], compress: true });
    const margin = 24 / 72;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(27, 25, 19);
    doc.text(`AB-Gadgetz-${branchLabel}: Receivables & Past-Due Accounts`, margin, 32 / 72);
    doc.setFontSize(9);
    doc.setTextColor(79, 73, 58);
    doc.text(`As of ${todayStr} • Past-Due Accounts: ${fmtNum(filteredDues.length)}`, margin, 48 / 72);

    doc.autoTable({
      startY: 60 / 72,
      margin: { left: margin, right: margin, bottom: margin },
      head: [['Release Date', 'Branch', 'Account No.', 'Customer', 'Contact / Barangay', 'Unit']],
      body: filteredDues.map((d) => [
        d.release_date || '',
        d.branch_name || '',
        d.account_no || '',
        d.customer_name || '',
        `${d.contact_no || '—'} ${d.barangay ? `(${d.barangay})` : ''}`.trim(),
        d.unit || '',
      ]),
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 3 / 72, textColor: [27, 25, 19] },
      headStyles: { fillColor: [27, 25, 19], textColor: [246, 211, 75], fontStyle: 'bold' },
    });

    const slug = branchLabel.replace(/[^a-z0-9]+/gi, '_');
    doc.save(`AB_Gadgetz_${slug}_Receivables_${todayStr}.pdf`);
  } catch (err) {
    alert(err.message || 'Unable to generate Receivables PDF.');
  }
}

function downloadReceivablesExcel() {
  if (!state.receivables) return;
  const data = state.receivables;
  const q = document.getElementById('recSearchInput').value.trim().toLowerCase();
  const filteredDues = (data.pastDues || []).filter(
    (d) =>
      !q ||
      d.customer_name.toLowerCase().includes(q) ||
      d.account_no.toLowerCase().includes(q) ||
      (d.barangay || '').toLowerCase().includes(q) ||
      d.unit.toLowerCase().includes(q)
  );
  const rows = [
    ['Release Date', 'Branch', 'Account No', 'Customer Name', 'Contact No', 'Barangay', 'Unit'],
    ...filteredDues.map((d) => [
      d.release_date || '',
      d.branch_name || '',
      d.account_no || '',
      d.customer_name || '',
      d.contact_no || '',
      d.barangay || '',
      d.unit || '',
    ]),
  ];
  const csvContent =
    '\uFEFF' +
    rows
      .map((r) =>
        r
          .map((c) => {
            const s = String(c ?? '');
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(',')
      )
      .join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AB_Gadgetz_Receivables_${todayStr}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.getElementById('inventoryPdfBtn')?.addEventListener('click', () => downloadInventoryPdf(false));
document.getElementById('inventoryBlankPdfBtn')?.addEventListener('click', () => downloadInventoryPdf(true));
document.getElementById('inventoryExcelBtn')?.addEventListener('click', downloadInventoryExcel);
document.getElementById('receivablesPdfBtn')?.addEventListener('click', downloadReceivablesPdf);
document.getElementById('receivablesExcelBtn')?.addEventListener('click', downloadReceivablesExcel);
document.getElementById('invPriceRange')?.addEventListener('change', renderInventory);
document.getElementById('invRamRom')?.addEventListener('change', renderInventory);
document.getElementById('invPriceSortBtn')?.addEventListener('click', () => {
  state.invPriceSort = state.invPriceSort === 'desc' ? 'asc' : 'desc';
  renderInventory();
});

function applyRolePermissions() {
  const role = state.userRole || 'ADMIN';
  const branchId = state.userBranchId || '';
  const isAdmin = role === 'ADMIN';

  document.body.classList.toggle('role-staff', !isAdmin);
  document.body.classList.toggle('role-cashier', role === 'CASHIER');
  document.getElementById('mobileBottomNav')?.classList.toggle('hidden', role === 'CASHIER');

  const branchNames = { 'br-molave': 'Molave', 'br-tambulig': 'Tambulig', 'br-bonifacio': 'Bonifacio' };
  const branchName = branchNames[branchId] || 'Branch';

  // Update header subtitle, page title & greeting
  const subEl = document.getElementById('portalHeaderSub');
  const greetEl = document.getElementById('portalGreeting');
  if (role === 'CASHIER') {
    document.title = `Cashier Portal (${branchName}) — AB Gadgetz`;
    if (subEl) subEl.textContent = `CASHIER PORTAL (${branchName.toUpperCase()}) • VIEW & PDF ONLY`;
    if (greetEl) greetEl.textContent = `Cashier • ${branchName}`;
  } else if (role === 'CI') {
    document.title = `Credit Investigator (${branchName}) — AB Gadgetz`;
    if (subEl) subEl.textContent = `CREDIT INVESTIGATOR (${branchName.toUpperCase()}) • VIEW & PDF ONLY`;
    if (greetEl) greetEl.textContent = `Credit Investigator • ${branchName}`;
  } else {
    document.title = 'Owner Admin Portal';
    if (subEl) subEl.textContent = 'OWNER ADMIN PORTAL • REALTIME SYNC';
    if (greetEl) greetEl.textContent = 'Welcome, Maynard';
  }

  // Toggle admin-only & cashier-only elements
  document.querySelectorAll('.admin-only-el, .publish-github-btn').forEach((el) => {
    el.classList.toggle('hidden', !isAdmin);
  });
  document.querySelectorAll('.cashier-only-el').forEach((el) => {
    el.classList.toggle('hidden', role !== 'CASHIER');
  });
  document.getElementById('toggleSyncBtn')?.classList.toggle('hidden', !isAdmin);
  const catEditWrap = document.getElementById('catEditMode')?.closest('label');
  if (catEditWrap) catEditWrap.classList.toggle('hidden', !isAdmin);
  if (!isAdmin && document.getElementById('catEditMode')) {
    document.getElementById('catEditMode').checked = false;
  }
  const showHiddenWrap = document.getElementById('showHiddenToggle')?.closest('label');
  if (showHiddenWrap) showHiddenWrap.classList.toggle('hidden', !isAdmin);

  // Cashier Inventory lockdown: hide Inventory Tools, bulk Cellphones/Accessories switcher, and limit Stock View to Available / Unavailable
  document.querySelector('.inv-tools-wrap')?.classList.toggle('hidden', !isAdmin);
  document.getElementById('cashierCatalogFilters')?.classList.toggle('hidden', role !== 'CASHIER');
  if (!isAdmin) {
    state.selectedProducts.clear();
    document.getElementById('invToolDrawer')?.classList.add('hidden');
    document.getElementById('bulkActionBar')?.classList.add('hidden');
  }
  const stockViewSel = document.getElementById('stockViewSelect');
  if (stockViewSel) {
    const curVal = stockViewSel.value;
    if (!isAdmin) {
      stockViewSel.innerHTML = `
        <option value="available">Available phones</option>
        <option value="unavailable">Unavailable</option>
      `;
      stockViewSel.value = curVal === 'unavailable' ? 'unavailable' : 'available';
    } else if (stockViewSel.options.length < 5) {
      stockViewSel.innerHTML = `
        <option value="available">Available phones</option>
        <option value="phaseout">Phaseout products (include 0)</option>
        <option value="all">All products, incl. unavailable</option>
        <option value="unavailable">Unavailable</option>
        <option value="reorder">Reorder suggestions</option>
      `;
      if (curVal) stockViewSel.value = curVal;
    }
  }

  // For Cashier, place the Date Selector & PDF icon right beside the "INVENTORY" header
  const datePdfWrap = document.querySelector('.inv-date-pdf-wrap');
  const cashierHeaderActions = document.getElementById('cashierHeaderActions');
  const invFilterBar = document.getElementById('invFilterBar');
  if (datePdfWrap && cashierHeaderActions && invFilterBar) {
    if (role === 'CASHIER') {
      cashierHeaderActions.classList.remove('hidden');
      cashierHeaderActions.appendChild(datePdfWrap);
    } else {
      cashierHeaderActions.classList.add('hidden');
      invFilterBar.appendChild(datePdfWrap);
    }
  }

  // Restrict available tabs by role (Cashier uses integrated Inventory + Catalog view, so no separate Catalogs tab)
  const allowedTabs =
    role === 'CASHIER'
      ? ['inventory']
      : role === 'CI'
        ? ['receivables', 'catalogs']
        : ['inventory', 'activity', 'finance', 'receivables', 'catalogs', 'websiteStock', 'staffPins'];

  document.querySelectorAll('.tab[data-tab], .mnav-btn[data-tab]').forEach((btn) => {
    const t = btn.dataset.tab;
    btn.classList.toggle('hidden', !allowedTabs.includes(t));
  });

  // Lock branch selector & catalog branch tabs for staff roles
  const globalBranchSel = document.getElementById('globalBranch');
  if (globalBranchSel) {
    if (!isAdmin && branchId) {
      globalBranchSel.value = branchId;
      globalBranchSel.disabled = true;
    } else {
      globalBranchSel.disabled = false;
    }
  }

  if (!isAdmin && branchId) {
    state.catalogBranchId = branchId;
    document.querySelectorAll('.cat-branch-btn').forEach((btn) => {
      const match = btn.dataset.branch === branchId;
      btn.classList.toggle('hidden', !match);
      btn.classList.toggle('active', match);
    });
  } else {
    document.querySelectorAll('.cat-branch-btn').forEach((btn) => {
      btn.classList.remove('hidden');
      btn.classList.toggle('active', btn.dataset.branch === state.catalogBranchId);
    });
  }

  if (!allowedTabs.includes(state.activeTab)) {
    switchTab(allowedTabs[0]);
  }
}

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
  applyRolePermissions();
  await Promise.all([loadInventory(), loadSyncLogs()]);
  applyRolePermissions();
  await refreshActiveTab();
  connectEvents();
}

async function loadStaffPins() {
  const msg = document.getElementById('staffPinsMsg');
  const tokenWrap = document.getElementById('ghTokenWrap');
  const tokenInput = document.getElementById('ghPublishTokenInput');
  const saveBtn = document.getElementById('saveStaffPinsBtn');
  const keys = [
    'CASHIER::br-molave',
    'CASHIER::br-tambulig',
    'CASHIER::br-bonifacio',
    'CI::br-molave',
    'CI::br-tambulig',
    'CI::br-bonifacio',
  ];

  const fillInputs = (pins) => {
    for (const key of keys) {
      const el = document.getElementById(`pin_${key.replace('::', '_')}`);
      if (el) el.value = pins[key] || DEFAULT_GH_STAFF_PINS[key] || '';
    }
  };

  if (IS_STATIC_GH) {
    if (tokenWrap) tokenWrap.classList.remove('hidden');
    if (tokenInput) tokenInput.value = localStorage.getItem('bs_gh_pub_token') || '';
    if (saveBtn) saveBtn.textContent = 'SAVE & PUBLISH STAFF PINS';
    try {
      const payload = await getGhStaffPinsPayload();
      const decrypted = await decryptGhStaffPins(payload?.encryptedPins);
      if (decrypted) {
        fillInputs(decrypted);
        if (msg) msg.textContent = 'Synced current Staff PINs. To update from phone without PC, enter your GitHub Token above once and click SAVE & PUBLISH STAFF PINS.';
        return;
      }
    } catch {}
    fillInputs(DEFAULT_GH_STAFF_PINS);
    if (msg) msg.textContent = 'Showing default Staff PINs. Publish from localhost or enter your GitHub Token above to save changes without a PC.';
    return;
  }

  if (tokenWrap) tokenWrap.classList.add('hidden');
  if (saveBtn) saveBtn.textContent = 'SAVE STAFF PINS';
  try {
    const res = await api('/api/staff-pins');
    fillInputs(res.pins || {});
    if (msg) msg.textContent = '';
  } catch (err) {
    if (msg) msg.textContent = err.message;
  }
}

async function publishStaffPinsViaGhApi(token, jsonText) {
  const repo = 'ab-gadgetz/ab-gadgetz.github.io';
  const paths = ['public/staff-pins.json', 'dist/data/staff-pins.json'];
  const contentB64 = btoa(unescape(encodeURIComponent(jsonText)));
  for (const filePath of paths) {
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    let sha;
    const getRes = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (getRes.ok) {
      const info = await getRes.json();
      sha = info.sha;
    }
    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Update Staff PINs from Online Admin Portal',
        content: contentB64,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!putRes.ok) {
      const errData = await putRes.json().catch(() => ({}));
      throw new Error(errData.message || `GitHub API error (${putRes.status})`);
    }
  }
}

document.getElementById('saveStaffPinsBtn')?.addEventListener('click', async () => {
  const msg = document.getElementById('staffPinsMsg');
  const keys = [
    'CASHIER::br-molave',
    'CASHIER::br-tambulig',
    'CASHIER::br-bonifacio',
    'CI::br-molave',
    'CI::br-tambulig',
    'CI::br-bonifacio',
  ];
  const pins = {};
  for (const key of keys) {
    const inputId = `pin_${key.replace('::', '_')}`;
    const val = document.getElementById(inputId)?.value.trim() || '';
    if (!/^\d{6}$/.test(val)) {
      if (msg) msg.textContent = `PIN for ${key.replace('::', ' ')} must be exactly 6 digits.`;
      return;
    }
    pins[key] = val;
  }

  if (IS_STATIC_GH) {
    const token = (document.getElementById('ghPublishTokenInput')?.value || '').trim();
    if (!token) {
      if (msg) msg.textContent = 'Paste your GitHub Token in the box above once so you can publish PIN changes from your phone without a PC.';
      return;
    }
    localStorage.setItem('bs_gh_pub_token', token);
    if (msg) msg.textContent = 'Publishing new Staff PINs to GitHub...';
    try {
      const hashes = {};
      for (const [k, v] of Object.entries(pins)) {
        const bytes = new TextEncoder().encode(`abg-staff-pin-salt-v1:${v}`);
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        hashes[k] = btoa(String.fromCharCode(...new Uint8Array(digest)));
      }
      const encryptedPins = await encryptGhStaffPins(pins);
      const payloadText = JSON.stringify({ updatedAt: new Date().toISOString(), hashes, encryptedPins }, null, 2);
      await publishStaffPinsViaGhApi(token, payloadText);
      if (msg) msg.textContent = '✓ Staff PINs published! Your Staff Portal (/staff/) now uses the new PINs immediately—no PC needed.';
    } catch (err) {
      if (msg) msg.textContent = `Publish failed: ${err.message}`;
    }
    return;
  }

  try {
    await api('/api/staff-pins', { method: 'PUT', body: JSON.stringify({ pins }) });
    if (msg) msg.textContent = 'Staff PINs saved locally! Click "🚀 Publish PINs to Online Staff Portal" to sync to https://ab-gadgetz.github.io/staff/.';
  } catch (err) {
    if (msg) msg.textContent = err.message;
  }
});

function updateAuthRoleUI() {
  const roleSel = document.getElementById('loginRoleSelect');
  const branchSel = document.getElementById('loginBranchSelect');
  const branchWrap = document.getElementById('loginBranchWrap');
  const isSetup = document.getElementById('authGate')?.dataset.mode === 'setup';
  if (!roleSel || !branchWrap) return;
  if (isSetup) {
    roleSel.value = 'ADMIN';
  }
  const role = roleSel.value || 'ADMIN';
  const branchId = branchSel?.value || 'br-molave';

  document.querySelectorAll('#loginRoleBoxes .login-choice-box').forEach((box) => {
    box.classList.toggle('active', box.dataset.role === role);
  });
  document.querySelectorAll('#loginBranchBoxes .login-choice-box').forEach((box) => {
    box.classList.toggle('active', box.dataset.branch === branchId);
  });

  branchWrap.classList.toggle('hidden', isSetup || role === 'ADMIN');
}

document.querySelectorAll('#loginRoleBoxes .login-choice-box').forEach((box) => {
  box.addEventListener('click', () => {
    const roleSel = document.getElementById('loginRoleSelect');
    if (roleSel) roleSel.value = box.dataset.role;
    updateAuthRoleUI();
  });
});

document.querySelectorAll('#loginBranchBoxes .login-choice-box').forEach((box) => {
  box.addEventListener('click', () => {
    const branchSel = document.getElementById('loginBranchSelect');
    if (branchSel) branchSel.value = box.dataset.branch;
    updateAuthRoleUI();
  });
});

async function checkAuth() {
  const isStaffPath = window.location.pathname.includes('/staff');
  const status = await api('/api/auth/status');
  if (status.authenticated && (!isStaffPath || status.role !== 'ADMIN')) {
    state.userRole = status.role || 'ADMIN';
    state.userBranchId = status.branchId || '';
    await bootApp();
    return;
  }
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('authGate').classList.remove('hidden');
  const subEl = document.getElementById('portalHeaderSub');
  if (isStaffPath) {
    document.title = 'Staff Portal — AB Gadgetz';
    if (subEl) subEl.textContent = 'STAFF PORTAL • VIEW & PDF ONLY';
  } else {
    document.title = 'Owner Admin Portal';
    if (subEl) subEl.textContent = 'OWNER ADMIN PORTAL • REALTIME SYNC';
  }
  const isSetup = !status.pinConfigured && !isStaffPath;
  document.getElementById('authTitle').textContent = isSetup
    ? 'Create Owner PIN (First-Time Setup)'
    : isStaffPath
      ? 'Staff Portal Login'
      : 'Owner Login';
  document.getElementById('authSubtitle').textContent = isSetup
    ? 'Set a 6-digit PIN to protect your portal for online/phone access.'
    : isStaffPath
      ? 'Tap your Role and Branch below, then enter your 6-digit PIN (View & PDF Download Only).'
      : 'Enter your 6-digit Owner PIN to unlock the portal.';
  document.getElementById('authSubmitBtn').textContent = isSetup ? 'SAVE PIN & UNLOCK' : 'UNLOCK PORTAL';
  document.getElementById('authGate').dataset.mode = isSetup ? 'setup' : 'login';

  const roleWrap = document.getElementById('loginRoleWrap');
  const roleSel = document.getElementById('loginRoleSelect');
  if (roleSel) {
    if (isStaffPath) {
      if (roleWrap) roleWrap.classList.remove('hidden');
      if (roleSel.value === 'ADMIN') roleSel.value = 'CASHIER';
    } else {
      if (roleWrap) roleWrap.classList.add('hidden');
      roleSel.value = 'ADMIN';
    }
  }
  updateAuthRoleUI();
}

document.getElementById('authSubmitBtn').addEventListener('click', async () => {
  const pin = document.getElementById('ownerPinInput').value.trim();
  const role = document.getElementById('loginRoleSelect')?.value || 'ADMIN';
  const branchId = document.getElementById('loginBranchSelect')?.value || 'br-molave';
  const mode = document.getElementById('authGate').dataset.mode || 'login';
  const errEl = document.getElementById('authErrorMsg');
  errEl.textContent = '';
  try {
    const res = await api(mode === 'setup' ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ pin, role, branchId }),
    });
    state.userRole = res.role || role || 'ADMIN';
    state.userBranchId = res.branchId || (state.userRole === 'ADMIN' ? '' : branchId);
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
