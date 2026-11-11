---
name: geo-processing
description: >-
  Build and verify the choropleth boundary geometry for the Bulgarian election map:
  turn raw BG boundary GeoJSON into the `data/*.geojson` files the viewer draws, and
  check them against the election aggregates. Use when the user asks to (re)build the
  map polygons, add/refactor the district or settlement choropleth, fix a district with
  a missing/wrong polygon, refresh boundaries, or debug why a polygon is uncoloured.
  Covers the boundary sources, the province/municipality → electoral-district mapping,
  the dependency-free Node scripts (bundled here: `scripts/build-geo.mjs`,
  `scripts/check-geo.mjs`), the output schema, and verification.
---

# Choropleth Geometry Processing

Build the polygon layer the vanilla-JS site draws under/around the election results.
Everything here is **dependency-free Node** (built-ins only): no turf, no GDAL, no
`npm install`.

## When to use this skill

- (Re)building `data/districts.geojson` / `data/settlements.geojson`.
- Refreshing the boundary source or switching providers (licensing, resolution).
- Adding a new polygon layer (e.g. municipalities) or changing what a feature carries.
- Debugging an uncoloured district, a district drawn twice, or stray dots/slivers.
- Checking that the choropleth winner matches the aggregated election winner.

## The data sources

### Boundaries (raw, gitignored)

