const BRAND_ORDER = [
  'infinix', 'tecno', 'realme', 'itel', 'redmi', 'vivo',
  'honor', 'samsung', 'nubia', 'zte', 'poco', 'oppo', 'apple',
];

const BRAND_THEMES = {
  infinix: { label: 'Infinix', accent: '#77e82a' },
  tecno:   { label: 'TECNO',   accent: '#3b82f6' },
  realme:  { label: 'realme',  accent: '#ffd600' },
  itel:    { label: 'itel',    accent: '#ff3355' },
  redmi:   { label: 'Redmi',   accent: '#ff6900' },
  vivo:    { label: 'vivo',    accent: '#60a5fa' },
  honor:   { label: 'HONOR',   accent: '#38bdf8' },
  samsung: { label: 'SAMSUNG', accent: '#3b82f6' },
  nubia:   { label: 'nubia',   accent: '#ef4444' },
  zte:     { label: 'ZTE',     accent: '#06b6d4' },
  poco:    { label: 'POCO',    accent: '#facc15' },
  oppo:    { label: 'oppo',    accent: '#10b981' },
  apple:   { label: 'Apple',   accent: '#f8fafc' },
};

const pubState = {
  branchSlug: '',
  data: null,
  selectedBrand: 'ALL',
  priceSort: 'asc',
};

