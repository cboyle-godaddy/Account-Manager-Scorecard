// Upload page logic

let amsData, perfData, mergedPerfData;

async function initUploadPage() {
  try {
    [amsData, perfData] = await Promise.all([
      fetch('data/ams.json').then(r => r.json()),
      fetch('data/performance.json').then(r => r.json())
    ]);
  } catch (e) {
    showUploadError('Failed to load base data. Make sure you are serving over HTTP.');
    return;
  }

  checkActiveBanner();
  setupDropzone();
  document.getElementById('download-template-btn').addEventListener('click', generateTemplate);
  document.getElementById('clear-data-btn')?.addEventListener('click', clearData);
}

function checkActiveBanner() {
  const cached = localStorage.getItem('am_scorecard_data');
  if (!cached) return;
  try {
    const data = JSON.parse(cached);
    const date = new Date(data.uploaded_at).toLocaleString();
    const banner = document.getElementById('active-data-banner');
    document.getElementById('active-data-text').textContent =
      `Active: uploaded data from ${date} is being used in this browser.`;
    banner.style.display = 'flex';
  } catch (e) {
    localStorage.removeItem('am_scorecard_data');
  }
}

function clearData() {
  localStorage.removeItem('am_scorecard_data');
  document.getElementById('active-data-banner').style.display = 'none';
}

// ---- Drop zone ----
function setupDropzone() {
  const zone = document.getElementById('drop-zone');
  const input = document.getElementById('file-input');

  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drop-zone--active'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drop-zone--active'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drop-zone--active');
    handleFile(e.dataTransfer.files[0]);
  });
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', e => handleFile(e.target.files[0]));
}

function handleFile(file) {
  if (!file) return;
  hideUploadError();
  document.getElementById('preview-area').innerHTML = '';

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      parseWorkbook(wb);
    } catch (err) {
      showUploadError('Could not read file: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ---- Parsing ----
function parseWorkbook(wb) {
  const sheetName = wb.SheetNames.includes('Monthly Data') ? 'Monthly Data' : wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) { showUploadError('No usable sheet found. Please use the downloaded template.'); return; }

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) { showUploadError('Sheet appears empty.'); return; }

  const newMonthly = {};
  const errors = [];

  rows.forEach((row, i) => {
    const month   = String(row['Month'] ?? '').trim();
    const amName  = String(row['AM Name'] ?? '').trim();
    if (!month || !amName || month === 'Month') return; // skip header rows

    const am = amsData.account_managers.find(a => a.name === amName);
    if (!am) { errors.push(`Row ${i + 2}: AM name "${amName}" not found — check spelling`); return; }

    if (!newMonthly[month]) {
      newMonthly[month] = { working_days: num(row['Working Days in Month'], 22) };
      const wdc = num(row['Working Days Completed'], 0);
      if (wdc > 0) newMonthly[month].working_days_completed = wdc;
    }

    newMonthly[month][am.id] = {
      worked_days:          num(row['Worked Days'], newMonthly[month].working_days),
      ca:                   num(row['CA'], 0),
      pc_unique_accounts:   num(row['PC Unique Accounts'], 0),
      oc:                   num(row['OC'], 0),
      igcr:                 num(row['iGCR ($)'], 0),
      portfolio_gcr_actual: num(row['Portfolio GCR Actual ($)'], 0),
      ent:                  num(row['Enterprise'], 0),
      mm:                   num(row['Mid-Market'], 0),
      corp:                 num(row['Corporate'], 0),
      other:                num(row['Other'], 0),
    };
  });

  if (errors.length) { showUploadError(errors.join('\n')); return; }
  if (!Object.keys(newMonthly).length) { showUploadError('No valid rows found. Check the Month and AM Name columns.'); return; }

  // Parse optional Quarterly PC sheet
  const newQuarterly = {};
  if (wb.Sheets['Quarterly PC']) {
    const qRows = XLSX.utils.sheet_to_json(wb.Sheets['Quarterly PC'], { defval: '' });
    qRows.forEach(row => {
      const quarter = String(row['Quarter'] ?? '').trim();
      const amName  = String(row['AM Name'] ?? '').trim();
      const ua      = num(row['Unique Accounts (Quarterly)'], 0);
      if (!quarter || !amName || !ua) return;
      const am = amsData.account_managers.find(a => a.name === amName);
      if (!am) return;
      if (!newQuarterly[quarter]) {
        newQuarterly[quarter] = {};
        if (String(row['Is Partial?']).toLowerCase() === 'yes') newQuarterly[quarter]._partial = true;
      }
      newQuarterly[quarter][am.id] = { unique_accounts: ua };
    });
  }

  // Merge new data over existing
  mergedPerfData = {
    ...perfData,
    monthly:      { ...perfData.monthly, ...newMonthly },
    quarterly_pc: { ...perfData.quarterly_pc, ...newQuarterly },
  };

  showPreview(newMonthly);
}

