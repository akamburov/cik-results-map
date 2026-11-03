# agents.md — engineering guide for coding agents

For any agent (pi, Codex, Claude, GitHub Copilot, …) working in this repository.
**Read this first.** For the CIK data format and the preprocessing pipeline, use the
**`cik-processing` skill** (`.agents/skills/cik-processing/SKILL.md`).

## TL;DR

- **What:** a static web app visualizing the 2026 Bulgarian presidential election
  results on a map + a filterable table.
- **Stack:** vanilla JS + Leaflet (CDN) front end; one dependency-free Node script
  that preprocesses CIK CSVs into committed JSON.
  **No framework, no build step, no backend, no `npm install`.**
- **Data pipeline:** handled by the **`cik-processing` skill** — see
  `.agents/skills/cik-processing/SKILL.md` for the CIK CSV field maps, extraction,
  output schema, and how to regenerate.
- **Rule of thumb:** never commit the raw export (`Exports/` is gitignored);
  commit only source + generated `data/*.json`.
- **Order matters:** run the `cik-processing` skill's `process.mjs` (if data changed)
  **before** anything that reads the JSON — the page loads JSON, not CSVs.

## Repository layout

```
cik-results-map/
├── readme.md                  # public-facing docs (users)
├── agents.md                  # this file (agents)
├── .agents/skills/cik-processing/
│   ├── SKILL.md              # CIK data processing (skill)
│   └── scripts/process.mjs   # CSV → data/*.json (Node built-ins only)
├── .gitignore                 # ignores Exports/, node_modules, dist
├── index.html                 # static entry point (<script src="app.js">)
├── app.js                     # vanilla-JS app: map + table + filters
├── style.css
├── scripts/
│   └── serve.mjs             # preview: node scripts/serve.mjs [port]
├── data/                      # GENERATED (committed): JSON the viewer fetches
│   ├── meta.json            #   parties, candidates, regions, stats, vote totals
│   ├── sections.json        #   ballot boxes w/ coords, votes per party, winner
│   ├── districts.json       #   district-level aggregates (one per district)
│   └── settlements.json     #   settlement-level aggregates (one per settlement)
└── Exports/                   # RAW, gitignored — do not commit
    └── processed/<Актуализирана база данни>/   # extracted CSVs
```

The exact schema of every `data/*.json` file and the CIK field maps live in the
**`cik-processing` skill** — keep that skill and its bundled `scripts/process.mjs` in
sync.

## Data contract

The `cik-processing` skill's `process.mjs` **produces** `data/*.json`; the viewer
(`app.js`)** consumes** them via `fetch('./data/*.json')`. This is the contract:

| File             | Producer (skill)                              | Consumer (viewer)                                      |
|------------------|-----------------------------------------------|-------------------------------------------------------|
| `meta.json`      | parties list, candidate list, region names,   | legend colors, filter options, UI labels              |
|                  | `stats.totalValid`, `stats.totalDistricts`   |                                                       |
| `sections.json`  | one entry per mapped ballot box: `id`,       | map markers (lat/lng), winner color, per-party votes  |
|                  | `name`, `lat`, `lng`, `regionId`,            |                                                       |
|                  | `votes[] {id, name, votes}`, `winnerId`     |                                                       |
| `districts.json` | one entry per district: `id`, `name`,        | district-level choropleth / table rows                |
|                  | `lat`, `lng`, `votes[]`, `winnerId`         |                                                       |
| `settlements.json` | one entry per settlement: `id`, `name`,    | settlement-level table rows                           |
|                  | `regionId`, `votes[]`, `winnerId`          |                                                       |

**Invariants the viewer relies on** (skill must guarantee):

1. Every `votes[].id` references a `meta.parties[i].id` — no dangling ids.
2. Every `sections.json` entry has finite `lat`/`lng` (no null, no NaN).
3. `meta.stats.totalValid` is a plausible total (≳ 1.4M for 2026 BG election).
4. Running `process.mjs` twice produces byte-identical output (deterministic).
5. `districts.json` / `settlements.json` are derived from `sections.json` — the viewer
   never sums sections itself; it reads the pre-aggregated JSON.

If the skill changes an output schema, **update the viewer and this table together**.

## Front end (vanilla JS)

- **Entry:** `index.html` loads Leaflet from a CDN (`//unpkg.com/leaflet@1.9.x`) and
  `app.js` as a classic script (no `import`/`export`, no bundler).
- **Data loading:** `fetch('./data/*.json')`. Preview locally with
  `node scripts/serve.mjs`; opening via `file://` breaks fetch, so the `app.js` status
  line tells the user to start the server. GitHub Pages is the intended host.
- **Layers:** district/settlement circle layer (colored by winner) from the generated
  JSON; a filterable, sortable table (row-unit switch: regions ↔ settlements).
- **State:** one global state object; a few `addEventListener`s + a `render()` —
  reactivity without a framework.

## CI / deploy

GitHub Pages serves this **with zero build** (it is already static).
- Simplest: Pages from the `main` branch root — just push.
- Or a `deploy.yml` workflow that (a) runs the `cik-processing` skill's `process.mjs`,
  (b) verifies the output, (c) uploads `data/` + `index.html`.

Deploying to a sub-path (e.g. `/cik-results-map/`)? Keep fetch paths relative
(`./data/*.json`), not absolute.

## Conventions & rules

- **Never commit** `Exports/`, `node_modules/`, `dist/` (enforced by `.gitignore`).
- CSVs are UTF-8 and `;`-delimited — **do not transcode** (the CIK docs mention
  Windows-1251, but the exports are UTF-8).
- Keep `data/*.json` **committed but regenerable**; commit regenerated files
  alongside any change to the skill's `process.mjs`.
- **Harness (pi):** this repo's domain knowledge (CIK processing) lives in the
  `cik-processing` skill — consult it before editing the pipeline. Optionally wire a
  **hook** (pre-commit or pi hook) that runs the skill's `process.mjs` and checks the
  JSON is in sync, so committed data never drifts from the script.
- User-facing strings, party names, and region names are **Bulgarian**; code
  identifiers and comments are English.

## Verification

Covered by the `cik-processing` skill. In short: `meta.stats.totalValid` should be
plausible (~1.4M), every `sections.json` entry has finite coords, and all `votes`
party `id`s exist in `meta.parties`. Running the skill's `process.mjs` twice yields
identical output.

## Roadmap

Tracked via GitHub Issues (backlog: `gh issue list --repo akamburov/cik-results-map`):

- #2 — Section marker clustering & district choropleth (external BG district GeoJSON)
- #1 — GitHub Actions auto-deploy to Pages

Agents: check open issues before starting work; close issues in commit/PR messages
(`Closes #n`).
