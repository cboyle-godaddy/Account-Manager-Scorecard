// Shared utilities loaded on every page

// ---- Theme ----
function isDarkMode() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  if (btn) btn.innerHTML = dark ? moonIcon() : sunIcon();
  document.dispatchEvent(new CustomEvent('themechange', { detail: { dark } }));
}

function sunIcon() {
  return `<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clip-rule="evenodd"/></svg>`;
}

function moonIcon() {
  return `<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/></svg>`;
}

function injectThemeToggle() {
  const inner = document.querySelector('.header-inner');
  if (!inner || document.getElementById('theme-toggle')) return;
  const btn = document.createElement('button');
  btn.id = 'theme-toggle';
  btn.className = 'theme-toggle-btn';
  const dark = isDarkMode();
  btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  btn.innerHTML = dark ? moonIcon() : sunIcon();
  btn.addEventListener('click', () => applyTheme(!isDarkMode()));
  // Insert before the back-link if present, otherwise append
  const backLink = inner.querySelector('.back-link');
  backLink ? inner.insertBefore(btn, backLink) : inner.appendChild(btn);
}

function getChartGridColor()  { return isDarkMode() ? '#334155' : '#f3f4f6'; }
function getChartTickColor()  { return isDarkMode() ? '#64748b' : '#9ca3af'; }
function getChartLineColor()  { return isDarkMode() ? 'rgba(34,184,74,0.15)' : 'rgba(26,158,63,0.12)'; }

const MONTHS_DISPLAY = {
  '01':'Jan','02':'Feb','03':'Mar','04':'Apr',
  '05':'May','06':'Jun','07':'Jul','08':'Aug',
  '09':'Sep','10':'Oct','11':'Nov','12':'Dec'
};

function formatMonthLabel(yyyymm) {
  const [y, m] = yyyymm.split('-');
  return `${MONTHS_DISPLAY[m]} ${y}`;
}

function formatCurrency(n, compact = false) {
  if (compact) {
    if (n >= 1000000) return `$${(n/1000000).toFixed(1)}M`;
    if (n >= 1000) return `$${(n/1000).toFixed(0)}k`;
    return `$${n}`;
  }
  return '$' + n.toLocaleString('en-US');
}

function formatPct(n, decimals = 1) {
  return n.toFixed(decimals) + '%';
}

// status thresholds: met ≥100%, at-risk ≥80%, not-met <80%
function getStatus(actual, target) {
  if (target <= 0) return 'met';
  const ratio = actual / target;
  if (ratio >= 1.0) return 'met';
  if (ratio >= 0.8) return 'at-risk';
  return 'not-met';
}

// For partial months: estimate full-month pace
function getPaceStatus(actual, target, daysCompleted, daysTotal) {
  if (daysCompleted <= 0 || daysTotal <= 0) return getStatus(actual, target);
  const projected = actual * (daysTotal / daysCompleted);
  return getStatus(projected, target);
}

function statusLabel(status) {
  const labels = {
    'met': 'Met',
    'at-risk': 'At Risk',
    'not-met': 'Not Met',
    'pace-ok': 'On Pace',
    'pace-risk': 'At Risk',
    'pace-behind': 'Behind',
  };
  return labels[status] || status;
}

function getQuarterForMonth(yyyymm) {
  const m = parseInt(yyyymm.split('-')[1]);
  const y = yyyymm.split('-')[0];
  const q = Math.ceil(m / 3);
  return `${y}-Q${q}`;
}

function getMonthsInQuarter(quarterStr) {
  const [y, qStr] = quarterStr.split('-Q');
  const q = parseInt(qStr);
  const startM = (q - 1) * 3 + 1;
  return [startM, startM + 1, startM + 2].map(m => `${y}-${String(m).padStart(2,'0')}`);
}

// Returns ordered list of available months from performance data
function getAvailableMonths(monthly) {
  return Object.keys(monthly).sort();
}

// Shared data loader: prefers localStorage upload over bundled JSON files
async function loadAppData() {
  const cached = localStorage.getItem('am_scorecard_data');
  if (cached) {
    try {
      const data = JSON.parse(cached);
      if (data.ams && data.perf) return [data.ams, data.perf, true];
    } catch (e) {
      localStorage.removeItem('am_scorecard_data');
    }
  }
  const [ams, perf] = await Promise.all([
    fetch('data/ams.json').then(r => r.json()),
    fetch('data/performance.json').then(r => r.json())
  ]);
  return [ams, perf, false];
}

// ---- Index page bootstrap ----
async function initPickerPage() {
  let ams, perf, fromUpload;
  try {
    [ams, perf, fromUpload] = await loadAppData();
  } catch (e) {
    document.querySelector('.picker-card').innerHTML =
      '<p style="color:red;text-align:center">Failed to load data. Make sure you are serving this over HTTP (not file://).</p>';
    return;
  }

  if (fromUpload) {
    const cached = JSON.parse(localStorage.getItem('am_scorecard_data'));
    const date = new Date(cached.uploaded_at).toLocaleDateString();
    const banner = document.getElementById('upload-data-banner');
    if (banner) {
      document.getElementById('upload-data-date').textContent = date;
      banner.style.display = 'flex';
    }
  }

  const amSelect = document.getElementById('am-select');
  ams.account_managers.forEach(am => {
    const opt = document.createElement('option');
    opt.value = am.id;
    opt.textContent = `${am.name} (${am.level})`;
    amSelect.appendChild(opt);
  });

  const monthSelect = document.getElementById('month-select');
  const months = getAvailableMonths(perf.monthly).reverse(); // newest first
  months.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    const isPartial = !!perf.monthly[m].working_days_completed;
    opt.textContent = formatMonthLabel(m) + (isPartial ? ' (MTD)' : '');
    monthSelect.appendChild(opt);
  });

  const viewBtn = document.getElementById('view-btn');

  function updateBtn() {
    viewBtn.disabled = !amSelect.value;
  }
  amSelect.addEventListener('change', updateBtn);

  viewBtn.addEventListener('click', () => {
    if (!amSelect.value) return;
    const params = new URLSearchParams({ am: amSelect.value, month: monthSelect.value });
    window.location.href = `scorecard.html?${params}`;
  });
}

// Inject toggle on every page as soon as DOM is ready
document.addEventListener('DOMContentLoaded', injectThemeToggle);

if (document.getElementById('am-select')) {
  initPickerPage();
}