function fmtCurrency(n) {
  return '₱' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtNum(n) {
  return (Number(n) || 0).toLocaleString('en-PH');
}

function suggestedDownPayment(price) {
  const p = Number(price) || 0;
  if (p <= 0) return 0;
  if (p <= 3999) return 500;
  if (p <= 5999) return 600;
  if (p <= 6999) return 700;
  if (p <= 7999) return 800;
  if (p <= 8999) return 900;
  if (p <= 10999) return 1000;
  if (p <= 12999) return 2000;
  if (p <= 14999) return 3000;
  if (p <= 16999) return 4000;
  if (p <= 19999) return 5000;
  return Math.round(p * 0.5);
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
  if (slashMatch) return `${slashMatch[1]}/${slashMatch[2]}GB`;
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
  return romMatch ? `${romMatch[1]}GB` : '';
}

function resolveBranchSlug() {
  const pathParts = window.location.pathname.toLowerCase().split('/').filter(Boolean);
  for (const b of ['molave', 'tambulig', 'bonifacio']) {
    if (pathParts.includes(b)) return b;
  }
  const params = new URLSearchParams(window.location.search);
  return (params.get('branch') || 'molave').toLowerCase();
}

function renderPublicCatalog() {
  if (!pubState.data) return;
  const { branch, catalog, installmentRates } = pubState.data;

  const searchQ = (document.getElementById('pubSearchInput').value || '').trim().toLowerCase();
  const pType = document.getElementById('pubProductType').value;
  const priceRangeVal = document.getElementById('pubPriceRange').value;
  const ramRomEl = document.getElementById('pubRamRom');

  if (pType === 'Accessories') {
    ramRomEl.classList.add('hidden');
    ramRomEl.value = 'ALL';
  } else {
    ramRomEl.classList.remove('hidden');
    const prevVal = ramRomEl.value || 'ALL';
    const specsSet = new Set();
    catalog.forEach((item) => {
      if (item.productType !== 'Cellphones') return;
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

  let minPrice = 0;
  let maxPrice = Infinity;
  if (priceRangeVal && priceRangeVal !== 'ALL') {
    const [lo, hi] = priceRangeVal.split('-').map(Number);
    if (Number.isFinite(lo)) minPrice = lo;
    if (Number.isFinite(hi)) maxPrice = hi;
  }
  const selectedRamRom = pType !== 'Accessories' ? ramRomEl.value : 'ALL';
  const asc = pubState.priceSort !== 'desc';
  document.getElementById('pubPriceSortBtn').textContent = asc ? 'Price ↑' : 'Price ↓';

  const filtered = catalog
    .filter((item) => {
      if (pType !== 'ALL' && item.productType !== pType) return false;
      if (searchQ && !`${item.brand} ${item.model}`.toLowerCase().includes(searchQ)) return false;
      const price = Number(item.basePrice) || 0;
      if (priceRangeVal !== 'ALL' && (price < minPrice || price > maxPrice)) return false;
      if (selectedRamRom !== 'ALL' && extractRamRom(item.model, item.brand) !== selectedRamRom) return false;
      return true;
    })
    .sort((a, b) => {
      const diff = (Number(a.basePrice) || 0) - (Number(b.basePrice) || 0);
      return (asc ? diff : -diff) || a.model.localeCompare(b.model);
    });

  document.getElementById('pubCatalogMeta').textContent = `${branch.name} Branch • ${fmtNum(filtered.length)} available model(s)`;

  const groups = new Map();
  for (const item of filtered) {
    const b = item.brand || 'Other';
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(item);
  }
  const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
    const ra = BRAND_ORDER.indexOf(a[0].toLowerCase());
    const rb = BRAND_ORDER.indexOf(b[0].toLowerCase());
    const oa = ra < 0 ? BRAND_ORDER.length : ra;
    const ob = rb < 0 ? BRAND_ORDER.length : rb;
    return oa - ob || a[0].localeCompare(b[0]);
  });

  const strip = document.getElementById('pubBrandStrip');
  const grid = document.getElementById('pubCatalogGrid');

  if (!groups.size) {
    strip.classList.add('hidden');
    grid.innerHTML = '<div class="muted small">No available units match this filter in this branch.</div>';
    return;
  }

  if (pubState.selectedBrand !== 'ALL' && !groups.has(pubState.selectedBrand)) {
    pubState.selectedBrand = 'ALL';
  }
  const activeBrand = pubState.selectedBrand;

  strip.classList.remove('hidden');
  strip.innerHTML = [
    `<button type="button" class="shopee-brand-chip ${activeBrand === 'ALL' ? 'active' : ''}" data-brand="ALL">All (${fmtNum(filtered.length)})</button>`,
    ...sortedGroups.map(([b, list]) => {
      const t = BRAND_THEMES[b.toLowerCase()] || { label: b };
      return `<button type="button" class="shopee-brand-chip ${activeBrand === b ? 'active' : ''}" data-brand="${b}">${t.label} (${fmtNum(list.length)})</button>`;
    }),
  ].join('');
  strip.querySelectorAll('.shopee-brand-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      pubState.selectedBrand = chip.dataset.brand;
      renderPublicCatalog();
    });
  });

  const displayItems = activeBrand === 'ALL' ? filtered : (groups.get(activeBrand) || []);
  const cashPct = branch.cash_discount_pct ?? (/bonifacio/i.test(branch.name) ? 3 : 5);

  grid.innerHTML = displayItems
    .map((item) => {
      const theme = BRAND_THEMES[(item.brand || '').toLowerCase()] || { label: item.brand || '', accent: '#e7c55f' };
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
            <span class="shopee-badge-brand" style="color:${theme.accent};">${theme.label}</span>
            <span class="shopee-badge-avail">Available</span>
            ${installBanner}
          </div>
          <div class="shopee-body">
            <div class="shopee-title"><span class="logo-branch-pill"><img src="../ab-logo-square.png" alt="Logo" class="shopee-mall-logo" /><span>${branch.name}</span></span>${item.model}</div>
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
}

// Installment & Cash Calculator Modal + Photo Lightbox
const calcModalState = { item: null, branch: null, rates: [], photos: [], photoIdx: 0, selectedMonths: null };

function computeInstallmentPlan(srp, dp, months, monthlyRate) {
  const balance = Math.max(0, srp - dp);
  const rawMonthly = (balance + balance * monthlyRate * months) / months;
  const monthlyAmortization = Math.ceil((rawMonthly - 1e-9) / 5) * 5;
  const rebate = Math.round(monthlyAmortization * 0.025);
  const onTimePayment = monthlyAmortization - rebate;
  const totalInstallments = monthlyAmortization * months;
  const totalContractPrice = dp + totalInstallments;
  const totalWithRebates = dp + onTimePayment * months;
  return { months, dp, monthlyAmortization, onTimePayment, totalContractPrice, totalWithRebates };
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
  if (!plan) { box.classList.add('hidden'); box.innerHTML = ''; return; }
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
  if (!calcModalState.selectedMonths || !rates.some((r) => r.months === calcModalState.selectedMonths)) {
    calcModalState.selectedMonths = rates[0]?.months || 4;
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
  renderCalcBreakdown(plans.find((p) => p.months === calcModalState.selectedMonths) || plans[0]);
}

function openCustomerCalcModal(item, branch, installmentRates) {
  const modal = document.getElementById('customerCalcModal');
  const srp = Number(item.basePrice) || 0;
  const minDp = suggestedDownPayment(srp);
  const cashDiscountPct = branch.cash_discount_pct ?? (/bonifacio/i.test(branch.name) ? 3 : 5);
  calcModalState.item = item;
  calcModalState.branch = branch;
  calcModalState.rates = installmentRates || [];
  calcModalState.photos = Array.isArray(item.imageUrls) && item.imageUrls.length
    ? item.imageUrls
    : (item.imageUrl ? [item.imageUrl] : []);
  calcModalState.photoIdx = 0;
  calcModalState.selectedMonths = 4;

  document.getElementById('calcModalTitle').textContent = `${item.brand ? item.brand + ' ' : ''}${item.model}`;
  document.getElementById('calcModalSub').textContent = `${branch.name} • Available`;
  document.getElementById('calcSrpText').textContent = fmtCurrency(srp);
  document.getElementById('calcCashText').textContent = `${fmtCurrency(item.cashPrice)} (${cashDiscountPct}% off)`;
  document.getElementById('calcMinDpText').textContent = `Min DP: ${fmtCurrency(minDp)}`;

  const dpInput = document.getElementById('calcDpInput');
  dpInput.value = fmtNum(minDp);

  renderCalcModalPhoto();
  renderCalcTerms();
  modal.classList.remove('hidden');
}

const lightboxState = { scale: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0, pinchDist: 0, pinchScale: 1 };
function applyLightboxTransform() {
  const wrap = document.getElementById('lightboxMediaWrap');
  const img = document.getElementById('lightboxImg');
  if (lightboxState.scale <= 1) { lightboxState.scale = 1; lightboxState.tx = 0; lightboxState.ty = 0; }
  wrap.style.transform = `translate(${lightboxState.tx}px, ${lightboxState.ty}px) scale(${lightboxState.scale})`;
  img.style.cursor = lightboxState.scale > 1 ? 'grab' : 'zoom-in';
  document.getElementById('lightboxZoomPct').textContent = `${Math.round(lightboxState.scale * 100)}%`;
}
function setLightboxZoom(nextScale) {
  lightboxState.scale = Math.min(4, Math.max(1, nextScale));
  applyLightboxTransform();
}
function renderLightboxPhoto() {
  const photos = calcModalState.photos || [];
  if (!photos.length) return;
  document.getElementById('lightboxImg').src = photos[calcModalState.photoIdx];
  document.getElementById('lightboxCount').textContent = photos.length > 1 ? `Photo ${calcModalState.photoIdx + 1} of ${photos.length}` : '1 photo';
  document.getElementById('lightboxPrev').classList.toggle('hidden', photos.length <= 1);
  document.getElementById('lightboxNext').classList.toggle('hidden', photos.length <= 1);
  lightboxState.scale = 1; lightboxState.tx = 0; lightboxState.ty = 0;
  applyLightboxTransform();
}
function openPhotoLightbox() {
  if (!calcModalState.photos?.length) return;
  const item = calcModalState.item;
  document.getElementById('lightboxTitle').textContent = item ? `${item.brand ? item.brand + ' ' : ''}${item.model}` : 'Photo';
  renderLightboxPhoto();
  document.getElementById('photoLightboxModal').classList.remove('hidden');
}

document.getElementById('closeCalcModalBtn').addEventListener('click', () => document.getElementById('customerCalcModal').classList.add('hidden'));
document.getElementById('customerCalcModal').addEventListener('click', (e) => {
  if (e.target.id === 'customerCalcModal') document.getElementById('customerCalcModal').classList.add('hidden');
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
document.getElementById('calcModalImg').addEventListener('click', openPhotoLightbox);
document.getElementById('calcZoomBtn').addEventListener('click', openPhotoLightbox);
document.getElementById('closeLightboxBtn').addEventListener('click', () => document.getElementById('photoLightboxModal').classList.add('hidden'));
document.getElementById('lightboxZoomIn').addEventListener('click', () => setLightboxZoom(lightboxState.scale + 0.5));
document.getElementById('lightboxZoomOut').addEventListener('click', () => setLightboxZoom(lightboxState.scale - 0.5));
document.getElementById('lightboxZoomReset').addEventListener('click', () => setLightboxZoom(1));
document.getElementById('lightboxPrev').addEventListener('click', (e) => {
  e.stopPropagation();
  calcModalState.photoIdx = (calcModalState.photoIdx - 1 + calcModalState.photos.length) % calcModalState.photos.length;
  renderCalcModalPhoto(); renderLightboxPhoto();
});
document.getElementById('lightboxNext').addEventListener('click', (e) => {
  e.stopPropagation();
  calcModalState.photoIdx = (calcModalState.photoIdx + 1) % calcModalState.photos.length;
  renderCalcModalPhoto(); renderLightboxPhoto();
});
const lbStage = document.getElementById('lightboxStage');
const lbImg = document.getElementById('lightboxImg');
lbStage.addEventListener('click', (e) => { if (e.target === lbStage) document.getElementById('photoLightboxModal').classList.add('hidden'); });
lbImg.addEventListener('dblclick', (e) => { e.preventDefault(); setLightboxZoom(lightboxState.scale > 1.1 ? 1 : 2.2); });
lbStage.addEventListener('wheel', (e) => { e.preventDefault(); setLightboxZoom(lightboxState.scale + (e.deltaY < 0 ? 0.25 : -0.25)); }, { passive: false });
lbImg.addEventListener('mousedown', (e) => {
  if (lightboxState.scale <= 1) return;
  lightboxState.dragging = true; lightboxState.startX = e.clientX - lightboxState.tx; lightboxState.startY = e.clientY - lightboxState.ty;
});
window.addEventListener('mousemove', (e) => {
  if (!lightboxState.dragging) return;
  lightboxState.tx = e.clientX - lightboxState.startX; lightboxState.ty = e.clientY - lightboxState.startY; applyLightboxTransform();
});
window.addEventListener('mouseup', () => { lightboxState.dragging = false; });
let lbSwipeStartX = null;
lbStage.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    lightboxState.pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    lightboxState.pinchScale = lightboxState.scale; lightboxState.dragging = false; lbSwipeStartX = null;
  } else if (e.touches.length === 1 && lightboxState.scale > 1) {
    lightboxState.dragging = true; lightboxState.startX = e.touches[0].clientX - lightboxState.tx; lightboxState.startY = e.touches[0].clientY - lightboxState.ty; lbSwipeStartX = null;
  } else if (e.touches.length === 1) {
    lbSwipeStartX = e.touches[0].clientX;
  }
}, { passive: true });
lbStage.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && lightboxState.pinchDist > 0) {
    e.preventDefault();
    const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    setLightboxZoom(lightboxState.pinchScale * (dist / lightboxState.pinchDist));
  } else if (e.touches.length === 1 && lightboxState.dragging) {
    e.preventDefault();
    lightboxState.tx = e.touches[0].clientX - lightboxState.startX; lightboxState.ty = e.touches[0].clientY - lightboxState.startY; applyLightboxTransform();
  }
}, { passive: false });
lbStage.addEventListener('touchend', (e) => {
  if (lbSwipeStartX !== null && lightboxState.scale <= 1 && calcModalState.photos.length > 1 && e.changedTouches?.length) {
    const dx = e.changedTouches[0].clientX - lbSwipeStartX;
    if (Math.abs(dx) > 40) {
      calcModalState.photoIdx = dx < 0
        ? (calcModalState.photoIdx + 1) % calcModalState.photos.length
        : (calcModalState.photoIdx - 1 + calcModalState.photos.length) % calcModalState.photos.length;
      renderCalcModalPhoto(); renderLightboxPhoto();
    }
  }
  lbSwipeStartX = null; lightboxState.dragging = false; lightboxState.pinchDist = 0;
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

const customCalcState = { selectedMonths: 4 };

function renderCustomCalcResults() {
  const rawSrp = document.getElementById('customSrpInput').value.trim();
  const dpInput = document.getElementById('customDpInput');
  const minDpHint = document.getElementById('customMinDpHint');
  const cashHint = document.getElementById('customCashHint');
  const errEl = document.getElementById('customCalcError');
  const grid = document.getElementById('customTermsGrid');
  const box = document.getElementById('customBreakdownBox');

  const isPreview = rawSrp === '';
  const srp = isPreview ? 10000 : parseCommaNum(rawSrp);

  if (!Number.isFinite(srp) || srp <= 0) {
    minDpHint.textContent = 'Suggested Min DP: —';
    cashHint.textContent = 'Cash Option: —';
    errEl.textContent = 'Enter a valid unit price.';
    errEl.classList.remove('hidden');
    return;
  }

  const branch = pubState.data?.branch;
  const cashPct = branch ? (branch.cash_discount_pct ?? (/bonifacio/i.test(branch.name) ? 3 : 5)) : 5;
  const cashPrice = Math.round(srp * (1 - cashPct / 100));
  const minDp = suggestedDownPayment(srp);

  dpInput.placeholder = fmtNum(minDp);
  minDpHint.textContent = isPreview
    ? `Example (₱10,000) • Suggested Min DP: ${fmtCurrency(minDp)}`
    : `Suggested Min DP: ${fmtCurrency(minDp)}`;
  cashHint.textContent = `Cash (${cashPct}% off): ${fmtCurrency(cashPrice)}`;

  const rawDp = dpInput.value.trim();
  const dpVal = rawDp === '' ? minDp : parseCommaNum(rawDp);
  if (!Number.isFinite(dpVal) || dpVal < minDp || dpVal >= srp) {
    errEl.textContent = `Down payment must be between ${fmtCurrency(minDp)} and ${fmtCurrency(Math.max(minDp, srp - 1))}.`;
    errEl.classList.remove('hidden');
    return;
  }
  errEl.classList.add('hidden');

  const rates = (pubState.data?.installmentRates || [
    { months: 4, monthly_rate: 0.09 },
    { months: 6, monthly_rate: 0.08 },
    { months: 9, monthly_rate: 0.067 },
    { months: 12, monthly_rate: 0.056 },
  ]).slice().sort((a, b) => a.months - b.months);

  if (!rates.some((r) => r.months === customCalcState.selectedMonths)) {
    customCalcState.selectedMonths = rates[0]?.months || 4;
  }

  const plans = rates.map((r) => computeInstallmentPlan(srp, dpVal, r.months, Number(r.monthly_rate) || 0));
  grid.innerHTML = plans
    .map((p) => {
      const active = p.months === customCalcState.selectedMonths;
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
      customCalcState.selectedMonths = Number(btn.dataset.months);
      renderCustomCalcResults();
    });
  });

  const plan = plans.find((p) => p.months === customCalcState.selectedMonths) || plans[0];
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

document.getElementById('openCustomCalcBtn').addEventListener('click', () => {
  const branch = pubState.data?.branch;
  document.getElementById('customCalcSub').textContent = branch
    ? `${branch.name} Branch • Tap price to edit`
    : 'Tap price to edit';
  const srpInput = document.getElementById('customSrpInput');
  const dpInput = document.getElementById('customDpInput');
  srpInput.value = '';
  dpInput.value = '';
  renderCustomCalcResults();
  document.getElementById('customPriceCalcModal').classList.remove('hidden');
});
document.getElementById('customSrpInput').addEventListener('focus', (e) => {
  if (e.target.value) e.target.select();
});
document.getElementById('customDpInput').addEventListener('focus', (e) => {
  if (e.target.value) e.target.select();
});
document.getElementById('closeCustomCalcBtn').addEventListener('click', () => {
  document.getElementById('customPriceCalcModal').classList.add('hidden');
});
document.getElementById('customPriceCalcModal').addEventListener('click', (e) => {
  if (e.target.id === 'customPriceCalcModal') {
    document.getElementById('customPriceCalcModal').classList.add('hidden');
  }
});
document.getElementById('customSrpInput').addEventListener('input', (e) => {
  formatCommaInput(e.target);
  const dpInput = document.getElementById('customDpInput');
  dpInput.value = '';
  renderCustomCalcResults();
});
document.getElementById('customDpInput').addEventListener('input', (e) => {
  formatCommaInput(e.target);
  renderCustomCalcResults();
});

document.getElementById('pubSearchInput').addEventListener('input', renderPublicCatalog);
document.getElementById('pubProductType').addEventListener('change', renderPublicCatalog);
document.getElementById('pubPriceRange').addEventListener('change', renderPublicCatalog);
document.getElementById('pubRamRom').addEventListener('change', renderPublicCatalog);
document.getElementById('pubPriceSortBtn').addEventListener('click', () => {
  pubState.priceSort = pubState.priceSort === 'desc' ? 'asc' : 'desc';
  renderPublicCatalog();
});

async function initPublicCatalog() {
  pubState.branchSlug = resolveBranchSlug();
  const res = await fetch(`../data/${encodeURIComponent(pubState.branchSlug)}.json?v=${Date.now()}`);
  if (!res.ok) {
    document.getElementById('pubBranchTitle').textContent = 'BRANCH NOT FOUND';
    document.getElementById('pubCatalogMeta').textContent = 'Please check the branch link (/molave/, /tambulig/, or /bonifacio/).';
    return;
  }
  const data = await res.json();
  pubState.data = data;
  document.title = `${data.branch.name} Catalog`;
  document.getElementById('pubBranchTitle').textContent = `${data.branch.name.toUpperCase()} CATALOG`;
  document.querySelectorAll('.pub-branch-label').forEach((el) => {
    el.textContent = data.branch.name;
  });
  renderPublicCatalog();
}

initPublicCatalog();
