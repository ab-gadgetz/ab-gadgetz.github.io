import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import seedSnapshot from '../seedSnapshot.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');
const distDir = path.join(rootDir, 'dist');

const BRANCHES = [
  { id: 'br-molave', slug: 'molave', name: 'Molave', cash_discount_pct: 5, portalId: 23 },
  { id: 'br-tambulig', slug: 'tambulig', name: 'Tambulig', cash_discount_pct: 5, portalId: 32 },
  { id: 'br-bonifacio', slug: 'bonifacio', name: 'Bonifacio', cash_discount_pct: 3, portalId: 44 },
];

const PORTAL_BASE = 'https://app.abgadgetz.com.ph';

function collectCookies(res, jar) {
  for (const raw of res.headers.getSetCookie?.() || []) {
    const pair = raw.split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

const cookieHeader = (jar) => Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');

// Same login flow as the Admin Portal's working adapter: load the login page,
// read the form action + CSRF token, then POST the credentials.
async function portalLogin(username, password, jar) {
  const pageRes = await fetch(`${PORTAL_BASE}/`, { redirect: 'manual' });
  collectCookies(pageRes, jar);
  const html = await pageRes.text();

  const actionMatch = html.match(/<form[^>]*action=["']([^"']+)["']/i);
  const postUrl = actionMatch ? new URL(actionMatch[1], PORTAL_BASE).toString() : `${PORTAL_BASE}/`;
  const csrfMatch = html.match(/name=["'](_token|csrf_token|csrf_test_name)["'][^>]*value=["']([^"']+)["']/i);

  const form = new URLSearchParams();
  form.set('username', username);
  form.set('password', password);
  if (csrfMatch) form.set(csrfMatch[1], csrfMatch[2]);

  const postRes = await fetch(postUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
    body: form.toString(),
    redirect: 'manual',
  });
  collectCookies(postRes, jar);
  if (postRes.status >= 400) throw new Error(`Portal login failed with HTTP ${postRes.status}`);
}

async function loginAndFetchPortal(username, password) {
  const jar = new Map();
  await portalLogin(username, password, jar);

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  const parseNum = (t) => Number(String(t || '').replace(/[^0-9.-]/g, '')) || 0;
  const extractCells = (trHtml) =>
    [...trHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
    );
  const parseStockCardDate = (raw) => {
    const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const m = String(raw || '').trim().match(/^([A-Za-z]{3})-(\d{1,2})-(\d{2,4})$/);
    if (!m) return '';
    const mm = MONTHS[m[1].toLowerCase()];
    if (!mm) return '';
    const dd = String(m[2]).padStart(2, '0');
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${mm}-${dd}`;
  };
  const parseStockCardTable = (html) => {
    const entries = [];
    for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const tds = extractCells(tr[1]);
      if (tds.length < 6) continue;
      const dateStr = parseStockCardDate(tds[0]);
      if (!dateStr) continue;
      const txType = (tds[2] || '').toUpperCase().trim();
      const oldQty = parseInt(String(tds[4] || '').replace(/[^0-9-]/g, ''), 10);
      const newQty = parseInt(String(tds[5] || '').replace(/[^0-9-]/g, ''), 10);
      if (!Number.isFinite(oldQty) || !Number.isFinite(newQty)) continue;
      const deltaQty = newQty - oldQty;
      if (deltaQty === 0) continue;
      entries.push({ dateStr, ref: tds[1] || '', txType, oldQty, newQty, deltaQty });
    }
    return entries;
  };
  const parseMonthlyRows = (html) => {
    const rows = [];
    for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
        m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+\n/g, '\n').trim()
      );
      if (tds.length < 7) continue;
      const lines = tds[1].split('\n').map((s) => s.trim()).filter(Boolean);
      const itemName = (lines[0] || '').trim();
      const itemCode = (lines[1] || '').trim();
      const category = (tds[2] || '').trim();
      const unitPrice = Number(tds[3].replace(/[^0-9.]/g, '')) || 0;
      const available = parseInt(tds[4].replace(/[^0-9-]/g, ''), 10) || 0;
      const sales = parseInt(tds[5].replace(/[^0-9-]/g, ''), 10) || 0;
      const installment = parseInt(tds[6].replace(/[^0-9-]/g, ''), 10) || 0;
      const hasMonthlyMove = [5, 6, 7, 8, 9, 10, 11, 12].some((idx) => (parseInt((tds[idx] || '').replace(/[^0-9-]/g, ''), 10) || 0) !== 0);
      const viewLink = (tr[1].match(/href=["'](\/panel\/stocks\/view\/\d+)["']/i) || [])[1] || '';
      if (itemCode) rows.push({ itemName, itemCode, category, unitPrice, available, sales, installment, hasMonthlyMove, viewLink });
    }
    return rows;
  };

  const result = new Map();
  const stockCardsByBranch = new Map();
  const liveInstallments = [];
  const livePayments = [];
  const liveExpenses = [];
  const livePastDues = [];

  const prevMonthDate = new Date(year, now.getMonth() - 1, 1);
  const prevY = prevMonthDate.getFullYear();
  const prevM = String(prevMonthDate.getMonth() + 1).padStart(2, '0');

  for (const b of BRANCHES) {
    const url = `${PORTAL_BASE}/panel/stocks/branch_monthly_inventory/${b.portalId}/${year}/${month}`;
    const res = await fetch(url, { headers: { Cookie: cookieHeader(jar) }, redirect: 'manual' });
    if (!res.ok) throw new Error(`Portal fetch failed for ${b.name}: HTTP ${res.status}`);
    const html = await res.text();
    if (html.includes('Sign In to AB GADGETZ')) {
      throw new Error('Portal login was rejected (got the sign-in page instead of inventory). Check PORTAL_USERNAME / PORTAL_PASSWORD secrets.');
    }
    const rows = parseMonthlyRows(html);
    if (rows.length === 0) {
      throw new Error(`Portal returned no inventory rows for ${b.name}; refusing to publish empty stock.`);
    }
    result.set(b.id, rows);

    // Collect items that had movements in current or previous month and fetch their daily Stock Cards
    const linkToRow = new Map();
    for (const r of rows) {
      if (r.hasMonthlyMove && r.viewLink) linkToRow.set(r.viewLink, r);
    }
    try {
      const prevRes = await fetch(`${PORTAL_BASE}/panel/stocks/branch_monthly_inventory/${b.portalId}/${prevY}/${prevM}`, { headers: { Cookie: cookieHeader(jar) } });
      if (prevRes.ok) {
        for (const r of parseMonthlyRows(await prevRes.text())) {
          if (r.hasMonthlyMove && r.viewLink && !linkToRow.has(r.viewLink)) linkToRow.set(r.viewLink, r);
        }
      }
    } catch {}

    const cardItems = Array.from(linkToRow.values());
    const branchCardEntries = [];
    const batchSize = 8;
    for (let i = 0; i < cardItems.length; i += batchSize) {
      const batch = cardItems.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (r) => {
          try {
            const cRes = await fetch(`${PORTAL_BASE}${r.viewLink}`, { headers: { Cookie: cookieHeader(jar) } });
            if (!cRes.ok) return;
            const entries = parseStockCardTable(await cRes.text());
            for (const e of entries) {
              branchCardEntries.push({ ...e, itemCode: r.itemCode, itemName: r.itemName, category: r.category, unitPrice: r.unitPrice });
            }
          } catch {}
        })
      );
    }
    stockCardsByBranch.set(b.id, branchCardEntries);

    try {
      const instRes = await fetch(`${PORTAL_BASE}/panel/franchise/installments/${b.portalId}`, { headers: { Cookie: cookieHeader(jar) } });
      if (instRes.ok) {
        const instHtml = await instRes.text();
        for (const tr of instHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
          const tds = extractCells(tr[1]);
          if (tds.length < 11 || !/^\d{4}-\d{2}-\d{2}/.test(tds[1])) continue;
          liveInstallments.push({
            branch_id: b.id, branch_name: b.name, sale_date: tds[1].slice(0, 10),
            unit: tds[2] || '', amount: parseNum(tds[3]), term: parseInt(tds[4], 10) || 0,
            monthly: parseNum(tds[5]), deposit: parseNum(tds[9]), principal_amount: parseNum(tds[10]),
          });
        }
      }
    } catch {}

    try {
      const payRes = await fetch(`${PORTAL_BASE}/panel/franchise/payments/${b.portalId}`, { headers: { Cookie: cookieHeader(jar) } });
      if (payRes.ok) {
        const payHtml = await payRes.text();
        for (const tr of payHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
          const tds = extractCells(tr[1]);
          if (tds.length < 10 || !/^\d{4}-\d{2}-\d{2}/.test(tds[1])) continue;
          livePayments.push({
            branch_id: b.id, branch_name: b.name, payment_date: tds[1].slice(0, 10),
            account_no: tds[3], customer_name: tds[4], amount: parseNum(tds[5]),
            principal: parseNum(tds[6]), interest: parseNum(tds[7]), penalties: parseNum(tds[8]), rebates: parseNum(tds[9]),
          });
        }
      }
    } catch {}

    try {
      const expRes = await fetch(`${PORTAL_BASE}/panel/franchise/expenses/${b.portalId}/${year}/${month}`, { headers: { Cookie: cookieHeader(jar) } });
      if (expRes.ok) {
        const expHtml = await expRes.text();
        for (const tr of expHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
          const tds = extractCells(tr[1]);
          if (tds.length < 4 || !/^\d{4}-\d{2}-\d{2}/.test(tds[0])) continue;
          liveExpenses.push({
            branch_id: b.id, branch_name: b.name, expense_date: tds[0].slice(0, 10),
            expense_type: tds[1] || 'OTHER EXPENSES', particular: tds[2] || '', amount: parseNum(tds[3]),
          });
        }
      }
    } catch {}

    try {
      const pdRes = await fetch(`${PORTAL_BASE}/panel/pastdues/${b.portalId}/all`, { headers: { Cookie: cookieHeader(jar) } });
      if (pdRes.ok) {
        const pdHtml = await pdRes.text();
        for (const tr of pdHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
          const tds = extractCells(tr[1]);
          if (tds.length < 6 || !/^\d{4}-\d{2}-\d{2}/.test(tds[0])) continue;
          livePastDues.push({
            branch_id: b.id, branch_name: b.name, release_date: tds[0].slice(0, 10),
            account_no: tds[1] || '', unit: tds[2] || '', customer_name: tds[3] || '',
            contact_no: tds[4] || '', barangay: tds[5] || '',
          });
        }
      }
    } catch {}
  }
  return { inventoryByBranch: result, stockCardsByBranch, liveInstallments, livePayments, liveExpenses, livePastDues };
}

const PHONE_CATEGORIES = new Set(['CELLPHONES', 'REPO', 'KEYPAD CELLPHONES']);
const KNOWN_BRANDS = [
  ['infinix', 'Infinix'], ['tecno', 'Tecno'], ['realme', 'Realme'], ['itel', 'Itel'], ['redmi', 'Redmi'],
  ['vivo', 'Vivo'], ['samsung', 'Samsung'], ['nubia', 'Nubia'], ['oppo', 'Oppo'], ['apple', 'Apple'],
  ['iphone', 'Apple'], ['ipad', 'Apple'], ['poco', 'Poco'], ['honor', 'Honor'], ['zte', 'ZTE'], ['tcl', 'TCL'],
];

// Builds a catalog entry for an item that exists on the AB website but not in our product list.
function makePortalProduct(row) {
  const name = row.itemName.trim();
  const firstWord = name.split(/\s+/)[0].toLowerCase();
  const brand = (KNOWN_BRANDS.find(([k]) => firstWord.startsWith(k)) || [null, 'Other'])[1];
  const isPhone = PHONE_CATEGORIES.has(row.category.toUpperCase()) && row.unitPrice >= 2500;
  return {
    id: `portal-${row.itemCode.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
    sku: row.itemCode,
    brand,
    model: name,
    name,
    category: row.category,
    website_codes: row.itemCode,
    product_type: isPhone ? 'Cellphones' : 'Accessories',
    unit: 'pc',
    cost_price: 0,
    base_price: row.unitPrice,
    image_urls: '',
    lifecycle_status: 'Active',
  };
}

const normCode = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');

async function main() {
  const products = seedSnapshot.products.map((p) => ({ ...p }));
  const branchPrice = new Map(); // `${branchId}::${productId}` -> price from the AB website
  const newProducts = new Set(); // ids of items auto-added from the AB website
  const invMap = new Map(seedSnapshot.branch_inventory.map((r) => [`${r.branch_id}::${r.product_id}`, { ...r }]));
  const ruleMap = new Map(seedSnapshot.customer_catalog_rules.map((r) => [`${r.customer_id}::${r.product_id}`, Boolean(r.is_visible)]));

  const codeToProduct = new Map();
  for (const p of products) {
    const rawCodes = String(p.website_codes || p.sku || '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
    for (const c of rawCodes) {
      codeToProduct.set(c, p);
    }
  }

  const user = process.env.PORTAL_USERNAME;
  const pass = process.env.PORTAL_PASSWORD;
  let liveSynced = false;
  let liveSyncNote = 'No portal credentials provided; using last published snapshot.';
  let allMovements = Array.isArray(seedSnapshot.inventory_movements) ? [...seedSnapshot.inventory_movements] : [];
  let allInstallments = Array.isArray(seedSnapshot.portal_installments) ? [...seedSnapshot.portal_installments] : [];
  let allPayments = Array.isArray(seedSnapshot.portal_payments) ? [...seedSnapshot.portal_payments] : [];
  let allExpenses = Array.isArray(seedSnapshot.portal_expenses) ? [...seedSnapshot.portal_expenses] : [];
  let allPastDues = Array.isArray(seedSnapshot.portal_past_dues) ? [...seedSnapshot.portal_past_dues] : [];
  const prevInvMap = new Map(seedSnapshot.branch_inventory.map((r) => [`${r.branch_id}::${r.product_id}`, Number(r.qty_on_hand) || 0]));

  // Load previously deployed live state from GitHub Pages so 30-min syncs only record real new movements
  try {
    const prevRes = await fetch(`https://ab-gadgetz.github.io/data/admin-bundle.json?cb=${Date.now()}`);
    if (prevRes.ok) {
      const prevBundle = await prevRes.json();
      if (prevBundle?.liveSynced && Array.isArray(prevBundle.inventory?.items)) {
        for (const item of prevBundle.inventory.items) {
          for (const b of BRANCHES) {
            const cell = item.byBranch?.[b.id];
            if (cell) prevInvMap.set(`${b.id}::${item.id}`, Number(cell.qtyOnHand) || 0);
          }
        }
        // Explicitly keep prd-bavin-093 baseline at 4 so fixing its code whitespace doesn't log a false +4 restock
        if (prevInvMap.get('br-bonifacio::prd-bavin-093') === 0) {
          prevInvMap.set('br-bonifacio::prd-bavin-093', 4);
        }
      }
      if (Array.isArray(prevBundle?.allMovements)) {
        const cleanPrev = prevBundle.allMovements.filter((m) => m.id !== 'live-br-bonifacio-prd-bavin-093');
        const seenIds = new Set(cleanPrev.map((m) => String(m.id)));
        for (const m of allMovements) {
          if (!seenIds.has(String(m.id))) cleanPrev.push(m);
        }
        allMovements = cleanPrev;
      }
    }
  } catch {}

  if (user && pass) {
    try {
      const {
        inventoryByBranch: liveData,
        stockCardsByBranch: fetchedStockCards,
        liveInstallments: fetchedInstallments,
        livePayments: fetchedPayments,
        liveExpenses: fetchedExpenses,
        livePastDues: fetchedPastDues,
      } = await loginAndFetchPortal(user, pass);
      if (fetchedInstallments.length > 0) {
        allInstallments = fetchedInstallments.sort((a, b) => String(b.sale_date).localeCompare(String(a.sale_date)));
      }
      if (fetchedPayments.length > 0) {
        allPayments = fetchedPayments.sort((a, b) => String(b.payment_date).localeCompare(String(a.payment_date)));
      }
      if (fetchedExpenses.length > 0) {
        allExpenses = fetchedExpenses.sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)));
      }
      if (fetchedPastDues.length > 0) {
        allPastDues = fetchedPastDues.sort((a, b) => String(b.release_date).localeCompare(String(a.release_date)));
      }
      const nowIso = new Date().toISOString();
      const liveCardMovements = [];
      for (const [branchId, rows] of liveData.entries()) {
        const bObj = BRANCHES.find((x) => x.id === branchId);
        // Live portal is the source of truth for stock: zero out this branch first,
        // then apply the counts the portal reports.
        for (const p of products) {
          invMap.set(`${branchId}::${p.id}`, { branch_id: branchId, product_id: p.id, qty_on_hand: 0, qty_reserved: 0 });
        }
        const totals = new Map();
        for (const row of rows) {
          let prod = codeToProduct.get(row.itemCode.trim().toUpperCase());

          // Brand-new item on the AB website that is not in our product list yet:
          // add it automatically (only when it is actually in stock or had movements).
          if (!prod && (row.available > 0 || row.hasMonthlyMove) && row.itemName) {
            prod = makePortalProduct(row);
            products.push(prod);
            codeToProduct.set(row.itemCode.trim().toUpperCase(), prod);
            newProducts.add(prod.id);
          }
          if (!prod) continue;

          totals.set(prod.id, (totals.get(prod.id) || 0) + Math.max(0, row.available));
          // Price on the AB website is the source of truth (per branch).
          if (row.unitPrice > 0 && (row.available > 0 || row.hasMonthlyMove)) {
            branchPrice.set(`${branchId}::${prod.id}`, row.unitPrice);
          }
        }
        for (const [pid, qty] of totals.entries()) {
          invMap.set(`${branchId}::${pid}`, { branch_id: branchId, product_id: pid, qty_on_hand: qty, qty_reserved: 0 });
        }

        // Convert actual portal Stock Card daily entries into movements for Activity Log & Daily Inventory PDF
        const cardEntries = fetchedStockCards?.get(branchId) || [];
        let cardIdx = 0;
        for (const ce of cardEntries) {
          let prod = codeToProduct.get(String(ce.itemCode || '').trim().toUpperCase());
          if (!prod && ce.itemName) {
            prod = makePortalProduct(ce);
            products.push(prod);
            codeToProduct.set(String(ce.itemCode || '').trim().toUpperCase(), prod);
            newProducts.add(prod.id);
          }
          if (!prod) continue;
          const isSale = ce.txType === 'ORDER' || ce.txType === 'INSTALLMENT';
          const mType = isSale ? `STOCKCARD_SALE_${ce.txType}` : `STOCKCARD_${ce.txType}`;
          liveCardMovements.push({
            id: `sc-${branchId}-${prod.id}-${ce.dateStr}-${ce.ref || cardIdx++}`,
            branch_id: branchId,
            branch_name: bObj ? bObj.name : branchId,
            product_id: prod.id,
            sku: prod.sku,
            product_name: prod.name,
            brand: prod.brand,
            model: prod.model || prod.name,
            product_type: prod.product_type || 'Cellphones',
            base_price: branchPrice.get(`${branchId}::${prod.id}`) ?? prod.base_price,
            delta_qty: ce.deltaQty,
            movement_type: mType,
            recorded_at: `${ce.dateStr}T12:00:00.000Z`,
          });
        }
      }
      if (liveCardMovements.length > 0) {
        allMovements = liveCardMovements.sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));
      }
      liveSynced = true;
      liveSyncNote = `Live stock & prices synced from app.abgadgetz.com.ph (${newProducts.size} new item(s) auto-added)`;
      console.log('Live portal sync succeeded.');
    } catch (err) {
      liveSyncNote = `Live sync FAILED, showing last published snapshot: ${err.message}`;
      console.log(`::warning title=Live portal sync failed::${err.message}`);
    }
  } else {
    console.log('::warning title=No portal credentials::PORTAL_USERNAME / PORTAL_PASSWORD secrets are missing.');
  }

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(distDir, 'data'), { recursive: true });

  for (const file of ['styles.css', 'catalog.js', 'app.js', 'ab-logo.png', 'ab-logo-square.png', 'manifest.webmanifest']) {
    if (fs.existsSync(path.join(publicDir, file))) {
      fs.copyFileSync(path.join(publicDir, file), path.join(distDir, file));
    }
  }

  const rawHtml = fs.readFileSync(path.join(publicDir, 'catalog.html'), 'utf8');
  for (const b of BRANCHES) {
    const discountRate = b.cash_discount_pct / 100;
    const catalogId = `cat-${b.id}`;
    const catalog = [];
    for (const p of products) {
      if ((p.lifecycle_status || 'Active') === 'Discontinued') continue;
      const ruleKey = `${catalogId}::${p.id}`;
      const isVisible = ruleMap.has(ruleKey) ? ruleMap.get(ruleKey) : true;
      if (!isVisible) continue;
      const cell = invMap.get(`${b.id}::${p.id}`);
      const branchAvailable = cell ? Math.max(0, (cell.qty_on_hand || 0) - (cell.qty_reserved || 0)) : 0;
      const otherBranches = [];
      if (branchAvailable <= 0) {
        for (const ob of BRANCHES) {
          if (ob.id === b.id) continue;
          const oCell = invMap.get(`${ob.id}::${p.id}`);
          const oAvail = oCell ? Math.max(0, (oCell.qty_on_hand || 0) - (oCell.qty_reserved || 0)) : 0;
          if (oAvail > 0) otherBranches.push(ob.name);
        }
        if (otherBranches.length === 0) continue;
      }
      const imageUrls = String(p.image_urls || '').split(/[|\r\n]+/).map((u) => u.trim()).filter(Boolean);
      let price = branchPrice.get(`${b.id}::${p.id}`) ?? p.base_price;
      if ((!price || price <= 0) && otherBranches.length > 0) {
        for (const ob of BRANCHES) {
          const op = branchPrice.get(`${ob.id}::${p.id}`);
          if (op && op > 0) { price = op; break; }
        }
      }
      if (!price || price <= 0) continue; // never show a ₱0 price to customers
      catalog.push({
        productId: p.id,
        brand: p.brand,
        model: p.model || p.name,
        name: p.name,
        productType: p.product_type || 'Cellphones',
        basePrice: price,
        cashPrice: Math.round(price * (1 - discountRate)),
        imageUrl: imageUrls[0] || '',
        imageUrls,
        branchAvailable,
        otherBranches,
      });
    }

    const payload = {
      branch: { id: b.id, name: b.name, cash_discount_pct: b.cash_discount_pct },
      catalog,
      installmentRates: seedSnapshot.installment_settings,
      syncedAt: new Date().toISOString(),
      liveSynced,
      liveSyncNote,
    };
    fs.writeFileSync(path.join(distDir, 'data', `${b.slug}.json`), JSON.stringify(payload));
    const branchDir = path.join(distDir, b.slug);
    fs.mkdirSync(branchDir, { recursive: true });
    fs.writeFileSync(path.join(branchDir, 'index.html'), rawHtml);
    console.log(`Built ${b.name}: ${catalog.length} available models`);
  }

  // Build full GitHub Pages Admin Portal bundle (Inventory, Receivables, Finance, Catalogs, Activity Log)
  let totalStockValue = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  const syncedAtIso = new Date().toISOString();

  const inventoryItems = products.map((p) => {
    const byBranch = {};
    let totalOnHand = 0;
    let totalAvailable = 0;
    let latestPrice = Number(p.base_price) || 0;
    for (const b of BRANCHES) {
      const bp = branchPrice.get(`${b.id}::${p.id}`);
      if (bp && bp > 0) latestPrice = bp;
    }
    for (const b of BRANCHES) {
      const c = invMap.get(`${b.id}::${p.id}`);
      const qtyOnHand = c ? Number(c.qty_on_hand) || 0 : 0;
      const qtyReserved = c ? Number(c.qty_reserved) || 0 : 0;
      const available = Math.max(0, qtyOnHand - qtyReserved);
      const reorderPoint = c?.reorder_point ?? 2;
      const maxStock = c?.max_stock ?? 6;
      const discountRate = (b.cash_discount_pct || 0) / 100;
      const cashUnitPrice = Math.round(latestPrice * (1 - discountRate));
      const potentialCashSales = available * cashUnitPrice;
      totalOnHand += qtyOnHand;
      totalAvailable += available;
      totalStockValue += qtyOnHand * (Number(p.cost_price) || 0);

      let isLow = false;
      if ((p.lifecycle_status || 'Active') === 'Active') {
        if (latestPrice < 10000) isLow = available > 0 && available <= (b.name === 'Molave' ? 2 : 1);
        else if (latestPrice < 20000) isLow = available > 0 && available <= 2;
      }
      let status = 'HEALTHY';
      if (available === 0) { status = 'OUT'; outOfStockCount++; }
      else if (isLow || available <= reorderPoint) { status = 'LOW'; lowStockCount++; }

      byBranch[b.id] = {
        qtyOnHand,
        qtyReserved,
        qtyAvailable: available,
        reorderPoint,
        maxStock,
        cashUnitPrice,
        potentialCashSales,
        status,
        updatedAt: syncedAtIso,
      };
    }
    const imageUrls = String(p.image_urls || '').split(/[|\r\n]+/).map((u) => u.trim()).filter(Boolean);
    return {
      ...p,
      base_price: latestPrice,
      cost_price: Number(p.cost_price) || 0,
      product_type: p.product_type || 'Cellphones',
      lifecycle_status: p.lifecycle_status || 'Active',
      imageUrl: imageUrls[0] || '',
      imageUrls,
      totalOnHand,
      totalAvailable,
      stockValue: Number((totalOnHand * (Number(p.cost_price) || 0)).toFixed(2)),
      byBranch,
    };
  });

  const catalogViewsByBranch = {};
  let viewsTotal = 0;
  let viewsWeekly = 0;
  let viewsMonthly = 0;
  await Promise.all(
    BRANCHES.map(async (b) => {
      try {
        const r = await fetch(`https://hits.sh/api/urns/maynardrdelossantos.github.io/ab-gadgetz-catalog-views/${b.slug}`);
        if (r.ok) {
          const j = await r.json();
          const t = Number(j.total) || 0;
          const w = Number(j.weekly) || 0;
          const m = Number(j.monthly) || 0;
          catalogViewsByBranch[b.id] = { total: t, weekly: w, monthly: m };
          viewsTotal += t;
          viewsWeekly += w;
          viewsMonthly += m;
          return;
        }
      } catch {}
      catalogViewsByBranch[b.id] = { total: 0, weekly: 0, monthly: 0 };
    })
  );

  const adminBundle = {
    inventory: {
      branches: BRANCHES.map((b) => ({ id: b.id, name: b.name, code: b.slug.toUpperCase(), cash_discount_pct: b.cash_discount_pct, is_active: 1 })),
      items: inventoryItems,
      summary: {
        totalSkus: products.length,
        activeBranches: BRANCHES.length,
        totalStockValue: Number(totalStockValue.toFixed(2)),
        lowStockCount,
        outOfStockCount,
      },
    },
    catalogRules: seedSnapshot.customer_catalog_rules || [],
    installmentRates: seedSnapshot.installment_settings || [],
    orderBudgetItems: seedSnapshot.order_budget_items || [],
    staffPinHashes: seedSnapshot.staff_pin_hashes || null,
    catalogViews: { byBranch: catalogViewsByBranch, total: viewsTotal, weekly: viewsWeekly, monthly: viewsMonthly },
    allMovements: allMovements.slice(0, 3500),
    allInstallments: allInstallments.slice(0, 1200),
    portal_transactions: seedSnapshot.portal_transactions || [],
    allPayments: allPayments.slice(0, 1500),
    allExpenses: allExpenses.slice(0, 1000),
    allPastDues: allPastDues.slice(0, 800),
    syncedAt: syncedAtIso,
    liveSynced,
    liveSyncNote,
  };
  fs.writeFileSync(path.join(distDir, 'data', 'admin-bundle.json'), JSON.stringify(adminBundle));
  const staffPinsJsonPath = path.join(publicDir, 'staff-pins.json');
  if (fs.existsSync(staffPinsJsonPath)) {
    fs.copyFileSync(staffPinsJsonPath, path.join(distDir, 'data', 'staff-pins.json'));
  } else if (seedSnapshot.staff_pin_hashes || seedSnapshot.staff_pins_enc) {
    fs.writeFileSync(
      path.join(distDir, 'data', 'staff-pins.json'),
      JSON.stringify({
        updatedAt: syncedAtIso,
        hashes: seedSnapshot.staff_pin_hashes || {},
        encryptedPins: seedSnapshot.staff_pins_enc || null,
      })
    );
  }
  if (fs.existsSync(path.join(publicDir, 'index.html'))) {
    fs.mkdirSync(path.join(distDir, 'admin'), { recursive: true });
    fs.mkdirSync(path.join(distDir, 'staff'), { recursive: true });
    const cacheBust = Date.now();
    const baseManifest = fs.existsSync(path.join(publicDir, 'manifest.webmanifest'))
      ? JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8'))
      : { name: 'AB Gadgetz', short_name: 'AB Gadgetz', display: 'standalone', background_color: '#15191f', theme_color: '#15191f', icons: [] };
    const adminManifest = {
      ...baseManifest,
      name: 'AB Gadgetz Admin',
      short_name: 'AB Admin',
      start_url: '/admin/',
      scope: '/admin/',
      icons: (baseManifest.icons || []).map((ic) => ({ ...ic, src: '/ab-logo-square.png' })),
    };
    const staffManifest = {
      ...baseManifest,
      name: 'AB Gadgetz Staff',
      short_name: 'AB Staff',
      start_url: '/staff/',
      scope: '/staff/',
      icons: (baseManifest.icons || []).map((ic) => ({ ...ic, src: '/ab-logo-square.png' })),
    };
    fs.writeFileSync(path.join(distDir, 'admin', 'manifest.webmanifest'), JSON.stringify(adminManifest, null, 2));
    fs.writeFileSync(path.join(distDir, 'staff', 'manifest.webmanifest'), JSON.stringify(staffManifest, null, 2));

    const adminHtml = fs
      .readFileSync(path.join(publicDir, 'index.html'), 'utf8')
      .replace(/href="\/manifest\.webmanifest"/g, 'href="./manifest.webmanifest"')
      .replace(/href="\/ab-logo-square\.png"/g, 'href="../ab-logo-square.png"')
      .replace(/href="\/styles\.css"/g, `href="../styles.css?v=${cacheBust}"`)
      .replace(/src="\/ab-logo-square\.png"/g, 'src="../ab-logo-square.png"')
      .replace(/src="\/ab-logo\.png"/g, 'src="../ab-logo.png"')
      .replace(/src="\/app\.js"/g, `src="../app.js?v=${cacheBust}"`);
    const staffHtml = adminHtml
      .replace('<title>Owner Admin Portal</title>', '<title>Staff Portal — AB Gadgetz</title>')
      .replace('OWNER ADMIN PORTAL • REALTIME SYNC', 'STAFF PORTAL • VIEW & PDF ONLY')
      .replace('id="loginRoleSelect" value="ADMIN"', 'id="loginRoleSelect" value="CASHIER"')
      .replace('id="loginRoleWrap" class="hidden"', 'id="loginRoleWrap"')
      .replace('id="loginBranchWrap" class="hidden"', 'id="loginBranchWrap"');
    fs.writeFileSync(path.join(distDir, 'admin', 'index.html'), adminHtml);
    fs.writeFileSync(path.join(distDir, 'staff', 'index.html'), staffHtml);
    console.log(`Built Full Admin & Staff Portals: ${inventoryItems.length} products, ${adminBundle.allPayments.length} payments, ${adminBundle.allInstallments.length} installments`);
  }

  const landingHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Branch Catalogs</title>
  <link rel="icon" href="./ab-logo-square.png" type="image/png" />
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <div class="wrap" style="max-width:460px;margin:32px auto;">
    <div class="card" style="text-align:center;padding:24px;">
      <img src="./ab-logo-square.png" alt="Logo" class="portal-logo-img" style="margin-bottom:12px;" />
      <h2 style="margin:0 0 6px;color:var(--gold-bright);">Select Your Branch Catalog</h2>
      <p class="muted small" style="margin:0 0 18px;">View available units, cash prices &amp; installment options</p>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <a href="./molave/" style="display:block;padding:12px;border-radius:10px;background:var(--gold);color:#15191f;font-weight:800;text-decoration:none;">Molave Catalog</a>
        <a href="./tambulig/" style="display:block;padding:12px;border-radius:10px;background:var(--gold);color:#15191f;font-weight:800;text-decoration:none;">Tambulig Catalog</a>
        <a href="./bonifacio/" style="display:block;padding:12px;border-radius:10px;background:var(--gold);color:#15191f;font-weight:800;text-decoration:none;">Bonifacio Catalog</a>
      </div>
    </div>
  </div>
</body>
</html>`;
  fs.writeFileSync(path.join(distDir, 'index.html'), landingHtml);
}

main();
