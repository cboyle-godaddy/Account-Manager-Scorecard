// Scorecard page logic

const MPE = {
  CA_TARGET:  300,
  OC_TARGET:   25,
  IGCR_MONTHLY_TARGET: 10000,
  IGCR_ROLLING_TARGET: 30000,
  PC_MONTHLY_TARGET:   25,  // percent
  PC_QUARTERLY_TARGET: 75   // percent
};

let allAMs, perfData, currentAmId, currentMonth;
let charts = {};

async function init() {
  const params = new URLSearchParams(window.location.search);
  currentAmId = params.get('am');
  currentMonth = params.get('month');

  if (!currentAmId || !currentMonth) {
    window.location.href = 'index.html';
    return;
  }

  let fromUpload;
  try {
    [allAMs, perfData, fromUpload] = await loadAppData();
  } catch (e) {
    document.getElementById('scorecard-main').innerHTML =
      '<p style="color:red;padding:24px">Failed to load data. Serve this site over HTTP (e.g. <code>npx serve .</code>).</p>';
    return;
  }

  if (fromUpload) {
    const cached = JSON.parse(localStorage.getItem('am_scorecard_data'));
    const date = new Date(cached.uploaded_at).toLocaleDateString();
    const banner = document.createElement('div');
    banner.className = 'upload-source-banner';
    banner.innerHTML = `
      <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
      Showing uploaded data (${date}) — <a href="upload.html">manage uploads</a>
    `;
    document.getElementById('scorecard-main').prepend(banner);
  }

  const am = allAMs.account_managers.find(a => a.id === currentAmId);
  if (!am) { window.location.href = 'index.html'; return; }

  renderHeader(am);
  populateMonthSelect();
  renderCurrentMonth(am);
  renderHistory(am);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-btn--active'));
      btn.classList.add('tab-btn--active');
      const tab = btn.dataset.tab;
      document.getElementById('tab-current').style.display   = tab === 'current'   ? '' : 'none';
      document.getElementById('tab-history').style.display   = tab === 'history'   ? '' : 'none';
      document.getElementById('tab-portfolio').style.display = tab === 'portfolio' ? '' : 'none';
      if (tab === 'history')   renderHistory(am);
      if (tab === 'portfolio') renderPortfolioBreakdown(am);
    });
  });

  document.getElementById('sc-month-select').addEventListener('change', e => {
    currentMonth = e.target.value;
    const url = new URL(window.location);
    url.searchParams.set('month', currentMonth);
    history.replaceState({}, '', url);
    renderCurrentMonth(am);
  });
}

function renderHeader(am) {
  document.title = `${am.name} — AM Scorecard`;
  document.getElementById('am-name').textContent = am.name;
  document.getElementById('am-level').textContent = am.level;
  const initials = am.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('am-avatar').textContent = initials;
}

