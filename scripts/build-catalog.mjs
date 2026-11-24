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

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, options);
      if ((res.status >= 500 || res.status === 429) && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 350 * (i + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 350 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

function manilaDateDaysAgo(days = 0) {
  return new Date(Date.now() - days * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

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
  const pageRes = await fetchWithRetry(`${PORTAL_BASE}/`, { redirect: 'manual' });
  collectCookies(pageRes, jar);
  const html = await pageRes.text();

  const actionMatch = html.match(/<form[^>]*action=["']([^"']+)["']/i);
  const postUrl = actionMatch ? new URL(actionMatch[1], PORTAL_BASE).toString() : `${PORTAL_BASE}/`;
  const csrfMatch = html.match(/name=["'](_token|csrf_token|csrf_test_name)["'][^>]*value=["']([^"']+)["']/i);

  const form = new URLSearchParams();
  form.set('username', username);
  form.set('password', password);
  if (csrfMatch) form.set(csrfMatch[1], csrfMatch[2]);

  const postRes = await fetchWithRetry(postUrl, {
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
  const succeededCodesByBranch = new Map();
  const liveInstallments = [];
  const livePayments = [];
  const liveExpenses = [];
  const livePastDues = [];

  const prevMonthDate = new Date(year, now.getMonth() - 1, 1);
  const prevY = prevMonthDate.getFullYear();
  const prevM = String(prevMonthDate.getMonth() + 1).padStart(2, '0');

  for (const b of BRANCHES) {
    const url = `${PORTAL_BASE}/panel/stocks/branch_monthly_inventory/${b.portalId}/${year}/${month}`;
    const res = await fetchWithRetry(url, { headers: { Cookie: cookieHeader(jar) }, redirect: 'manual' });
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
      const prevRes = await fetchWithRetry(`${PORTAL_BASE}/panel/stocks/branch_monthly_inventory/${b.portalId}/${prevY}/${prevM}`, { headers: { Cookie: cookieHeader(jar) } });
      if (prevRes.ok) {
        const prevHtml = await prevRes.text();
        if (!prevHtml.includes('Sign In to AB GADGETZ')) {
          for (const r of parseMonthlyRows(prevHtml)) {
            if (r.hasMonthlyMove && r.viewLink && !linkToRow.has(r.viewLink)) linkToRow.set(r.viewLink, r);
          }
        }
      }
    } catch {}

    const cardItems = Array.from(linkToRow.values());
    const branchCardEntries = [];
    const succeededCodes = new Set();
    const failedCardRows = [];
    const batchSize = 4;
    const fetchOneCard = async (r) => {
      const cRes = await fetchWithRetry(`${PORTAL_BASE}${r.viewLink}`, { headers: { Cookie: cookieHeader(jar) } });
      if (!cRes.ok) throw new Error(`HTTP ${cRes.status}`);
      const cHtml = await cRes.text();
      if (cHtml.includes('Sign In to AB GADGETZ')) throw new Error('Session expired');
      const entries = parseStockCardTable(cHtml);
      succeededCodes.add(String(r.itemCode || '').trim().toUpperCase());
      for (const e of entries) {
        branchCardEntries.push({ ...e, itemCode: r.itemCode, itemName: r.itemName, category: r.category, unitPrice: r.unitPrice });
      }
    };
    for (let i = 0; i < cardItems.length; i += batchSize) {
      const batch = cardItems.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (r) => {
          try {
            await fetchOneCard(r);
          } catch {
            failedCardRows.push(r);
          }
        })
      );
    }
    for (const r of failedCardRows) {
      try {
        await new Promise((resDelay) => setTimeout(resDelay, 250));
        await fetchOneCard(r);
      } catch {}
    }
    stockCardsByBranch.set(b.id, branchCardEntries);
    succeededCodesByBranch.set(b.id, succeededCodes);

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

    let emptyExpStreak = 0;
    for (let mOffset = 0; mOffset < 60; mOffset++) {
      const d = new Date(now.getFullYear(), now.getMonth() - mOffset, 1);
      const ey = d.getFullYear();
      const em = String(d.getMonth() + 1).padStart(2, '0');
      try {
        const expRes = await fetch(`${PORTAL_BASE}/panel/franchise/expenses/${b.portalId}/${ey}/${em}`, { headers: { Cookie: cookieHeader(jar) } });
        if (expRes.ok) {
          const expHtml = await expRes.text();
          let found = 0;
          for (const tr of expHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
            const tds = extractCells(tr[1]);
            if (tds.length < 4 || !/^\d{4}-\d{2}-\d{2}/.test(tds[0])) continue;
            found++;
            liveExpenses.push({
              branch_id: b.id, branch_name: b.name, expense_date: tds[0].slice(0, 10),
              expense_type: tds[1] || 'OTHER EXPENSES', particular: tds[2] || '', amount: parseNum(tds[3]),
            });
          }
          if (found > 0) emptyExpStreak = 0;
          else if (mOffset >= 2 && ++emptyExpStreak >= 3) break;
        } else if (mOffset >= 2 && ++emptyExpStreak >= 3) break;
      } catch {
        if (mOffset >= 2 && ++emptyExpStreak >= 3) break;
      }
    }

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
            balance: parseNum(tds[12] || tds[10] || 0),
            days_due: parseInt(String(tds[9] || '0').replace(/[^0-9]/g, ''), 10) || 0,
          });
        }
      }
    } catch {}
  }

  // Fetch latest deliveries from /panel/deliveries (+ latest 40 delivery views)
  const liveDeliveries = [];
  try {
    const dListRes = await fetchWithRetry(`${PORTAL_BASE}/panel/deliveries`, { headers: { Cookie: cookieHeader(jar) } });
    if (dListRes.ok) {
      const dHtml = await dListRes.text();
      const brMap = { MOLAVE: 'br-molave', TAMBULIG: 'br-tambulig', BONIFACIO: 'br-bonifacio' };
      const dHeaders = [];
      for (const tr of dHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const tds = extractCells(tr[1]);
        if (tds.length < 4 || !/^\d{4}-\d{2}-\d{2}$/.test(tds[0].trim())) continue;
        const linkMatch = tr[1].match(/href=["']\/panel\/deliveries\/view\/(\d+)["']/i);
        const portalDeliveryId = linkMatch ? parseInt(linkMatch[1], 10) : 0;
        const branchId = brMap[String(tds[2] || '').trim().toUpperCase()] || '';
        if (!portalDeliveryId || !branchId) continue;
        dHeaders.push({
          portalDeliveryId,
          deliveryDate: tds[0].trim().slice(0, 10),
          deliveryNo: String(tds[1] || '').trim(),
          branchId,
          status: String(tds[3] || 'RECEIVED').trim().toUpperCase(),
        });
      }
      const targetHeaders = dHeaders.slice(0, 40);
      for (let i = 0; i < targetHeaders.length; i += 4) {
        const chunk = targetHeaders.slice(i, i + 4);
        const done = await Promise.all(
          chunk.map(async (h) => {
            try {
              const vRes = await fetchWithRetry(`${PORTAL_BASE}/panel/deliveries/view/${h.portalDeliveryId}`, { headers: { Cookie: cookieHeader(jar) } });
              if (!vRes.ok) return { ...h, totalDeliveredQty: 0, totalReceivedQty: 0, totalAmount: 0, items: [] };
              const vHtml = await vRes.text();
              const items = [];
              let totD = 0, totR = 0, totAmt = 0;
              for (const tr of vHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
                const tds = extractCells(tr[1]);
                if (tds.length < 6) continue;
                const code = String(tds[0] || '').replace(/\s+/g, ' ').trim();
                const productName = String(tds[1] || '').trim();
                if (!code || code.toUpperCase() === 'TOTAL' || code.toUpperCase() === 'CODE:') continue;
                const deliveredQty = parseInt(String(tds[2] || '0').replace(/[^0-9-]/g, ''), 10) || 0;
                const receivedQty = parseInt(String(tds[3] || '0').replace(/[^0-9-]/g, ''), 10) || 0;
                const lineAmount = parseNum(tds[4]);
                items.push({
                  code,
                  productName,
                  productId: '',
                  deliveredQty,
                  receivedQty,
                  lineAmount,
                  unitSrp: deliveredQty > 0 ? Number((lineAmount / deliveredQty).toFixed(2)) : 0,
                  itemStatus: String(tds[5] || '').trim().toUpperCase(),
                });
                totD += deliveredQty;
                totR += receivedQty;
                totAmt += lineAmount;
              }
              return { ...h, totalDeliveredQty: totD, totalReceivedQty: totR, totalAmount: Number(totAmt.toFixed(2)), items };
            } catch {
              return { ...h, totalDeliveredQty: 0, totalReceivedQty: 0, totalAmount: 0, items: [] };
            }
          })
        );
        liveDeliveries.push(...done);
      }
    }
  } catch {}

  return { inventoryByBranch: result, stockCardsByBranch, succeededCodesByBranch, liveInstallments, livePayments, liveExpenses, livePastDues, liveDeliveries };
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
  let allDeliveries = Array.isArray(seedSnapshot.portal_deliveries)
    ? seedSnapshot.portal_deliveries.map((d) => ({
        portalDeliveryId: d.portal_delivery_id,
        deliveryDate: d.delivery_date,
        deliveryNo: d.delivery_no,
        branchId: d.branch_id,
        status: d.status,
        totalDeliveredQty: d.total_delivered_qty || 0,
        totalReceivedQty: d.total_received_qty || 0,
        totalAmount: d.total_amount || 0,
        items: (() => { try { return JSON.parse(d.items_json || '[]'); } catch { return []; } })(),
      }))
    : [];
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
        succeededCodesByBranch,
        liveInstallments: fetchedInstallments,
        livePayments: fetchedPayments,
        liveExpenses: fetchedExpenses,
        livePastDues: fetchedPastDues,
        liveDeliveries: fetchedDeliveries,
      } = await loginAndFetchPortal(user, pass);
      if (fetchedDeliveries && fetchedDeliveries.length > 0) {
        allDeliveries = fetchedDeliveries.map((d) => ({
          ...d,
          items: (d.items || []).map((it) => ({
            ...it,
            productId:
              it.productId ||
              codeToProduct.get(String(it.code || '').replace(/\s+/g, '').toUpperCase())?.id ||
              codeToProduct.get(String(it.code || '').trim().toUpperCase())?.id ||
              '',
          })),
        }));
      }
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
      const replacedProdBranchKeys = new Set();
      for (const [branchId, rows] of liveData.entries()) {
        const bObj = BRANCHES.find((x) => x.id === branchId);
        // Live portal is the source of truth for stock: preserve thresholds, zero out available, then apply portal counts.
        for (const p of products) {
          const prevCell = invMap.get(`${branchId}::${p.id}`);
          invMap.set(`${branchId}::${p.id}`, {
            branch_id: branchId,
            product_id: p.id,
            qty_on_hand: 0,
            qty_reserved: 0,
            reorder_point: prevCell?.reorder_point ?? 2,
            max_stock: prevCell?.max_stock ?? 6,
          });
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
          const prevCell = invMap.get(`${branchId}::${pid}`);
          invMap.set(`${branchId}::${pid}`, {
            branch_id: branchId,
            product_id: pid,
            qty_on_hand: qty,
            qty_reserved: 0,
            reorder_point: prevCell?.reorder_point ?? 2,
            max_stock: prevCell?.max_stock ?? 6,
          });
        }

        // Track only products whose Stock Card fetch actually succeeded so we never wipe failed/older products
        for (const codeUpper of succeededCodesByBranch?.get(branchId) || []) {
          const prod = codeToProduct.get(codeUpper);
          if (prod) replacedProdBranchKeys.add(`${branchId}::${prod.id}`);
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
          replacedProdBranchKeys.add(`${branchId}::${prod.id}`);
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
        const preservedPrev = allMovements.filter((m) => !replacedProdBranchKeys.has(`${m.branch_id}::${m.product_id}`));
        allMovements = [...liveCardMovements, ...preservedPrev].sort((a, b) =>
          String(b.recorded_at).localeCompare(String(a.recorded_at))
        );
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
  const pcCatalogPath = path.join(publicDir, 'branch-catalogs.json');
  const pcCatalogSnapshot = fs.existsSync(pcCatalogPath) ? JSON.parse(fs.readFileSync(pcCatalogPath, 'utf8')) : null;
  for (const b of BRANCHES) {
    const pcBranch = pcCatalogSnapshot?.[b.slug];
    if (pcBranch && (!liveSynced || process.env.GITHUB_EVENT_NAME === 'push')) {
      fs.writeFileSync(path.join(distDir, 'data', b.slug + '.json'), JSON.stringify(pcBranch));
      fs.mkdirSync(path.join(distDir, b.slug), { recursive: true });
      fs.writeFileSync(path.join(distDir, b.slug, 'index.html'), rawHtml);
      continue;
    }
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

  // Compute exact 30-day/90-day/all-time demand identical to server.js getPlanningPayload()
  let planningSummary = null;
  if (!liveSynced && seedSnapshot.planning_demand?.demandByProductBranch) {
    planningSummary = seedSnapshot.planning_demand;
  } else {
    const since30Date = manilaDateDaysAgo(30);
    const since90Date = manilaDateDaysAgo(90);
    const normUnit = (s) =>
      String(s || '')
        .toLowerCase()
        .replace(/\bplus\b/g, '+')
        .replace(/\bgalaxy\b/g, '')
        .replace(/gb\b/g, '')
        .replace(/\b4g\b/g, '')
        .replace(/[^a-z0-9+]/g, '');
    const prodByNorm = new Map();
    for (const p of products) {
      if ((p.is_active ?? 1) === 0) continue;
      for (const k of [normUnit(p.name), normUnit(`${p.brand || ''} ${p.model || ''}`)].filter(Boolean)) {
        const ex = prodByNorm.get(k);
        if (!ex || ((ex.lifecycle_status || 'Active') !== 'Active' && (p.lifecycle_status || 'Active') === 'Active')) {
          prodByNorm.set(k, p);
        }
      }
    }
    const demandPB = new Map();
    const ensureD = (pid, bid) => {
      const k = `${pid}::${bid}`;
      if (!demandPB.has(k)) {
        demandPB.set(k, { cash30: 0, instMv30: 0, instPt30: 0, cash90: 0, instMv90: 0, instPt90: 0, allTimeSold: 0, allTimeRestocked: 0 });
      }
      return demandPB.get(k);
    };
    for (const m of allMovements) {
      const mt = String(m.movement_type || '').toUpperCase();
      if (mt.includes('TRANSFER') || mt.includes('FREE')) continue;
      if (!m.product_id || !m.branch_id) continue;
      const d = ensureD(m.product_id, m.branch_id);
      const dt = String(m.recorded_at || '').slice(0, 10);
      const q = Math.abs(Number(m.delta_qty) || 0);
      if (Number(m.delta_qty) < 0) {
        d.allTimeSold += q;
        const isInst = mt.includes('INSTALLMENT');
        if (dt >= since90Date) {
          if (isInst) d.instMv90 += q;
          else d.cash90 += q;
        }
        if (dt >= since30Date) {
          if (isInst) d.instMv30 += q;
          else d.cash30 += q;
        }
      } else if (Number(m.delta_qty) > 0 && (mt.includes('DELIVERY') || mt.includes('STOCK'))) {
        d.allTimeRestocked += q;
      }
    }
    for (const ir of allInstallments) {
      const dt = String(ir.sale_date || '').slice(0, 10);
      if (dt < since90Date) continue;
      const p = prodByNorm.get(normUnit(ir.unit));
      if (!p || !ir.branch_id) continue;
      const d = ensureD(p.id, ir.branch_id);
      d.instPt90 += 1;
      if (dt >= since30Date) d.instPt30 += 1;
      d.allTimeSold = Math.max(d.allTimeSold, d.cash90 + Math.max(d.instMv90, d.instPt90));
    }
    const demandByProductBranch = {};
    const demandByProduct = {};
    for (const [k, d] of demandPB.entries()) {
      const [pid] = k.split('::');
      const sold30 = d.cash30 + Math.max(d.instMv30, d.instPt30);
      const sold90 = d.cash90 + Math.max(d.instMv90, d.instPt90);
      const allSold = Math.max(d.allTimeSold, sold90);
      demandByProductBranch[k] = { sold30, sold90, allSold, restocked: d.allTimeRestocked };
      if (!demandByProduct[pid]) demandByProduct[pid] = { sold30: 0, sold90: 0, allSold: 0, restocked: 0 };
      demandByProduct[pid].sold30 += sold30;
      demandByProduct[pid].sold90 += sold90;
      demandByProduct[pid].allSold += allSold;
      demandByProduct[pid].restocked += d.allTimeRestocked;
    }
    planningSummary = { demandByProductBranch, demandByProduct };
  }

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
    planning: planningSummary,
    catalogRules: seedSnapshot.customer_catalog_rules || [],
    installmentRates: seedSnapshot.installment_settings || [],
    orderBudgetItems: seedSnapshot.order_budget_items || [],
    staffPinHashes: seedSnapshot.staff_pin_hashes || null,
    catalogViews: { byBranch: catalogViewsByBranch, total: viewsTotal, weekly: viewsWeekly, monthly: viewsMonthly },
    allMovements: allMovements.slice(0, 6000),
    allInstallments,
    portal_transactions: seedSnapshot.portal_transactions || [],
    allPayments,
    allExpenses,
    allPastDues,
    allDeliveries,
    purchaseOrders: (seedSnapshot.purchase_orders || []).map((o) => {
      let parsedItems = [];
      try {
        parsedItems = typeof o.items_json === 'string' ? JSON.parse(o.items_json || '[]') : Array.isArray(o.items) ? o.items : [];
      } catch {
        parsedItems = [];
      }
      return {
        id: o.id,
        title: o.title,
        status: o.status,
        supplierFilter: o.supplier_filter || o.supplierFilter || 'LOWEST',
        notes: o.notes || '',
        expectedDate: o.expected_date || o.expectedDate || '',
        abDeliveryRefs: o.ab_delivery_refs || o.abDeliveryRefs || '',
        items: parsedItems,
        createdAt: o.created_at || o.createdAt || '',
        updatedAt: o.updated_at || o.updatedAt || '',
      };
    }),
    abSupplierCatalog: (() => {
      const todayIso = manilaDateDaysAgo(0);
      const addMonths = (iso, months = 3) => {
        const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return '';
        const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
        const tf = new Date(Date.UTC(y, mo + months, 1));
        const ld = new Date(Date.UTC(tf.getUTCFullYear(), tf.getUTCMonth() + 1, 0)).getUTCDate();
        return new Date(Date.UTC(tf.getUTCFullYear(), tf.getUTCMonth(), Math.min(d, ld))).toISOString().slice(0, 10);
      };
      const has3Mo = (since) => Boolean(since) && todayIso >= addMonths(since, 3);
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
      const validProds = inventoryItems.filter((p) => !/\bREPO\b|\bREPAIRED\b|\bLDU\b|FREEBIE|FREE BUNDLE|\bFREE\b|\bDEMO\b/.test(`${p.name || ''} ${p.model || ''}`.toUpperCase()));
      const matchEntry = (brand, modelName) => {
        const ce = compK(modelName);
        if (aliases[ce]) {
          const h = validProds.filter((p) => aliases[ce].includes(p.id));
          if (h.length) return h;
        }
        const tk = normK(modelName);
        const rr = tk.match(/\b\d+_\d+\b/g) || [];
        const bu = String(brand || '').toUpperCase();
        const pool = validProds.filter((p) => {
          const tu = `${p.brand || ''} ${p.model || ''} ${p.name || ''}`.toUpperCase();
          if (bu === 'POCO') return tu.includes('POCO');
          if (bu === 'OPPO') return tu.includes('OPPO');
          if (bu === 'ANKER') return tu.includes('ANKER') || tu.includes('SOUNDCORE');
          if (bu === 'INFINIX') return tu.includes('INFINIX') || tu.includes('XPAD') || tu.includes('XBOOK') || tu.includes('GTBOOK') || tu.includes('XWATCH') || tu.includes('XBUDS');
          return !bu || tu.includes(bu);
        });
        const exact = pool.filter((p) => compK(`${p.brand || ''} ${p.model || ''}`) === ce || compK(p.name) === ce);
        if (exact.length) return exact;
        const words = tk.split(' ').filter((w) => w && !/^\d+_\d+$/.test(w) && !['poco', 'oppo', 'infinix', 'anker', 'tecno', 'realme', 'itel', '5g', '4g', 'bt', 'limited'].includes(w));
        if (!words.length) return [];
        return pool.filter((p) => {
          const pk = normK(`${p.brand || ''} ${p.model || ''} ${p.name || ''}`);
          const pw = new Set(pk.split(' '));
          const pr = pk.match(/\b\d+_\d+\b/g) || [];
          if (rr.length) { for (const r of rr) if (!pr.includes(r)) return false; } else if (pr.length) return false;
          if (/KEYBOARD|CASE|PENCIL/i.test(modelName)) {
            const extra = pk.split(' ').filter((w) => w && !['infinix', 'oppo', 'poco', 'tecno', 'bt', 'bluetooth', 'keyboard', 'case'].includes(w) && !words.includes(w));
            if (extra.some((w) => /\d/.test(w))) return false;
          }
          return words.every((w) => pw.has(w));
        });
      };

      const rawEntries = Array.isArray(seedSnapshot.ab_supplier_catalog) ? seedSnapshot.ab_supplier_catalog : [];
      const coveredBrands = new Set(rawEntries.map((r) => String(r.brand || '').toUpperCase()).filter(Boolean));
      const matchedIds = new Set();
      const entries = rawEntries.map((r) => {
        const isAvail = r.is_available === undefined ? true : Boolean(r.is_available);
        const hits = isAvail ? matchEntry(r.brand, r.model_name) : [];
        const matchedProd = hits[0] || (r.matched_product_id ? inventoryItems.find((it) => it.id === r.matched_product_id) : null);
        if (isAvail) {
          for (const p of hits) {
            matchedIds.add(p.id);
            p.cost_ab = Number(r.dp_cost) || p.cost_ab;
            p.supplier_missing_since = '';
            p.last_supplier_seen_at = r.stock_date || todayIso;
            if (p.lifecycle_status === 'Subject to Phaseout') p.lifecycle_status = 'Active';
          }
        }
        const totalAvail = matchedProd
          ? BRANCHES.reduce((s, b) => s + (matchedProd.byBranch?.[b.id]?.qtyAvailable || 0), 0)
          : 0;
        return {
          id: r.id,
          brand: r.brand,
          category: r.category,
          modelName: r.model_name,
          dpCost: Number(r.dp_cost) || 0,
          colorsNotes: r.colors_notes || '',
          matchedProductId: hits[0]?.id || r.matched_product_id || '',
          stockDate: r.stock_date || '',
          isAvailable: isAvail,
          updatedAt: r.updated_at || '',
          productName: matchedProd?.name || '',
          productSku: matchedProd?.sku || '',
          basePrice: Number(matchedProd?.base_price) || 0,
          costPrice: Number(matchedProd?.cost_price) || 0,
          costAb: matchedProd?.cost_ab ?? null,
          costAk: matchedProd?.cost_ak ?? null,
          costOnline: matchedProd?.cost_online ?? null,
          lifecycleStatus: matchedProd?.lifecycle_status || '',
          totalAvail,
        };
      });
      // Advance covered-brand missing products & 3-month auto-phaseout
      for (const p of inventoryItems) {
        if (matchedIds.has(p.id)) continue;
        if (p.lifecycle_status === 'Subject to Phaseout') {
          const ms = String(p.supplier_missing_since || '').trim() || todayIso;
          p.supplier_missing_since = ms;
          if (has3Mo(ms)) p.lifecycle_status = 'Phaseout / Do Not Reorder';
        } else if (p.lifecycle_status === 'Active' && coveredBrands.size) {
          const pTextU = `${String(p.brand || '').toUpperCase()} ${String(p.name || '').toUpperCase()}`;
          const isCovered = [...coveredBrands].some((bu) => (bu === 'ANKER' ? pTextU.includes('ANKER') || pTextU.includes('SOUNDCORE') : bu === 'INFINIX' ? pTextU.includes('INFINIX') || pTextU.includes('XPAD') || pTextU.includes('XBOOK') || pTextU.includes('GTBOOK') : pTextU.includes(bu)));
          const isExcluded = /\bREPO\b|\bREPAIRED\b|\bLDU\b|FREEBIE|FREE BUNDLE|\bFREE\b|\bDEMO\b/.test(pTextU);
          if (isCovered && !isExcluded) {
            const ms = String(p.supplier_missing_since || '').trim() || todayIso;
            p.supplier_missing_since = ms;
            p.lifecycle_status = has3Mo(ms) ? 'Phaseout / Do Not Reorder' : 'Subject to Phaseout';
          }
        }
      }
      const stockDate = entries.reduce((mx, e) => (e.stockDate && e.stockDate > mx ? e.stockDate : mx), '');
      return { stockDate, entries };
    })(),
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
