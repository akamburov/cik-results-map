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

All data is **pre-aggregated at build time** into compact JSON (`public/data/`),
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
│   └── scripts/process.mjs   # CSV → public/data/*.json (dependency-free)
├── index.html                # static entry point
├── app.js                    # vanilla-JS app (map + table + filters)
├── style.css
├── scripts/
│   └── serve.mjs             # tiny local static server for preview (Node built-ins)
├── public/data/              # GENERATED aggregates (committed, small)
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

Open the page and it fetches the JSON from `public/data/` and renders the map + table.
No compile, no dependencies, no dev-server tooling.

## Data source & files

Official open data from the Central Election Commission (ЦИК), "Актуализирана база
данни" from 25.10.2026, published under the PSI Directive 2003/98/EC. Raw files:

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

Code: MIT. Data © Central Election Commission (ЦИК), provided under the PSI
Directive 2003/98/EC — see the original `readme` in the export for reuse terms.

[Leaflet]: https://leafletjs.com