function num(val, fallback) {
  const n = parseInt(String(val).replace(/[$,]/g, ''), 10);
  return isNaN(n) ? fallback : n;
}

// ---- Preview ----
function showPreview(newMonthly) {
  const months = Object.keys(newMonthly).sort().reverse();
  const ams    = amsData.account_managers;

  let rows = '';
  months.forEach(m => {
    ams.forEach(am => {
      const d = newMonthly[m]?.[am.id];
      if (!d) return;
      rows += `<tr>
        <td>${formatMonthLabel(m)}</td>
        <td>${am.name}</td>
        <td>${d.ca}</td>
        <td>${d.pc_unique_accounts}</td>
        <td>${d.oc}</td>
        <td>${formatCurrency(d.igcr, true)}</td>
        <td>${formatCurrency(d.portfolio_gcr_actual, true)}</td>
      </tr>`;
    });
  });

  document.getElementById('preview-area').innerHTML = `
    <div class="upload-preview-card">
      <div class="upload-preview-header">
        <span class="upload-preview-title">Preview — ${months.length} month${months.length !== 1 ? 's' : ''} detected</span>
        <span class="upload-preview-note">Review before applying</span>
      </div>
      <div class="table-wrapper" style="margin-bottom:16px;">
        <table class="summary-table">
          <thead><tr>
            <th>Month</th><th>AM</th><th>CA</th><th>PC Unique</th>
            <th>OC</th><th>iGCR</th><th>Portfolio GCR</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="upload-preview-actions">
        <button id="apply-btn" class="btn btn-primary">Apply to This Browser</button>
        <button id="cancel-btn" class="btn btn-secondary-outline">Cancel</button>
      </div>
    </div>
  `;

  document.getElementById('apply-btn').addEventListener('click', applyData);
  document.getElementById('cancel-btn').addEventListener('click', () => {
    document.getElementById('preview-area').innerHTML = '';
    mergedPerfData = null;
  });
}

function applyData() {
  if (!mergedPerfData) return;
  localStorage.setItem('am_scorecard_data', JSON.stringify({
    uploaded_at: new Date().toISOString(),
    ams:  amsData,
    perf: mergedPerfData,
  }));

  // Show download JSON option
  document.getElementById('download-json-pending').style.display = 'none';
  document.getElementById('download-json-area').style.display = 'block';
  document.getElementById('download-json-btn').addEventListener('click', downloadJSON);

  // Update active banner
  checkActiveBanner();
  document.getElementById('preview-area').innerHTML = `
    <div class="upload-success-banner">
      <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
      <span>Data applied! <a href="index.html">Go to scorecards →</a></span>
    </div>
  `;
}

