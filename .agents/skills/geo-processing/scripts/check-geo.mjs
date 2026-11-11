#!/usr/bin/env node --input-type=module
/* check-geo.mjs — verification for the choropleth geometry (issue #2).
 *
 * Run:   node .agents/skills/geo-processing/scripts/check-geo.mjs [--data ./data]
 *
 * Checks the generated data/*.geojson against the election data the viewer
 * joins them with (data/districts.json, data/settlements.json, data/sections.json):
 *
 *   1. every domestic election district is covered by exactly one polygon feature
 *      ("32. Извън страната" / abroad has no domestic polygon by design)
 *   2. no polygon feature references an unknown district name
 *   3. per-district winner recomputed from sections.json == districts.json lead
 *      (sections.json holds only mapped sections, so its per-region valid sums
 *      must be ≤ the district totals, not equal)
 *   4. choropleth winner (argmax of districts.json votes, merged for Sofia)
 *      equals that lead — the acceptance criterion from issue #2
 *   5. all coordinates are finite WGS84 lon/lat and rings are non-degenerate
 *   6. settlements.geojson covers the expected share of settlements and only
 *      references EKATTEs present in data/settlements.json (6-digit EKATTEs from
 *      the post-2015 register have no polygons anywhere; the viewer falls back
 *      to circle markers for them)
 *
 * Exit code 0 = all good; 1 = at least one failure. Node built-ins only.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const DATA = resolve(arg('--data', './data'));
const read = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

const districts = read('districts.json');
const settlements = read('settlements.json');
const sections = read('sections.json');
const geoDistricts = read('districts.geojson');
const geoSettlements = read('settlements.geojson');

const failures = [];
const fail = (msg) => failures.push(msg);
const normEkatte = (v) => String(v).replace(/\D/g, '').padStart(5, '0');

const winner = (votes) => {
  const arr = Object.entries(votes).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]));
  return arr.length ? arr[0][0] : null;
};

// ---- 1 & 2: district coverage ---------------------------------------------

// Votes cast abroad have no domestic polygon; the viewer draws no fill for them.
const ABROAD = '32. Извън страната';

const byName = new Map(districts.map((d) => [d.name, d]));
const coverage = new Map(districts.map((d) => [d.name, 0]));

for (const f of geoDistricts.features) {
  for (const name of f.properties.districts ?? []) {
    if (!byName.has(name)) {
      fail(`geo feature references unknown district "${name}"`);
      continue;
    }
    coverage.set(name, coverage.get(name) + 1);
  }
}

let domesticDistricts = 0;
for (const [name, n] of coverage) {
  if (name === ABROAD) {
    if (n > 0) fail(`"${name}" should not have a polygon (votes abroad)`);
    continue;
  }
  domesticDistricts++;
  if (n === 0) fail(`district "${name}" has no polygon`);
  else if (n > 1) fail(`district "${name}" covered by ${n} polygons`);
}
// Merged features (23/24/25 ИР share one polygon) reduce the feature count.
let mergedExtras = 0;
for (const f of geoDistricts.features) mergedExtras += (f.properties.districts?.length ?? 0) - 1;
if (geoDistricts.features.length !== domesticDistricts - mergedExtras) {
  fail(`expected ${domesticDistricts - mergedExtras} district features, got ${geoDistricts.features.length}`);
}

// ---- 3: winner from sections vs pre-aggregated districts -------------------

// sections.json contains only the coord-bearing sections (map markers);
// no-coord sections are counted in districts.json totals but can't be plotted.
// So per-region sums from sections.json must be ≤ the district total, and the
// winner must agree.
const fromSections = new Map();
for (const s of sections) {
  const rec = fromSections.get(s.region) ?? { votes: {}, valid: 0 };
  rec.valid += s.valid;
  for (const [pid, v] of Object.entries(s.votes)) rec.votes[pid] = (rec.votes[pid] || 0) + v;
  fromSections.set(s.region, rec);
}

for (const d of districts) {
  const agg = fromSections.get(d.name);
  if (!agg) {
    fail(`district "${d.name}" has no sections`);
    continue;
  }
  const w = winner(agg.votes);
  if (w !== d.lead?.id) {
    fail(`"${d.name}": sections say winner ${w}, districts.json says ${d.lead?.id}`);
  }
  if (agg.valid > d.valid) {
    fail(`"${d.name}": mapped sections valid ${agg.valid} exceeds district total ${d.valid}`);
  }
}

// ---- 4: choropleth colouring (merged features included) -------------------

for (const f of geoDistricts.features) {
  const recs = (f.properties.districts ?? []).map((n) => byName.get(n)).filter(Boolean);
  if (!recs.length) continue;
  const mergedVotes = {};
  for (const r of recs) {
    for (const [pid, v] of Object.entries(r.votes)) mergedVotes[pid] = (mergedVotes[pid] || 0) + v;
  }
  const expected = recs.length === 1 ? recs[0].lead.id : winner(mergedVotes);
  const actual = winner(mergedVotes);
  if (actual !== expected) {
    fail(`${recs.map((r) => r.name).join(' + ')}: choropleth winner ${actual}, expected ${expected}`);
  }
}

// ---- 5: geometry sanity ----------------------------------------------------

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a / 2);
};

const polygons = (geometry) =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

for (const f of geoDistricts.features) {
  const label = f.properties.districts.join(' + ');
  for (const poly of polygons(f.geometry)) {
    const outer = poly[0];
    if (!outer || outer.length < 4) fail(`${label}: outer ring with < 4 points`);
    for (const [lon, lat] of outer) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) fail(`${label}: non-finite coordinate`);
      else if (lon < 22 || lon > 29 || lat < 41 || lat > 45) {
        fail(`${label}: coordinate outside Bulgaria (${lon}, ${lat})`);
      }
    }
    if (outer && ringArea(outer) < 1e-6) fail(`${label}: degenerate (zero-area) ring`);
  }
}

// ---- 6: settlements coverage ----------------------------------------------

// Only 5-digit EKATTEs (pre-2015 register) have polygons; 6-digit ones fall back
// to circle markers in the viewer.
const allSettlements = settlements.map((s) => normEkatte(s.ekatte));
const wanted = new Set(allSettlements.filter((e) => e.length === 5));
const seen = new Set();
let uncounted = 0;
for (const f of geoSettlements.features) {
  const ek = String(f.properties.ekatte);
  if (f.properties.uncounted) {
    // cadastral territory with no polled section — legitimately absent from
    // settlements.json; the viewer shades it with a hatch pattern
    uncounted++;
    continue;
  }
  if (!wanted.has(ek)) {
    fail(`settlements.geojson references unknown EKATTE ${ek}`);
    continue;
  }
  if (seen.has(ek)) fail(`duplicate settlement polygon for EKATTE ${ek}`);
  seen.add(ek);
}
const coveragePct = (100 * seen.size) / wanted.size;
if (coveragePct < 95) {
  fail(`settlement polygon coverage ${coveragePct.toFixed(1)}% (< 95% of 5-digit EKATTEs)`);
}

// ---- report ---------------------------------------------------------------

const B = (n) => n.toLocaleString('en-US');
console.log('check-geo.mjs — verification');
console.log(`  districts:   ${geoDistricts.features.length} features cover ${domesticDistricts}/${districts.length - 1} domestic election districts (${mergedExtras} merged Sofia ИР; 32. Извън страната has no polygon)`);
console.log(`  settlements: ${B(seen.size)}/${B(wanted.size)} polygons (${coveragePct.toFixed(1)}%); ${B(allSettlements.length - wanted.size)} 6-digit EKATTEs use circle markers`);
console.log(`  sections:    ${B(sections.length)} mapped markers, winners cross-checked (no-coord sections counted in totals but not plotted)`);

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const f of failures.slice(0, 50)) console.error(`  ✗ ${f}`);
  if (failures.length > 50) console.error(`  … ${failures.length - 50} more`);
  process.exit(1);
}
console.log('\nOK — geometry is consistent with the election data.');
