/**
 * process.mjs — one-off preprocessor for the CIK presidential-election export.
 *
 * Reads the raw CSV files (sections, votes, parties, candidates) and emits
 * compact JSON that the static vanilla-JS site loads.
 *
 * This script lives inside the `cik-processing` skill so the skill is
 * self-contained and portable. Paths are given via flags; the defaults are
 * relative to the *current working directory* (run from the repo root):
 *
 *   node .agents/skills/cik-processing/scripts/process.mjs
 *   node .agents/skills/cik-processing/scripts/process.mjs \
 *        --in ./Exports/processed --out ./data
 *
 * Flags:  --in <dir>   folder to scan for the CSVs  (default: ./Exports/processed)
 *         --out <dir>  folder to write the JSON to   (default: ./data)
 *
 * No dependencies. Uses Node built-ins only (fs + readline streaming).
 *
 * Output (all deterministic, sorted keys for reviewable diffs):
 *   meta.json          election label, parties, candidates, colors, stats
 *   sections.json      per-section rows that have geo coords
 *   districts.json     aggregate per electoral region (32 units)
 *   settlements.json   aggregate per settlement (by EKATTE)
 *
 * Data model reference: see the cik-processing skill (../SKILL.md).
 */

import { createReadStream, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';

// paths are relative to the current working directory (repo root by default),
// not to this script's location — so the skill stays portable when moved.
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DATA_DIR = resolve(process.cwd(), flag('--in') ?? 'Exports/processed');
const OUT_DIR = resolve(process.cwd(), flag('--out') ?? 'data');
const ELECTION = 'Президент и вицепрезидент 10.2026 г., тур 1';

// --- helpers ---------------------------------------------------------------

/** Line-oriented CSV reader (the CIK files are simple `;`-split, unquoted). */
async function readRows(filename, { strip = true } = {}) {
  const rows = [];
  const rl = createInterface({
    input: createReadStream(filename),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.length) continue;
    rows.push(strip ? line.split(';').map((s) => s.trim()) : line.split(';'));
  }
  return rows;
}

// Official / portal colors for primary candidates; others get a shade of gray.
const OFFICIAL_COLORS = {
  '4': 'rgb(0, 79, 153)',    // Андрей Гюров и Георги Кандев
  '11': 'rgb(61, 31, 255)',  // Костадин Костадинов и Петър Волгин
  '17': 'rgb(0, 129, 235)',  // Радостин Василев и Красимир Манов
  '18': 'hsl(315.1, 65%, 45%)', // Иван Христанов и Стоянка Черкезова
  '19': 'rgb(192, 159, 98)', // Ивелин Михайлов и Юлиана Матеева
  '25': 'rgb(39, 109, 94)',  // Илияна Йотова и Кирил Вълчев
};

function partyColor(id, seed) {
  if (OFFICIAL_COLORS[id]) return OFFICIAL_COLORS[id];
  // Subdued shade of gray for all other candidates
  // slightly modulate lightness (45%–70%) so adjacent gray dots/rows remain discernible
  const l = 45 + ((seed * 17) % 26);
  return `hsl(0, 0%, ${l}%)`;
}

function writeJson(name, obj) {
  const out = join(OUT_DIR, name);
  // stable ordering via canonical JSON with sorted keys
  const text = JSON.stringify(sortDeep(obj), null, 0);
  writeFileSync(out, text);
  return text.length;
}

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

// --- 1. parties + candidates -----------------------------------------------

// find the extracted data folder (e.g. "Актуализирана база данни") and the CSVs
const filesFound = [];
(function scan(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!/suemg/i.test(e.name)) scan(p);
    } else {
      const low = e.name.toLowerCase();
      if (low.includes('cik_parties')) filesFound.push(['parties', p]);
      else if (low.includes('cik_candidates')) filesFound.push(['candidates', p]);
      else if (low.includes('sections')) filesFound.push(['sections', p]);
      else if (low.startsWith('votes')) filesFound.push(['votes', p]);
    }
  }
})(DATA_DIR);

const byName = new Map(filesFound);
const need = ['parties', 'candidates', 'sections', 'votes'];
const missing = need.filter((n) => !byName.has(n));
if (missing.length) {
  console.error(
    `[process] Missing input files under ${DATA_DIR}: ${missing.join(', ')}.\n` +
      'Extract the "Актуализирана база данни" folder from the .zip there first.'
  );
  process.exit(1);
}

const partiesFile = byName.get('parties');
const candidatesFile = byName.get('candidates');
const sectionsFile = byName.get('sections');
const votesFile = byName.get('votes');

console.log(`[process] reading from ${DATA_DIR}`);
for (const n of need) console.log(`  ${n}=${byName.get(n)}`);

const parties = (await readRows(partiesFile)).map(([id, name]) => ({
  id,
  name,
}));
const partyCount = parties.length;
const partyById = new Map(parties.map((p) => [p.id, p]));