function downloadJSON() {
  if (!mergedPerfData) return;
  const blob = new Blob([JSON.stringify(mergedPerfData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'performance.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- Template generation ----
function generateTemplate() {
  const wb = XLSX.utils.book_new();

  // ---- Monthly Data sheet ----
  const now   = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const amNames = amsData.account_managers.map(a => a.name);

  const headers = [
    'Month', 'AM Name', 'Worked Days', 'Working Days in Month',
    'Working Days Completed (partial months only — leave blank if complete)',
    'CA', 'PC Unique Accounts', 'OC', 'iGCR ($)', 'Portfolio GCR Actual ($)',
    'Enterprise', 'Mid-Market', 'Corporate', 'Other'
  ];

  const monthlyRows = [headers];
  amNames.forEach(name => {
    monthlyRows.push([month, name, '', 21, '', '', '', '', '', '', '', '', '', '']);
  });

  const monthlySheet = XLSX.utils.aoa_to_sheet(monthlyRows);
  // Column widths
  monthlySheet['!cols'] = [
    {wch:10},{wch:22},{wch:13},{wch:22},{wch:45},
    {wch:8},{wch:20},{wch:8},{wch:12},{wch:24},
    {wch:12},{wch:13},{wch:12},{wch:10}
  ];
  XLSX.utils.book_append_sheet(wb, monthlySheet, 'Monthly Data');

  // ---- Quarterly PC sheet ----
  const qHeaders = ['Quarter', 'AM Name', 'Unique Accounts (Quarterly)', 'Is Partial? (yes/no)'];
  const currentQ = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
  const qRows = [qHeaders];
  amNames.forEach(name => qRows.push([currentQ, name, '', 'yes']));
  const qSheet = XLSX.utils.aoa_to_sheet(qRows);
  qSheet['!cols'] = [{wch:12},{wch:22},{wch:28},{wch:20}];
  XLSX.utils.book_append_sheet(wb, qSheet, 'Quarterly PC');

  // ---- Instructions sheet ----
  const instructions = [
    ['AM Scorecard — Data Upload Instructions'],
    [''],
    ['MONTHLY DATA sheet'],
    ['Month',           'Format: YYYY-MM  (e.g. 2026-05)'],
    ['AM Name',         'Must match exactly: ' + amNames.join(', ')],
    ['Worked Days',     'Actual days the AM worked (after approved time off)'],
    ['Working Days in Month', 'Total working days in that month (typ. 20-23)'],
    ['Working Days Completed', 'Only fill in for the current in-progress month. Leave blank for complete months.'],
    ['CA',              'Completed Activities (calls + emails + tasks + meetings + cases)'],
    ['PC Unique Accounts', 'Number of unique portfolio accounts with at least one activity'],
    ['OC',              'Opportunities Created in Salesforce'],
    ['iGCR ($)',        'Cumulative Closed Won opportunity value for the month'],
    ['Portfolio GCR Actual ($)', 'Actual portfolio GCR from portfolio performance report'],
    ['Enterprise / Mid-Market / Corporate / Other', 'Account counts by segment (should sum to ~portfolio size)'],
    [''],
    ['QUARTERLY PC sheet'],
    ['Quarter',         'Format: YYYY-QN  (e.g. 2026-Q2)'],
    ['Unique Accounts', 'Deduplicated count of unique accounts touched across all 3 months of the quarter'],
    ['Is Partial?',     'Enter "yes" if the quarter is still in progress, "no" if complete'],
    [''],
    ['TIPS'],
    ['- You can include multiple months in one upload — just add more rows'],
    ['- Existing months in the app will be replaced by what you upload'],
    ['- After uploading, use "Download Updated performance.json" to share with the whole team via GitHub'],
  ];
  const instrSheet = XLSX.utils.aoa_to_sheet(instructions);
  instrSheet['!cols'] = [{wch:42},{wch:80}];
  XLSX.utils.book_append_sheet(wb, instrSheet, 'Instructions');

  XLSX.writeFile(wb, 'AM_Scorecard_Template.xlsx');
}

// ---- Helpers ----
function showUploadError(msg) {
  const el = document.getElementById('upload-error');
  el.textContent = msg;
  el.style.display = 'block';
}
function hideUploadError() {
  document.getElementById('upload-error').style.display = 'none';
}

if (document.getElementById('drop-zone')) {
  initUploadPage();
}
