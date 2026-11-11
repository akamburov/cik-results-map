# agents.md — engineering guide for coding agents

For any agent (pi, Codex, Claude, GitHub Copilot, …) working in this repository.
**Read this first.** For the CIK data format and the preprocessing pipeline, use the
**`cik-processing` skill** (`.agents/skills/cik-processing/SKILL.md`).

## TL;DR

- **What:** a static web app visualizing the 2026 Bulgarian presidential election
  results on a map + a filterable table.
- **Stack:** vanilla JS (ESM) + Leaflet 2.0 (importmap, CDN) with vendored markercluster front end; one dependency-free Node script
  that preprocesses CIK CSVs into committed JSON.
  **No framework, no build step, no backend, no `npm install`.**
- **Data pipeline:** handled by the **`cik-processing` skill** — see
  `.agents/skills/cik-processing/SKILL.md` for the CIK CSV field maps, extraction,
  output schema, and how to regenerate.
- **Rule of thumb:** never commit the raw export (`exports/` is gitignored);
  commit only source + generated `data/*.json`.
- **Testing:** keep deterministic logic in `app-core.js` (no DOM/Leaflet); add
  `node:test` cases in `test/app-core.test.js`. Run with `node --test test/app-core.test.js`.
  Move new pure helpers there, not into `app.js`, so they stay unit-testable.
- **Order matters:** run the `cik-processing` skill's `process.mjs` (if data changed)
  **before** anything that reads the JSON — the page loads JSON, not CSVs.

## Repository layout

```
cik-results-map/
├── readme.md                  # public-facing docs (users)
├── agents.md                  # this file (agents)
├── .agents/skills/
│   ├── cik-processing/
│   │   ├── SKILL.md          # CIK data processing (skill)
│   │   └── scripts/process.mjs   # CSV → data/*.json (Node built-ins only)
│   └── geo-processing/
│       ├── SKILL.md          # choropleth geometry (skill)
│       └── scripts/
│           ├── build-geo.mjs     # boundary GeoJSON → data/*.geojson
│           └── check-geo.mjs     # verifies geometry vs election data
├── .gitignore                 # ignores exports, node_modules, dist
├── index.html                 # static entry point (Leaflet 2.0 importmap, loads app.min.js bundle)
├── app-core.js                # pure, dependency-free helpers (map+table logic), shared by app.js & tests
├── app.js                     # vanilla-JS ESM app: map + table + filters
├── app.min.js                 # GENERATED (committed): single bundled+minified file (see scripts/minify.mjs)
├── style.css                  # light/dark palette via CSS variables
├── style.min.css              # GENERATED (committed): minified stylesheet loaded by index.html
├── test/
│   └── app-core.test.js       # node:test unit tests (Node built-in runner, no install)
├── vendor/
│   └── leaflet.markercluster/  # vendored Leaflet.markercluster (ESM source, bundled at minify time)
├── scripts/
│   ├── serve.mjs             # preview: node scripts/serve.mjs [port]
│   └── minify.mjs            # bundle+minify app.js / minify style.css with esbuild (via npx) (run after editing source)
├── data/                      # GENERATED (committed): JSON the viewer fetches
│   ├── meta.json            #   parties, candidates, regions, stats, vote totals
│   ├── sections.json        #   ballot boxes w/ coords, votes per party, winner
│   ├── districts.json       #   district-level aggregates (one per district)
│   ├── settlements.json     #   settlement-level aggregates (one per settlement)
│   ├── districts.geojson   #   one polygon feature per district (23/24/25 ИР merged)
│   └── settlements.geojson #   settlement land polygons keyed by EKATTE
└── exports/                   # RAW, gitignored — do not commit
    ├── processed/<Актуализирана база данни>/   # extracted CSVs
    └── geo/                 #   provinces/municipalities/settlements GeoJSON
```

The exact schema of every `data/*.json` file and the CIK field maps live in the
**`cik-processing` skill**; the boundary-geometry pipeline and the
province/municipality → district mapping live in the **`geo-processing` skill**. Keep
both skills and their bundled scripts in sync.

