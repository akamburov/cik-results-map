# agents.md — engineering guide for coding agents

This file is the single source of truth for any agent (pi, Codex, Claude, GitHub
Copilot, etc.) working in this repository. **Read it before making changes.**

## TL;DR

- **What:** a static web app visualizing the 2026 Bulgarian presidential election
  results on a map + a filterable table.
- **Stack:** vanilla JS + Leaflet (CDN) front end; one dependency-free Node script
  (`scripts/process.mjs`) that preprocesses CIK CSVs into committed JSON.
  **No framework, no build step, no backend, no `npm install`.**
- **Rule of thumb:** *never commit the raw export* (`Exports/` is gitignored);
  commit only source + generated `public/data/*.json`.
- **Order matters:** run `node scripts/process.mjs` (if data changed) **before**
  anything that reads the JSON — the page loads JSON, not CSVs.

---

## 1. Repository layout

```
cik-results-map/
├── readme.md                  # public-facing docs (users)
├── agents.md                  # this file (agents)
├── .gitignore                 # ignores Exports/, node_modules, dist
├── index.html                 # static entry point (<script src="app.js">)
├── app.js                     # vanilla-JS app: map + table + filters
├── style.css
├── scripts/
│   ├── process.mjs           # CSV → public/data/*.json (Node built-ins only)
│   └── serve.mjs             # preview: node scripts/serve.mjs [port] (Node built-ins)
├── public/data/               # GENERATED (committed): JSON the page loads
│   ├── meta.json              # election label, parties, candidates, colors, stats
│   ├── sections.json          # per-section geo rows w/ per-party votes
│   ├── districts.json         # aggregate per electoral region (32 units)
│   └── settlements.json       # aggregate per settlement (by EKATTE)
└── Exports/                   # RAW, gitignored — do not commit
    └── processed/<Актуализирана база данни>/   # extracted CSVs
```

## 2. Data model (schema of generated JSON)

All files are written by `scripts/process.mjs` with **deterministically sorted keys**
(reviewable diffs) and no pretty-printing.

### `public/data/meta.json`
```jsonc
{
  "election": "Президент и вицепрезидент 10.2026 г., тур 1",
  "dataDate": "25.10.2026",
  "parties":     [ { "id": "1", "name": "ИК за …" } ],
  "candidates":  [ { "partyId": "1", "partyName": "…", "listNo": "1", "name": "…" } ],
  "partyColors": { "1": "hsl(137.5,65%,45%)", … },   // deterministic golden-angle palette
  "stats": {
    "sectionsWithCoords": 12364,
    "countedSections": 12364,
    "uncountedSections": 0,
    "totalValid": 1439313,
    "leader": { "id": "25", "votes": 522628 }
  }
}
```

### `public/data/sections.json`
Array of sections that have **finite** coordinates (map point layer). Per-party
votes are stored **nonzero only** to stay compact:
```jsonc
[{
  "id": "010100001",
  "district": "1",          // district id (01–28)
  "region": "01. БЛАГОЕВГРАД",
  "ekatte": "02676",
  "settlement": "гр.Банско",
  "lon": 23.49, "lat": 41.84,
  "mobile": false, "sea": false, "machines": 1,
  "valid": 226,
  "votes": { "4": 78, "11": 23, … },   // partyId -> total valid votes
  "lead": { "id": "4", "votes": 78 }   // null if no votes
}]
```

### `public/data/districts.json`
Per **electoral region** aggregate (name like `01. БЛАГОЕВГРАД` … `32. Извън
страната`), with a centroid coordinate (mean of section coords) for the circle layer:
```jsonc
[{
  "name": "01. БЛАГОЕВГРАД",
  "sections": 430, "counted": 430, "valid": 0,
  "lon": 23.49, "lat": 41.84,
  "lead": { "id": "4", "votes": 0 } | null,
  "votes": { "4": 0, … }
}]
```

### `public/data/settlements.json`
Same shape as districts but grouped by EKATTE; includes a few sample `sectionIds`
for linking. Sorted descending by `valid`.

## 3. CIK CSV field maps (from `readme_25.10.2026.txt`)

Files are **UTF-8, `;`-delimited**. The extraction folder is
`Exports/processed/<Актуализирана база данни>/` with date-suffixed names
(e.g. `votes_25.10.2026.txt`). `process.mjs` globs subfolders to find them — it does
**not** hardcode the date.

### `sections.txt` fields
1. full section code `RR MM AA SSS` (2+2+2+3)
2. district id (`01`–`28`)
3. electoral region name
4. EKATTE settlement code
5. settlement / country name
6. address
7. **longitude**
8. **latitude**
9. mobile-section flag (0/1)
10. sea-section flag (0/1)
11. machine count (optional; absent on some rows → 11 fields)

Notes:
- Keep only rows where **both** coords `parseFloat` to finite numbers.
- Abroad sections have negative longitudes. ~15 foreign rows have a malformed layout
  (coordinate shifted into the wrong slot) — correctly skipped by the finite-coord check.