Fetch from [`yurukov/Bulgaria-geocoding`](https://github.com/yurukov/Bulgaria-geocoding)
(compiled from NSI / AGCC open data) and put the GeoJSON in `exports/geo/`:

| File | Content | Key properties |
|---|---|---|
| `provinces.geojson` | 28 provinces (NUTS3) | `nuts3` (e.g. `SOF`, `SFO`, `PDV`) |
| `municipalities.geojson` | 265 municipalities (NUTS4) | `nuts3`, `nuts4` (e.g. `PDV22`) |
| `settlements.geojson` | settlement land zones | `ekatte` (5-digit string) |

⚠️ **Licensing caveat:** that repository carries **no explicit license file**. Treat the
derived `data/*.geojson` as *unverified for redistribution* until confirmed, or switch to
open-data.bg / НСИ request boundaries and update this document.

`exports/geo/rpu_sofia.geojson` and `municipalities.csv` may also be present; they are
reference material for the Sofia/Пловдив splits, not script inputs.

### Election aggregates (generated, committed)

Produced by the **`cik-processing` skill** — run that first:

- `data/settlements.json` — determines *which* EKATTEs need polygons.
- `data/districts.json` — canonical 32 electoral-district names (`name`).
- `data/sections.json` — per-section results (used by the verifier to recompute winners).

## The province → electoral-district mapping

Bulgaria has 28 provinces but **32 electoral districts**, so the mapping is not 1:1:

- **26 provinces → 1 district each**, by NUTS3 code (`NUTS3_TO_DISTRICT` in
  `build-geo.mjs`). District names must match `data/districts.json` `name` verbatim,
  e.g. `SFO` → `26. СОФИЯ област`, `SZR` → `27. СТАРА ЗАГОРА` (the codes are not
  alphabetical — check the map, don't guess).
- **ПЛОВДИВ → 2 districts**: `16. ПЛОВДИВ град` = municipality `PDV22`; `17. ПЛОВДИВ
  област` = `PDV` province polygon with an interior hole cut out for `PDV22`.
- **СОФИЯ (столица) → 3 districts, one polygon**: `23/24/25 СОФИЯ … ИР` share the `SOF`
  province polygon; the feature carries all three names in `properties.districts[]`
  and the viewer merges their votes for the fill colour.
- **`32. Извън страната`** (votes abroad) has **no polygon** — by design.

## The pipeline

`scripts/build-geo.mjs` (bundled here) is the only build step. It:

1. Reads `provinces.geojson` + `municipalities.geojson` and emits one feature per
   district (see mapping above).
2. Rounds coordinates to 4 decimals (≈11 m — plenty at choropleth zoom) and **drops
   sliver parts** whose outer ring is < `1e-6 deg²` (~1 ha); the upstream boundaries
   contain a handful of topology-cleanup artefacts that otherwise render as stray dots.
   A single-part MultiPolygon collapses to a Polygon.
3. Reads `data/settlements.json` and emits one settlement land polygon per cadastral
   territory. A territory can cover several settlements: its `properties.ekatte` is set
   to the one with the most polled votes (so towns / municipal centres like
gr. Костенец
   claim the shared polygon — see `contains` below), and every member name is listed in
   `properties.members` when there is more than one. Territories with no polled section
   at all are kept and marked `uncounted: true` so the choropleth has no holes.
4. Writes `data/districts.geojson` and `data/settlements.geojson`
   (`JSON.stringify`, no pretty-printing, deterministic ordering).

### Run

From the repo root (paths default to `./exports/geo` and `./data`):

```bash
node .agents/skills/geo-processing/scripts/build-geo.mjs
node .agents/skills/geo-processing/scripts/build-geo.mjs \
  --in ./exports/geo --out ./data
```

`--out` is also the directory `settlements.json` is read from. Both paths default
relative to the **current working directory**, so the skill is portable.

Then verify (exit code 1 on any failure):

```bash
node .agents/skills/geo-processing/scripts/check-geo.mjs
node .agents/skills/geo-processing/scripts/check-geo.mjs --data ./data
```

Previewing the site is a separate, repo concern — `node scripts/serve.mjs`.

## Output schema

Both files are plain WGS84 `FeatureCollection`s (lon/lat order, Leaflet-ready).

### `data/districts.geojson`

```json
{ "type": "FeatureCollection", "features": [
  { "type": "Feature",
    "properties": { "districts": ["01. БЛАГОЕВГРАД"] },
    "geometry": { "type": "Polygon", "coordinates": [[[lon, lat], …]] } }
] }
```

- `properties.districts[]` — one name, except the merged Sofia feature with three.
  Every name **must** exist in `data/districts.json`.
- Geometry is `Polygon` or `MultiPolygon`; no other properties by design.
- Current output: **29 features** covering 31/31 domestic districts (26 provinces +
  2 Пловдив + 1 merged Sofia).

### `data/settlements.geojson`

```json
{ "type": "FeatureCollection", "features": [
  { "type": "Feature", "properties": { "ekatte": "68134" }, "geometry": { … } }
] }
```

- `properties.ekatte` — 5-digit EKATTE. Joins `data/settlements.json` `ekatte` for
  polled territories. Cadastral territories that cover several settlements are keyed by
  the one with the most polled votes (upstream `contains` is resolved here); extra
  members appear in `properties.members`.
- `properties.uncounted` — `true` for cadastral territories where no polling section
  was opened (deserted hamlets like с. Подгорие). These are absent from
  `data/settlements.json` by design; the viewer shades them with a grey hatch pattern
  so the map stays gapless.
- Current output: **4,623 polygons** — 4,056 polled (98.3% of 5-digit EKATTEs) + 567
  uncounted. The 451 six-digit (post-2015 / abroad) EKATTEs have no published polygons
  anywhere; the viewer falls back to circle markers for them.

## Verification (`check-geo.mjs`)

1. Every **domestic** district is covered by exactly one feature; `32. Извън страната`
   has none. No feature names an unknown district.
2. Per-district winner recomputed from `sections.json` == `districts.json` `lead`/`valid`.
3. The choropleth colour (argmax of merged votes, Sofia merged) equals that lead — the
   issue #2 acceptance criterion.
4. Coordinates are finite, inside a Bulgaria bbox, and no ring is degenerate.
5. `settlements.geojson` references only known 5-digit EKATTEs (uncounted hatch
   territories exempt), no duplicate polled polygons, and covers ≥ 95% of five-digit
   EKATTEs.

`build-geo.mjs` is deterministic: running it twice yields byte-identical files. If a run
is not reproducible, something is iterating a Map/Set in an unstable way.

## Rules

- **Never commit** `exports/` (gitignored). Commit only the scripts + regenerated
  `data/*.geojson`.
- Changing `build-geo.mjs` means re-running it **and** `check-geo.mjs`, then committing
  the regenerated JSON in the same change; keep this document and the schema in sync.
- The viewer (`app.js`) fetches `./data/districts.geojson` and
  `./data/settlements.geojson` and tolerates their absence (`.catch(() => null)` →
  markers only). If you rename an output, update `app.js`, `readme.md` and `agents.md`
  together.
- Codes/properties in English, district and settlement names in **Bulgarian** (verbatim
  from `data/districts.json` / EKATTE).
