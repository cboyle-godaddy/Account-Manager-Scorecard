// Manager view page logic

let mgrAMs, mgrPerf, mgrCurrentMonth;

async function initManagerPage() {
  let fromUpload;
  try {
    [mgrAMs, mgrPerf, fromUpload] = await loadAppData();
  } catch (e) {
    document.querySelector('.manager-main').innerHTML =
      '<p style="color:red;padding:24px">Failed to load data. Serve over HTTP (e.g. <code>npx serve .</code>).</p>';
    return;
  }

  const sel = document.getElementById('mgr-month-select');
  const months = getAvailableMonths(mgrPerf.monthly).reverse();
  months.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    const isPartial = !!mgrPerf.monthly[m].working_days_completed;
    opt.textContent = formatMonthLabel(m) + (isPartial ? ' (MTD)' : '');
    sel.appendChild(opt);
  });
  mgrCurrentMonth = months[0];

  render();

  sel.addEventListener('change', e => {
    mgrCurrentMonth = e.target.value;
    render();
  });
}

function render() {
  const isPartial = !!mgrPerf.monthly[mgrCurrentMonth]?.working_days_completed;
  document.getElementById('rollup-month-label').textContent =
    '— ' + formatMonthLabel(mgrCurrentMonth) + (isPartial ? ' (MTD)' : '');
  renderRollupTiles();
  renderTeamTable();
}

// ---- Metric calculation ----

function getPaceStatusNorm(actual, target, daysCompleted, daysTotal) {
  if (daysCompleted <= 0 || daysTotal <= 0) return getStatus(actual, target);
  const projected = actual * (daysTotal / daysCompleted);
  return getStatus(projected, target);
}

function getAMMetrics(am, month) {
  const monthData = mgrPerf.monthly[month];
  if (!monthData) return null;
  const d = monthData[am.id];
  if (!d) return null;

  const isPartial = !!monthData.working_days_completed;
  const daysCompleted = monthData.working_days_completed || monthData.working_days;
  const daysTotal = monthData.working_days;
  const workedDays = d.worked_days;

  const proratedCA = 300 * (workedDays / daysTotal);
  const proratedOC = 25  * (workedDays / daysTotal);
  const pcPct = (d.pc_unique_accounts / am.portfolio_size) * 100;

  const caStatus  = isPartial ? getPaceStatusNorm(d.ca,  proratedCA,           daysCompleted, daysTotal) : getStatus(d.ca,  proratedCA);
  const pcStatus  = isPartial ? getPaceStatusNorm(pcPct, 25,                   daysCompleted, daysTotal) : getStatus(pcPct, 25);
  const ocStatus  = isPartial ? getPaceStatusNorm(d.oc,  proratedOC,           daysCompleted, daysTotal) : getStatus(d.oc,  proratedOC);

  // Rolling 3-month iGCR
  const allMonths  = getAvailableMonths(mgrPerf.monthly);
  const idx        = allMonths.indexOf(month);
  const rollingMs  = allMonths.slice(Math.max(0, idx - 2), idx + 1);
  const rollingIGCR = rollingMs.reduce((s, m) => s + (mgrPerf.monthly[m]?.[am.id]?.igcr || 0), 0);
  const igcrStatus = getStatus(rollingIGCR, 30000);

  // Portfolio GCR — prefer per-month uploaded goal over static ams.json goal
  const gcrGoal = d.portfolio_gcr_goal || am.portfolio_gcr_goal;
  const gcrPct  = gcrGoal > 0 ? (d.portfolio_gcr_actual / gcrGoal) * 100 : 0;
  const gcrStatus = getStatus(gcrPct, 100);

  const allStatuses = [caStatus, pcStatus, ocStatus, igcrStatus, gcrStatus];
  const overall = allStatuses.every(s => s === 'met') ? 'met'
    : allStatuses.some(s => s === 'not-met') ? 'not-met'
    : 'at-risk';

  return {
    d, isPartial,
    caStatus, pcStatus, ocStatus, igcrStatus, gcrStatus, overall,
    ca: d.ca, pcPct, oc: d.oc, rollingIGCR, gcrPct,
    proratedCA, proratedOC,
  };
}

// ---- Rollup Tiles ----