## Data contract

The `cik-processing` skill's `process.mjs` **produces** `data/*.json`; the
`geo-processing` skill's `build-geo.mjs` **produces** `data/*.geojson`; the viewer
(`app.js`)** consumes** them via `fetch('./data/*.json')`. This is the contract:

| File             | Producer (skill)                              | Consumer (viewer)                                      |
|------------------|-----------------------------------------------|-------------------------------------------------------|
| `meta.json`      | parties list, candidate list, region names,   | legend colors, filter options, UI labels              |
|                  | `stats.totalSections`, `stats.totalValid`,     |                                                       |
|                  | `stats.sectionsWithCoords`                     |                                                       |
| `sections.json`  | one entry per mapped ballot box: `id`,       | map markers (lat/lng), winner color, per-party votes  |
|                  | `name`, `lat`, `lng`, `regionId`,            |                                                       |
|                  | `votes[] {id, name, votes}`, `winnerId`     |                                                       |
| `districts.json` | one entry per district: `id`, `name`,        | district-level choropleth / table rows                |
|                  | `lat`, `lng`, `votes[]`, `winnerId`         |                                                       |
| `settlements.json` | one entry per settlement: `id`, `name`,    | settlement-level table rows                           |
|                  | `region`, `votes[]`, `winnerId`              |                                                       |
| `districts.geojson` | `geo-processing` skill's `build-geo.mjs`   | district choropleth polygons; `properties.districts[]`|
|                  | (boundaries from `exports/geo/`) → one      | names must match `districts.json` `name`              |
|                  | feature per district, WGS84 geometry        |                                                       |
| `settlements.geojson` | `build-geo.mjs` → land polygons keyed | settlement choropleth; `ekatte` joins                 |
|                  | by 5-digit EKATTE (6-digit EKATTEs skipped) | `settlements.json` `ekatte`                           |

**Invariants the viewer relies on** (skill must guarantee):