function populateMonthSelect() {
  const sel = document.getElementById('sc-month-select');
  const months = getAvailableMonths(perfData.monthly).reverse();
  months.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    const isPartial = !!perfData.monthly[m].working_days_completed;
    opt.textContent = formatMonthLabel(m) + (isPartial ? ' (MTD)' : '');
    if (m === currentMonth) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ---- Current Month ----
function renderCurrentMonth(am) {
  const monthData = perfData.monthly[currentMonth];
  if (!monthData) return;

  const amMonthData = monthData[currentAmId];
  if (!amMonthData) {
    document.getElementById('mpe-grid').innerHTML = '<p style="color:var(--neutral-400);font-style:italic">No data for this period.</p>';
    return;
  }

  const isPartial = !!monthData.working_days_completed;
  const daysCompleted = monthData.working_days_completed || monthData.working_days;
  const daysTotal = monthData.working_days;
  const workedDays = amMonthData.worked_days;

  // Partial month banner
  const banner = document.getElementById('partial-banner');
  if (isPartial) {
    banner.style.display = 'flex';
    document.getElementById('partial-days-text').textContent = daysCompleted;
    document.getElementById('partial-total-text').textContent = daysTotal;
  } else {
    banner.style.display = 'none';
  }

  // Prorated targets (based on worked_days vs total working days)
  const proratedCA = MPE.CA_TARGET * (workedDays / daysTotal);
  const proratedOC = MPE.OC_TARGET * (workedDays / daysTotal);

  renderMPEGrid(am, amMonthData, isPartial, daysCompleted, daysTotal, workedDays, proratedCA, proratedOC);
  renderIGCRRolling(amMonthData, isPartial);
  renderGCRCard(am, amMonthData, isPartial);
}

function renderMPEGrid(am, d, isPartial, daysCompleted, daysTotal, workedDays, proratedCA, proratedOC) {
  const grid = document.getElementById('mpe-grid');
  grid.innerHTML = '';

  // -- CA Card --
  const caStatus = isPartial
    ? 'pace-' + paceStatusKey(d.ca, proratedCA, daysCompleted, daysTotal)
    : getStatus(d.ca, proratedCA);
  grid.appendChild(makeMetricCard({
    name: 'Completed Activities',
    abbr: 'CA',
    actual: d.ca.toLocaleString(),
    actualRaw: d.ca,
    target: Math.round(proratedCA).toLocaleString(),
    targetRaw: proratedCA,
    sub: isPartial
      ? `MTD — full target: ${MPE.CA_TARGET} (prorated: ${Math.round(proratedCA)})`
      : `Includes calls, emails, tasks, meetings, cases`,
    status: caStatus,
    isPartial
  }));

  // -- PC Card --
  const pcPct = (d.pc_unique_accounts / am.portfolio_size) * 100;
  const pcStatus = isPartial
    ? 'pace-' + paceStatusKey(pcPct, MPE.PC_MONTHLY_TARGET, daysCompleted, daysTotal)
    : getStatus(pcPct, MPE.PC_MONTHLY_TARGET);

  const quarter = getQuarterForMonth(currentMonth);
  const qData = perfData.quarterly_pc?.[quarter]?.[currentAmId];
  const qIsPartial = perfData.quarterly_pc?.[quarter]?._partial;
  let quarterlyRow = null;
  if (qData) {
    const qPct = (qData.unique_accounts / am.portfolio_size) * 100;
    const qStatus = qIsPartial ? 'partial' : getStatus(qPct, MPE.PC_QUARTERLY_TARGET);
    quarterlyRow = { pct: qPct, status: qStatus, quarter, isPartial: !!qIsPartial };
  }

  grid.appendChild(makeMetricCard({
    name: 'Portfolio Coverage',
    abbr: 'PC',
    actual: formatPct(pcPct),
    actualRaw: pcPct,
    target: formatPct(MPE.PC_MONTHLY_TARGET),
    targetRaw: MPE.PC_MONTHLY_TARGET,
    sub: `${d.pc_unique_accounts} unique accounts / ${am.portfolio_size} portfolio`,
    status: pcStatus,
    isPartial,
    quarterlyRow
  }));

  // -- OC Card --
  const ocStatus = isPartial
    ? 'pace-' + paceStatusKey(d.oc, proratedOC, daysCompleted, daysTotal)
    : getStatus(d.oc, proratedOC);
  grid.appendChild(makeMetricCard({
    name: 'Opportunities Created',
    abbr: 'OC',
    actual: d.oc.toLocaleString(),
    actualRaw: d.oc,
    target: Math.round(proratedOC).toLocaleString(),
    targetRaw: proratedOC,
    sub: isPartial
      ? `MTD — full target: ${MPE.OC_TARGET} (prorated: ${Math.round(proratedOC)})`
      : `Sales opportunities in Salesforce`,
    status: ocStatus,
    isPartial
  }));

  // -- iGCR Monthly Card --
  const igcrStatus = isPartial
    ? 'pace-' + paceStatusKey(d.igcr, MPE.IGCR_MONTHLY_TARGET, daysCompleted, daysTotal)
    : getStatus(d.igcr, MPE.IGCR_MONTHLY_TARGET);
  grid.appendChild(makeMetricCard({
    name: 'iGCR (Monthly)',
    abbr: 'iGCR',
    actual: formatCurrency(d.igcr, true),
    actualRaw: d.igcr,
    target: formatCurrency(MPE.IGCR_MONTHLY_TARGET, true),
    targetRaw: MPE.IGCR_MONTHLY_TARGET,
    sub: isPartial ? `MTD closed won — see 3-month rolling below` : `Closed won opportunities`,
    status: igcrStatus,
    isPartial
  }));
}

function paceStatusKey(actual, target, daysCompleted, daysTotal) {
  if (daysCompleted <= 0 || daysTotal <= 0) return statusToKey(getStatus(actual, target));
  const projected = actual * (daysTotal / daysCompleted);
  const ratio = projected / target;
  if (ratio >= 1.0) return 'ok';
  if (ratio >= 0.8) return 'risk';
  return 'behind';
}

function statusToKey(status) {
  if (status === 'met') return 'ok';
  if (status === 'at-risk') return 'risk';
  return 'behind';
}

function makeMetricCard({ name, abbr, actual, actualRaw, target, targetRaw, sub, status, isPartial, quarterlyRow }) {
  const card = document.createElement('div');
  card.className = `metric-card metric-card--${status}`;

  const pct = Math.min((actualRaw / targetRaw) * 100, 100);
  const fillClass = status.includes('met') || status.includes('ok')
    ? 'met'
    : status.includes('risk')
    ? 'at-risk'
    : 'not-met';

  const badgeLabel = isPartial
    ? { 'pace-ok': 'On Pace', 'pace-risk': 'At Risk', 'pace-behind': 'Behind' }[status] || statusLabel(status)
    : statusLabel(status);

  card.innerHTML = `
    <div class="metric-card-header">
      <span class="metric-name">${name}</span>
      <span class="metric-status-badge metric-status-badge--${status}">${badgeLabel}</span>
    </div>
    <div class="metric-values">
      <span class="metric-actual">${actual}</span>
      <span class="metric-target">/ ${target}</span>
    </div>
    <div class="metric-progress-track">
      <div class="metric-progress-fill metric-progress-fill--${fillClass}" style="width:${pct}%"></div>
    </div>
    <div class="metric-sub">${sub}</div>
    ${quarterlyRow ? renderQuarterlyRow(quarterlyRow) : ''}
  `;
  return card;
}

function renderQuarterlyRow({ pct, status, quarter, isPartial: partial }) {
  const label = partial ? `${quarter} (in progress)` : quarter;
  const valueClass = partial ? 'partial' : status === 'met' ? 'met' : status === 'at-risk' ? 'partial' : 'not-met';
  const display = partial ? `${formatPct(pct)} / 75% target` : `${formatPct(pct)} / 75%`;
  return `
    <div class="metric-quarterly-row">
      <span class="metric-quarterly-label">Quarterly ${label}</span>
      <span class="metric-quarterly-value metric-quarterly-value--${valueClass}">${display}</span>
    </div>`;
}

function renderIGCRRolling(currentD, isPartial) {
  // Get last 3 months ending on currentMonth
  const allMonths = getAvailableMonths(perfData.monthly);
  const idx = allMonths.indexOf(currentMonth);
  const rollingMonths = allMonths.slice(Math.max(0, idx - 2), idx + 1);

  let rollingTotal = 0;
  const monthItems = rollingMonths.map(m => {
    const mData = perfData.monthly[m]?.[currentAmId];
    const val = mData?.igcr || 0;
    rollingTotal += val;
    const partial = !!perfData.monthly[m]?.working_days_completed;
    return { month: m, val, partial };
  });

  const rollingStatus = getStatus(rollingTotal, MPE.IGCR_ROLLING_TARGET);
  const fillClass = rollingStatus === 'met' ? 'met' : rollingStatus === 'at-risk' ? 'at-risk' : 'not-met';
  const pct = Math.min((rollingTotal / MPE.IGCR_ROLLING_TARGET) * 100, 100);
  const colorVar = rollingStatus === 'met' ? 'var(--green-500)' : rollingStatus === 'at-risk' ? 'var(--amber-500)' : 'var(--red-500)';

  const monthsHTML = monthItems.map(({ month, val, partial }) => `
    <div class="igcr-month-item">
      <div class="igcr-month-label">${formatMonthLabel(month)}</div>
      <div class="igcr-month-value ${partial ? 'igcr-month-partial' : ''}">${formatCurrency(val, true)}${partial ? '*' : ''}</div>
    </div>`).join('');

  const card = document.getElementById('igcr-rolling-card');
  card.innerHTML = `
    <div class="igcr-rolling-months">${monthsHTML}</div>
    <div class="igcr-rolling-total">
      <div class="igcr-total-left">
        <span class="igcr-total-label">3-Month Rolling Total</span>
        <span class="igcr-total-value">${formatCurrency(rollingTotal)}</span>
        <span class="igcr-total-target">vs ${formatCurrency(MPE.IGCR_ROLLING_TARGET)} target</span>
      </div>
      <div class="igcr-total-right">
        <span class="metric-status-badge metric-status-badge--${rollingStatus}">${statusLabel(rollingStatus)}</span>
        <div class="igcr-rolling-bar-track">
          <div class="igcr-rolling-bar-fill" style="width:${pct}%;background:${colorVar}"></div>
        </div>
        <span style="font-size:12px;color:var(--neutral-400)">${pct.toFixed(0)}% of target</span>
      </div>
    </div>
    ${isPartial ? '<p style="font-size:11px;color:var(--neutral-400);margin-top:10px">* Current month is MTD and may change.</p>' : ''}
  `;
}

function renderGCRCard(am, d, isPartial) {
  const pct = (d.portfolio_gcr_actual / am.portfolio_gcr_goal) * 100;
  const status = getStatus(pct, 100);
  const fillColor = status === 'met' ? 'var(--green-500)' : status === 'at-risk' ? 'var(--amber-500)' : 'var(--red-500)';
  const fill = Math.min(pct, 100);

  const card = document.getElementById('gcr-card');
  card.innerHTML = `
    <div class="gcr-card-left">
      <span class="gcr-label">Portfolio GCR${isPartial ? ' (MTD)' : ''}</span>
      <div class="gcr-values">
        <span class="gcr-actual">${formatCurrency(d.portfolio_gcr_actual)}</span>
        <span class="gcr-target">/ ${formatCurrency(am.portfolio_gcr_goal)} goal</span>
      </div>
    </div>
    <div class="gcr-card-right">
      <div class="gcr-pct-row">
        <span class="gcr-pct-value" style="color:${fillColor}">${pct.toFixed(1)}%</span>
        <span class="metric-status-badge metric-status-badge--${status}">${statusLabel(status)}</span>
      </div>
      <div class="gcr-bar-track">
        <div class="gcr-bar-fill" style="width:${fill}%;background:${fillColor}"></div>
      </div>
      ${isPartial ? '<span style="font-size:11px;color:var(--neutral-400)">MTD — full month in progress</span>' : ''}
    </div>
  `;
}

// ---- History ----
function renderHistory(am) {
  const allMonths = getAvailableMonths(perfData.monthly);
  const months = allMonths.slice(-6); // last 6 months
  const labels = months.map(m => formatMonthLabel(m));
  const isPartialFlags = months.map(m => !!perfData.monthly[m]?.working_days_completed);

  const get = (m, key) => perfData.monthly[m]?.[currentAmId]?.[key] ?? null;
  const getPct = (m) => {
    const u = get(m, 'pc_unique_accounts');
    return u !== null ? (u / am.portfolio_size) * 100 : null;
  };

  // Chart colors
  const GREEN = 'rgb(26,158,63)';
  const GREEN_LIGHT = getChartLineColor();
  const AMBER = 'rgb(217,119,6)';
  const PARTIAL_ALPHA = 0.45;

  function pointColors(values, target, months) {
    return values.map((v, i) => {
      if (v === null) return 'transparent';
      const partial = isPartialFlags[i];
      const st = getStatus(v, target);
      const alpha = partial ? PARTIAL_ALPHA : 1;
      if (st === 'met') return `rgba(26,158,63,${alpha})`;
      if (st === 'at-risk') return `rgba(217,119,6,${alpha})`;
      return `rgba(220,38,38,${alpha})`;
    });
  }

  function makeLineDataset(values, target, label) {
    const pColors = pointColors(values, target, months);
    return [{
      label,
      data: values,
      borderColor: GREEN,
      backgroundColor: GREEN_LIGHT,
      tension: 0.35,
      fill: true,
      pointBackgroundColor: pColors,
      pointBorderColor: pColors,
      pointRadius: 5,
      pointHoverRadius: 7,
      segment: {
        borderDash: ctx => isPartialFlags[ctx.p1DataIndex] ? [5,4] : undefined,
        borderColor: ctx => isPartialFlags[ctx.p1DataIndex] ? `rgba(26,158,63,0.45)` : GREEN
      }
    }, {
      label: 'Target',
      data: months.map(() => target),
      borderColor: AMBER,
      borderDash: [6, 3],
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false
    }];
  }

  const commonOpts = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 }, color: getChartTickColor() } },
      y: { grid: { color: getChartGridColor() }, ticks: { font: { size: 11 }, color: getChartTickColor() } }
    }
  };

  function destroyAndCreate(id, config) {
    if (charts[id]) charts[id].destroy();
    const ctx = document.getElementById(id).getContext('2d');
    charts[id] = new Chart(ctx, config);
  }

  // CA
  destroyAndCreate('chart-ca', {
    type: 'line',
    data: { labels, datasets: makeLineDataset(months.map(m => get(m,'ca')), MPE.CA_TARGET, 'CA') },
    options: { ...commonOpts }
  });

  // PC
  destroyAndCreate('chart-pc', {
    type: 'line',
    data: { labels, datasets: makeLineDataset(months.map(m => getPct(m)), MPE.PC_MONTHLY_TARGET, 'PC %') },
    options: {
      ...commonOpts,
      scales: { ...commonOpts.scales, y: { ...commonOpts.scales.y, ticks: { ...commonOpts.scales.y.ticks, callback: v => v + '%' } } }
    }
  });

  // OC
  destroyAndCreate('chart-oc', {
    type: 'line',
    data: { labels, datasets: makeLineDataset(months.map(m => get(m,'oc')), MPE.OC_TARGET, 'OC') },
    options: { ...commonOpts }
  });

  // iGCR monthly (bar)
  const igcrVals = months.map(m => get(m, 'igcr'));
  const igcrBarColors = igcrVals.map((v, i) => {
    if (v === null) return 'rgba(0,0,0,0)';
    const partial = isPartialFlags[i];
    const st = getStatus(v, MPE.IGCR_MONTHLY_TARGET);
    const alpha = partial ? 0.5 : 0.85;
    if (st === 'met') return `rgba(26,158,63,${alpha})`;
    if (st === 'at-risk') return `rgba(217,119,6,${alpha})`;
    return `rgba(220,38,38,${alpha})`;
  });
  destroyAndCreate('chart-igcr', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'iGCR', data: igcrVals, backgroundColor: igcrBarColors, borderRadius: 4 },
        { type: 'line', label: 'Target $10k', data: months.map(() => MPE.IGCR_MONTHLY_TARGET),
          borderColor: AMBER, borderDash: [6,3], borderWidth: 1.5, pointRadius: 0, fill: false }
      ]
    },
    options: {
      ...commonOpts,
      scales: {
        ...commonOpts.scales,
        y: { ...commonOpts.scales.y, ticks: { ...commonOpts.scales.y.ticks, callback: v => '$' + (v/1000).toFixed(0) + 'k' } }
      }
    }
  });

  // Portfolio GCR % of goal
  const gcrPcts = months.map(m => {
    const actual = get(m, 'portfolio_gcr_actual');
    return actual !== null ? (actual / am.portfolio_gcr_goal) * 100 : null;
  });
  destroyAndCreate('chart-gcr', {
    type: 'line',
    data: { labels, datasets: makeLineDataset(gcrPcts, 100, 'GCR %') },
    options: {
      ...commonOpts,
      scales: {
        ...commonOpts.scales,
        y: {
          ...commonOpts.scales.y,
          min: 50,
          ticks: { ...commonOpts.scales.y.ticks, callback: v => v + '%' }
        }
      }
    }
  });

  renderSummaryTable(am, months);
}

