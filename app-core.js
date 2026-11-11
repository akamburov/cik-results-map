/* app-core.js — pure, dependency-free helpers shared by app.js and the test
 * suite (test/app-core.test.js).
 *
 * Design contract:
 *  - No DOM, no Leaflet, no Node built-ins: the same module is imported
 *    unchanged by the browser (ESM, via app.js) and by `node --test`.
 *  - No module state. Every function takes its data *explicitly* (meta /
 *    districts / rows / chosen set) rather than reading a global, so the
 *    behaviour is fully determined by its arguments and is trivially unit-
 *    testable in isolation.
 *  - Naming: the `…Of` / `…Display` suffixes distinguish these take-everything
 *    helpers from the thin `state`-aware wrappers of the same intent in app.js
 *    (e.g. `countOverallOf(districts, id)` → app.js `countOverall(id)`).
 *  - Keep new deterministic logic here, not in app.js, or it becomes untestable.
 */
export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const NBSP = /\u00A0/g;
// Format a count for display in the bg-BG locale, collapsing the non-breaking
// space `toLocaleString` may insert into a plain space. `null`/`undefined`
// render as an em-dash ("—") so "no data" never shows a raw 0.
export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('bg-BG').replace(NBSP, ' '));

// Normalise an EKATTE identifier to a canonical 5-digit zero-padded string.
// Inputs may arrive as numbers (JSON), as strings with leading/trailing
// whitespace, or as lookup keys from settlement geometry; only digits matter.
export const normEkatte = (v) => String(v).replace(/\D/g, '').padStart(5, '0');

// Extract the human-readable part of a region label, stripping a numeric
// "NN. " prefix (e.g. `"01. ПЛОВДИВ"` → `"ПЛОВДИВ"`). Regions are display-only:
// they are never part of search matching (see filterRows), and are also used
// to disambiguate same-named settlements when sorting (see sortRows).
export const regionLabel = (r) => (r.region ? String(r.region).replace(/^\s*\d+\.\s*/, '') : '');

// Merge a list of aggregate records (districts or settlements) into one
// combined result: summed valid votes plus a combined per-party `votes` map.
// Used e.g. to render the merged София 23/24/25 ИР polygon from three
// district records as a single unit.
export const sumVotes = (recs) => {
  const votes = {};
  let valid = 0;
  for (const r of recs) {
    valid += r.valid;
    for (const [id, v] of Object.entries(r.votes)) votes[id] = (votes[id] || 0) + v;
  }
  return { votes, valid };
};

// Total votes a candidate/party received across every district. `d.votes[id]`
// may be absent (configurable candidate set), which counts as 0.
export const countOverallOf = (districts, partyId) => {
  let s = 0;
  for (const d of districts) s += d.votes[partyId] || 0;
  return s;
};

// Human-readable label for a candidate list: `"NN. Name"`. Uses the candidate
// (pair) name when present; otherwise falls back to the party name truncated at
// the first dash (bullet-list entries share the party's prefix), and finally to
// the raw id, so a dangling reference still renders something sensible.
export const candidateDisplayName = (meta, id) => {
  const c = meta.candidates.find((x) => x.partyId === id);
  const name = c && c.name
    ? c.name
    : (() => {
        const p = meta.parties.find((x) => x.id === id);
        return p ? p.name.split('-')[0] : id;
      })();
  return `${id}. ${name}`;
};

// Fill colour for a party from the palette keyed by party id; unknown ids get a
// neutral grey rather than throwing. Ensures the map and table stay consistent
// with each other (they share this single source of colour decisions).
export const partyColorOf = (meta, id) => meta.partyColors[id] || '#888';

// Default table columns / chips: the top `count` candidates by overall valid
// votes (the "initial view" the user gets before tweaking anything). Zero-vote
// candidates are excluded so no empty column ever appears by default.
export const defaultCandidates = (meta, districts, count = 6) => {
  return [...meta.candidates]
    .map((c) => [c.partyId, countOverallOf(districts, c.partyId)])
    .filter(([, votes]) => votes > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([id]) => id);
};

// The subset of `chosen` candidate ids that actually won votes, ordered by
// overall votes descending. Drives the table columns and their column order:
// columns follow the user's selection (chips) but always rank strongest first.
export const orderedCandidates = (meta, districts, chosen) => {
  return [...meta.candidates]
    .map((c) => [c.partyId, countOverallOf(districts, c.partyId)])
    .filter(([id, votes]) => votes > 0 && chosen.has(id))
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
};

// Table text search (case-insensitive, trimmed). Matches row name, settlement
// and the winner's display name. The region field is intentionally excluded per
// the UI's search contract: typing a region must not filter settlements. An
// empty/whitespace query passes every row through unchanged (same array ref).
export const filterRows = (rows, query, meta) => {
  const q = (query || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const name = (r.name || '').toLowerCase();
    const settle = (r.settlement || r.name || '').toLowerCase();
    const lead = r.lead ? candidateDisplayName(meta, r.lead.id).toLowerCase() : '';
    return name.includes(q) || settle.includes(q) || lead.includes(q);
  });
};

// Single source of truth for a row's observable cell value in the table.
// `col` is either a named column ("name", "lead", "sections", "valid") or a
// candidate party id (a per-candidate vote column). Shared by both sorting
// (sortRows) and cell rendering in app.js so they can never disagree on values.
export const columnValue = (meta, row, col) => {
  if (col === 'name') return row.name;
  if (col === 'lead') return row.lead ? candidateDisplayName(meta, row.lead.id) : '—';
  if (col === 'sections') return row.sections;
  if (col === 'valid') return row.valid;
  return row.votes[col] || 0;
};

// Sort rows per `sort` = { col, dir } where dir is +1 (asc) or -1 (desc).
//  - Numeric columns (votes, valid, sections) compare arithmetically — this is
//    what keeps e.g. "9" and "10" ordering correctly instead of as strings.
//  - Text columns (name, lead) compare with the Bulgarian locale ('bg').
//  - Same-named rows sorted by name fall back to their region label, so the
//    order stays deterministic across rows that look identical in the table.
// Returns a new array; the input is never mutated.
export const sortRows = (rows, sort, meta) => {
  const data = [...rows];
  data.sort((aRow, bRow) => {
    const aValue = columnValue(meta, aRow, sort.col);
    const bValue = columnValue(meta, bRow, sort.col);
    if (typeof aValue === 'number' && typeof bValue === 'number') return (aValue - bValue) * sort.dir;
    const cmp = String(aValue).localeCompare(String(bValue), 'bg');
    if (cmp === 0 && sort.col === 'name') {
      return regionLabel(aRow).localeCompare(regionLabel(bRow), 'bg');
    }
    return cmp * sort.dir;
  });
  return data;
};
