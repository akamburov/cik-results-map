# Cik Results Map / Резултати от изборите

Interactive maps and a filterable table of the **2026 Bulgarian presidential &
vice-presidential election** (first round), built from the open data published by
the Central Election Commission (ЦИК) via `www.cik.bg`.

**No framework, no build step, no backend.** A static site: vanilla JavaScript +
[Leaflet] 2.0 (ESM, importmap) on the front end, fed by JSON generated once by a tiny
dependency-free Node script.

The roadmap lives in the [GitHub Issues](https://github.com/akamburov/cik-results-map/issues);
[agents.md](agents.md) has the architecture notes for agents.

![status](https://img.shields.io/badge/data-25.10.2026-blue)

## What this is

A **static, publicly-deployable web app** that lets you explore election results:

1. **Map** — a district **choropleth** (polygons coloured by the winning party) and
   a settlement choropleth, with optional clustered circle markers on top.
   Clicking a polygon or marker opens that region's/settlement's breakdown.
2. **Table** — a sortable/filterable tabular view (filter by region, settlement,
   party, turnout/margin) that updates the map.

All data is **pre-aggregated at build time** into compact JSON (`data/`),
so the site is fully static and requires no runtime API.

## Tech stack (deliberately minimal)

- **AI-native development:**
  - [Orca ADE](https://www.onorca.dev/)
  - [Pi](https://pi.dev) Agent Harness
  - Models hosted by Munito (DeepSeek V4 and V4.1 Flash, Qwen 3.8 27B, GLM 5.3 Flash) and Google (Gemini 3.8
    Flash)
  - [OpenSpec](https://openspec.dev) for software design specifications (SDD) and the 
- **Front end:** vanilla JavaScript (ESM) + [Leaflet] 2.0 (`2.0.0-beta.1` via an
  importmap from jsDelivr) + [Leaflet.markercluster] vendored at
  `vendor/leaflet.markercluster/`. One `index.html` + `app.js` + `style.css`
  (served minified as `app.min.js`); no React, no bundler, no `npm install`.
- **Preprocessing:** two tiny Node scripts, dependency-free, each bundled in its own
  skill:
  - `.agents/skills/cik-processing/scripts/process.mjs` — CIK CSVs → `data/*.json`
    (uses only `fs` + `readline`).
  - `.agents/skills/geo-processing/scripts/build-geo.mjs` — boundary GeoJSON →
    `data/*.geojson` (choropleth geometry).
- **Hosting:** GitHub Pages (just push the files).

## Project layout

```
├── readme.md                 # this file
├── agents.md                 # architecture overview for agents
├── .agents/skills/
│   ├── cik-processing/
│   │   ├── SKILL.md          # CIK data-processing skill
│   │   └── scripts/process.mjs   # CSV → data/*.json (dependency-free)
│   └── geo-processing/
│       ├── SKILL.md          # choropleth geometry skill
│       └── scripts/
│           ├── build-geo.mjs     # boundary GeoJSON → data/*.geojson
│           └── check-geo.mjs     # verifies geometry against election data
├── index.html                # static entry point (Leaflet 2.0 importmap, loads app.min.js bundle)
├── app-core.js               # pure, dependency-free helpers (map + table logic) — shared by app.js & tests
├── app.js                    # vanilla-JS ESM app (map + table + filters)
├── app.min.js                # GENERATED (committed): bundled + minified (app.js + app-core.js + markercluster)
├── style.css                 # light/dark palette via CSS variables
├── style.min.css             # GENERATED (committed): minified stylesheet loaded by index.html
├── test/
│   └── app-core.test.js      # node:test unit tests for app-core.js (zero-dependency)
├── vendor/
│   └── leaflet.markercluster/  # vendored Leaflet.markercluster (ESM source, bundled at minify time)
├── scripts/
│   ├── serve.mjs             # tiny local static server for preview (Node built-ins)
│   └── minify.mjs            # bundle + minify app.js with esbuild (via npx) → app.min.js
├── data/                     # GENERATED (committed)
│   ├── meta.json
│   ├── sections.json
│   ├── districts.json
│   ├── settlements.json
│   ├── districts.geojson     #   one polygon feature per electoral district
│   └── settlements.geojson   #   settlement land polygons keyed by EKATTE
├── icon.png                  # favicon
├── LICENSE
└── exports/                  # raw CIK export + boundary GeoJSON (gitignored)
```

## Getting started

```bash
# 1) (optional, when refreshing election data) regenerate the aggregates
node .agents/skills/cik-processing/scripts/process.mjs

# 1b) run the unit tests (Node built-in runner — no install)
node --test test/app-core.test.js

# 2) (optional, when refreshing boundaries) rebuild the choropleth geometry,
#    then verify it against the election data
node .agents/skills/geo-processing/scripts/build-geo.mjs
node .agents/skills/geo-processing/scripts/check-geo.mjs

# 3) serve the site locally (any static server works; Pages does it automatically)
node scripts/serve.mjs           # → http://localhost:8000
```

Open the page and it fetches the JSON from `data/` and renders the map + table.
No compile, no dependencies, no dev-server tooling.

`build-geo.mjs` reads its inputs from `exports/geo/` (gitignored, override with `--in`):
`provinces.geojson` (28 NUTS3 provinces), `municipalities.geojson` (265 NUTS4
municipalities) and `settlements.geojson` (settlement land zones keyed by 5-digit
EKATTE). It writes `data/districts.geojson` + `data/settlements.geojson` (override the
directory with `--out`) and reads `data/settlements.json` to know which EKATTEs are
needed. See the `geo-processing` skill for the exact mapping of
provinces/municipalities to the 32 electoral districts, including the Пловдив
град/област split and the merged 23/24/25 София ИР polygon. Output is deterministic:
running it twice yields byte-identical files.

## Data source & files

Full open data from the Central Election Commission (ЦИК), published on
[results.cik.bg](https://results.cik.bg) in machine-readable format (CSV +
electronic spreadsheets) as required by **EU Directive 2019/1024/EU** on open data
and the reuse of public sector information, transposed into Bulgarian law via
*Закон за достъп до обществената информация* (Law on Access to Public Information).
Data source: "Актуализирана база данни" accepted by ЦИК decision
416-ПВР/27.10.2026, processed by Информационно обслужване АД.

The data includes a description of the structure and location of sectional
electoral commissions (секционни избирателни комисии) according to the Unified
Classifier of Administrative-Territorial and Territorial Units (ЕКАТТЕ), enabling
linking with other open datasets.

Raw files:

| File | Rows | Content |
|---|---|---|
| `sections.txt` | 12,719 | Polling sections + GEO coords, region, settlement, flags |
| `votes.txt` | 12,719 | Per-section votes per party (total / paper / machine) |
| `parties.txt` | 27 | Party / initiative-committee register |
| `candidates.txt` | 27 | Candidate lists (president & vice-president) |
| `protocols.txt` | 24,558 | Section protocol forms (reconciliation) |

Generated current numbers (from `meta.json`): **32 electoral regions, 12,364 mapped
sections, 1,439,313 valid votes**.

For the full field maps and how to reprocess a new export, see the
`cik-processing` skill (`.agents/skills/cik-processing/SKILL.md`). For the boundary
geometry, see the `geo-processing` skill (`.agents/skills/geo-processing/SKILL.md`).

## Map layers & choropleth geometry

- **District choropleth** — one polygon per electoral district, filled with the
  winning party's colour. The 26 provinces map 1:1; ПЛОВДИВ is split into
  16 (община Пловдив) and 17 (the remaining municipalities); the three София
  city districts (23/24/25 ИР) share one merged polygon and are hovered/clicked
  as a unit. `32. Извън страната` (votes abroad) has no domestic polygon.
- **Settlement choropleth** — settlement land polygons coloured by winner.
  Coverage is 4,052 of 4,127 five-digit EKATTEs (98.2%); 451 six-digit EKATTEs
  (post-2015 register) have no published polygons and fall back to circle markers.
- **Circle markers / clustering** — toggle "Точки" to overlay the
  aggregated points; settlement markers use Leaflet.markercluster at low zooms.

Boundary source: [`yurukov/Bulgaria-geocoding`](https://github.com/yurukov/Bulgaria-geocoding)
(compiled from NSI / AGCC open data). ⚠️ See "License" section.

`node .agents/skills/geo-processing/scripts/check-geo.mjs` verifies the geometry
before shipping:

1. every domestic district is covered by exactly one polygon (abroad excluded);
2. no feature references an unknown district;
3. per-district winners recomputed from `sections.json` match `districts.json`;
4. the choropleth colour (argmax of votes, merged for Sofia) matches that winner;
5. coordinates are finite WGS84 and no ring is degenerate;
6. `settlements.geojson` only references known EKATTEs and covers ≥ 95% of them.

For choropleth geometry, both scripts also drop sub-hectare sliver polygons that
come from topology cleanup in the upstream boundaries.

## Testing

No framework, no `npm install`: the unit tests use Node's built-in runner.
They cover the **pure** logic in `app-core.js` (formatting, escaping, EKATTE
normalisation, vote aggregation, candidate ordering, table filtering/sorting)
— everything that is deterministic and worth unit-testing. The Leaflet / DOM
rendering is deliberately excluded; it depends on the browser. Run with:

```bash
node --test test/app-core.test.js
```

The `deploy.yml` CI job runs this suite (plus the data/geometry validation
scripts) on every push to `main`.

## Minifying the JS + CSS

`index.html` loads a single bundled + minified `app.min.js` (one file: it
contains `app.js`, `app-core.js`, and the vendored Leaflet.markercluster,
all inlined and minified; `leaflet` stays external, resolved by the
importmap) and a minified `style.min.css`. Both are **committed generated
artifacts** (like `data/*.json`): you edit the source, then regenerate:

```bash
node scripts/minify.mjs app.js style.css
```

This also runs automatically in the `deploy.yml` job before the Pages upload,
so the published site is always current relative to the source. (Locally,
`node scripts/serve.mjs` warns if a generated file is older than its source.)

It uses **esbuild** (a fast bundler + minifier) fetched on demand via `npx`,
so the repository itself stays dependency-free — no `package.json`, no
committed `node_modules`. `.js` entries are bundled (the previously unminified
vendored markercluster gets minified too, cutting the payload roughly in
half, ~113 KB of source → ~49 KB); `.css` entries are minified in place
(~8.9 KB → ~6.8 KB). The two tiny vendored markercluster CSS files and the
Leaflet CDN stylesheet stay as separate `<link>`s — not worth bundling.
The first run downloads esbuild into the npx cache (needs network); later
runs reuse it. For repeatable/pinned builds, install it yourself
(`npm i -g esbuild`) or add it as a devDependency — the repo intentionally
does neither.

## Data integrity

The `cik-processing` skill's `process.mjs` skips sections without usable coordinates and
prints a
reconciliation summary (counted sections, total valid votes, current leader) so a
broken or partial export is obvious before you ship.

## License

Code: **MIT** — see [LICENSE](LICENSE).

Data: published by ЦИК under **EU Directive 2019/1024/EU** (open data and reuse of
public sector information), transposed into Bulgarian law via
*Закон за достъп до обществената информация*. The data is freely reusable without
restriction, including commercially. See the original CIK data page for reuse terms.

Boundary geometry: derived from [`yurukov/Bulgaria-geocoding`](https://github.com/yurukov/Bulgaria-geocoding),
which compiles NSI/AGCC open data but carries **no explicit license**. That repository
carries **no explicit license file** — confirm/seek permission (or use open-data.bg boundaries)
before redistributing the `data/*.geojson` files beyond this project.

[Leaflet]: https://leafletjs.com
[Leaflet.markercluster]: https://github.com/Leaflet/Leaflet.markercluster
