#!/usr/bin/env node --input-type=module
/* build-geo.mjs — builds the choropleth geometry files for the viewer.
 *
 * Input (raw, gitignored): ./Exports/geo/   (override with --in)
 *   provinces.geojson      28 BG provinces (NUTS3), from yurukov/Bulgaria-geocoding
 *   municipalities.geojson 265 BG municipalities (NUTS4)
 *   settlements.geojson    settlement land zones keyed by 5-char EKATTE
 * Source: https://github.com/yurukov/Bulgaria-geocoding (public open-data
 * resources based on NSI/AGCC data; fetch from the repo's raw URLs).
 *
 * Also reads ./data/settlements.json (the election aggregate) from --out to know
 * which EKATTEs are actually needed.
 *
 * Output (generated, committed): ./data/   (override with --out)
 *   districts-geo.json  FeatureCollection; one feature per election district with
 *                       actual polygons. 26 provinces map 1:1; ПЛОВДИВ град/област
 *                       assembled from municipalities; СОФИЯ 23/24/25 ИР share one
 *                       merged polygon (property districts[]).
 *   settlements-geo.json FeatureCollection; settlement land polygons keyed by
 *                       EKATTE (only the EKATTEs present in data/settlements.json).
 *
 * Deterministic: same inputs → byte-identical output.
 * Node built-ins only.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Paths are relative to the current working directory (run from the repo root),
// so the skill stays portable — pass explicit paths if you copy it elsewhere.
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const IN = resolve(arg('--in', './Exports/geo'));
const OUT = resolve(arg('--out', './data'));

const read = (dir, f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

// Coordinate rounding: 4 decimals ≈ 11 m — plenty for choropleth.
const rnd = (n) => Math.round(n * 1e4) / 1e4;
const roundRing = (r) => r.map(([x, y]) => [rnd(x), rnd(y)]);
function roundCoords(c) {
  // Recurse until we hit a ring (array of [lon, lat] pairs).
  if (typeof c[0][0] === 'number') return roundRing(c);
  return c.map(roundCoords);
}

// The upstream boundaries contain a handful of sliver polygons (a few hundred m²
// to ~1 ha) created by topology cleanup. Drop Polygon/MultiPolygon parts whose
// outer ring is smaller than ~1 ha so they don't render as stray dots.
const MIN_PART_AREA = 1e-6; // deg² ≈ 1.2 ha
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a / 2);
}

// Round + drop sliver parts; collapses a single-part MultiPolygon to Polygon.
function cleanGeometry(geometry) {
  const coords = roundCoords(geometry.coordinates);
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: coords };
  }
  const parts = coords.filter((poly) => ringArea(poly[0]) >= MIN_PART_AREA);
  const kept = parts.length ? parts : coords; // never emit an empty MultiPolygon
  return kept.length === 1
    ? { type: 'Polygon', coordinates: kept[0] }
    : { type: 'MultiPolygon', coordinates: kept };
}

// ----------------------------------------------------------------------------
// Districts choropleth
// ----------------------------------------------------------------------------

// Election-district name (as in data/districts.json) per province code.
// Derived once by nearest-centroid match (see issue #2 analysis);
// the two Sofia entries are disambiguated by polygon size:
//   SOF = София (столица) ~2.4k km²  → merged 23/24/25 ИР
//   SFO = София област    ~15.4k km² → 26. СОФИЯ област
const NUTS3_TO_DISTRICT = {
  BLG: '01. БЛАГОЕВГРАД',
  BGS: '02. БУРГАС',
  VAR: '03. ВАРНА',
  VTR: '04. ВЕЛИКО ТЪРНОВО',
  VID: '05. ВИДИН',
  VRC: '06. ВРАЦА',
  GAB: '07. ГАБРОВО',
  DOB: '08. ДОБРИЧ',
  KRZ: '09. КЪРДЖАЛИ',
  KNL: '10. КЮСТЕНДИЛ',
  LOV: '11. ЛОВЕЧ',
  MON: '12. МОНТАНА',
  PAZ: '13. ПАЗАРДЖИК',
  PER: '14. ПЕРНИК',
  PVN: '15. ПЛЕВЕН',
  RAZ: '18. РАЗГРАД',
  RSE: '19. РУСЕ',
  SLS: '20. СИЛИСТРА',
  SLV: '21. СЛИВЕН',
  SML: '22. СМОЛЯН',
  SZR: '27. СТАРА ЗАГОРА',
  TGV: '28. ТЪРГОВИЩЕ',
  HKV: '29. ХАСКОВО',
  SHU: '30. ШУМЕН',
  JAM: '31. ЯМБОЛ',
  SFO: '26. СОФИЯ област',
};

const districts = read(IN, 'provinces.geojson');
const municipalities = read(IN, 'municipalities.geojson');

const features = [];

// 1) 1:1 provinces
for (const f of districts.features) {
  const name = NUTS3_TO_DISTRICT[f.properties.nuts3];
  if (!name) continue;
  features.push({ type: 'Feature', properties: { districts: [name] }, geometry: cleanGeometry(f.geometry) });
}

// 2) Пловдив: district 16 = община Пловдив (PDV22); district 17 = the rest of PDV
const pdv = municipalities.features.filter((f) => f.properties.nuts3 === 'PDV');
const pdvCity = pdv.find((f) => f.properties.nuts4 === 'PDV22');
if (pdvCity) {
  features.push({ type: 'Feature', properties: { districts: ['16. ПЛОВДИВ град'] }, geometry: cleanGeometry(pdvCity.geometry) });
}
const pdvRest = pdv.filter((f) => f.properties.nuts4 !== 'PDV22');
if (pdvRest.length) {
  const parts = [];
  for (const f of pdvRest) {
    const g = cleanGeometry(f.geometry);
    if (g.type === 'Polygon') parts.push(g.coordinates);
    else parts.push(...g.coordinates);
  }
  features.push({ type: 'Feature', properties: { districts: ['17. ПЛОВДИВ област'] }, geometry: { type: 'MultiPolygon', coordinates: parts } });
}

// 3) София (столица): single merged polygon for 23/24/25 ИР
const sofGrad = districts.features.find((f) => f.properties.nuts3 === 'SOF');
if (sofGrad) {
  features.push({
    type: 'Feature',
    properties: { districts: ['23. СОФИЯ 23 ИР', '24. СОФИЯ 24 ИР', '25. СОФИЯ 25 ИР'] },
    geometry: cleanGeometry(sofGrad.geometry),
  });
}

// cover-order: put Sofia city & Plovdiv city on top (small polygons over big ones)
mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, 'districts-geo.json'),
  JSON.stringify({ type: 'FeatureCollection', features })
);

// ----------------------------------------------------------------------------
// Settlements choropleth (land zones keyed by EKATTE)
// ----------------------------------------------------------------------------

const settlements = read(OUT, 'settlements.json');
const wanted = new Set(
  settlements.map((s) => String(s.ekatte).replace(/\D/g, '').padStart(5, '0')).filter((c) => c.length === 5)
);
// 6-digit EKATTEs (post-2015 registers) have no polygons anywhere — skipped,
// the viewer falls back to circle markers for them (~460 entries).

const setGeo = read(IN, 'settlements.geojson');
const geoFeatures = [];
const seen = new Set();
for (const f of setGeo.features) {
  const ek = String(f.properties.ekatte);
  if (!wanted.has(ek) || seen.has(ek)) continue;
  seen.add(ek);
  geoFeatures.push({ type: 'Feature', properties: { ekatte: ek }, geometry: cleanGeometry(f.geometry) });
}

writeFileSync(
  join(OUT, 'settlements-geo.json'),
  JSON.stringify({ type: 'FeatureCollection', features: geoFeatures })
);

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------

const B = (n) => n.toLocaleString('en-US');
console.log('build-geo.mjs — summary');
console.log(`  districts-geo.json    ${B(features.length)} features (26 provinces + 2 Пловдив + 1 София merged)`);
console.log(`  settlements-geo.json  ${B(geoFeatures.length)} polygons`);
console.log(`  settlements matched: ${B(seen.size)}/${B(wanted.size)} (${(100 * seen.size / wanted.size).toFixed(1)}%) — missing fall back to circle markers`);