1. Every `votes[].id` references a `meta.parties[i].id` — no dangling ids.
2. Every `sections.json` entry has finite `lat`/`lng` (no null, no NaN).
3. `meta.stats.totalValid` is a plausible total (≈ 1,454,357 for 2026 BG election,
   matching CIK's official 8.1 within ≤2) and `totalSections` = 12,719.
4. Running `process.mjs` twice produces byte-identical output (deterministic).
5. `districts.json` / `settlements.json` are derived from `sections.json` — the viewer
   never sums sections itself; it reads the pre-aggregated JSON.
6. Every `districts.geojson` feature names only real districts; choropleth winner
   (argmax of merged votes) equals the per-district lead from `districts.json`.
7. `build-geo.mjs` is deterministic (byte-identical reruns) and drops sub-hectare
   sliver parts from the upstream boundaries.
8. `32. Извън страната` intentionally has no polygon (votes abroad); settlements with
   6-digit EKATTEs fall back to circle markers.

If the skill changes an output schema, **update the viewer and this table together**.

## Front end (vanilla JS)

- **Entry:** `index.html` loads Leaflet 2.0 via an importmap
  (`cdn.jsdelivr.net/npm/leaflet@2.0.0-beta.1`) and the bundled `app.min.js` as an
  ESM module (`type="module"`). In source, `app.js` imports Leaflet classes by name
  (`LeafletMap`, `TileLayer`, `LayerGroup`, `CircleMarker`, `GeoJSON`); markercluster
  is vendored locally at `vendor/leaflet.markercluster/`. No bundler in the editor
  story — the bundle only exists as the generated artifact.
- **Minified bundle:** `index.html` loads `app.min.js` and `style.min.css`, both
  **committed generated artifacts** (like `data/*.json`) produced by
  `scripts/minify.mjs` with esbuild (`npx` on demand): `app.js` bundles
  `app.js` + `app-core.js` + the vendored markercluster into one minified
  file, `leaflet` kept external for the importmap; `style.css` is minified in
  place. After editing any source file, regenerate with
  `node scripts/minify.mjs app.js style.css`.
  `scripts/serve.mjs` warns if `app.min.js` is older than its sources. The
  `deploy.yml` job re-runs the bundle step before the Pages upload.
- **Data loading:** `fetch('./data/*.json')`. Preview locally with
  `node scripts/serve.mjs`; opening via `file://` breaks fetch, so the `app.js` status
  line tells the user to start the server. GitHub Pages is the intended host.
- **Theme:** light/dark toggle (top-right, sun/moon icons) in the topbar. The
  initial theme is resolved before first paint (stored choice → OS preference →
  light), persisted to `localStorage`, and OS changes are followed while no explicit
  choice is set. Palette lives in CSS variables (`:root` / `:root[data-theme="dark"]`).
- **Layers:** district choropleth + settlement choropleth from
  `data/districts.geojson` / `data/settlements.geojson`, with optional circle markers
  / markercluster on top (toggle "Точкови маркери"); a filterable, sortable table
  (row-unit switch: regions ↔ settlements).
- **State:** one global state object; a few `addEventListener`s + a `render()` —
  reactivity without a framework.

## CI / deploy

GitHub Pages serves this as a static site.
- Simplest: Pages from the `main` branch root — just push.
- Or a `deploy.yml` workflow that (a) validates the committed `data/*.json`
  invariants + choropleth geometry + unit tests, (b) bundles `app.js` (+
  `app-core.js` + vendored markercluster) into `app.min.js` via
  `scripts/minify.mjs` (esbuild via `npx`), then (c) uploads the repo
  (including the freshly built bundle).

Deploying to a sub-path (e.g. `/cik-results-map/`)? Keep fetch paths relative
(`./data/*.json`), not absolute.

## Conventions & rules

- **Never commit** `exports/`, `node_modules/`, `dist/` (enforced by `.gitignore`).
- CSVs are UTF-8 and `;`-delimited — **do not transcode** (the CIK docs mention
  Windows-1251, but the exports are UTF-8).
- Keep `data/*.json` **committed but regenerable**; commit regenerated files
  alongside any change to the owning script (`process.mjs` → `data/*.json`,
  `build-geo.mjs` → `data/*.geojson`).
- **Harness (pi):** this repo's domain knowledge lives in the skills
  (`cik-processing` for the CIK pipeline, `geo-processing` for the choropleth
  geometry) — consult them before editing either pipeline. 
  - Optionally wire a
    **hook** (pre-commit or pi hook) that runs `process.mjs`, `build-geo.mjs`, `check-geo.mjs`,
    and `validate-data.mjs` (skipping the first two if `exports/` is missing) and checks
    the JSON is in sync, so committed data never drifts from the scripts. 
  - Note: the
    GitHub deploy workflow does not run `process.mjs` or `build-geo.mjs` because the raw
    exports are gitignored; it only validates the committed data with `validate-data.mjs`
    and `check-geo.mjs`.
- **OpenSpec:** the project uses OpenSpec for software design specifications (SDD); it must be installed on the system and in any agent/project working on changes.
- Backlog and feature requests are tracked as GitHub Issues (`gh issue list --repo akamburov/cik-results-map`); consult before starting new work.
- User-facing strings, party names, and region names are **Bulgarian**; code
  identifiers and comments are English.

## Verification

Covered by the `cik-processing` skill. In short: `meta.stats.totalSections` = 12,719
and `meta.stats.totalValid` ≈ 1,454,357 (official 8.1 = 1,454,359), every
`sections.json` entry has finite coords (12,364 of 12,719 sections; no-coord
sections are still counted in the totals), and all `votes` party `id`s exist in
`meta.parties`. Running the skill's `process.mjs` twice yields identical output.

Choropleth geometry: `node .agents/skills/geo-processing/scripts/check-geo.mjs`
(districts covered once, winners match, coordinates sane, settlement coverage ≥ 95%).
Run it after any change to `build-geo.mjs` or `data/*.geojson`.


