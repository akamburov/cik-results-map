---
name: cik-processing
description: >-
  Process the Bulgarian Central Election Commission (ЦИК) "Актуализирана база данни"
  export into the compact JSON the static map/table site consumes. Use when the user
  asks to (re)generate the data, refresh election results, explain the CIK CSV formats,
  add or change the output schema, run the preprocessing, or debug the aggregation.
  Covers the CIK CSV field maps, the extraction of the zip, the dependency-free Node
  pipeline (bundled in this skill: `scripts/process.mjs`), the output JSON schema, and
  verification.
---

# CIK Election Data Processing

Convert the raw CIK election export into the `data/*.json` files the vanilla-JS
site loads. Everything here is **dependency-free Node** (built-ins only) and there is no
framework or build step.

## When to use this skill

- Regenerating or refreshing the data after a new CIK export arrives.
- Explaining what a CIK CSV field means or how a row is laid out.
- Adding/changing an output file or its schema.
- Debugging why a section is missing from the map or a total looks wrong.

## The data source

The raw export is a zip (e.g. `Exports/export-pvr202610-tur1.zip`). It contains two
folders:

- **`Актуализирана база данни/`** — the CSV files we use. Extract **this** folder.
- **`suemg/`** — ballot-scan images. **Never** extract or process this.

The CIK publishes a `readme_*.txt` inside that folder describing every file; that readme
is the authoritative field spec. Files are **UTF-8, `;`-delimited**. Despite CIK docs
mentioning Windows-1251, the actual exports are UTF-8 — **do not transcode**.

Extraction target: `Exports/processed/<Актуализирана база данни>/` (gitignored).

```bash
unzip -o Exports/export-pvr202610-tur1.zip "Актуализирана база данни/*" -d Exports/processed
```

## Files in the export

| File | Rows | Content |
|---|---|---|
| `cik_parties.txt` | 27 | Party / initiative-committee (P/IK) register |
| `cik_candidates.txt` | 27 | Candidate lists (president & vice-president) |
| `sections.txt` | 12,719 | Polling sections + GEO coords, region, settlement, flags |
| `votes.txt` | 12,719 | Per-section votes per party (total / paper / machine) |
| `protocols.txt` | 24,558 | Section protocol forms (reconciliation only) |

## CIK CSV field maps

`process.mjs` globs `Exports/processed/` recursively to find these (date-suffixed names
like `votes_25.10.2026.txt`) — it does **not** hardcode the date.

### `cik_parties.txt`
`id;name` — the party/coalition/IC register. `name` may contain `–` (party –
full candidate names).

### `cik_candidates.txt`
`partyId;partyName;listNo;candidateName` — one row per president+vice pair.

### `sections.txt` (field index)
1. full section code `RR MM AA SSS` (2+2+2+3)
2. district id (`01`–`28`)
3. electoral region name (e.g. `01. БЛАГОЕВГРАД` … `32. Извън страната`)
4. EKATTE settlement code
5. settlement / country name
6. address
7. **longitude**
8. **latitude**
9. mobile-section flag (0/1)
10. sea-section flag (0/1)
11. machine count (optional — absent on some rows → 11 fields)

Notes:
- Keep only rows where **both** coords parse to finite numbers.
- Abroad sections have negative longitudes; inland bbox ≈ lon 22.3–28.6, lat 41.2–44.2.
- ~15 foreign rows have a malformed layout (a coordinate shifted into the wrong slot) —
  they fail the finite-coord check and are correctly skipped.

### `votes.txt`
`section;adminUnit;` then, for each party in order 1..N (N = party count, 27 here),
**six fields**: `partyNo; totalValid; paperValid; machineValid; machine1Valid;
machine2Valid`. With 27 parties each line = `2 + 27*6 = 164` fields — **parse as fixed
6-tuples starting at field 2**, don't guess or split naively.

### `protocols.txt`
One line per protocol **form** (more lines than sections — multiple forms per section).
Field 1 = form number, field 2 = section code.
- `24/26/28/30` = paper variants, `25/29` = machine, `32/41` = machine-summary.
- **Use it only for reconciliation**, not as the primary vote source.

## The pipeline

`process.mjs` (bundled in this skill at `scripts/process.mjs`) is the only
preprocessing step. It:
1. Scans `Exports/processed/` recursively for the CSVs (ignoring any `suemg/` folder).
2. Streams them with Node's `readline` (built-in, no deps).
3. Joins `votes.txt` per-section data onto `sections.txt` rows (by section code).
4. Aggregates into electoral regions + settlements; assigns a deterministic color per
   party (golden-angle hue).
5. Writes the four JSON files (deterministically sorted keys, no pretty-printing).
6. Prints a reconciliation summary (parties, counted sections, total valid, leader).

### Run

From the repo root (paths default to `./Exports/processed` and `./data`):

```bash
node .agents/skills/cik-processing/scripts/process.mjs
node .agents/skills/cik-processing/scripts/process.mjs \
  --in ./Exports/processed --out ./data
```

Because the script reads paths from `--in`/`--out` (defaulting relative to the current
working directory), the skill is portable: copy it anywhere and pass explicit paths.
There is **no build step** anywhere else; the page loads JSON, not CSVs. (Previewing the
site is a separate, repo concern — `node scripts/serve.mjs`.)

## Output schema (data/*.json)

### `meta.json`
`{ election, dataDate, parties:[{id,name}], candidates:[{partyId,partyName,listNo,name}],
partyColors:{id:"hsl(...)"}, stats:{ sectionsWithCoords, countedSections, uncountedSections,
totalValid, leader:{id,votes} } }`.

### `sections.json`
Array of sections with **finite** coords. Per-party votes stored **nonzero only**:
`{ id, district, region, ekatte, settlement, lon, lat, mobile, sea, machines, valid,
votes:{partyId:total}, lead:{id,votes}|null }`.

### `districts.json`
Per **electoral region** aggregate (32 units incl. `32. Извън страната`) with a centroid
(mean of section coords):
`{ name, sections, counted, valid, lon, lat, lead:{id,votes}|null, votes:{partyId:total} }`.

### `settlements.json`
Same shape as `districts.json` but grouped by EKATTE, plus a `region` field (the
settlement's electoral region, same string as `districts.json` `name`) used by the
viewer to disambiguate same-named settlements; sorted descending by `valid`.

A settlement almost always sits in one region. `гр.София` (EKATTE 68134) is the
exception — its sections span 23/24/25 ИР, so its `region` is the collapsed label
`СОФИЯ 23, 24, 25 ИР` (not just the first-seen `23. СОФИЯ 23 ИР`).

## Verification

`process.mjs` prints a summary; also eyeball:
- `meta.stats.totalValid` is plausible (~1.4M for the 2026 export).
- `meta.stats.sectionsWithCoords` ≈ 12.4k; every `sections.json` entry has finite
  `lon`/`lat`.
- Every party `id` in any `votes` maps to an id in `meta.parties`.
- `lead.id` in `districts.json`/`sections.json` exists in `meta.parties`.
- Running `process.mjs` twice yields identical output (determinism).

## Rules

- **Never commit** `Exports/` (it is gitignored). Commit only source + regenerated
  `data/*.json`.
- When you change `process.mjs`, re-run it and commit the regenerated JSON in the same
  change; keep the output schema above in sync with the code.
- User-facing strings, party names, and region names are **Bulgarian**; code identifiers
  and comments are English.
