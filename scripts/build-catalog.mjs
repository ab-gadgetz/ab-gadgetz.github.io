import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import seedSnapshot from '../seedSnapshot.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');
const distDir = path.join(rootDir, 'dist');

const BRANCHES = [
  { id: 'br-molave', slug: 'molave', name: 'Molave', cash_discount_pct: 5, portalId: 23 },
  { id: 'br-tambulig', slug: 'tambulig', name: 'Tambulig', cash_discount_pct: 5, portalId: 44 },
  { id: 'br-bonifacio', slug: 'bonifacio', name: 'Bonifacio', cash_discount_pct: 3, portalId: 32 },
];

async function loginAndFetchPortal(username, password) {
  const baseUrl = 'https://app.abgadgetz.com.ph';
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }).toString(),
    redirect: 'manual',
  });
  const setCookies = loginRes.headers.getSetCookie?.() || [];
  const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
  if (!cookieHeader) {
    throw new Error(`Portal login failed (HTTP ${loginRes.status})`);
  }

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  const result = new Map();
  for (const b of BRANCHES) {
    const url = `${baseUrl}/panel/stocks/branch_monthly_inventory/${b.portalId}/${year}/${month}`;
    const res = await fetch(url, { headers: { Cookie: cookieHeader } });
    if (!res.ok) throw new Error(`Portal fetch failed for ${b.name}: HTTP ${res.status}`);
    const html = await res.text();
    const rows = [];
    for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
        m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+\n/g, '\n').trim()
      );
      if (tds.length < 7) continue;
      const lines = tds[1].split('\n').map((s) => s.trim()).filter(Boolean);
      const itemCode = (lines[1] || '').trim();
      const unitPrice = Number(tds[3].replace(/[^0-9.]/g, '')) || 0;
      const available = parseInt(tds[4].replace(/[^0-9-]/g, ''), 10) || 0;
      if (itemCode) rows.push({ itemCode, unitPrice, available });
    }
    result.set(b.id, rows);
  }
  return result;
}

async function main() {
  const products = seedSnapshot.products.map((p) => ({ ...p }));
  const invMap = new Map(seedSnapshot.branch_inventory.map((r) => [`${r.branch_id}::${r.product_id}`, { ...r }]));
  const ruleMap = new Map(seedSnapshot.customer_catalog_rules.map((r) => [`${r.customer_id}::${r.product_id}`, Boolean(r.is_visible)]));

  const codeToProduct = new Map();
  for (const p of products) {
    const codes = String(p.website_codes || p.sku || '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
    for (const c of codes) codeToProduct.set(c, p);
  }

  const user = process.env.PORTAL_USERNAME;
  const pass = process.env.PORTAL_PASSWORD;
  if (user && pass) {
    try {
      const liveData = await loginAndFetchPortal(user, pass);
      for (const [branchId, rows] of liveData.entries()) {
        const totals = new Map();
        for (const row of rows) {
          const prod = codeToProduct.get(row.itemCode.toUpperCase());
          if (!prod) continue;
          totals.set(prod.id, (totals.get(prod.id) || 0) + Math.max(0, row.available));
          if (row.unitPrice > 0 && (!prod.base_price || prod.base_price <= 0)) {
            prod.base_price = row.unitPrice;
          }
        }
        for (const [pid, qty] of totals.entries()) {
          invMap.set(`${branchId}::${pid}`, { branch_id: branchId, product_id: pid, qty_on_hand: qty, qty_reserved: 0 });
        }
      }
      console.log('Live portal sync succeeded.');
    } catch (err) {
      console.warn('Live portal sync skipped/failed, using snapshot:', err.message);
    }
  } else {
    console.log('No PORTAL_USERNAME/PORTAL_PASSWORD provided; building from snapshot.');
  }

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(distDir, 'data'), { recursive: true });

  for (const file of ['styles.css', 'catalog.js', 'ab-logo.png', 'ab-logo-square.png']) {
    fs.copyFileSync(path.join(publicDir, file), path.join(distDir, file));
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
      if (branchAvailable <= 0) continue;
      const imageUrls = String(p.image_urls || '').split(/[|\r\n]+/).map((u) => u.trim()).filter(Boolean);
      catalog.push({
        productId: p.id,
        brand: p.brand,
        model: p.model || p.name,
        name: p.name,
        productType: p.product_type || 'Cellphones',
        basePrice: p.base_price,
        cashPrice: Math.round(p.base_price * (1 - discountRate)),
        imageUrl: imageUrls[0] || '',
        imageUrls,
        branchAvailable,
      });
    }

    const payload = {
      branch: { id: b.id, name: b.name, cash_discount_pct: b.cash_discount_pct },
      catalog,
      installmentRates: seedSnapshot.installment_settings,
      syncedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(distDir, 'data', `${b.slug}.json`), JSON.stringify(payload));
    const branchDir = path.join(distDir, b.slug);
    fs.mkdirSync(branchDir, { recursive: true });
    fs.writeFileSync(path.join(branchDir, 'index.html'), rawHtml);
    console.log(`Built ${b.name}: ${catalog.length} available models`);
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
