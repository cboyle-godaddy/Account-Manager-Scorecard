# Business Care AM Scorecard

Static web app for Business Care Account Managers to view their performance against monthly MPE targets and portfolio GCR goal.

## Features

- **AM picker** — select your name and month on the landing page
- **Current month scorecard** — metric cards for all 4 MPE metrics + iGCR 3-month rolling + portfolio GCR goal
- **Partial month support** — shows MTD data with on-pace/at-risk/behind indicators when the month is in progress
- **Historical view** — 6-month trend charts (Chart.js) + color-coded summary table
- **No login required** — AMs select their name from a dropdown

## MPE Metrics Tracked

| Metric | Monthly Target | Notes |
|---|---|---|
| Completed Activities (CA) | ≥ 300 | Prorated for approved time off |
| Portfolio Coverage (PC) | ≥ 25% monthly / 75% quarterly | Unique accounts ÷ portfolio size |
| Opportunities Created (OC) | ≥ 25 | Prorated for approved time off |
| iGCR | ≥ $10k/mo / $30k rolling 3-month | Closed won opportunities |
| Portfolio GCR Goal | Per-AM monthly goal | Sourced separately from portfolio performance data |

## Local Development

This is a static site — you **must** serve it over HTTP (not `file://`) because it uses `fetch()` to load JSON data.

```bash
# Option 1: Python
python3 -m http.server 8080

# Option 2: Node
npx serve .

# Option 3: VS Code Live Server extension
# Right-click index.html → Open with Live Server
```

Then open http://localhost:8080

## GitHub Pages Deployment

1. Push this repo to GitHub
2. Go to **Settings → Pages**
3. Set Source to **Deploy from a branch**, branch `main`, folder `/ (root)`
4. Your app will be live at `https://<your-org>.github.io/<repo-name>/`

## Updating Data

All data lives in two JSON files — no build step required.

### Add or update an Account Manager — `data/ams.json`

```json
{
  "id": "jsmith",
  "name": "Jane Smith",
  "level": "AM II",
  "portfolio_size": 375,
  "portfolio_gcr_goal": 295000
}
```

Fields:
- `id` — unique slug (lowercase, no spaces)
- `name` — display name
- `level` — `"AM I"`, `"AM II"`, or `"AM III"`
- `portfolio_size` — number of accounts (capped at 400 for PC calculation)
- `portfolio_gcr_goal` — monthly portfolio GCR goal in dollars

### Add a completed month — `data/performance.json`

Under `"monthly"`, add a new key `"YYYY-MM"`:

```json
"2026-06": {
  "working_days": 21,
  "jsmith": {
    "worked_days": 21,
    "ca": 315,
    "pc_unique_accounts": 108,
    "oc": 29,
    "igcr": 12500,
    "portfolio_gcr_actual": 288000
  }
}
```

For the **current in-progress month**, also add `"working_days_completed"`:

```json
"2026-06": {
  "working_days": 21,
  "working_days_completed": 10,
  "jsmith": { ... }
}
```

Remove `working_days_completed` once the month is complete.

### Update quarterly PC — `data/performance.json`

Under `"quarterly_pc"`, add a key `"YYYY-QN"`. This requires a deduplicated count of unique accounts touched across the full quarter (cannot be derived from monthly counts):

```json
"2026-Q2": {
  "_partial": true,
  "jsmith": { "unique_accounts": 185 }
}
```

Set `"_partial": true` while the quarter is in progress; remove it once complete.

## Data Sources

| Field | Source |
|---|---|
| `ca`, `pc_unique_accounts`, `oc`, `igcr` | Salesforce / existing MPE reporting |
| `portfolio_gcr_actual` | Portfolio performance GCR report |
| `portfolio_gcr_goal` | Quota/goal set per AM |
| `quarterly_pc` unique accounts | Salesforce (requires cross-month deduplication) |
