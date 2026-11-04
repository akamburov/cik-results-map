// CI-side validation of committed data/*.json invariants.
// The raw CIK exports (Exports/) are gitignored, so regeneration is not possible
// on CI; instead we check the invariants the viewer relies on.
import { readFileSync } from 'node:fs';

const read = (f) => JSON.parse(readFileSync(`data/${f}`, 'utf8'));
const meta = read('meta.json');
const sections = read('sections.json');
const districts = read('districts.json');
const settlements = read('settlements.json');

const partyIds = new Set(meta.parties.map((p) => p.id));
if (partyIds.size !== meta.parties.length) throw new Error('duplicate party ids');

if (meta.stats.totalValid < 1_400_000) {
  throw new Error(`totalValid implausible: ${meta.stats.totalValid}`);
}

for (const [name, list] of [['sections', sections], ['districts', districts], ['settlements', settlements]]) {
  for (const e of list) {
    const lead = e.lead?.id ?? e.winnerId;
    if (!partyIds.has(lead)) throw new Error(`${name} dangling winnerId: ${e.id} (${e.name})`);
    for (const [pid, n] of Object.entries(e.votes)) {
      if (!partyIds.has(pid)) throw new Error(`${name} dangling vote id: ${pid} in ${e.id} (${e.name})`);
      if (!(n >= 0)) throw new Error(`${name} negative votes: ${pid} in ${e.id}`);
    }
  }
}

for (const s of sections) {
  if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) {
    throw new Error(`section with bad coords: ${s.id} (${s.name})`);
  }
}

console.log(
  `data OK: ${sections.length} sections, ${meta.parties.length} parties, ` +
  `totalValid=${meta.stats.totalValid}`
);
