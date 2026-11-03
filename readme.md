# Cik Results Map / Резултати от изборите

Interactive maps and a filterable table of the **2026 Bulgarian presidential &
vice-presidential election** (first round), built from the open data published by
the Central Election Commission (ЦИК) via `www.cik.bg`.

**No framework, no build step, no backend.** A static site: vanilla JavaScript +
[Leaflet] (from CDN) on the front end, fed by JSON generated once by a tiny
dependency-free Node script.

![status](https://img.shields.io/badge/data-25.10.2026-blue)

## What this is

A **static, publicly-deployable web app** that lets you explore election results:

1. **Map** — geo-visualize results per polling **section** (markers) and as
   **electoral-region** aggregates (circle layer over Bulgaria), using the
   coordinates embedded in the CIK `sections` dataset.
2. **Table** — a sortable/filterable tabular view (filter by region, settlement,
   party, turnout/margin) that updates the map.

All data is **pre-aggregated at build time** into compact JSON (`data/`),
so the site is fully static and requires no runtime API.

## Tech stack (deliberately minimal)

- **Front end:** vanilla JavaScript + [Leaflet] via CDN, one `index.html` + `app.js`
  + `style.css`. No React, no bundler, no `npm install`.
- **Preprocessing:** a single Node script in the `cik-processing` skill
  (`.agents/skills/cik-processing/scripts/process.mjs`), using only Node built-ins
  (`fs` + `readline`). It turns the CIK CSVs into the JSON the page loads.
- **Hosting:** GitHub Pages (just push the files).

## Project layout

```
├── readme.md                 # this file
├── agents.md                 # architecture overview for agents
├── .agents/skills/cik-processing/
│   ├── SKILL.md              # CIK data-processing skill
│   └── scripts/process.mjs   # CSV → data/*.json (dependency-free)
├── index.html                # static entry point
├── app.js                    # vanilla-JS app (map + table + filters)
├── style.css
├── scripts/
│   └── serve.mjs             # tiny local static server for preview (Node built-ins)
├── data/                   # GENERATED aggregates (committed, small)
│   ├── meta.json
│   ├── sections.json
│   ├── districts.json
│   └── settlements.json
└── Exports/                  # raw CIK export (gitignored — not committed)
```

## Getting started

```bash
# 1) (optional, when refreshing data) regenerate the JSON from the raw export
node .agents/skills/cik-processing/scripts/process.mjs

# 2) serve the site locally (any static server works; Pages does it automatically)
node scripts/serve.mjs           # → http://localhost:8000
```

Open the page and it fetches the JSON from `data/` and renders the map + table.
No compile, no dependencies, no dev-server tooling.

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
`cik-processing` skill (`.agents/skills/cik-processing/SKILL.md`).

## Data integrity

The `cik-processing` skill's `process.mjs` skips sections without usable coordinates and
prints a
reconciliation summary (counted sections, total valid votes, current leader) so a
broken or partial export is obvious before you ship.

## Roadmap

- [x] Preprocessing pipeline (`scripts/process.mjs`) → JSON
- [x] Vanilla-JS site shell (map + filterable table)
- [ ] Section marker clustering & district choropleth (with an external BG district GeoJSON)
- [ ] GitHub Actions auto-deploy to Pages on push
- [ ] README screenshots + live demo link

## License

Code: **MIT** — see [LICENSE](LICENSE).

Data: published by ЦИК under **EU Directive 2019/1024/EU** (open data and reuse of
public sector information), transposed into Bulgarian law via
*Закон за достъп до обществената информация*. The data is freely reusable without
restriction, including commercially. See the original CIK data page for reuse terms.

[Leaflet]: https://leafletjs.com