- Inland bbox ≈ lon 22.3–28.6, lat 41.2–44.2.

### `votes.txt`
`section;adminUnit;` then for each party (ordered 1..27), six fields:
`partyNo; totalValid; paperValid; machineValid; machine1Valid; machine2Valid`.
Each line = `2 + 27*6 = 164` fields — **parse as fixed 6-tuples**, don't guess.

### `parties.txt` / `candidates.txt`
`id;name` and `partyId;partyName;listNo;candidateName`. Candidates are
president+vice-president pairs (one list entry each).

### `protocols.txt`
One line per protocol **form** (24,558 lines > 12,719 sections — multiple forms per
section). Field 1 = form number (`24/26/28/30` paper, `25/29` machine, `32/41`
machine-summary), field 2 = section code. **Use it only for reconciliation**, not as
the primary vote source (the current pipeline intentionally uses `votes.txt`).

## 4. Processing pipeline

`scripts/process.mjs` is the only preprocessing step. It:
1. Scans `Exports/processed/` recursively for the CSVs (ignoring any `suemg/` folder).
2. Streams them with Node's `readline` (built-in, no deps).
3. Joins `votes.txt` per-section data onto `sections.txt` rows (by section code).
4. Aggregates into regions + settlements; assigns a deterministic color per party.
5. Writes the four JSON files, printing a reconciliation summary
   (parties, counted sections, total valid, current leader).

Run it after refreshing data. There is **no build step** anywhere else.

## 5. Front end (vanilla JS)

- **Entry:** `index.html` loads Leaflet from a CDN (`//unpkg.com/leaflet@1.9.x`) and
  `app.js`. No modules bundler — keep `<script>` plain; `app.js` can be a classic
  script (no `import`/`export`) for widest compatibility with `file://` opening.
- **Data loading:** `fetch('./public/data/*.json')`. Use `node scripts/serve.mjs`
  to preview locally (or any static server). Opening via `file://` breaks fetch on most
  browsers — the status line in `app.js` tells the user how to fix it. GitHub Pages is the
  intended host.
- **Layers:**
  - District circle layer from `districts.json` (centroid, colored by leader).
  - Optional section marker layer (from `sections.json`) — toggle + cluster to keep
    the 12k points usable.
  - Table from `districts.json` / `settlements.json` / `sections.json` depending on
    the selected row-unit.
- **State:** one global state object; a single `render()` re-paints the table and
  filters the map. Achieves reactivity with a few `addEventListener`s — no framework.

## 6. CI / deploy

GitHub Pages can serve this **with zero build** (it's already static). Options:
- Default Pages from the repo's `main` branch root (simplest — just push).
- Or a `deploy.yml` Actions workflow that (a) runs `node scripts/process.mjs`,
  (b) asserts output, (c) uploads `public/` + `index.html` as the pages artifact.

Keep `vite`-style base-path concerns in mind only if you deploy to a sub-path like
`/cik-results-map/` (then make fetch paths relative, not absolute).

## 7. Conventions & rules for agents

- **Never commit** `Exports/`, `node_modules/`, `dist/` (enforced by `.gitignore`).
- Raw CSVs use `;` and the files are already UTF-8 — **do not transcode** them
  (CIK docs mention Windows-1251, but these exports are UTF-8).
- Keep `public/data/*.json` **committed but regenerable**; commit regenerated files
  alongside any `process.mjs` change.
- **Harness (pi):**
  - Use the **skills** system only for discoverable one-off tasks (e.g.
    `find-skills`); this repo needs no special skills.
  - Optionally wire a **hook** (pre-commit or pi hook) that runs `node
    scripts/process.mjs` and checks the JSON is in sync, so the committed data never
    drifts from the script.
  - Keep this file's schema sections (§2, §3) in sync whenever `process.mjs` changes
    its output — treat them as the canonical spec.
  - Reference `readme.md`/`agents.md`, don't duplicate constants in `app.js`.
- All **user-facing strings, party names, and region names are Bulgarian**; code
  identifiers and comments are English.

## 8. Verification

`scripts/process.mjs` prints a summary you can eyeball. To spot-check:
- `public/data/meta.json` `stats.totalValid` should be a plausible (~1.4M).
- `stats.sectionsWithCoords` should be near 12.4k; every entry in `sections.json`
  must have finite `lon`/`lat`.
- Every party `id` in `votes` maps to an id in `meta.parties`.
- Leader id in `districts.json`/`sections.json` must exist in `meta.parties`.

A future `tests/` (e.g. `node --test`) can automate these; not yet added.

## 9. Current state / next steps

- [x] Data understanding captured (§3 reflects ground truth).
- [x] `scripts/process.mjs` → JSON (32 regions, ~12.4k mapped sections, ~1.44M votes).
- [x] Project scaffolding (`index.html`/`app.js`/`style.css`) and docs.
- [ ] Polish the vanilla-JS app (clustering, choropleth with external district GeoJSON,
      section/settlement row-unit switching).

Beware: `app.js`/`index.html`/`style.css` may be minimal or placeholder shells until
the front-end is completed.
