// Shared utilities loaded on every page

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

if (document.getElementById('am-select')) {
  initPickerPage();
}