const candidates = (await readRows(candidatesFile)).map(
  ([partyId, partyName, listNo, name]) => ({ partyId, partyName, listNo, name })
);
const partyColors = Object.fromEntries(parties.map((p, i) => [p.id, partyColor(p.id, i + 1)]));

// --- 2. sections ------------------------------------------------------------
// Read *every* section (with or without coordinates). The coordinate gate
// decides only whether a section can be *plotted* on the map — it must never
// decide whether it is *counted*. CIK leaves lon/lat blank for ~355 sections
// (mostly inland mobile boxes / ПСИК / special sections, not just foreign ones);
// those are still real sections with real votes and must be in every total.
const sections = [];
{
  for (const f of await readRows(sectionsFile)) {
    const lon = parseFloat(f[6]);
    const lat = parseFloat(f[7]);
    const hasCoords = Number.isFinite(lon) && Number.isFinite(lat);
    sections.push({
      id: f[0],
      district: f[1], // 01–28
      region: f[2], // electoral region name (e.g. "01. БЛАГОЕВГРАД" / "32. Извън страната")
      ekatte: f[3],
      settlement: f[4],
      hasCoords,
      // coords present only when finite; no-coord sections are still counted,
      // they just can't be placed as a map marker
      ...(hasCoords ? { lon, lat } : {}),
      mobile: f[8] === '1',
      sea: f[9] === '1',
      machines: parseInt(f[10] ?? '0', 10) || 0,
      // votes lookups filled in step 3, keyed by section id
    });
  }
}
const coordSections = sections.filter((s) => s.hasCoords);
console.log(`  sections: ${sections.length} (with coords: ${coordSections.length})`);

// --- 3. votes --------------------------------------------------------------

const sectionById = new Map(sections.map((s) => [s.id, s]));
let voteRows = 0;

{
  for (const f of await readRows(votesFile)) {
    voteRows++;
    const sec = sectionById.get(f[0]);
    if (!sec) continue; // no coords → not on the map, skip

    const votes = {};
    let valid = 0;
    let leadId = null;
    let leadVotes = 0;

    for (let i = 0; i < partyCount; i++) {
      const start = 2 + i * 6; // section;adminUnit; then 6 fields per party
      const partyId = f[start];
      const total = parseInt(f[start + 1] ?? '0', 10) || 0;
      if (!total) continue;
      votes[partyId] = total;
      valid += total;
      if (total > leadVotes) {
        leadVotes = total;
        leadId = partyId;
      }
    }

    sec.valid = valid;
    sec.votes = votes;         // partyId -> total valid votes (nonzero only)
    sec.lead = leadId ? { id: leadId, votes: leadVotes } : null;
  }
}
console.log(`  votes lines: ${voteRows}`);

// --- 4. aggregations --------------------------------------------------------

// districts: group by region name
const districts = new Map();
const settlements = new Map();

for (const s of sections) {
  if (!s.valid) continue; // don't include uncounted sections in aggregates

  // --- region aggregate ---
  let d = districts.get(s.region);
  if (!d) {
    d = { name: s.region, sections: 0, counted: 0, valid: 0, votes: {}, lonSum: 0, latSum: 0, n: 0 };
    districts.set(s.region, d);
  }
  d.sections++;
  d.counted++;
  d.valid += s.valid;
  // the centroid is a mean of *mapped* sections only; no-coord sections are
  // counted (valid/votes) but contribute no coordinates (they can't be plotted)
  if (s.hasCoords) {
    d.lonSum += s.lon;
    d.latSum += s.lat;
    d.n++;
  }
  for (const [pid, v] of Object.entries(s.votes)) d.votes[pid] = (d.votes[pid] || 0) + v;

  // --- settlement aggregate (by EKATTE) ---
  if (s.ekatte) {
    let sett = settlements.get(s.ekatte);
    if (!sett) {
      // `region` disambiguates same-named settlements in the UI (e.g. с.Лозен)
      sett = { ekatte: s.ekatte, name: s.settlement, region: s.region, regions: new Set([s.region]), sectionIds: [], sections: 0, valid: 0, votes: {}, lonSum: 0, latSum: 0, n: 0 };
      settlements.set(s.ekatte, sett);
    }
    sett.regions.add(s.region);
    sett.sections++;
    sett.valid += s.valid;
    if (s.hasCoords) {
      sett.lonSum += s.lon;
      sett.latSum += s.lat;
      sett.n++;
    }
    if (sett.sectionIds.length < 5) sett.sectionIds.push(s.id);
    for (const [pid, v] of Object.entries(s.votes)) sett.votes[pid] = (sett.votes[pid] || 0) + v;
  }
}

// The abroad region's sections carry scattered embassy coords, so its centroid
// lands somewhere in Europe. Pin it to a marker position in the Black Sea
// instead: ~50 km east of the Varna–Burgas coast stretch.
const ABROAD_MARKER = { lon: 28.5, lat: 42.63 };

