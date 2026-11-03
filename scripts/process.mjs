/**
 * process.mjs — one-off preprocessor for the CIK presidential-election export.
 *
 * Reads the raw CSV files (sections, votes, parties, candidates) and emits
 * compact JSON into public/data/ that the static vanilla-JS site loads.
 *
 * Run:   node scripts/process.mjs
 * Input: Exports/processed/<Актуализирана база данни>/... (the extracted folder,
 *        NOT the suemg/ ballot-scan data).
 *
 * No dependencies. Uses Node built-ins only (fs + readline streaming).
 *
 * Output (all deterministic, sorted keys for reviewable diffs):
 *   public/data/meta.json          election label, parties, candidates, colors, stats
 *   public/data/sections.json      per-section rows that have geo coords
 *   public/data/districts.json     aggregate per electoral region (32 units)
 *   public/data/settlements.json   aggregate per settlement (by EKATTE)
 *
 * Data model reference: see agents.md §2 (data model) and §3 (CIK field maps).
 */

import { createReadStream, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'Exports', 'processed');
const OUT_DIR = join(__dirname, '..', 'public', 'data');
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

function deterministicColor(seed) {
  // golden-angle hue spread so adjacent party IDs get visually distinct colors
  const hue = (seed * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 65%, 45%)`;
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
const partyColors = Object.fromEntries(parties.map((p, i) => [p.id, deterministicColor(i + 1)]));

// --- 2. sections ------------------------------------------------------------

const sections = [];
{
  for (const f of await readRows(sectionsFile)) {
    const lon = parseFloat(f[6]);
    const lat = parseFloat(f[7]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue; // skip no-coord
    sections.push({
      id: f[0],
      district: f[1], // 01–28
      region: f[2], // electoral region name (e.g. "01. БЛАГОЕВГРАД" / "32. Извън страната")
      ekatte: f[3],
      settlement: f[4],
      lon,
      lat,
      mobile: f[8] === '1',
      sea: f[9] === '1',
      machines: parseInt(f[10] ?? '0', 10) || 0,
      // votes lookups filled in step 3, keyed by section id
    });
  }
}
console.log(`  sections with coords: ${sections.length}`);

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
  d.lonSum += s.lon;
  d.latSum += s.lat;
  d.n++;
  for (const [pid, v] of Object.entries(s.votes)) d.votes[pid] = (d.votes[pid] || 0) + v;

  // --- settlement aggregate (by EKATTE) ---
  if (s.ekatte) {
    let sett = settlements.get(s.ekatte);
    if (!sett) {
      sett = { ekatte: s.ekatte, name: s.settlement, sectionIds: [], sections: 0, valid: 0, votes: {}, lonSum: 0, latSum: 0, n: 0 };
      settlements.set(s.ekatte, sett);
    }
    sett.sections++;
    sett.valid += s.valid;
    sett.lonSum += s.lon;
    sett.latSum += s.lat;
    sett.n++;
    if (sett.sectionIds.length < 5) sett.sectionIds.push(s.id);
    for (const [pid, v] of Object.entries(s.votes)) sett.votes[pid] = (sett.votes[pid] || 0) + v;
  }
}

const regionAggs = [...districts.values()].map((d) => {
  const entries = Object.entries(d.votes);
  const lead = entries.sort((a, b) => b[1] - a[1])[0] || null;
  return {
    name: d.name,
    sections: d.sections,
    counted: d.counted,
    valid: d.valid,
    lon: +(d.lonSum / d.n).toFixed(5),
    lat: +(d.latSum / d.n).toFixed(5),
    lead: lead ? { id: lead[0], votes: lead[1] } : null,
    votes: d.votes,
  };
}).sort((a, b) => a.name.localeCompare(b.name, 'bg'));

const settlementAggs = [...settlements.values()].map((s) => {
  const entries = Object.entries(s.votes);
  const lead = entries.sort((a, b) => b[1] - a[1])[0] || null;
  return {
    ekatte: s.ekatte,
    name: s.name,
    sections: s.sections,
    valid: s.valid,
    lon: +(s.lonSum / s.n).toFixed(5),
    lat: +(s.latSum / s.n).toFixed(5),
    lead: lead ? { id: lead[0], votes: lead[1] } : null,
    votes: s.votes,
  };
}).sort((a, b) => b.valid - a.valid || a.name.localeCompare(b.name, 'bg'));

// --- 5. meta + stats --------------------------------------------------------

const countedSections = sections.filter((s) => s.valid).length;
const totalValid = regionAggs.reduce((acc, r) => acc + r.valid, 0);
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
    sectionsWithCoords: sections.length,
    countedSections,
    uncountedSections: sections.length - countedSections,
    totalValid,
    leader: overall[0] ? { id: overall[0][0], votes: overall[0][1] } : null,
  },
};

// --- 6. write ---------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
const secSize = writeJson('sections.json', sections);
const disSize = writeJson('districts.json', regionAggs);
const setSize = writeJson('settlements.json', settlementAggs);
const metaSize = writeJson('meta.json', meta);

console.log('\n[process] wrote:');
console.log(`  public/data/meta.json        ${metaSize} B`);
console.log(`  public/data/sections.json    ${secSize} B  (${sections.length} sections)`);
console.log(`  public/data/districts.json   ${disSize} B  (${regionAggs.length} regions)`);
console.log(`  public/data/settlements.json ${setSize} B  (${settlementAggs.length} settlements)`);
console.log('\n[process] summary:');
console.log(`  parties: ${partyCount}`);
console.log(`  counted sections: ${countedSections} / ${sections.length}`);
console.log(`  total valid votes: ${totalValid.toLocaleString('en')}`);
if (overall[0]) {
  const p = partyById.get(overall[0][0]);
  console.log(`  leader: #${overall[0][0]} ${p ? p.name : '?'} — ${overall[0][1].toLocaleString('en')} votes`);
}