function renderSummaryTable(am, months) {
  const tbody = document.getElementById('summary-tbody');
  tbody.innerHTML = '';

  // Pre-compute rolling iGCR for each month
  const allMonths = getAvailableMonths(perfData.monthly);

  months.slice().reverse().forEach(m => {
    const d = perfData.monthly[m]?.[currentAmId];
    if (!d) return;

    const partial = !!perfData.monthly[m]?.working_days_completed;
    const daysTotal = perfData.monthly[m].working_days;
    const workedDays = d.worked_days;
    const daysCompleted = perfData.monthly[m].working_days_completed || daysTotal;

    const proratedCA = MPE.CA_TARGET * (workedDays / daysTotal);
    const proratedOC = MPE.OC_TARGET * (workedDays / daysTotal);
    const pcPct = (d.pc_unique_accounts / am.portfolio_size) * 100;
    const gcrPct = (d.portfolio_gcr_actual / am.portfolio_gcr_goal) * 100;

    // Rolling iGCR: sum of this month + prev 2
    const idx = allMonths.indexOf(m);
    const rollingMs = allMonths.slice(Math.max(0, idx - 2), idx + 1);
    const rollingIGCR = rollingMs.reduce((s, rm) => s + (perfData.monthly[rm]?.[currentAmId]?.igcr || 0), 0);

    const caStatus = partial ? ('pace-' + paceStatusKey(d.ca, proratedCA, daysCompleted, daysTotal)) : getStatus(d.ca, proratedCA);
    const pcStatus = partial ? ('pace-' + paceStatusKey(pcPct, MPE.PC_MONTHLY_TARGET, daysCompleted, daysTotal)) : getStatus(pcPct, MPE.PC_MONTHLY_TARGET);
    const ocStatus = partial ? ('pace-' + paceStatusKey(d.oc, proratedOC, daysCompleted, daysTotal)) : getStatus(d.oc, proratedOC);
    const igcrStatus = partial ? ('pace-' + paceStatusKey(d.igcr, MPE.IGCR_MONTHLY_TARGET, daysCompleted, daysTotal)) : getStatus(d.igcr, MPE.IGCR_MONTHLY_TARGET);
    const rollingStatus = getStatus(rollingIGCR, MPE.IGCR_ROLLING_TARGET);
    const gcrStatus = getStatus(gcrPct, 100);

    function pill(val, status) {
      const cls = status.includes('met') || status.includes('ok') ? 'met'
        : status.includes('risk') ? 'at-risk' : 'not-met';
      return `<span class="cell-pill cell-pill--${cls}">${val}</span>`;
    }

    const tr = document.createElement('tr');
    if (partial) tr.classList.add('row--partial');
    tr.innerHTML = `
      <td>${formatMonthLabel(m)}</td>
      <td>${pill(d.ca.toLocaleString(), caStatus)}</td>
      <td>${pill(formatPct(pcPct), pcStatus)}</td>
      <td>${pill(d.oc.toLocaleString(), ocStatus)}</td>
      <td>${pill(formatCurrency(d.igcr, true), igcrStatus)}</td>
      <td>${pill(formatCurrency(rollingIGCR, true), partial ? 'partial' : rollingStatus)}</td>
      <td>${pill(formatPct(gcrPct, 0) + ' of goal', gcrStatus)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function paceStatusKey(actual, target, daysCompleted, daysTotal) {
  if (daysCompleted <= 0 || daysTotal <= 0) return statusToKey(getStatus(actual, target));
  const projected = actual * (daysTotal / daysCompleted);
  const ratio = projected / target;
  if (ratio >= 1.0) return 'ok';
  if (ratio >= 0.8) return 'risk';
  return 'behind';
}

// ---- Portfolio Breakdown Tab ----
function renderPortfolioBreakdown(am) {
  const monthData = perfData.monthly[currentMonth];
  const d = monthData?.[currentAmId];
  if (!d || d.ent == null) return;

  const isPartial = !!monthData.working_days_completed;
  const label = formatMonthLabel(currentMonth) + (isPartial ? ' (MTD)' : '');
  document.getElementById('portfolio-month-label').textContent = '— ' + label;

  const entCount   = d.ent;
  const otherGroup = d.mm + d.corp + d.other;
  const total      = entCount + otherGroup;
  const entPct     = ((entCount / total) * 100).toFixed(1);
  const otherPct   = ((otherGroup / total) * 100).toFixed(1);

  // Split cards
  document.getElementById('portfolio-split-cards').innerHTML = `
    <div class="portfolio-split-card portfolio-split-card--enterprise">
      <div class="portfolio-split-label">Enterprise</div>
      <div class="portfolio-split-value">${entCount.toLocaleString()}</div>
      <div class="portfolio-split-sub">${entPct}% of portfolio</div>
      <div class="portfolio-split-bar-track">
        <div class="portfolio-split-bar-fill portfolio-split-bar-fill--enterprise" style="width:${entPct}%"></div>
      </div>
    </div>
    <div class="portfolio-split-card portfolio-split-card--other">
      <div class="portfolio-split-label">Mid-Market, Corporate &amp; Others</div>
      <div class="portfolio-split-value">${otherGroup.toLocaleString()}</div>
      <div class="portfolio-split-sub">${otherPct}% of portfolio</div>
      <div class="portfolio-split-bar-track">
        <div class="portfolio-split-bar-fill portfolio-split-bar-fill--other" style="width:${otherPct}%"></div>
      </div>
    </div>
  `;

  // Detail breakdown (all four segments)
  const segments = [
    { label: 'Enterprise',   value: d.ent,  color: 'var(--green-600)' },
    { label: 'Mid-Market',   value: d.mm,   color: 'var(--blue-500, #3b82f6)' },
    { label: 'Corporate',    value: d.corp, color: 'var(--indigo-500, #6366f1)' },
    { label: 'Others',       value: d.other,color: 'var(--neutral-400)' },
  ];
  document.getElementById('portfolio-detail-grid').innerHTML = `
    <div class="portfolio-detail-header">Segment breakdown</div>
    <div class="portfolio-detail-rows">
      ${segments.map(s => {
        const pct = ((s.value / total) * 100).toFixed(1);
        const barW = Math.min((s.value / total) * 100, 100);
        return `
          <div class="portfolio-detail-row">
            <span class="portfolio-detail-name">${s.label}</span>
            <div class="portfolio-detail-bar-track">
              <div class="portfolio-detail-bar-fill" style="width:${barW}%;background:${s.color}"></div>
            </div>
            <span class="portfolio-detail-count">${s.value.toLocaleString()}</span>
            <span class="portfolio-detail-pct">${pct}%</span>
          </div>`;
      }).join('')}
      <div class="portfolio-detail-row portfolio-detail-row--total">
        <span class="portfolio-detail-name">Total</span>
        <div class="portfolio-detail-bar-track"></div>
        <span class="portfolio-detail-count">${total.toLocaleString()}</span>
        <span class="portfolio-detail-pct">100%</span>
      </div>
    </div>
  `;

  // History stacked bar chart
  const allMonths = getAvailableMonths(perfData.monthly);
  const histMonths = allMonths.slice(-6);
  const histLabels = histMonths.map(m => formatMonthLabel(m));

  const entData   = histMonths.map(m => perfData.monthly[m]?.[currentAmId]?.ent   ?? null);
  const mmData    = histMonths.map(m => perfData.monthly[m]?.[currentAmId]?.mm    ?? null);
  const corpData  = histMonths.map(m => perfData.monthly[m]?.[currentAmId]?.corp  ?? null);
  const otherData = histMonths.map(m => perfData.monthly[m]?.[currentAmId]?.other ?? null);
  const partialFlags = histMonths.map(m => !!perfData.monthly[m]?.working_days_completed);

  const alpha = (base, i) => partialFlags[i] ? base.replace(')', ', 0.5)').replace('rgb', 'rgba') : base;

  if (charts['chart-portfolio-history']) charts['chart-portfolio-history'].destroy();
  const ctx = document.getElementById('chart-portfolio-history').getContext('2d');
  charts['chart-portfolio-history'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: histLabels,
      datasets: [
        {
          label: 'Enterprise',
          data: entData,
          backgroundColor: histMonths.map((_, i) => alpha('rgb(26,158,63)', i)),
          borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 4, bottomRight: 4 },
          stack: 'portfolio'
        },
        {
          label: 'Mid-Market',
          data: mmData,
          backgroundColor: histMonths.map((_, i) => alpha('rgb(59,130,246)', i)),
          borderRadius: 0,
          stack: 'portfolio'
        },
        {
          label: 'Corporate',
          data: corpData,
          backgroundColor: histMonths.map((_, i) => alpha('rgb(99,102,241)', i)),
          borderRadius: 0,
          stack: 'portfolio'
        },
        {
          label: 'Others',
          data: otherData,
          backgroundColor: histMonths.map((_, i) => alpha('rgb(156,163,175)', i)),
          borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
          stack: 'portfolio'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          mode: 'index',
          callbacks: {
            footer: items => {
              const total = items.reduce((s, i) => s + (i.parsed.y || 0), 0);
              return `Total: ${total.toLocaleString()} accounts`;
            }
          }
        }
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 }, color: '#9ca3af' } },
        y: { stacked: true, grid: { color: '#f3f4f6' }, ticks: { font: { size: 11 }, color: '#9ca3af' } }
      }
    }
  });
}

// Re-render charts when theme changes so grid/tick colors update
document.addEventListener('themechange', () => {
  const am = allAMs?.account_managers.find(a => a.id === currentAmId);
  if (!am) return;
  const activeTab = document.querySelector('.tab-btn--active')?.dataset.tab;
  if (activeTab === 'history')   renderHistory(am);
  if (activeTab === 'portfolio') renderPortfolioBreakdown(am);
});

init();