const regionAggs = [...districts.values()].map((d) => {
  const entries = Object.entries(d.votes);
  const lead = entries.sort((a, b) => b[1] - a[1])[0] || null;
  return {
    name: d.name,
    sections: d.sections,
    counted: d.counted,
    valid: d.valid,
    lon: d.name.includes('Извън страната') ? ABROAD_MARKER.lon : d.n ? +(d.lonSum / d.n).toFixed(5) : 0,
    lat: d.name.includes('Извън страната') ? ABROAD_MARKER.lat : d.n ? +(d.latSum / d.n).toFixed(5) : 0,
    lead: lead ? { id: lead[0], votes: lead[1] } : null,
    votes: d.votes,
  };
}).sort((a, b) => a.name.localeCompare(b.name, 'bg'));

// A settlement normally sits in exactly one electoral region. гр.София is the
// exception: its sections span the capital's three IRs (23/24/25), so keeping
// only the first-seen region would mislabel the merged row as "СОФИЯ 23 ИР".
// Collapse multi-region settlements into one label ("СОФИЯ 23, 24, 25 ИР").
function settlementRegionLabel(regions) {
  const names = [...regions].sort((a, b) => a.localeCompare(b, 'bg'));
  if (names.length <= 1) return names[0] ?? '';
  const parts = names.map((n) => {
    const m = /^\d+\.\s*(.*?)(?:\s+(\d+)\s+ИР)?$/.exec(n);
    return { base: m ? m[1] : n, ir: m ? m[2] : null };
  });
  const base = parts[0].base;
  if (parts.every((p) => p.ir && p.base === base)) {
    return `${base} ${parts.map((p) => p.ir).join(', ')} ИР`;
  }
  return names.join(' / ');
}

const settlementAggs = [...settlements.values()].map((s) => {
  const entries = Object.entries(s.votes);
  const lead = entries.sort((a, b) => b[1] - a[1])[0] || null;
  return {
    ekatte: s.ekatte,
    name: s.name,
    region: settlementRegionLabel(s.regions),
    sections: s.sections,
    valid: s.valid,
    lon: s.n ? +(s.lonSum / s.n).toFixed(5) : 0,
    lat: s.n ? +(s.latSum / s.n).toFixed(5) : 0,
    lead: lead ? { id: lead[0], votes: lead[1] } : null,
    votes: s.votes,
  };
}).sort((a, b) => b.valid - a.valid || a.name.localeCompare(b.name, 'bg'));

// --- 5. meta + stats --------------------------------------------------------

const countedSections = sections.filter((s) => s.valid).length;
// total valid votes over ALL sections (coord and no-coord alike) — this is the
// number that must match CIK's official 8.1 "действителни гласове за листи".
const totalValid = sections.reduce((acc, s) => acc + (s.valid || 0), 0);
const sectionsWithCoords = coordSections.length;
const leadOverall = Object.values(regionAggs)
  .reduce((acc, r) => {
    for (const [pid, v] of Object.entries(r.votes)) acc[pid] = (acc[pid] || 0) + v;
    return acc;
  }, []);
const overall = Object.entries(leadOverall).sort((a, b) => b[1] - a[1]);

const meta = {
  election: ELECTION,
  dataDate: '25.10.2026',
  parties,
  candidates,
  partyColors,
  stats: {
    // total sections in the export (matches CIK's "Брой на СИ")
    totalSections: sections.length,
    // sections that have geo coords and can be placed as map markers
    sectionsWithCoords,
    // sections whose votes were counted (all of them, coord or not)
    countedSections,
    uncountedSections: sections.length - countedSections,
    totalValid,
    leader: overall[0] ? { id: overall[0][0], votes: overall[0][1] } : null,
  },
};

// --- 6. write ---------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
// only coord sections are map markers; strip the internal hasCoords flag so the
// published schema matches the documented one
const secSize = writeJson('sections.json', coordSections.map(({ hasCoords, ...rest }) => rest));
const disSize = writeJson('districts.json', regionAggs);
const setSize = writeJson('settlements.json', settlementAggs);
const metaSize = writeJson('meta.json', meta);

console.log('\n[process] wrote:');
console.log(`  data/meta.json        ${metaSize} B`);
console.log(`  data/sections.json    ${secSize} B  (${sectionsWithCoords} of ${sections.length} sections mapped)`);
console.log(`  data/districts.json   ${disSize} B  (${regionAggs.length} regions)`);
console.log(`  data/settlements.json ${setSize} B  (${settlementAggs.length} settlements)`);
console.log('\n[process] summary:');
console.log(`  parties: ${partyCount}`);
console.log(`  counted sections: ${countedSections} / ${sections.length}`);
console.log(`  total valid votes: ${totalValid.toLocaleString('en')}`);
if (overall[0]) {
  const p = partyById.get(overall[0][0]);
  console.log(`  leader: #${overall[0][0]} ${p ? p.name : '?'} — ${overall[0][1].toLocaleString('en')} votes`);
}
