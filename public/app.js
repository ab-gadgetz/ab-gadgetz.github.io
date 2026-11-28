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
  activeTab: 'cashflow',
  activity: null,
  actBranchFilter: '',
  actProductType: 'ALL',
  actSaleMode: 'ALL',
  catalogBranchId: 'ALL',
  catalogData: null,
  expandedCatalogBrands: new Set(),
  abSupplierCatalog: null,
  activeCcView: 'compare',
  userRole: 'ADMIN',
  userBranchId: '',
};

const fmtCurrency = (n) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

const fmtNum = (n) => (Number(n) || 0).toLocaleString('en-PH');

const isFreebieAccessory = (item) => {
  const pType = item?.product_type || item?.productType || 'Cellphones';
  if (pType !== 'Accessories') return false;
  const p = Number(item?.base_price ?? item?.basePrice ?? 0);
  return p <= 5;
};

const fmtTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
};

const manilaTodayClient = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

function addMonthsIsoClient(isoDate, months = 3) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  const tf = new Date(Date.UTC(y, mo + months, 1));
  const ld = new Date(Date.UTC(tf.getUTCFullYear(), tf.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(tf.getUTCFullYear(), tf.getUTCMonth(), Math.min(d, ld))).toISOString().slice(0, 10);
}

function hasThreeMonthsPassedClient(sinceDate, todayDate = manilaTodayClient()) {
  if (!sinceDate || !todayDate) return false;
  const deadline = addMonthsIsoClient(sinceDate, 3);
  return Boolean(deadline) && String(todayDate).slice(0, 10) >= deadline;
}

function daysBetweenIsoClient(startIso, endIso) {
  const s = Date.parse(`${String(startIso || '').slice(0, 10)}T00:00:00Z`);
  const e = Date.parse(`${String(endIso || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  return Math.max(0, Math.round((e - s) / 86400000));
}

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
  document.querySelector('.inv-tools-wrap')?.classList.toggle('hidden', !isInv || state.userRole !== 'ADMIN');
  document.getElementById('cashFlowHeaderActions')?.classList.toggle('hidden', tab !== 'cashflow' || state.userRole !== 'ADMIN');
  document.getElementById('salesHeaderActions')?.classList.toggle('hidden', tab !== 'sales' || state.userRole !== 'ADMIN');

  document.querySelectorAll('.mnav-btn[data-tab]').forEach((mb) => {
    mb.classList.toggle('active', mb.dataset.tab === tab);
  });

  setMenuOpen(false);
  requestAnimationFrame(() => setTimeout(refreshActiveTab, 0));
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
  } else if (tab === 'sales') {
    await loadSalesSummary();
  } else if (tab === 'cashflow') {
    await loadCashFlow();
  } else if (tab === 'receivables') {
    await loadReceivables();
  } else if (tab === 'quotas') {
    await loadQuotas();
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
    if (state.activeInvTool === 'costcompare') {
      renderCostCompareTool();
      loadSupplierCatalog().then(() => {
        if (state.activeInvTool === 'costcompare') renderCostCompareTool();
      });
    }
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
let ghBundlePromise = null;

async function getGhBundle(force = false) {
  if (!force && ghBundleCache && Date.now() - ghBundleFetchedAt < 300000) return ghBundleCache;
  if (!force && ghBundlePromise) return ghBundlePromise;
  ghBundlePromise = fetch(`../data/admin-bundle.json?v=${force ? Date.now() : Math.floor(Date.now() / 300000)}`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`Failed to load cloud bundle (HTTP ${res.status})`);
      ghBundleCache = await res.json();
      ghBundleFetchedAt = Date.now();
      return ghBundleCache;
    })
    .finally(() => {
      ghBundlePromise = null;
    });
  return ghBundlePromise;
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
    const startParam = u.searchParams.get('start') || '';
    const endParam = u.searchParams.get('end') || startParam || '';
    const todayManila = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const sDate = /^\d{4}-\d{2}-\d{2}$/.test(startParam) ? startParam : todayManila;
    const eDate = /^\d{4}-\d{2}-\d{2}$/.test(endParam) ? endParam : sDate;
    const dates = [];
    const cur = new Date(`${sDate}T00:00:00Z`);
    const endD = new Date(`${eDate}T00:00:00Z`);
    while (cur <= endD && dates.length < 31) {
      dates.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    if (!dates.length) dates.push(todayManila);

    const slugs = [['br-molave', 'molave'], ['br-tambulig', 'tambulig'], ['br-bonifacio', 'bonifacio']];
    let bundleViews = null;
    try {
      const b = await getGhBundle();
      bundleViews = b?.catalogViews || null;
    } catch {}
    const byBranch = {};
    let total = 0;
    let allTimeTotal = 0;
    await Promise.all(
      slugs.map(async ([bid, slug]) => {
        const base = bundleViews?.byBranch?.[bid] || { total: 0 };
        let rangeSum = 0;
        let liveAll = 0;
        await Promise.all([
          ...dates.map(async (dt) => {
            try {
              const r = await fetch(`https://abacus.jasoncameron.dev/get/ab-gadgetz-views/${slug}-${dt}?v=${Date.now()}`);
              if (r.ok) {
                const j = await r.json();
                rangeSum += Number(j.value) || 0;
              }
            } catch {}
          }),
          (async () => {
            try {
              const r = await fetch(`https://abacus.jasoncameron.dev/get/ab-gadgetz-views/${slug}?v=${Date.now()}`);
              if (r.ok) {
                const j = await r.json();
                liveAll = Number(j.value) > 0 ? Number(j.value) : 0;
              }
            } catch {}
          })(),
        ]);
        const allTime = Math.max(Number(base.total) || 0, liveAll);
        byBranch[bid] = { total: rangeSum, allTime };
        total += rangeSum;
        allTimeTotal += allTime;
      })
    );
    return { byBranch, total, allTimeTotal, start: sDate, end: eDate };
  }
  if (pathname === '/api/sync/now') {
    await getGhBundle(true);
    window.open('https://github.com/ab-gadgetz/ab-gadgetz.github.io/actions/workflows/deploy-catalog.yml', '_blank');
    return { ok: true };
  }
  if (pathname === '/api/catalog/publish-github' && method === 'POST') {
    if (localStorage.getItem('bs_gh_pub_token')) {
      const ok = await pushPhoneOrdersToGh();
      if (ok) {
        return {
          ok: true,
          message: 'Phone saved plans synced to GitHub for PC import ✓ (Full catalog publish runs from PC localhost:3456).',
        };
      }
    }
  }
  if (pathname === '/api/products/photos' && method === 'PATCH') {
    const body = JSON.parse(opts.body || '{}');
    const productId = body.productId;
    const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.map((u) => String(u || '').trim()).filter(Boolean) : [];
    const prod = state.inventory?.items?.find((i) => i.id === productId);
    if (prod) {
      prod.imageUrls = imageUrls;
      prod.imageUrl = imageUrls[0] || '';
    }
    const cachedProd = ghBundleCache?.inventory?.items?.find((i) => i.id === productId);
    if (cachedProd) {
      cachedProd.imageUrls = imageUrls;
      cachedProd.imageUrl = imageUrls[0] || '';
    }
    saveLocalPhotoOverride(productId, imageUrls);
    const token = localStorage.getItem('bs_gh_pub_token');
    if (!token) {
      document.getElementById('photoGhTokenWrap')?.classList.remove('hidden');
      throw new Error('Saved locally. Enter your GitHub Token above once to save photo edits online.');
    }
    await pushProductPhotosToGh(productId, imageUrls, token);
    return { ok: true, syncedToGh: true };
  }
  if (pathname === '/api/quotas' && method === 'PUT') {
    const body = JSON.parse(opts.body || '{}');
    const month = String(body.month || '').slice(0, 7);
    const branchId = String(body.branchId || '');
    const cur = getLocalBranchQuotas();
    if (!cur.months[month]) cur.months[month] = {};
    cur.months[month][branchId] = {
      minRelease: Number(body.minRelease) || 0,
      maxRelease: Number(body.maxRelease) || 0,
      bomBal4to6: Number(body.bomBal4to6) || 0,
      bomBal7to12: Number(body.bomBal7to12) || 0,
      bomQuota: Number(body.bomQuota) || 0,
      lockedAt: body.lockedAt || new Date().toISOString(),
      note: String(body.note || '').slice(0, 200),
    };
    cur.updatedAt = new Date().toISOString();
    saveLocalBranchQuotas(cur);
    const token = localStorage.getItem('bs_gh_pub_token');
    if (token) {
      await pushBranchQuotasToGh(cur, token);
      return { ok: true, quotas: cur, syncedToGh: true };
    }
    return { ok: true, quotas: cur, syncedToGh: false };
  }
  if (method !== 'GET') {
    throw new Error('Make edits in your Local Admin Portal (http://localhost:3456), then click ☁️ Update Online Website.');
  }

  const bundle = await getGhBundle();
  if (pathname === '/api/quotas') {
    const base = bundle.branchQuotas || { updatedAt: null, months: {} };
    const local = getLocalBranchQuotas();
    const mergedMonths = { ...(base.months || {}) };
    for (const [mo, brMap] of Object.entries(local.months || {})) {
      mergedMonths[mo] = { ...(mergedMonths[mo] || {}), ...brMap };
    }
    return {
      quotas: { updatedAt: local.updatedAt || base.updatedAt, months: mergedMonths },
      webSummaries: bundle.branchWebSummaries || {},
      installments: bundle.allInstallments || [],
      payments: bundle.allPayments || [],
    };
  }
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
    return {
      demandByProductBranch: bundle.planning?.demandByProductBranch || undefined,
      demandByProduct: bundle.planning?.demandByProduct || undefined,
      reorderSuggestions: reorderSuggestions.slice(0, 60),
      transferSuggestions: [],
    };
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
  if (pathname === '/api/sales/summary') {
    const start = u.searchParams.get('start') || '';
    const end = u.searchParams.get('end') || '9999-99-99';
    const transactions = (bundle.portal_transactions || []).filter((t) => {
      const d = String(t.tx_date || '').slice(0, 10);
      return (!start || d >= start) && (!end || d <= end);
    });
    const onlinePayments = (bundle.portal_online_payments || []).filter((o) => {
      const d = String(o.pay_date || '').slice(0, 10);
      return (!start || d >= start) && (!end || d <= end);
    });
    return { start, end, transactions, onlinePayments };
  }
  if (pathname === '/api/finance/summary') {
    const start = u.searchParams.get('start') || '';
    const end = u.searchParams.get('end') || '9999-99-99';
    const branchId = u.searchParams.get('branchId') || '';
    const payRows = (bundle.allPayments || []).filter((p) => (!start || p.payment_date >= start) && (!end || p.payment_date <= end) && (!branchId || p.branch_id === branchId));
    const expRows = (bundle.allExpenses || []).filter((e) => (!start || e.expense_date >= start) && (!end || e.expense_date <= end) && (!branchId || e.branch_id === branchId));
    const txRows = (bundle.portal_transactions || []).filter((t) => (!start || t.tx_date >= start) && (!end || t.tx_date <= end) && (!branchId || t.branch_id === branchId));
    const instRows = (bundle.allInstallments || []).filter((i) => (!start || i.sale_date >= start) && (!end || i.sale_date <= end) && (!branchId || i.branch_id === branchId));

    const totals = {
      collections: 0, principal: 0, interest: 0, penalties: 0, rebates: 0,
      financingIncome: 0, expenses: 0, netCashFlow: 0,
      cashGrossSrp: 0, cashDiscount: 0, cashNetSales: 0, cashCogs: 0, cashGrossProfit: 0,
      downpayments: 0, installmentSales: 0, installmentPrincipal: 0, abWebCashInflow: 0, properNetIncome: 0,
    };
    const branchStats = new Map(
      bundle.inventory.branches.map((b) => [
        b.id,
        {
          branchId: b.id, branchName: b.name, collections: 0, principal: 0, financingIncome: 0, expenses: 0, netCashFlow: 0,
          cashGrossSrp: 0, cashDiscount: 0, cashNetSales: 0, cashCogs: 0, cashGrossProfit: 0,
          downpayments: 0, installmentSales: 0, installmentPrincipal: 0, abWebCashInflow: 0, properNetIncome: 0,
        },
      ])
    );
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
    for (const tx of txRows) {
      const net = Number(tx.amount) || 0;
      const disc = Number(tx.discount) || 0;
      const srp = Number(tx.srp) || net + disc;
      const cogs = Number(tx.unit_cost) || 0;
      const gp = cogs > 0 ? net - cogs : 0;
      totals.cashGrossSrp += srp; totals.cashDiscount += disc; totals.cashNetSales += net; totals.cashCogs += cogs; totals.cashGrossProfit += gp;
      const bs = branchStats.get(tx.branch_id);
      if (bs) { bs.cashGrossSrp += srp; bs.cashDiscount += disc; bs.cashNetSales += net; bs.cashCogs += cogs; bs.cashGrossProfit += gp; }
    }
    for (const inst of instRows) {
      const amt = Number(inst.amount) || 0;
      const dp = Number(inst.deposit) || 0;
      const prin = Number(inst.principal_amount) || 0;
      totals.downpayments += dp; totals.installmentSales += amt; totals.installmentPrincipal += prin;
      const bs = branchStats.get(inst.branch_id);
      if (bs) { bs.downpayments += dp; bs.installmentSales += amt; bs.installmentPrincipal += prin; }
    }
    totals.abWebCashInflow = totals.downpayments + totals.cashNetSales + totals.collections;
    totals.properNetIncome = totals.cashGrossProfit + totals.financingIncome - totals.expenses;
    totals.netCashFlow = totals.abWebCashInflow - totals.expenses;
    for (const bs of branchStats.values()) {
      bs.abWebCashInflow = bs.downpayments + bs.cashNetSales + bs.collections;
      bs.properNetIncome = bs.cashGrossProfit + bs.financingIncome - bs.expenses;
      bs.netCashFlow = bs.abWebCashInflow - bs.expenses;
    }
    return {
      totals,
      byBranch: Array.from(branchStats.values()),
      expensesByType: Array.from(expByTypeMap.entries()).map(([expenseType, amount]) => ({ expenseType, amount })).sort((a, b) => b.amount - a.amount),
      recentPayments: payRows,
      recentExpenses: expRows,
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
      pastDues: dueRows,
      installments: instRows,
    };
  }
  if (pathname === '/api/supplier-catalog') {
    const baseEntries = Array.isArray(bundle.abSupplierCatalog?.entries) ? bundle.abSupplierCatalog.entries : [];
    const localSaved = (() => {
      try {
        return JSON.parse(localStorage.getItem('ab_supplier_catalog_v1') || 'null');
      } catch {
        return null;
      }
    })();
    const mergedMap = new Map();
    for (const e of baseEntries) mergedMap.set(String(e.modelName || '').toUpperCase(), { ...e });
    for (const e of (localSaved?.entries || [])) mergedMap.set(String(e.modelName || '').toUpperCase(), { ...e });
    const invItems = state.inventory?.items || bundle.inventory?.items || [];
    const prodMap = new Map(invItems.map((it) => [it.id, it]));
    const localCosts = getLocalSupplierCostsMap();
    const entries = Array.from(mergedMap.values()).map((e) => {
      const p = e.matchedProductId ? prodMap.get(e.matchedProductId) : null;
      const ov = e.matchedProductId ? localCosts[e.matchedProductId] : null;
      const totalAvail = p
        ? (bundle.inventory?.branches || []).reduce((s, b) => s + (Number(p.byBranch?.[b.id]?.qtyAvailable) || 0), 0)
        : 0;
      return {
        ...e,
        productName: p?.name || e.productName || '',
        productSku: p?.sku || e.productSku || '',
        basePrice: p ? Number(p.base_price) || 0 : Number(e.basePrice) || 0,
        costPrice: p ? Number(p.cost_price) || 0 : Number(e.costPrice) || 0,
        costAb: ov?.cost_ab ?? p?.cost_ab ?? e.costAb ?? null,
        costAk: ov?.cost_ak ?? p?.cost_ak ?? e.costAk ?? null,
        costOnline: ov?.cost_online ?? p?.cost_online ?? e.costOnline ?? null,
        lifecycleStatus: p?.lifecycle_status || e.lifecycleStatus || '',
        totalAvail,
      };
    });
    const stockDate = entries.reduce((mx, e) => (e.stockDate && e.stockDate > mx ? e.stockDate : mx), localSaved?.stockDate || bundle.abSupplierCatalog?.stockDate || '');
    return { stockDate, entries };
  }
  if (pathname === '/api/supplier-catalog/import' && opts.method === 'POST') {
    const body = JSON.parse(opts.body || '{}');
    const parsed = parseAbSupplierStockTextClient(body.rawText || '');
    const allProds = state.inventory?.items || bundle.inventory?.items || [];
    if (body.dryRun) {
      const entries = parsed.map((e) => {
        const m = matchSupplierEntryToProductsClient(e, allProds);
        return {
          ...e,
          matched: m.map((p) => ({
            productId: p.id,
            name: p.name,
            basePrice: Number(p.base_price) || 0,
            prevAb: p.cost_ab !== null && p.cost_ab !== undefined ? Number(p.cost_ab) : null,
            nextAb: e.dpCost,
            lifecycleStatus: p.lifecycle_status,
          })),
        };
      });
      return { ok: true, dryRun: true, entries };
    }
    if (!parsed.length) throw new Error('No DP prices found in pasted text');
    const prevCatalog = await staticGhApi('/api/supplier-catalog');
    const mergedMap = new Map((prevCatalog.entries || []).map((e) => [String(e.modelName || '').toUpperCase(), { ...e }]));
    const batchBrands = new Set(parsed.map((e) => String(e.brand || '').toUpperCase()).filter(Boolean));
    for (const [k, existing] of mergedMap.entries()) {
      if (batchBrands.has(String(existing.brand || '').toUpperCase())) {
        mergedMap.set(k, { ...existing, isAvailable: false });
      }
    }
    const updatedIds = new Set();
    const matchedIds = new Set();
    const diffs = [];
    const lcOverrides = (() => { try { return JSON.parse(localStorage.getItem('ab_lifecycle_overrides_v1') || '{}'); } catch { return {}; } })();
    const todayIso = manilaTodayClient();
    for (const entry of parsed) {
      const m = matchSupplierEntryToProductsClient(entry, allProds);
      const effectiveDate = body.stockDate || entry.stockDate || '2026-11-23';
      mergedMap.set(entry.modelName.toUpperCase(), {
        brand: entry.brand,
        category: entry.category,
        modelName: entry.modelName,
        dpCost: entry.dpCost,
        colorsNotes: entry.colorsNotes || '',
        matchedProductId: m[0]?.id || '',
        stockDate: effectiveDate,
        isAvailable: true,
      });
      for (const p of m) {
        matchedIds.add(p.id);
        const prevAb = p.cost_ab !== null && p.cost_ab !== undefined ? Number(p.cost_ab) : null;
        await saveProductSupplierCosts(p.id, { costAb: entry.dpCost });
        p.last_supplier_seen_at = effectiveDate;
        p.supplier_missing_since = '';
        if (p.lifecycle_status === 'Subject to Phaseout') {
          p.lifecycle_status = 'Active';
          lcOverrides[p.id] = { lifecycle_status: 'Active', supplier_missing_since: '' };
        }
        updatedIds.add(p.id);
        diffs.push({ productId: p.id, productName: p.name, prevAb, nextAb: entry.dpCost, changed: prevAb !== entry.dpCost });
      }
    }
    let subjectToPhaseoutCount = 0;
    let autoPhasedOutCount = 0;
    const batchLatestDate = parsed.reduce((mx, e) => (e.stockDate && e.stockDate > mx ? e.stockDate : mx), body.stockDate || todayIso);
    for (const p of allProds) {
      if (matchedIds.has(p.id)) continue;
      const u = `${p.brand || ''} ${p.model || ''} ${p.name || ''}`.toUpperCase();
      if (/\bREPO\b|\bREPAIRED\b|\bLDU\b|FREEBIE|FREE BUNDLE|\bFREE\b|\bDEMO\b/.test(u)) continue;
      const inBatch = [...batchBrands].some((bu) => (bu === 'ANKER' ? u.includes('ANKER') || u.includes('SOUNDCORE') : bu === 'INFINIX' ? u.includes('INFINIX') || u.includes('XPAD') || u.includes('XBOOK') || u.includes('GTBOOK') : u.includes(bu)));
      if (!inBatch || !['Active', 'Subject to Phaseout'].includes(p.lifecycle_status || 'Active')) continue;
      const ms = String(p.supplier_missing_since || '').trim() || batchLatestDate || todayIso;
      const nextLc = hasThreeMonthsPassedClient(ms, todayIso) ? 'Phaseout / Do Not Reorder' : 'Subject to Phaseout';
      p.supplier_missing_since = ms;
      p.lifecycle_status = nextLc;
      lcOverrides[p.id] = { lifecycle_status: nextLc, supplier_missing_since: ms };
      if (nextLc === 'Phaseout / Do Not Reorder') autoPhasedOutCount++;
      else subjectToPhaseoutCount++;
    }
    localStorage.setItem('ab_lifecycle_overrides_v1', JSON.stringify(lcOverrides));
    const nextList = Array.from(mergedMap.values());
    const nextStockDate = nextList.reduce((mx, e) => (e.stockDate && e.stockDate > mx ? e.stockDate : mx), '');
    localStorage.setItem('ab_supplier_catalog_v1', JSON.stringify({ stockDate: nextStockDate, entries: nextList }));
    const waitingCount = nextList.filter((e) => e.isAvailable !== false && !e.matchedProductId).length;
    return { ok: true, importedCount: parsed.length, updatedProductsCount: updatedIds.size, waitingCount, subjectToPhaseoutCount, autoPhasedOutCount, diffs };
  }
  if (pathname === '/api/products/lifecycle' && opts.method === 'PATCH') {
    const body = JSON.parse(opts.body || '{}');
    const lcOverrides = (() => { try { return JSON.parse(localStorage.getItem('ab_lifecycle_overrides_v1') || '{}'); } catch { return {}; } })();
    const todayIso = manilaTodayClient();
    for (const pid of (body.productIds || [])) {
      const prev = lcOverrides[pid] || {};
      const ms = body.status === 'Active' ? '' : (body.status === 'Subject to Phaseout' ? (prev.supplier_missing_since || todayIso) : (prev.supplier_missing_since || ''));
      lcOverrides[pid] = { lifecycle_status: body.status, supplier_missing_since: ms };
    }
    localStorage.setItem('ab_lifecycle_overrides_v1', JSON.stringify(lcOverrides));
    return { ok: true, count: (body.productIds || []).length };
  }
  return {};
}

async function api(url, opts = {}) {
  if (IS_STATIC_GH) return staticGhApi(url, opts);
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json();
  if (res.status === 401 && !String(url || '').startsWith('/api/auth/')) {
    if (typeof eventSource !== 'undefined' && eventSource) {
      eventSource.close();
      eventSource = null;
    }
    state.reauthInPlace = Boolean(state.inventory);
    await checkAuth('Session expired after update — enter your 6-digit PIN once to resume and keep your session saved.');
    const authErr = new Error(data.error || 'Authentication required — enter your PIN in the unlock box and retry.');
    authErr.isAuthHandled = true;
    throw authErr;
  }
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

async function loadInventory(forceRefresh = false) {
  const fresh = !forceRefresh && state.inventory && Date.now() - (state._invLoadedAt || 0) < 300000;
  if (!fresh) {
    state.inventory = await api('/api/inventory');
    state._invLoadedAt = Date.now();
    if (IS_STATIC_GH && state.inventory?.items) {
      const localCosts = getLocalSupplierCostsMap();
      const lcOverrides = (() => { try { return JSON.parse(localStorage.getItem('ab_lifecycle_overrides_v1') || '{}'); } catch { return {}; } })();
      const photoOverrides = getLocalPhotoOverrides();
      const todayIso = manilaTodayClient();
      for (const item of state.inventory.items) {
        const pov = photoOverrides[item.id];
        if (Array.isArray(pov)) {
          item.imageUrls = pov;
          item.imageUrl = pov[0] || '';
        }
        const ov = localCosts[item.id];
        if (ov) {
          item.cost_ab = ov.cost_ab;
          item.cost_ak = ov.cost_ak;
          item.cost_online = ov.cost_online;
        }
        const lov = lcOverrides[item.id];
        if (lov) {
          item.lifecycle_status = lov.lifecycle_status || item.lifecycle_status;
          item.supplier_missing_since = lov.supplier_missing_since ?? item.supplier_missing_since;
        }
        if (item.lifecycle_status === 'Subject to Phaseout' && item.supplier_missing_since && hasThreeMonthsPassedClient(item.supplier_missing_since, todayIso)) {
          item.lifecycle_status = 'Phaseout / Do Not Reorder';
        }
      }
    }
    populateSelects();
    loadSupplierCatalog().catch(() => {});
  }
  if (state.activeTab === 'inventory') {
    renderInventory();
    renderHealth();
  }
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

function getLocalPhotoOverrides() {
  try {
    return JSON.parse(localStorage.getItem('ab_photo_overrides_v1') || '{}');
  } catch {
    return {};
  }
}

function saveLocalPhotoOverride(productId, imageUrls) {
  const map = getLocalPhotoOverrides();
  map[productId] = imageUrls;
  try {
    localStorage.setItem('ab_photo_overrides_v1', JSON.stringify(map));
  } catch {}
}

async function pushProductPhotosToGh(productId, imageUrls, token) {
  const repo = 'ab-gadgetz/ab-gadgetz.github.io';
  const apiUrl = `https://api.github.com/repos/${repo}/contents/public/product-photos.json`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  let sha;
  let existingPhotos = {};
  const getRes = await fetch(apiUrl, { headers });
  if (getRes.ok) {
    const info = await getRes.json();
    sha = info.sha;
    try {
      const decoded = decodeURIComponent(escape(atob(String(info.content || '').replace(/\n/g, ''))));
      existingPhotos = JSON.parse(decoded)?.photos || {};
    } catch {}
  }
  existingPhotos[productId] = imageUrls;
  const payload = JSON.stringify({ updatedAt: new Date().toISOString(), photos: existingPhotos }, null, 2);
  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Update product photos (${productId}) from web portal`,
      content: btoa(unescape(encodeURIComponent(payload))),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!putRes.ok) {
    const errData = await putRes.json().catch(() => ({}));
    throw new Error(errData.message || `GitHub photo sync failed (${putRes.status})`);
  }
  // Trigger catalog rebuild in background so customer portals update automatically
  fetch(`https://api.github.com/repos/${repo}/actions/workflows/deploy-catalog.yml/dispatches`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
  }).catch(() => {});
  return true;
}

async function compressImageFileToBase64(file, maxDim = 1200, quality = 0.85) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected photo.'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Invalid image file.'));
    i.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
  const w = Math.max(1, Math.round((img.width || 1) * scale));
  const h = Math.max(1, Math.round((img.height || 1) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const jpegUrl = canvas.toDataURL('image/jpeg', quality);
  return jpegUrl.split(',')[1] || '';
}

async function uploadProductImageToGh(file, sku, token) {
  const b64 = await compressImageFileToBase64(file);
  const safeSku = String(sku || 'product').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'product';
  const fileName = `${safeSku}-${Date.now()}.jpg`;
  const repo = 'ab-gadgetz/ab-gadgetz.github.io';
  const apiUrl = `https://api.github.com/repos/${repo}/contents/public/product-images/${fileName}`;
  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `Upload product photo ${fileName} from web portal`,
      content: b64,
    }),
  });
  if (!putRes.ok) {
    const errData = await putRes.json().catch(() => ({}));
    throw new Error(errData.message || `GitHub image upload failed (${putRes.status})`);
  }
  return `https://raw.githubusercontent.com/${repo}/main/public/product-images/${fileName}`;
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
  const tokWrap = document.getElementById('photoGhTokenWrap');
  const tokInput = document.getElementById('photoGhTokenInput');
  const savedTok = localStorage.getItem('bs_gh_pub_token') || '';
  if (tokInput) tokInput.value = savedTok;
  if (tokWrap) tokWrap.classList.toggle('hidden', !IS_STATIC_GH || Boolean(savedTok));
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
      renderInventory();
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
    renderInventory();
    if (state.selectedCustomerId) await loadCustomerCatalog(state.selectedCustomerId);
    renderPhotoEditor();
  } catch (err) {
    msg.textContent = err.message;
  }
});

document.getElementById('savePhotoGhTokenBtn')?.addEventListener('click', () => {
  const val = (document.getElementById('photoGhTokenInput')?.value || '').trim();
  const msg = document.getElementById('photoMsg');
  if (!val) {
    if (msg) msg.textContent = 'Paste a valid GitHub Token first.';
    return;
  }
  localStorage.setItem('bs_gh_pub_token', val);
  document.getElementById('photoGhTokenWrap')?.classList.add('hidden');
  if (msg) msg.textContent = 'GitHub Token saved! You can now upload or delete photos from your phone or PC.';
});

document.getElementById('uploadPhotoFileBtn')?.addEventListener('click', () => {
  document.getElementById('photoFileInput')?.click();
});

document.getElementById('photoFileInput')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const pid = activeAdminPhotoProductId || document.getElementById('photoProduct')?.value;
  const prod = state.inventory?.items?.find((i) => i.id === pid);
  const msg = document.getElementById('photoMsg');
  if (!pid || !prod) return;
  const token = localStorage.getItem('bs_gh_pub_token') || '';
  if (!token) {
    document.getElementById('photoGhTokenWrap')?.classList.remove('hidden');
    if (msg) msg.textContent = 'Enter your GitHub Token above once to upload photos from phone or PC web.';
    return;
  }
  try {
    if (msg) msg.textContent = 'Uploading photo to GitHub...';
    const uploadedUrl = await uploadProductImageToGh(file, prod.website_codes || prod.sku || prod.id, token);
    const nextUrls = [...(prod.imageUrls || []), uploadedUrl];
    await api('/api/products/photos', {
      method: 'PATCH',
      body: JSON.stringify({ productId: pid, imageUrls: nextUrls }),
    });
    if (msg) msg.textContent = 'Photo uploaded & saved online!';
    renderInventory();
    if (state.selectedCustomerId) await loadCustomerCatalog(state.selectedCustomerId);
    renderPhotoEditor();
  } catch (err) {
    if (msg) msg.textContent = err.message;
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
      ? item.lifecycle_status === 'Subject to Phaseout'
        ? `<span class="lifecycle-pill" style="background:rgba(245,158,11,0.18);color:#fbbf24;border-color:rgba(245,158,11,0.45);" title="Not in latest AB supplier stock update (${item.supplier_missing_since || '2026-11-23'}). Auto-phaseout after 3 months (${addMonthsIsoClient(item.supplier_missing_since || '2026-11-23', 3)}).">Subject to Phaseout • Since ${item.supplier_missing_since || 'Nov 23'}</span>`
        : `<span class="lifecycle-pill">${item.lifecycle_status}</span>`
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
    else if (stockView === 'subject_phaseout') matchView = item.lifecycle_status === 'Subject to Phaseout';
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

function normRestockUnitName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\bplus\b/g, '+')
    .replace(/\bgalaxy\b/g, '')
    .replace(/gb\b/g, '')
    .replace(/\b4g\b/g, '')
    .replace(/[^a-z0-9+]/g, '');
}

function isNonOrderablePromoOrRepo(item) {
  const txt = `${item?.name || ''} ${item?.model || ''} ${item?.sku || ''}`.toUpperCase();
  const price = Number(item?.base_price) || 0;
  if (/\(REPO\)|\bREPO\b/.test(txt)) return true;
  if (/\bFREE\b|FREEBIE|FREE\s*BAG|BUNDLE/.test(txt) && price <= 500) return true;
  if (price > 0 && price <= 50 && (item?.product_type || 'Cellphones') === 'Cellphones') return true;
  return false;
}

function getCellphonePriceTier(item) {
  const pType = item?.product_type || 'Cellphones';
  const srp = Number(item?.base_price) || 0;
  if (pType !== 'Cellphones') {
    return { key: 'ACCESSORY', rank: 2, label: 'Accessory', color: 'var(--muted)' };
  }
  if (srp > 0 && srp <= 10000) {
    return { key: 'LOW_END', rank: 1, label: 'Low-End', color: 'var(--green)' };
  }
  if (srp > 10000 && srp <= 16000) {
    return { key: 'MID_RANGE', rank: 2, label: 'Mid-Range', color: '#60a5fa' };
  }
  return { key: 'HIGH_END', rank: 3, label: 'High-End', color: 'var(--muted)' };
}

function buildRestockDemandIndex() {
  const byProdBranch = new Map();
  const byProd = new Map();

  // 1. Prefer authoritative server-computed 30d/90d/all-time demand (Cash + deduplicated Installments)
  const srvPB = state.planning?.demandByProductBranch;
  const srvP = state.planning?.demandByProduct;
  if (srvPB && Object.keys(srvPB).length > 0) {
    for (const [k, v] of Object.entries(srvPB)) {
      byProdBranch.set(k, {
        sold30: Number(v.sold30) || 0,
        sold90: Number(v.sold90) || 0,
        allSold: Number(v.allSold) || 0,
        restocked: Number(v.restocked) || 0,
      });
    }
    if (srvP) {
      for (const [pid, v] of Object.entries(srvP)) {
        byProd.set(pid, {
          sold30: Number(v.sold30) || 0,
          sold90: Number(v.sold90) || 0,
          allSold: Number(v.allSold) || 0,
          restocked: Number(v.restocked) || 0,
        });
      }
    }
    return { byProdBranch, byProd };
  }

  // 2. Fallback / Static GitHub Pages mode: compute exact same 30d/90d demand from activity + installments
  const items = state.inventory?.items || [];
  const prodByNorm = new Map();
  for (const p of items) {
    const keys = [normRestockUnitName(p.name), normRestockUnitName(`${p.brand || ''} ${p.model || ''}`)].filter(Boolean);
    for (const k of keys) {
      const ex = prodByNorm.get(k);
      if (!ex || ((ex.lifecycle_status || 'Active') !== 'Active' && (p.lifecycle_status || 'Active') === 'Active')) {
        prodByNorm.set(k, p);
      }
    }
  }

  const nowMs = Date.now();
  const since30 = new Date(nowMs - 30 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const since90 = new Date(nowMs - 90 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

  const rawPB = new Map();
  const ensurePB = (pid, bid) => {
    const k = `${pid}::${bid}`;
    if (!rawPB.has(k)) {
      rawPB.set(k, { cash30: 0, instMv30: 0, instPt30: 0, cash90: 0, instMv90: 0, instPt90: 0, allSold: 0, restocked: 0 });
    }
    return rawPB.get(k);
  };

  const act = state.planningActivity || state.activityData;
  const mvList = act?.allMovements || act?.movements || [];
  for (const m of mvList) {
    const mt = String(m.movement_type || m.action || m.type || '').toUpperCase();
    if (mt.includes('TRANSFER') || mt.includes('FREE')) continue;
    if (!m.product_id || !m.branch_id) continue;
    const d = ensurePB(m.product_id, m.branch_id);
    const dt = String(m.recorded_at || '').slice(0, 10);
    const dq = Number(m.delta_qty) || 0;
    const q = Math.abs(dq);
    if (dq < 0) {
      d.allSold += q;
      const isInst = mt.includes('INSTALLMENT');
      if (dt >= since90) {
        if (isInst) d.instMv90 += q;
        else d.cash90 += q;
      }
      if (dt >= since30) {
        if (isInst) d.instMv30 += q;
        else d.cash30 += q;
      }
    } else if (dq > 0 && (mt.includes('DELIVERY') || mt.includes('STOCK'))) {
      d.restocked += q;
    }
  }

  const instList = act?.allInstallments || act?.installmentSales || state.salesData?.receivables?.installments || state.receivables?.installments || [];
  for (const ir of instList) {
    const dt = String(ir.sale_date || '').slice(0, 10);
    if (dt < since90) continue;
    const p = prodByNorm.get(normRestockUnitName(ir.unit));
    if (!p || !ir.branch_id) continue;
    const d = ensurePB(p.id, ir.branch_id);
    d.instPt90 += 1;
    if (dt >= since30) d.instPt30 += 1;
    d.allSold = Math.max(d.allSold, d.cash90 + Math.max(d.instMv90, d.instPt90));
  }

  for (const [k, d] of rawPB.entries()) {
    const [pid] = k.split('::');
    const sold30 = d.cash30 + Math.max(d.instMv30, d.instPt30);
    const sold90 = d.cash90 + Math.max(d.instMv90, d.instPt90);
    const allSold = Math.max(d.allSold, sold90);
    byProdBranch.set(k, { sold30, sold90, allSold, restocked: d.restocked });
    if (!byProd.has(pid)) byProd.set(pid, { sold30: 0, sold90: 0, allSold: 0, restocked: 0 });
    const agg = byProd.get(pid);
    agg.sold30 += sold30;
    agg.sold90 += sold90;
    agg.allSold += allSold;
    agg.restocked += d.restocked;
  }

  return { byProdBranch, byProd };
}

function buildMovementStatsMap() {
  return buildRestockDemandIndex();
}

function getProductMovementSummary(item, demandIdx) {
  const agg = demandIdx?.byProd?.get(item.id);
  if (agg) {
    return {
      sold: agg.allSold || 0,
      sold90: agg.sold90 || 0,
      sold30: agg.sold30 || 0,
      restocked: agg.restocked || 0,
      totalMovements: (agg.allSold || 0) + (agg.restocked || 0),
    };
  }
  return { sold: 0, sold90: 0, sold30: 0, restocked: 0, totalMovements: 0 };
}

function isObsoleteOrNonMoving(item, branches, demandIdx) {
  let totalAvail = 0;
  for (const b of branches) totalAvail += Number(item.byBranch?.[b.id]?.qtyAvailable) || 0;
  const hasSupplierCost = Number(item.cost_ab) > 0 || Number(item.cost_ak) > 0 || Number(item.cost_online) > 0;
  const mv = getProductMovementSummary(item, demandIdx);

  // Never classify any unit with sales (cash or installment) as Obsolete/Dead!
  if (totalAvail === 0 && mv.sold === 0 && mv.sold90 === 0 && mv.restocked === 0 && !hasSupplierCost) {
    return { status: 'DEAD_OBSOLETE', label: 'Obsolete / Dead (0 stock, 0 sales, 0 reorders)', totalAvail, mv };
  }
  if (totalAvail > 0 && mv.sold === 0 && mv.sold90 === 0 && mv.restocked === 0 && !hasSupplierCost) {
    return { status: 'NON_MOVING', label: `Non-Moving (${totalAvail} unsold on hand, 0 sales/reorders)`, totalAvail, mv };
  }
  return { status: 'ACTIVE_MOVING', label: 'Active / Moving', totalAvail, mv };
}

async function markProductsPhaseout(productIds) {
  if (!productIds || !productIds.length) return;
  for (const id of productIds) {
    const prod = state.inventory?.items?.find((i) => i.id === id);
    if (prod) prod.lifecycle_status = 'Phaseout / Do Not Reorder';
  }
  if (!IS_STATIC_GH) {
    try {
      await api('/api/products/lifecycle', {
        method: 'PATCH',
        body: JSON.stringify({ productIds, status: 'Phaseout / Do Not Reorder' }),
      });
    } catch (err) {
      alert(err.message);
    }
  }
  buildRestockDraftPlan();
  renderRestockCards();
  renderInventory();
}

function renderObsoleteAuditUI(obsoleteList) {
  const bannerEl = document.getElementById('restockObsoleteBanner');
  const panelEl = document.getElementById('restockObsoletePanel');
  const tbody = document.querySelector('#restockObsoleteTable tbody');
  const excludeChk = document.getElementById('restockExcludeObsoleteChk')?.checked;
  if (!bannerEl) return;

  const deadCount = obsoleteList.filter((x) => x.status === 'DEAD_OBSOLETE').length;
  const nonMovingCount = obsoleteList.filter((x) => x.status === 'NON_MOVING').length;
  state.lastObsoleteList = obsoleteList;

  if (!obsoleteList.length) {
    bannerEl.classList.add('hidden');
    if (panelEl) panelEl.classList.add('hidden');
    return;
  }

  bannerEl.classList.remove('hidden');
  bannerEl.innerHTML = `
    <div>
      <strong>Web-Sync Cleanup:</strong> ${excludeChk ? 'Auto-hiding' : 'Found'}
      <strong>${fmtNum(deadCount)}</strong> obsolete dead model(s) (0 stock, 0 sales, 0 reorders) &amp;
      <strong>${fmtNum(nonMovingCount)}</strong> non-moving model(s) (unsold stock, 0 sales).
    </div>
    <button type="button" id="toggleObsoleteAuditBtn" class="secondary" style="padding:4px 10px;font-size:11px;min-height:0;">
      ${panelEl && !panelEl.classList.contains('hidden') ? 'HIDE ANALYSIS' : 'ANALYZE / MARK PHASEOUT'}
    </button>
  `;

  document.getElementById('toggleObsoleteAuditBtn')?.addEventListener('click', () => {
    panelEl?.classList.toggle('hidden');
    renderObsoleteAuditUI(state.lastObsoleteList || []);
  });

  if (tbody) {
    tbody.innerHTML = obsoleteList
      .slice(0, 200)
      .map(
        (x) => `
        <tr>
          <td><strong>${x.displayModel}</strong><div class="small muted">${x.sku}</div></td>
          <td>${fmtNum(x.totalAvail)} pcs</td>
          <td class="small muted">${x.mv.sold} sold • ${x.mv.restocked} restocked</td>
          <td><span class="badge ${x.status === 'DEAD_OBSOLETE' ? 'badge-danger' : 'badge-warn'}">${x.status === 'DEAD_OBSOLETE' ? 'Obsolete / Dead' : 'Non-Moving'}</span></td>
          <td><button type="button" class="secondary single-phaseout-btn" data-pid="${x.id}" style="padding:3px 8px;font-size:11px;min-height:0;">Phaseout</button></td>
        </tr>`
      )
      .join('');

    tbody.querySelectorAll('.single-phaseout-btn').forEach((btn) => {
      btn.addEventListener('click', () => markProductsPhaseout([btn.dataset.pid]));
    });
  }
}

function buildPendingOrdersLookup() {
  const byProdBranch = new Map();
  const byProd = new Map();
  const addPending = (pid, bid, qty, label) => {
    if (!pid || !bid || !(qty > 0)) return;
    const kb = `${pid}::${bid}`;
    if (!byProdBranch.has(kb)) byProdBranch.set(kb, { qty: 0, refs: new Set() });
    const cell = byProdBranch.get(kb);
    cell.qty += qty;
    if (label) cell.refs.add(label);

    if (!byProd.has(pid)) byProd.set(pid, { qty: 0, refs: new Set() });
    const pAgg = byProd.get(pid);
    pAgg.qty += qty;
    if (label) pAgg.refs.add(label);
  };

  const pendingStatuses = new Set(['Sent to Supplier', 'Supplier Approved', 'At Warehouse (AB Web INITIAL)', 'Partially Received']);
  const linkedAbLineKeys = new Set();
  for (const o of state.savedOrders || []) {
    if (!pendingStatuses.has(o.status)) continue;
    for (const it of o.items || []) {
      if (it.abDeliveryNo && it.abDeliveryNo !== 'PENDING IN AB WEB' && it.productId && it.branchId) {
        linkedAbLineKeys.add(`${String(it.abDeliveryNo).trim()}::${it.branchId}::${it.productId}`);
      }
      if (it.approved === false || it.isExtraItem) continue;
      const appQty = Math.max(0, Number(it.qty) || 0);
      const recQty =
        it.receivedQty !== undefined && it.receivedQty !== null && it.receivedQty !== ''
          ? Math.max(0, Number(it.receivedQty) || 0)
          : 0;
      const rem = Math.max(0, appQty - recQty);
      if (rem > 0) addPending(it.productId, it.branchId, rem, o.id);
    }
  }

  // Also include any unlinked non-RECEIVED, non-CANCELLED AB Web deliveries (e.g. DELIVERY / INITIAL at warehouse for pick-up)
  for (const d of state.abDeliveries || []) {
    const dSt = String(d.status || '').toUpperCase();
    if (dSt === 'RECEIVED' || dSt === 'CANCELLED') continue;
    for (const dl of d.items || []) {
      if (!dl.productId) continue;
      const lineKey = `${String(d.deliveryNo || '').trim()}::${d.branchId}::${dl.productId}`;
      if (d.deliveryNo && linkedAbLineKeys.has(lineKey)) continue;
      if ((Number(dl.deliveredQty) || 0) > (Number(dl.receivedQty) || 0)) {
        addPending(dl.productId, d.branchId, (Number(dl.deliveredQty) || 0) - (Number(dl.receivedQty) || 0), d.deliveryNo);
      }
    }
  }

  return { byProdBranch, byProd };
}

function buildRestockDraftPlan() {
  if (!state.inventory) return [];
  const mode = document.querySelector('input[name="restockSupplierMode"]:checked')?.value || 'LOWEST';
  const priorityMode = document.getElementById('restockPriorityMode')?.value || 'LOW_END_DEMAND';
  const typeFilter = document.getElementById('restockTypeFilter')?.value || 'Cellphones';
  const budgetVal = parseMoneyInput(document.getElementById('restockBudgetInput')?.value);
  const globalBranchId = document.getElementById('globalBranch')?.value || '';
  const excludeObsolete = document.getElementById('restockExcludeObsoleteChk')?.checked !== false;
  const deductPending = document.getElementById('restockDeductPendingChk')?.checked !== false;

  const { branches, items } = state.inventory;
  const targetBranches = globalBranchId ? branches.filter((b) => b.id === globalBranchId) : branches;
  const demandIdx = buildRestockDemandIndex();
  const pendingIdx = buildPendingOrdersLookup();

  const candidates = [];
  const obsoleteList = [];
  for (const item of items) {
    if ((item.lifecycle_status || 'Active') !== 'Active') continue;
    const pType = item.product_type || 'Cellphones';
    if (typeFilter !== 'ALL' && pType !== typeFilter) continue;
    // Never suggest repo units or freebie/promo bundles for supplier restock
    if (isNonOrderablePromoOrRepo(item)) continue;

    const health = isObsoleteOrNonMoving(item, branches, demandIdx);
    const prodPending = pendingIdx.byProd.get(item.id)?.qty || 0;
    if (health.status !== 'ACTIVE_MOVING' && prodPending === 0) {
      obsoleteList.push({
        id: item.id,
        displayModel: formatSwapModelName({ brand: item.brand || '', model: item.model || item.name }),
        sku: item.website_codes || item.sku,
        ...health,
      });
      if (excludeObsolete) continue;
    }

    const sup = resolveSupplierForProduct(item, mode);
    if (!sup) continue;

    const price = Number(item.base_price) || 0;
    const tier = getCellphonePriceTier(item);
    const prodDemand = demandIdx.byProd.get(item.id) || { sold30: 0, sold90: 0, allSold: 0, restocked: 0 };
    const storewideDemand90 = prodDemand.sold90 || 0;
    const storewideDemand30 = prodDemand.sold30 || 0;
    const storewideAllSold = prodDemand.allSold || 0;

    // Resolve effective unit cost: if missing (0) or wildly above SRP from a FIFO glitch, estimate 85% SRP in LOWEST mode so 0-stock demand items are NEVER dropped
    const websiteCost = Number(item.cost_price) || 0;
    const hasManualSupCost = Number(item.cost_ab) > 0 || Number(item.cost_ak) > 0 || Number(item.cost_online) > 0;
    let unitCost = Number(sup.unitCost) || 0;
    let isEstimatedCost = false;
    if (mode === 'LOWEST' && price > 0 && (unitCost <= 0 || (!hasManualSupCost && unitCost > price * 1.05))) {
      unitCost = Math.round(price * 0.85);
      isEstimatedCost = true;
    }
    const savingsVsWebsite = !isEstimatedCost && websiteCost > 0 && websiteCost <= price * 1.05 && unitCost > 0 ? websiteCost - unitCost : 0;

    for (const b of targetBranches) {
      const cell = item.byBranch?.[b.id];
      const avail = cell ? Math.max(0, Number(cell.qtyAvailable) || 0) : 0;
      const pendInfo = pendingIdx.byProdBranch.get(`${item.id}::${b.id}`) || { qty: 0, refs: new Set() };
      const pendingQty = pendInfo.qty || 0;
      const pendingRefs = [...pendInfo.refs];
      const effectiveAvail = avail + (deductPending ? pendingQty : 0);

      const brDemand = demandIdx.byProdBranch.get(`${item.id}::${b.id}`) || { sold30: 0, sold90: 0, allSold: 0 };
      const branchDemand90 = brDemand.sold90 || 0;
      const branchDemand30 = brDemand.sold30 || 0;
      const branchAllSold = brDemand.allSold || 0;
      const branchMonthlyDemand = branchDemand90 / 3;

      // Dynamic Reorder Point & Target Stock driven by actual per-store demand + price tier
      const defaultRp = tier.key === 'LOW_END' ? (b.id === 'br-molave' ? 2 : 1) : tier.key === 'MID_RANGE' ? (b.id === 'br-molave' ? 2 : 1) : 1;
      const demandRp = branchMonthlyDemand > 0 ? Math.ceil(branchMonthlyDemand * 0.4) : 0;
      const reorderPoint = Math.max(Number(cell?.reorderPoint) || defaultRp, demandRp);

      // Skip items whose current + pending stock isn't even low (unless they specifically have pending orders to inspect)
      if (avail > 0 && avail > reorderPoint && pendingQty === 0) continue;

      const baseFloor =
        tier.key === 'LOW_END'
          ? b.id === 'br-molave'
            ? 3
            : 2
          : tier.key === 'MID_RANGE'
            ? b.id === 'br-molave'
              ? 2
              : 1
            : 1;
      const demandTarget = branchMonthlyDemand > 0 ? Math.min(10, Math.ceil(branchMonthlyDemand * 0.85)) : 0;
      const targetQty = branchDemand90 > 0
        ? Math.max(baseFloor, demandTarget, reorderPoint + (avail === 0 ? 1 : 0))
        : Math.max(baseFloor, avail === 0 ? baseFloor : reorderPoint + 1);

      const minOrderQty = tier.key === 'LOW_END' ? 2 : 1;
      const coveredByPending = deductPending && pendingQty > 0 && effectiveAvail > reorderPoint;
      const excludedUnavailable = Boolean(state.restockExcludedKeys?.has(`${item.id}::${b.id}`));
      const suggestedQty = coveredByPending ? 0 : Math.max(minOrderQty, targetQty - effectiveAvail);
      const rawNeededWithoutPending = Math.max(0, targetQty - avail);
      const savedByPendingQty = deductPending ? Math.max(0, rawNeededWithoutPending - suggestedQty) : 0;

      // Skip items only kept for healthy stock + pending if they had >0 avail and no order needed (unless coveredByPending so user can inspect pending coverage)
      if (avail > reorderPoint && !coveredByPending && pendingQty === 0) continue;

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
        unitCost,
        isEstimatedCost,
        srp: price,
        tierKey: tier.key,
        tierRank: tier.rank,
        tierLabel: tier.label,
        tierColor: tier.color,
        websiteCost,
        savingsVsWebsite,
        avail,
        pendingQty,
        pendingRefs,
        effectiveAvail,
        coveredByPending,
        excludedUnavailable,
        savedByPendingQty,
        reorderPoint,
        branchDemand30,
        branchDemand90,
        branchAllSold,
        storewideDemand30,
        storewideDemand90,
        storewideAllSold,
        qty: suggestedQty,
        selected: !coveredByPending && !excludedUnavailable && suggestedQty > 0,
      });
    }
  }

  // Sort by selected priority strategy (push fully-covered-by-pending & supplier-unavailable excluded rows after actionable rows)
  candidates.sort((a, b) => {
    const aNeed = a.coveredByPending || a.excludedUnavailable || a.qty <= 0 ? 1 : 0;
    const bNeed = b.coveredByPending || b.excludedUnavailable || b.qty <= 0 ? 1 : 0;
    if (aNeed !== bNeed) return aNeed - bNeed;

    const aHasDemand = a.branchDemand90 > 0 || a.storewideDemand90 > 0 || a.storewideAllSold > 0 ? 1 : 0;
    const bHasDemand = b.branchDemand90 > 0 || b.storewideDemand90 > 0 || b.storewideAllSold > 0 ? 1 : 0;
    const aZero = a.effectiveAvail === 0 ? 1 : 0;
    const bZero = b.effectiveAvail === 0 ? 1 : 0;

    if (priorityMode === 'SAVINGS_FIRST') {
      const ap = a.unitCost > 0 ? 0 : 1;
      const bp = b.unitCost > 0 ? 0 : 1;
      if (ap !== bp) return ap - bp;
      if (aZero !== bZero) return bZero - aZero;
      if (a.savingsVsWebsite !== b.savingsVsWebsite) return b.savingsVsWebsite - a.savingsVsWebsite;
      if (a.branchDemand90 !== b.branchDemand90) return b.branchDemand90 - a.branchDemand90;
      if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank;
      return a.unitCost - b.unitCost || a.displayModel.localeCompare(b.displayModel) || a.key.localeCompare(b.key);
    }

    if (priorityMode === 'DEMAND_FIRST') {
      if (aHasDemand !== bHasDemand) return bHasDemand - aHasDemand;
      if (aZero !== bZero) return bZero - aZero;
      if (a.branchDemand90 !== b.branchDemand90) return b.branchDemand90 - a.branchDemand90;
      if (a.storewideDemand90 !== b.storewideDemand90) return b.storewideDemand90 - a.storewideDemand90;
      if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank;
      if (a.effectiveAvail !== b.effectiveAvail) return a.effectiveAvail - b.effectiveAvail;
      return a.unitCost - b.unitCost || a.displayModel.localeCompare(b.displayModel) || a.key.localeCompare(b.key);
    }

    // DEFAULT: LOW_END_DEMAND — Prioritize Active-Demand Low-End Cellphones (SRP <= ₱10k), Out-of-Stock (after pending) first, then Store Demand
    if (aHasDemand !== bHasDemand) return bHasDemand - aHasDemand;
    if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank;
    if (aZero !== bZero) return bZero - aZero;
    if (a.branchDemand90 !== b.branchDemand90) return b.branchDemand90 - a.branchDemand90;
    if (a.storewideDemand90 !== b.storewideDemand90) return b.storewideDemand90 - a.storewideDemand90;
    if (a.branchAllSold !== b.branchAllSold) return b.branchAllSold - a.branchAllSold;
    if (a.storewideAllSold !== b.storewideAllSold) return b.storewideAllSold - a.storewideAllSold;
    if (a.savingsVsWebsite !== b.savingsVsWebsite) return b.savingsVsWebsite - a.savingsVsWebsite;
    if (a.effectiveAvail !== b.effectiveAvail) return a.effectiveAvail - b.effectiveAvail;
    return a.unitCost - b.unitCost || a.displayModel.localeCompare(b.displayModel) || a.key.localeCompare(b.key);
  });

  if (budgetVal > 0) {
    let spent = 0;
    for (const c of candidates) {
      if (c.coveredByPending || c.excludedUnavailable || c.qty <= 0) {
        c.selected = false;
        continue;
      }
      if (c.unitCost <= 0) {
        c.selected = false;
        continue;
      }
      const minOrderQty = c.tierKey === 'LOW_END' ? 2 : 1;
      if (spent + c.unitCost * minOrderQty > budgetVal) {
        c.selected = false;
        continue;
      }
      const maxAffordable = Math.floor((budgetVal - spent) / c.unitCost);
      if (maxAffordable < c.qty) {
        c.qty = Math.max(minOrderQty, maxAffordable);
      }
      spent += c.qty * c.unitCost;
    }
  }

  state.restockPlan = candidates;
  renderObsoleteAuditUI(obsoleteList);
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
      if (showFilter === 'SELECTED' && (!r.selected || r.qty <= 0)) return false;
      if (showFilter === 'ALL' && r.coveredByPending) return false;
      if (showFilter === 'ZERO' && (r.avail > 0 || r.coveredByPending)) return false;
      if (showFilter === 'PENDING_COVERED' && !(r.pendingQty > 0)) return false;
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
  const lowEndUnits = selected.filter((r) => r.tierKey === 'LOW_END').reduce((s, r) => s + r.qty, 0);
  const midUnits = selected.filter((r) => r.tierKey === 'MID_RANGE').reduce((s, r) => s + r.qty, 0);
  const highUnits = selected.filter((r) => r.tierKey === 'HIGH_END').reduce((s, r) => s + r.qty, 0);
  const zeroLines = selected.filter((r) => r.avail === 0).length;
  const totalZeroLines = plan.filter((r) => r.avail === 0 && !r.coveredByPending).length;
  const pendingSavedPcs = plan.reduce((s, r) => s + (Number(r.savedByPendingQty) || 0), 0);
  const pendingLineCount = plan.filter((r) => r.pendingQty > 0).length;
  const excludedCount = state.restockExcludedKeys?.size || 0;
  if (sumEl) {
    const tierNote =
      lowEndUnits + midUnits + highUnits > 0
        ? ` • <span style="color:var(--green);">Low-End: <strong>${fmtNum(lowEndUnits)}</strong></span>${midUnits ? ` • Mid: <strong>${fmtNum(midUnits)}</strong>` : ''}${highUnits ? ` • High: <strong>${fmtNum(highUnits)}</strong>` : ''}`
        : '';
    const pendNote =
      pendingSavedPcs > 0
        ? ` • <span style="color:#60a5fa;">Pending On-Order deducted: <strong>${fmtNum(pendingSavedPcs)} pcs</strong> (${pendingLineCount} branch line${pendingLineCount === 1 ? '' : 's'})</span>`
        : '';
    const exclNote =
      excludedCount > 0
        ? ` • <span style="color:#f59e0b;">Unavailable excluded: <strong>${fmtNum(excludedCount)}</strong> <button type="button" id="clearRestockExcludedBtn" class="secondary" style="padding:1px 6px;font-size:10.5px;min-height:0;margin-left:3px;">Reset</button></span>`
        : '';
    sumEl.innerHTML = `Selected <strong>${fmtNum(selected.length)}</strong> line(s) (<strong>${fmtNum(zeroLines)}/${fmtNum(totalZeroLines)}</strong> out-of-stock) • <strong>${fmtNum(totalUnits)} pcs</strong>${tierNote}${pendNote}${exclNote} • Est. Total: <strong style="color:var(--gold-bright);">${fmtCurrency(totalCost)}</strong>`;
    sumEl.querySelector('#clearRestockExcludedBtn')?.addEventListener('click', () => {
      state.restockExcludedKeys = new Set();
      state.previewUncheckedKeys = new Set();
      buildRestockDraftPlan();
      renderRestockCards();
    });
  }

  const visible = getFilteredRestockRows();
  if (!visible.length) {
    grid.innerHTML = '<div class="muted small" style="padding:10px 0;">No products match. Try switching Show filter to "All Low-Stock" or clearing search.</div>';
    return;
  }

  if (!state.restockOpenBrands) state.restockOpenBrands = new Set();

  // Group by Brand -> Model (preserves priority sort order!)
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
        isEstimatedCost: r.isEstimatedCost,
        srp: r.srp,
        tierKey: r.tierKey,
        tierLabel: r.tierLabel,
        tierColor: r.tierColor,
        storewideDemand90: r.storewideDemand90,
        storewideAllSold: r.storewideAllSold,
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
    const brandZeroCount = brandRows.filter((r) => r.avail === 0).length;
    const brandAllSelected = brandRows.length > 0 && brandRows.every((r) => r.selected);
    const isOpen = searchActive || byBrand.size <= 3 || state.restockOpenBrands.has(bName);
    const accent = typeof getBrandMeta === 'function' ? getBrandMeta(bName).color : 'var(--gold)';

    const modelsHtml = models
      .map((m) => {
        const thumbHtml = m.imageUrl
          ? `<img src="${m.imageUrl}" alt="${m.displayModel}" style="width:48px;height:48px;object-fit:contain;border-radius:8px;background:#fff;flex-shrink:0;padding:2px;" loading="lazy" />`
          : `<div style="width:48px;height:48px;border-radius:8px;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">📱</div>`;
        const branchRowsHtml = m.rows
          .map((r) => {
            const zeroTag = r.avail === 0 ? `<span style="color:#ef4444;font-weight:700;font-size:10px;margin-left:2px;">OUT</span>` : '';
            const pendTag =
              r.pendingQty > 0
                ? `<span style="color:#60a5fa;font-weight:700;font-size:10px;">+${fmtNum(r.pendingQty)} on order${r.coveredByPending ? ' (covered)' : ''}</span>`
                : '';
            const brDemTag =
              r.branchDemand90 > 0
                ? `<span style="color:var(--gold-bright);font-size:10.5px;">• ${fmtNum(r.branchDemand90)} sold/90d</span>`
                : r.branchAllSold > 0
                  ? `<span class="muted" style="font-size:10px;">• ${fmtNum(r.branchAllSold)} hist</span>`
                  : '';
            return `
            <div class="restock-branch-row">
              <label class="restock-branch-label">
                <input type="checkbox" class="reorder-row-chk" data-idx="${r._idx}" ${r.selected ? 'checked' : ''} style="width:16px;height:16px;margin:0;accent-color:var(--gold);flex-shrink:0;" />
                <span>${r.branchName}</span>
                <span class="muted small">(${fmtNum(r.avail)}/${fmtNum(r.reorderPoint)})</span>
                ${zeroTag}
                ${pendTag}
                ${brDemTag}
              </label>
              <div class="restock-branch-qty">
                <input type="number" class="reorder-qty-inp" data-idx="${r._idx}" value="${r.qty}" min="0" max="99" />
                <span class="small muted" style="min-width:22px;">pcs</span>
              </div>
            </div>`;
          })
          .join('');
        const prodObj = state.inventory?.items?.find((i) => i.id === m.productId) || {};
        const cAb = Number(prodObj.cost_ab) > 0 ? prodObj.cost_ab : '';
        const cAk = Number(prodObj.cost_ak) > 0 ? prodObj.cost_ak : '';
        const cOn = Number(prodObj.cost_online) > 0 ? prodObj.cost_online : '';
        const webCost = Number(prodObj.cost_price) || 0;
        const diffWeb = !m.isEstimatedCost && webCost > 0 && m.unitCost > 0 ? webCost - m.unitCost : 0;
        const diffBadge = m.isEstimatedCost
          ? `<span style="color:#f59e0b;font-size:10.5px;font-weight:700;">• Est. 85% SRP (enter cost)</span>`
          : diffWeb > 0
            ? `<span style="color:var(--green);font-size:10.5px;font-weight:700;">• Saves ${fmtCurrency(diffWeb)} vs Web</span>`
            : diffWeb < 0
              ? `<span style="color:#f59e0b;font-size:10.5px;font-weight:700;">• +${fmtCurrency(Math.abs(diffWeb))} vs Web</span>`
              : '';
        const tierPill = `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;background:rgba(255,255,255,0.08);color:${m.tierColor};">${m.tierLabel}${m.srp > 0 ? ` • ${fmtCurrency(m.srp)}` : ''}</span>`;
        const supEntry = state.abSupplierCatalog?.byProductId?.get(m.productId);
        const abStockPill = supEntry
          ? `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;background:rgba(16,185,129,0.14);color:#34d399;" title="${String(supEntry.colorsNotes || 'Available on AB Supplier Stock List').replace(/"/g, '&quot;')}">AB Stock: ${supEntry.stockDate || 'Nov 23'}</span>`
          : '';
        const demandPill =
          m.storewideDemand90 > 0
            ? `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;background:rgba(231,197,95,0.14);color:var(--gold-bright);">Demand: ${fmtNum(m.storewideDemand90)} / 90d</span>`
            : m.storewideAllSold > 0
              ? `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;background:rgba(255,255,255,0.06);color:var(--muted);">Hist: ${fmtNum(m.storewideAllSold)} sold</span>`
              : '';
        return `
          <div class="model-card restock-model-card">
            <div style="display:flex;gap:10px;align-items:center;">
              ${thumbHtml}
              <div style="min-width:0;flex:1;">
                <div style="font-weight:700;font-size:13px;line-height:1.25;">${m.displayModel}</div>
                <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:3px;">${tierPill}${demandPill}${abStockPill}</div>
                <div class="small muted" style="margin-top:2px;">${m.sku} • <span style="color:var(--gold-bright);">${m.supplier}</span></div>
                <div class="small" style="margin-top:2px;">Active Cost: <strong>${m.unitCost > 0 ? fmtCurrency(m.unitCost) : '—'}</strong> ${diffBadge}</div>
              </div>
            </div>
            <div class="restock-cost-grid">
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
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <input type="checkbox" class="restock-brand-chk" data-brand="${bName}" ${brandAllSelected ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--gold);" />
            <strong style="color:${accent};font-size:15px;">${bName}</strong>
            <span class="muted small">${models.length} model(s) • ${brandSelectedUnits} pcs selected${brandZeroCount ? ` • <span style="color:#ef4444;font-weight:700;">${brandZeroCount} out-of-stock</span>` : ''}</span>
          </div>
          <span class="muted small">${isOpen ? '▲ Hide' : '▼ Show'}</span>
        </div>
        ${isOpen ? `<div class="restock-models-grid">${modelsHtml}</div>` : ''}
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
      const parsed = parseInt(e.target.value, 10);
      const val = Number.isFinite(parsed) ? Math.max(0, parsed) : 1;
      if (state.restockPlan?.[idx]) {
        state.restockPlan[idx].qty = val;
        if (val === 0) state.restockPlan[idx].selected = false;
      }
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
        btn.textContent = err?.isAuthHandled ? 'Retry' : 'Err';
        if (!err?.isAuthHandled) alert(err.message);
      }
    });
  });
}

function computeOrderSummaryMetrics(items, orderStatus = 'Supplier Approved') {
  let requestedUnits = 0;
  let approvedUnits = 0;
  let deliveredUnits = 0;
  let pendingUnits = 0;
  let requestedTotal = 0;
  let approvedTotal = 0;
  let deliveredTotal = 0;
  const isPendingStatus = ['Sent to Supplier', 'Supplier Approved', 'At Warehouse (AB Web INITIAL)', 'Partially Received'].includes(orderStatus);

  for (const it of items || []) {
    const rq = Math.max(0, Number(it.requestedQty ?? it.qty) || 0);
    const rc = Math.max(0, Number(it.requestedCost ?? it.unitCost) || 0);
    const isApp = it.approved !== false && it.selected !== false && !it.isExtraItem;
    const aq = isApp ? Math.max(0, Number(it.qty) || 0) : 0;
    const ac = Math.max(0, Number(it.unitCost) || 0);
    const dq =
      it.receivedQty !== undefined && it.receivedQty !== null && it.receivedQty !== ''
        ? Math.max(0, Number(it.receivedQty) || 0)
        : 0;
    const dc = Math.max(0, Number(it.receivedCost ?? ac) || 0);

    requestedUnits += rq;
    requestedTotal += rq * rc;
    approvedUnits += aq;
    approvedTotal += aq * ac;
    deliveredUnits += dq;
    deliveredTotal += dq * dc;
    if (isPendingStatus && isApp) {
      pendingUnits += Math.max(0, aq - dq);
    }
  }
  return {
    requestedUnits,
    approvedUnits,
    deliveredUnits,
    pendingUnits,
    requestedTotal: Number(requestedTotal.toFixed(2)),
    approvedTotal: Number(approvedTotal.toFixed(2)),
    deliveredTotal: Number(deliveredTotal.toFixed(2)),
    qtyVariance: deliveredUnits - approvedUnits,
    costVariance: Number((deliveredTotal - approvedTotal).toFixed(2)),
  };
}

function getLocalSavedOrders() {
  try {
    const raw = localStorage.getItem('ab_purchase_orders_v1');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setLocalSavedOrders(orders) {
  try {
    localStorage.setItem('ab_purchase_orders_v1', JSON.stringify(orders || []));
  } catch {
    // ignore storage quota errors
  }
  schedulePhoneOrdersPush();
}

// Phone (GitHub Pages) -> PC: push phone-created orders to public/phone-orders.json so the PC portal imports them
let phonePushTimer = null;
function schedulePhoneOrdersPush() {
  if (!IS_STATIC_GH) return;
  clearTimeout(phonePushTimer);
  phonePushTimer = setTimeout(() => { pushPhoneOrdersToGh().catch(() => {}); }, 1500);
}

async function pushPhoneOrdersToGh() {
  const token = localStorage.getItem('bs_gh_pub_token');
  if (!token) return false;
  const seeded = state.ghSeededOrderIds || new Set();
  const phoneOrders = getLocalSavedOrders().filter((o) => {
    const id = String(o.id || '');
    return id.startsWith('PO-PH-') || (!id.startsWith('PO-AB-') && !seeded.has(id));
  });
  const payload = JSON.stringify({ updatedAt: new Date().toISOString(), orders: phoneOrders }, null, 1);
  const repo = 'ab-gadgetz/ab-gadgetz.github.io';
  const apiUrl = `https://api.github.com/repos/${repo}/contents/public/phone-orders.json`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  let sha;
  const getRes = await fetch(apiUrl, { headers });
  if (getRes.ok) sha = (await getRes.json()).sha;
  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Sync phone saved orders to PC portal',
      content: btoa(unescape(encodeURIComponent(payload))),
      ...(sha ? { sha } : {}),
    }),
  });
  return putRes.ok;
}

async function importPhoneOrdersIntoPc() {
  if (IS_STATIC_GH) return 0;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/ab-gadgetz/ab-gadgetz.github.io/main/public/phone-orders.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return 0;
    const j = await r.json();
    if (!Array.isArray(j?.orders) || !j.orders.length) return 0;
    const res = await api('/api/purchase-orders/import-phone', { method: 'POST', body: JSON.stringify({ orders: j.orders }) });
    return Number(res?.changed) || 0;
  } catch {
    return 0;
  }
}

function getDeletedLocalPoIds() {
  try {
    const raw = localStorage.getItem('ab_deleted_po_ids_v1');
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function markLocalPoDeleted(poId) {
  const s = getDeletedLocalPoIds();
  s.add(poId);
  try {
    localStorage.setItem('ab_deleted_po_ids_v1', JSON.stringify([...s]));
  } catch {}
}

async function loadAbDeliveries() {
  if (IS_STATIC_GH) {
    try {
      const b = await getGhBundle();
      state.abDeliveries = Array.isArray(b?.allDeliveries) ? b.allDeliveries : [];
    } catch {
      state.abDeliveries = [];
    }
    return state.abDeliveries;
  }
  try {
    const res = await api('/api/deliveries');
    state.abDeliveries = Array.isArray(res?.deliveries) ? res.deliveries : [];
  } catch {
    state.abDeliveries = [];
  }
  return state.abDeliveries;
}

async function loadSavedPurchaseOrders() {
  if (IS_STATIC_GH) {
    let local = getLocalSavedOrders();
    try {
      const b = await getGhBundle();
      const deleted = getDeletedLocalPoIds();
      const seeded = Array.isArray(b?.purchaseOrders) ? b.purchaseOrders : [];
      state.ghSeededOrderIds = new Set(seeded.map((s) => s.id));
      let added = false;
      if (Array.isArray(b?.purchaseOrders)) {
        const beforeLen = local.length;
        local = local.filter((o) => {
          const id = String(o.id || '');
          const isPhoneOrd = id.startsWith('PO-PH-') || /^PO-\d{8}-\d+$/.test(id);
          return isPhoneOrd || state.ghSeededOrderIds.has(id);
        });
        if (local.length !== beforeLen) added = true;
      }
      const byLocalId = new Map(local.map((o, idx) => [o.id, idx]));
      for (const s of seeded) {
        if (deleted.has(s.id)) continue;
        let parsedItems = [];
        try {
          parsedItems = typeof s.items_json === 'string' ? JSON.parse(s.items_json || '[]') : Array.isArray(s.items) ? s.items : [];
        } catch {
          parsedItems = [];
        }
        const seededObj = {
          id: s.id,
          title: s.title,
          status: s.status,
          supplierFilter: s.supplier_filter || s.supplierFilter || 'LOWEST',
          notes: s.notes || '',
          expectedDate: s.expected_date || s.expectedDate || '',
          abDeliveryRefs: s.ab_delivery_refs || s.abDeliveryRefs || '',
          items: parsedItems,
          createdAt: s.created_at || s.createdAt || new Date().toISOString(),
          updatedAt: s.updated_at || s.updatedAt || new Date().toISOString(),
        };
        if (!byLocalId.has(s.id)) {
          local.push(seededObj);
          added = true;
        } else {
          const idx = byLocalId.get(s.id);
          if (String(seededObj.updatedAt) > String(local[idx]?.updatedAt || '')) {
            local[idx] = seededObj;
            added = true;
          }
        }
      }
      if (added) setLocalSavedOrders(local);
      else if (local.some((o) => {
        const id = String(o.id || '');
        return id.startsWith('PO-PH-') || (!id.startsWith('PO-AB-') && !state.ghSeededOrderIds.has(id));
      })) {
        schedulePhoneOrdersPush();
      }
    } catch {}
    state.savedOrders = local
      .map((o) => ({ ...o, ...computeOrderSummaryMetrics(o.items, o.status) }))
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    return state.savedOrders;
  }
  try {
    await importPhoneOrdersIntoPc();
    const res = await api('/api/purchase-orders');
    state.savedOrders = Array.isArray(res?.orders) ? res.orders : [];
  } catch {
    state.savedOrders = getLocalSavedOrders();
  }
  return state.savedOrders;
}

function applyEditedPricesToLocalInventory(items) {
  if (!state.inventory?.items || !Array.isArray(items)) return;
  const localMap = IS_STATIC_GH ? getLocalSupplierCostsMap() : null;
  for (const it of items) {
    const useCost = Number(it.receivedCost) > 0 ? Number(it.receivedCost) : Number(it.unitCost) || 0;
    if (!it.productId || it.approved === false || !(useCost > 0)) continue;
    const prod = state.inventory.items.find((p) => p.id === it.productId);
    if (!prod) continue;
    const sup = String(it.supplier || '').toUpperCase();
    if (sup.includes('A&K')) prod.cost_ak = useCost;
    else if (sup.includes('ONLINE')) prod.cost_online = useCost;
    else prod.cost_ab = useCost;
    if (localMap) {
      localMap[prod.id] = {
        cost_ab: Number(prod.cost_ab) || 0,
        cost_ak: Number(prod.cost_ak) || 0,
        cost_online: Number(prod.cost_online) || 0,
      };
    }
  }
  if (localMap) {
    try {
      localStorage.setItem('ab_supplier_costs_v1', JSON.stringify(localMap));
    } catch {}
  }
}

function reconcileStaticOrdersWithDeliveries(onlyPoId = null) {
  const deliveries = (state.abDeliveries || [])
    .filter((d) => String(d.status || '').toUpperCase() !== 'CANCELLED')
    .slice()
    .sort((a, b) => String(a.deliveryDate || '').localeCompare(String(b.deliveryDate || '')) || (Number(a.id || a.portalDeliveryId) || 0) - (Number(b.id || b.portalDeliveryId) || 0));
  if (!deliveries.length) return 0;
  const orders = getLocalSavedOrders().slice().sort((a, b) => {
    const aAuto = String(a.id || '').startsWith('PO-AB-') ? 1 : 0;
    const bAuto = String(b.id || '').startsWith('PO-AB-') ? 1 : 0;
    return aAuto - bAuto || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
  const claimedLines = new Set();
  for (const o of orders) {
    if (o.status === 'Cancelled') continue;
    for (const it of o.items || []) {
      if (it.abDeliveryNo && it.abDeliveryNo !== 'PENDING IN AB WEB' && it.productId && it.branchId) {
        claimedLines.add(`${it.abDeliveryNo}::${it.branchId}::${it.productId}`);
      }
    }
  }
  let updatedOrders = 0;
  const now = new Date().toISOString();
  for (const po of orders) {
    if (onlyPoId && po.id !== onlyPoId) continue;
    if (!['Sent to Supplier', 'Supplier Approved', 'At Warehouse (AB Web INITIAL)', 'Partially Received', 'Received (Pending AB Web)'].includes(po.status)) continue;
    const isAutoPo = String(po.id || '').startsWith('PO-AB-');
    const autoDelivId = isAutoPo ? parseInt(String(po.id).replace('PO-AB-', ''), 10) : 0;
    const orderDate = String(po.createdAt || '').slice(0, 10);
    const refs = new Set(String(po.abDeliveryRefs || '').split(',').map((s) => s.trim()).filter(Boolean));
    let changed = false;
    for (const deliv of deliveries) {
      const delivIdNum = Number(deliv.id || deliv.portalDeliveryId) || 0;
      if (isAutoPo && delivIdNum !== autoDelivId) continue;
      if (!isAutoPo && orderDate && deliv.deliveryDate < orderDate && !refs.has(deliv.deliveryNo)) continue;
      const dStatus = String(deliv.status || '').toUpperCase();
      const isRecStatus = dStatus === 'RECEIVED';
      let matched = false;
      for (const dl of deliv.items || []) {
        if (!dl.productId) continue;
        const lineKey = `${deliv.deliveryNo}::${deliv.branchId}::${dl.productId}`;
        const target = (po.items || []).find(
          (it) =>
            it.approved !== false &&
            it.branchId === deliv.branchId &&
            it.productId === dl.productId &&
            (!it.abDeliveryNo || it.abDeliveryNo === 'PENDING IN AB WEB' || it.abDeliveryNo === deliv.deliveryNo)
        );
        if (!target) continue;
        if (claimedLines.has(lineKey) && target.abDeliveryNo !== deliv.deliveryNo) continue;
        matched = true;
        claimedLines.add(lineKey);
        if (
          target.abDeliveryNo !== deliv.deliveryNo ||
          target.abDeliveryStatus !== dStatus ||
          (isRecStatus && (target.receivedQty === undefined || target.receivedQty === null || target.receivedQty === ''))
        ) {
          target.abDeliveryNo = deliv.deliveryNo;
          target.abDeliveryStatus = dStatus;
          target.abDeliveryDate = deliv.deliveryDate;
          target.abDeliveredQty = Number(dl.deliveredQty) || 0;
          if (isRecStatus) {
            target.receivedDate = target.receivedDate || deliv.deliveryDate;
            if (target.receivedQty === undefined || target.receivedQty === null || target.receivedQty === '') {
              target.receivedQty = Number(dl.receivedQty ?? dl.deliveredQty) || 0;
            }
            if (target.receivedCost === undefined || target.receivedCost === null || target.receivedCost === '') {
              target.receivedCost = Number(target.unitCost) || 0;
            }
            target.abReportedQty = Number(dl.receivedQty ?? dl.deliveredQty) || 0;
          }
          changed = true;
        }
      }
      if (matched && !refs.has(deliv.deliveryNo)) {
        refs.add(deliv.deliveryNo);
        changed = true;
      }
    }
    if (changed) {
      po.abDeliveryRefs = [...refs].join(', ');
      po.updatedAt = now;
      const appItems = (po.items || []).filter((it) => it.approved !== false && (Number(it.qty) || 0) > 0);
      const anyRec = (po.items || []).some((it) => Number(it.receivedQty) > 0 || (it.receivedQty !== undefined && it.receivedQty !== null && it.receivedQty !== ''));
      const allDone = appItems.length > 0 && appItems.every((it) => it.receivedQty !== undefined && it.receivedQty !== null && it.receivedQty !== '');
      const anyWarehouse = (po.items || []).some((it) => String(it.abDeliveryStatus || '').toUpperCase() !== 'RECEIVED' && it.abDeliveryNo);
      const hasMissingAb = (po.items || []).some((it) => Number(it.receivedQty) > 0 && (!it.abDeliveryNo || it.abDeliveryNo === 'PENDING IN AB WEB'));
      if (allDone) po.status = hasMissingAb ? 'Received (Pending AB Web)' : 'Received';
      else if (anyRec) po.status = 'Partially Received';
      else if (anyWarehouse) po.status = 'At Warehouse (AB Web INITIAL)';
      updatedOrders++;
    }
  }

  // Auto-create PO-AB-<id> records for active unrecorded AB Web deliveries (non-RECEIVED warehouse deliveries, or new RECEIVED >= 2026-11-24)
  if (!onlyPoId) {
    const existingIds = new Set(orders.map((o) => o.id));
    const deletedIds = getDeletedLocalPoIds();
    const invItems = state.inventory?.items || [];
    const prodById = new Map(invItems.map((p) => [p.id, p]));
    const brNames = { 'br-molave': 'Molave', 'br-tambulig': 'Tambulig', 'br-bonifacio': 'Bonifacio' };
    for (const deliv of deliveries) {
      const delivId = Number(deliv.id || deliv.portalDeliveryId) || 0;
      if (!delivId) continue;
      const autoId = `PO-AB-${delivId}`;
      if (deletedIds.has(autoId)) continue;
      const existingOrd = orders.find((o) => o.id === autoId);
      const existingProdIds = new Set((existingOrd?.items || []).map((it) => it.productId));
      const dStatus = String(deliv.status || '').toUpperCase();
      const isRec = dStatus === 'RECEIVED';
      const isPendingWarehouse = !isRec && dStatus !== 'CANCELLED' && (Number(deliv.totalDeliveredQty) || 0) > 0;
      const isNewReceived = isRec && String(deliv.deliveryDate || '') >= '2026-11-24';
      if (!isPendingWarehouse && !isNewReceived) continue;

      const itemsOut = [];
      for (const dl of deliv.items || []) {
        if (!dl.productId || existingProdIds.has(dl.productId)) continue;
        if (/FREE/i.test(String(dl.code || '')) || /FREE\s*BUNDLE/i.test(String(dl.productName || ''))) continue;
        const qty = Math.max(0, Number(dl.deliveredQty) || 0);
        if (qty <= 0) continue;
        const lineKey = `${deliv.deliveryNo}::${deliv.branchId}::${dl.productId}`;
        if (claimedLines.has(lineKey)) continue;

        const p = prodById.get(dl.productId);
        const unitCost =
          Number(p?.cost_ab) ||
          Number(p?.cost_ak) ||
          Number(p?.cost_online) ||
          Number(p?.cost_price) ||
          (Number(p?.base_price) > 0 ? Math.round(Number(p.base_price) * 0.85) : 0);
        const srp = Number(p?.base_price) || Number(dl.unitSrp) || 0;
        const tierKey = srp > 0 && srp <= 10000 ? 'LOW_END' : srp <= 20000 ? 'MID_RANGE' : 'HIGH_END';
        const tierLabel = tierKey === 'LOW_END' ? 'Low-End' : tierKey === 'MID_RANGE' ? 'Mid-Range' : 'High-End';
        const brand = p?.brand || '';
        const model = p?.model || dl.productName || '';
        const displayModel = brand && !String(model).toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${model}` : model;
        const recQty = isRec ? Number(dl.receivedQty ?? qty) || 0 : null;
        itemsOut.push({
          key: `${dl.productId}::${deliv.branchId}`,
          productId: dl.productId,
          brand,
          model,
          displayModel,
          sku: dl.code || p?.sku || '',
          branchId: deliv.branchId,
          branchName: brNames[deliv.branchId] || deliv.branchId,
          supplier: p?.supplier && p.supplier !== 'Portal Auto-Import' ? p.supplier : 'AB Main Supplier',
          tierKey,
          tierLabel,
          avail: 0,
          branchDemand90: 0,
          storewideDemand90: 0,
          requestedQty: qty,
          qty,
          requestedCost: unitCost,
          unitCost,
          approved: true,
          receivedQty: recQty,
          receivedCost: unitCost,
          receivedDate: isRec ? deliv.deliveryDate : '',
          abDeliveryNo: deliv.deliveryNo,
          abDeliveryStatus: dStatus,
          abDeliveryDate: deliv.deliveryDate,
          abDeliveredQty: qty,
          abReportedQty: isRec ? Number(dl.receivedQty ?? qty) || 0 : null,
          isExtraItem: false,
        });
        claimedLines.add(lineKey);
      }
      if (!itemsOut.length) continue;
      const poStatus = isRec ? 'Received' : 'At Warehouse (AB Web INITIAL)';
      if (existingOrd) {
        existingOrd.items = [...(existingOrd.items || []), ...itemsOut];
        existingOrd.abDeliveryRefs = deliv.deliveryNo;
        Object.assign(existingOrd, computeOrderSummaryMetrics(existingOrd.items, existingOrd.status));
        existingOrd.updatedAt = now;
        updatedOrders++;
        continue;
      }
      orders.unshift({
        id: autoId,
        title: `AB Web Delivery • ${deliv.deliveryNo} (${brNames[deliv.branchId] || deliv.branchId})`,
        status: poStatus,
        supplierFilter: 'AUTO_AB_WEB',
        notes: `Auto-synced from AB Web delivery ${deliv.deliveryNo} (${dStatus}) — adjusts Restock automatically.`,
        expectedDate: '',
        abDeliveryRefs: deliv.deliveryNo,
        items: itemsOut,
        ...computeOrderSummaryMetrics(itemsOut, poStatus),
        createdAt: `${deliv.deliveryDate}T08:00:00.000Z`,
        updatedAt: now,
      });
      existingIds.add(autoId);
      updatedOrders++;
    }
  }

  if (updatedOrders > 0) setLocalSavedOrders(orders);
  return updatedOrders;
}

function renderSavedOrdersPanel() {
  const listEl = document.getElementById('savedOrdersList');
  const badgeEl = document.getElementById('savedOrdersCountBadge');
  const pendBadgeEl = document.getElementById('pendingUnitsBadge');
  const hdrEl = document.getElementById('savedOrdersSummaryHdr');
  const orders = state.savedOrders || [];

  const pendingOrders = orders.filter((o) => ['Sent to Supplier', 'Supplier Approved', 'At Warehouse (AB Web INITIAL)', 'Partially Received'].includes(o.status));
  const totalPendingUnits = pendingOrders.reduce((s, o) => s + (computeOrderSummaryMetrics(o.items, o.status).pendingUnits || 0), 0);
  const totalPendingCost = orders.reduce((s, o) => {
    if (!['Sent to Supplier', 'Supplier Approved', 'At Warehouse (AB Web INITIAL)', 'Partially Received'].includes(o.status)) return s;
    for (const it of o.items || []) {
      if (it.approved === false || it.isExtraItem) continue;
      const app = Math.max(0, Number(it.qty) || 0);
      const rec = it.receivedQty !== undefined && it.receivedQty !== null && it.receivedQty !== '' ? Math.max(0, Number(it.receivedQty) || 0) : 0;
      const rem = Math.max(0, app - rec);
      s += rem * (Number(it.unitCost) || 0);
    }
    return s;
  }, 0);

  if (badgeEl) {
    badgeEl.textContent = `${orders.length} order${orders.length === 1 ? '' : 's'}`;
    badgeEl.className = `badge ${orders.length ? 'badge-ok' : 'badge-warn'}`;
  }
  if (pendBadgeEl) {
    if (totalPendingUnits > 0) {
      pendBadgeEl.textContent = `${fmtNum(totalPendingUnits)} pcs waiting delivery`;
      pendBadgeEl.classList.remove('hidden');
    } else {
      pendBadgeEl.classList.add('hidden');
    }
  }
  if (hdrEl) {
    if (!orders.length) {
      hdrEl.textContent = 'Log pending orders, edit supplier approvals & reconcile deliveries';
    } else {
      hdrEl.innerHTML = `${pendingOrders.length} finalized pending (<strong style="color:#60a5fa;">${fmtNum(totalPendingUnits)} pcs / ${fmtCurrency(totalPendingCost)}</strong> on order) • Considers Restock automatically`;
    }
  }

  renderOrderVarianceReport();
  renderAbDeliveriesView();

  if (!listEl) return;

  if (!orders.length) {
    listEl.innerHTML = '<div class="muted small" style="padding:6px 0;">No orders logged yet. Click <strong>+ LOG PENDING ORDER</strong>, <strong>PASTE EXCEL / TEXT</strong>, or build a Restock plan &amp; click <strong>SAVE PLAN</strong>.</div>';
    renderSavedOrderInlineEditor();
    return;
  }

  const statusColor = (st) => {
    if (st === 'Received' || st === 'Supplier Approved') return 'badge-ok';
    if (st === 'Cancelled') return 'badge-danger';
    return 'badge-warn';
  };

  listEl.innerHTML = orders
    .map((o) => {
      const m = computeOrderSummaryMetrics(o.items, o.status);
      const qtyDiff = m.approvedUnits - m.requestedUnits;
      const costDiff = m.approvedTotal - m.requestedTotal;
      const hasAdj = qtyDiff !== 0 || Math.abs(costDiff) >= 0.01;
      const diffText = hasAdj
        ? `<span style="color:${costDiff <= 0 ? 'var(--green)' : '#f59e0b'};font-weight:700;">(${qtyDiff >= 0 ? '+' : ''}${qtyDiff} pcs • ${costDiff >= 0 ? '+' : ''}${fmtCurrency(costDiff)})</span>`
        : '';
      const delivPart =
        m.deliveredUnits > 0 || o.status === 'Received' || o.status === 'Received (Pending AB Web)' || o.status === 'Partially Received'
          ? ` → Delivered: <strong style="color:${m.qtyVariance === 0 ? 'var(--green)' : '#f59e0b'};">${fmtNum(m.deliveredUnits)} pcs</strong> (${fmtCurrency(m.deliveredTotal)}${m.qtyVariance !== 0 ? `, Var ${m.qtyVariance >= 0 ? '+' : ''}${m.qtyVariance} pcs` : ''})`
          : '';
      const warehouseUnits = (o.items || [])
        .filter((it) => String(it.abDeliveryStatus || 'RECEIVED').toUpperCase() !== 'RECEIVED' && it.abDeliveryNo && it.abDeliveryNo !== 'PENDING IN AB WEB' && (it.receivedQty === null || it.receivedQty === undefined || it.receivedQty === ''))
        .reduce((s, it) => s + (Number(it.abDeliveredQty ?? it.qty) || 0), 0);
      const missingAbCount = (o.items || []).filter(
        (it) => Number(it.receivedQty) > 0 && (!it.abDeliveryNo || it.abDeliveryNo === 'PENDING IN AB WEB')
      ).length;
      const missingFromPartialAb =
        o.status !== 'Draft' && o.status !== 'Cancelled' && Boolean(o.abDeliveryRefs)
          ? (o.items || []).filter((it) => it.approved !== false && !it.isExtraItem && (Number(it.qty) || 0) > 0 && !it.abDeliveryNo).length
          : 0;
      const pendTag =
        o.status === 'Draft'
          ? `<span class="badge badge-warn" style="font-size:10px;">Not Yet Finalized</span>`
          : m.pendingUnits > 0
            ? `<span class="badge badge-warn" style="font-size:10px;">⏳ ${fmtNum(m.pendingUnits)} pcs pending delivery</span>`
            : '';
      const warehouseTag =
        warehouseUnits > 0
          ? `<span class="badge badge-warn" style="font-size:10px;background:rgba(96,165,250,0.18);color:#93c5fd;border-color:rgba(96,165,250,0.4);">🚚 ${fmtNum(warehouseUnits)} pcs @ Warehouse (For Pick-Up)</span>`
          : '';
      const abMissTag =
        missingFromPartialAb > 0
          ? `<span class="badge badge-danger" style="font-size:10px;">⚠ ${missingFromPartialAb} item(s) missing in AB Web deliveries</span>`
          : missingAbCount > 0
            ? `<span class="badge badge-danger" style="font-size:10px;">${missingAbCount} line(s) not yet in AB Web</span>`
            : o.abDeliveryRefs
              ? `<span class="badge badge-ok" style="font-size:10px;">AB: ${o.abDeliveryRefs}</span>`
              : '';
      const dtLabel = String(o.createdAt || o.updatedAt || '').slice(0, 10);
      return `
        <div class="po-order-card">
          <div class="po-order-info">
            <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
              <strong style="color:var(--gold-bright);font-size:13px;">${o.id}</strong>
              <strong style="font-size:13px;">${o.title}</strong>
              <span class="badge ${statusColor(o.status)}" style="font-size:10px;">${o.status}</span>
              ${pendTag}
              ${warehouseTag}
              ${abMissTag}
            </div>
            <div class="small muted" style="margin-top:4px;line-height:1.4;">
              Order Date: <strong>${dtLabel}</strong> • Approved: <strong style="color:var(--text);">${fmtNum(m.approvedUnits)} pcs</strong> (<strong style="color:var(--gold-bright);">${fmtCurrency(m.approvedTotal)}</strong>)
              ${diffText}
              ${delivPart}
            </div>
            ${o.notes ? `<div class="small muted" style="margin-top:3px;">Note: ${o.notes}</div>` : ''}
          </div>
          <div class="po-order-actions">
            <button type="button" class="saved-po-edit-btn" data-poid="${o.id}">${o.status === 'Draft' ? 'EDIT / FINALIZE' : 'EDIT / RECORD DELIVERY'}</button>
            <button type="button" class="secondary saved-po-preview-btn" data-poid="${o.id}">${o.status === 'Draft' ? 'PREVIEW / FINALIZE' : 'PREVIEW'}</button>
            <button type="button" class="secondary saved-po-copy-btn" data-poid="${o.id}">COPY</button>
            <button type="button" class="secondary saved-po-pdf-btn" data-poid="${o.id}">PDF</button>
            <button type="button" class="secondary saved-po-del-btn" data-poid="${o.id}" style="color:var(--danger);">✕</button>
          </div>
        </div>`;
    })
    .join('');

  listEl.querySelectorAll('.saved-po-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ord = (state.savedOrders || []).find((o) => o.id === btn.dataset.poid);
      if (!ord) return;
      openSavedOrderInlineEditor(ord);
    });
  });

  listEl.querySelectorAll('.saved-po-preview-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ord = (state.savedOrders || []).find((o) => o.id === btn.dataset.poid);
      if (!ord) return;
      state.previewOrderOverride = ord;
      renderReorderPreviewModal();
      document.getElementById('reorderPreviewModal')?.classList.remove('hidden');
    });
  });

  listEl.querySelectorAll('.saved-po-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ord = (state.savedOrders || []).find((o) => o.id === btn.dataset.poid);
      if (!ord) return;
      const text = buildReorderCopyText(ord);
      const ok = await copyTextToClipboard(text);
      btn.textContent = ok ? 'COPIED ✓' : 'ERR';
      setTimeout(() => { btn.textContent = 'COPY'; }, 1400);
    });
  });

  listEl.querySelectorAll('.saved-po-pdf-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ord = (state.savedOrders || []).find((o) => o.id === btn.dataset.poid);
      if (!ord) return;
      downloadReorderPlanPdf(ord);
    });
  });

  listEl.querySelectorAll('.saved-po-del-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const poId = btn.dataset.poid;
      if (!confirm(`Delete saved order ${poId}?`)) return;
      if (IS_STATIC_GH) {
        markLocalPoDeleted(poId);
        const next = getLocalSavedOrders().filter((o) => o.id !== poId);
        setLocalSavedOrders(next);
        state.savedOrders = next.map((o) => ({ ...o, ...computeOrderSummaryMetrics(o.items, o.status) }));
      } else {
        await api(`/api/purchase-orders/${encodeURIComponent(poId)}`, { method: 'DELETE' });
        await loadSavedPurchaseOrders();
      }
      if (state.editingSavedOrder?.id === poId) {
        state.editingSavedOrder = null;
        renderSavedOrderInlineEditor();
      }
      if (state.previewOrderOverride?.id === poId) state.previewOrderOverride = null;
      renderSavedOrdersPanel();
      buildRestockDraftPlan();
      renderRestockCards();
    });
  });

  // Don't interrupt user typing inside the inline editor
  const wrap = document.getElementById('savedOrderInlineEditor');
  const activeInside = wrap && document.activeElement && wrap.contains(document.activeElement);
  if (!activeInside) renderSavedOrderInlineEditor();
}

function openSavedOrderInlineEditor(order) {
  state.editingSavedOrder = JSON.parse(JSON.stringify(order));
  const body = document.getElementById('savedOrdersBody');
  const caret = document.getElementById('savedOrdersCaret');
  if (body) body.classList.remove('hidden');
  if (caret) caret.textContent = '−';
  renderSavedOrderInlineEditor();
  document.getElementById('savedOrderInlineEditor')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openNewPendingOrderCreator() {
  const now = new Date().toISOString();
  const dayTag = now.slice(0, 10).replace(/-/g, '');
  const existingCnt = (state.savedOrders || []).filter((o) => String(o.id || '').startsWith(`PO-${dayTag}-`)).length;
  const id = `PO-${dayTag}-${String(existingCnt + 1).padStart(2, '0')}`;
  state.editingSavedOrder = {
    id,
    _isNew: true,
    title: `AB Main Supplier Order (${todayStr})`,
    status: 'Supplier Approved',
    supplierFilter: 'AB',
    notes: 'Pending delivery',
    expectedDate: '',
    abDeliveryRefs: '',
    createdAt: now,
    updatedAt: now,
    items: [],
  };
  const body = document.getElementById('savedOrdersBody');
  const caret = document.getElementById('savedOrdersCaret');
  if (body) body.classList.remove('hidden');
  if (caret) caret.textContent = '−';
  renderSavedOrderInlineEditor('Add products below, then click SAVE ORDER CHANGES');
}

function matchProductByFreeText(rawName) {
  const items = state.inventory?.items || [];
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/\bplus\b/g, '+')
      .replace(/\bgalaxy\b/g, '')
      .replace(/\b4g\b/g, '')
      .replace(/gb\b/g, '')
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9+]/g, '');
  const tgt = norm(rawName);
  if (!tgt) return null;

  const activePhones = items.filter((p) => (p.lifecycle_status || 'Active') === 'Active' && !isNonOrderablePromoOrRepo(p));
  const pool = [...activePhones, ...items.filter((p) => !isNonOrderablePromoOrRepo(p))];

  // 1. Exact normalized match
  for (const p of pool) {
    if (norm(p.name) === tgt || norm(`${p.brand || ''} ${p.model || ''}`) === tgt || norm(p.model) === tgt) return p;
  }
  // 2. Spec-preserving includes match (e.g. 4128 vs 464)
  for (const p of pool) {
    const k1 = norm(p.name);
    const k2 = norm(`${p.brand || ''} ${p.model || ''}`);
    if ((k1.includes(tgt) || tgt.includes(k1)) && tgt.length >= 5) return p;
    if ((k2.includes(tgt) || tgt.includes(k2)) && tgt.length >= 5) return p;
  }
  // 3. Token overlap scoring
  const tokens = String(rawName || '')
    .toLowerCase()
    .replace(/\bgb\b/g, '')
    .split(/[^a-z0-9+]+/)
    .filter(Boolean);
  let best = null;
  let bestScore = 0;
  for (const p of activePhones) {
    const pStr = `${p.brand || ''} ${p.name || ''} ${p.model || ''}`.toLowerCase();
    let score = 0;
    for (const tk of tokens) {
      if (pStr.includes(tk)) score += tk.includes('/') || /^\d+$/.test(tk) ? 3 : 2;
    }
    if (score > bestScore && score >= Math.max(4, tokens.length * 1.5)) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

async function parseAndCreatePastedOrder() {
  const txt = (document.getElementById('pasteOrderText')?.value || '').trim();
  const titleInp = (document.getElementById('pasteOrderTitleInp')?.value || '').trim();
  const defaultBrId = document.getElementById('pasteOrderBranchSel')?.value || 'br-molave';
  const supplier = document.getElementById('pasteOrderSupplierSel')?.value || 'AB Main Supplier';
  const stEl = document.getElementById('pasteOrderStatus');
  if (!txt) {
    if (stEl) stEl.textContent = 'Paste at least one order line first.';
    return;
  }

  const branchNames = { 'br-molave': 'Molave', 'br-tambulig': 'Tambulig', 'br-bonifacio': 'Bonifacio' };
  let curBranchId = defaultBrId;
  const parsedItems = [];
  const unmatchedLines = [];
  let detectedDate = '';

  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const up = line.toUpperCase();

    const dtMatch = line.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})|(\d{4}-\d{2}-\d{2})/);
    if (dtMatch) {
      detectedDate = dtMatch[4]
        ? dtMatch[4]
        : `${dtMatch[3]}-${String(dtMatch[1]).padStart(2, '0')}-${String(dtMatch[2]).padStart(2, '0')}`;
    }
    if (up.includes('MOLAVE') && (up.includes('ORDER') || up.includes('BRANCH') || up.length <= 24)) {
      curBranchId = 'br-molave';
      continue;
    }
    if (up.includes('TAMBULIG') && (up.includes('ORDER') || up.includes('BRANCH') || up.length <= 24)) {
      curBranchId = 'br-tambulig';
      continue;
    }
    if (up.includes('BONIFACIO') && (up.includes('ORDER') || up.includes('BRANCH') || up.length <= 24)) {
      curBranchId = 'br-bonifacio';
      continue;
    }
    if (up.startsWith('TOTAL')) continue;

    // Try tab-separated or whitespace-separated: Model | Qty | [Price] | [Total]
    let modelPart = '';
    let qty = 1;
    let price = 0;

    if (line.includes('\t')) {
      const cols = line.split('\t').map((c) => c.trim()).filter(Boolean);
      modelPart = cols[0] || '';
      const nums = cols.slice(1).map((c) => parseMoneyInput(c)).filter((n) => n > 0);
      if (nums.length >= 1) qty = Math.max(1, Math.round(nums[0]));
      if (nums.length >= 2) price = nums[1];
    } else {
      const m = line.match(/^(.*?)\s+(\d{1,3})(?:\s+([\d,]+(?:\.\d+)?))?(?:\s+([\d,]+(?:\.\d+)?))?$/);
      if (m) {
        modelPart = m[1].trim();
        qty = Math.max(1, parseInt(m[2], 10) || 1);
        price = m[3] ? parseMoneyInput(m[3]) : 0;
      } else {
        modelPart = line;
      }
    }

    const prod = matchProductByFreeText(modelPart);
    if (!prod) {
      unmatchedLines.push(modelPart);
      continue;
    }
    if (!(price > 0)) {
      const sup = resolveSupplierForProduct(prod, supplier.includes('A&K') ? 'AK' : supplier.includes('Online') ? 'ONLINE' : 'AB') ||
        resolveSupplierForProduct(prod, 'LOWEST');
      price = Number(sup?.unitCost) > 0 ? sup.unitCost : Math.round((Number(prod.base_price) || 0) * 0.85);
    }
    const tier = getCellphonePriceTier(prod);
    parsedItems.push({
      key: `${prod.id}::${curBranchId}`,
      productId: prod.id,
      brand: prod.brand || '',
      model: prod.model || prod.name,
      displayModel: formatSwapModelName({ brand: prod.brand || '', model: prod.model || prod.name }),
      sku: prod.website_codes || prod.sku || '',
      branchId: curBranchId,
      branchName: branchNames[curBranchId] || curBranchId,
      supplier,
      tierKey: tier.key,
      tierLabel: tier.label,
      avail: Number(prod.byBranch?.[curBranchId]?.qtyAvailable) || 0,
      branchDemand90: 0,
      storewideDemand90: 0,
      requestedQty: qty,
      qty,
      requestedCost: price,
      unitCost: price,
      approved: true,
      receivedQty: null,
      receivedCost: price,
      receivedDate: '',
      abDeliveryNo: '',
      abReportedQty: null,
      isExtraItem: false,
    });
  }

  if (!parsedItems.length) {
    if (stEl) {
      stEl.style.color = 'var(--danger)';
      stEl.textContent = `Could not match any product rows${unmatchedLines.length ? ` (Unmatched: ${unmatchedLines.join(', ')})` : ''}.`;
    }
    return;
  }

  const now = new Date().toISOString();
  const createdAt = detectedDate ? `${detectedDate}T10:00:00.000Z` : now;
  const orderDateTag = (detectedDate || todayStr).replace(/-/g, '');
  const seq = String((state.savedOrders || []).filter((o) => String(o.id || '').startsWith(`PO-${orderDateTag}`)).length + 1).padStart(2, '0');
  const title = titleInp || `${supplier} Order (${detectedDate || todayStr})`;

  let createdOrder = null;
  if (IS_STATIC_GH) {
    const id = `PO-${orderDateTag}-${seq}`;
    createdOrder = {
      id,
      title,
      status: 'Supplier Approved',
      supplierFilter: supplier,
      notes: unmatchedLines.length ? `Unmatched lines skipped: ${unmatchedLines.join(', ')}` : '',
      expectedDate: '',
      abDeliveryRefs: '',
      items: parsedItems,
      ...computeOrderSummaryMetrics(parsedItems, 'Supplier Approved'),
      createdAt,
      updatedAt: now,
    };
    const all = getLocalSavedOrders();
    all.unshift(createdOrder);
    setLocalSavedOrders(all);
    state.savedOrders = all;
  } else {
    const res = await api('/api/purchase-orders', {
      method: 'POST',
      body: JSON.stringify({
        title,
        status: 'Supplier Approved',
        supplierFilter: supplier,
        notes: unmatchedLines.length ? `Unmatched lines skipped: ${unmatchedLines.join(', ')}` : '',
        items: parsedItems,
        createdAt,
        syncSupplierCosts: true,
      }),
    });
    createdOrder = res?.order || null;
    await loadSavedPurchaseOrders();
  }

  applyEditedPricesToLocalInventory(parsedItems);
  document.getElementById('pasteOrderBox')?.classList.add('hidden');
  document.getElementById('pasteOrderText').value = '';
  if (createdOrder) openSavedOrderInlineEditor(createdOrder);
  renderSavedOrdersPanel();
  buildRestockDraftPlan();
  renderRestockCards();
  if (stEl) {
    stEl.style.color = 'var(--green)';
    stEl.textContent = `Imported ${parsedItems.length} item(s)${unmatchedLines.length ? ` (skipped: ${unmatchedLines.join(', ')})` : ''}!`;
  }
}

function renderSavedOrderInlineEditor(statusMsg = '') {
  const wrap = document.getElementById('savedOrderInlineEditor');
  if (!wrap) return;
  const po = state.editingSavedOrder;
  if (!po) {
    wrap.classList.add('hidden');
    wrap.innerHTML = '';
    return;
  }

  wrap.classList.remove('hidden');
  const m = computeOrderSummaryMetrics(po.items, po.status);
  const qtyVar = m.approvedUnits - m.requestedUnits;
  const costVar = m.approvedTotal - m.requestedTotal;
  const activeProds = (state.inventory?.items || [])
    .filter((i) => (i.lifecycle_status || 'Active') === 'Active' && !isNonOrderablePromoOrRepo(i))
    .sort((a, b) => formatSwapModelName({ brand: a.brand || '', model: a.model || a.name }).localeCompare(formatSwapModelName({ brand: b.brand || '', model: b.model || b.name })));

  const indexed = (po.items || []).map((r, idx) => ({ ...r, _idx: idx }));
  const bySup = new Map();
  for (const sup of SUPPLIER_ORDER) bySup.set(sup, new Map());
  for (const r of indexed) {
    const supName = r.supplier || 'AB Main Supplier';
    if (!bySup.has(supName)) bySup.set(supName, new Map());
    const bMap = bySup.get(supName);
    const brName = r.branchName || 'Molave';
    if (!bMap.has(brName)) bMap.set(brName, []);
    bMap.get(brName).push(r);
  }

  const orderDate = String(po.createdAt || todayStr).slice(0, 10);
  const recentDeliveries = (state.abDeliveries || []).filter((d) => d.deliveryDate >= orderDate || d.status !== 'RECEIVED');

  const groupsHtml = [...bySup.entries()]
    .filter(([, bMap]) => bMap.size > 0)
    .map(([supName, bMap]) => {
      const sortedBranches = [...bMap.keys()].sort((a, b) => {
        const ia = BRANCH_ORDER.indexOf(a);
        const ib = BRANCH_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
      });
      return `
        <div style="margin-bottom:10px;">
          <div style="padding:5px 9px;border-radius:6px;background:rgba(231,197,95,0.14);color:var(--gold-bright);font-weight:700;font-size:12px;">${supName}</div>
          ${sortedBranches
            .map((bName) => {
              const rows = bMap.get(bName);
              return `
                <div style="margin-top:6px;padding:0 4px;">
                  <div style="font-weight:700;font-size:11.5px;color:var(--muted);margin-bottom:4px;">${bName}</div>
                  ${rows
                    .map((r) => {
                      const isExtra = Boolean(r.isExtraItem);
                      const isApp = r.approved !== false && !isExtra;
                      const curQty = isExtra ? 0 : Number(r.qty) || 0;
                      const curCost = Number(r.unitCost) || 0;
                      const recQtyRaw = r.receivedQty !== undefined && r.receivedQty !== null && r.receivedQty !== '' ? Number(r.receivedQty) : '';
                      const recCostRaw = r.receivedCost !== undefined && r.receivedCost !== null && r.receivedCost !== '' ? Number(r.receivedCost) : curCost;
                      const delivQtyNum = recQtyRaw === '' ? 0 : Math.max(0, Number(recQtyRaw) || 0);
                      const hasRec = recQtyRaw !== '';
                      const abStatusU = String(r.abDeliveryStatus || 'RECEIVED').toUpperCase();
                      const isWhInit = !hasRec && r.abDeliveryNo && r.abDeliveryNo !== 'PENDING IN AB WEB' && abStatusU !== 'RECEIVED';
                      const qVar = hasRec ? delivQtyNum - (isApp ? curQty : 0) : 0;
                      const cVar = hasRec ? recCostRaw - curCost : 0;
                      const varTag = hasRec
                        ? qVar === 0 && Math.abs(cVar) < 0.01
                          ? `<span style="color:var(--green);font-weight:700;font-size:10.5px;">✓ Match</span>`
                          : `<span style="color:${qVar < 0 || cVar > 0 ? '#ef4444' : '#f59e0b'};font-weight:700;font-size:10.5px;">${qVar !== 0 ? `${qVar > 0 ? '+' : ''}${qVar} pcs` : ''}${Math.abs(cVar) >= 0.01 ? ` ${cVar > 0 ? '+' : ''}${fmtCurrency(cVar)}/pc` : ''}</span>`
                        : isWhInit
                          ? `<span style="color:#60a5fa;font-weight:700;font-size:10.5px;">🚚 @ Warehouse (${Number(r.abDeliveredQty ?? curQty)} pcs)</span>`
                          : `<span class="muted" style="font-size:10px;">pending delivery</span>`;
                      const abTag = hasRec
                        ? r.abDeliveryNo && r.abDeliveryNo !== 'PENDING IN AB WEB'
                          ? `<span class="badge badge-ok" style="font-size:9.5px;">${r.abDeliveryNo}</span>`
                          : `<span class="badge badge-danger" style="font-size:9.5px;">Not in AB Web</span>`
                        : isWhInit
                          ? `<span class="badge badge-warn" style="font-size:9.5px;background:rgba(96,165,250,0.18);color:#93c5fd;">${r.abDeliveryNo} (${abStatusU})</span>`
                          : '';
                      return `
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:12px;${isApp || isExtra ? '' : 'opacity:0.48;'}">
                          <label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer;flex:1;min-width:190px;flex-wrap:wrap;">
                            <input type="checkbox" class="main-po-chk" data-idx="${r._idx}" ${r.approved !== false ? 'checked' : ''} style="width:15px;height:15px;margin:0;accent-color:var(--gold);" title="Supplier approved" />
                            <span style="${r.approved !== false ? '' : 'text-decoration:line-through;'}font-weight:600;">${r.displayModel || r.model}</span>
                            ${isExtra ? '<span class="badge badge-warn" style="font-size:9.5px;">EXTRA / SUB</span>' : ''}
                            ${varTag}
                            ${abTag}
                          </label>
                          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;justify-content:flex-end;">
                            <span class="small muted" title="Approved Supplier Unit Price">Appr ₱</span>
                            <input type="number" class="main-po-price" data-idx="${r._idx}" value="${curCost}" min="0" step="0.01" style="width:76px;padding:3px 5px;font-size:11.5px;text-align:right;" title="Approved supplier price" />
                            <span class="small muted">×</span>
                            <input type="number" class="main-po-qty" data-idx="${r._idx}" value="${curQty}" min="0" max="999" style="width:46px;padding:3px 4px;font-size:11.5px;text-align:center;" title="Approved qty" />
                            <span class="small muted" style="margin-left:4px;color:#60a5fa;">Rec:</span>
                            <input type="number" class="main-po-rec-qty" data-idx="${r._idx}" value="${recQtyRaw}" placeholder="—" min="0" max="999" style="width:48px;padding:3px 4px;font-size:11.5px;text-align:center;border-color:#3b82f6;" title="Actually Delivered / Reported Qty (leave blank if still waiting)" />
                            <span class="small muted" title="Billed Price Upon Delivery">Billed ₱</span>
                            <input type="number" class="main-po-rec-cost" data-idx="${r._idx}" value="${recCostRaw}" min="0" step="0.01" style="width:74px;padding:3px 5px;font-size:11.5px;text-align:right;border-color:#3b82f6;" title="Billed unit price on delivery receipt" />
                            <input type="text" class="main-po-ab-ref" data-idx="${r._idx}" value="${String(r.abDeliveryNo || '').replace(/"/g, '&quot;')}" placeholder="AB Web Ref / Pending" style="width:118px;padding:3px 5px;font-size:11px;" title="AB Web Delivery # (leave blank if still not recorded in AB Web)" />
                            <button type="button" class="secondary main-po-del-line" data-idx="${r._idx}" style="padding:2px 6px;font-size:10.5px;min-height:0;color:var(--danger);" title="Remove line">✕</button>
                          </div>
                        </div>`;
                    })
                    .join('')}
                </div>`;
            })
            .join('')}
        </div>`;
    })
    .join('');

  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
      <div>
        <strong style="color:var(--gold-bright);font-size:13.5px;">${po._isNew ? `NEW PENDING ORDER (${po.id})` : `ORDER ${po.id}`} — SUPPLIER APPROVALS &amp; DELIVERY RECONCILIATION</strong>
        <div class="small muted">
          Approved: <strong style="color:var(--text);">${fmtNum(m.approvedUnits)} pcs</strong> (<strong style="color:var(--gold-bright);">${fmtCurrency(m.approvedTotal)}</strong>)
          • Pending Delivery: <strong style="color:#60a5fa;">${fmtNum(m.pendingUnits)} pcs</strong>
          • Delivered: <strong style="color:var(--green);">${fmtNum(m.deliveredUnits)} pcs</strong> (${fmtCurrency(m.deliveredTotal)})
          ${qtyVar !== 0 || Math.abs(costVar) >= 0.01 ? `<span class="muted">• Adj vs Req: ${qtyVar >= 0 ? '+' : ''}${qtyVar} pcs</span>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button type="button" id="mainPoFillDeliveredBtn" class="secondary" style="padding:5px 9px;font-size:11px;min-height:0;" title="Mark all lines as physically delivered equal to Approved Qty (tagged Not Yet in AB Web)">MARK ALL DELIVERED</button>
        <button type="button" id="mainPoMatchAbBtn" class="secondary" style="padding:5px 9px;font-size:11px;min-height:0;" title="Sync & match from AB Web /panel/deliveries">MATCH AB WEB (${recentDeliveries.length})</button>
        <button type="button" id="mainPoPreviewBtn" class="secondary" style="padding:5px 9px;font-size:11px;min-height:0;">PREVIEW</button>
        <button type="button" id="mainPoCopyBtn" class="secondary" style="padding:5px 9px;font-size:11px;min-height:0;">COPY</button>
        <button type="button" id="mainPoCloseBtn" class="secondary" style="padding:5px 9px;font-size:11px;min-height:0;">CLOSE</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1.5fr 1fr 0.8fr 1.4fr;gap:8px;margin-bottom:10px;">
      <div>
        <label for="mainPoTitleInp" style="font-size:10.5px;">ORDER NAME</label>
        <input type="text" id="mainPoTitleInp" value="${String(po.title || '').replace(/"/g, '&quot;')}" style="padding:5px 8px;font-size:12px;" />
      </div>
      <div>
        <label for="mainPoStatusSel" style="font-size:10.5px;">ORDER / DELIVERY STATUS</label>
        <select id="mainPoStatusSel" style="padding:5px 8px;font-size:12px;">
          ${['Draft', 'Sent to Supplier', 'Supplier Approved', 'At Warehouse (AB Web INITIAL)', 'Partially Received', 'Received (Pending AB Web)', 'Received', 'Cancelled']
            .map((st) => `<option value="${st}" ${po.status === st ? 'selected' : ''}>${st}</option>`)
            .join('')}
        </select>
      </div>
      <div>
        <label for="mainPoDateInp" style="font-size:10.5px;">ORDER DATE</label>
        <input type="date" id="mainPoDateInp" value="${orderDate}" style="padding:5px 8px;font-size:12px;" />
      </div>
      <div>
        <label for="mainPoNotesInp" style="font-size:10.5px;">SUPPLIER / DELIVERY NOTES</label>
        <input type="text" id="mainPoNotesInp" value="${String(po.notes || '').replace(/"/g, '&quot;')}" placeholder="Approved notes, DR#, missing items..." style="padding:5px 8px;font-size:12px;" />
      </div>
    </div>

    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:6px 8px;border-radius:6px;background:rgba(255,255,255,0.03);border:1px dashed var(--border);margin-bottom:10px;">
      <select id="mainPoAddProdSel" style="flex:2;min-width:170px;padding:5px 8px;font-size:12px;">
        <option value="">+ Add unit (ordered or extra/substituted delivery)...</option>
        ${activeProds
          .map((i) => {
            const nm = formatSwapModelName({ brand: i.brand || '', model: i.model || i.name });
            return `<option value="${i.id}">${nm} (SRP ${fmtCurrency(i.base_price)})</option>`;
          })
          .join('')}
      </select>
      <select id="mainPoAddBranchSel" style="width:auto;padding:5px 8px;font-size:12px;">
        <option value="br-molave">Molave</option>
        <option value="br-tambulig">Tambulig</option>
        <option value="br-bonifacio">Bonifacio</option>
      </select>
      <select id="mainPoAddSupSel" style="width:auto;padding:5px 8px;font-size:12px;">
        <option value="AB Main Supplier">AB Main Supplier</option>
        <option value="A&K">A&amp;K</option>
        <option value="Online Purchase">Online Purchase</option>
      </select>
      <input type="number" id="mainPoAddPriceInp" placeholder="Price ₱" min="0" step="0.01" style="width:82px;padding:5px 6px;font-size:12px;" />
      <input type="number" id="mainPoAddQtyInp" value="1" min="1" max="999" style="width:52px;padding:5px 6px;font-size:12px;text-align:center;" />
      <label style="display:flex;align-items:center;gap:4px;margin:0;font-size:11px;cursor:pointer;" title="Check if this item was delivered as an unexpected/substituted item not on the original order">
        <input type="checkbox" id="mainPoAddExtraChk" style="width:14px;height:14px;margin:0;accent-color:#f59e0b;" />
        <span>Extra Deliv</span>
      </label>
      <button type="button" id="mainPoAddBtn" class="secondary" style="padding:5px 10px;font-size:11.5px;min-height:0;">+ ADD</button>
    </div>

    <div style="max-height:380px;overflow-y:auto;padding-right:4px;">${groupsHtml || '<div class="muted small">No items yet — add items above.</div>'}</div>

    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--border-soft);">
      <label style="display:flex;align-items:center;gap:6px;margin:0;font-size:12px;cursor:pointer;">
        <input type="checkbox" id="mainPoSyncCostsChk" checked style="width:15px;height:15px;margin:0;accent-color:var(--gold);" />
        <span>Also update Product Supplier Costs from edited/billed prices</span>
      </label>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span id="mainPoSaveStatus" class="small" style="color:var(--green);font-weight:700;">${statusMsg}</span>
        <button type="button" id="mainPoSaveBtn" style="padding:7px 16px;font-size:12px;">SAVE ORDER &amp; DELIVERY</button>
      </div>
    </div>
  `;

  wrap.querySelector('#mainPoTitleInp')?.addEventListener('input', (e) => { po.title = e.target.value; });
  wrap.querySelector('#mainPoStatusSel')?.addEventListener('change', (e) => { po.status = e.target.value; });
  wrap.querySelector('#mainPoDateInp')?.addEventListener('change', (e) => {
    if (e.target.value) po.createdAt = `${e.target.value}T10:00:00.000Z`;
  });
  wrap.querySelector('#mainPoNotesInp')?.addEventListener('input', (e) => { po.notes = e.target.value; });

  wrap.querySelectorAll('.main-po-chk').forEach((chk) => {
    chk.addEventListener('change', () => {
      const idx = Number(chk.dataset.idx);
      if (po.items[idx]) po.items[idx].approved = chk.checked;
      renderSavedOrderInlineEditor();
    });
  });
  wrap.querySelectorAll('.main-po-price').forEach((inp) => {
    inp.addEventListener('change', () => {
      const idx = Number(inp.dataset.idx);
      const val = Math.max(0, Number(inp.value) || 0);
      if (po.items[idx]) {
        const oldU = po.items[idx].unitCost;
        po.items[idx].unitCost = val;
        if (po.items[idx].receivedCost === undefined || po.items[idx].receivedCost === oldU) {
          po.items[idx].receivedCost = val;
        }
        po.items[idx].isEstimatedCost = false;
      }
      renderSavedOrderInlineEditor();
    });
  });
  wrap.querySelectorAll('.main-po-qty').forEach((inp) => {
    inp.addEventListener('change', () => {
      const idx = Number(inp.dataset.idx);
      const v = Math.max(0, parseInt(inp.value, 10) || 0);
      if (po.items[idx]) {
        po.items[idx].qty = v;
        po.items[idx].approved = v > 0;
      }
      renderSavedOrderInlineEditor();
    });
  });
  wrap.querySelectorAll('.main-po-rec-qty').forEach((inp) => {
    inp.addEventListener('change', () => {
      const idx = Number(inp.dataset.idx);
      const it = po.items[idx];
      if (!it) return;
      if (inp.value === '') {
        it.receivedQty = null;
      } else {
        it.receivedQty = Math.max(0, parseInt(inp.value, 10) || 0);
        if (!it.receivedDate) it.receivedDate = todayStr;
        if (!it.abDeliveryNo) it.abDeliveryNo = 'PENDING IN AB WEB';
      }
      renderSavedOrderInlineEditor();
    });
  });
  wrap.querySelectorAll('.main-po-rec-cost').forEach((inp) => {
    inp.addEventListener('change', () => {
      const idx = Number(inp.dataset.idx);
      if (po.items[idx]) po.items[idx].receivedCost = Math.max(0, Number(inp.value) || 0);
      renderSavedOrderInlineEditor();
    });
  });
  wrap.querySelectorAll('.main-po-ab-ref').forEach((inp) => {
    inp.addEventListener('change', () => {
      const idx = Number(inp.dataset.idx);
      if (po.items[idx]) po.items[idx].abDeliveryNo = inp.value.trim();
    });
  });
  wrap.querySelectorAll('.main-po-del-line').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      po.items.splice(idx, 1);
      renderSavedOrderInlineEditor();
    });
  });

  wrap.querySelector('#mainPoFillDeliveredBtn')?.addEventListener('click', () => {
    for (const it of po.items || []) {
      if (it.approved === false || it.isExtraItem) continue;
      it.receivedQty = Number(it.qty) || 0;
      it.receivedCost = Number(it.receivedCost ?? it.unitCost) || 0;
      if (!it.receivedDate) it.receivedDate = todayStr;
      if (!it.abDeliveryNo) it.abDeliveryNo = 'PENDING IN AB WEB';
    }
    const anyMissingAb = (po.items || []).some((it) => Number(it.receivedQty) > 0 && (!it.abDeliveryNo || it.abDeliveryNo === 'PENDING IN AB WEB'));
    po.status = anyMissingAb ? 'Received (Pending AB Web)' : 'Received';
    renderSavedOrderInlineEditor('All approved quantities filled as Delivered (click SAVE ORDER & DELIVERY)');
  });

  wrap.querySelector('#mainPoMatchAbBtn')?.addEventListener('click', async () => {
    if (po._isNew) {
      alert('Please save the order first before auto-matching AB Web deliveries.');
      return;
    }
    await matchSingleOrderWithAbWeb(po.id);
  });

  wrap.querySelector('#mainPoAddProdSel')?.addEventListener('change', (e) => {
    const pid = e.target.value;
    const item = (state.inventory?.items || []).find((i) => i.id === pid);
    if (!item) return;
    const sup = resolveSupplierForProduct(item, 'LOWEST');
    const pVal = Number(sup?.unitCost) > 0 ? sup.unitCost : Math.round((Number(item.base_price) || 0) * 0.85);
    const pInp = wrap.querySelector('#mainPoAddPriceInp');
    const sSel = wrap.querySelector('#mainPoAddSupSel');
    if (pInp) pInp.value = pVal > 0 ? pVal : '';
    if (sSel && sup?.supplier) sSel.value = sup.supplier;
  });

  wrap.querySelector('#mainPoAddBtn')?.addEventListener('click', () => {
    const pid = wrap.querySelector('#mainPoAddProdSel')?.value;
    const branchId = wrap.querySelector('#mainPoAddBranchSel')?.value || 'br-molave';
    const supplier = wrap.querySelector('#mainPoAddSupSel')?.value || 'AB Main Supplier';
    const unitCost = Math.max(0, Number(wrap.querySelector('#mainPoAddPriceInp')?.value) || 0);
    const qty = Math.max(1, parseInt(wrap.querySelector('#mainPoAddQtyInp')?.value, 10) || 1);
    const isExtra = Boolean(wrap.querySelector('#mainPoAddExtraChk')?.checked);
    const item = (state.inventory?.items || []).find((i) => i.id === pid);
    if (!item) return;
    const branchName = { 'br-molave': 'Molave', 'br-tambulig': 'Tambulig', 'br-bonifacio': 'Bonifacio' }[branchId] || branchId;
    const tier = getCellphonePriceTier(item);
    po.items.push({
      key: `${item.id}::${branchId}`,
      productId: item.id,
      brand: item.brand || '',
      model: item.model || item.name,
      displayModel: formatSwapModelName({ brand: item.brand || '', model: item.model || item.name }),
      sku: item.website_codes || item.sku || '',
      branchId,
      branchName,
      supplier,
      tierKey: tier.key,
      tierLabel: tier.label,
      avail: Number(item.byBranch?.[branchId]?.qtyAvailable) || 0,
      branchDemand90: 0,
      storewideDemand90: 0,
      requestedQty: isExtra ? 0 : qty,
      qty: isExtra ? 0 : qty,
      requestedCost: unitCost,
      unitCost,
      approved: true,
      receivedQty: isExtra ? qty : null,
      receivedCost: unitCost,
      receivedDate: isExtra ? todayStr : '',
      abDeliveryNo: isExtra ? 'PENDING IN AB WEB' : '',
      abReportedQty: null,
      isExtraItem: isExtra,
    });
    renderSavedOrderInlineEditor();
  });

  wrap.querySelector('#mainPoPreviewBtn')?.addEventListener('click', () => {
    state.previewOrderOverride = po;
    renderReorderPreviewModal();
    document.getElementById('reorderPreviewModal')?.classList.remove('hidden');
  });

  wrap.querySelector('#mainPoCopyBtn')?.addEventListener('click', async (e) => {
    const ok = await copyTextToClipboard(buildReorderCopyText(po));
    e.target.textContent = ok ? 'COPIED ✓' : 'ERR';
    setTimeout(() => { e.target.textContent = 'COPY'; }, 1400);
  });

  wrap.querySelector('#mainPoCloseBtn')?.addEventListener('click', () => {
    state.editingSavedOrder = null;
    renderSavedOrderInlineEditor();
  });

  wrap.querySelector('#mainPoSaveBtn')?.addEventListener('click', async () => {
    const syncSupplierCosts = Boolean(wrap.querySelector('#mainPoSyncCostsChk')?.checked);
    const title = (po.title || '').trim() || `Restock Order • ${todayStr}`;
    let status = po.status || 'Supplier Approved';
    const notes = (po.notes || '').trim();

    // Auto-update status if delivery quantities were entered
    const appItems = (po.items || []).filter((it) => it.approved !== false && !it.isExtraItem && (Number(it.qty) || 0) > 0);
    const anyRec = (po.items || []).some((it) => it.receivedQty !== undefined && it.receivedQty !== null && it.receivedQty !== '');
    const allRec = appItems.length > 0 && appItems.every((it) => it.receivedQty !== undefined && it.receivedQty !== null && it.receivedQty !== '');
    const missingAb = (po.items || []).some((it) => Number(it.receivedQty) > 0 && (!it.abDeliveryNo || it.abDeliveryNo === 'PENDING IN AB WEB'));
    if (!['Cancelled', 'Draft'].includes(status)) {
      if (allRec && status !== 'Received') status = missingAb ? 'Received (Pending AB Web)' : 'Received';
      else if (anyRec && !allRec && ['Sent to Supplier', 'Supplier Approved', 'At Warehouse (AB Web INITIAL)'].includes(status)) status = 'Partially Received';
    }
    const refs = [...new Set((po.items || []).map((it) => String(it.abDeliveryNo || '').trim()).filter((r) => r && r !== 'PENDING IN AB WEB'))].join(', ');

    if (IS_STATIC_GH) {
      const now = new Date().toISOString();
      const updatedObj = {
        ...po,
        _isNew: undefined,
        title,
        status,
        notes,
        abDeliveryRefs: refs,
        updatedAt: now,
        ...computeOrderSummaryMetrics(po.items, status),
      };
      delete updatedObj._isNew;
      const all = getLocalSavedOrders();
      const idx = all.findIndex((o) => o.id === po.id);
      if (idx >= 0) all[idx] = updatedObj;
      else all.unshift(updatedObj);
      setLocalSavedOrders(all);
      state.savedOrders = all;
      state.editingSavedOrder = JSON.parse(JSON.stringify(updatedObj));
    } else if (po._isNew) {
      const res = await api('/api/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({
          id: po.id,
          title,
          status,
          supplierFilter: po.supplierFilter || 'LOWEST',
          notes,
          abDeliveryRefs: refs,
          items: po.items,
          createdAt: po.createdAt,
          syncSupplierCosts,
        }),
      });
      await loadSavedPurchaseOrders();
      if (res?.order) state.editingSavedOrder = JSON.parse(JSON.stringify(res.order));
    } else {
      const res = await api(`/api/purchase-orders/${encodeURIComponent(po.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title,
          status,
          notes,
          abDeliveryRefs: refs,
          items: po.items,
          createdAt: po.createdAt,
          syncSupplierCosts,
        }),
      });
      await loadSavedPurchaseOrders();
      if (res?.order) state.editingSavedOrder = JSON.parse(JSON.stringify(res.order));
    }
    if (syncSupplierCosts) {
      applyEditedPricesToLocalInventory(po.items);
      renderInventory();
    }
    renderSavedOrdersPanel();
    buildRestockDraftPlan();
    renderRestockCards();
    renderSavedOrderInlineEditor(`Saved ${po.id}${syncSupplierCosts ? ' & updated supplier costs' : ''} ✓`);
  });
}

async function matchSingleOrderWithAbWeb(poId = 'ALL') {
  const btn = document.getElementById('syncAbDeliveriesBtn');
  if (btn) btn.textContent = 'SYNCING...';
  try {
    if (IS_STATIC_GH) {
      await loadAbDeliveries();
      const cnt = reconcileStaticOrdersWithDeliveries(poId === 'ALL' ? null : poId);
      await loadSavedPurchaseOrders();
      if (state.editingSavedOrder && poId !== 'ALL') {
        const refreshed = state.savedOrders.find((o) => o.id === poId);
        if (refreshed) state.editingSavedOrder = JSON.parse(JSON.stringify(refreshed));
      }
      renderSavedOrdersPanel();
      buildRestockDraftPlan();
      renderRestockCards();
      if (btn) btn.textContent = cnt > 0 ? `MATCHED ${cnt} ✓` : 'SYNCED (0 NEW)';
    } else {
      const res = await api(`/api/purchase-orders/${encodeURIComponent(poId)}/match-deliveries`, { method: 'POST', body: JSON.stringify({}) });
      await Promise.all([loadAbDeliveries(), loadSavedPurchaseOrders()]);
      if (state.editingSavedOrder && res?.order) {
        state.editingSavedOrder = JSON.parse(JSON.stringify(res.order));
      }
      renderSavedOrdersPanel();
      buildRestockDraftPlan();
      renderRestockCards();
      if (btn) btn.textContent = res?.matchedLines > 0 ? `MATCHED ${res.matchedLines} LINE(S) ✓` : 'UP TO DATE ✓';
    }
  } catch (err) {
    if (btn) btn.textContent = 'SYNC ERROR';
    alert(err.message);
  }
  setTimeout(() => {
    if (btn) btn.textContent = 'SYNC & MATCH AB WEB';
  }, 2200);
}

function buildVarianceReportRows() {
  const orderFilter = document.getElementById('varianceOrderFilter')?.value || 'ALL';
  const typeFilter = document.getElementById('varianceTypeFilter')?.value || 'ALL';
  const orders = (state.savedOrders || []).filter((o) => {
    if (o.status === 'Cancelled') return false;
    if (orderFilter !== 'ALL') return o.id === orderFilter;
    return o.status !== 'Draft';
  });

  const abList = (state.abDeliveries || []).filter((d) => String(d.status || '').toUpperCase() !== 'CANCELLED');

  const out = [];
  for (const o of orders) {
    const ordDate = String(o.createdAt || '').slice(0, 10);
    const poHasAnyAbRef = Boolean(String(o.abDeliveryRefs || '').trim()) || (o.items || []).some((x) => Boolean(x.abDeliveryNo && x.abDeliveryNo !== 'PENDING IN AB WEB'));
    for (const it of o.items || []) {
      const reqQty = Math.max(0, Number(it.requestedQty ?? it.qty) || 0);
      const isApp = it.approved !== false && !it.isExtraItem;
      const appQty = isApp ? Math.max(0, Number(it.qty) || 0) : 0;
      const appCost = Math.max(0, Number(it.unitCost) || 0);
      const hasRec = it.receivedQty !== undefined && it.receivedQty !== null && it.receivedQty !== '';
      const delQty = hasRec ? Math.max(0, Number(it.receivedQty) || 0) : 0;
      const delCost = hasRec ? Math.max(0, Number(it.receivedCost ?? appCost) || 0) : appCost;
      const abRef = String(it.abDeliveryNo || '').trim();
      const abStatus = String(it.abDeliveryStatus || (abRef && abRef !== 'PENDING IN AB WEB' ? 'RECEIVED' : '')).toUpperCase();
      const hasAbRef = Boolean(abRef && abRef !== 'PENDING IN AB WEB');
      const abQty = hasAbRef ? Number(it.abDeliveredQty ?? it.abReportedQty ?? (hasRec ? delQty : 0)) : 0;
      const isWarehouseInitial = hasAbRef && abStatus !== 'RECEIVED' && !hasRec;

      const qtyVar = hasRec ? delQty - appQty : isWarehouseInitial ? abQty - appQty : 0;
      const unitPriceVar = hasRec ? delCost - appCost : 0;
      const pesoImpact = hasRec ? delQty * delCost - appQty * appCost : isWarehouseInitial ? (abQty - appQty) * appCost : 0;
      const missingInAb = hasRec && delQty > 0 && !hasAbRef;
      const notInAbDeliveries = isApp && appQty > 0 && !hasAbRef;
      const hasBranchAbAfterOrder = abList.some((d) => (!ordDate || String(d.deliveryDate || '') >= ordDate) && (!it.branchId || d.branchId === it.branchId));
      const confirmedMissingInAb = notInAbDeliveries && (poHasAnyAbRef || hasBranchAbAfterOrder || hasRec);

      let rowStatus = 'Waiting AB Web Delivery';
      if (it.isExtraItem) rowStatus = 'Extra / Substituted';
      else if (!isApp) rowStatus = 'Cancelled by Supplier';
      else if (hasRec) {
        if (qtyVar < 0) rowStatus = `Short (${qtyVar})`;
        else if (qtyVar > 0) rowStatus = `Over (+${qtyVar})`;
        else if (Math.abs(unitPriceVar) >= 0.01) rowStatus = 'Price Diff';
        else if (missingInAb) rowStatus = 'Received (Not in AB Web)';
        else rowStatus = 'Matched ✓';
      } else if (isWarehouseInitial) {
        if (abQty < appQty) rowStatus = `At Warehouse · Short (${abQty - appQty})`;
        else if (abQty > appQty) rowStatus = `At Warehouse · Over (+${abQty - appQty})`;
        else rowStatus = 'At Warehouse (Pick-Up)';
      } else if (confirmedMissingInAb) {
        rowStatus = 'Missing in AB Web Delivery';
      }

      const isVariance =
        Boolean(it.isExtraItem) ||
        confirmedMissingInAb ||
        (hasRec && (qtyVar !== 0 || Math.abs(unitPriceVar) >= 0.01 || missingInAb)) ||
        (isWarehouseInitial && abQty !== appQty) ||
        !isApp;

      if (typeFilter === 'NOT_IN_AB' && !notInAbDeliveries) continue;
      if (typeFilter === 'AT_WAREHOUSE' && !isWarehouseInitial) continue;
      if (typeFilter === 'VARIANCES_ONLY' && !isVariance) continue;
      if (typeFilter === 'PENDING_ONLY' && (hasRec || !isApp)) continue;

      out.push({
        orderId: o.id,
        orderTitle: o.title,
        orderDate: ordDate,
        orderStatus: o.status,
        branchName: it.branchName || '',
        displayModel: it.displayModel || it.model || '',
        supplier: it.supplier || '',
        reqQty,
        appQty,
        delQty: hasRec ? delQty : null,
        abQty: hasAbRef ? abQty : null,
        abStatus,
        isWarehouseInitial,
        qtyVar,
        appCost,
        delCost: hasRec ? delCost : null,
        unitPriceVar,
        pesoImpact,
        hasRec,
        hasAbRef,
        isApp,
        isExtra: Boolean(it.isExtraItem),
        abRef,
        missingInAb,
        notInAbDeliveries,
        confirmedMissingInAb,
        rowStatus,
      });
    }
  }
  return out;
}

function renderOrderVarianceReport() {
  const orderSel = document.getElementById('varianceOrderFilter');
  const kpiGrid = document.getElementById('varianceKpiGrid');
  const banner = document.getElementById('varianceInsightBanner');
  const tbody = document.querySelector('#orderVarianceTable tbody');
  if (!tbody) return;

  const orders = (state.savedOrders || []).filter((o) => o.status !== 'Cancelled' && o.status !== 'Draft');
  const allNonCancelled = (state.savedOrders || []).filter((o) => o.status !== 'Cancelled');
  if (orderSel) {
    const prev = orderSel.value || 'ALL';
    orderSel.innerHTML =
      '<option value="ALL">All Finalized Orders (Ordered vs AB Web)</option>' +
      allNonCancelled.map((o) => `<option value="${o.id}">${o.id} — ${o.title} (${o.status})</option>`).join('');
    if ([...orderSel.options].some((opt) => opt.value === prev)) orderSel.value = prev;
  }

  const rows = buildVarianceReportRows();
  let sumAppQty = 0, sumDelQty = 0, sumAbRecordedQty = 0, sumWarehouseQty = 0, sumPendingQty = 0, sumAppVal = 0, sumDelVal = 0, sumPriceImpact = 0;
  let shortUnits = 0, overUnits = 0, missingAbLines = 0, missingAbUnits = 0, confirmedMissingLines = 0;

  for (const r of rows) {
    sumAppQty += r.appQty;
    sumAppVal += r.appQty * r.appCost;
    if (r.hasAbRef) sumAbRecordedQty += Math.max(0, r.abQty || 0);
    if (r.isWarehouseInitial) sumWarehouseQty += Math.max(0, r.abQty || r.appQty);
    if (r.notInAbDeliveries) {
      missingAbLines++;
      missingAbUnits += r.appQty;
      if (r.confirmedMissingInAb) confirmedMissingLines++;
    }
    if (r.hasRec) {
      sumDelQty += r.delQty;
      sumDelVal += r.delQty * r.delCost;
      sumPriceImpact += r.delQty * (r.delCost - r.appCost);
      if (r.qtyVar < 0) shortUnits += Math.abs(r.qtyVar);
      if (r.qtyVar > 0) overUnits += r.qtyVar;
    } else if (r.isApp) {
      sumPendingQty += r.appQty;
      if (r.isWarehouseInitial && r.qtyVar < 0) shortUnits += Math.abs(r.qtyVar);
      if (r.isWarehouseInitial && r.qtyVar > 0) overUnits += r.qtyVar;
    }
  }

  const reportedAppQty = Math.max(0, sumAppQty - sumPendingQty);
  const abRecordPct = sumAppQty > 0 ? (sumAbRecordedQty / sumAppQty) * 100 : 0;
  const netQtyVar = sumDelQty - reportedAppQty;
  const netValVar = sumDelVal - (sumAppVal - rows.filter((r) => !r.hasRec && r.isApp).reduce((s, r) => s + r.appQty * r.appCost, 0));

  if (kpiGrid) {
    kpiGrid.innerHTML = `
      <div class="summary-box">
        FINALIZED vs AB WEB RECORDED
        <strong style="color:${abRecordPct >= 99 ? 'var(--green)' : '#f59e0b'};">${fmtNum(sumAbRecordedQty)} / ${fmtNum(sumAppQty)} pcs</strong>
        <span class="summary-note">${abRecordPct.toFixed(1)}% in AB Web • Branch Received: ${fmtNum(sumDelQty)} pcs</span>
      </div>
      <div class="summary-box" style="border-color:${sumWarehouseQty > 0 ? '#60a5fa' : 'var(--border)'};">
        AT WAREHOUSE (FOR PICK-UP)
        <strong style="color:${sumWarehouseQty > 0 ? '#60a5fa' : 'var(--muted)'};">${fmtNum(sumWarehouseQty)} pcs</strong>
        <span class="summary-note">AB Web status INITIAL (arrived at warehouse, awaiting branch pick-up)</span>
      </div>
      <div class="summary-box" style="border-color:${confirmedMissingLines > 0 ? 'var(--danger)' : missingAbLines > 0 ? '#f59e0b' : 'var(--green)'};">
        MISSING IN AB WEB DELIVERIES
        <strong style="color:${confirmedMissingLines > 0 ? 'var(--danger)' : missingAbLines > 0 ? '#f59e0b' : 'var(--green)'};">${missingAbLines > 0 ? `${fmtNum(missingAbLines)} line(s) / ${fmtNum(missingAbUnits)} pcs` : '0 Missing ✓'}</strong>
        <span class="summary-note">${confirmedMissingLines > 0 ? `${confirmedMissingLines} line(s) missing even with newer AB Web deliveries` : 'Ordered items not yet recorded in AB Web /panel/deliveries'}</span>
      </div>
      <div class="summary-box">
        QUANTITY &amp; PRICE VARIANCE
        <strong style="color:${shortUnits === 0 && sumPriceImpact <= 0 ? 'var(--green)' : 'var(--danger)'};">${shortUnits > 0 ? `−${fmtNum(shortUnits)} short` : `${netQtyVar >= 0 ? '+' : ''}${fmtNum(netQtyVar)} pcs`}</strong>
        <span class="summary-note">Over: +${fmtNum(overUnits)} pcs • Price Var: ${sumPriceImpact >= 0 ? '+' : ''}${fmtCurrency(sumPriceImpact)} (${netValVar >= 0 ? '+' : ''}${fmtCurrency(netValVar)})</span>
      </div>
    `;
  }

  if (banner) {
    const latestAb = (state.abDeliveries || [])[0];
    const brNameMap = { 'br-molave': 'Molave', 'br-tambulig': 'Tambulig', 'br-bonifacio': 'Bonifacio' };
    const latestStr = latestAb ? `Latest AB Web delivery: <strong>${latestAb.deliveryDate} (${latestAb.deliveryNo} • ${latestAb.status} • ${latestAb.branchName || brNameMap[latestAb.branchId] || latestAb.branchId || ''})</strong>.` : '';
    banner.innerHTML = `<strong>Finalized Orders vs. AB Web Delivery Audit:</strong> Comparing <strong>${rows.length}</strong> line item(s) across ${orders.length} finalized order(s). ${
      confirmedMissingLines > 0
        ? `<strong style="color:var(--danger);">${confirmedMissingLines} finalized item(s) MISSING in AB Web deliveries</strong> (deliveries have already arrived in AB Web for these branches/orders without this item). `
        : missingAbLines > 0
          ? `<strong style="color:#f59e0b;">${missingAbLines} item(s) (${fmtNum(missingAbUnits)} pcs)</strong> not yet recorded in AB Web deliveries. `
          : ''
    }${sumWarehouseQty > 0 ? `<strong style="color:#60a5fa;">${fmtNum(sumWarehouseQty)} pcs</strong> arrived at warehouse (AB Web <code>INITIAL</code> — subject for pick-up). ` : ''}${shortUnits > 0 ? `<strong style="color:var(--danger);">${shortUnits} unit(s) short-delivered</strong>. ` : ''}${latestStr}`;
  }

  tbody.innerHTML = rows.length
    ? rows
        .map((r) => {
          const varColor = !r.hasRec && !r.isWarehouseInitial
            ? r.confirmedMissingInAb ? 'var(--danger)' : 'var(--muted)'
            : r.qtyVar < 0
              ? 'var(--danger)'
              : r.qtyVar > 0 || r.isExtra
                ? '#f59e0b'
                : 'var(--green)';
          const priceDisp = r.hasRec
            ? `${fmtCurrency(r.appCost)} → <strong style="color:${Math.abs(r.unitPriceVar) < 0.01 ? 'var(--text)' : r.unitPriceVar < 0 ? 'var(--green)' : 'var(--danger)'};">${fmtCurrency(r.delCost)}</strong>`
            : fmtCurrency(r.appCost);
          let abBadge = `<span class="badge badge-warn" style="font-size:10px;">Waiting AB Web</span>`;
          if (r.hasRec && r.missingInAb) {
            abBadge = `<span class="badge badge-danger" style="font-size:10px;">Received · Missing in AB Web</span>`;
          } else if (r.hasRec) {
            abBadge = `<span class="badge badge-ok" style="font-size:10px;">${r.abRef} (RECEIVED)</span>`;
          } else if (r.isWarehouseInitial) {
            abBadge = `<span class="badge badge-warn" style="font-size:10px;background:rgba(96,165,250,0.18);color:#93c5fd;border-color:rgba(96,165,250,0.4);">🚚 ${r.abRef} (${r.abStatus || 'DELIVERY'} · Pick-Up)</span>`;
          } else if (r.confirmedMissingInAb) {
            abBadge = `<span class="badge badge-danger" style="font-size:10px;">⚠ MISSING IN AB WEB</span>`;
          }
          const recCellText = r.hasRec
            ? `<strong>${fmtNum(r.delQty)}</strong>`
            : r.isWarehouseInitial
              ? `<strong style="color:#60a5fa;">${fmtNum(r.abQty)} (WH)</strong>`
              : '<span class="muted">—</span>';
          return `
            <tr>
              <td><strong>${r.orderId}</strong><div class="small muted">${r.orderDate}</div></td>
              <td>${r.branchName}</td>
              <td><strong>${r.displayModel}</strong><div class="small muted">${r.supplier}</div></td>
              <td>${fmtNum(r.reqQty)}</td>
              <td><strong>${fmtNum(r.appQty)}</strong></td>
              <td>${recCellText}</td>
              <td style="color:${varColor};font-weight:700;">${r.hasRec || r.isWarehouseInitial ? `${r.qtyVar > 0 ? '+' : ''}${r.qtyVar}` : '—'}</td>
              <td>${priceDisp}</td>
              <td style="color:${r.pesoImpact === 0 ? 'var(--muted)' : r.pesoImpact < 0 ? '#f59e0b' : 'var(--danger)'};"><strong>${r.hasRec || r.isWarehouseInitial ? `${r.pesoImpact >= 0 ? '+' : ''}${fmtCurrency(r.pesoImpact)}` : '—'}</strong></td>
              <td>${abBadge}<div class="small" style="color:${varColor};margin-top:2px;">${r.rowStatus}</div></td>
            </tr>`;
        })
        .join('')
    : '<tr><td colspan="10" class="muted">No finalized order lines match this variance filter.</td></tr>';
}

function renderAbDeliveriesView() {
  const tbody = document.querySelector('#abDeliveriesTable tbody');
  if (!tbody) return;
  const brFilter = document.getElementById('abDeliveryBranchFilter')?.value || 'ALL';
  const bNames = { 'br-molave': 'Molave', 'br-tambulig': 'Tambulig', 'br-bonifacio': 'Bonifacio' };
  const linkedRefs = new Map();
  for (const o of state.savedOrders || []) {
    for (const ref of String(o.abDeliveryRefs || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      linkedRefs.set(ref, o.id);
    }
  }

  const list = (state.abDeliveries || []).filter((d) => brFilter === 'ALL' || d.branchId === brFilter);
  tbody.innerHTML = list.length
    ? list
        .slice(0, 60)
        .map((d) => {
          const linkedPo = linkedRefs.get(d.deliveryNo);
          const itemChips = (d.items || [])
            .filter((it) => !/FREE/i.test(it.code) && !/FREE\s*BUNDLE/i.test(it.productName))
            .slice(0, 6)
            .map((it) => `<span style="display:inline-block;padding:1px 6px;margin:1px;border-radius:4px;background:rgba(255,255,255,0.06);font-size:11px;">${it.productName} ×<strong>${it.receivedQty || it.deliveredQty}</strong></span>`)
            .join('');
          const moreCnt = Math.max(0, (d.items || []).filter((it) => !/FREE/i.test(it.code)).length - 6);
          return `
            <tr>
              <td><strong>${d.deliveryDate}</strong></td>
              <td><strong>${d.deliveryNo}</strong>${linkedPo ? `<div class="small" style="color:var(--green);">Linked: ${linkedPo}</div>` : ''}</td>
              <td>${bNames[d.branchId] || d.branchId}</td>
              <td><span class="badge ${d.status === 'RECEIVED' ? 'badge-ok' : 'badge-warn'}">${d.status}</span></td>
              <td><strong>${fmtNum(d.totalDeliveredQty)} / ${fmtNum(d.totalReceivedQty)} pcs</strong><div class="small muted">${fmtCurrency(d.totalAmount)} SRP</div></td>
              <td>${itemChips || '<span class="muted small">No line items</span>'}${moreCnt > 0 ? ` <span class="small muted">+${moreCnt} more</span>` : ''}</td>
            </tr>`;
        })
        .join('')
    : '<tr><td colspan="6" class="muted">No AB Web deliveries synced yet (click Sync Now or Sync &amp; Match AB Web).</td></tr>';
}

function downloadVariancePdf() {
  const jspdfNs = window.jspdf;
  if (!jspdfNs || typeof jspdfNs.jsPDF !== 'function') return alert('PDF library loading...');
  const rows = buildVarianceReportRows();
  if (!rows.length) return alert('No variance rows to export.');
  const doc = new jspdfNs.jsPDF({ orientation: 'landscape', unit: 'in', format: [8.5, 13], compress: true });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('AB-GADGETZ · ORDER VS. DELIVERY VARIANCE REPORT', 6.5, 0.45, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Generated ${todayStr} • ${rows.length} line item(s)`, 6.5, 0.63, { align: 'center' });

  doc.autoTable({
    startY: 0.78,
    margin: { left: 0.35, right: 0.35, bottom: 0.35 },
    head: [['Order ID', 'Date', 'Branch', 'Model', 'Req', 'Appr', 'Deliv', 'Qty Var', 'Appr ₱', 'Billed ₱', '₱ Impact', 'AB Web Ref / Status']],
    body: rows.map((r) => [
      r.orderId,
      r.orderDate,
      r.branchName,
      r.displayModel,
      r.reqQty,
      r.appQty,
      r.hasRec ? r.delQty : r.isWarehouseInitial ? `${r.abQty} (WH)` : '—',
      r.hasRec || r.isWarehouseInitial ? (r.qtyVar > 0 ? `+${r.qtyVar}` : r.qtyVar) : '—',
      `PHP ${fmtNum(Math.round(r.appCost))}`,
      r.hasRec ? `PHP ${fmtNum(Math.round(r.delCost))}` : '—',
      r.hasRec || r.isWarehouseInitial ? `PHP ${fmtNum(Math.round(r.pesoImpact))}` : '—',
      r.hasRec
        ? r.missingInAb
          ? `Not in AB Web (${r.rowStatus})`
          : `${r.abRef} (${r.rowStatus})`
        : r.isWarehouseInitial
          ? `${r.abRef} (INITIAL · Pick-Up)`
          : r.confirmedMissingInAb
            ? 'MISSING IN AB WEB DELIVERY'
            : r.rowStatus,
    ]),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 3 / 72, lineColor: [60, 60, 60], lineWidth: 0.65 / 72 },
    headStyles: { fillColor: [235, 226, 190], textColor: [27, 25, 19], fontStyle: 'bold' },
  });
  doc.save(`AB_Gadgetz_Order_Delivery_Variance_${todayStr}.pdf`);
}

async function downloadVarianceExcel() {
  if (!window.ExcelJS) return alert('Excel library loading...');
  const rows = buildVarianceReportRows();
  if (!rows.length) return alert('No variance rows to export.');
  const wb = new window.ExcelJS.Workbook();
  const ws = wb.addWorksheet('Order vs Delivery Variance');
  ws.mergeCells(1, 1, 1, 12);
  ws.getCell(1, 1).value = `AB-GADGETZ · ORDER VS. DELIVERY VARIANCE REPORT (${todayStr})`;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  ws.getCell(1, 1).alignment = { horizontal: 'center' };
  const hdr = ws.addRow(['Order ID', 'Order Date', 'Branch', 'Model', 'Requested', 'Approved', 'Delivered', 'Qty Variance', 'Approved Price', 'Billed Price', 'Peso Impact', 'AB Web Ref / Status']);
  hdr.eachCell((c) => {
    c.font = { bold: true, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBE2BE' } };
    c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });
  for (const r of rows) {
    const er = ws.addRow([
      r.orderId,
      r.orderDate,
      r.branchName,
      r.displayModel,
      r.reqQty,
      r.appQty,
      r.hasRec ? r.delQty : r.isWarehouseInitial ? r.abQty : '',
      r.hasRec || r.isWarehouseInitial ? r.qtyVar : '',
      r.appCost,
      r.hasRec ? r.delCost : '',
      r.hasRec || r.isWarehouseInitial ? r.pesoImpact : '',
      r.hasRec
        ? r.missingInAb
          ? `Not Yet in AB Web (${r.rowStatus})`
          : `${r.abRef} (${r.rowStatus})`
        : r.isWarehouseInitial
          ? `${r.abRef} (INITIAL · Pick-Up)`
          : r.confirmedMissingInAb
            ? 'MISSING IN AB WEB DELIVERY'
            : r.rowStatus,
    ]);
    er.getCell(9).numFmt = '"₱"#,##0.00';
    if (r.hasRec || r.isWarehouseInitial) {
      if (r.hasRec) er.getCell(10).numFmt = '"₱"#,##0.00';
      er.getCell(11).numFmt = '"₱"#,##0.00';
    }
  }
  ws.columns = [
    { width: 16 }, { width: 12 }, { width: 12 }, { width: 32 }, { width: 10 }, { width: 10 },
    { width: 10 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 15 }, { width: 26 },
  ];
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `AB_Gadgetz_Order_Delivery_Variance_${todayStr}.xlsx`;
  a.click();
}

async function createSavedOrderFromDraft(opts = {}) {
  const {
    initialStatus = 'Sent to Supplier',
    excludeUnchecked = false,
    openInPreview = false,
  } = opts || {};
  if (!state.restockPlan) buildRestockDraftPlan();
  let draftSelected = (state.restockPlan || []).filter(
    (r) => r.selected && Number(r.qty) > 0 && (!excludeUnchecked || !state.previewUncheckedKeys?.has(r.key))
  );
  // Enforce the Net Order Budget cap at save time so a plan can never exceed it (e.g. ₱200,000)
  const budgetCap = parseMoneyInput(document.getElementById('restockBudgetInput')?.value);
  let trimmedNote = '';
  if (budgetCap > 0) {
    let spent = 0;
    const kept = [];
    let dropped = 0;
    for (const r of draftSelected) {
      const unit = Number(r.unitCost) || 0;
      const minQ = r.tierKey === 'LOW_END' ? 2 : 1;
      let q = Number(r.qty) || 0;
      if (unit > 0) {
        const afford = Math.floor((budgetCap - spent) / unit);
        if (afford < minQ) { dropped++; continue; }
        q = Math.min(q, afford);
      }
      kept.push({ ...r, qty: q });
      spent += q * unit;
    }
    if (kept.length !== draftSelected.length || kept.some((r, i) => r.qty !== draftSelected[i]?.qty)) {
      trimmedNote = ` Trimmed to your ${fmtCurrency(budgetCap)} budget (${fmtCurrency(spent)} total${dropped ? `, ${dropped} line(s) left out` : ''}).`;
    }
    draftSelected = kept;
  }
  if (!draftSelected.length) {
    alert('Select at least one product before saving.');
    return null;
  }
  const mode = document.querySelector('input[name="restockSupplierMode"]:checked')?.value || 'LOWEST';
  const prefix = initialStatus === 'Draft' ? 'Saved Plan' : 'Restock Order';
  const title = `${prefix} • ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const itemsPayload = draftSelected.map((r) => ({
    key: r.key,
    productId: r.productId,
    brand: r.brand,
    model: r.model,
    displayModel: r.displayModel,
    sku: r.sku,
    branchId: r.branchId,
    branchName: r.branchName,
    supplier: r.supplier,
    tierKey: r.tierKey,
    tierLabel: r.tierLabel,
    avail: r.avail,
    branchDemand90: r.branchDemand90,
    storewideDemand90: r.storewideDemand90,
    requestedQty: Number(r.qty) || 0,
    qty: Number(r.qty) || 0,
    requestedCost: Number(r.unitCost) || 0,
    unitCost: Number(r.unitCost) || 0,
    approved: true,
    receivedQty: null,
    receivedCost: Number(r.unitCost) || 0,
    receivedDate: '',
    abDeliveryNo: '',
    abDeliveryStatus: '',
    abDeliveryDate: '',
    abDeliveredQty: null,
    abReportedQty: null,
    isExtraItem: false,
  }));

  let createdOrder = null;
  if (IS_STATIC_GH) {
    const now = new Date().toISOString();
    const dayTag = now.slice(0, 10).replace(/-/g, '');
    const all = getLocalSavedOrders();
    const todayCnt = all.filter((o) => String(o.id || '').startsWith(`PO-${dayTag}-`)).length;
    const phCnt = all.filter((o) => String(o.id || '').startsWith(`PO-PH-${dayTag}-`)).length;
    const id = `PO-PH-${dayTag}-${String(phCnt + 1).padStart(2, '0')}`;
    createdOrder = {
      id,
      title,
      status: initialStatus,
      supplierFilter: mode,
      notes: '',
      expectedDate: '',
      abDeliveryRefs: '',
      items: itemsPayload,
      ...computeOrderSummaryMetrics(itemsPayload, initialStatus),
      createdAt: now,
      updatedAt: now,
    };
    all.unshift(createdOrder);
    setLocalSavedOrders(all);
    state.savedOrders = all;
  } else {
    const res = await api('/api/purchase-orders', {
      method: 'POST',
      body: JSON.stringify({ title, status: initialStatus, supplierFilter: mode, notes: '', items: itemsPayload }),
    });
    createdOrder = res?.order || null;
    await loadSavedPurchaseOrders();
  }

  if (createdOrder) {
    state.restockExcludedKeys = new Set();
    state.previewUncheckedKeys = new Set();
    renderSavedOrdersPanel();
    buildRestockDraftPlan();
    renderRestockCards();
    if (openInPreview) {
      state.previewOrderOverride = createdOrder;
      renderReorderPreviewModal(
        `Saved plan ${createdOrder.id} (${createdOrder.status}) ✓${trimmedNote} — Tick SHOW COSTS to adjust prices, or FINALIZE AS ORDERED when ready.${IS_STATIC_GH && !localStorage.getItem('bs_gh_pub_token') ? ' (Add your GitHub token in Staff PINs tab once so phone plans also appear on your PC.)' : ''}`
      );
      document.getElementById('reorderPreviewModal')?.classList.remove('hidden');
    } else {
      openSavedOrderInlineEditor(createdOrder);
      renderSavedOrderInlineEditor(`Order ${createdOrder.id} saved — Restock now deducts these pending units automatically ✓`);
    }
  }
  return createdOrder;
}

function getGroupedReorderPlan(overrideOrder = null, filterPreviewUnchecked = false) {
  const activeOrd = overrideOrder && Array.isArray(overrideOrder.items)
    ? overrideOrder
    : state.previewOrderOverride && Array.isArray(state.previewOrderOverride.items)
      ? state.previewOrderOverride
      : null;

  const selected = activeOrd
    ? activeOrd.items
        .map((r, idx) => ({ ...r, _itemIdx: idx }))
        .filter((r) => r.approved !== false && Number(r.qty) > 0)
    : (state.restockPlan || []).filter(
        (r) => r.selected && Number(r.qty) > 0 && (!filterPreviewUnchecked || !state.previewUncheckedKeys?.has(r.key))
      );

  const bySupplier = new Map();
  for (const sup of SUPPLIER_ORDER) bySupplier.set(sup, new Map());

  for (const r of selected) {
    const supName = r.supplier || 'AB Main Supplier';
    if (!bySupplier.has(supName)) bySupplier.set(supName, new Map());
    const branchMap = bySupplier.get(supName);
    const brName = r.branchName || 'Molave';
    if (!branchMap.has(brName)) branchMap.set(brName, []);
    branchMap.get(brName).push(r);
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
  return { selected, grouped: ordered, isSaved: Boolean(activeOrd), order: activeOrd };
}

function buildReorderCopyText(overrideOrder = null) {
  const { grouped } = getGroupedReorderPlan(overrideOrder, true);
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

function renderPreviewMetricsSummary(selectedRows, showCosts) {
  const metricsEl = document.getElementById('reorderPreviewMetrics');
  if (!metricsEl) return;
  const totalUnits = selectedRows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const totalCost = selectedRows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unitCost) || 0), 0);
  const branchTotals = new Map(BRANCH_ORDER.map((b) => [b, { qty: 0, cost: 0 }]));
  for (const r of selectedRows) {
    if (!branchTotals.has(r.branchName)) branchTotals.set(r.branchName, { qty: 0, cost: 0 });
    const bt = branchTotals.get(r.branchName);
    bt.qty += Number(r.qty) || 0;
    bt.cost += (Number(r.qty) || 0) * (Number(r.unitCost) || 0);
  }
  const branchPills = [...branchTotals.entries()]
    .filter(([, v]) => v.qty > 0)
    .map(
      ([b, v]) =>
        `<span style="display:inline-block;padding:4px 8px;border-radius:6px;background:#fff;border:1px solid #d5ceb8;font-size:12px;color:#1b1913;"><strong>${b}:</strong> ${v.qty} pcs${showCosts ? ` (${fmtCurrency(v.cost)})` : ''}</span>`
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

async function autoSaveSavedPreviewItemCost(order, itemIdx, newCost, persistNow = true) {
  if (!order || !Array.isArray(order.items) || !order.items[itemIdx]) return;
  const it = order.items[itemIdx];
  const cleanCost = Math.max(0, Number(newCost) || 0);
  it.unitCost = cleanCost;
  if (it.receivedQty === undefined || it.receivedQty === null || it.receivedQty === '') {
    it.receivedCost = cleanCost;
  }
  Object.assign(order, computeOrderSummaryMetrics(order.items, order.status));

  const activeRows = order.items.filter((r) => r.approved !== false && Number(r.qty) > 0);
  renderPreviewMetricsSummary(activeRows, Boolean(document.getElementById('reorderShowCostsChk')?.checked));

  if (!persistNow) return;

  // Persist order update & auto-save price to the specific supplier it was ordered from
  if (IS_STATIC_GH) {
    const all = getLocalSavedOrders();
    const idx = all.findIndex((o) => o.id === order.id);
    const updated = { ...order, updatedAt: new Date().toISOString(), ...computeOrderSummaryMetrics(order.items, order.status) };
    if (idx >= 0) all[idx] = updated;
    else all.unshift(updated);
    setLocalSavedOrders(all);
    state.savedOrders = all.map((o) => ({ ...o, ...computeOrderSummaryMetrics(o.items, o.status) }));
    state.previewOrderOverride = updated;
  } else {
    const res = await api(`/api/purchase-orders/${encodeURIComponent(order.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ items: order.items, syncSupplierCosts: true }),
    });
    if (res?.order) {
      state.previewOrderOverride = res.order;
      const list = state.savedOrders || [];
      const ix = list.findIndex((o) => o.id === res.order.id);
      if (ix >= 0) list[ix] = res.order;
    }
  }

  const supName = String(it.supplier || 'AB Main Supplier');
  if (it.productId && cleanCost > 0) {
    const supUpper = supName.toUpperCase();
    const costPatch = supUpper.includes('A&K')
      ? { costAk: cleanCost }
      : supUpper.includes('ONLINE')
        ? { costOnline: cleanCost }
        : { costAb: cleanCost };
    await saveProductSupplierCosts(it.productId, costPatch);
  }

  renderSavedOrdersPanel();
  renderInventory();
  renderRestockCards();

  const stEl = document.getElementById('reorderPreviewStatus');
  if (stEl) {
    stEl.style.color = '#1d6f42';
    stEl.textContent = `Auto-saved ${fmtCurrency(cleanCost)} for ${it.displayModel || it.model} (${supName}) ✓`;
  }
}

function findCheaperOtherSuppliers(row) {
  const prod = state.inventory?.items?.find((i) => i.id === row?.productId);
  if (!prod) return null;
  const curCost = Number(row?.unitCost) || 0;
  if (curCost <= 0) return null;
  const curSup = String(row?.supplier || 'AB Main Supplier').trim().toUpperCase();
  const candidates = [
    { name: 'AB Main Supplier', cost: Number(prod.cost_ab) || 0 },
    { name: 'A&K', cost: Number(prod.cost_ak) || 0 },
    { name: 'Online Purchase', cost: Number(prod.cost_online) || 0 },
  ].filter((c) => c.cost > 0 && c.name.toUpperCase() !== curSup && c.cost < curCost - 0.005);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.cost - b.cost);
  const best = candidates[0];
  const qty = Math.max(1, Number(row?.qty) || 1);
  return {
    cheaperSupplier: best.name,
    cheaperCost: best.cost,
    savePerPc: Number((curCost - best.cost).toFixed(2)),
    saveTotal: Number(((curCost - best.cost) * qty).toFixed(2)),
    allAlternatives: candidates,
  };
}

function renderReorderPreviewModal(statusNote = '') {
  const modal = document.getElementById('reorderPreviewModal');
  if (!modal) return;
  if (!state.previewUncheckedKeys) state.previewUncheckedKeys = new Set();
  if (!state.restockExcludedKeys) state.restockExcludedKeys = new Set();
  const showCosts = Boolean(document.getElementById('reorderShowCostsChk')?.checked);
  const compareMode = Boolean(document.getElementById('reorderCompareSuppliersChk')?.checked);
  const { selected, grouped, isSaved, order } = getGroupedReorderPlan(null, false);
  const activeSelected = isSaved ? selected : selected.filter((r) => !state.previewUncheckedKeys.has(r.key));

  const titleEl = document.getElementById('reorderPreviewTitle');
  if (titleEl) {
    titleEl.textContent = isSaved && order
      ? `AB-GADGETZ · ${order.id} (${String(order.status || 'Draft').toUpperCase()})`
      : 'AB-GADGETZ · REORDER PLAN';
  }

  const prepEl = document.getElementById('reorderPreviewPrepared');
  if (prepEl) {
    prepEl.textContent = isSaved && order
      ? `${order.title || 'Saved Order'} · Order Date ${String(order.createdAt || '').slice(0, 10) || todayStr}`
      : `Prepared ${new Date().toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })}`;
  }

  renderPreviewMetricsSummary(activeSelected, showCosts);

  const compareHits = [];
  const compareByKey = new Map();
  if (compareMode) {
    for (const r of activeSelected) {
      const cmp = findCheaperOtherSuppliers(r);
      if (cmp) {
        const key = r.key || `${r.productId}::${r.branchId}`;
        compareByKey.set(key, cmp);
        compareHits.push({ row: r, key, ...cmp });
      }
    }
  }

  const compareBannerEl = document.getElementById('reorderCompareBanner');
  if (compareBannerEl) {
    if (!compareMode) {
      compareBannerEl.classList.add('hidden');
      compareBannerEl.innerHTML = '';
    } else if (compareHits.length) {
      const totalPotentialSavings = compareHits.reduce((s, h) => s + h.saveTotal, 0);
      compareBannerEl.classList.remove('hidden');
      compareBannerEl.style.background = '#fef2f2';
      compareBannerEl.style.border = '1.5px solid #dc2626';
      compareBannerEl.style.color = '#7f1d1d';
      compareBannerEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
          <div>
            <strong style="font-size:13px;color:#991b1b;">⚠ LOWER SUPPLIER PRICE FOUND — REVIEW BEFORE PROCEEDING</strong>
            <div style="margin-top:2px;font-weight:600;">${compareHits.length} item(s) cost less at a different supplier — potential savings: <strong>${fmtCurrency(totalPotentialSavings)}</strong></div>
          </div>
          ${
            !isSaved
              ? '<button type="button" id="reorderUncheckCheaperBtn" style="padding:5px 10px;font-size:11px;font-weight:700;background:#b91c1c;color:#fff;border:none;border-radius:6px;cursor:pointer;">UNCHECK CHEAPER-ELSEWHERE ITEMS</button>'
              : ''
          }
        </div>
        <ul style="margin:6px 0 0 18px;padding:0;line-height:1.45;">
          ${compareHits
            .map(
              (h) =>
                `<li><strong>${escAbHtml(h.row.branchName)} · ${escAbHtml(h.row.displayModel || h.row.model)}</strong> (${fmtNum(h.row.qty)} ${h.row.qty === 1 ? 'pc' : 'pcs'}): ${escAbHtml(h.row.supplier || 'Selected')} <strong>${fmtCurrency(h.row.unitCost)}</strong> → <strong style="color:#166534;">${escAbHtml(h.cheaperSupplier)} is ${fmtCurrency(h.cheaperCost)}</strong> (save <strong>${fmtCurrency(h.savePerPc)}/pc</strong> · ${fmtCurrency(h.saveTotal)} total)</li>`
            )
            .join('')}
        </ul>
      `;
      document.getElementById('reorderUncheckCheaperBtn')?.addEventListener('click', () => {
        for (const h of compareHits) {
          state.previewUncheckedKeys.add(h.key);
        }
        renderReorderPreviewModal(`Unchecked ${compareHits.length} item(s) cheaper at another supplier — click BUILD PLAN AGAIN or edit supplier.`);
      });
    } else {
      compareBannerEl.classList.remove('hidden');
      compareBannerEl.style.background = '#ecfdf5';
      compareBannerEl.style.border = '1px solid #10b981';
      compareBannerEl.style.color = '#065f46';
      compareBannerEl.innerHTML = '<strong>✓ BEST SUPPLIER PRICES VERIFIED:</strong> No other recorded supplier offers a lower cost for any selected item in this order.';
    }
  }

  const bodyEl = document.getElementById('reorderPreviewBody');
  const prevScrollTop = bodyEl ? bodyEl.scrollTop : 0;
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
                    const nameLabel = r.brand && !String(r.model || '').toLowerCase().startsWith(String(r.brand || '').toLowerCase())
                      ? `${r.brand} · ${r.model}`
                      : r.model || r.displayModel;
                    const rowKey = r.key || `${r.productId}::${r.branchId}`;
                    const isChecked = isSaved || !state.previewUncheckedKeys.has(rowKey);
                    const cmpHit = compareMode ? (compareByKey.get(rowKey) || (isChecked ? findCheaperOtherSuppliers(r) : null)) : null;
                    const cmpInline = cmpHit && isChecked
                      ? `<div style="font-size:11px;font-weight:700;color:#b91c1c;margin-top:2px;">⚠ Cheaper at ${escAbHtml(cmpHit.cheaperSupplier)}: ${fmtCurrency(cmpHit.cheaperCost)} (save ${fmtCurrency(cmpHit.savePerPc)}/pc)</div>`
                      : '';
                    const costArea = !showCosts
                      ? ''
                      : isSaved
                        ? `<span style="display:inline-flex;align-items:center;gap:4px;color:#4f493a;font-size:11.5px;">
                            <span>₱</span>
                            <input type="number" min="0" step="1" class="reorder-saved-cost-inp" data-item-idx="${r._itemIdx}" value="${Number(r.unitCost) || 0}" title="Edit unit cost (auto-saves to ${sup.supplier})" style="width:76px;padding:2px 5px;font-size:11.5px;font-weight:700;background:#fff;color:#1b1913;border:1px solid #b8ab87;border-radius:5px;text-align:right;" />
                            <span>× ${r.qty} = <strong class="reorder-saved-row-sub" data-item-idx="${r._itemIdx}" style="color:#1b1913;">${fmtCurrency(r.unitCost * r.qty)}</strong></span>
                          </span>`
                        : `<span style="color:#4f493a;font-size:11.5px;">${fmtCurrency(r.unitCost)} × ${r.qty} = <strong style="color:#1b1913;">${fmtCurrency(r.unitCost * r.qty)}</strong></span>`;
                    return `
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:5px ${cmpHit && isChecked ? '6px' : '0'};border-bottom:1px solid #e6e0ce;font-size:12.5px;color:#1b1913;${cmpHit && isChecked ? 'background:#fef2f2;border-radius:4px;' : ''}">
                      ${
                        isSaved
                          ? `<div style="min-width:0;flex:1;"><span style="color:#1b1913;font-weight:500;">${nameLabel}</span>${cmpInline}</div>`
                          : `<label style="display:flex;align-items:flex-start;gap:8px;margin:0;cursor:pointer;flex:1;min-width:0;font-weight:500;font-size:12.5px;color:#1b1913;text-transform:none;letter-spacing:0;">
                              <input type="checkbox" class="reorder-preview-item-chk" data-key="${String(rowKey).replace(/"/g, '&quot;')}" ${isChecked ? 'checked' : ''} style="width:16px;height:16px;margin:2px 0 0;accent-color:#b45309;flex-shrink:0;" />
                              <span style="min-width:0;"><span style="color:${isChecked ? '#1b1913' : '#6b6351'};${isChecked ? '' : 'text-decoration:line-through;opacity:0.55;'}">${nameLabel}</span>${cmpInline}</span>
                            </label>`
                      }
                      <span style="display:flex;align-items:center;gap:10px;white-space:nowrap;${isChecked ? '' : 'opacity:0.45;'}">
                        ${costArea}
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
      bodyEl.scrollTop = prevScrollTop;

      if (!isSaved) {
        bodyEl.querySelectorAll('.reorder-preview-item-chk').forEach((chk) => {
          chk.addEventListener('change', (e) => {
            const key = e.target.dataset.key;
            if (!key) return;
            if (e.target.checked) state.previewUncheckedKeys.delete(key);
            else state.previewUncheckedKeys.add(key);
            renderReorderPreviewModal();
          });
        });
      } else if (showCosts && order) {
        const timers = new Map();
        bodyEl.querySelectorAll('.reorder-saved-cost-inp').forEach((inp) => {
          const itemIdx = Number(inp.dataset.itemIdx);
          inp.addEventListener('input', () => {
            const val = Math.max(0, Number(inp.value) || 0);
            const subEl = bodyEl.querySelector(`.reorder-saved-row-sub[data-item-idx="${itemIdx}"]`);
            const rowQty = Number(order.items?.[itemIdx]?.qty) || 0;
            if (subEl) subEl.textContent = fmtCurrency(val * rowQty);
            autoSaveSavedPreviewItemCost(order, itemIdx, val, false);
            clearTimeout(timers.get(itemIdx));
            timers.set(
              itemIdx,
              setTimeout(() => {
                autoSaveSavedPreviewItemCost(order, itemIdx, val, true);
              }, 600)
            );
          });
          inp.addEventListener('change', () => {
            clearTimeout(timers.get(itemIdx));
            const val = Math.max(0, Number(inp.value) || 0);
            autoSaveSavedPreviewItemCost(order, itemIdx, val, true);
          });
        });
      }
    }
  }

  const rebuildBtn = document.getElementById('reorderRebuildPlanBtn');
  if (rebuildBtn) {
    rebuildBtn.classList.toggle('hidden', isSaved);
    const uncnt = state.previewUncheckedKeys.size;
    rebuildBtn.textContent = uncnt > 0 ? `BUILD PLAN AGAIN (EXCLUDE ${uncnt} UNAVAILABLE)` : 'BUILD PLAN AGAIN';
  }
  const savePlanBtn = document.getElementById('reorderSavePlanBtn');
  if (savePlanBtn) {
    savePlanBtn.classList.toggle('hidden', isSaved);
  }
  const finalizeBtn = document.getElementById('reorderFinalizeOrderBtn');
  if (finalizeBtn) {
    const canFinalize = Boolean(isSaved && order && order.status === 'Draft');
    finalizeBtn.classList.toggle('hidden', !canFinalize);
  }
  const resetBtn = document.getElementById('reorderResetExcludedBtn');
  if (resetBtn) {
    const exCnt = state.restockExcludedKeys.size;
    resetBtn.classList.toggle('hidden', isSaved || exCnt === 0);
    if (exCnt > 0) resetBtn.textContent = `RESET EXCLUDED (${exCnt})`;
  }

  const stEl = document.getElementById('reorderPreviewStatus');
  if (stEl) {
    const uncnt = isSaved ? 0 : state.previewUncheckedKeys.size;
    const exCnt = isSaved ? 0 : state.restockExcludedKeys.size;
    if (statusNote) {
      stEl.style.color = '#1d6f42';
      stEl.textContent = statusNote;
    } else if (isSaved && order) {
      if (order.status === 'Draft') {
        stEl.style.color = '#b45309';
        stEl.textContent = showCosts
          ? 'Saved Draft — edit any unit cost (auto-saves to its specific supplier), then click FINALIZE AS ORDERED.'
          : 'Saved Draft — tick SHOW COSTS to adjust supplier prices, or click FINALIZE AS ORDERED once sent.';
      } else {
        stEl.style.color = '#1d6f42';
        stEl.textContent = `Finalized (${order.status}) ✓ — compared automatically against AB Web deliveries.${showCosts ? ' Cost changes auto-save to supplier.' : ''}`;
      }
    } else if (uncnt > 0) {
      stEl.style.color = '#b45309';
      stEl.textContent = `${uncnt} unit(s) unchecked as unavailable — click BUILD PLAN AGAIN to refill budget with next available units.`;
    } else if (exCnt > 0) {
      stEl.style.color = '#6b6351';
      stEl.textContent = `${exCnt} unavailable unit(s) currently excluded from this plan. Uncheck more or click RESET EXCLUDED to restore.`;
    } else {
      stEl.textContent = '';
    }
  }
}

function downloadReorderPlanPdf(overrideOrder = null) {
  const jspdfNs = window.jspdf;
  if (!jspdfNs || typeof jspdfNs.jsPDF !== 'function') {
    alert('PDF generator library is still loading. Please try again.');
    return;
  }
  const { selected, grouped, isSaved, order } = getGroupedReorderPlan(overrideOrder, true);
  if (!selected.length) {
    alert('No approved products selected to download.');
    return;
  }
  const showCosts = Boolean(document.getElementById('reorderShowCostsChk')?.checked) || Boolean(overrideOrder);
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
  const pdfTitle = isSaved && order ? `AB-GADGETZ · ${order.id} (${order.status.toUpperCase()})` : 'AB-GADGETZ · REORDER PLAN';
  doc.text(pdfTitle, pageWidth / 2, 30 / 72, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(79, 73, 58);
  const totalUnits = selected.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const totalCost = selected.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unitCost) || 0), 0);
  doc.text(
    `${isSaved && order?.title ? `${order.title} · ` : ''}Prepared ${nowLabel} · ${totalUnits} pcs${showCosts ? ` · Total PHP ${fmtNum(Math.round(totalCost))}` : ''}`,
    pageWidth / 2,
    43 / 72,
    { align: 'center' }
  );

  const head = showCosts
    ? [['Branch', 'Brand / Model', 'Qty', 'Unit Price', 'Subtotal']]
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
  if (showCosts) {
    body.push([
      { content: 'TOTAL APPROVED ORDER', colSpan: 2, styles: { fontStyle: 'bold', fillColor: [245, 240, 220] } },
      { content: `${totalUnits} pcs`, styles: { fontStyle: 'bold', halign: 'center', fillColor: [245, 240, 220] } },
      { content: '', styles: { fillColor: [245, 240, 220] } },
      { content: `PHP ${fmtNum(Math.round(totalCost))}`, styles: { fontStyle: 'bold', halign: 'right', fillColor: [245, 240, 220] } },
    ]);
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

  const fileTag = isSaved && order ? order.id : `Reorder_Plan_${todayStr}`;
  doc.save(`AB_Gadgetz_${fileTag}.pdf`);
}

async function downloadReorderPlanExcel(overrideOrder = null) {
  if (!window.ExcelJS) {
    alert('Excel library is still loading. Please try again in a second.');
    return;
  }
  const { selected, grouped, isSaved, order } = getGroupedReorderPlan(overrideOrder, true);
  if (!selected.length) {
    alert('No approved products selected to export.');
    return;
  }
  const showCosts = Boolean(document.getElementById('reorderShowCostsChk')?.checked) || Boolean(overrideOrder);
  const wb = new window.ExcelJS.Workbook();
  const ws = wb.addWorksheet('Purchase Order');

  ws.mergeCells(1, 1, 1, showCosts ? 5 : 3);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = isSaved && order ? `AB-GADGETZ · ${order.id} — ${order.title} (${order.status})` : `AB-GADGETZ · REORDER PLAN (${todayStr})`;
  titleCell.font = { bold: true, size: 13 };
  titleCell.alignment = { horizontal: 'center' };

  const headers = showCosts
    ? ['Branch', 'Brand / Model', 'Approved Qty', 'Approved Price', 'Subtotal']
    : ['Branch', 'Brand / Model', 'Approved Qty'];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((c) => {
    c.font = { bold: true, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBE2BE' } };
    c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });

  let totQty = 0;
  let totCost = 0;
  for (const sup of grouped) {
    const supRow = ws.addRow([sup.supplier]);
    ws.mergeCells(supRow.number, 1, supRow.number, showCosts ? 5 : 3);
    supRow.getCell(1).font = { bold: true, size: 10 };
    supRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F0DC' } };
    for (const b of sup.branches) {
      for (const r of b.rows) {
        const q = Number(r.qty) || 0;
        const c = Number(r.unitCost) || 0;
        totQty += q;
        totCost += q * c;
        const vals = showCosts ? [b.branchName, r.displayModel, q, c, q * c] : [b.branchName, r.displayModel, q];
        const row = ws.addRow(vals);
        if (showCosts) {
          row.getCell(4).numFmt = '"₱"#,##0.00';
          row.getCell(5).numFmt = '"₱"#,##0.00';
        }
        row.eachCell((cell) => {
          cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
        });
      }
    }
  }

  const totRow = ws.addRow(showCosts ? ['TOTAL', '', totQty, '', totCost] : ['TOTAL', '', totQty]);
  totRow.eachCell((cell) => {
    cell.font = { bold: true, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBE2BE' } };
    cell.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });
  if (showCosts) totRow.getCell(5).numFmt = '"₱"#,##0.00';

  ws.columns = showCosts
    ? [{ width: 16 }, { width: 38 }, { width: 13 }, { width: 15 }, { width: 16 }]
    : [{ width: 16 }, { width: 42 }, { width: 14 }];

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const fileTag = isSaved && order ? order.id : `Reorder_Plan_${todayStr}`;
  a.download = `AB_Gadgetz_${fileTag}.xlsx`;
  a.click();
}

async function loadPlanning() {
  try {
    const [planning, budget, act] = await Promise.all([
      api('/api/planning'),
      api('/api/budget'),
      state.planningActivity ? Promise.resolve(state.planningActivity) : api('/api/activity?start=2024-01-01&end=2099-12-31').catch(() => null),
      loadSavedPurchaseOrders(),
      loadAbDeliveries(),
      loadSupplierCatalog(),
    ]);
    state.planning = planning;
    state.budget = budget;
    if (act) state.planningActivity = act;
  } catch {
    await Promise.all([loadSavedPurchaseOrders(), loadAbDeliveries()]);
  }
  if (IS_STATIC_GH && reconcileStaticOrdersWithDeliveries() > 0) {
    await loadSavedPurchaseOrders();
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

function parseMoneyInput(val) {
  const n = Number(String(val ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function formatMoneyInput(val) {
  const n = parseMoneyInput(val);
  if (!(n > 0)) return '';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  // Never wipe a budget the owner typed manually (e.g. ₱200,000) with the auto Net Order Budget (often ₱0)
  if (budgetInp && syncToInput && !state.budgetManual) {
    budgetInp.value = formatMoneyInput(Math.max(0, t.netOrderBudget));
  }
}

// Persist manual budget cap so background sync / re-render can never silently remove it
(function initBudgetPersistence() {
  const inp = document.getElementById('restockBudgetInput');
  if (!inp) return;
  try {
    const saved = Number(localStorage.getItem('ab_restock_budget_manual_v1')) || 0;
    if (saved > 0) {
      state.budgetManual = true;
      inp.value = formatMoneyInput(saved);
    }
  } catch {}
  inp.addEventListener('input', () => {
    const v = parseMoneyInput(inp.value);
    state.budgetManual = v > 0;
    try {
      if (v > 0) localStorage.setItem('ab_restock_budget_manual_v1', String(v));
      else localStorage.removeItem('ab_restock_budget_manual_v1');
    } catch {}
  });
  // Editing the Order Funds panel intentionally goes back to auto Net Order Budget
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || t === inp) return;
    const id = String(t.id || '');
    const cls = String(t.className || '');
    if (/^fund(Metrobank|Maribank|Gcash)$/.test(id) || /fund-(undep|cc|ded)-amt/.test(cls)) {
      state.budgetManual = false;
      try { localStorage.removeItem('ab_restock_budget_manual_v1'); } catch {}
    }
  }, true);
})();

function renderOrderFundsPanel() {
  const f = getOrderFundsState();
  const mEl = document.getElementById('fundMetrobank');
  const mbEl = document.getElementById('fundMaribank');
  const gEl = document.getElementById('fundGcash');
  if (mEl) mEl.value = formatMoneyInput(f.metrobank);
  if (mbEl) mbEl.value = formatMoneyInput(f.maribank);
  if (gEl) gEl.value = formatMoneyInput(f.gcash);

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
            <input type="text" inputmode="decimal" class="fund-undep-amt" data-idx="${idx}" value="${formatMoneyInput(u.amount)}" placeholder="0.00" style="flex:1;min-width:100px;padding:5px 8px;font-size:12px;" />
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
        f.undeposited[Number(e.target.dataset.idx)].amount = parseMoneyInput(e.target.value);
        saveOrderFundsState();
        updateOrderFundsSummaryUI(true);
      });
      el.addEventListener('blur', (e) => {
        e.target.value = formatMoneyInput(parseMoneyInput(e.target.value));
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
          <input type="text" inputmode="decimal" class="fund-cc-amt" data-idx="${idx}" value="${formatMoneyInput(c.amount)}" placeholder="₱0.00" style="padding:5px 8px;font-size:12px;margin-bottom:6px;" />
          <label style="font-size:10px;">DUE DATE</label>
          <input type="date" class="fund-cc-due" data-idx="${idx}" value="${c.dueDate || ''}" style="padding:5px 8px;font-size:12px;" />
        </div>`
      )
      .join('');

    ccGrid.querySelectorAll('.fund-cc-amt').forEach((el) => {
      el.addEventListener('input', (e) => {
        f.creditCards[Number(e.target.dataset.idx)].amount = parseMoneyInput(e.target.value);
        saveOrderFundsState();
        updateOrderFundsSummaryUI(true);
      });
      el.addEventListener('blur', (e) => {
        e.target.value = formatMoneyInput(parseMoneyInput(e.target.value));
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
          <input type="text" inputmode="decimal" class="fund-ded-amt" data-idx="${idx}" value="${formatMoneyInput(d.amount)}" placeholder="0.00" style="flex:1;padding:5px 8px;font-size:12px;" />
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
        f.deductions[Number(e.target.dataset.idx)].amount = parseMoneyInput(e.target.value);
        saveOrderFundsState();
        updateOrderFundsSummaryUI(true);
      });
      el.addEventListener('blur', (e) => {
        e.target.value = formatMoneyInput(parseMoneyInput(e.target.value));
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
  renderSavedOrdersPanel();
  buildRestockDraftPlan();
  renderRestockCards();
}

document.getElementById('savedOrdersToggle')?.addEventListener('click', () => {
  const body = document.getElementById('savedOrdersBody');
  const caret = document.getElementById('savedOrdersCaret');
  if (!body) return;
  const hidden = body.classList.toggle('hidden');
  if (caret) caret.textContent = hidden ? '+' : '−';
});

document.querySelectorAll('.po-subview-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.poview || 'orders';
    document.querySelectorAll('.po-subview-btn').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.classList.toggle('secondary', !active);
    });
    ['orders', 'variance', 'deliveries'].forEach((v) => {
      document.getElementById(`poView-${v}`)?.classList.toggle('hidden', v !== view);
    });
    const body = document.getElementById('savedOrdersBody');
    const caret = document.getElementById('savedOrdersCaret');
    if (body) body.classList.remove('hidden');
    if (caret) caret.textContent = '−';
    if (view === 'variance') renderOrderVarianceReport();
    if (view === 'deliveries') renderAbDeliveriesView();
  });
});

document.getElementById('logNewPendingOrderBtn')?.addEventListener('click', () => {
  openNewPendingOrderCreator();
});
document.getElementById('pasteOrderBtn')?.addEventListener('click', () => {
  const box = document.getElementById('pasteOrderBox');
  if (!box) return;
  const hidden = box.classList.toggle('hidden');
  if (!hidden) document.getElementById('pasteOrderText')?.focus();
});
document.getElementById('closePasteOrderBtn')?.addEventListener('click', () => {
  document.getElementById('pasteOrderBox')?.classList.add('hidden');
});
document.getElementById('parseAndCreateOrderBtn')?.addEventListener('click', () => {
  parseAndCreatePastedOrder();
});
document.getElementById('syncAbDeliveriesBtn')?.addEventListener('click', () => {
  matchSingleOrderWithAbWeb('ALL');
});
document.getElementById('varianceOrderFilter')?.addEventListener('change', renderOrderVarianceReport);
document.getElementById('varianceTypeFilter')?.addEventListener('change', renderOrderVarianceReport);
document.getElementById('variancePdfBtn')?.addEventListener('click', downloadVariancePdf);
document.getElementById('varianceExcelBtn')?.addEventListener('click', downloadVarianceExcel);
document.getElementById('abDeliveryBranchFilter')?.addEventListener('change', renderAbDeliveriesView);

document.getElementById('orderFundsToggle')?.addEventListener('click', () => {
  const body = document.getElementById('orderFundsBody');
  const caret = document.getElementById('orderFundsCaret');
  if (!body) return;
  const hidden = body.classList.toggle('hidden');
  if (caret) caret.textContent = hidden ? '+' : '−';
});

['fundMetrobank', 'fundMaribank', 'fundGcash'].forEach((id) => {
  const el = document.getElementById(id);
  el?.addEventListener('input', (e) => {
    const f = getOrderFundsState();
    const numVal = parseMoneyInput(e.target.value);
    if (id === 'fundMetrobank') f.metrobank = numVal;
    if (id === 'fundMaribank') f.maribank = numVal;
    if (id === 'fundGcash') f.gcash = numVal;
    saveOrderFundsState();
    updateOrderFundsSummaryUI(true);
  });
  el?.addEventListener('blur', (e) => {
    e.target.value = formatMoneyInput(parseMoneyInput(e.target.value));
  });
});
document.getElementById('restockBudgetInput')?.addEventListener('blur', (e) => {
  e.target.value = formatMoneyInput(parseMoneyInput(e.target.value));
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
  state.previewOrderOverride = null;
  state.previewUncheckedKeys = new Set();
  buildRestockDraftPlan();
  renderRestockCards();
  renderReorderPreviewModal();
  document.getElementById('reorderPreviewModal')?.classList.remove('hidden');
});

document.getElementById('previewRestockPlanBtn')?.addEventListener('click', () => {
  state.previewOrderOverride = null;
  state.previewUncheckedKeys = new Set();
  if (!state.restockPlan) buildRestockDraftPlan();
  renderReorderPreviewModal();
  document.getElementById('reorderPreviewModal')?.classList.remove('hidden');
});

document.getElementById('saveNewRestockOrderBtn')?.addEventListener('click', () => createSavedOrderFromDraft());

document.getElementById('restockPriorityMode')?.addEventListener('change', () => {
  buildRestockDraftPlan();
  renderRestockCards();
});

document.getElementById('restockTypeFilter')?.addEventListener('change', () => {
  buildRestockDraftPlan();
  renderRestockCards();
});

document.querySelectorAll('input[name="restockSupplierMode"]').forEach((r) => {
  r.addEventListener('change', () => {
    state.restockExcludedKeys = new Set();
    state.previewUncheckedKeys = new Set();
    buildRestockDraftPlan();
    renderRestockCards();
  });
});

document.getElementById('restockSearchInput')?.addEventListener('input', renderRestockCards);
document.getElementById('restockBrandFilter')?.addEventListener('change', renderRestockCards);
document.getElementById('restockShowFilter')?.addEventListener('change', renderRestockCards);
document.getElementById('restockExcludeObsoleteChk')?.addEventListener('change', () => {
  buildRestockDraftPlan();
  renderRestockCards();
});
document.getElementById('restockDeductPendingChk')?.addEventListener('change', () => {
  buildRestockDraftPlan();
  renderRestockCards();
});
document.getElementById('markAllObsoletePhaseoutBtn')?.addEventListener('click', () => {
  const deadIds = (state.lastObsoleteList || []).filter((x) => x.status === 'DEAD_OBSOLETE').map((x) => x.id);
  if (!deadIds.length) return;
  markProductsPhaseout(deadIds);
});

document.getElementById('reorderSelectAllChk')?.addEventListener('change', (e) => {
  const checked = e.target.checked;
  for (const r of getFilteredRestockRows()) {
    if (state.restockPlan?.[r._idx]) state.restockPlan[r._idx].selected = checked;
  }
  renderRestockCards();
});

document.getElementById('reorderShowCostsChk')?.addEventListener('change', () => renderReorderPreviewModal());
document.getElementById('reorderCompareSuppliersChk')?.addEventListener('change', () => renderReorderPreviewModal());
document.getElementById('reorderRebuildPlanBtn')?.addEventListener('click', () => {
  if (!state.restockExcludedKeys) state.restockExcludedKeys = new Set();
  if (!state.previewUncheckedKeys) state.previewUncheckedKeys = new Set();
  if (state.previewUncheckedKeys.size === 0 && state.restockExcludedKeys.size === 0) {
    const stEl = document.getElementById('reorderPreviewStatus');
    if (stEl) {
      stEl.style.color = '#b45309';
      stEl.textContent = 'Uncheck item(s) not available at supplier first, then click BUILD PLAN AGAIN.';
    }
    return;
  }
  const newlyExcluded = state.previewUncheckedKeys.size;
  for (const key of state.previewUncheckedKeys) {
    state.restockExcludedKeys.add(key);
  }
  state.previewUncheckedKeys.clear();
  state.previewOrderOverride = null;
  buildRestockDraftPlan();
  renderRestockCards();
  renderReorderPreviewModal(
    newlyExcluded > 0
      ? `Rebuilt plan excluding ${newlyExcluded} unavailable item(s) — budget refilled with next available units ✓`
      : 'Rebuilt plan with updated exclusions ✓'
  );
});
document.getElementById('reorderSavePlanBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('reorderSavePlanBtn');
  if (btn) btn.textContent = 'SAVING...';
  try {
    await createSavedOrderFromDraft({ initialStatus: 'Draft', excludeUnchecked: true, openInPreview: true });
  } catch (err) {
    alert(err.message);
  } finally {
    if (btn) btn.textContent = 'SAVE PLAN';
  }
});
document.getElementById('reorderFinalizeOrderBtn')?.addEventListener('click', async () => {
  const ord = state.previewOrderOverride;
  if (!ord) return;
  const btn = document.getElementById('reorderFinalizeOrderBtn');
  if (btn) btn.textContent = 'FINALIZING...';
  try {
    // Flush any live cost edits currently typed into .reorder-saved-cost-inp
    document.querySelectorAll('#reorderPreviewBody .reorder-saved-cost-inp').forEach((inp) => {
      const idx = Number(inp.dataset.itemIdx);
      const val = Math.max(0, Number(inp.value) || 0);
      if (ord.items?.[idx]) {
        ord.items[idx].unitCost = val;
        if (ord.items[idx].receivedQty === undefined || ord.items[idx].receivedQty === null || ord.items[idx].receivedQty === '') {
          ord.items[idx].receivedCost = val;
        }
      }
    });

    const nextStatus = 'Supplier Approved';
    ord.status = nextStatus;
    if (IS_STATIC_GH) {
      const all = getLocalSavedOrders();
      const idx = all.findIndex((o) => o.id === ord.id);
      const updated = { ...ord, status: nextStatus, updatedAt: new Date().toISOString(), ...computeOrderSummaryMetrics(ord.items, nextStatus) };
      if (idx >= 0) all[idx] = updated;
      else all.unshift(updated);
      setLocalSavedOrders(all);
      reconcileStaticOrdersWithDeliveries(updated.id);
      const reloaded = getLocalSavedOrders().find((o) => o.id === updated.id) || updated;
      state.savedOrders = getLocalSavedOrders().map((o) => ({ ...o, ...computeOrderSummaryMetrics(o.items, o.status) }));
      state.previewOrderOverride = reloaded;
    } else {
      const res = await api(`/api/purchase-orders/${encodeURIComponent(ord.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus, items: ord.items, syncSupplierCosts: true }),
      });
      if (res?.order) state.previewOrderOverride = res.order;
      await api(`/api/purchase-orders/${encodeURIComponent(ord.id)}/match-deliveries`, { method: 'POST', body: JSON.stringify({}) }).catch(() => null);
      await loadSavedPurchaseOrders();
      const latest = (state.savedOrders || []).find((o) => o.id === ord.id);
      if (latest) state.previewOrderOverride = latest;
    }

    // Save edited item costs to each item's specific supplier in local state / backend
    for (const it of (state.previewOrderOverride?.items || [])) {
      const c = Number(it.unitCost) || 0;
      if (!it.productId || it.approved === false || !(c > 0)) continue;
      const supU = String(it.supplier || '').toUpperCase();
      const patch = supU.includes('A&K') ? { costAk: c } : supU.includes('ONLINE') ? { costOnline: c } : { costAb: c };
      await saveProductSupplierCosts(it.productId, patch).catch(() => null);
    }

    renderSavedOrdersPanel();
    renderInventory();
    buildRestockDraftPlan();
    renderRestockCards();
    renderReorderPreviewModal(`Finalized as Ordered (${ord.id}) ✓ — Supplier costs synced & pending deliveries will compare with AB Web.`);
  } catch (err) {
    alert(err.message);
  } finally {
    if (btn) btn.textContent = 'FINALIZE AS ORDERED';
  }
});
document.getElementById('reorderResetExcludedBtn')?.addEventListener('click', () => {
  state.restockExcludedKeys = new Set();
  state.previewUncheckedKeys = new Set();
  state.previewOrderOverride = null;
  buildRestockDraftPlan();
  renderRestockCards();
  renderReorderPreviewModal('Restored all previously excluded units ✓');
});
document.getElementById('closeReorderPreviewBtn')?.addEventListener('click', () => {
  document.getElementById('reorderPreviewModal')?.classList.add('hidden');
});
document.getElementById('reorderBackToEditBtn')?.addEventListener('click', () => {
  document.getElementById('reorderPreviewModal')?.classList.add('hidden');
});
document.getElementById('reorderPrintBtn')?.addEventListener('click', () => window.print());
document.getElementById('reorderPdfBtn')?.addEventListener('click', () => downloadReorderPlanPdf(null));
document.getElementById('reorderExcelBtn')?.addEventListener('click', () => downloadReorderPlanExcel(null));
document.getElementById('reorderCopyBtn')?.addEventListener('click', async () => {
  const text = buildReorderCopyText(null);
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
  const abCatCount = state.abSupplierCatalog?.entries?.length || 0;
  const abBadge = document.getElementById('abSupplierCatalogBadge');
  if (abBadge) {
    abBadge.textContent = abCatCount > 0 ? `(${abCatCount} • ${state.abSupplierCatalog?.stockDate || 'Nov 23'})` : '';
  }
  const abSubjCount = (state.inventory?.items || []).filter((it) => it.lifecycle_status === 'Subject to Phaseout').length;
  const abPhasedBadge = document.getElementById('abPhaseoutTrackerBadge');
  if (abPhasedBadge) {
    abPhasedBadge.textContent = abSubjCount > 0 ? `(${abSubjCount})` : '';
  }
  if (state.activeCcView === 'supplierCatalog') {
    renderAbSupplierCatalogView();
  }
  if (state.activeCcView === 'phaseoutTracker') {
    renderSubjectToPhaseoutTracker();
  }
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
    if (!['Active', 'Subject to Phaseout'].includes(item.lifecycle_status || 'Active')) continue;
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
    const srp = Number(item.base_price) || 0;
    const cashPrice = Math.round(srp * 0.95);
    const refCost = best?.val || webCost;
    const srpMarginPct = srp > 0 && refCost > 0 ? ((srp - refCost) / srp) * 100 : null;
    const cashMarginPct = cashPrice > 0 && refCost > 0 ? ((cashPrice - refCost) / cashPrice) * 100 : null;

    rows.push({
      id: item.id,
      displayModel,
      sku: item.website_codes || item.sku,
      totalAvail,
      needsRestock,
      srp,
      cashPrice,
      srpMarginPct,
      cashMarginPct,
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
    if (sortMode === 'MARGIN_DESC') {
      return (b.srpMarginPct ?? -999) - (a.srpMarginPct ?? -999);
    }
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

          const marginColor = r.srpMarginPct === null
            ? 'var(--muted)'
            : r.srpMarginPct >= 10
              ? 'var(--green)'
              : r.srpMarginPct >= 5
                ? 'var(--gold-bright)'
                : '#f87171';
          const priceMarginHtml = r.srp > 0
            ? `<strong>${fmtCurrency(r.srp)}</strong><div class="small" style="color:${marginColor};font-weight:700;">${r.srpMarginPct !== null ? `${r.srpMarginPct.toFixed(1)}% SRP • ${r.cashMarginPct.toFixed(1)}% Cash` : '—'}</div>`
            : '<span class="muted">—</span>';

          const ccProdObj = state.inventory?.items?.find((i) => i.id === r.id);
          const ccSubjBadge = ccProdObj?.lifecycle_status === 'Subject to Phaseout'
            ? '<span class="badge badge-warn" style="margin-left:4px;font-size:10px;">Subject to Phaseout</span>'
            : '';
          return `
            <tr data-pid="${r.id}">
              <td><strong>${r.displayModel}</strong>${ccSubjBadge}<div class="small muted">${r.sku} • ${r.totalAvail} avail</div></td>
              <td>${priceMarginHtml}</td>
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
    : '<tr><td colspan="8" class="muted">No products match the current filter.</td></tr>';

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
        btn.textContent = err?.isAuthHandled ? 'Retry' : 'Err';
        if (!err?.isAuthHandled) alert(err.message);
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

const escAbHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseAbSupplierStockTextClient(rawText, defaultDate = '2026-11-23') {
  const extractDate = (txt, fallback) => {
    const m = String(txt || '').match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\s*,\s*(20\d{2})\b/i);
    if (m) {
      const mm = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' }[m[1].toLowerCase()];
      if (mm) return `${m[3]}-${mm}-${String(parseInt(m[2], 10)).padStart(2, '0')}`;
    }
    const iso = String(txt || '').match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    return iso ? iso[1] : fallback;
  };
  const cleanL = (l) => String(l || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, ' ')
    .replace(/[✅🛑⛄📢🧑🎄🌈⚠️❗🤳⌚🥳*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cleanTitle = (l) => String(l || '')
    .replace(/\(\s*(?:NEW MODEL|LIMITED|NEW PRICE)\s*\)/gi, ' ')
    .replace(/\b(?:NEW PRICE|NEW MODEL)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const lines = String(rawText || '').replace(/\r/g, '').split('\n');
  const defaultStockDate = extractDate(rawText, defaultDate);
  let currentBrand = 'INFINIX';
  let currentCategory = 'Smartphones';
  let sectionDate = defaultStockDate;
  let pendingModel = '';
  let pendingNotes = [];
  let lastParsed = null;
  const results = [];

  for (const rawLine of lines) {
    const trimmedRaw = rawLine.trim();
    if (!trimmedRaw || /^_{4,}$/.test(trimmedRaw)) { pendingModel = ''; pendingNotes = []; continue; }
    const line = cleanL(trimmedRaw);
    if (!line) continue;
    const up = line.toUpperCase();
    if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\s*,\s*20\d{2}\b/i.test(line)) {
      sectionDate = extractDate(line, defaultStockDate);
    }
    if (/POCO STOCK UPDATE|POCO SMARTPHONES/i.test(up)) { currentBrand = 'POCO'; currentCategory = 'Smartphones'; pendingModel = ''; pendingNotes = []; lastParsed = null; continue; }
    if (/OPPO STOCKS|OPPO SMARTPHONES/i.test(up)) { currentBrand = 'OPPO'; currentCategory = 'Smartphones'; pendingModel = ''; pendingNotes = []; lastParsed = null; continue; }
    if (/OPPO AIOT/i.test(up)) { currentBrand = 'OPPO'; currentCategory = 'AIOT & Accessories'; pendingModel = ''; pendingNotes = []; lastParsed = null; continue; }
    if (/INFINIX SMARTPHONES|INFINIX MOBILE/i.test(up)) { currentBrand = 'INFINIX'; currentCategory = 'Smartphones'; pendingModel = ''; pendingNotes = []; lastParsed = null; continue; }
    if (/TABLETS\s*&\s*LAPTOPS/i.test(up)) { currentBrand = 'INFINIX'; currentCategory = 'Tablets & Laptops'; pendingModel = ''; pendingNotes = []; lastParsed = null; continue; }
    if (/INFINIX SMART TV/i.test(up)) { currentBrand = 'INFINIX'; currentCategory = 'Smart TV'; pendingModel = ''; pendingNotes = []; lastParsed = null; continue; }
    if (/AIOT\s*&\s*ACCESSORIES/i.test(up)) { currentBrand = 'INFINIX'; currentCategory = 'AIOT & Accessories'; pendingModel = ''; pendingNotes = []; lastParsed = null; continue; }
    if (up === 'ANKER') { currentBrand = 'ANKER'; currentCategory = 'Anker'; pendingModel = ''; pendingNotes = []; lastParsed = null; continue; }
    if (/TECNO STOCK|TECNO SMARTPHONES/i.test(up)) { currentBrand = 'TECNO'; currentCategory = 'Smartphones'; pendingModel = ''; pendingNotes = []; lastParsed = null; continue; }
    if (/ITEL STOCK|ITEL SMARTPHONES/i.test(up)) { currentBrand = 'ITEL'; currentCategory = 'Smartphones'; pendingModel = ''; pendingNotes = []; lastParsed = null; continue; }
    if (/REALME STOCK|REALME SMARTPHONES/i.test(up)) { currentBrand = 'REALME'; currentCategory = 'Smartphones'; pendingModel = ''; pendingNotes = []; lastParsed = null; continue; }
    if (/^(check out our|thank you|happy selling|good day|available .* stocks|sharing our|blissful|anna liza|br,|(poco|oppo|infinix|tecno|realme|itel)\s*\|\s*tecnix)/i.test(line)) {
      pendingModel = ''; pendingNotes = []; continue;
    }
    if (trimmedRaw.startsWith('⚠️') && lastParsed && !/\bDP\b/i.test(line)) {
      lastParsed.colorsNotes = lastParsed.colorsNotes ? `${lastParsed.colorsNotes} | ${line}` : line;
      continue;
    }
    const beforeSrp = line.split(/\b(?:NEW\s+)?SRP\b/i)[0];
    const dpMatch = beforeSrp.match(/\b(?:NEW\s+)?DP\s*[:\-–]\s*([0-9][0-9,\s]*(?:\.[0-9]+)?)/i);
    if (dpMatch) {
      const dpCost = Math.round(Number(dpMatch[1].replace(/[,\s]+/g, '')) * 100) / 100;
      const rawModel = pendingModel || line.split(/\b(?:NEW\s+)?DP\s*[:\-–]/i)[0].trim();
      if (Number.isFinite(dpCost) && dpCost > 0 && rawModel) {
        let modelName = rawModel.replace(/^[-•–*]+\s*/, '').trim();
        const mu = modelName.toUpperCase();
        if (currentBrand === 'OPPO' && !mu.startsWith('OPPO ')) modelName = `OPPO ${modelName}`;
        else if (currentBrand === 'POCO' && !mu.startsWith('POCO ')) modelName = `POCO ${modelName}`;
        else if (currentBrand === 'ANKER' && !mu.startsWith('ANKER ') && !mu.startsWith('SOUNDCORE ')) modelName = `ANKER ${modelName}`;
        else if (currentBrand === 'INFINIX' && currentCategory === 'Smartphones' && !mu.startsWith('INFINIX ')) modelName = `INFINIX ${modelName}`;
        if (/WATCH\s+S\b/i.test(modelName) && pendingNotes.length) {
          modelName = `${modelName} - ${pendingNotes[0].replace(/\s*\(LIMITED\)\s*/gi, '').trim()}`;
        }
        const entry = { brand: currentBrand, category: currentCategory, modelName, dpCost, colorsNotes: pendingNotes.join(' | '), stockDate: sectionDate || defaultStockDate };
        results.push(entry);
        lastParsed = entry;
      }
      pendingModel = ''; pendingNotes = [];
      continue;
    }
    if (/^\b(?:NEW\s+)?SRP\s*[:\-–]/i.test(line)) continue;
    if (!pendingModel || /^[✅🛑⛄*]/.test(trimmedRaw)) {
      pendingModel = cleanTitle(line);
      pendingNotes = [];
      lastParsed = null;
    } else {
      pendingNotes.push(line);
    }
  }
  const dedup = new Map();
  for (const r of results) dedup.set(r.modelName.toUpperCase(), r);
  return Array.from(dedup.values());
}

function matchSupplierEntryToProductsClient(entry, products) {
  const validProducts = (products || []).filter((p) => !/\bREPO\b|\bREPAIRED\b|\bLDU\b|FREEBIE|FREE BUNDLE|\bFREE\b|\bDEMO\b/.test(`${p.name || ''} ${p.model || ''}`.toUpperCase()));
  const normK = (s) => String(s || '').toLowerCase().replace(/\(repo\)|\(repaired.*?\)|\(ldu\)|\(limited\)|\(new model\)/gi, ' ').replace(/\bbt\b/gi, 'bluetooth').replace(/(\d+)\s*gb\b/gi, '$1').replace(/(\d+)\s*[+/]\s*(\d+)/g, ' $1_$2 ').replace(/[^a-z0-9_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const compK = (s) => normK(s).replace(/[_ ]+/g, '');
  const aliases = {
    pocom8s5g8256: ['prd-poco-85'], pocom8s5g8gb256gb: ['prd-poco-85'],
    infinixgt50pro12256: ['prd-infinix-021'], infinixgt50pro12256gb: ['prd-infinix-021'],
    xpad20pro8256: ['prd-infinix-098', 'prd-xpad-098'], xpad20pro8256gb: ['prd-infinix-098', 'prd-xpad-098'],
    infinixxpad20pro8256: ['prd-infinix-098', 'prd-xpad-098'], xpad30ebtkeyboard: ['prd-xpad-099'],
    xwatchh4xw4l: ['prd-infinix-058'], smartwatchh5proxw5p: ['prd-infinix-032'],
    xwatchn5pro: ['prd-infinix-031'], gtwatch5pro: ['prd-watch-019'],
  };
  const cEntry = compK(entry.modelName);
  if (aliases[cEntry]) {
    const m = validProducts.filter((p) => aliases[cEntry].includes(p.id));
    if (m.length) return m;
  }
  const tk = normK(entry.modelName);
  const ramRom = tk.match(/\b\d+_\d+\b/g) || [];
  const brandU = String(entry.brand || '').toUpperCase();
  const brandPool = validProducts.filter((p) => {
    const tu = `${p.brand || ''} ${p.model || ''} ${p.name || ''}`.toUpperCase();
    if (brandU === 'POCO') return tu.includes('POCO');
    if (brandU === 'OPPO') return tu.includes('OPPO');
    if (brandU === 'ANKER') return tu.includes('ANKER') || tu.includes('SOUNDCORE');
    if (brandU === 'INFINIX') return tu.includes('INFINIX') || tu.includes('XPAD') || tu.includes('XBOOK') || tu.includes('GTBOOK') || tu.includes('XWATCH') || tu.includes('XBUDS');
    return !brandU || tu.includes(brandU);
  });
  const exact = brandPool.filter((p) => compK(`${p.brand || ''} ${p.model || ''}`) === cEntry || compK(p.name) === cEntry);
  if (exact.length) return exact;
  const words = tk.split(' ').filter((w) => w && !/^\d+_\d+$/.test(w) && !['poco', 'oppo', 'infinix', 'anker', 'tecno', 'realme', 'itel', '5g', '4g', 'bt', 'limited'].includes(w));
  if (!words.length) return [];
  return brandPool.filter((p) => {
    const pk = normK(`${p.brand || ''} ${p.model || ''} ${p.name || ''}`);
    const pw = new Set(pk.split(' '));
    const pr = pk.match(/\b\d+_\d+$|\b\d+_\d+\b/g) || [];
    if (ramRom.length) { for (const rr of ramRom) if (!pr.includes(rr)) return false; } else if (pr.length) return false;
    if (/KEYBOARD|CASE|PENCIL/i.test(entry.modelName)) {
      const extra = pk.split(' ').filter((w) => w && !['infinix', 'oppo', 'poco', 'tecno', 'bt', 'bluetooth', 'keyboard', 'case'].includes(w) && !words.includes(w));
      if (extra.some((w) => /\d/.test(w))) return false;
    }
    return words.every((w) => pw.has(w));
  });
}

async function loadSupplierCatalog() {
  try {
    const res = await api('/api/supplier-catalog');
    const byProductId = new Map();
    for (const e of (res.entries || [])) {
      if (e.matchedProductId) byProductId.set(e.matchedProductId, e);
    }
    state.abSupplierCatalog = { stockDate: res.stockDate || '', entries: res.entries || [], byProductId };
    const abBadge = document.getElementById('abSupplierCatalogBadge');
    if (abBadge) {
      abBadge.textContent = state.abSupplierCatalog.entries.length > 0
        ? `(${state.abSupplierCatalog.entries.length} • ${state.abSupplierCatalog.stockDate || 'Nov 23'})`
        : '';
    }
    if (state.activeCcView === 'supplierCatalog') renderAbSupplierCatalogView();
  } catch {}
}

function renderAbSupplierCatalogView() {
  const catalog = state.abSupplierCatalog || { stockDate: '', entries: [] };
  const entries = catalog.entries || [];
  const search = (document.getElementById('abCatSearch')?.value || '').trim().toLowerCase();
  const brandFilter = document.getElementById('abCatBrandFilter')?.value || 'ALL';
  const matchFilter = document.getElementById('abCatMatchFilter')?.value || 'ALL';

  const brandSel = document.getElementById('abCatBrandFilter');
  if (brandSel && entries.length) {
    const existingOpts = new Set(Array.from(brandSel.options).map((o) => o.value));
    for (const b of [...new Set(entries.map((e) => e.brand).filter(Boolean))]) {
      if (!existingOpts.has(b)) {
        const opt = document.createElement('option');
        opt.value = b;
        opt.textContent = b;
        brandSel.appendChild(opt);
      }
    }
  }

  const invMap = new Map((state.inventory?.items || []).map((i) => [i.id, i]));
  const branches = state.inventory?.branches || [];
  const enriched = entries.map((e) => {
    const prod = e.matchedProductId ? invMap.get(e.matchedProductId) : null;
    const basePrice = prod ? Number(prod.base_price) || 0 : Number(e.basePrice) || 0;
    const cashPrice = basePrice > 0 ? Math.round(basePrice * 0.95) : 0;
    const dp = Number(e.dpCost) || 0;
    const marginPhp = basePrice > 0 && dp > 0 ? basePrice - dp : null;
    const marginPct = basePrice > 0 && dp > 0 ? ((basePrice - dp) / basePrice) * 100 : null;
    const lifecycleStatus = prod ? (prod.lifecycle_status || 'Active') : (e.lifecycleStatus || '');
    const totalAvail = prod
      ? branches.reduce((s, b) => s + (Number(prod.byBranch?.[b.id]?.qtyAvailable) || 0), 0)
      : Number(e.totalAvail) || 0;
    return { ...e, basePrice, cashPrice, dp, marginPhp, marginPct, lifecycleStatus, totalAvail };
  });

  const matchedCount = enriched.filter((e) => e.matchedProductId).length;
  const unmatchedCount = enriched.length - matchedCount;
  const activeMatchedCount = enriched.filter((e) => e.matchedProductId && e.lifecycleStatus === 'Active').length;
  const sumGrid = document.getElementById('abSupplierCatalogSummaryGrid');
  if (sumGrid) {
    sumGrid.innerHTML = `
      <div class="summary-box">AB SUPPLIER ITEMS (${escAbHtml(catalog.stockDate || 'Nov 23')})<strong>${fmtNum(enriched.length)}</strong></div>
      <div class="summary-box">SYNCED TO AB WEB PRODUCTS<strong style="color:var(--green);">${fmtNum(matchedCount)} (${fmtNum(activeMatchedCount)} Active)</strong></div>
      <div class="summary-box">WAITING FOR AB WEB INPUT<strong style="color:var(--gold-bright);">${fmtNum(unmatchedCount)}</strong></div>
      <div class="summary-box">SELLING PRICE SOURCE<strong>AB Web Current Prices (SRP Ignored)</strong></div>
    `;
  }

  const filtered = enriched.filter((e) => {
    if (brandFilter !== 'ALL' && e.brand !== brandFilter) return false;
    if (matchFilter === 'MATCHED' && !e.matchedProductId) return false;
    if (matchFilter === 'UNMATCHED' && e.matchedProductId) return false;
    if (search) {
      const hay = `${e.brand} ${e.category} ${e.modelName} ${e.colorsNotes} ${e.productName} ${e.productSku}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const tbody = document.querySelector('#abSupplierCatalogTable tbody');
  if (!tbody) return;
  tbody.innerHTML = filtered.length
    ? filtered
        .map((e) => {
          const sellHtml = e.basePrice > 0
            ? `<strong>${fmtCurrency(e.basePrice)}</strong><div class="small muted">Cash (-5%): ${fmtCurrency(e.cashPrice)}</div>`
            : e.matchedProductId
              ? '<span class="muted small">AB Web ₱0</span>'
              : '<span class="muted small">Waiting for AB Web price (SRP ignored)</span>';
          const marginColor = e.marginPct === null ? 'var(--muted)' : e.marginPct >= 10 ? 'var(--green)' : e.marginPct >= 5 ? 'var(--gold-bright)' : '#f87171';
          const marginHtml = e.marginPct !== null
            ? `<strong style="color:${marginColor};">${e.marginPct.toFixed(1)}%</strong><div class="small" style="color:${marginColor};">${e.marginPhp >= 0 ? '+' : ''}${fmtCurrency(e.marginPhp)}</div>`
            : '<span class="muted">—</span>';
          const statusHtml = e.matchedProductId
            ? e.lifecycleStatus === 'Active'
              ? `<span class="badge badge-ok">On AB Web • Active</span><div class="small muted">${escAbHtml(e.productName)} (${fmtNum(e.totalAvail)} avail)</div>`
              : `<span class="badge badge-warn">${escAbHtml(e.lifecycleStatus || 'Phaseout on AB Web')}</span><div class="small muted">${escAbHtml(e.productName)}</div>${e.basePrice >= e.dp ? `<button type="button" class="secondary ab-cat-reactivate-btn" data-pid="${escAbHtml(e.matchedProductId)}" style="margin-top:4px;padding:2px 8px;font-size:10.5px;min-height:0;">Reactivate</button>` : '<div class="small" style="color:#f59e0b;">Note: AB Web price below new DP</div>'}`
            : '<span class="badge" style="background:rgba(59,130,246,0.18);color:#93c5fd;">Waiting for AB Web Input</span><div class="small muted">DP recorded — links automatically once added on AB Web</div>';

          return `
            <tr>
              <td><strong>${escAbHtml(e.brand)}</strong><div class="small muted">${escAbHtml(e.category)}</div></td>
              <td><strong>${escAbHtml(e.modelName)}</strong>${e.colorsNotes ? `<div class="small" style="color:#34d399;margin-top:2px;">${escAbHtml(e.colorsNotes)}</div>` : ''}</td>
              <td><strong style="color:var(--gold-bright);">${fmtCurrency(e.dp)}</strong><div class="small muted">Updated ${escAbHtml(e.stockDate || '2026-11-23')}</div></td>
              <td>${sellHtml}</td>
              <td>${marginHtml}</td>
              <td>${statusHtml}</td>
            </tr>
          `;
        })
        .join('')
    : '<tr><td colspan="6" class="muted">No AB supplier items match the current filter.</td></tr>';

  tbody.querySelectorAll('.ab-cat-reactivate-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pid = btn.dataset.pid;
      const prod = state.inventory?.items?.find((i) => i.id === pid);
      if (prod) { prod.lifecycle_status = 'Active'; prod.supplier_missing_since = ''; }
      try {
        await api('/api/products/lifecycle', { method: 'PATCH', body: JSON.stringify({ productIds: [pid], status: 'Active' }) });
      } catch (err) {
        alert(err.message);
      }
      renderAbSupplierCatalogView();
      renderCostCompareTool();
      if (state.restockPlan) { buildRestockDraftPlan(); renderRestockCards(); }
    });
  });
}

function renderSubjectToPhaseoutTracker() {
  const items = state.inventory?.items || [];
  const branches = state.inventory?.branches || [];
  const todayIso = manilaTodayClient();
  const tracked = items
    .filter((p) => p.lifecycle_status === 'Subject to Phaseout' || (p.lifecycle_status === 'Phaseout / Do Not Reorder' && p.supplier_missing_since))
    .map((p) => {
      const totalAvail = branches.reduce((s, b) => s + (Number(p.byBranch?.[b.id]?.qtyAvailable) || 0), 0);
      const missingSince = p.supplier_missing_since || '2026-11-23';
      const deadline = addMonthsIsoClient(missingSince, 3);
      const elapsedDays = daysBetweenIsoClient(missingSince, todayIso);
      const daysLeft = deadline ? Math.max(0, daysBetweenIsoClient(todayIso, deadline)) : 0;
      const isPhasedOut = p.lifecycle_status === 'Phaseout / Do Not Reorder';
      return { ...p, totalAvail, missingSince, deadline, elapsedDays, daysLeft, isPhasedOut };
    })
    .sort((a, b) => (a.isPhasedOut !== b.isPhasedOut ? (a.isPhasedOut ? 1 : -1) : b.totalAvail - a.totalAvail || a.name.localeCompare(b.name)));

  const subjOnly = tracked.filter((x) => !x.isPhasedOut);
  const autoPhased = tracked.filter((x) => x.isPhasedOut);
  const withStock = subjOnly.filter((x) => x.totalAvail > 0).length;

  const sumEl = document.getElementById('abPhaseoutSummaryGrid');
  if (sumEl) {
    sumEl.innerHTML = `
      <div class="summary-box">SUBJECT TO PHASEOUT (&lt; 3 MOS)<strong style="color:#fbbf24;">${fmtNum(subjOnly.length)}</strong></div>
      <div class="summary-box">SELLABLE IN-STOCK LEFT<strong>${fmtNum(withStock)} models</strong></div>
      <div class="summary-box">AUTO-PHASED OUT (&ge; 3 MOS)<strong style="color:#f87171;">${fmtNum(autoPhased.length)}</strong></div>
      <div class="summary-box">RESTOCK PROTECTION<strong>Excluded from New Reorders</strong></div>
    `;
  }

  const tbody = document.querySelector('#abPhaseoutTrackerTable tbody');
  if (!tbody) return;
  tbody.innerHTML = tracked.length
    ? tracked
        .map((p) => {
          const dispName = formatSwapModelName({ brand: p.brand || '', model: p.model || p.name });
          const lastCost = Number(p.cost_ab) || Number(p.cost_price) || 0;
          const deadlineHtml = p.isPhasedOut
            ? `<span style="color:#f87171;font-weight:700;">Passed 3 months (since ${escAbHtml(p.missingSince)})</span>`
            : `<strong>Since ${escAbHtml(p.missingSince)}</strong><div class="small muted">Auto-phaseout: ${escAbHtml(p.deadline || '—')} (${fmtNum(p.daysLeft)}d left)</div>`;
          const statusHtml = p.isPhasedOut
            ? '<span class="badge" style="background:rgba(239,68,68,0.18);color:#f87171;">Phaseout / Do Not Reorder</span>'
            : '<span class="badge badge-warn">Subject to Phaseout</span>';
          const actionsHtml = p.isPhasedOut
            ? `<button type="button" class="secondary ph-restore-btn" data-pid="${escAbHtml(p.id)}" style="padding:3px 8px;font-size:11px;min-height:0;">Restore Active</button>`
            : `<div style="display:flex;gap:4px;flex-wrap:wrap;"><button type="button" class="secondary ph-restore-btn" data-pid="${escAbHtml(p.id)}" style="padding:3px 8px;font-size:11px;min-height:0;">Keep Active</button><button type="button" class="danger ph-force-btn" data-pid="${escAbHtml(p.id)}" style="padding:3px 8px;font-size:11px;min-height:0;">Phaseout Now</button></div>`;
          return `
            <tr>
              <td><strong>${escAbHtml(dispName)}</strong><div class="small muted">${escAbHtml(p.brand)} • ${escAbHtml(p.product_type || 'Cellphones')} • ${escAbHtml(p.sku || '')}</div></td>
              <td><strong>${fmtNum(p.totalAvail)} pcs</strong></td>
              <td><strong>${p.base_price > 0 ? fmtCurrency(p.base_price) : '—'}</strong><div class="small muted">Last Cost: ${lastCost > 0 ? fmtCurrency(lastCost) : '—'}</div></td>
              <td>${deadlineHtml}</td>
              <td>${statusHtml}</td>
              <td>${actionsHtml}</td>
            </tr>
          `;
        })
        .join('')
    : '<tr><td colspan="6" class="muted">No products currently flagged as Subject to Phaseout.</td></tr>';

  const setLc = async (pid, nextStatus) => {
    const prod = state.inventory?.items?.find((i) => i.id === pid);
    if (prod) {
      prod.lifecycle_status = nextStatus;
      if (nextStatus === 'Active') prod.supplier_missing_since = '';
    }
    try {
      await api('/api/products/lifecycle', { method: 'PATCH', body: JSON.stringify({ productIds: [pid], status: nextStatus }) });
    } catch (err) {
      alert(err.message);
    }
    renderCostCompareTool();
    renderInventory();
    if (state.restockPlan) { buildRestockDraftPlan(); renderRestockCards(); }
  };

  tbody.querySelectorAll('.ph-restore-btn').forEach((b) => b.addEventListener('click', () => setLc(b.dataset.pid, 'Active')));
  tbody.querySelectorAll('.ph-force-btn').forEach((b) => b.addEventListener('click', () => setLc(b.dataset.pid, 'Phaseout / Do Not Reorder')));
}

document.querySelectorAll('.cc-subview-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.activeCcView = btn.dataset.ccview || 'compare';
    document.querySelectorAll('.cc-subview-btn').forEach((b) => {
      const active = b.dataset.ccview === state.activeCcView;
      b.classList.toggle('active', active);
      b.classList.toggle('secondary', !active);
    });
    document.getElementById('ccView-compare')?.classList.toggle('hidden', state.activeCcView !== 'compare');
    document.getElementById('ccView-supplierCatalog')?.classList.toggle('hidden', state.activeCcView !== 'supplierCatalog');
    document.getElementById('ccView-phaseoutTracker')?.classList.toggle('hidden', state.activeCcView !== 'phaseoutTracker');
    if (state.activeCcView === 'supplierCatalog') renderAbSupplierCatalogView();
    if (state.activeCcView === 'phaseoutTracker') renderSubjectToPhaseoutTracker();
  });
});

document.getElementById('abCatSearch')?.addEventListener('input', renderAbSupplierCatalogView);
document.getElementById('abCatBrandFilter')?.addEventListener('change', renderAbSupplierCatalogView);
document.getElementById('abCatMatchFilter')?.addEventListener('change', renderAbSupplierCatalogView);

document.getElementById('openAbSupplierPasteBtn')?.addEventListener('click', () => {
  document.getElementById('abSupplierPasteBox')?.classList.toggle('hidden');
});
document.getElementById('closeAbSupplierPasteBtn')?.addEventListener('click', () => {
  document.getElementById('abSupplierPasteBox')?.classList.add('hidden');
});

document.getElementById('previewAbSupplierPasteBtn')?.addEventListener('click', async () => {
  const rawText = document.getElementById('abSupplierPasteText')?.value || '';
  const statusEl = document.getElementById('abSupplierPasteStatus');
  const prevEl = document.getElementById('abSupplierPastePreview');
  if (!rawText.trim()) {
    if (statusEl) statusEl.textContent = 'Paste AB supplier text first.';
    return;
  }
  try {
    const res = await api('/api/supplier-catalog/import', {
      method: 'POST',
      body: JSON.stringify({ rawText, dryRun: true }),
    });
    const matchedEntries = (res.entries || []).filter((e) => (e.matched || []).length > 0);
    if (statusEl) {
      statusEl.textContent = `Parsed ${res.entries?.length || 0} supplier items • ${matchedEntries.length} match existing AB Web products (selling prices preserved).`;
    }
    if (prevEl) {
      prevEl.classList.remove('hidden');
      prevEl.innerHTML = matchedEntries.length
        ? matchedEntries.map((e) => e.matched.map((m) => `<div><strong>${escAbHtml(m.name)}</strong>: Old AB ${m.prevAb ? fmtCurrency(m.prevAb) : '—'} → <strong style="color:var(--gold-bright);">${fmtCurrency(m.nextAb)}</strong> <span class="muted">(AB Web Selling: ${fmtCurrency(m.basePrice)})</span></div>`).join('')).join('')
        : '<div class="muted">No existing AB Web product matches yet; all parsed items will still save into AB Supplier Stock & DP Catalog.</div>';
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message;
  }
});

document.getElementById('applyAbSupplierPasteBtn')?.addEventListener('click', async () => {
  const rawText = document.getElementById('abSupplierPasteText')?.value || '';
  const stockDate = document.getElementById('abSupplierDateInp')?.value || '';
  const statusEl = document.getElementById('abSupplierPasteStatus');
  if (!rawText.trim()) {
    if (statusEl) statusEl.textContent = 'Paste AB supplier text first.';
    return;
  }
  try {
    const res = await api('/api/supplier-catalog/import', {
      method: 'POST',
      body: JSON.stringify({ rawText, stockDate }),
    });
    await loadInventory();
    await loadSupplierCatalog();
    renderCostCompareTool();
    if (state.restockPlan) {
      buildRestockDraftPlan();
      renderRestockCards();
    }
    if (statusEl) {
      statusEl.style.color = '#34d399';
      statusEl.textContent = `Applied ${res.importedCount} items (${res.updatedProductsCount} synced to AB Web, ${res.waitingCount || 0} waiting for AB Web, ${res.subjectToPhaseoutCount || 0} subject to phaseout${res.autoPhasedOutCount ? `, ${res.autoPhasedOutCount} auto-phased out` : ''})!`;
    }
    document.getElementById('abSupplierPastePreview')?.classList.add('hidden');
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message;
  }
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
    if (IS_STATIC_GH && btn.closest('#tab-staffPins')) {
      document.getElementById('saveStaffPinsBtn')?.click();
      return;
    }
    const origText = btn.textContent;
    const isIconBtn = btn.classList.contains('owner-icon-btn');
    btn.disabled = true;
    btn.textContent = isIconBtn ? '⏳' : 'Updating...';
    const catMsg = document.getElementById('publishCatalogMsg');
    const photoMsg = document.getElementById('photoMsg');
    try {
      const publishStaffOnly = btn.parentElement?.querySelector('#saveStaffPinsBtn') || origText.includes('PINs');
      const res = await api(publishStaffOnly ? '/api/staff-pins/publish' : '/api/catalog/publish-github', { method: 'POST', body: '{}' });
      if (catMsg) catMsg.textContent = res.message;
      if (photoMsg) photoMsg.textContent = res.message;
      btn.textContent = isIconBtn ? '✓' : '✓ Updated!';
      setTimeout(() => { btn.textContent = origText; }, 3000);
    } catch (err) {
      const errText = `Publish failed: ${err.message}`;
      if (catMsg) catMsg.textContent = errText;
      if (photoMsg) photoMsg.textContent = errText;
      if (!err?.isAuthHandled) alert(errText);
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

function isFreebieMovement(m) {
  if (!m) return false;
  if (typeof isFreebieAccessory === 'function' && isFreebieAccessory(m)) return true;
  if (state.inventory?.items && m.product_id) {
    const prod = state.inventory.items.find((i) => i.id === m.product_id);
    if (prod && typeof isFreebieAccessory === 'function' && isFreebieAccessory(prod)) return true;
  }
  const nm = String(m.product_name || m.name || m.model || '');
  return /\b(freebie|freebies|eco\s*bag|gift\s*box|free\s+sim|free\s+bundle|magbadge)\b/i.test(nm);
}

let activeActivityReqSeq = 0;

async function loadActivity() {
  const start = document.getElementById('actStart').value;
  const end = document.getElementById('actEnd').value;
  const globalBranch = document.getElementById('globalBranch').value;
  if (globalBranch) state.actBranchFilter = globalBranch;
  const seq = ++activeActivityReqSeq;

  // 1. Load and render Activity Log IMMEDIATELY without waiting on external view counters
  const activity = await api(`/api/activity?start=${start}&end=${end}`);
  if (seq !== activeActivityReqSeq) return;
  state.activity = activity;
  renderActivity();

  // 2. Load Catalog Views in the background with 60s per-range cache
  if (!state.viewsCache) state.viewsCache = new Map();
  const cacheKey = `${start}::${end}`;
  const cached = state.viewsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 60000) {
    state.catalogViews = cached.data;
    renderActivityViewsOnly();
    return;
  }
  api(`/api/catalog/views?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
    .then((catalogViews) => {
      if (catalogViews) state.viewsCache.set(cacheKey, { ts: Date.now(), data: catalogViews });
      if (seq !== activeActivityReqSeq) return;
      state.catalogViews = catalogViews;
      renderActivityViewsOnly();
    })
    .catch(() => {});
}

function renderActivityViewsOnly() {
  const views = state.catalogViews?.byBranch || {};
  const vMol = views['br-molave'] || { total: 0 };
  const vTam = views['br-tambulig'] || { total: 0 };
  const vBon = views['br-bonifacio'] || { total: 0 };
  const vTot = state.catalogViews || { total: 0 };
  const viewsGrid = document.getElementById('activityViewsGrid');
  const viewsLbl = document.getElementById('catalogViewsToggleLabel');
  if (viewsLbl) {
    viewsLbl.textContent = `Catalog Views (${fmtNum(vTot.total)} views${vTot.allTimeTotal ? ` • All-time: ${fmtNum(vTot.allTimeTotal)}` : ''})`;
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
}

function renderActivity() {
  const data = state.activity;
  if (!data) return;

  const pType = state.actProductType;
  const mode = state.actSaleMode;
  const branchFilter = state.actBranchFilter;

  const filterMovementType = (m) => pType === 'ALL' || (m.product_type || 'Cellphones') === pType;
  const isCashSale = (m) => m.delta_qty < 0 && m.movement_type.includes('SALE') && !m.movement_type.includes('INSTALLMENT') && !isFreebieMovement(m);
  const isAnySale = (m) => m.delta_qty < 0 && m.movement_type.includes('SALE') && !isFreebieMovement(m);

  // Compute clickable branch sold totals (excluding freebies)
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
  renderActivityViewsOnly();
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
      if (m.movement_type.includes('SALE') && isFreebieMovement(m)) return false;
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
  if (s.isSyncing) txt.textContent = 'Syncing...';
  else if (s.paused) txt.textContent = `Paused • ${fmtTime(s.lastSyncAt)}`;
  else txt.textContent = fmtTime(s.lastSyncAt);
  toggleBtn.textContent = s.paused ? '▶️' : '⏸️';
  toggleBtn.title = s.paused ? 'Resume Auto-Sync' : 'Pause Auto-Sync';
}

// Event bindings
document.getElementById('globalBranch').addEventListener('change', () => {
  if (state.activeTab === 'inventory') {
    renderInventory();
    renderHealth();
    if (state.activeInvTool === 'restock') renderPlanning();
  } else if (state.activeTab === 'cashflow') {
    renderCashFlow();
  } else if (state.activeTab === 'sales') {
    loadSalesSummary(false);
  } else if (state.activeTab === 'activity') {
    loadActivity();
  } else if (state.activeTab === 'finance') {
    loadFinance();
  } else if (state.activeTab === 'receivables') {
    loadReceivables();
  } else if (state.activeTab === 'quotas') {
    renderQuotas();
  }
});
let invSearchTimer = null;
document.getElementById('invSearch').addEventListener('input', () => {
  clearTimeout(invSearchTimer);
  invSearchTimer = setTimeout(renderInventory, 120);
});
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
  const finBranchEl = document.getElementById('finBranchFilter');
  const globalBranch = document.getElementById('globalBranch').value;
  const branchId = finBranchEl ? finBranchEl.value : globalBranch;
  // Fetch all branches for comparative table, plus apply branchId filter for KPIs & details
  const [allData, scopedData] = await Promise.all([
    api(`/api/finance/summary?start=${start}&end=${end}`),
    branchId ? api(`/api/finance/summary?start=${start}&end=${end}&branchId=${branchId}`) : Promise.resolve(null),
  ]);
  const data = scopedData || allData;

  const t = data.totals;
  document.getElementById('financeKpiGrid').innerHTML = `
    <div class="summary-box">
      CASH + COLLECTIONS INFLOW
      <strong>${fmtCurrency(t.abWebCashInflow ?? t.collections)}</strong>
      <span class="summary-note">Cash Sales: ${fmtCurrency(t.cashNetSales || 0)} • DP: ${fmtCurrency(t.downpayments || 0)} • Coll: ${fmtCurrency(t.collections)}</span>
    </div>
    <div class="summary-box">
      CASH GROSS PROFIT + FIN. INCOME
      <strong style="color:var(--green);">${fmtCurrency((t.cashGrossProfit || 0) + t.financingIncome)}</strong>
      <span class="summary-note">Cash GP: ${fmtCurrency(t.cashGrossProfit || 0)} • Fin. Inc: ${fmtCurrency(t.financingIncome)}</span>
    </div>
    <div class="summary-box">
      TOTAL OPERATING EXPENSES
      <strong style="color:var(--danger);">${fmtCurrency(t.expenses)}</strong>
      <span class="summary-note">${data.expensesByType.length} expense categories</span>
    </div>
    <div class="summary-box" style="border-color:var(--gold);">
      NET INCOME (CASH GP + FIN − EXP)
      <strong style="color:${(t.properNetIncome ?? t.netCashFlow) >= 0 ? 'var(--green)' : 'var(--danger)'};">${fmtCurrency(t.properNetIncome ?? t.netCashFlow)}</strong>
      <span class="summary-note">Net Cash Flow: ${fmtCurrency(t.netCashFlow)}</span>
    </div>
  `;

  // Render Comparative Income Statement
  const stmtTbody = document.querySelector('#financeIncomeStmtTable tbody');
  const noteEl = document.getElementById('financeAnalysisNote');
  if (stmtTbody && allData) {
    const byId = new Map((allData.byBranch || []).map((b) => [b.branchId, b]));
    const bon = byId.get('br-bonifacio') || {};
    const mol = byId.get('br-molave') || {};
    const tam = byId.get('br-tambulig') || {};
    const tot = allData.totals || {};

    const cols = branchId
      ? [byId.get(branchId) || tot]
      : [mol, tam, bon, tot];

    const theadRow = document.querySelector('#financeIncomeStmtTable thead tr');
    if (theadRow) {
      theadRow.innerHTML = branchId
        ? `<th>Income Statement Line Item</th><th>${(byId.get(branchId)?.branchName || 'Selected Branch')}</th>`
        : `<th>Income Statement Line Item</th><th>Molave</th><th>Tambulig</th><th>Bonifacio</th><th>Total (All Branches)</th>`;
    }

    const rowHtml = (label, getter, opts = {}) => {
      const style = opts.bold ? 'font-weight:700;background:rgba(255,255,255,0.03);' : '';
      const valColor = opts.color || '';
      return `<tr style="${style}"><td>${label}</td>${cols
        .map((c) => {
          const v = Number(getter(c)) || 0;
          const clr = opts.autoColor ? (v >= 0 ? 'var(--green)' : 'var(--danger)') : valColor;
          return `<td ${clr ? `style="color:${clr};"` : ''}>${opts.bold ? `<strong>${fmtCurrency(v)}</strong>` : fmtCurrency(v)}</td>`;
        })
        .join('')}</tr>`;
    };

    stmtTbody.innerHTML = [
      rowHtml('Gross Cash Sales (SRP)', (c) => c.cashGrossSrp),
      rowHtml('Less: Cash Sales Discounts', (c) => -(c.cashDiscount || 0), { color: 'var(--muted)' }),
      rowHtml('Net Cash Sales', (c) => c.cashNetSales, { bold: true }),
      rowHtml('Less: Cash Cost of Goods Sold (FIFO)', (c) => -(c.cashCogs || 0), { color: 'var(--danger)' }),
      rowHtml('Cash Sales Gross Profit', (c) => c.cashGrossProfit, { bold: true, color: 'var(--green)' }),
      rowHtml('Add: Financing / Interest Income (Int + Pen − Rebates)', (c) => c.financingIncome, { color: 'var(--green)' }),
      rowHtml('Total Recognized Gross Profit (Cash GP + Fin. Income)', (c) => (c.cashGrossProfit || 0) + (c.financingIncome || 0), { bold: true }),
      rowHtml('Less: Operating Expenses', (c) => -(c.expenses || 0), { color: 'var(--danger)' }),
      rowHtml('Net Operating Income (excl. Installment Unit Profit)', (c) => c.properNetIncome, { bold: true, autoColor: true }),
      rowHtml('Memo: Installment Contract Sales (New Accounts)', (c) => c.installmentSales, { color: 'var(--muted)' }),
      rowHtml('Memo: Downpayments Collected', (c) => c.downpayments, { color: 'var(--muted)' }),
      rowHtml('Memo: Installment Payments Collected', (c) => c.collections, { color: 'var(--muted)' }),
      rowHtml('Memo: AB Web "Gross Sales" (Total Cash Inflow = DP + Cash + Coll)', (c) => c.abWebCashInflow, { bold: true, color: 'var(--gold-bright)' }),
    ].join('');

    if (noteEl) {
      noteEl.innerHTML = `<strong>Auditor Note on AB Web Differences:</strong> AB Web's dashboard labels <strong>Downpayments + Cash Sales + Installment Collections</strong> (${fmtCurrency(tot.abWebCashInflow)}) as <em>"GROSS SALES"</em> — that is actually <strong>Total Cash Inflow</strong>, not Revenue (it double-counts installment principal). Above is the proper Income Statement separating <strong>Cash Sales Revenue</strong>, <strong>FIFO COGS</strong>, <strong>Financing Income</strong>, and <strong>Operating Expenses</strong>.`;
    }
  }

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

function getEffectiveDaysDue(pd) {
  let days = Number(pd?.days_due) || 0;
  const relDate = String(pd?.release_date || '').slice(0, 10);
  const acct = String(pd?.account_no || '').trim();
  const unit = String(pd?.unit || '').toUpperCase();
  const is2023 = relDate.startsWith('2023-') || /-23$/.test(acct) || unit.includes('INSTALLMENT PHONE SAMPLE');
  if (is2023 && days < 180) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(relDate)) {
      const ageDays = Math.max(0, Math.floor((Date.now() - new Date(`${relDate}T00:00:00Z`).getTime()) / 86400000));
      days = Math.max(days, Math.max(365, ageDays - 30));
    } else {
      days = Math.max(days, 1000);
    }
  }
  return days;
}

function getLocalBranchQuotas() {
  try {
    const d = JSON.parse(localStorage.getItem('ab_branch_quotas_v1') || '{}');
    return { updatedAt: d.updatedAt || null, months: d.months && typeof d.months === 'object' ? d.months : {} };
  } catch {
    return { updatedAt: null, months: {} };
  }
}

function saveLocalBranchQuotas(qObj) {
  try {
    localStorage.setItem('ab_branch_quotas_v1', JSON.stringify(qObj));
  } catch {}
}

async function pushBranchQuotasToGh(quotasObj, token) {
  const repo = 'ab-gadgetz/ab-gadgetz.github.io';
  const apiUrl = `https://api.github.com/repos/${repo}/contents/public/branch-quotas.json`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  let sha;
  let merged = { updatedAt: new Date().toISOString(), months: { ...(quotasObj.months || {}) } };
  const getRes = await fetch(apiUrl, { headers });
  if (getRes.ok) {
    const info = await getRes.json();
    sha = info.sha;
    try {
      const decoded = decodeURIComponent(escape(atob(String(info.content || '').replace(/\n/g, ''))));
      const existing = JSON.parse(decoded);
      if (existing?.months) {
        const m = { ...existing.months };
        for (const [ym, brMap] of Object.entries(quotasObj.months || {})) {
          m[ym] = { ...(m[ym] || {}), ...brMap };
        }
        merged.months = m;
      }
    } catch {}
  }
  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Update monthly release targets and collection quotas',
      content: btoa(unescape(encodeURIComponent(JSON.stringify(merged, null, 2)))),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!putRes.ok) {
    const errData = await putRes.json().catch(() => ({}));
    throw new Error(errData.message || `GitHub quota sync failed (${putRes.status})`);
  }
  fetch(`https://api.github.com/repos/${repo}/actions/workflows/deploy-catalog.yml/dispatches`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
  }).catch(() => {});
  return true;
}

async function loadQuotas(forceRefresh = false) {
  const mEl = document.getElementById('quotaMonthInput');
  if (mEl && !mEl.value) mEl.value = todayStr.slice(0, 7);
  if (!forceRefresh && state.quotasData && Date.now() - (state._quotasLoadedAt || 0) < 300000) {
    renderQuotas();
    return;
  }
  state.quotasData = await api(forceRefresh ? '/api/quotas?refresh=1' : '/api/quotas');
  state._quotasLoadedAt = Date.now();
  renderQuotas();
}

function renderQuotas() {
  const data = state.quotasData;
  const kpiEl = document.getElementById('quotaKpiGrid');
  const cardsEl = document.getElementById('quotaBranchCards');
  if (!data || !kpiEl || !cardsEl) return;

  const ym = document.getElementById('quotaMonthInput')?.value || todayStr.slice(0, 7);
  const isAdmin = state.userRole === 'ADMIN';
  const branchDefs = [
    { id: 'br-molave', name: 'Molave' },
    { id: 'br-tambulig', name: 'Tambulig' },
    { id: 'br-bonifacio', name: 'Bonifacio' },
  ];
  const scopedBranch = !isAdmin && state.userBranchId
    ? state.userBranchId
    : (document.getElementById('globalBranch')?.value || '');
  const visibleBranches = scopedBranch ? branchDefs.filter((b) => b.id === scopedBranch) : branchDefs;

  const monthTargets = (data.quotas?.months && data.quotas.months[ym]) || {};
  const webSummaries = data.webSummaries || {};

  // Compute monthly actuals per branch from installments & payments
  const actuals = {};
  for (const b of branchDefs) {
    actuals[b.id] = { relCount: 0, relPrincipal: 0, relFinanced: 0, rel46: 0, rel712: 0, collAmount: 0, collCount: 0 };
  }
  for (const i of data.installments || []) {
    const dt = String(i.sale_date || '').slice(0, 7);
    if (dt !== ym || !actuals[i.branch_id]) continue;
    const a = actuals[i.branch_id];
    const prin = Number(i.principal_amount) || 0;
    const fin = Math.max(0, (Number(i.amount) || 0) - (Number(i.deposit) || 0));
    const term = Number(i.term) || 0;
    a.relCount++;
    a.relPrincipal += prin;
    a.relFinanced += fin;
    if (term >= 4 && term <= 6) a.rel46 += fin;
    else if (term >= 7 && term <= 12) a.rel712 += fin;
  }
  for (const p of data.payments || []) {
    const dt = String(p.payment_date || '').slice(0, 7);
    if (dt !== ym || !actuals[p.branch_id]) continue;
    actuals[p.branch_id].collCount++;
    actuals[p.branch_id].collAmount += Number(p.amount) || 0;
  }

  let totMinRel = 0, totMaxRel = 0, totActRel = 0, totRelCount = 0;
  let totBomQuota = 0, totActColl = 0, totLiveQuota = 0;

  for (const b of visibleBranches) {
    const t = monthTargets[b.id] || {};
    const a = actuals[b.id];
    const ws = webSummaries[b.id] || {};
    totMinRel += Number(t.minRelease) || 0;
    totMaxRel += Number(t.maxRelease) || 0;
    totActRel += a.relPrincipal;
    totRelCount += a.relCount;
    totBomQuota += Number(t.bomQuota) || 0;
    totActColl += a.collAmount;
    totLiveQuota += Number(ws.liveQuota) || 0;
  }

  const relPctMin = totMinRel > 0 ? Math.min(999, (totActRel / totMinRel) * 100) : 0;
  const collPct = totBomQuota > 0 ? Math.min(999, (totActColl / totBomQuota) * 100) : 0;

  kpiEl.innerHTML = `
    <div class="summary-box sales-big-box">
      <div class="sales-big-main">
        <div class="sales-big-title">MONTHLY INSTALLMENT RELEASE (${ym})</div>
        <strong class="sales-big-val" style="color:${totMinRel > 0 && totActRel >= totMinRel ? 'var(--green)' : 'var(--gold-bright)'};">${fmtCurrency(totActRel)}</strong>
        <div class="summary-note">${totRelCount} releases • Min: <strong>${totMinRel > 0 ? fmtCurrency(totMinRel) : 'Not set'}</strong> • Max: <strong>${totMaxRel > 0 ? fmtCurrency(totMaxRel) : 'Not set'}</strong>${totMinRel > 0 ? ` (${relPctMin.toFixed(1)}% of Min)` : ''}</div>
      </div>
    </div>
    <div class="summary-box sales-big-box" style="border-color:var(--gold);">
      <div class="sales-big-main">
        <div class="sales-big-title">COLLECTION QUOTA VS ACTUAL (${ym})</div>
        <strong class="sales-big-val" style="color:${totBomQuota > 0 && totActColl >= totBomQuota ? 'var(--green)' : '#60a5fa'};">${fmtCurrency(totActColl)}</strong>
        <div class="summary-note">BOM Target: <strong>${totBomQuota > 0 ? fmtCurrency(totBomQuota) : 'Not locked'}</strong>${totBomQuota > 0 ? ` (${collPct.toFixed(1)}% • Rem: ${fmtCurrency(Math.max(0, totBomQuota - totActColl))})` : ''} • Live Today: <strong style="color:var(--gold-bright);">${fmtCurrency(totLiveQuota)}</strong></div>
      </div>
    </div>
  `;

  const isCurMonth = ym === todayStr.slice(0, 7);
  cardsEl.innerHTML = visibleBranches.map((b) => {
    const t = monthTargets[b.id] || {};
    const a = actuals[b.id];
    const ws = webSummaries[b.id] || {};
    const minRel = Number(t.minRelease) || 0;
    const maxRel = Number(t.maxRelease) || 0;
    const bomQuota = Number(t.bomQuota) || 0;
    const bom46 = Number(t.bomBal4to6) || 0;
    const bom712 = Number(t.bomBal7to12) || 0;

    // Estimate BOM by reversing current month's collections & releases from live Web AB balances
    const live46 = Number(ws.bal4to6) || 0;
    const live712 = Number(ws.bal7to12) || 0;
    const liveTot = live46 + live712;
    const share46 = liveTot > 0 ? live46 / liveTot : 0.5;
    const estBom46 = isCurMonth && liveTot > 0 ? Math.max(0, Math.round(live46 + a.collAmount * share46 - a.rel46)) : 0;
    const estBom712 = isCurMonth && liveTot > 0 ? Math.max(0, Math.round(live712 + a.collAmount * (1 - share46) - a.rel712)) : 0;
    const estBomQ = Number((estBom46 * 0.275 + estBom712 * 0.11).toFixed(2));

    const relBarMax = maxRel > 0 ? maxRel : (minRel > 0 ? minRel : Math.max(1, a.relPrincipal));
    const relBarPct = Math.min(100, (a.relPrincipal / relBarMax) * 100);
    let relBadge = '<span class="badge" style="font-size:10px;">No Target</span>';
    if (minRel > 0 || maxRel > 0) {
      if (maxRel > 0 && a.relPrincipal > maxRel) relBadge = '<span class="badge" style="background:rgba(245,158,11,0.2);color:#fbbf24;font-size:10px;">Over Max</span>';
      else if (a.relPrincipal >= minRel) relBadge = '<span class="badge badge-ok" style="font-size:10px;">Target Met ✓</span>';
      else relBadge = '<span class="badge" style="background:rgba(96,165,250,0.2);color:#93c5fd;font-size:10px;">In Progress</span>';
    }

    const collBarPct = bomQuota > 0 ? Math.min(100, (a.collAmount / bomQuota) * 100) : 0;
    const collRem = bomQuota > 0 ? Math.max(0, bomQuota - a.collAmount) : 0;

    return `
      <div class="sub-panel quota-branch-card" data-branch="${b.id}" style="padding:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="font-size:15px;color:var(--gold-bright);">${b.name}</strong>
          ${relBadge}
        </div>

        <div style="margin-bottom:12px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid var(--border-soft);">
          <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;">
            <span class="muted">Installment Release (Principal)</span>
            <strong>${fmtCurrency(a.relPrincipal)} <span class="muted">(${a.relCount})</span></strong>
          </div>
          <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:99px;overflow:hidden;margin-bottom:5px;">
            <div style="height:100%;width:${relBarPct.toFixed(1)}%;background:${a.relPrincipal >= minRel && minRel > 0 ? 'var(--green)' : 'var(--gold)'};"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);">
            <span>Min: <strong style="color:var(--text);">${minRel > 0 ? fmtCurrency(minRel) : '—'}</strong></span>
            <span>Max: <strong style="color:var(--text);">${maxRel > 0 ? fmtCurrency(maxRel) : '—'}</strong></span>
          </div>
        </div>

        <div style="margin-bottom:${isAdmin ? '12px' : '0'};padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid var(--border-soft);">
          <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;">
            <span class="muted">Collection vs BOM Quota</span>
            <strong style="color:${bomQuota > 0 && a.collAmount >= bomQuota ? 'var(--green)' : '#60a5fa'};">${fmtCurrency(a.collAmount)} <span class="muted">(${a.collCount})</span></strong>
          </div>
          <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:99px;overflow:hidden;margin-bottom:5px;">
            <div style="height:100%;width:${collBarPct.toFixed(1)}%;background:${bomQuota > 0 && a.collAmount >= bomQuota ? 'var(--green)' : '#60a5fa'};"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:6px;">
            <span>BOM Target: <strong style="color:var(--text);">${bomQuota > 0 ? fmtCurrency(bomQuota) : 'Not locked'}</strong></span>
            <span>${bomQuota > 0 ? `${collBarPct.toFixed(1)}% • Rem: ${fmtCurrency(collRem)}` : 'Set BOM below'}</span>
          </div>
          ${ws.liveQuota ? `
            <div style="font-size:11px;padding-top:6px;border-top:1px dashed var(--border-soft);color:var(--muted);line-height:1.45;">
              <div>Today Web AB Live Quota: <strong style="color:var(--gold-bright);">${fmtCurrency(ws.liveQuota)}</strong> (Bal: ${fmtCurrency(ws.currentBalance)})</div>
              <div>• 4–6 Mos (${ws.acct4to6 || 0}): ${fmtCurrency(live46)} × 27.5% = ${fmtCurrency(live46 * 0.275)}</div>
              <div>• 7–12 Mos (${ws.acct7to12 || 0}): ${fmtCurrency(live712)} × 11% = ${fmtCurrency(live712 * 0.11)}</div>
            </div>
          ` : ''}
        </div>

        ${isAdmin ? `
          <div style="padding-top:8px;border-top:1px solid var(--border-soft);">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
              <div>
                <label style="font-size:10px;color:var(--muted);">MIN RELEASE (₱)</label>
                <input type="number" class="q-min-rel" value="${minRel || ''}" min="0" step="1000" placeholder="e.g. 300000" style="padding:5px 7px;font-size:12px;" />
              </div>
              <div>
                <label style="font-size:10px;color:var(--muted);">MAX RELEASE (₱)</label>
                <input type="number" class="q-max-rel" value="${maxRel || ''}" min="0" step="1000" placeholder="e.g. 500000" style="padding:5px 7px;font-size:12px;" />
              </div>
              <div>
                <label style="font-size:10px;color:var(--muted);">BOM 4–6 MOS BAL</label>
                <input type="number" class="q-bom-46" value="${bom46 || ''}" min="0" step="0.01" placeholder="${estBom46 || '0'}" style="padding:5px 7px;font-size:12px;" />
              </div>
              <div>
                <label style="font-size:10px;color:var(--muted);">BOM 7–12 MOS BAL</label>
                <input type="number" class="q-bom-712" value="${bom712 || ''}" min="0" step="0.01" placeholder="${estBom712 || '0'}" style="padding:5px 7px;font-size:12px;" />
              </div>
            </div>
            <div style="display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap;">
              <div style="flex:1;min-width:130px;">
                <label style="font-size:10px;color:var(--gold-bright);">BOM COLLECTION QUOTA (₱)</label>
                <input type="number" class="q-bom-quota" value="${bomQuota || ''}" min="0" step="0.01" placeholder="${estBomQ || '0'}" style="padding:5px 7px;font-size:12px;border-color:var(--gold);" />
              </div>
              ${estBomQ > 0 ? `<button type="button" class="secondary q-est-btn" data-b46="${estBom46}" data-b712="${estBom712}" data-bq="${estBomQ}" style="padding:6px 8px;font-size:11px;" title="Estimate Month-Start Balance & Quota from Today's Live Web AB">Est. BOM</button>` : ''}
              <button type="button" class="q-save-btn" style="padding:6px 12px;font-size:11.5px;">SAVE</button>
            </div>
            <div class="q-save-msg small" style="margin-top:4px;color:var(--gold-bright);"></div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  if (isAdmin) {
    cardsEl.querySelectorAll('.quota-branch-card').forEach((card) => {
      const bid = card.dataset.branch;
      const b46El = card.querySelector('.q-bom-46');
      const b712El = card.querySelector('.q-bom-712');
      const bqEl = card.querySelector('.q-bom-quota');
      const recomputeBom = () => {
        const v46 = Number(b46El?.value) || 0;
        const v712 = Number(b712El?.value) || 0;
        if (bqEl && (v46 > 0 || v712 > 0)) {
          bqEl.value = (v46 * 0.275 + v712 * 0.11).toFixed(2);
        }
      };
      b46El?.addEventListener('input', recomputeBom);
      b712El?.addEventListener('input', recomputeBom);

      card.querySelector('.q-est-btn')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        if (b46El) b46El.value = btn.dataset.b46 || '';
        if (b712El) b712El.value = btn.dataset.b712 || '';
        if (bqEl) bqEl.value = btn.dataset.bq || '';
      });

      card.querySelector('.q-save-btn')?.addEventListener('click', async () => {
        const msgEl = card.querySelector('.q-save-msg');
        try {
          if (msgEl) msgEl.textContent = 'Saving...';
          const payload = {
            month: ym,
            branchId: bid,
            minRelease: Number(card.querySelector('.q-min-rel')?.value) || 0,
            maxRelease: Number(card.querySelector('.q-max-rel')?.value) || 0,
            bomBal4to6: Number(b46El?.value) || 0,
            bomBal7to12: Number(b712El?.value) || 0,
            bomQuota: Number(bqEl?.value) || 0,
            lockedAt: new Date().toISOString(),
          };
          const res = await api('/api/quotas', { method: 'PUT', body: JSON.stringify(payload) });
          if (res?.quotas) state.quotasData.quotas = res.quotas;
          if (msgEl) {
            msgEl.textContent = IS_STATIC_GH && !res?.syncedToGh
              ? 'Saved on this device (add GitHub Token in Staff Pins/Photos to sync online).'
              : 'Saved!';
          }
          renderQuotas();
        } catch (err) {
          if (msgEl) msgEl.textContent = err.message;
        }
      });
    });
  }
}

document.getElementById('quotaInfoToggleBtn')?.addEventListener('click', () => {
  const btn = document.getElementById('quotaInfoToggleBtn');
  const banner = document.getElementById('quotaFormulaBanner');
  if (!btn || !banner) return;
  const open = banner.classList.toggle('hidden') === false;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.style.borderColor = open ? 'var(--gold-bright)' : '';
  btn.style.background = open ? 'rgba(231, 197, 95, 0.22)' : '';
});
const shiftQuotaMonth = (delta) => {
  const mEl = document.getElementById('quotaMonthInput');
  const cur = mEl?.value || todayStr.slice(0, 7);
  const [y, m] = cur.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  if (mEl) mEl.value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  renderQuotas();
};
document.getElementById('quotaPrevMonthBtn')?.addEventListener('click', () => shiftQuotaMonth(-1));
document.getElementById('quotaNextMonthBtn')?.addEventListener('click', () => shiftQuotaMonth(1));
document.getElementById('quotaMonthInput')?.addEventListener('change', renderQuotas);
document.getElementById('quotaRefreshBtn')?.addEventListener('click', () => loadQuotas(true));

function getAgingTier(daysDue) {
  const d = Number(daysDue) || 0;
  if (d <= 30) return { key: '1-30', label: '1 – 30 Days Past Due', rate: 0.05, action: 'SMS / Call Reminder' };
  if (d <= 60) return { key: '31-60', label: '31 – 60 Days Past Due', rate: 0.20, action: 'CI Field Visit & Follow-Up' };
  if (d <= 90) return { key: '61-90', label: '61 – 90 Days Past Due', rate: 0.50, action: 'Final Demand • Stop Accruing Interest' };
  if (d <= 180) return { key: '91-180', label: '91 – 180 Days Past Due', rate: 0.80, action: 'Priority Repo / Unit Pull-Out' };
  return { key: '180+', label: '180+ Days Past Due', rate: 0.95, action: 'Write-Off / Legal Recovery' };
}

function computeAgingAllowance(pastDues = []) {
  const buckets = [
    { key: '1-30', label: '1 – 30 Days Past Due', rate: 0.05, action: 'SMS / Call Reminder', count: 0, balance: 0, allowance: 0 },
    { key: '31-60', label: '31 – 60 Days Past Due', rate: 0.20, action: 'CI Field Visit & Follow-Up', count: 0, balance: 0, allowance: 0 },
    { key: '61-90', label: '61 – 90 Days Past Due', rate: 0.50, action: 'Final Demand • Stop Accruing Interest', count: 0, balance: 0, allowance: 0 },
    { key: '91-180', label: '91 – 180 Days Past Due', rate: 0.80, action: 'Priority Repo / Unit Pull-Out', count: 0, balance: 0, allowance: 0 },
    { key: '180+', label: '180+ Days Past Due', rate: 0.95, action: 'Write-Off / Legal Recovery', count: 0, balance: 0, allowance: 0 },
  ];
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  let totalPastDue = 0;
  let requiredAllowance = 0;
  for (const pd of pastDues) {
    const bal = Number(pd.balance) || 0;
    const tier = getAgingTier(getEffectiveDaysDue(pd));
    const b = byKey.get(tier.key);
    b.count++;
    b.balance += bal;
    const allow = bal * b.rate;
    b.allowance += allow;
    totalPastDue += bal;
    requiredAllowance += allow;
  }
  return { buckets, totalPastDue, requiredAllowance };
}

function renderReceivables() {
  const data = state.receivables;
  if (!data) return;
  const t = data.totals;
  const q = document.getElementById('recSearchInput').value.trim().toLowerCase();
  const aging = computeAgingAllowance(data.pastDues || []);

  document.getElementById('receivablesKpiGrid').innerHTML = `
    <div class="summary-box">
      INSTALLMENT PORTFOLIO
      <strong>${fmtCurrency(t.totalPortfolio)}</strong>
      <span class="summary-note">Net Realizable: ${fmtCurrency(Math.max(0, t.totalPortfolio - aging.requiredAllowance))}</span>
    </div>
    <div class="summary-box">
      PRINCIPAL FINANCED
      <strong>${fmtCurrency(t.totalPrincipal)}</strong>
      <span class="summary-note">Deposits: ${fmtCurrency(t.totalDeposits)}</span>
    </div>
    <div class="summary-box">
      EXPECTED MONTHLY
      <strong style="color:var(--green);">${fmtCurrency(t.totalMonthlyExpected)}</strong>
      <span class="summary-note">${fmtNum(t.installmentCount)} active contract(s)</span>
    </div>
    <div class="summary-box rec-aging-click" data-bucket="ALL" style="cursor:pointer;border-color:#f59e0b;" title="Click to view customer-by-customer allowance computation per branch">
      OPENING ALLOWANCE (AGING) ↗
      <strong style="color:#f59e0b;">${fmtCurrency(aging.requiredAllowance)}</strong>
      <span class="summary-note">${fmtNum(t.dueAccountsCount)} past-due (${fmtCurrency(aging.totalPastDue)}) • Click to audit</span>
    </div>
  `;

  const agingPill = document.getElementById('receivablesAgingSummaryPill');
  if (agingPill) {
    agingPill.textContent = `Target Opening Allowance: ${fmtCurrency(aging.requiredAllowance)} (Click any row to audit)`;
    agingPill.style.cursor = 'pointer';
    agingPill.onclick = () => openReceivablesAllowanceModal('ALL', document.getElementById('globalBranch')?.value || 'ALL');
  }
  const agingTbody = document.querySelector('#receivablesAgingTable tbody');
  if (agingTbody) {
    const parPct = t.totalPortfolio > 0 ? ((aging.totalPastDue / t.totalPortfolio) * 100).toFixed(1) : '0.0';
    agingTbody.innerHTML =
      aging.buckets
        .map(
          (b) => `
        <tr class="rec-aging-click" data-bucket="${b.key}" style="cursor:pointer;" title="Click to inspect customers in ${b.label}">
          <td><strong style="text-decoration:underline dotted;">${b.label}</strong></td>
          <td>${Math.round(b.rate * 100)}%</td>
          <td>${fmtNum(b.count)}</td>
          <td>${fmtCurrency(b.balance)}</td>
          <td style="color:#f59e0b;"><strong>${fmtCurrency(b.allowance)}</strong></td>
          <td class="small muted">${b.action}</td>
        </tr>`
        )
        .join('') +
      `<tr class="rec-aging-click" data-bucket="ALL" style="background:rgba(255,255,255,0.04);font-weight:700;cursor:pointer;" title="Click to inspect all past-due customers by branch">
        <td style="text-decoration:underline dotted;">TOTAL OPENING ALLOWANCE (PAR: ${parPct}%)</td>
        <td>—</td>
        <td>${fmtNum(aging.buckets.reduce((s, x) => s + x.count, 0))}</td>
        <td><strong>${fmtCurrency(aging.totalPastDue)}</strong></td>
        <td style="color:var(--gold-bright);"><strong>${fmtCurrency(aging.requiredAllowance)}</strong></td>
        <td class="small" style="color:var(--gold-bright);">Click any row to audit customers</td>
      </tr>`;

    document.querySelectorAll('#tab-receivables .rec-aging-click').forEach((el) => {
      el.addEventListener('click', () => {
        openReceivablesAllowanceModal(el.dataset.bucket || 'ALL', document.getElementById('globalBranch')?.value || 'ALL');
      });
    });
  }

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

function initSalesDateInputs() {
  const monthInp = document.getElementById('salesMonthInput');
  const startInp = document.getElementById('salesStart');
  const endInp = document.getElementById('salesEnd');
  const fdInp = document.getElementById('salesFromDay');
  const tdInp = document.getElementById('salesToDay');
  const yearBtn = document.getElementById('salesYearBtn');
  const curMonth = todayStr.slice(0, 7);
  if (monthInp && !monthInp.value) monthInp.value = curMonth;
  if (startInp && !startInp.value) startInp.value = `${curMonth}-01`;
  if (endInp && !endInp.value) endInp.value = todayStr;
  if (fdInp && !fdInp.value) fdInp.value = String(Number((startInp?.value || `${curMonth}-01`).slice(8, 10)));
  if (tdInp && !tdInp.value) tdInp.value = String(Number((endInp?.value || todayStr).slice(8, 10)));
  if (yearBtn && !yearBtn.dataset.year) {
    yearBtn.dataset.year = todayStr.slice(0, 4);
    yearBtn.textContent = todayStr.slice(0, 4);
  }
}

function analyzePaymentRebates(payments, mode = 'DETECTED') {
  const byEvent = new Map();
  for (const p of payments || []) {
    const dt = String(p.payment_date || '').slice(0, 10);
    const key = `${p.branch_id}|${dt}|${p.account_no || p.customer_name || ''}`;
    if (!byEvent.has(key)) byEvent.set(key, []);
    byEvent.get(key).push(p);
  }

  const REBATE_FACTOR = 0.025 / 0.975; // Net cash = 97.5% of full amort -> Rebate (2.5% of full amort) = Net cash * (0.025 / 0.975)
  const branchIds = ['br-molave', 'br-tambulig', 'br-bonifacio'];
  const mkAgg = () => ({
    eventCount: 0,
    rowCount: 0,
    lateCount: 0,
    onTimeOrEarlyCount: 0,
    detectedCount: 0,
    rebatedCount: 0,
    cashCollected: 0,
    principal: 0,
    interest: 0,
    penalties: 0,
    explicitRebates: 0,
    detectedRebates: 0,
    ceilingRebates: 0,
    activeRebates: 0,
    detectedPrincipalLoss: 0,
    ceilingPrincipalLoss: 0,
    unrecordedPrincipalLoss: 0,
    rawFinIncome: 0,
    trueFinIncome: 0,
  });

  const byBranch = new Map(branchIds.map((id) => [id, mkAgg()]));
  const totals = mkAgg();
  const events = [];

  for (const list of byEvent.values()) {
    const first = list[0];
    const bid = first.branch_id;
    const sumAmt = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const sumPrin = list.reduce((s, r) => s + (Number(r.principal) || 0), 0);
    const sumInt = list.reduce((s, r) => s + (Number(r.interest) || 0), 0);
    const sumPen = list.reduce((s, r) => s + (Number(r.penalties) || 0), 0);
    const sumExpReb = list.reduce((s, r) => s + (Number(r.rebates) || 0), 0);

    // Largest row = primary amortization payment (excludes small advance carryovers like ₱3, ₱14, ₱17)
    const mainRow = list.reduce((best, r) => ((Number(r.amount) || 0) > (Number(best.amount) || 0) ? r : best), first);
    const mainAmt = Number(mainRow.amount) || 0;
    const mainPrin = Number(mainRow.principal) || 0;
    const mainPrinRatio = mainAmt > 0 ? mainPrin / mainAmt : sumAmt > 0 ? sumPrin / sumAmt : 0.67;
    const eventPrinRatio = sumAmt > 0 ? sumPrin / sumAmt : 0.67;

    const isLate = sumPen > 0;
    let isDetected = false;
    let detectedReb = 0;
    let detectedPrinLoss = 0;
    let ceilingReb = 0;
    let ceilingPrinLoss = 0;

    if (!isLate) {
      if (sumExpReb > 0) {
        detectedReb = sumExpReb;
        ceilingReb = sumExpReb;
        isDetected = true;
      } else {
        const isNotMod5 = mainAmt >= 200 && Math.abs(mainAmt % 5) >= 0.5;
        const has25PairedRow = list.length >= 2 && sumAmt > 0 && Math.abs(mainAmt / sumAmt - 0.975) <= 0.005;
        isDetected = isNotMod5 || has25PairedRow;
        if (isDetected) {
          detectedReb = mainAmt * REBATE_FACTOR;
          detectedPrinLoss = detectedReb * mainPrinRatio;
        }
        ceilingReb = sumAmt * REBATE_FACTOR;
        ceilingPrinLoss = ceilingReb * eventPrinRatio;
      }
    } else if (sumExpReb > 0) {
      detectedReb = sumExpReb;
      ceilingReb = sumExpReb;
    }

    let activeReb = 0;
    let activePrinLoss = 0;
    let activeBaseAmt = 0;
    let isRebated = false;

    if (mode === 'RECORDED') {
      activeReb = sumExpReb;
      activePrinLoss = 0;
      activeBaseAmt = sumExpReb > 0 ? mainAmt : 0;
      isRebated = sumExpReb > 0;
    } else if (mode === 'CEILING') {
      activeReb = ceilingReb;
      activePrinLoss = ceilingPrinLoss;
      activeBaseAmt = !isLate && sumAmt > 0 ? sumAmt : 0;
      isRebated = !isLate && sumAmt > 0;
    } else {
      activeReb = detectedReb;
      activePrinLoss = detectedPrinLoss;
      activeBaseAmt = isDetected ? mainAmt : 0;
      isRebated = isDetected;
    }

    const rawFinInc = sumInt + sumPen - sumExpReb;
    // True Financing Income = Scheduled Full Interest + Penalties - Active Rebate
    // Because AB Web's pro-rated sumInt already reduced Interest by ~(1 - prinRatio) * Rebate,
    // subtracting ONLY the unrecorded Principal share (prinRatio * Rebate) yields exact FullInt + Pen - Rebate with zero double-counting.
    const trueFinInc = rawFinInc - activePrinLoss;
    const alreadyCutFromInt = Math.max(0, activeReb - activePrinLoss);
    const fullAmortCleared = activeBaseAmt > 0 ? activeBaseAmt + activeReb : sumAmt;

    const ev = {
      payment_date: String(first.payment_date || '').slice(0, 10),
      branch_id: bid,
      branch_name: first.branch_name || '',
      account_no: first.account_no || '',
      customer_name: first.customer_name || '',
      rowCount: list.length,
      amount: sumAmt,
      mainAmt,
      principal: sumPrin,
      interest: sumInt,
      penalties: sumPen,
      explicitRebates: sumExpReb,
      isLate,
      isDetected,
      isRebated,
      detectedRebate: detectedReb,
      ceilingRebate: ceilingReb,
      activeRebate: activeReb,
      activeBaseAmt,
      fullAmortCleared,
      alreadyCutFromInt,
      detectedPrincipalLoss: detectedPrinLoss,
      ceilingPrincipalLoss: ceilingPrinLoss,
      unrecordedPrincipalLoss: activePrinLoss,
      rawFinInc,
      trueFinInc,
    };
    events.push(ev);

    const addTo = (agg) => {
      if (!agg) return;
      agg.eventCount++;
      agg.rowCount += list.length;
      if (isLate) agg.lateCount++;
      else agg.onTimeOrEarlyCount++;
      if (isDetected) agg.detectedCount++;
      if (isRebated) agg.rebatedCount++;
      agg.cashCollected += sumAmt;
      agg.principal += sumPrin;
      agg.interest += sumInt;
      agg.penalties += sumPen;
      agg.explicitRebates += sumExpReb;
      agg.detectedRebates += detectedReb;
      agg.ceilingRebates += ceilingReb;
      agg.activeRebates += activeReb;
      agg.detectedPrincipalLoss += detectedPrinLoss;
      agg.ceilingPrincipalLoss += ceilingPrinLoss;
      agg.unrecordedPrincipalLoss += activePrinLoss;
      agg.rawFinIncome += rawFinInc;
      agg.trueFinIncome += trueFinInc;
    };
    addTo(byBranch.get(bid));
    addTo(totals);
  }

  return { events, byBranch, totals };
}

function buildScopedFinanceFromCache(histFin, start, end) {
  const branches = [
    { branchId: 'br-molave', branchName: 'Molave' },
    { branchId: 'br-tambulig', branchName: 'Tambulig' },
    { branchId: 'br-bonifacio', branchName: 'Bonifacio' },
  ];
  const recentPayments = (histFin?.recentPayments || []).filter((p) => p.payment_date >= start && p.payment_date <= end);
  const recentExpenses = (histFin?.recentExpenses || []).filter((e) => e.expense_date >= start && e.expense_date <= end);
  const rebAnalysis = analyzePaymentRebates(recentPayments, 'DETECTED');

  const map = new Map(
    branches.map((b) => {
      const ra = rebAnalysis.byBranch.get(b.branchId);
      return [
        b.branchId,
        {
          ...b,
          collections: ra?.cashCollected || 0,
          interest: ra?.interest || 0,
          penalties: ra?.penalties || 0,
          explicitRebates: ra?.explicitRebates || 0,
          detectedRebates: ra?.detectedRebates || 0,
          ceilingRebates: ra?.ceilingRebates || 0,
          unrecordedPrincipalLoss: ra?.unrecordedPrincipalLoss || 0,
          rawFinancingIncome: ra?.rawFinIncome || 0,
          financingIncome: ra?.trueFinIncome || 0,
          expenses: 0,
        },
      ];
    })
  );
  for (const e of recentExpenses) {
    const b = map.get(e.branch_id);
    if (b) b.expenses += Number(e.amount) || 0;
  }
  return { byBranch: Array.from(map.values()), recentPayments, recentExpenses, rebAnalysis };
}

async function loadSalesSummary(forceRefresh = false) {
  initSalesDateInputs();
  const start = document.getElementById('salesStart')?.value || `${todayStr.slice(0, 7)}-01`;
  const end = document.getElementById('salesEnd')?.value || todayStr;
  const fetchStart = '2020-01-01';
  const fetchEnd = end > todayStr ? end : todayStr;

  const cacheValid = !forceRefresh && state.salesFullCache && Date.now() - state.salesFullCache.ts < 300000;
  if (!cacheValid) {
    const [txRes, actRes, histFinRes, recRes] = await Promise.all([
      api(`/api/sales/summary?start=${encodeURIComponent(fetchStart)}&end=${encodeURIComponent(fetchEnd)}`).catch(() => ({ transactions: [] })),
      api(`/api/activity?start=${encodeURIComponent(fetchStart)}&end=${encodeURIComponent(fetchEnd)}`).catch(() => ({ allMovements: [] })),
      api(`/api/finance/summary?start=${encodeURIComponent(fetchStart)}&end=${encodeURIComponent(fetchEnd)}`).catch(() => null),
      api('/api/receivables/summary').catch(() => null),
    ]);
    state.salesFullCache = {
      ts: Date.now(),
      transactions: txRes?.transactions || [],
      onlinePayments: txRes?.onlinePayments || [],
      allMovements: actRes?.allMovements || [],
      histFinance: histFinRes,
      receivables: recRes,
    };
  }

  const c = state.salesFullCache;
  state.salesData = {
    start,
    end,
    transactions: c.transactions,
    allMovements: c.allMovements,
    finance: buildScopedFinanceFromCache(c.histFinance, start, end),
    histFinance: c.histFinance,
    receivables: c.receivables,
  };
  const liveEl = document.getElementById('salesLiveStatus');
  if (liveEl) {
    liveEl.textContent = `● ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }
  if (state.activeTab === 'sales') {
    renderSalesSummary();
    renderSalesCashPnlTool();
    renderSalesInstallmentAccrualTool();
    renderSalesChartsTool();
    renderSalesRebatesTool();
  }
}

function initCashFlowDateInputs() {
  const mEl = document.getElementById('cfMonthInput');
  const sEl = document.getElementById('cfStart');
  const eEl = document.getElementById('cfEnd');
  const fdEl = document.getElementById('cfFromDay');
  const tdEl = document.getElementById('cfToDay');
  if (mEl && !mEl.value) mEl.value = todayStr.slice(0, 7);
  if (sEl && !sEl.value) sEl.value = todayStr;
  if (eEl && !eEl.value) eEl.value = todayStr;
  if (fdEl && !fdEl.value) fdEl.value = String(Number(todayStr.slice(8, 10)));
  if (tdEl && !tdEl.value) tdEl.value = String(Number(todayStr.slice(8, 10)));
}

async function loadCashFlow(forceRefresh = false) {
  initCashFlowDateInputs();
  const needSavedOrders = Boolean(document.getElementById('cfIncludeStockChk')?.checked) && !state.savedOrders;
  await Promise.all([
    loadSalesSummary(forceRefresh),
    needSavedOrders ? loadSavedOrders().catch(() => {}) : Promise.resolve(),
  ]);
  renderCashFlow();
}

function buildCashFlowEntries() {
  const c = state.salesFullCache;
  if (!c) return [];
  const includeStock = Boolean(document.getElementById('cfIncludeStockChk')?.checked);
  const entries = [];
  const bNames = { 'br-molave': 'Molave', 'br-tambulig': 'Tambulig', 'br-bonifacio': 'Bonifacio' };

  for (const tx of c.transactions || []) {
    const dt = String(tx.tx_date || '').slice(0, 10);
    const amt = Number(tx.amount) || 0;
    if (!dt || !bNames[tx.branch_id] || amt <= 0) continue;
    entries.push({ date: dt, branchId: tx.branch_id, kind: 'cash_sale', label: `Cash Sale • ${tx.order_no || ''}`, amount: amt });
  }
  for (const inst of c.receivables?.installments || []) {
    const dt = String(inst.sale_date || '').slice(0, 10);
    const amt = Number(inst.deposit) || 0;
    if (!dt || !bNames[inst.branch_id] || amt <= 0) continue;
    entries.push({ date: dt, branchId: inst.branch_id, kind: 'downpayment', label: `Downpayment • ${inst.customer_name || inst.unit || ''}`, amount: amt });
  }
  for (const p of c.histFinance?.recentPayments || []) {
    const dt = String(p.payment_date || '').slice(0, 10);
    const pen = Number(p.penalties) || 0;
    const amt = (Number(p.amount) || 0) + pen;
    if (!dt || !bNames[p.branch_id] || amt <= 0) continue;
    entries.push({ date: dt, branchId: p.branch_id, kind: 'collection', label: `Installment Payment • ${p.customer_name || p.account_no || ''}${pen > 0 ? ` (incl. ₱${pen} penalty)` : ''}`, amount: amt });
  }
  for (const e of c.histFinance?.recentExpenses || []) {
    const dt = String(e.expense_date || '').slice(0, 10);
    const amt = Number(e.amount) || 0;
    if (!dt || !bNames[e.branch_id] || amt <= 0) continue;
    entries.push({ date: dt, branchId: e.branch_id, kind: 'expense', label: `${e.expense_type || 'Expense'}${e.particular ? ` — ${e.particular}` : ''}`, amount: amt });
  }
  const includeOnline = Boolean(document.getElementById('cfSeparateOnlineChk')?.checked ?? true);
  if (includeOnline) {
    for (const o of c.onlinePayments || []) {
      const dt = String(o.pay_date || '').slice(0, 10);
      const amt = Number(o.online_amount) || 0;
      if (!dt || !bNames[o.branch_id] || amt <= 0) continue;
      entries.push({ date: dt, branchId: o.branch_id, kind: 'online_out', label: 'Online Payments (GCash / Bank — Not Cash on Hand)', amount: amt });
    }
  }
  if (includeStock) {
    for (const o of state.savedOrders || []) {
      if (o.status === 'Cancelled' || o.status === 'Draft') continue;
      for (const it of o.items || []) {
        if (it.approved === false) continue;
        const qty = Number(it.receivedQty) || 0;
        const cost = Number(it.receivedCost) > 0 ? Number(it.receivedCost) : Number(it.unitCost) || 0;
        const dt = String(it.receivedDate || o.updatedAt || '').slice(0, 10);
        const amt = qty * cost;
        if (!dt || !bNames[it.branchId] || amt <= 0) continue;
        entries.push({ date: dt, branchId: it.branchId, kind: 'stock', label: `Stock Receipt • ${it.displayModel || it.model || ''} (${qty} pcs)`, amount: amt });
      }
    }
  }
  return entries;
}

function renderCashFlow() {
  const start = document.getElementById('cfStart')?.value || todayStr;
  const end = document.getElementById('cfEnd')?.value || todayStr;
  const monthYm = document.getElementById('cfMonthInput')?.value || todayStr.slice(0, 7);
  const [mY, mM] = monthYm.split('-').map(Number);
  const mLastDay = new Date(Date.UTC(mY || Number(todayStr.slice(0, 4)), mM || Number(todayStr.slice(5, 7)), 0)).getUTCDate();
  const monthStart = `${monthYm}-01`;
  const monthEnd = monthYm === todayStr.slice(0, 7) ? todayStr : `${monthYm}-${String(mLastDay).padStart(2, '0')}`;
  const isDefaultToday = start === todayStr && end === todayStr;
  const box2Start = isDefaultToday ? monthStart : start;
  const box2End = isDefaultToday ? monthEnd : end;
  const box2Period = isDefaultToday ? monthYm : '';
  const box2Title = isDefaultToday ? `WHOLE MONTH NET CASH FLOW (${box2Start} → ${box2End})` : `RANGE NET CASH FLOW (${box2Start} → ${box2End})`;
  const box2Label = isDefaultToday ? `Whole Month Cash Flow (${monthYm})` : 'Range Cash Flow';
  const branchFilter = document.getElementById('globalBranch')?.value || 'ALL';
  const branchIds = ['br-molave', 'br-tambulig', 'br-bonifacio'];
  const branchNames = { 'br-molave': 'Molave', 'br-tambulig': 'Tambulig', 'br-bonifacio': 'Bonifacio' };
  const entries = buildCashFlowEntries();

  const mkBucket = () => ({ cashSale: 0, downpayment: 0, collection: 0, cashIn: 0, online: 0, expense: 0, stock: 0, cashOut: 0, net: 0 });
  const addEntry = (b, e) => {
    if (e.kind === 'cash_sale') { b.cashSale += e.amount; b.cashIn += e.amount; }
    else if (e.kind === 'downpayment') { b.downpayment += e.amount; b.cashIn += e.amount; }
    else if (e.kind === 'collection') { b.collection += e.amount; b.cashIn += e.amount; }
    else if (e.kind === 'online_out') { b.online += e.amount; }
    else if (e.kind === 'expense') { b.expense += e.amount; b.cashOut += e.amount; }
    else if (e.kind === 'stock') { b.stock += e.amount; b.cashOut += e.amount; }
    b.net = b.cashIn - b.online - b.cashOut;
  };

  const todayAll = mkBucket();
  const rangeAll = mkBucket();
  const todayByBranch = { 'br-molave': mkBucket(), 'br-tambulig': mkBucket(), 'br-bonifacio': mkBucket() };
  const rangeByBranch = { 'br-molave': mkBucket(), 'br-tambulig': mkBucket(), 'br-bonifacio': mkBucket() };
  const dailyMap = new Map();
  const monthlyMap = new Map();

  for (const e of entries) {
    if (e.date === todayStr) {
      addEntry(todayByBranch[e.branchId], e);
      if (branchFilter === 'ALL' || e.branchId === branchFilter) addEntry(todayAll, e);
    }
    if (e.date >= box2Start && e.date <= box2End) {
      addEntry(rangeByBranch[e.branchId], e);
      if (branchFilter === 'ALL' || e.branchId === branchFilter) addEntry(rangeAll, e);
    }
    if (e.date >= start && e.date <= end && (branchFilter === 'ALL' || e.branchId === branchFilter)) {
      if (!dailyMap.has(e.date)) dailyMap.set(e.date, mkBucket());
      addEntry(dailyMap.get(e.date), e);
    }
    if (branchFilter === 'ALL' || e.branchId === branchFilter) {
      const mo = e.date.slice(0, 7);
      if (!monthlyMap.has(mo)) monthlyMap.set(mo, mkBucket());
      addEntry(monthlyMap.get(mo), e);
    }
  }

  const separateOnline = Boolean(document.getElementById('cfSeparateOnlineChk')?.checked ?? true);
  const kpiGrid = document.getElementById('cfKpiGrid');
  if (kpiGrid) {
    const renderBigCfBox = (title, allB, byBr, periodFilter, labelPrefix, borderGold) => `
      <div class="summary-box sales-big-box"${borderGold ? ' style="border-color:var(--gold);"' : ''}>
        <div class="sales-big-main cf-kpi-drill" data-branch="${branchFilter}" data-period="${periodFilter}" data-label="${labelPrefix}" title="Click for supporting cash flow breakdown">
          <div class="sales-big-title">${title} <span style="color:var(--gold-bright);">(${separateOnline ? 'Cash Money Only' : 'incl. Online Payments'})</span></div>
          <strong class="sales-big-val" style="color:${allB.net >= 0 ? 'var(--green)' : 'var(--danger)'};">${fmtCurrency(allB.net)}</strong>
          <div class="summary-note">In: <strong style="color:var(--green);">${fmtCurrency(allB.cashIn)}</strong>${separateOnline ? ` • Online: <strong style="color:#60a5fa;">−${fmtCurrency(allB.online)}</strong>` : ''} • Out: <strong style="color:var(--danger);">−${fmtCurrency(allB.cashOut)}</strong> • 🔎</div>
        </div>
        <div class="sales-branch-subgrid">
          ${branchIds
            .map((bid) => {
              const b = byBr[bid];
              return `
              <div class="sales-branch-chip cf-kpi-drill" data-branch="${bid}" data-period="${periodFilter}" data-label="${branchNames[bid]} ${labelPrefix}" title="Click for ${branchNames[bid]} cash flow breakdown">
                <span class="sales-chip-name">${branchNames[bid]}</span>
                <strong class="sales-chip-val" style="color:${b.net >= 0 ? 'var(--green)' : 'var(--danger)'};">${fmtCurrency(b.net)}</strong>
                <span class="sales-chip-sub">${separateOnline ? `Cash ${fmtCurrency(b.cashIn - b.online)}` : `In ${fmtCurrency(b.cashIn)}`}</span>
                ${separateOnline ? `<span class="sales-chip-sub" style="color:#60a5fa;">Online ${fmtCurrency(b.online)}</span>` : ''}
                <span class="sales-chip-sub">Out ${fmtCurrency(b.cashOut)}</span>
              </div>`;
            })
            .join('')}
        </div>
      </div>`;

    kpiGrid.innerHTML =
      renderBigCfBox(`TODAY'S NET CASH FLOW (${todayStr})`, todayAll, todayByBranch, todayStr, "Today's Cash Flow", true) +
      renderBigCfBox(box2Title, rangeAll, rangeByBranch, box2Period, box2Label, false);

    kpiGrid.querySelectorAll('.cf-kpi-drill').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openCashFlowDrilldown(el.dataset.branch || 'ALL', el.dataset.period || '', el.dataset.label || 'Cash Flow');
      });
    });
  }

  const renderRows = (rows, tbodySel, badgeSel, unitWord, showOnlineNote = false) => {
    const badge = document.getElementById(badgeSel);
    if (badge) badge.textContent = `${rows.length} ${unitWord}${rows.length === 1 ? '' : 's'}`;
    const tbody = document.querySelector(`${tbodySel} tbody`);
    if (!tbody) return;
    tbody.innerHTML = rows.length
      ? rows
          .map(
            ([per, b]) => `
            <tr class="sales-cash-cell" data-period="${per}" data-label="Cash Flow (${per})" title="Click for supporting inflows & outflows">
              <td><strong>${per}</strong></td>
              <td>${fmtCurrency(b.cashSale)}</td>
              <td>${fmtCurrency(b.downpayment)}</td>
              <td>${fmtCurrency(b.collection)}</td>
              <td style="color:var(--green);"><strong>${fmtCurrency(b.cashIn)}</strong></td>
              <td style="color:#60a5fa;">${fmtCurrency(b.online)}</td>
              <td style="color:var(--danger);">${fmtCurrency(b.expense)}</td>
              <td style="color:#f59e0b;">${fmtCurrency(b.stock)}</td>
              <td style="color:${b.net >= 0 ? 'var(--green)' : 'var(--danger)'};"><strong>${fmtCurrency(b.net)}</strong>${showOnlineNote ? `<div class="small muted">${separateOnline ? (b.online > 0 ? 'Cash Only (Online excl.)' : 'Cash Only') : 'incl. Online Payments'}</div>` : ''}</td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="9" class="muted">No cash flow entries recorded in this period.</td></tr>';
  };

  renderRows([...dailyMap.entries()].sort((a, b) => b[0].localeCompare(a[0])), '#cfDailyTable', 'cfDailyCountBadge', 'day', true);
  renderRows([...monthlyMap.entries()].sort((a, b) => b[0].localeCompare(a[0])), '#cfMonthlyTable', 'cfMonthlyCountBadge', 'month', true);
}

function openCashFlowDrilldown(branchId, periodFilter, label) {
  const modal = document.getElementById('salesDrilldownModal');
  if (!modal) return;
  const start = document.getElementById('cfStart')?.value || `${todayStr.slice(0, 7)}-01`;
  const end = document.getElementById('cfEnd')?.value || todayStr;
  const bNames = { 'br-molave': 'Molave', 'br-tambulig': 'Tambulig', 'br-bonifacio': 'Bonifacio', ALL: 'All Branches' };
  const exactDate = /^\d{4}-\d{2}-\d{2}$/.test(periodFilter) ? periodFilter : '';
  const exactMonth = !exactDate && /^\d{4}-\d{2}$/.test(periodFilter) ? periodFilter : '';

  const rows = buildCashFlowEntries()
    .filter((e) => {
      if (branchId !== 'ALL' && e.branchId !== branchId) return false;
      if (exactDate) return e.date === exactDate;
      if (exactMonth) return e.date.startsWith(exactMonth);
      return e.date >= start && e.date <= end;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  let tIn = 0, tOut = 0;
  for (const r of rows) {
    if (r.kind === 'expense' || r.kind === 'stock' || r.kind === 'online_out') tOut += r.amount;
    else tIn += r.amount;
  }
  const tNet = tIn - tOut;
  const kindLabels = { cash_sale: 'Cash Sale', downpayment: 'Downpayment', collection: 'Installment Coll.', online_out: 'Online (Not Cash)', expense: 'Op. Expense', stock: 'Stock Paid' };

  document.getElementById('salesDrilldownTitle').textContent = `${label} — ${bNames[branchId] || branchId}`;
  document.getElementById('salesDrilldownSub').textContent = periodFilter ? `Period: ${periodFilter}` : `Period: ${start} → ${end}`;
  document.getElementById('salesDrilldownFormula').innerHTML = `<strong>Cash Flow Formula (Cash Money Only):</strong> Total In (<code>${fmtCurrency(tIn)}</code>) − Online &amp; Outflows (<code>${fmtCurrency(tOut)}</code>) = <strong style="color:${tNet >= 0 ? 'var(--green)' : 'var(--danger)'};">${fmtCurrency(tNet)}</strong> (${rows.length} entries).`;
  document.querySelector('#salesDrilldownTable thead').innerHTML = '<tr><th>Date</th><th>Branch</th><th>Type</th><th>Description</th><th>Cash In</th><th>Online / Out</th></tr>';
  const tbody = document.querySelector('#salesDrilldownTable tbody');
  const CHUNK = 120;
  let shown = Math.min(CHUNK, rows.length);
  const draw = () => {
    const bodyHtml = rows.length
      ? rows
          .slice(0, shown)
          .map((r) => {
            const isOut = r.kind === 'expense' || r.kind === 'stock' || r.kind === 'online_out';
            const outClr = r.kind === 'online_out' ? '#60a5fa' : 'var(--danger)';
            return `<tr><td>${r.date}</td><td>${bNames[r.branchId] || r.branchId}</td><td>${kindLabels[r.kind] || r.kind}</td><td>${r.label}</td><td style="color:var(--green);">${isOut ? '—' : fmtCurrency(r.amount)}</td><td style="color:${outClr};">${isOut ? fmtCurrency(r.amount) : '—'}</td></tr>`;
          })
          .join('')
      : '<tr><td colspan="6" class="muted">No cash flow entries in this period.</td></tr>';
    const moreHtml =
      shown < rows.length
        ? `<tr><td colspan="6" style="text-align:center;padding:8px;"><button type="button" class="secondary" id="cfDrillMoreBtn" style="padding:5px 10px;font-size:11px;min-height:30px;">Load ${Math.min(CHUNK, rows.length - shown)} more (${shown} / ${rows.length})</button> <button type="button" class="secondary" id="cfDrillAllBtn" style="padding:5px 10px;font-size:11px;min-height:30px;">Show All (${rows.length})</button></td></tr>`
        : '';
    tbody.innerHTML = bodyHtml + moreHtml + `<tr style="background:rgba(255,255,255,0.05);font-weight:700;"><td colspan="4">TOTAL (${rows.length} entries) • Net: ${fmtCurrency(tNet)}</td><td style="color:var(--green);">${fmtCurrency(tIn)}</td><td style="color:var(--danger);">${fmtCurrency(tOut)}</td></tr>`;
    document.getElementById('cfDrillMoreBtn')?.addEventListener('click', () => { shown = Math.min(rows.length, shown + CHUNK); draw(); });
    document.getElementById('cfDrillAllBtn')?.addEventListener('click', () => { shown = rows.length; draw(); });
  };
  draw();
  modal.classList.remove('hidden');
}

const syncCfDaysToRange = (normalizeInputs = true) => {
  const ym = document.getElementById('cfMonthInput')?.value || todayStr.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const fdEl = document.getElementById('cfFromDay');
  const tdEl = document.getElementById('cfToDay');
  const raw1 = fdEl?.value ?? '';
  const raw2 = tdEl?.value ?? '';
  if (!normalizeInputs && (!raw1 || !raw2)) return;
  let d1 = Math.max(1, Math.min(lastDay, parseInt(raw1 || '1', 10) || 1));
  let d2 = Math.max(1, Math.min(lastDay, parseInt(raw2 || String(lastDay), 10) || lastDay));
  if (d1 > d2) d2 = d1;
  if (normalizeInputs) {
    if (fdEl) fdEl.value = String(d1);
    if (tdEl) tdEl.value = String(d2);
  }
  document.getElementById('cfStart').value = `${ym}-${String(d1).padStart(2, '0')}`;
  document.getElementById('cfEnd').value = `${ym}-${String(d2).padStart(2, '0')}`;
  if (!state.salesFullCache) loadCashFlow();
  else renderCashFlow();
};

const shiftCfMonth = (delta) => {
  const mEl = document.getElementById('cfMonthInput');
  const cur = mEl?.value || todayStr.slice(0, 7);
  const [y, m] = cur.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  if (mEl) mEl.value = ym;
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const isCurMonth = ym === todayStr.slice(0, 7);
  const startDay = isCurMonth && delta === 0 ? Number(todayStr.slice(8, 10)) : 1;
  const endDay = isCurMonth ? Number(todayStr.slice(8, 10)) : lastDay;
  const fdEl = document.getElementById('cfFromDay');
  const tdEl = document.getElementById('cfToDay');
  if (fdEl) fdEl.value = String(startDay);
  if (tdEl) tdEl.value = String(endDay);
  document.getElementById('cfStart').value = `${ym}-${String(startDay).padStart(2, '0')}`;
  document.getElementById('cfEnd').value = `${ym}-${String(endDay).padStart(2, '0')}`;
  if (!state.salesFullCache) loadCashFlow();
  else renderCashFlow();
};
document.getElementById('cfPrevMonthBtn')?.addEventListener('click', () => shiftCfMonth(-1));
document.getElementById('cfNextMonthBtn')?.addEventListener('click', () => shiftCfMonth(1));
document.getElementById('cfMonthInput')?.addEventListener('change', () => shiftCfMonth(0));
document.getElementById('cfMonthInput')?.addEventListener('input', () => shiftCfMonth(0));
let cfDayInputTimer = null;
const scheduleCfDaySync = () => {
  clearTimeout(cfDayInputTimer);
  cfDayInputTimer = setTimeout(() => syncCfDaysToRange(false), 80);
};
document.getElementById('cfFromDay')?.addEventListener('input', scheduleCfDaySync);
document.getElementById('cfToDay')?.addEventListener('input', scheduleCfDaySync);
document.getElementById('cfFromDay')?.addEventListener('change', () => syncCfDaysToRange(true));
document.getElementById('cfToDay')?.addEventListener('change', () => syncCfDaysToRange(true));
document.getElementById('cfRefreshBtn')?.addEventListener('click', () => loadCashFlow(true));
document.getElementById('cfBranchFilter')?.addEventListener('change', renderCashFlow);
document.getElementById('cfIncludeStockChk')?.addEventListener('change', () => {
  if (document.getElementById('cfIncludeStockChk')?.checked && !state.savedOrders) {
    loadSavedOrders().then(renderCashFlow).catch(() => {});
  } else {
    renderCashFlow();
  }
});
document.getElementById('cfSeparateOnlineChk')?.addEventListener('change', renderCashFlow);
document.getElementById('cfDailyToggle')?.addEventListener('click', () => {
  const body = document.getElementById('cfDailyBody');
  const caret = document.getElementById('cfDailyCaret');
  if (body && caret) caret.textContent = body.classList.toggle('hidden') ? '+' : '−';
});
document.getElementById('cfMonthlyToggle')?.addEventListener('click', () => {
  const body = document.getElementById('cfMonthlyBody');
  const caret = document.getElementById('cfMonthlyCaret');
  if (body && caret) caret.textContent = body.classList.toggle('hidden') ? '+' : '−';
});
['cfDailyTable', 'cfMonthlyTable'].forEach((tid) => {
  document.getElementById(tid)?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr.sales-cash-cell');
    if (!tr) return;
    const bf = document.getElementById('globalBranch')?.value || 'ALL';
    openCashFlowDrilldown(bf, tr.dataset.period || '', tr.dataset.label || 'Cash Flow');
  });
});

function getCashSaleAmount(m) {
  const qty = Math.abs(Number(m.delta_qty) || 0);
  if (qty <= 0) return { net: 0, gross: 0, disc: 0 };
  let srp = Number(m.base_price) || 0;
  if (!srp && state.inventory?.items) {
    const prod = state.inventory.items.find((i) => i.id === m.product_id || i.sku === m.sku);
    srp = Number(prod?.base_price) || 0;
  }
  const gross = Number((srp * qty).toFixed(2));
  const discPct = (m.product_type || 'Cellphones') === 'Accessories' ? 0 : ((Number(m.cash_discount_pct) || 5) / 100);
  const net = Number((srp * (1 - discPct) * qty).toFixed(2));
  return { net, gross, disc: Number(Math.max(0, gross - net).toFixed(2)) };
}

function renderSalesSummary() {
  const sd = state.salesData;
  if (!sd) return;
  const typeFilter = document.getElementById('salesTypeFilter')?.value || 'ALL';
  const branchIds = ['br-molave', 'br-tambulig', 'br-bonifacio'];
  const branchNames = { 'br-molave': 'Molave', 'br-tambulig': 'Tambulig', 'br-bonifacio': 'Bonifacio' };

  const mkCell = () => ({ u: 0, a: 0, g: 0, d: 0 });
  const mkBranchRow = () => ({ 'br-molave': mkCell(), 'br-tambulig': mkCell(), 'br-bonifacio': mkCell() });

  const todayTotals = mkBranchRow();
  const rangeTotals = mkBranchRow();
  const dailyMap = new Map();
  const monthlyMap = new Map();

  const useExactWebTx = typeFilter === 'ALL' && (sd.transactions || []).length > 0;

  if (useExactWebTx) {
    for (const tx of sd.transactions) {
      const dt = String(tx.tx_date || '').slice(0, 10);
      if (!dt || !branchIds.includes(tx.branch_id)) continue;
      const mo = dt.slice(0, 7);
      const bid = tx.branch_id;
      const net = Number(tx.amount) || 0;
      const disc = Number(tx.discount) || 0;
      const gross = Number(tx.srp) || net + disc;

      if (dt === todayStr) {
        todayTotals[bid].u += 1;
        todayTotals[bid].a += net;
        todayTotals[bid].g += gross;
        todayTotals[bid].d += disc;
      }
      if (dt >= sd.start && dt <= sd.end) {
        rangeTotals[bid].u += 1;
        rangeTotals[bid].a += net;
        rangeTotals[bid].g += gross;
        rangeTotals[bid].d += disc;
        if (!dailyMap.has(dt)) dailyMap.set(dt, mkBranchRow());
        dailyMap.get(dt)[bid].u += 1;
        dailyMap.get(dt)[bid].a += net;
        dailyMap.get(dt)[bid].g += gross;
        dailyMap.get(dt)[bid].d += disc;
      }
      if (!monthlyMap.has(mo)) monthlyMap.set(mo, mkBranchRow());
      monthlyMap.get(mo)[bid].u += 1;
      monthlyMap.get(mo)[bid].a += net;
      monthlyMap.get(mo)[bid].g += gross;
      monthlyMap.get(mo)[bid].d += disc;
    }
  } else {
    const cashMoves = (sd.allMovements || []).filter((m) => {
      if (!(Number(m.delta_qty) < 0)) return false;
      const mt = String(m.movement_type || '').toUpperCase();
      if (!mt.includes('SALE') || mt.includes('INSTALLMENT')) return false;
      if (typeFilter !== 'ALL' && (m.product_type || 'Cellphones') !== typeFilter) return false;
      return branchIds.includes(m.branch_id);
    });

    for (const m of cashMoves) {
      const dt = String(m.recorded_at || '').slice(0, 10);
      if (!dt) continue;
      const mo = dt.slice(0, 7);
      const qty = Math.abs(Number(m.delta_qty) || 0);
      const { net, gross, disc } = getCashSaleAmount(m);
      const bid = m.branch_id;

      if (dt === todayStr) {
        todayTotals[bid].u += qty;
        todayTotals[bid].a += net;
        todayTotals[bid].g += gross;
        todayTotals[bid].d += disc;
      }
      if (dt >= sd.start && dt <= sd.end) {
        rangeTotals[bid].u += qty;
        rangeTotals[bid].a += net;
        rangeTotals[bid].g += gross;
        rangeTotals[bid].d += disc;
        if (!dailyMap.has(dt)) dailyMap.set(dt, mkBranchRow());
        dailyMap.get(dt)[bid].u += qty;
        dailyMap.get(dt)[bid].a += net;
        dailyMap.get(dt)[bid].g += gross;
        dailyMap.get(dt)[bid].d += disc;
      }
      if (!monthlyMap.has(mo)) monthlyMap.set(mo, mkBranchRow());
      monthlyMap.get(mo)[bid].u += qty;
      monthlyMap.get(mo)[bid].a += net;
      monthlyMap.get(mo)[bid].g += gross;
      monthlyMap.get(mo)[bid].d += disc;
    }
  }

  const sumAll = (obj) =>
    branchIds.reduce(
      (acc, b) => ({ u: acc.u + obj[b].u, a: acc.a + obj[b].a, g: acc.g + obj[b].g, d: acc.d + obj[b].d }),
      { u: 0, a: 0, g: 0, d: 0 }
    );
  const todayAll = sumAll(todayTotals);
  const rangeAll = sumAll(rangeTotals);
  const unitLabel = useExactWebTx ? 'tx' : 'units';

  // Compute Cash P&L Net Cash Income (Gross Profit - Operating Expenses) for Today and Range per branch
  const finByBranch = new Map((sd.finance?.byBranch || []).map((b) => [b.branchId, b]));
  const todayExpByBranch = { 'br-molave': 0, 'br-tambulig': 0, 'br-bonifacio': 0 };
  for (const e of sd.finance?.recentExpenses || []) {
    if (String(e.expense_date || '').slice(0, 10) === todayStr && todayExpByBranch[e.branch_id] !== undefined) {
      todayExpByBranch[e.branch_id] += Number(e.amount) || 0;
    }
  }
  const todayGpByBranch = { 'br-molave': 0, 'br-tambulig': 0, 'br-bonifacio': 0 };
  const rangeGpByBranch = { 'br-molave': 0, 'br-tambulig': 0, 'br-bonifacio': 0 };
  for (const tx of sd.transactions || []) {
    const dt = String(tx.tx_date || '').slice(0, 10);
    if (!branchIds.includes(tx.branch_id)) continue;
    const net = Number(tx.amount) || 0;
    const cogs = Number(tx.unit_cost) || 0;
    const gp = cogs > 0 ? net - cogs : 0;
    if (dt === todayStr) todayGpByBranch[tx.branch_id] += gp;
    if (dt >= sd.start && dt <= sd.end) rangeGpByBranch[tx.branch_id] += gp;
  }
  const todayCashIncByBranch = {};
  const rangeCashIncByBranch = {};
  let todayCashIncAll = 0;
  let rangeCashIncAll = 0;
  for (const b of branchIds) {
    const tInc = todayGpByBranch[b] - (todayExpByBranch[b] || 0);
    const rInc = rangeGpByBranch[b] - (Number(finByBranch.get(b)?.expenses) || 0);
    todayCashIncByBranch[b] = tInc;
    rangeCashIncByBranch[b] = rInc;
    todayCashIncAll += tInc;
    rangeCashIncAll += rInc;
  }

  const kpiGrid = document.getElementById('salesKpiGrid');
  if (kpiGrid) {
    const renderBigBox = (title, totals, dateFilter, labelPrefix, accentColor, borderGold) => `
      <div class="summary-box sales-big-box"${borderGold ? ' style="border-color:var(--gold);"' : ''}>
        <div class="sales-big-main sales-kpi-drill" data-branch="ALL" data-date="${dateFilter}" data-label="${labelPrefix} (All Branches)" title="Click to view detailed computation">
          <div class="sales-big-title">${title}</div>
          <strong class="sales-big-val" style="color:${accentColor};">${fmtCurrency(totals.all.a)}</strong>
          <div class="summary-note">Gross: ${fmtCurrency(totals.all.g)}${totals.all.d > 0 ? ` • Disc: ${fmtCurrency(totals.all.d)}` : ''} • ${fmtNum(totals.all.u)} ${unitLabel} • Net Cash Inc: <strong style="color:${totals.allInc >= 0 ? 'var(--green)' : 'var(--danger)'};">${fmtCurrency(totals.allInc)}</strong> • 🔎</div>
        </div>
        <div class="sales-branch-subgrid">
          ${branchIds
            .map((b) => {
              const c = totals.byBranch[b];
              const inc = totals.incByBranch[b] || 0;
              return `
              <div class="sales-branch-chip sales-kpi-drill" data-branch="${b}" data-date="${dateFilter}" data-label="${branchNames[b]} ${labelPrefix}" title="Click for ${branchNames[b]} computation">
                <span class="sales-chip-name">${branchNames[b]}</span>
                <strong class="sales-chip-val">${fmtCurrency(c.a)}</strong>
                <span class="sales-chip-sub" style="color:${inc >= 0 ? 'var(--green)' : 'var(--danger)'};font-weight:700;">Net Inc: ${fmtCurrency(inc)}</span>
                <span class="sales-chip-sub">${fmtNum(c.u)} ${unitLabel}</span>
              </div>`;
            })
            .join('')}
        </div>
      </div>`;

    kpiGrid.innerHTML =
      renderBigBox(`TODAY'S NET SALES (${todayStr})`, { all: todayAll, byBranch: todayTotals, allInc: todayCashIncAll, incByBranch: todayCashIncByBranch }, todayStr, "Today's Net Cash Sales", 'var(--gold-bright)', true) +
      renderBigBox(`RANGE NET SALES (${sd.start} → ${sd.end})`, { all: rangeAll, byBranch: rangeTotals, allInc: rangeCashIncAll, incByBranch: rangeCashIncByBranch }, '', 'Range Net Cash Sales', 'var(--green)', false);

    kpiGrid.querySelectorAll('.sales-kpi-drill').forEach((box) => {
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        openSalesDrilldown('cash', box.dataset.branch || 'ALL', box.dataset.label || 'Cash Sales', box.dataset.date || '');
      });
    });
  }

  const fmtCell = (cell, bid, period, labelPrefix, color = '') =>
    cell.u > 0
      ? `<td class="sales-cash-cell" data-branch="${bid}" data-period="${period}" data-label="${labelPrefix}" title="Click for supporting computation"><strong${color ? ` style="color:${color};"` : ''}>${fmtCurrency(cell.a)}</strong><div class="small muted">Gross: ${fmtCurrency(cell.g)} • ${fmtNum(cell.u)} ${unitLabel}</div></td>`
      : '<td><span class="muted">—</span></td>';

  const dailyRows = [...dailyMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const dailyBadge = document.getElementById('salesDailyCountBadge');
  if (dailyBadge) dailyBadge.textContent = `${dailyRows.length} day${dailyRows.length === 1 ? '' : 's'}`;
  const dailyTbody = document.querySelector('#salesDailyTable tbody');
  if (dailyTbody) {
    dailyTbody.innerHTML = dailyRows.length
      ? dailyRows
          .map(([dt, row]) => {
            const tot = sumAll(row);
            return `
            <tr>
              <td><strong>${dt}</strong></td>
              ${fmtCell(row['br-molave'], 'br-molave', dt, `Molave Cash Sales (${dt})`)}
              ${fmtCell(row['br-tambulig'], 'br-tambulig', dt, `Tambulig Cash Sales (${dt})`)}
              ${fmtCell(row['br-bonifacio'], 'br-bonifacio', dt, `Bonifacio Cash Sales (${dt})`)}
              ${fmtCell(tot, 'ALL', dt, `All Branches Cash Sales (${dt})`, 'var(--gold-bright)')}
            </tr>`;
          })
          .join('')
      : '<tr><td colspan="5" class="muted">No cash sales recorded in this date range.</td></tr>';
  }

  const monthlyRows = [...monthlyMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const monthlyBadge = document.getElementById('salesMonthlyCountBadge');
  if (monthlyBadge) monthlyBadge.textContent = `${monthlyRows.length} month${monthlyRows.length === 1 ? '' : 's'}`;
  const monthlyTbody = document.querySelector('#salesMonthlyTable tbody');
  if (monthlyTbody) {
    monthlyTbody.innerHTML = monthlyRows.length
      ? monthlyRows
          .map(([mo, row]) => {
            const tot = sumAll(row);
            return `
            <tr>
              <td><strong>${mo}</strong></td>
              ${fmtCell(row['br-molave'], 'br-molave', mo, `Molave Cash Sales (${mo})`)}
              ${fmtCell(row['br-tambulig'], 'br-tambulig', mo, `Tambulig Cash Sales (${mo})`)}
              ${fmtCell(row['br-bonifacio'], 'br-bonifacio', mo, `Bonifacio Cash Sales (${mo})`)}
              ${fmtCell(tot, 'ALL', mo, `All Branches Cash Sales (${mo})`, 'var(--green)')}
            </tr>`;
          })
          .join('')
      : '<tr><td colspan="5" class="muted">No monthly cash sales recorded yet.</td></tr>';
  }
}

function renderSalesCashPnlTool() {
  const sd = state.salesData;
  const tbody = document.querySelector('#salesCashPnlTable tbody');
  const banner = document.getElementById('cashPnlAuditBanner');
  if (!sd || !tbody) return;

  const branchIds = ['br-molave', 'br-tambulig', 'br-bonifacio'];
  const finByBranch = new Map((sd.finance?.byBranch || []).map((b) => [b.branchId, b]));
  const stats = {};
  for (const bid of branchIds) {
    stats[bid] = {
      gross: 0,
      disc: 0,
      net: 0,
      cogs: 0,
      gp: 0,
      expenses: Number(finByBranch.get(bid)?.expenses) || 0,
      netIncome: 0,
    };
  }

  for (const tx of sd.transactions || []) {
    const dt = String(tx.tx_date || '').slice(0, 10);
    if (dt < sd.start || dt > sd.end || !stats[tx.branch_id]) continue;
    const net = Number(tx.amount) || 0;
    const disc = Number(tx.discount) || 0;
    const gross = Number(tx.srp) || net + disc;
    const cogs = Number(tx.unit_cost) || 0;
    const s = stats[tx.branch_id];
    s.gross += gross;
    s.disc += disc;
    s.net += net;
    s.cogs += cogs;
    s.gp += cogs > 0 ? net - cogs : 0;
  }

  const tot = { gross: 0, disc: 0, net: 0, cogs: 0, gp: 0, expenses: 0, netIncome: 0 };
  for (const bid of branchIds) {
    const s = stats[bid];
    s.netIncome = s.gp - s.expenses;
    tot.gross += s.gross;
    tot.disc += s.disc;
    tot.net += s.net;
    tot.cogs += s.cogs;
    tot.gp += s.gp;
    tot.expenses += s.expenses;
    tot.netIncome += s.netIncome;
  }

  const colBranches = ['br-molave', 'br-tambulig', 'br-bonifacio', 'ALL'];
  const cols = [stats['br-molave'], stats['br-tambulig'], stats['br-bonifacio'], tot];
  const row = (label, fn, opts = {}) => {
    const bg = opts.bold ? 'background:rgba(255,255,255,0.03);font-weight:700;' : '';
    const drill = opts.drill || 'cash';
    return `<tr style="${bg}"><td>${label}</td>${cols
      .map((c, idx) => {
        const val = fn(c);
        const bid = colBranches[idx];
        const dAttrs = `class="sales-drill-cell" data-drill-kind="${drill}" data-drill-branch="${bid}" data-drill-label="${label.replace(/"/g, '&quot;')}" title="Click to inspect actual computation" style="cursor:pointer;text-decoration:underline dotted;`;
        if (opts.pct) return `<td ${dAttrs}color:${val >= 10 ? 'var(--green)' : val >= 5 ? 'var(--gold-bright)' : 'var(--danger)'};"><strong>${val.toFixed(2)}%</strong></td>`;
        const clr = opts.auto ? (val >= 0 ? 'var(--green)' : 'var(--danger)') : opts.color || '';
        return `<td ${dAttrs}${clr ? `color:${clr};` : ''}">${opts.bold ? `<strong>${fmtCurrency(val)}</strong>` : fmtCurrency(val)}</td>`;
      })
      .join('')}</tr>`;
  };

  tbody.innerHTML = [
    row('Gross Cash Sales (SRP)', (c) => c.gross),
    row('Less: Cash Sales Discounts', (c) => -c.disc, { color: 'var(--muted)' }),
    row('= Net Cash Sales (Amount Collected)', (c) => c.net, { bold: true }),
    row('Less: Cost of Goods Sold (FIFO Unit Cost)', (c) => -c.cogs, { color: 'var(--danger)' }),
    row('= True Cash Sales Gross Profit (Net − COGS)', (c) => c.gp, { bold: true, color: 'var(--green)' }),
    row('True Cash Gross Margin %', (c) => (c.net > 0 ? (c.gp / c.net) * 100 : 0), { pct: true }),
    row('Memo: AB Web Buggy Sales Income (Double-Subtracted Discount)', (c) => c.gp - c.disc, { color: 'var(--muted)' }),
  ].join('');

  state.salesCashStats = { stats, tot };

  if (banner) {
    banner.innerHTML = `<strong>Cash Segment Only (${sd.start} → ${sd.end}):</strong> True Cash Sales Gross Profit is <strong>${fmtCurrency(tot.gp)}</strong> (<strong>${tot.net > 0 ? ((tot.gp / tot.net) * 100).toFixed(2) : '0.00'}%</strong> margin). Shared branch operating expenses are deducted once in <strong>CONSOLIDATED P&amp;L</strong> to avoid double deduction. AB Web understated Cash Profit by <strong>${fmtCurrency(tot.disc)}</strong>.`;
  }
}

function estimateProductCostByName(unitName) {
  if (!unitName || !state.inventory?.items) return 0;
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/\bplus\b/g, '+')
      .replace(/\bgalaxy\b/g, '')
      .replace(/gb\b/g, '')
      .replace(/\b4g\b/g, '')
      .replace(/[^a-z0-9+]/g, '');
  const target = norm(unitName);
  if (!target) return 0;
  for (const p of state.inventory.items) {
    const k1 = norm((p.brand || '') + ' ' + (p.model || p.name));
    const k2 = norm(p.model || p.name);
    if (k1 === target || k2 === target || (k1.length > 6 && (target.includes(k1) || k1.includes(target))) || (k2.length > 6 && (target.includes(k2) || k2.includes(target)))) {
      const sups = [Number(p.cost_ab) || 0, Number(p.cost_ak) || 0, Number(p.cost_online) || 0].filter((v) => v > 0);
      if (sups.length) return Math.min(...sups);
      if (Number(p.cost_price) > 0) return Number(p.cost_price);
    }
  }
  return 0;
}

function renderSalesInstallmentAccrualTool() {
  const sd = state.salesData;
  const tbody = document.querySelector('#salesInstallmentAccrualTable tbody');
  const guide = document.getElementById('installmentAccrualGuide');
  if (!sd || !tbody) return;

  const rawBd = document.getElementById('accrualBadDebtPct')?.value;
  const badDebtPct = Math.max(0, Math.min(30, rawBd === '' || rawBd == null ? 5 : Number(rawBd))) / 100;
  const branchIds = ['br-molave', 'br-tambulig', 'br-bonifacio'];
  const finByBranch = new Map((sd.finance?.byBranch || []).map((b) => [b.branchId, b]));
  const allInst = sd.receivables?.installments || [];
  const allPastDues = sd.receivables?.pastDues || [];

  // Period length in months (for pro-rating monthly accrued interest)
  const d1 = new Date(`${sd.start}T00:00:00Z`);
  const d2 = new Date(`${sd.end}T00:00:00Z`);
  const periodDays = Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
  const periodMonths = Math.max(0.1, periodDays / 30);

  const stats = {};
  for (const bid of branchIds) {
    const branchPds = allPastDues.filter((pd) => pd.branch_id === bid);
    const ag = computeAgingAllowance(branchPds);
    const finRec = finByBranch.get(bid);
    stats[bid] = {
      newCount: 0,
      newPrincipal: 0,
      contractSales: 0,
      estCogs: 0,
      merchGp: 0,
      accruedInterest: 0,
      penalties: Number(finRec?.penalties) || 0,
      detectedRebates: Number(finRec?.detectedRebates) || 0,
      unrecordedPrincipalLoss: Number(finRec?.unrecordedPrincipalLoss) || 0,
      pastDueBalance: ag.totalPastDue,
      openingAllowance: ag.requiredAllowance,
      badDebtProvision: 0,
      expenses: Number(finRec?.expenses) || 0,
      accrualNetIncome: 0,
      abWebCashInterest: Number(finRec?.financingIncome) || 0,
    };
  }

  for (const inst of allInst) {
    const bid = inst.branch_id;
    if (!stats[bid]) continue;
    const s = stats[bid];
    const saleDate = String(inst.sale_date || '').slice(0, 10);
    const term = Math.max(1, Number(inst.term) || 6);
    const monthly = Number(inst.monthly) || 0;
    const principal = Number(inst.principal_amount) || 0;
    const deposit = Number(inst.deposit) || 0;
    const cashEquivSrp = deposit + principal > 0 ? deposit + principal : Number(inst.amount) || 0;

    // 1. Merchandising Revenue & Gross Profit recognized at Point of Sale (in selected range)
    if (saleDate >= sd.start && saleDate <= sd.end) {
      s.newCount++;
      s.newPrincipal += principal;
      s.contractSales += cashEquivSrp;
      const matchedCost = estimateProductCostByName(inst.unit);
      const unitCogs = matchedCost > 0 ? matchedCost : cashEquivSrp * 0.85;
      s.estCogs += unitCogs;
      s.merchGp += Math.max(0, cashEquivSrp - unitCogs);
    }

    // 2. Accrual Financing Interest earned during the selected period on active contracts
    if (saleDate <= sd.end) {
      const startObj = new Date(`${saleDate}T00:00:00Z`);
      const monthsElapsed = (d2 - startObj) / (86400000 * 30);
      if (monthsElapsed >= 0 && monthsElapsed <= term + 0.5) {
        const totalFinanceCharge = Math.max(0, monthly * term - principal);
        const monthlyEarnedInt = totalFinanceCharge / term;
        s.accruedInterest += monthlyEarnedInt * Math.min(periodMonths, 1);
      }
    }
  }

  const tot = {
    newCount: 0, newPrincipal: 0, contractSales: 0, estCogs: 0, merchGp: 0, accruedInterest: 0,
    penalties: 0, detectedRebates: 0, unrecordedPrincipalLoss: 0,
    pastDueBalance: 0, openingAllowance: 0, badDebtProvision: 0, expenses: 0, accrualNetIncome: 0, abWebCashInterest: 0,
  };
  for (const bid of branchIds) {
    const s = stats[bid];
    // Prospective Monthly Bad Debt Expense = % of New Installment Principal
    s.badDebtProvision = s.newPrincipal * badDebtPct;
    s.accrualNetIncome = s.merchGp + s.accruedInterest + s.penalties - s.detectedRebates - s.badDebtProvision - s.expenses;
    for (const k of Object.keys(tot)) tot[k] += s[k];
  }

  const colBranches = ['br-molave', 'br-tambulig', 'br-bonifacio', 'ALL'];
  const cols = [stats['br-molave'], stats['br-tambulig'], stats['br-bonifacio'], tot];
  const row = (label, fn, opts = {}) => {
    const bg = opts.bold ? 'background:rgba(255,255,255,0.03);font-weight:700;' : '';
    const drill = opts.drill || 'installment';
    return `<tr style="${bg}"><td>${label}</td>${cols
      .map((c, idx) => {
        const val = fn(c);
        const bid = colBranches[idx];
        const clr = opts.auto ? (val >= 0 ? 'var(--green)' : 'var(--danger)') : opts.color || '';
        const dAttrs = `class="sales-drill-cell" data-drill-kind="${drill}" data-drill-branch="${bid}" data-drill-label="${label.replace(/"/g, '&quot;')}" title="Click to inspect actual computation" style="cursor:pointer;text-decoration:underline dotted;${clr ? `color:${clr};` : ''}"`;
        return `<td ${dAttrs}>${opts.bold ? `<strong>${fmtCurrency(val)}</strong>` : fmtCurrency(val)}</td>`;
      })
      .join('')}</tr>`;
  };

  tbody.innerHTML = [
    row('Installment Sales Revenue (Cash-Equiv SRP at Release)', (c) => c.contractSales, { drill: 'installment' }),
    row('Less: Est. Unit Cost of Goods Sold (COGS)', (c) => -c.estCogs, { color: 'var(--danger)', drill: 'installment' }),
    row('= Installment Merchandising Gross Profit (Earned at Release)', (c) => c.merchGp, { bold: true, color: 'var(--green)', drill: 'installment' }),
    row('Add: Accrued Interest Income (Earned Over Term, Accrual Basis)', (c) => c.accruedInterest, { color: 'var(--green)', drill: 'accrued_interest' }),
    row('Add: Late Payment Penalties Collected', (c) => c.penalties, { color: 'var(--green)', drill: 'penalties' }),
    row('Less: Early-Payment Rebates (2.5% Auto-Deducted Detection)', (c) => -c.detectedRebates, { color: '#f59e0b', drill: 'rebates_detected' }),
    row('= Total Accrual Installment Gross Income', (c) => c.merchGp + c.accruedInterest + c.penalties - c.detectedRebates, { bold: true, drill: 'installment' }),
    row(`Less: Prospective Monthly Bad Debt Expense (${(badDebtPct * 100).toFixed(1)}% of New Principal)`, (c) => -c.badDebtProvision, { color: '#f59e0b', drill: 'installment' }),
    row('= Net Installment & Financing Contribution (Before Shared OpEx)', (c) => c.merchGp + c.accruedInterest + c.penalties - c.detectedRebates - c.badDebtProvision, { bold: true, auto: true, drill: 'installment' }),
    row('Memo: One-Time Opening Allowance (Aging-Based on Past-Due Accounts — Synced w/ Receivables)', (c) => c.openingAllowance, { color: '#f59e0b', drill: 'opening_allowance' }),
    row('Compare: Cash-Basis Financing Income (Int + Pen − Hidden Rebate Prin. Adj)', (c) => c.abWebCashInterest, { color: 'var(--muted)', drill: 'cash_interest' }),
    row('Accrual vs Cash-Basis Financing Variance', (c) => (c.accruedInterest + c.penalties - c.detectedRebates) - c.abWebCashInterest, { color: 'var(--gold-bright)', drill: 'accrued_interest' }),
  ].join('');

  state.salesInstStats = { stats, tot, badDebtPct };
  renderSalesConsolidatedTool();

  if (guide) {
    guide.innerHTML = `
      <strong style="color:var(--gold-bright);">How to Properly Compute Installment Net Income Under the Accrual Method (PFRS 15 / Accounting Standards):</strong>
      <ol style="margin:6px 0 0 18px;padding:0;">
        <li><strong>Separate Merchandising Revenue from Financing Revenue:</strong> At the moment a phone is released on installment, recognize <em>only</em> the <strong>Cash-Equivalent SRP (Deposit + Principal)</strong> as Sales Revenue and match it immediately against the phone's <strong>FIFO Cost (COGS)</strong> to get <em>Installment Merchandising Gross Profit</em>. Do <strong>not</strong> count downpayments or monthly principal collections as revenue again.</li>
        <li><strong>Accrue Interest Income Monthly as Earned &amp; Adjust for Penalties/Rebates:</strong> Record the total finance charge <code>(Monthly × Term) − Principal</code> as <em>Unearned Interest Income</em> at release, then recognize gross interest monthly, adding <strong>Late Payment Penalties</strong> and deducting <strong>2.5% Early-Payment Rebates</strong> (auto-deducted by AB Web before cash posting).</li>
        <li><strong>Match with a Bad Debt Provision (Allowance for Doubtful Accounts):</strong> Because accrual accounting records revenue and interest before cash arrives, deduct a monthly bad-debt allowance (e.g. <strong>3% of New Principal</strong>, adjustable above) so Net Income isn't overstated by uncollectible accounts.</li>
        <li><strong>Deduct Operating Expenses Incurred:</strong> Deduct salaries, rent, utilities, and franchise shares incurred during the period (whether paid in cash or still payable).</li>
      </ol>
    `;
  }
}

function renderSalesConsolidatedTool() {
  const sd = state.salesData;
  const cashData = state.salesCashStats;
  const instData = state.salesInstStats;
  const tbody = document.querySelector('#salesConsolidatedTable tbody');
  const banner = document.getElementById('consolidatedPnlBanner');
  if (!sd || !cashData || !instData || !tbody) return;

  const branchIds = ['br-molave', 'br-tambulig', 'br-bonifacio'];
  const finByBranch = new Map((sd.finance?.byBranch || []).map((b) => [b.branchId, b]));

  const buildCol = (c, i, exp) => {
    const instContrib = i.merchGp + i.accruedInterest + (i.penalties || 0) - (i.detectedRebates || 0) - i.badDebtProvision;
    const totalGrossContrib = c.gp + instContrib;
    const realAccrualNet = totalGrossContrib - exp;
    const cashBasisTotalGross = c.gp + i.merchGp + i.abWebCashInterest;
    const realCashInterestNet = cashBasisTotalGross - exp;
    return {
      cashGross: c.gross,
      cashDisc: c.disc,
      cashNet: c.net,
      cashCogs: c.cogs,
      cashGp: c.gp,
      instRev: i.contractSales,
      instCogs: i.estCogs,
      instGp: i.merchGp,
      accruedInt: i.accruedInterest,
      penalties: i.penalties || 0,
      detectedRebates: i.detectedRebates || 0,
      unrecordedPrincipalLoss: i.unrecordedPrincipalLoss || 0,
      badDebt: i.badDebtProvision,
      openingAllowance: i.openingAllowance || 0,
      instContrib,
      totalGrossContrib,
      expenses: exp,
      realAccrualNet,
      abWebCashInt: i.abWebCashInterest,
      realCashInterestNet,
    };
  };

  const cols = branchIds.map((bid) =>
    buildCol(cashData.stats[bid], instData.stats[bid], Number(finByBranch.get(bid)?.expenses) || 0)
  );
  const totExp = cols.reduce((s, x) => s + x.expenses, 0);
  cols.push(buildCol(cashData.tot, instData.tot, totExp));

  const colBranches = ['br-molave', 'br-tambulig', 'br-bonifacio', 'ALL'];
  const row = (label, fn, opts = {}) => {
    const bg = opts.bold ? 'background:rgba(255,255,255,0.04);font-weight:700;' : '';
    const drill = opts.drill || 'cash';
    return `<tr style="${bg}"><td>${label}</td>${cols
      .map((col, idx) => {
        const v = fn(col);
        const bid = colBranches[idx];
        const clr = opts.auto ? (v >= 0 ? 'var(--green)' : 'var(--danger)') : opts.color || '';
        const dAttrs = `class="sales-drill-cell" data-drill-kind="${drill}" data-drill-branch="${bid}" data-drill-label="${label.replace(/"/g, '&quot;')}" title="Click to inspect actual computation" style="cursor:pointer;text-decoration:underline dotted;${clr ? `color:${clr};` : ''}"`;
        return `<td ${dAttrs}>${opts.bold ? `<strong>${fmtCurrency(v)}</strong>` : fmtCurrency(v)}</td>`;
      })
      .join('')}</tr>`;
  };

  tbody.innerHTML = [
    row('A. Gross Cash Sales (SRP)', (c) => c.cashGross, { drill: 'cash' }),
    row('   Less: Cash Sales Discounts', (c) => -c.cashDisc, { color: 'var(--muted)', drill: 'cash' }),
    row('   = Net Cash Sales', (c) => c.cashNet, { bold: true, drill: 'cash' }),
    row('   Less: Cash Cost of Goods Sold (FIFO)', (c) => -c.cashCogs, { color: 'var(--danger)', drill: 'cash' }),
    row('   = True Cash Sales Gross Profit', (c) => c.cashGp, { bold: true, color: 'var(--green)', drill: 'cash' }),
    row('B. Installment Sales Revenue (Cash-Equiv SRP)', (c) => c.instRev, { drill: 'installment' }),
    row('   Less: Est. Installment Unit COGS', (c) => -c.instCogs, { color: 'var(--danger)', drill: 'installment' }),
    row('   = Installment Merchandising Gross Profit', (c) => c.instGp, { color: 'var(--green)', drill: 'installment' }),
    row('   Add: Accrued Interest Income (Monthly Earned, Gross)', (c) => c.accruedInt, { color: 'var(--green)', drill: 'accrued_interest' }),
    row('   Add: Late Payment Penalties Collected', (c) => c.penalties, { color: 'var(--green)', drill: 'penalties' }),
    row('   Less: Early-Payment Rebates (2.5% Auto-Deducted Detection)', (c) => -c.detectedRebates, { color: '#f59e0b', drill: 'rebates_detected' }),
    row(`   Less: Prospective Monthly Bad Debt (${((instData.badDebtPct ?? 0.05) * 100).toFixed(1)}% of New Principal)`, (c) => -c.badDebt, { color: '#f59e0b', drill: 'installment' }),
    row('   = Net Installment & Financing Contribution', (c) => c.instContrib, { bold: true, color: 'var(--green)', drill: 'installment' }),
    row('C. Total Consolidated Gross Contribution (A + B)', (c) => c.totalGrossContrib, { bold: true, drill: 'cash' }),
    row('D. Less: Shared Branch Operating Expenses (Deducted ONCE)', (c) => -c.expenses, { color: 'var(--danger)', drill: 'expenses' }),
    row('E. REAL CONSOLIDATED NET INCOME (Accrual Method)', (c) => c.realAccrualNet, { bold: true, auto: true, drill: 'expenses' }),
    row('Memo: One-Time Opening Allowance (Aging-Based — Synced w/ Receivables Tab)', (c) => c.openingAllowance, { color: '#f59e0b', drill: 'opening_allowance' }),
    row('Memo: Hidden Rebate Profit Overstatement in AB Web (~67% Principal Share)', (c) => -c.unrecordedPrincipalLoss, { color: '#f59e0b', drill: 'rebates_detected' }),
    row('Reference: Consolidated Net Income (Cash-Collected Int., Adj. for Penalties & 2.5% Rebates)', (c) => c.realCashInterestNet, { bold: true, color: 'var(--gold-bright)', drill: 'cash_interest' }),
  ].join('');

  const totCol = cols[cols.length - 1];
  if (banner) {
    banner.innerHTML = `<strong>Consolidated Branch P&amp;L (${sd.start} → ${sd.end}):</strong> Combines Cash GP (<strong>${fmtCurrency(totCol.cashGp)}</strong>) + Installment &amp; Financing Contribution (<strong>${fmtCurrency(totCol.instContrib)}</strong>, incl. <strong style="color:var(--green);">+${fmtCurrency(totCol.penalties)}</strong> penalties &amp; <strong style="color:#f59e0b;">−${fmtCurrency(totCol.detectedRebates)}</strong> detected 2.5% rebates), less Shared OpEx (<strong>${fmtCurrency(totCol.expenses)}</strong>) <strong>once</strong> → Real Accrual Net Income: <strong style="color:${totCol.realAccrualNet >= 0 ? 'var(--green)' : 'var(--danger)'};">${fmtCurrency(totCol.realAccrualNet)}</strong> (Cash-Collected basis: <strong style="color:var(--gold-bright);">${fmtCurrency(totCol.realCashInterestNet)}</strong> after <strong>−${fmtCurrency(totCol.unrecordedPrincipalLoss)}</strong> hidden Principal rebate adj.).`;
  }
  renderHistoricalRestatedNetIncome();
}

function renderHistoricalRestatedNetIncome() {
  const sd = state.salesData;
  const tbody = document.querySelector('#salesHistoricalRestatedTable tbody');
  if (!sd || !tbody) return;

  const groupMode = document.getElementById('restatedGroupMode')?.value || 'MONTHLY';
  const branchFilter = document.getElementById('restatedBranchFilter')?.value || 'ALL';
  const spreadMode = document.getElementById('restatedSpreadMode')?.value || 'VINTAGE';
  const matchBranch = (bid) => branchFilter === 'ALL' || bid === branchFilter;

  const periodHdr = document.getElementById('restatedPeriodHeader');
  if (periodHdr) periodHdr.textContent = groupMode === 'ANNUAL' ? 'Year' : 'Month';

  // Collect ALL historical months endlessly across transactions, installments, expenses, and past dues
  const monthSet = new Set([todayStr.slice(0, 7)]);
  const addMo = (dStr) => {
    const mo = String(dStr || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(mo)) monthSet.add(mo);
  };
  for (const tx of sd.transactions || []) if (matchBranch(tx.branch_id)) addMo(tx.tx_date);
  for (const inst of sd.receivables?.installments || []) if (matchBranch(inst.branch_id)) addMo(inst.sale_date);
  const allExps = sd.histFinance?.recentExpenses || sd.finance?.recentExpenses || [];
  for (const e of allExps) if (matchBranch(e.branch_id)) addMo(e.expense_date);
  const pds = (sd.receivables?.pastDues || []).filter((pd) => matchBranch(pd.branch_id));
  for (const pd of pds) addMo(pd.release_date);

  const months = [...monthSet].sort((a, b) => b.localeCompare(a));
  const mkRow = (period) => ({ period, cashGp: 0, instIncome: 0, expenses: 0, spreadBadDebt: 0 });
  const rowMap = new Map(months.map((m) => [m, mkRow(m)]));

  // 1. Cash Sales Gross Profit per month
  for (const tx of sd.transactions || []) {
    if (!matchBranch(tx.branch_id)) continue;
    const mo = String(tx.tx_date || '').slice(0, 7);
    const r = rowMap.get(mo);
    if (!r) continue;
    const net = Number(tx.amount) || 0;
    const cost = Number(tx.unit_cost) || 0;
    if (cost > 0) r.cashGp += net - cost;
  }

  // 2. Installment Merchandising GP + Monthly Accrued Interest per month
  for (const inst of sd.receivables?.installments || []) {
    if (!matchBranch(inst.branch_id)) continue;
    const saleDate = String(inst.sale_date || '').slice(0, 10);
    const saleMo = saleDate.slice(0, 7);
    const term = Math.max(1, Number(inst.term) || 6);
    const monthly = Number(inst.monthly) || 0;
    const principal = Number(inst.principal_amount) || 0;
    const deposit = Number(inst.deposit) || 0;
    const srp = deposit + principal > 0 ? deposit + principal : Number(inst.amount) || 0;

    if (rowMap.has(saleMo)) {
      const matched = estimateProductCostByName(inst.unit);
      const cost = matched > 0 ? matched : srp * 0.85;
      rowMap.get(saleMo).instIncome += Math.max(0, srp - cost);
    }

    const totalFc = Math.max(0, monthly * term - principal);
    const moInt = totalFc / term;
    const startObj = new Date(`${saleDate}T00:00:00Z`);
    for (const mo of months) {
      const [y, m] = mo.split('-').map(Number);
      const moEnd = new Date(Date.UTC(y, m, 0));
      const elapsed = (moEnd - startObj) / (86400000 * 30);
      if (elapsed >= 0 && elapsed <= term + 0.5) {
        rowMap.get(mo).instIncome += moInt;
      }
    }
  }

  // 2b. Add Net Penalties − Detected 2.5% Early-Payment Rebates per payment month
  const allPays = (sd.histFinance?.recentPayments || sd.finance?.recentPayments || []).filter((p) => matchBranch(p.branch_id));
  for (const ev of analyzePaymentRebates(allPays, 'DETECTED').events) {
    const mo = String(ev.payment_date || '').slice(0, 7);
    if (rowMap.has(mo)) rowMap.get(mo).instIncome += ev.penalties - ev.activeRebate;
  }

  // 3. Operating Expenses per month
  for (const e of allExps) {
    if (!matchBranch(e.branch_id)) continue;
    const mo = String(e.expense_date || '').slice(0, 7);
    if (rowMap.has(mo)) rowMap.get(mo).expenses += Number(e.amount) || 0;
  }

  // 4. Spread One-Time Opening Allowance across all historical months
  if (spreadMode === 'EVEN') {
    const totalAllow = computeAgingAllowance(pds).requiredAllowance;
    const perMo = months.length ? totalAllow / months.length : 0;
    for (const mo of months) rowMap.get(mo).spreadBadDebt += perMo;
  } else {
    for (const pd of pds) {
      const allow = (Number(pd.balance) || 0) * getAgingTier(getEffectiveDaysDue(pd)).rate;
      const relMo = String(pd.release_date || '').slice(0, 7);
      if (rowMap.has(relMo)) rowMap.get(relMo).spreadBadDebt += allow;
    }
  }

  let displayRows = months.map((m) => rowMap.get(m));

  // Annual roll-up by YYYY if Annual view is selected
  if (groupMode === 'ANNUAL') {
    const yearMap = new Map();
    for (const r of displayRows) {
      const yr = r.period.slice(0, 4);
      if (!yearMap.has(yr)) yearMap.set(yr, mkRow(yr));
      const yRow = yearMap.get(yr);
      yRow.cashGp += r.cashGp;
      yRow.instIncome += r.instIncome;
      yRow.expenses += r.expenses;
      yRow.spreadBadDebt += r.spreadBadDebt;
    }
    displayRows = [...yearMap.values()].sort((a, b) => b.period.localeCompare(a.period));
  }

  let tCash = 0, tInst = 0, tExp = 0, tUnadj = 0, tBd = 0, tCorr = 0;
  tbody.innerHTML =
    displayRows
      .map((r) => {
        const unadj = r.cashGp + r.instIncome - r.expenses;
        const corr = unadj - r.spreadBadDebt;
        tCash += r.cashGp; tInst += r.instIncome; tExp += r.expenses;
        tUnadj += unadj; tBd += r.spreadBadDebt; tCorr += corr;
        return `
          <tr>
            <td><strong>${r.period}</strong></td>
            <td>${fmtCurrency(r.cashGp)}</td>
            <td>${fmtCurrency(r.instIncome)}</td>
            <td style="color:var(--danger);">${fmtCurrency(-r.expenses)}</td>
            <td><strong>${fmtCurrency(unadj)}</strong></td>
            <td style="color:#f59e0b;"><strong>${fmtCurrency(-r.spreadBadDebt)}</strong></td>
            <td style="color:${corr >= 0 ? 'var(--green)' : 'var(--danger)'};"><strong>${fmtCurrency(corr)}</strong></td>
          </tr>`;
      })
      .join('') +
    `<tr style="background:rgba(255,255,255,0.05);font-weight:700;">
      <td>ALL-TIME TOTAL RESTATED</td>
      <td>${fmtCurrency(tCash)}</td>
      <td>${fmtCurrency(tInst)}</td>
      <td style="color:var(--danger);">${fmtCurrency(-tExp)}</td>
      <td>${fmtCurrency(tUnadj)}</td>
      <td style="color:#f59e0b;">${fmtCurrency(-tBd)}</td>
      <td style="color:${tCorr >= 0 ? 'var(--green)' : 'var(--danger)'};"><strong>${fmtCurrency(tCorr)}</strong></td>
    </tr>`;
}

document.getElementById('restatedGroupMode')?.addEventListener('change', renderHistoricalRestatedNetIncome);
document.getElementById('restatedBranchFilter')?.addEventListener('change', renderHistoricalRestatedNetIncome);
document.getElementById('restatedSpreadMode')?.addEventListener('change', renderHistoricalRestatedNetIncome);

function renderSalesChartsTool() {
  const sd = state.salesData;
  const container = document.getElementById('salesChartContainer');
  const legendEl = document.getElementById('salesChartLegend');
  if (!sd || !container) return;

  const periodMode = document.getElementById('salesChartPeriod')?.value || 'MONTHLY';
  const metric = document.getElementById('salesChartMetric')?.value || 'NET_CASH';
  const branchMode = document.getElementById('salesChartBranch')?.value || 'GROUPED';

  const branches = [
    { id: 'br-molave', name: 'Molave', color: '#77e82a' },
    { id: 'br-tambulig', name: 'Tambulig', color: '#3b82f6' },
    { id: 'br-bonifacio', name: 'Bonifacio', color: '#f59e0b' },
  ];

  // Collect periods (YYYY-MM or YYYY) across all history
  const keyOf = (dStr) => {
    const s = String(dStr || '');
    return periodMode === 'YEARLY' ? s.slice(0, 4) : s.slice(0, 7);
  };
  const validKey = (k) => (periodMode === 'YEARLY' ? /^\d{4}$/.test(k) : /^\d{4}-\d{2}$/.test(k));

  const dataMap = new Map();
  const ensure = (k) => {
    if (!dataMap.has(k)) {
      dataMap.set(k, {
        'br-molave': { net: 0, gross: 0, gp: 0, exp: 0, inst: 0 },
        'br-tambulig': { net: 0, gross: 0, gp: 0, exp: 0, inst: 0 },
        'br-bonifacio': { net: 0, gross: 0, gp: 0, exp: 0, inst: 0 },
      });
    }
    return dataMap.get(k);
  };

  for (const tx of sd.transactions || []) {
    const k = keyOf(tx.tx_date);
    if (!validKey(k) || !['br-molave', 'br-tambulig', 'br-bonifacio'].includes(tx.branch_id)) continue;
    const cell = ensure(k)[tx.branch_id];
    const net = Number(tx.amount) || 0;
    const disc = Number(tx.discount) || 0;
    const gross = Number(tx.srp) || net + disc;
    const cost = Number(tx.unit_cost) || 0;
    cell.net += net;
    cell.gross += gross;
    if (cost > 0) cell.gp += net - cost;
  }

  if (metric === 'CONSOLIDATED_NET') {
    for (const e of sd.histFinance?.recentExpenses || []) {
      const k = keyOf(e.expense_date);
      if (!validKey(k) || !['br-molave', 'br-tambulig', 'br-bonifacio'].includes(e.branch_id)) continue;
      ensure(k)[e.branch_id].exp += Number(e.amount) || 0;
    }
    const chartReb = analyzePaymentRebates(sd.histFinance?.recentPayments || [], 'DETECTED');
    for (const ev of chartReb.events) {
      const k = keyOf(ev.payment_date);
      if (!validKey(k) || !['br-molave', 'br-tambulig', 'br-bonifacio'].includes(ev.branch_id)) continue;
      ensure(k)[ev.branch_id].inst += ev.trueFinInc;
    }
    for (const inst of sd.receivables?.installments || []) {
      const k = keyOf(inst.sale_date);
      if (!validKey(k) || !['br-molave', 'br-tambulig', 'br-bonifacio'].includes(inst.branch_id)) continue;
      const dp = Number(inst.deposit) || 0;
      const prin = Number(inst.principal_amount) || 0;
      const srp = dp + prin > 0 ? dp + prin : Number(inst.amount) || 0;
      const matched = estimateProductCostByName(inst.unit);
      const cost = matched > 0 ? matched : srp * 0.85;
      ensure(k)[inst.branch_id].inst += Math.max(0, srp - cost);
    }
  }

  let periods = [...dataMap.keys()].sort((a, b) => a.localeCompare(b));
  if (periodMode === 'MONTHLY' && periods.length > 12) periods = periods.slice(-12);

  if (!periods.length) {
    container.innerHTML = '<div class="muted small" style="padding:16px 0;">No sales data available to chart yet.</div>';
    return;
  }

  const getMetricVal = (cell) => {
    if (metric === 'GROSS_CASH') return cell.gross;
    if (metric === 'CASH_GP') return cell.gp;
    if (metric === 'CONSOLIDATED_NET') return cell.gp + cell.inst - cell.exp;
    return cell.net;
  };

  const series =
    branchMode === 'GROUPED'
      ? branches
      : branchMode === 'TOTAL'
        ? [{ id: 'TOTAL', name: 'All Branches Total', color: '#e7c55f' }]
        : branches.filter((b) => b.id === branchMode);

  if (legendEl) {
    legendEl.innerHTML = series
      .map(
        (s) =>
          `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:12px;height:12px;border-radius:3px;background:${s.color};display:inline-block;"></span><strong>${s.name}</strong></span>`
      )
      .join('');
  }

  const values = [];
  for (const p of periods) {
    const row = dataMap.get(p);
    for (const s of series) {
      const v =
        s.id === 'TOTAL'
          ? getMetricVal(row['br-molave']) + getMetricVal(row['br-tambulig']) + getMetricVal(row['br-bonifacio'])
          : getMetricVal(row[s.id]);
      values.push(v);
    }
  }
  const maxVal = Math.max(1, ...values.map((v) => Math.max(0, v)));
  const fmtShort = (v) => (Math.abs(v) >= 1000000 ? `₱${(v / 1000000).toFixed(2)}M` : Math.abs(v) >= 1000 ? `₱${(v / 1000).toFixed(1)}k` : `₱${Math.round(v)}`);

  const groupW = series.length === 1 ? 74 : 108;
  const barW = series.length === 1 ? 40 : 24;
  const barGap = 5;
  const chartH = 220;
  const topPad = 28;
  const bottomPad = 34;
  const leftPad = 14;
  const svgW = Math.max(520, leftPad * 2 + periods.length * groupW);
  const svgH = topPad + chartH + bottomPad;

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = topPad + chartH * (1 - f);
      return `<line x1="0" y1="${y}" x2="${svgW}" y2="${y}" stroke="rgba(255,255,255,0.08)" stroke-width="1" />`;
    })
    .join('');

  const barsSvg = periods
    .map((p, pIdx) => {
      const row = dataMap.get(p);
      const gx = leftPad + pIdx * groupW;
      const totalBarsW = series.length * barW + (series.length - 1) * barGap;
      const startX = gx + (groupW - totalBarsW) / 2;

      const bars = series
        .map((s, sIdx) => {
          const v =
            s.id === 'TOTAL'
              ? getMetricVal(row['br-molave']) + getMetricVal(row['br-tambulig']) + getMetricVal(row['br-bonifacio'])
              : getMetricVal(row[s.id]);
          const clamped = Math.max(0, v);
          const h = Math.max(clamped > 0 ? 3 : 0, (clamped / maxVal) * chartH);
          const x = startX + sIdx * (barW + barGap);
          const y = topPad + chartH - h;
          const color = v < 0 ? '#ef4444' : s.color;
          return `
            <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="${color}" opacity="0.92">
              <title>${p} • ${s.name}: ${fmtCurrency(v)}</title>
            </rect>
            ${v !== 0 ? `<text x="${x + barW / 2}" y="${Math.max(12, y - 5)}" fill="#e5e7eb" font-size="9.5" text-anchor="middle">${fmtShort(v)}</text>` : ''}
          `;
        })
        .join('');

      return `
        ${bars}
        <text x="${gx + groupW / 2}" y="${topPad + chartH + 20}" fill="#cbd5e1" font-size="11" font-weight="700" text-anchor="middle">${p}</text>
      `;
    })
    .join('');

  container.innerHTML = `<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="display:block;max-width:none;">${gridLines}${barsSvg}</svg>`;

  // Auto-generated plain-English Chart Analysis right below the graph
  const analysisBox = document.getElementById('salesChartAnalysisBox');
  if (analysisBox) {
    const metricLabels = {
      NET_CASH: 'Net Cash Sales',
      GROSS_CASH: 'Gross Cash Sales (SRP)',
      CASH_GP: 'True Cash Sales Profit',
      CONSOLIDATED_NET: 'Consolidated Net Income',
    };
    const mLabel = metricLabels[metric] || 'Sales';
    const periodTotals = periods.map((p) => {
      const row = dataMap.get(p);
      let tot = 0;
      const byBr = {};
      for (const s of series) {
        const v =
          s.id === 'TOTAL'
            ? getMetricVal(row['br-molave']) + getMetricVal(row['br-tambulig']) + getMetricVal(row['br-bonifacio'])
            : getMetricVal(row[s.id]);
        byBr[s.name] = v;
        tot += v;
      }
      return { period: p, tot, byBr };
    });

    const grandTotal = periodTotals.reduce((a, b) => a + b.tot, 0);
    const avgPerPeriod = grandTotal / Math.max(1, periodTotals.length);
    const bestPeriod = [...periodTotals].sort((a, b) => b.tot - a.tot)[0];
    const latest = periodTotals[periodTotals.length - 1];
    const prev = periodTotals.length >= 2 ? periodTotals[periodTotals.length - 2] : null;
    const isCurrentMonthInProgress = periodMode === 'MONTHLY' && latest?.period === todayStr.slice(0, 7);

    // Branch totals ranking
    const seriesTotals = series
      .map((s) => {
        const sum = periodTotals.reduce((acc, pt) => acc + (pt.byBr[s.name] || 0), 0);
        return { name: s.name, color: s.color, sum, avg: sum / Math.max(1, periodTotals.length) };
      })
      .sort((a, b) => b.sum - a.sum);

    // Negative / dip alerts
    const dips = [];
    for (const pt of periodTotals) {
      for (const [bName, val] of Object.entries(pt.byBr)) {
        if (val < 0) dips.push(`${bName} (${pt.period}: ${fmtCurrency(val)})`);
      }
    }

    let trendHtml = '';
    if (prev && latest) {
      const diff = latest.tot - prev.tot;
      const pct = Math.abs(prev.tot) > 0 ? ((diff / Math.abs(prev.tot)) * 100).toFixed(1) : '0.0';
      const up = diff >= 0;
      trendHtml = `<li><strong>Latest Trend (${latest.period} vs ${prev.period}):</strong> <strong style="color:${up ? 'var(--green)' : '#f59e0b'};">${up ? '▲' : '▼'} ${up ? '+' : ''}${fmtCurrency(diff)} (${up ? '+' : ''}${pct}%)</strong> — ${latest.period} is at <strong>${fmtCurrency(latest.tot)}</strong>${isCurrentMonthInProgress ? ' <span class="muted">(month still in progress)</span>' : ''}.</li>`;
    }

    const rankingHtml = seriesTotals
      .map((s) => {
        const share = grandTotal > 0 ? ` (${((s.sum / grandTotal) * 100).toFixed(1)}% share)` : '';
        return `<strong style="color:${s.color};">${s.name}</strong>: ${fmtCurrency(s.sum)}${share} <span class="muted">[avg ${fmtCurrency(s.avg)}/${periodMode === 'YEARLY' ? 'yr' : 'mo'}]</span>`;
      })
      .join(' &nbsp;•&nbsp; ');

    const dipHtml = dips.length
      ? `<li><strong style="color:#f59e0b;">Watchlist (${dips.length} negative ${periodMode === 'YEARLY' ? 'year' : 'month'}s):</strong> ${dips.slice(-4).join(', ')}${dips.length > 4 ? ` (+${dips.length - 4} more)` : ''} — review operating expenses or low-margin sales in those periods.</li>`
      : `<li><strong style="color:var(--green);">Healthy Consistency:</strong> No negative ${periodMode === 'YEARLY' ? 'years' : 'months'} detected across the shown ${mLabel.toLowerCase()} periods.</li>`;

    analysisBox.innerHTML = `
      <div style="font-weight:800;color:var(--gold-bright);margin-bottom:6px;letter-spacing:0.4px;">QUICK GRAPH ANALYSIS — ${mLabel.toUpperCase()} (${periodMode})</div>
      <ul style="margin:0 0 0 18px;padding:0;display:flex;flex-direction:column;gap:4px;">
        <li><strong>Peak Performance:</strong> <strong>${bestPeriod.period}</strong> was the strongest ${periodMode === 'YEARLY' ? 'year' : 'month'} at <strong style="color:var(--green);">${fmtCurrency(bestPeriod.tot)}</strong> (overall average: <strong>${fmtCurrency(avgPerPeriod)}</strong> per ${periodMode === 'YEARLY' ? 'year' : 'month'}).</li>
        ${trendHtml}
        <li><strong>Branch Ranking (${periods.length} ${periodMode === 'YEARLY' ? 'year' : 'month'}s):</strong> ${rankingHtml}</li>
        ${dipHtml}
      </ul>
    `;
  }
}

document.getElementById('salesChartPeriod')?.addEventListener('change', renderSalesChartsTool);
document.getElementById('salesChartMetric')?.addEventListener('change', renderSalesChartsTool);
document.getElementById('salesChartBranch')?.addEventListener('change', renderSalesChartsTool);

function setSalesMonthRange(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym)) return;
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const s = `${ym}-01`;
  const eDate = `${ym}-${String(lastDay).padStart(2, '0')}`;
  const mEl = document.getElementById('salesMonthInput');
  const startEl = document.getElementById('salesStart');
  const endEl = document.getElementById('salesEnd');
  const fdEl = document.getElementById('salesFromDay');
  const tdEl = document.getElementById('salesToDay');
  const yrBtn = document.getElementById('salesYearBtn');
  if (mEl) mEl.value = ym;
  if (startEl) startEl.value = s;
  if (endEl) endEl.value = eDate;
  if (fdEl) fdEl.value = '1';
  if (tdEl) tdEl.value = String(Number(eDate.slice(8, 10)));
  if (yrBtn) {
    yrBtn.dataset.year = String(y);
    yrBtn.textContent = String(y);
  }
  loadSalesSummary(false);
}

function setSalesYearRange(yearNum) {
  const y = Math.max(2020, Math.min(2099, Number(yearNum) || Number(todayStr.slice(0, 4))));
  const startEl = document.getElementById('salesStart');
  const endEl = document.getElementById('salesEnd');
  const yrBtn = document.getElementById('salesYearBtn');
  if (startEl) startEl.value = `${y}-01-01`;
  if (endEl) endEl.value = String(y) === todayStr.slice(0, 4) ? todayStr : `${y}-12-31`;
  if (yrBtn) {
    yrBtn.dataset.year = String(y);
    yrBtn.textContent = String(y);
  }
  loadSalesSummary(false);
}

document.getElementById('salesPrevMonthBtn')?.addEventListener('click', () => {
  const cur = document.getElementById('salesMonthInput')?.value || todayStr.slice(0, 7);
  const [y, m] = cur.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  setSalesMonthRange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
});
document.getElementById('salesNextMonthBtn')?.addEventListener('click', () => {
  const cur = document.getElementById('salesMonthInput')?.value || todayStr.slice(0, 7);
  const [y, m] = cur.split('-').map(Number);
  const d = new Date(y, m, 1);
  setSalesMonthRange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
});
document.getElementById('salesPrevYearBtn')?.addEventListener('click', () => {
  const y = Number(document.getElementById('salesYearBtn')?.dataset.year || todayStr.slice(0, 4));
  setSalesYearRange(y - 1);
});
document.getElementById('salesNextYearBtn')?.addEventListener('click', () => {
  const y = Number(document.getElementById('salesYearBtn')?.dataset.year || todayStr.slice(0, 4));
  setSalesYearRange(y + 1);
});
document.getElementById('salesYearBtn')?.addEventListener('click', () => {
  const y = Number(document.getElementById('salesYearBtn')?.dataset.year || todayStr.slice(0, 4));
  setSalesYearRange(y);
});

function renderSalesRebatesTool() {
  const sd = state.salesData;
  const tbody = document.querySelector('#salesRebatesTable tbody');
  const kpiGrid = document.getElementById('rebatesKpiGrid');
  const banner = document.getElementById('rebatesInsightBanner');
  if (!sd || !tbody) return;

  const detectMode = document.getElementById('rebatesDetectionMode')?.value || 'DETECTED';
  const groupMode = document.getElementById('rebatesGroupMode')?.value || 'MONTHLY';
  const branchFilter = document.getElementById('rebatesBranchFilter')?.value || 'ALL';
  const periodHdr = document.getElementById('rebatesPeriodHdr');
  if (periodHdr) periodHdr.textContent = groupMode === 'ANNUAL' ? 'Year' : 'Month';

  const bNames = { 'br-molave': 'Molave', 'br-tambulig': 'Tambulig', 'br-bonifacio': 'Bonifacio' };
  const branchIds = branchFilter === 'ALL' ? ['br-molave', 'br-tambulig', 'br-bonifacio'] : [branchFilter];

  const keyOf = (dStr) => {
    const s = String(dStr || '');
    return groupMode === 'ANNUAL' ? s.slice(0, 4) : s.slice(0, 7);
  };
  const validKey = (k) => (groupMode === 'ANNUAL' ? /^\d{4}$/.test(k) : /^\d{4}-\d{2}$/.test(k));

  const scopedPayments = (sd.histFinance?.recentPayments || []).filter((p) => branchIds.includes(p.branch_id));
  const rebAnalysis = analyzePaymentRebates(scopedPayments, detectMode);

  const map = new Map();
  const ensure = (period, bid) => {
    const k = `${period}::${bid}`;
    if (!map.has(k)) {
      map.set(k, {
        period,
        branchId: bid,
        branchName: bNames[bid] || bid,
        eventCount: 0,
        lateCount: 0,
        rebatedCount: 0,
        interest: 0,
        penalties: 0,
        explicitRebates: 0,
        rebates: 0,
        ceilingRebates: 0,
        unrecordedPrincipalLoss: 0,
        trueFinIncome: 0,
        expenses: 0,
      });
    }
    return map.get(k);
  };

  for (const ev of rebAnalysis.events) {
    const per = keyOf(ev.payment_date);
    if (!validKey(per)) continue;
    const r = ensure(per, ev.branch_id);
    r.eventCount++;
    if (ev.isLate) r.lateCount++;
    if (ev.isRebated) r.rebatedCount++;
    r.interest += ev.interest;
    r.penalties += ev.penalties;
    r.explicitRebates += ev.explicitRebates;
    r.rebates += ev.activeRebate;
    r.ceilingRebates += ev.ceilingRebate;
    r.unrecordedPrincipalLoss += ev.unrecordedPrincipalLoss;
    r.trueFinIncome += ev.trueFinInc;
  }

  for (const e of sd.histFinance?.recentExpenses || []) {
    if (!branchIds.includes(e.branch_id)) continue;
    const per = keyOf(e.expense_date);
    if (!validKey(per)) continue;
    const k = `${per}::${e.branch_id}`;
    if (map.has(k)) map.get(k).expenses += Number(e.amount) || 0;
  }

  const rows = [...map.values()].sort((a, b) => b.period.localeCompare(a.period) || a.branchName.localeCompare(b.branchName));

  let tEvents = 0, tLate = 0, tRebCnt = 0, tPen = 0, tReb = 0, tCeilReb = 0, tExpReb = 0, tPrinLoss = 0, tTrueFin = 0, tExp = 0;
  for (const r of rows) {
    tEvents += r.eventCount;
    tLate += r.lateCount;
    tRebCnt += r.rebatedCount;
    tPen += r.penalties;
    tReb += r.rebates;
    tCeilReb += r.ceilingRebates;
    tExpReb += r.explicitRebates;
    tPrinLoss += r.unrecordedPrincipalLoss;
    tTrueFin += r.trueFinIncome;
    tExp += r.expenses;
  }
  const tNet = tPen - tReb;
  const tOffsetPct = tExp > 0 ? (tNet / tExp) * 100 : 0;
  const tLatePct = tEvents > 0 ? (tLate / tEvents) * 100 : 0;
  const tRebPct = tEvents > 0 ? (tRebCnt / tEvents) * 100 : 0;
  const modeLabel = detectMode === 'CEILING' ? 'Ceiling 2.5%' : detectMode === 'RECORDED' ? 'AB Web Raw' : 'Detected 2.5%';

  if (kpiGrid) {
    kpiGrid.innerHTML = `
      <div class="summary-box">
        PENALTIES COLLECTED (+INCOME)
        <strong style="color:var(--green);">${fmtCurrency(tPen)}</strong>
        <span class="summary-note">${fmtNum(tLate)} late events (${tLatePct.toFixed(1)}% of ${fmtNum(tEvents)})</span>
      </div>
      <div class="summary-box">
        EARLY-PAY REBATES (${modeLabel.toUpperCase()})
        <strong style="color:#f59e0b;">${fmtCurrency(-tReb)}</strong>
        <span class="summary-note">${fmtNum(tRebCnt)} rebated (${tRebPct.toFixed(1)}%) • Ceiling: ${fmtCurrency(tCeilReb)} • AB Web logged: ${fmtCurrency(tExpReb)}</span>
      </div>
      <div class="summary-box" style="border-color:#f59e0b;">
        HIDDEN PROFIT OVERSTATEMENT (~67% PRIN.)
        <strong style="color:${tPrinLoss > 0 ? '#f59e0b' : 'var(--muted)'};">${fmtCurrency(-tPrinLoss)}</strong>
        <span class="summary-note">Principal share of 2.5% rebates never deducted in AB Web</span>
      </div>
      <div class="summary-box" style="border-color:var(--gold);">
        TRUE NET IMPACT (PENALTIES − REBATES)
        <strong style="color:${tNet >= 0 ? 'var(--green)' : 'var(--danger)'};">${fmtCurrency(tNet)}</strong>
        <span class="summary-note">Offsets ${tOffsetPct.toFixed(1)}% of ${fmtCurrency(tExp)} OpEx • True Fin: ${fmtCurrency(tTrueFin)}</span>
      </div>
    `;
  }

  if (banner) {
    banner.innerHTML = `
      <strong>2.5% Auto-Deducted Rebate Audit (${modeLabel}):</strong>
      AB Web logged <strong>${fmtCurrency(tExpReb)}</strong> in its Rebates column because it auto-deducts 2.5% from the customer's schedule before posting net cash received (<code>97.5%</code> of full monthly amortization).
      Since AB Web pro-rates that lower net cash into Principal (~67%) and Interest (~33%), only ~33% of each rebate reduces AB Web Interest while the remaining <strong>${fmtCurrency(tPrinLoss)}</strong> Principal share is <strong>unrecorded profit overstatement</strong>.
      Overall, late penalties (<strong>+${fmtCurrency(tPen)}</strong>) vs. early-payment rebates (<strong>−${fmtCurrency(tReb)}</strong>) yield a net financing impact of <strong style="color:${tNet >= 0 ? 'var(--green)' : 'var(--danger)'};">${fmtCurrency(tNet)}</strong> (offsetting <strong>${tOffsetPct.toFixed(1)}%</strong> of branch operating expenses).
      <span class="muted">Click any Penalty, Rebate, or Hidden Profit Adj. figure below to inspect every customer payment.</span>
    `;
  }

  const drillCell = (kind, bid, period, label, val, color, bold = false) => {
    const attrs = `class="sales-drill-cell" data-drill-kind="${kind}" data-drill-branch="${bid}" data-drill-period="${period}" data-drill-mode="${detectMode}" data-drill-label="${label.replace(/"/g, '&quot;')}" title="Click to audit customer payments" style="cursor:pointer;text-decoration:underline dotted;${color ? `color:${color};` : ''}"`;
    return `<td ${attrs}>${bold ? `<strong>${fmtCurrency(val)}</strong>` : fmtCurrency(val)}</td>`;
  };

  tbody.innerHTML = rows.length
    ? rows
        .map((r) => {
          const net = r.penalties - r.rebates;
          const latePct = r.eventCount > 0 ? ((r.lateCount / r.eventCount) * 100).toFixed(1) : '0.0';
          const offPct = r.expenses > 0 ? ((net / r.expenses) * 100).toFixed(1) : '0.0';
          return `
            <tr>
              <td><strong>${r.period}</strong></td>
              <td><strong>${r.branchName}</strong></td>
              <td>${fmtNum(r.eventCount)} <span class="small muted">(${r.lateCount} late ${latePct}% • ${r.rebatedCount} rebated)</span></td>
              ${drillCell('penalties', r.branchId, r.period, `Late Payment Penalties (${r.period})`, r.penalties, 'var(--green)', true)}
              ${drillCell('rebates_detected', r.branchId, r.period, `2.5% Early-Payment Rebates (${r.period} • ${modeLabel})`, -r.rebates, '#f59e0b', true)}
              ${drillCell('rebates_detected', r.branchId, r.period, `Hidden Principal Profit Overstatement (${r.period} • ${modeLabel})`, -r.unrecordedPrincipalLoss, '#f59e0b', false)}
              <td style="color:${net >= 0 ? 'var(--green)' : 'var(--danger)'};"><strong>${fmtCurrency(net)}</strong></td>
              <td style="color:var(--danger);">${fmtCurrency(r.expenses)}</td>
              <td><strong>${offPct}%</strong></td>
              <td style="color:var(--gold-bright);"><strong>${fmtCurrency(r.trueFinIncome)}</strong></td>
            </tr>`;
        })
        .join('') +
      `<tr style="background:rgba(255,255,255,0.05);font-weight:700;">
        <td colspan="2">TOTAL</td>
        <td>${fmtNum(tEvents)} (${tLate} late ${tLatePct.toFixed(1)}% • ${tRebCnt} rebated)</td>
        ${drillCell('penalties', branchFilter, 'ALL', `All Late Payment Penalties`, tPen, 'var(--green)', true)}
        ${drillCell('rebates_detected', branchFilter, 'ALL', `All 2.5% Early-Payment Rebates (${modeLabel})`, -tReb, '#f59e0b', true)}
        ${drillCell('rebates_detected', branchFilter, 'ALL', `Total Hidden Profit Overstatement (${modeLabel})`, -tPrinLoss, '#f59e0b', true)}
        <td style="color:${tNet >= 0 ? 'var(--green)' : 'var(--danger)'};">${fmtCurrency(tNet)}</td>
        <td style="color:var(--danger);">${fmtCurrency(tExp)}</td>
        <td>${tOffsetPct.toFixed(1)}%</td>
        <td style="color:var(--gold-bright);">${fmtCurrency(tTrueFin)}</td>
      </tr>`
    : '<tr><td colspan="10" class="muted">No synced payment records found for this filter.</td></tr>';
}

document.getElementById('rebatesDetectionMode')?.addEventListener('change', renderSalesRebatesTool);
document.getElementById('rebatesGroupMode')?.addEventListener('change', renderSalesRebatesTool);
document.getElementById('rebatesBranchFilter')?.addEventListener('change', renderSalesRebatesTool);

document.querySelectorAll('.sales-tool-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.salestool;
    document.querySelectorAll('.sales-tool-btn').forEach((b) => {
      const isAct = b.dataset.salestool === target;
      b.classList.toggle('active', isAct);
      b.classList.toggle('secondary', !isAct);
    });
    ['consolidated', 'summary', 'rebates', 'charts'].forEach((t) => {
      document.getElementById(`salesTool-${t}`)?.classList.toggle('hidden', t !== target);
    });
    if (target === 'charts') renderSalesChartsTool();
    if (target === 'rebates') renderSalesRebatesTool();
  });
});

function updateConsolidatedViewMode(changedEl) {
  const cashChk = document.getElementById('consShowCashChk');
  const instChk = document.getElementById('consShowInstChk');
  if (!cashChk || !instChk) return;
  if (!cashChk.checked && !instChk.checked) {
    if (changedEl === cashChk) instChk.checked = true;
    else cashChk.checked = true;
  }
  const showCash = cashChk.checked;
  const showInst = instChk.checked;
  const both = showCash && showInst;
  document.getElementById('salesConsolidatedBody')?.classList.toggle('hidden', !both);
  document.getElementById('salesTool-cashpnl')?.classList.toggle('hidden', !(showCash && !showInst));
  document.getElementById('salesTool-installment')?.classList.toggle('hidden', !(!showCash && showInst));
  const hint = document.getElementById('consModeHint');
  if (hint) {
    hint.textContent = both
      ? 'Showing Consolidated P&L (Cash + Installment)'
      : showCash
        ? 'Showing Cash Sales P&L only'
        : 'Showing Installment (Accrual) P&L only';
  }
}

document.getElementById('consShowCashChk')?.addEventListener('change', (e) => updateConsolidatedViewMode(e.target));
document.getElementById('consShowInstChk')?.addEventListener('change', (e) => updateConsolidatedViewMode(e.target));
document.getElementById('consInfoToggleBtn')?.addEventListener('click', () => {
  const btn = document.getElementById('consInfoToggleBtn');
  if (!btn) return;
  const open = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.style.borderColor = open ? 'var(--gold-bright)' : '';
  btn.style.background = open ? 'rgba(231, 197, 95, 0.22)' : '';
  ['consModeHint', 'cashPnlAuditBanner', 'installmentAccrualGuide', 'consolidatedPnlBanner'].forEach((id) => {
    document.getElementById(id)?.classList.toggle('hidden', !open);
  });
});
document.getElementById('salesDailyToggle')?.addEventListener('click', () => {
  const body = document.getElementById('salesDailyBody');
  const caret = document.getElementById('salesDailyCaret');
  if (!body) return;
  const hidden = body.classList.toggle('hidden');
  if (caret) caret.textContent = hidden ? '+' : '−';
});

document.getElementById('salesMonthlyToggle')?.addEventListener('click', () => {
  const body = document.getElementById('salesMonthlyBody');
  const caret = document.getElementById('salesMonthlyCaret');
  if (!body) return;
  const hidden = body.classList.toggle('hidden');
  if (caret) caret.textContent = hidden ? '+' : '−';
});

['salesDailyTable', 'salesMonthlyTable'].forEach((tid) => {
  document.getElementById(tid)?.addEventListener('click', (e) => {
    const cell = e.target.closest('.sales-cash-cell');
    if (!cell) return;
    openSalesDrilldown('cash', cell.dataset.branch || 'ALL', cell.dataset.label || 'Cash Sales', cell.dataset.period || '');
  });
});

document.getElementById('accrualBadDebtPct')?.addEventListener('input', renderSalesInstallmentAccrualTool);

function openSalesDrilldown(kind, branchId, label, periodFilter = '', modeOverride = '') {
  const sd = state.salesData;
  const modal = document.getElementById('salesDrilldownModal');
  if (!sd || !modal) return;
  const bNames = { 'br-bonifacio': 'Bonifacio', 'br-molave': 'Molave', 'br-tambulig': 'Tambulig', ALL: 'All Branches' };
  const branchLabel = bNames[branchId] || branchId;
  const matchBranch = (bid) => branchId === 'ALL' || bid === branchId;

  document.getElementById('salesDrilldownTitle').textContent = `${label} — ${branchLabel}`;
  document.getElementById('salesDrilldownSub').textContent = periodFilter && periodFilter !== 'ALL' ? `Period: ${periodFilter}` : `Period: ${sd.start} → ${sd.end}`;
  const formulaEl = document.getElementById('salesDrilldownFormula');
  const thead = document.querySelector('#salesDrilldownTable thead');
  const tbody = document.querySelector('#salesDrilldownTable tbody');

  if (kind === 'cash') {
    const typeFilter = document.getElementById('salesTypeFilter')?.value || 'ALL';
    const pStr = String(periodFilter || '');
    const exactDate = /^\d{4}-\d{2}-\d{2}$/.test(pStr) ? pStr : '';
    const exactMonth = !exactDate && /^\d{4}-\d{2}$/.test(pStr) ? pStr : '';
    const matchDate = (dt) => {
      if (exactDate) return dt === exactDate;
      if (exactMonth) return dt.startsWith(exactMonth);
      return dt >= sd.start && dt <= sd.end;
    };
    const useExact = typeFilter === 'ALL' && (sd.transactions || []).length > 0;
    const renderChunked = (items, colSpan, mapRowFn, totalRowHtml) => {
      const CHUNK = 120;
      let shown = Math.min(CHUNK, items.length);
      const draw = () => {
        const rowsHtml = items.length ? items.slice(0, shown).map(mapRowFn).join('') : `<tr><td colspan="${colSpan}" class="muted">No cash sales recorded in this period.</td></tr>`;
        const moreRow =
          shown < items.length
            ? `<tr id="drillMoreRow"><td colspan="${colSpan}" style="text-align:center;padding:8px;"><button type="button" class="secondary" id="drillShowMoreBtn" style="padding:5px 10px;font-size:11px;min-height:30px;">Load ${Math.min(CHUNK, items.length - shown)} more (${shown} / ${items.length})</button> <button type="button" class="secondary" id="drillShowAllBtn" style="padding:5px 10px;font-size:11px;min-height:30px;">Show All (${items.length})</button></td></tr>`
            : '';
        tbody.innerHTML = rowsHtml + moreRow + totalRowHtml;
        document.getElementById('drillShowMoreBtn')?.addEventListener('click', () => {
          shown = Math.min(items.length, shown + CHUNK);
          draw();
        });
        document.getElementById('drillShowAllBtn')?.addEventListener('click', () => {
          shown = items.length;
          draw();
        });
      };
      draw();
    };
    if (useExact) {
      const txs = (sd.transactions || []).filter((t) => {
        const dt = String(t.tx_date || '').slice(0, 10);
        return matchDate(dt) && matchBranch(t.branch_id);
      });
      let sSrp = 0, sDisc = 0, sNet = 0, sCost = 0, sProf = 0;
      for (const t of txs) {
        const net = Number(t.amount) || 0;
        const disc = Number(t.discount) || 0;
        const srp = Number(t.srp) || net + disc;
        const cost = Number(t.unit_cost) || 0;
        const prof = cost > 0 ? net - cost : 0;
        sSrp += srp; sDisc += disc; sNet += net; sCost += cost; sProf += prof;
      }
      thead.innerHTML = '<tr><th>Date</th><th>Order #</th><th>Branch</th><th>Gross SRP</th><th>Discount</th><th>Net Amount</th><th>FIFO Cost</th><th>Profit</th></tr>';
      const totHtml = `<tr style="background:rgba(255,255,255,0.05);font-weight:700;"><td colspan="3">TOTAL (${txs.length} tx)</td><td>${fmtCurrency(sSrp)}</td><td>${fmtCurrency(sDisc)}</td><td>${fmtCurrency(sNet)}</td><td>${fmtCurrency(sCost)}</td><td style="color:var(--green);">${fmtCurrency(sProf)}</td></tr>`;
      renderChunked(
        txs,
        8,
        (t) => {
          const net = Number(t.amount) || 0;
          const disc = Number(t.discount) || 0;
          const srp = Number(t.srp) || net + disc;
          const cost = Number(t.unit_cost) || 0;
          const prof = cost > 0 ? net - cost : 0;
          return `<tr><td>${t.tx_date}</td><td><strong>${t.order_no}</strong></td><td>${bNames[t.branch_id] || t.branch_id}</td><td>${fmtCurrency(srp)}</td><td>${fmtCurrency(disc)}</td><td><strong>${fmtCurrency(net)}</strong></td><td>${fmtCurrency(cost)}</td><td style="color:${prof >= 0 ? 'var(--green)' : 'var(--danger)'};"><strong>${fmtCurrency(prof)}</strong></td></tr>`;
        },
        totHtml
      );
      formulaEl.innerHTML = `<strong>Formula:</strong> Net Cash Sales (<code>${fmtCurrency(sNet)}</code>) = Gross SRP (<code>${fmtCurrency(sSrp)}</code>) − Discount (<code>${fmtCurrency(sDisc)}</code>). True Cash Profit = Net − FIFO Cost = <strong>${fmtCurrency(sProf)}</strong>.`;
    } else {
      const moves = (sd.allMovements || []).filter((m) => {
        if (!(Number(m.delta_qty) < 0)) return false;
        const mt = String(m.movement_type || '').toUpperCase();
        if (!mt.includes('SALE') || mt.includes('INSTALLMENT')) return false;
        if (typeFilter !== 'ALL' && (m.product_type || 'Cellphones') !== typeFilter) return false;
        const dt = String(m.recorded_at || '').slice(0, 10);
        return matchDate(dt) && matchBranch(m.branch_id);
      });
      let sQty = 0, sSrp = 0, sDisc = 0, sNet = 0;
      for (const m of moves) {
        const qty = Math.abs(Number(m.delta_qty) || 0);
        const { net, gross, disc } = getCashSaleAmount(m);
        sQty += qty; sSrp += gross; sDisc += disc; sNet += net;
      }
      thead.innerHTML = '<tr><th>Date</th><th>Model</th><th>Branch</th><th>Qty</th><th>Gross SRP</th><th>Cash Disc.</th><th>Net Sales</th></tr>';
      const totHtml = `<tr style="background:rgba(255,255,255,0.05);font-weight:700;"><td colspan="3">TOTAL (${fmtNum(sQty)} units)</td><td>${fmtNum(sQty)}</td><td>${fmtCurrency(sSrp)}</td><td>${fmtCurrency(sDisc)}</td><td style="color:var(--green);">${fmtCurrency(sNet)}</td></tr>`;
      renderChunked(
        moves,
        7,
        (m) => {
          const dt = String(m.recorded_at || '').slice(0, 10);
          const qty = Math.abs(Number(m.delta_qty) || 0);
          const { net, gross, disc } = getCashSaleAmount(m);
          return `<tr><td>${dt}</td><td><strong>${m.model || m.product_name || ''}</strong></td><td>${bNames[m.branch_id] || m.branch_id}</td><td>${fmtNum(qty)}</td><td>${fmtCurrency(gross)}</td><td>${fmtCurrency(disc)}</td><td><strong>${fmtCurrency(net)}</strong></td></tr>`;
        },
        totHtml
      );
      formulaEl.innerHTML = `<strong>Formula (${typeFilter}):</strong> Net Cash Sales (<code>${fmtCurrency(sNet)}</code>) = Gross SRP (<code>${fmtCurrency(sSrp)}</code>) − Cash Discount (<code>${fmtCurrency(sDisc)}</code>).`;
    }
  } else if (kind === 'installment') {
    const rawBd = document.getElementById('accrualBadDebtPct')?.value;
  const badDebtPct = Math.max(0, Math.min(30, rawBd === '' || rawBd == null ? 5 : Number(rawBd))) / 100;
    const rows = (sd.receivables?.installments || []).filter((i) => {
      const dt = String(i.sale_date || '').slice(0, 10);
      return dt >= sd.start && dt <= sd.end && matchBranch(i.branch_id);
    });
    let sDp = 0, sPrin = 0, sSrp = 0, sCost = 0, sGp = 0, sBd = 0;
    thead.innerHTML = '<tr><th>Date</th><th>Branch</th><th>Unit</th><th>Deposit</th><th>Principal</th><th>Cash-Equiv SRP</th><th>Unit Cost</th><th>Merch GP</th></tr>';
    tbody.innerHTML =
      (rows.length
        ? rows
            .map((i) => {
              const dp = Number(i.deposit) || 0;
              const prin = Number(i.principal_amount) || 0;
              const srp = dp + prin > 0 ? dp + prin : Number(i.amount) || 0;
              const matched = estimateProductCostByName(i.unit);
              const cost = matched > 0 ? matched : srp * 0.85;
              const gp = Math.max(0, srp - cost);
              sDp += dp; sPrin += prin; sSrp += srp; sCost += cost; sGp += gp; sBd += prin * badDebtPct;
              return `<tr><td>${i.sale_date}</td><td>${bNames[i.branch_id] || i.branch_name || ''}</td><td><strong>${i.unit}</strong>${matched > 0 ? '' : ' <span class="small muted">(85% est)</span>'}</td><td>${fmtCurrency(dp)}</td><td>${fmtCurrency(prin)}</td><td>${fmtCurrency(srp)}</td><td>${fmtCurrency(cost)}</td><td style="color:var(--green);"><strong>${fmtCurrency(gp)}</strong></td></tr>`;
            })
            .join('')
        : '<tr><td colspan="8" class="muted">No new installment contracts in this period.</td></tr>') +
      `<tr style="background:rgba(255,255,255,0.05);font-weight:700;"><td colspan="3">TOTAL (${rows.length} contracts)</td><td>${fmtCurrency(sDp)}</td><td>${fmtCurrency(sPrin)}</td><td>${fmtCurrency(sSrp)}</td><td>${fmtCurrency(sCost)}</td><td style="color:var(--green);">${fmtCurrency(sGp)}</td></tr>`;
    formulaEl.innerHTML = `<strong>Formula:</strong> Merchandising GP = Cash-Equiv SRP (<code>${fmtCurrency(sSrp)}</code>) − Unit Cost (<code>${fmtCurrency(sCost)}</code>) = <strong>${fmtCurrency(sGp)}</strong>. Prospective Monthly Bad Debt (${(badDebtPct * 100).toFixed(1)}% of Principal <code>${fmtCurrency(sPrin)}</code>) = <strong>${fmtCurrency(sBd)}</strong>.`;
  } else if (kind === 'accrued_interest') {
    const d1 = new Date(`${sd.start}T00:00:00Z`);
    const d2 = new Date(`${sd.end}T00:00:00Z`);
    const periodMonths = Math.max(0.1, (Math.max(1, Math.round((d2 - d1) / 86400000) + 1)) / 30);
    const active = (sd.receivables?.installments || []).filter((i) => {
      const dt = String(i.sale_date || '').slice(0, 10);
      if (dt > sd.end || !matchBranch(i.branch_id)) return false;
      const term = Math.max(1, Number(i.term) || 6);
      const elapsed = (d2 - new Date(`${dt}T00:00:00Z`)) / (86400000 * 30);
      return elapsed >= 0 && elapsed <= term + 0.5;
    });
    let sFc = 0, sAcc = 0;
    thead.innerHTML = '<tr><th>Sale Date</th><th>Branch</th><th>Unit</th><th>Principal</th><th>Monthly × Term</th><th>Total Finance Chg</th><th>Period Accrued Int.</th></tr>';
    tbody.innerHTML =
      (active.length
        ? active
            .map((i) => {
              const term = Math.max(1, Number(i.term) || 6);
              const mo = Number(i.monthly) || 0;
              const prin = Number(i.principal_amount) || 0;
              const fc = Math.max(0, mo * term - prin);
              const acc = (fc / term) * Math.min(periodMonths, 1);
              sFc += fc; sAcc += acc;
              return `<tr><td>${i.sale_date}</td><td>${bNames[i.branch_id] || i.branch_name || ''}</td><td><strong>${i.unit}</strong></td><td>${fmtCurrency(prin)}</td><td>${fmtCurrency(mo)} × ${term}m</td><td>${fmtCurrency(fc)}</td><td style="color:var(--green);"><strong>${fmtCurrency(acc)}</strong></td></tr>`;
            })
            .join('')
        : '<tr><td colspan="7" class="muted">No active installment contracts accruing interest in this period.</td></tr>') +
      `<tr style="background:rgba(255,255,255,0.05);font-weight:700;"><td colspan="5">TOTAL (${active.length} active contracts)</td><td>${fmtCurrency(sFc)}</td><td style="color:var(--green);">${fmtCurrency(sAcc)}</td></tr>`;
    formulaEl.innerHTML = `<strong>Accrual Formula:</strong> Monthly Interest = <code>((Monthly × Term) − Principal) ÷ Term</code> × Period Factor (${Math.min(periodMonths, 1).toFixed(2)} mo) = <strong>${fmtCurrency(sAcc)}</strong>.`;
  } else if (kind === 'expenses') {
    const exps = (sd.finance?.recentExpenses || []).filter((e) => matchBranch(e.branch_id));
    let sAmt = 0;
    thead.innerHTML = '<tr><th>Date</th><th>Branch</th><th>Expense Type</th><th>Particular</th><th>Amount</th></tr>';
    tbody.innerHTML =
      (exps.length
        ? exps
            .map((e) => {
              const a = Number(e.amount) || 0;
              sAmt += a;
              return `<tr><td>${e.expense_date}</td><td>${e.branch_name || bNames[e.branch_id] || ''}</td><td>${e.expense_type}</td><td>${e.particular || ''}</td><td style="color:var(--danger);"><strong>${fmtCurrency(a)}</strong></td></tr>`;
            })
            .join('')
        : '<tr><td colspan="5" class="muted">No expenses synced in this date range.</td></tr>') +
      `<tr style="background:rgba(255,255,255,0.05);font-weight:700;"><td colspan="4">TOTAL (${exps.length} entries)</td><td style="color:var(--danger);">${fmtCurrency(sAmt)}</td></tr>`;
    formulaEl.innerHTML = `<strong>Formula:</strong> Sum of branch operating expenses synced from AB Web for ${sd.start} → ${sd.end} = <strong>${fmtCurrency(sAmt)}</strong> (deducted once in Consolidated P&L).`;
  } else if (kind === 'opening_allowance') {
    const pds = (sd.receivables?.pastDues || []).filter((pd) => matchBranch(pd.branch_id));
    let sBal = 0, sAllow = 0;
    thead.innerHTML = '<tr><th>Branch</th><th>Customer / Account</th><th>Unit</th><th>Days Due</th><th>Balance</th><th>Tier Rate</th><th>Allowance</th></tr>';
    tbody.innerHTML =
      (pds.length
        ? pds
            .map((pd) => {
              const bal = Number(pd.balance) || 0;
              const days = getEffectiveDaysDue(pd);
              const tier = getAgingTier(days);
              const allow = bal * tier.rate;
              sBal += bal; sAllow += allow;
              return `<tr><td>${bNames[pd.branch_id] || pd.branch_name || ''}</td><td><strong>${pd.customer_name}</strong><div class="small muted">${pd.account_no}</div></td><td>${pd.unit}</td><td>${days}d</td><td>${fmtCurrency(bal)}</td><td>${Math.round(tier.rate * 100)}%</td><td style="color:#f59e0b;"><strong>${fmtCurrency(allow)}</strong></td></tr>`;
            })
            .join('')
        : '<tr><td colspan="7" class="muted">No past-due accounts found.</td></tr>') +
      `<tr style="background:rgba(255,255,255,0.05);font-weight:700;"><td colspan="4">TOTAL (${pds.length} past-due accounts)</td><td>${fmtCurrency(sBal)}</td><td>—</td><td style="color:#f59e0b;">${fmtCurrency(sAllow)}</td></tr>`;
    formulaEl.innerHTML = `<strong>5-Tier Risk Matrix:</strong> 1–30d (5%), 31–60d (20%), 61–90d (50%), 91–180d (80% Repo), 180+d (95% Write-Off). Total Opening Allowance = <strong>${fmtCurrency(sAllow)}</strong>.`;
  } else if (kind === 'rebates_detected') {
    const mode = modeOverride || 'DETECTED';
    const rawPays = periodFilter
      ? (sd.histFinance?.recentPayments || []).filter((p) => matchBranch(p.branch_id) && (periodFilter === 'ALL' || String(p.payment_date || '').startsWith(periodFilter)))
      : (sd.finance?.recentPayments || []).filter((p) => matchBranch(p.branch_id));
    const ra = analyzePaymentRebates(rawPays, mode);
    const rebEvents = ra.events.filter((ev) => ev.isRebated && ev.activeRebate > 0);
    let sCash = 0, sFull = 0, sReb = 0, sIntCut = 0, sPrinLoss = 0;
    thead.innerHTML = '<tr><th>Date</th><th>Branch</th><th>Customer / Account</th><th>Cash Paid (97.5%)</th><th>Est. Full Amort (100%)</th><th>2.5% Rebate</th><th>Cut from Int (~33%)</th><th>Hidden Prin. Loss (~67%)</th></tr>';
    tbody.innerHTML =
      (rebEvents.length
        ? rebEvents
            .map((ev) => {
              sCash += ev.activeBaseAmt;
              sFull += ev.fullAmortCleared;
              sReb += ev.activeRebate;
              sIntCut += ev.alreadyCutFromInt;
              sPrinLoss += ev.unrecordedPrincipalLoss;
              return `<tr><td>${ev.payment_date}</td><td>${ev.branch_name || bNames[ev.branch_id] || ''}</td><td><strong>${ev.customer_name}</strong><div class="small muted">${ev.account_no}</div></td><td>${fmtCurrency(ev.activeBaseAmt)}</td><td>${fmtCurrency(ev.fullAmortCleared)}</td><td style="color:#f59e0b;"><strong>${fmtCurrency(-ev.activeRebate)}</strong></td><td class="muted">${fmtCurrency(-ev.alreadyCutFromInt)}</td><td style="color:#f59e0b;"><strong>${fmtCurrency(-ev.unrecordedPrincipalLoss)}</strong></td></tr>`;
            })
            .join('')
        : '<tr><td colspan="8" class="muted">No rebated payment events matched under this mode.</td></tr>') +
      `<tr style="background:rgba(255,255,255,0.05);font-weight:700;"><td colspan="3">TOTAL (${rebEvents.length} early-rebated events)</td><td>${fmtCurrency(sCash)}</td><td>${fmtCurrency(sFull)}</td><td style="color:#f59e0b;">${fmtCurrency(-sReb)}</td><td class="muted">${fmtCurrency(-sIntCut)}</td><td style="color:#f59e0b;">${fmtCurrency(-sPrinLoss)}</td></tr>`;
    formulaEl.innerHTML = `<strong>Formula (${mode}):</strong> Net Cash = <code>97.5% × Full Amort</code> → 2.5% Rebate = <code>Cash Paid × (0.025 ÷ 0.975)</code> = <strong>${fmtCurrency(sReb)}</strong>. AB Web already shaved <strong>${fmtCurrency(sIntCut)}</strong> from Interest (~33%); the remaining <strong>${fmtCurrency(sPrinLoss)}</strong> (~67% Principal share) is hidden profit overstatement.`;
  } else if (kind === 'penalties') {
    const rawPays = periodFilter
      ? (sd.histFinance?.recentPayments || []).filter((p) => matchBranch(p.branch_id) && (periodFilter === 'ALL' || String(p.payment_date || '').startsWith(periodFilter)))
      : (sd.finance?.recentPayments || []).filter((p) => matchBranch(p.branch_id));
    const ra = analyzePaymentRebates(rawPays, 'DETECTED');
    const lateEvents = ra.events.filter((ev) => ev.penalties > 0);
    let sCash = 0, sInt = 0, sPen = 0;
    thead.innerHTML = '<tr><th>Date</th><th>Branch</th><th>Customer / Account</th><th>Payment Collected</th><th>Interest</th><th>Late Penalty (+Income)</th></tr>';
    tbody.innerHTML =
      (lateEvents.length
        ? lateEvents
            .map((ev) => {
              sCash += ev.amount;
              sInt += ev.interest;
              sPen += ev.penalties;
              return `<tr><td>${ev.payment_date}</td><td>${ev.branch_name || bNames[ev.branch_id] || ''}</td><td><strong>${ev.customer_name}</strong><div class="small muted">${ev.account_no}</div></td><td>${fmtCurrency(ev.amount)}</td><td>${fmtCurrency(ev.interest)}</td><td style="color:var(--green);"><strong>+${fmtCurrency(ev.penalties)}</strong></td></tr>`;
            })
            .join('')
        : '<tr><td colspan="6" class="muted">No late payment penalties recorded in this period.</td></tr>') +
      `<tr style="background:rgba(255,255,255,0.05);font-weight:700;"><td colspan="3">TOTAL (${lateEvents.length} late payment events)</td><td>${fmtCurrency(sCash)}</td><td>${fmtCurrency(sInt)}</td><td style="color:var(--green);">+${fmtCurrency(sPen)}</td></tr>`;
    formulaEl.innerHTML = `<strong>Formula:</strong> Late payment penalties collected = <strong>+${fmtCurrency(sPen)}</strong> across ${lateEvents.length} late payment events (no 2.5% early rebate applies to late payments).`;
  } else if (kind === 'cash_interest') {
    const pays = (sd.finance?.recentPayments || []).filter((p) => matchBranch(p.branch_id));
    const ra = analyzePaymentRebates(pays, 'DETECTED');
    let sAmt = 0, sInt = 0, sPen = 0, sPrinLoss = 0, sFin = 0;
    thead.innerHTML = '<tr><th>Date</th><th>Branch</th><th>Customer</th><th>Payment</th><th>AB Web Int.</th><th>Penalties</th><th>Hidden Rebate Adj (~67%)</th><th>True Fin. Inc.</th></tr>';
    tbody.innerHTML =
      (ra.events.length
        ? ra.events
            .map((ev) => {
              sAmt += ev.amount; sInt += ev.interest; sPen += ev.penalties; sPrinLoss += ev.unrecordedPrincipalLoss; sFin += ev.trueFinInc;
              return `<tr><td>${ev.payment_date}</td><td>${ev.branch_name || bNames[ev.branch_id] || ''}</td><td><strong>${ev.customer_name}</strong></td><td>${fmtCurrency(ev.amount)}</td><td>${fmtCurrency(ev.interest)}</td><td style="color:var(--green);">${fmtCurrency(ev.penalties)}</td><td style="color:#f59e0b;">${ev.unrecordedPrincipalLoss > 0 ? fmtCurrency(-ev.unrecordedPrincipalLoss) : '₱0.00'}</td><td style="color:var(--green);"><strong>${fmtCurrency(ev.trueFinInc)}</strong></td></tr>`;
            })
            .join('')
        : '<tr><td colspan="8" class="muted">No payments synced in this period.</td></tr>') +
      `<tr style="background:rgba(255,255,255,0.05);font-weight:700;"><td colspan="3">TOTAL (${ra.events.length} payment events)</td><td>${fmtCurrency(sAmt)}</td><td>${fmtCurrency(sInt)}</td><td style="color:var(--green);">${fmtCurrency(sPen)}</td><td style="color:#f59e0b;">${fmtCurrency(-sPrinLoss)}</td><td style="color:var(--green);">${fmtCurrency(sFin)}</td></tr>`;
    formulaEl.innerHTML = `<strong>Formula:</strong> True Cash-Basis Financing Income = AB Web Interest (<code>${fmtCurrency(sInt)}</code>) + Penalties (<code>${fmtCurrency(sPen)}</code>) − Hidden 2.5% Rebate Principal Loss (<code>${fmtCurrency(sPrinLoss)}</code>) = <strong>${fmtCurrency(sFin)}</strong>.`;
  }

  modal.classList.remove('hidden');
}

function openReceivablesAllowanceModal(bucketKey = 'ALL', branchFilter = 'ALL') {
  const rec = state.receivables || state.salesData?.receivables;
  const modal = document.getElementById('salesDrilldownModal');
  if (!rec || !modal) return;
  const bNames = { ALL: 'All Branches', 'br-bonifacio': 'Bonifacio', 'br-molave': 'Molave', 'br-tambulig': 'Tambulig' };
  const bucketLabels = {
    ALL: 'All Past-Due Buckets',
    '1-30': '1–30 Days (5% • Remind)',
    '31-60': '31–60 Days (20% • CI Visit)',
    '61-90': '61–90 Days (50% • Final Demand)',
    '91-180': '91–180 Days (80% • Repo Priority)',
    '180+': '180+ Days (95% • Write-Off / Legal)',
  };
  const activeBranch = branchFilter || 'ALL';

  const allPds = rec.pastDues || [];
  const filtered = allPds
    .filter((pd) => {
      if (activeBranch !== 'ALL' && pd.branch_id !== activeBranch) return false;
      if (bucketKey === 'ALL') return true;
      return getAgingTier(getEffectiveDaysDue(pd)).key === bucketKey;
    })
    .sort((a, b) => getEffectiveDaysDue(b) - getEffectiveDaysDue(a));

  document.getElementById('salesDrilldownTitle').textContent = `Opening Allowance Audit — ${bNames[activeBranch] || activeBranch}`;
  document.getElementById('salesDrilldownSub').textContent = `Bucket: ${bucketLabels[bucketKey] || bucketKey} • ${filtered.length} customer account(s)`;

  const formulaEl = document.getElementById('salesDrilldownFormula');
  const thead = document.querySelector('#salesDrilldownTable thead');
  const tbody = document.querySelector('#salesDrilldownTable tbody');

  let sBal = 0;
  let sAllow = 0;
  const branchBtns = ['ALL', 'br-molave', 'br-tambulig', 'br-bonifacio']
    .map(
      (bid) =>
        `<button type="button" class="${bid === activeBranch ? '' : 'secondary'} rec-modal-br-btn" data-bid="${bid}" style="padding:3px 9px;font-size:11px;min-height:0;">${bNames[bid]}</button>`
    )
    .join(' ');

  thead.innerHTML = '<tr><th>Branch</th><th>Customer &amp; Account #</th><th>Unit</th><th>Days Due</th><th>Unpaid Balance</th><th>Tier Rate</th><th>Required Allowance</th></tr>';
  tbody.innerHTML =
    (filtered.length
      ? filtered
          .map((pd) => {
            const bal = Number(pd.balance) || 0;
            const days = getEffectiveDaysDue(pd);
            const tier = getAgingTier(days);
            const allow = bal * tier.rate;
            sBal += bal;
            sAllow += allow;
            return `<tr><td>${bNames[pd.branch_id] || pd.branch_name || ''}</td><td><strong>${pd.customer_name}</strong><div class="small muted">${pd.account_no}</div></td><td>${pd.unit || ''}</td><td><strong>${days}d</strong></td><td>${fmtCurrency(bal)}</td><td>${Math.round(tier.rate * 100)}%</td><td style="color:#f59e0b;"><strong>${fmtCurrency(allow)}</strong></td></tr>`;
          })
          .join('')
      : '<tr><td colspan="7" class="muted">No past-due customer accounts in this bucket/branch.</td></tr>') +
    `<tr style="background:rgba(255,255,255,0.05);font-weight:700;"><td colspan="4">TOTAL (${filtered.length} customers)</td><td>${fmtCurrency(sBal)}</td><td>—</td><td style="color:var(--gold-bright);">${fmtCurrency(sAllow)}</td></tr>`;

  formulaEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <div><strong>Formula:</strong> <code>Customer Unpaid Balance × Aging Tier Rate</code> → Total Allowance: <strong>${fmtCurrency(sAllow)}</strong> (from <strong>${fmtCurrency(sBal)}</strong> past-due).</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">${branchBtns}</div>
    </div>
  `;
  formulaEl.querySelectorAll('.rec-modal-br-btn').forEach((btn) => {
    btn.addEventListener('click', () => openReceivablesAllowanceModal(bucketKey, btn.dataset.bid));
  });

  modal.classList.remove('hidden');
}

document.getElementById('tab-sales')?.addEventListener('click', (e) => {
  const cell = e.target.closest('.sales-drill-cell');
  if (!cell) return;
  openSalesDrilldown(
    cell.dataset.drillKind,
    cell.dataset.drillBranch,
    cell.dataset.drillLabel,
    cell.dataset.drillPeriod || '',
    cell.dataset.drillMode || ''
  );
});
document.getElementById('closeSalesDrilldownBtn')?.addEventListener('click', () => {
  document.getElementById('salesDrilldownModal')?.classList.add('hidden');
});
document.getElementById('salesDrilldownModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'salesDrilldownModal') e.target.classList.add('hidden');
});

document.getElementById('salesMonthInput')?.addEventListener('change', (e) => {
  const ym = e.target.value;
  if (!/^\d{4}-\d{2}$/.test(ym)) return;
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const s = `${ym}-01`;
  const eDate = `${ym}-${String(lastDay).padStart(2, '0')}`;
  const startEl = document.getElementById('salesStart');
  const endEl = document.getElementById('salesEnd');
  if (startEl) startEl.value = s;
  if (endEl) endEl.value = eDate;
  loadSalesSummary();
});
const syncSalesDaysToRange = () => {
  const ym = document.getElementById('salesMonthInput')?.value || todayStr.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const fdEl = document.getElementById('salesFromDay');
  const tdEl = document.getElementById('salesToDay');
  let d1 = Math.max(1, Math.min(lastDay, parseInt(fdEl?.value || '1', 10) || 1));
  let d2 = Math.max(1, Math.min(lastDay, parseInt(tdEl?.value || String(lastDay), 10) || lastDay));
  if (d1 > d2) d2 = d1;
  if (fdEl) fdEl.value = String(d1);
  if (tdEl) tdEl.value = String(d2);
  document.getElementById('salesStart').value = `${ym}-${String(d1).padStart(2, '0')}`;
  document.getElementById('salesEnd').value = `${ym}-${String(d2).padStart(2, '0')}`;
  loadSalesSummary(false);
};
document.getElementById('salesFromDay')?.addEventListener('change', syncSalesDaysToRange);
document.getElementById('salesToDay')?.addEventListener('change', syncSalesDaysToRange);
document.getElementById('salesApplyBtn')?.addEventListener('click', syncSalesDaysToRange);
document.getElementById('salesRefreshBtn')?.addEventListener('click', () => loadSalesSummary(true));
document.getElementById('salesTypeFilter')?.addEventListener('change', renderSalesSummary);

setInterval(() => {
  if (state.activeTab === 'sales' && state.userRole === 'ADMIN') {
    loadSalesSummary().catch(() => {});
  }
}, 30000);
document.getElementById('refreshFinanceBtn').addEventListener('click', loadFinance);
document.getElementById('finBranchFilter')?.addEventListener('change', loadFinance);
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
      pageBreak: 'auto',
      rowPageBreak: 'avoid',
      didDrawPage: drawHeader,
      styles: {
        font: 'helvetica',
        fontSize,
        cellPadding,
        lineColor: [27, 25, 19],
        lineWidth: 1.15 / 72,
        textColor: [27, 25, 19],
        overflow: 'ellipsize',
        valign: 'middle',
      },
      headStyles: {
        fillColor: [235, 226, 190],
        textColor: [20, 18, 14],
        lineColor: [20, 18, 14],
        lineWidth: 1.4 / 72,
        fontStyle: 'bold',
        halign: 'center',
      },
      columnStyles,
      didParseCell(hookData) {
        if (hookData.section === 'body' && hookData.row.index === bodyRows.length - 1) {
          hookData.cell.styles.fillColor = [233, 228, 211];
          hookData.cell.styles.fontStyle = 'bold';
          hookData.cell.styles.lineWidth = 1.35 / 72;
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
  document.getElementById('cashFlowHeaderActions')?.classList.toggle('hidden', !isAdmin || state.activeTab !== 'cashflow');
  document.getElementById('salesHeaderActions')?.classList.toggle('hidden', !isAdmin || state.activeTab !== 'sales');
  const catEditWrap = document.getElementById('catEditMode')?.closest('label');
  if (catEditWrap) catEditWrap.classList.toggle('hidden', !isAdmin);
  if (!isAdmin && document.getElementById('catEditMode')) {
    document.getElementById('catEditMode').checked = false;
  }
  const showHiddenWrap = document.getElementById('showHiddenToggle')?.closest('label');
  if (showHiddenWrap) showHiddenWrap.classList.toggle('hidden', !isAdmin);

  // Cashier Inventory lockdown: hide Inventory Tools, bulk Cellphones/Accessories switcher, and limit Stock View to Available / Unavailable
  document.querySelector('.inv-tools-wrap')?.classList.toggle('hidden', !isAdmin || state.activeTab !== 'inventory');
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
    } else if (stockViewSel.options.length < 6) {
      stockViewSel.innerHTML = `
        <option value="available">Available phones</option>
        <option value="subject_phaseout">Subject to Phaseout (&lt; 3 mos)</option>
        <option value="phaseout">Phaseout / Do Not Reorder (incl. 0)</option>
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
        ? ['quotas', 'receivables', 'catalogs']
        : ['inventory', 'sales', 'cashflow', 'activity', 'finance', 'receivables', 'quotas', 'catalogs', 'websiteStock', 'staffPins'];

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
    if (!state.ghPollTimer) {
      state.ghPollTimer = setInterval(async () => {
        if (document.hidden) return;
        try {
          const prevTs = ghBundleCache?.syncedAt || '';
          const b = await getGhBundle(true);
          updateSyncPill({
            running: false, paused: false, lastSyncAt: b.syncedAt,
            lastStatus: b.liveSynced ? 'OK' : 'WARN', adapterMode: 'ABGADGETZ_LIVE (GITHUB)',
          });
          if (b?.syncedAt && b.syncedAt !== prevTs) {
            state.salesFullCache = null;
            await refreshActiveTab();
          }
        } catch {}
      }, 60000);
    }
    return;
  }
  if (eventSource) eventSource.close();
  eventSource = new EventSource('/api/events');
  eventSource.addEventListener('status', (e) => updateSyncPill(JSON.parse(e.data)));
  eventSource.addEventListener('sync', async (e) => {
    const payload = JSON.parse(e.data);
    updateSyncPill(payload);
    state.salesFullCache = null;
    if (payload.deliveriesUpdated > 0 || payload.ordersUpdated > 0) {
      await Promise.all([loadSavedPurchaseOrders(), loadAbDeliveries()]);
      if (state.activeTab === 'inventory' && state.activeInvTool === 'restock') {
        if (payload.updatedCount > 0) await loadInventory();
        const editingOrder = Boolean(document.activeElement?.closest('#savedOrderInlineEditor, #pasteOrderBox'));
        if (!editingOrder) renderSavedOrdersPanel();
        else {
          renderOrderVarianceReport();
          renderAbDeliveriesView();
        }
        if (!document.activeElement?.closest('.reorder-qty-inp')) {
          buildRestockDraftPlan();
          renderRestockCards();
        }
        return;
      }
    }
    if (payload.updatedCount > 0 || ['cashflow', 'sales', 'finance', 'receivables', 'activity', 'websiteStock'].includes(state.activeTab)) {
      await refreshActiveTab();
    }
  });
  eventSource.addEventListener('orders', async () => {
    await Promise.all([loadSavedPurchaseOrders(), loadAbDeliveries()]);
    if (state.activeTab === 'inventory' && state.activeInvTool === 'restock') {
      const editingOrder = Boolean(document.activeElement?.closest('#savedOrderInlineEditor, #pasteOrderBox'));
      if (!editingOrder) renderSavedOrdersPanel();
      else {
        renderOrderVarianceReport();
        renderAbDeliveriesView();
      }
      if (!document.activeElement?.closest('.reorder-qty-inp')) {
        buildRestockDraftPlan();
        renderRestockCards();
      }
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
  await refreshActiveTab();
  applyRolePermissions();
  connectEvents();
  Promise.all([
    state.inventory ? Promise.resolve() : loadInventory().catch(() => {}),
    state.syncState ? Promise.resolve() : loadSyncLogs().catch(() => {}),
  ]);
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

document.getElementById('ghPublishTokenInput')?.addEventListener('change', (e) => {
  const v = String(e.target.value || '').trim();
  if (v) {
    localStorage.setItem('bs_gh_pub_token', v);
    if (IS_STATIC_GH) pushPhoneOrdersToGh().catch(() => {});
  }
});

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
    if (msg) msg.textContent = 'Staff PINs saved locally! Click "☁️ Sync PINs to Online Staff Portal" to sync to https://ab-gadgetz.github.io/staff/.';
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

async function checkAuth(reauthNotice = '') {
  const isStaffPath = window.location.pathname.includes('/staff');
  const status = await api('/api/auth/status');
  if (status.authenticated && (!isStaffPath || status.role !== 'ADMIN')) {
    state.reauthInPlace = false;
    state.userRole = status.role || 'ADMIN';
    state.userBranchId = status.branchId || '';
    await bootApp();
    return;
  }
  const gateEl = document.getElementById('authGate');
  if (!state.reauthInPlace) {
    document.getElementById('appShell').classList.add('hidden');
    if (gateEl) { gateEl.style.position = ''; gateEl.style.top = ''; gateEl.style.left = ''; gateEl.style.transform = ''; gateEl.style.zIndex = ''; gateEl.style.width = ''; gateEl.style.boxShadow = ''; }
  } else if (gateEl) {
    gateEl.style.position = 'fixed';
    gateEl.style.top = '50%';
    gateEl.style.left = '50%';
    gateEl.style.transform = 'translate(-50%, -50%)';
    gateEl.style.zIndex = '9999';
    gateEl.style.width = 'min(92vw, 420px)';
    gateEl.style.boxShadow = '0 24px 70px rgba(0,0,0,0.85)';
  }
  gateEl?.classList.remove('hidden');
  const errEl = document.getElementById('authErrorMsg');
  if (errEl && reauthNotice) errEl.textContent = reauthNotice;
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

let authSubmitting = false;
async function submitAuthPin() {
  if (authSubmitting) return;
  const pinInput = document.getElementById('ownerPinInput');
  const pin = (pinInput?.value || '').trim();
  const role = document.getElementById('loginRoleSelect')?.value || 'ADMIN';
  const branchId = document.getElementById('loginBranchSelect')?.value || 'br-molave';
  const mode = document.getElementById('authGate').dataset.mode || 'login';
  const errEl = document.getElementById('authErrorMsg');
  if (errEl) errEl.textContent = '';
  authSubmitting = true;
  try {
    const res = await api(mode === 'setup' ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ pin, role, branchId }),
    });
    state.userRole = res.role || role || 'ADMIN';
    state.userBranchId = res.branchId || (state.userRole === 'ADMIN' ? '' : branchId);
    if (pinInput) pinInput.value = '';
    if (state.reauthInPlace && state.inventory) {
      state.reauthInPlace = false;
      const gateEl = document.getElementById('authGate');
      if (gateEl) {
        gateEl.classList.add('hidden');
        gateEl.style.position = ''; gateEl.style.top = ''; gateEl.style.left = ''; gateEl.style.transform = ''; gateEl.style.zIndex = ''; gateEl.style.width = ''; gateEl.style.boxShadow = '';
      }
      document.getElementById('appShell').classList.remove('hidden');
      connectEvents();
    } else {
      await bootApp();
    }
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
    if (pinInput) {
      pinInput.value = '';
      pinInput.focus();
    }
  } finally {
    authSubmitting = false;
  }
}

document.getElementById('ownerPinInput')?.addEventListener('input', (e) => {
  const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
  if (e.target.value !== digits) e.target.value = digits;
  if (digits.length === 6) submitAuthPin();
});

document.getElementById('ownerPinInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitAuthPin();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (eventSource) { eventSource.close(); eventSource = null; }
  document.getElementById('mobileBottomNav')?.classList.add('hidden');
  await api('/api/auth/logout', { method: 'POST' });
  await checkAuth();
});

checkAuth();