function renderRollupTiles() {
  const ams = mgrAMs.account_managers;
  const n   = ams.length;
  const allMetrics = ams.map(am => getAMMetrics(am, mgrCurrentMonth));

  function countMet(key) {
    return allMetrics.filter(m => m && m[key] === 'met').length;
  }

  const configs = [
    { label: 'Completed Activities',  abbr: 'CA',   target: '≥300/mo',          key: 'caStatus'   },
    { label: 'Portfolio Coverage',    abbr: 'PC',   target: '≥25% monthly',     key: 'pcStatus'   },
    { label: 'Opportunities Created', abbr: 'OC',   target: '≥25/mo',           key: 'ocStatus'   },
    { label: 'Rolling iGCR',          abbr: 'iGCR', target: '≥$30k rolling',    key: 'igcrStatus' },
    { label: 'Portfolio GCR',         abbr: 'GCR',  target: '≥100% of goal',    key: 'gcrStatus'  },
  ];

  document.getElementById('rollup-tiles').innerHTML = configs.map(({ abbr, target, key }) => {
    const count = countMet(key);
    const pct   = n > 0 ? Math.round((count / n) * 100) : 0;
    const tileStatus = count === n ? 'met' : count >= Math.ceil(n * 0.8) ? 'at-risk' : 'not-met';

    const dotsHtml = ams.map((am, i) => {
      const metrics = allMetrics[i];
      const s = metrics ? metrics[key] : 'not-met';
      const initials = am.name.split(' ').map(w => w[0]).join('').slice(0, 2);
      return `<span class="rollup-dot rollup-dot--${s}" title="${am.name}: ${statusLabel(s)}">${initials}</span>`;
    }).join('');

    return `
      <div class="rollup-tile rollup-tile--${tileStatus}">
        <div class="rollup-tile-header">
          <span class="rollup-tile-abbr">${abbr}</span>
          <span class="rollup-tile-target">${target}</span>
        </div>
        <div class="rollup-tile-count">${count}<span class="rollup-tile-denom">/${n}</span></div>
        <div class="rollup-tile-pct">${pct}% meeting target</div>
        <div class="rollup-dots">${dotsHtml}</div>
      </div>`;
  }).join('');
}

// ---- Team Table ----

function renderTeamTable() {
  const tbody = document.getElementById('team-tbody');
  tbody.innerHTML = '';

  mgrAMs.account_managers.forEach(am => {
    const metrics = getAMMetrics(am, mgrCurrentMonth);
    const tr = document.createElement('tr');

    if (!metrics) {
      tr.innerHTML = `
        <td><a href="scorecard.html?am=${am.id}&month=${mgrCurrentMonth}" class="team-am-link">${am.name}</a></td>
        <td><span class="am-level-badge" style="font-size:10px;padding:1px 6px;">${am.level}</span></td>
        <td colspan="6" style="color:var(--neutral-400);font-style:italic;font-size:13px;">No data for this period</td>
      `;
      tbody.appendChild(tr);
      return;
    }

    if (metrics.isPartial) tr.classList.add('row--partial');

    function pill(val, status) {
      return `<span class="cell-pill cell-pill--${status}">${val}</span>`;
    }

    tr.innerHTML = `
      <td><a href="scorecard.html?am=${am.id}&month=${mgrCurrentMonth}" class="team-am-link">${am.name}</a></td>
      <td><span class="am-level-badge" style="font-size:10px;padding:1px 6px;">${am.level}</span></td>
      <td>${pill(metrics.ca.toLocaleString(), metrics.caStatus)}</td>
      <td>${pill(formatPct(metrics.pcPct), metrics.pcStatus)}</td>
      <td>${pill(metrics.oc.toLocaleString(), metrics.ocStatus)}</td>
      <td>${pill(formatCurrency(metrics.rollingIGCR, true), metrics.igcrStatus)}</td>
      <td>${pill(formatPct(metrics.gcrPct, 0) + ' of goal', metrics.gcrStatus)}</td>
      <td>${pill(statusLabel(metrics.overall), metrics.overall)}</td>
    `;
    tbody.appendChild(tr);
  });
}

if (document.getElementById('mgr-month-select')) {
  initManagerPage();
}
