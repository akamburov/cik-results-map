import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  esc,
  fmt,
  normEkatte,
  regionLabel,
  sumVotes,
  countOverallOf,
  candidateDisplayName,
  partyColorOf,
  defaultCandidates,
  orderedCandidates,
  filterRows,
  columnValue,
  sortRows,
} from '../app-core.js';

const readData = (f) => JSON.parse(readFileSync(`data/${f}`, 'utf8'));

// ---- fixtures ---------------------------------------------------------------

const REF = () => ({
  candidates: [
    { listNo: '1', name: 'Дама едно и Кандидат един', partyId: '1', partyName: 'P1' },
    { listNo: '2', name: 'Дама две и Кандидат два', partyId: '2', partyName: 'P2' },
    { listNo: '3', name: 'Дама три и Кандидат три', partyId: '3', partyName: 'P3' }, // no votes overall
  ],
  parties: [
    { id: '1', name: 'P1-ИК за Кандидат един' },
    { id: '99', name: 'P-unofficial' },
  ],
  partyColors: { '1': 'red', '2': 'blue' },
  stats: {},
});

const DISTRICTS = () => [
  { name: '01. А', valid: 1000, sections: 50, lead: { id: '1', votes: 600 }, votes: { '1': 600, '2': 400 } },
  { name: '02. Б', valid: 400, sections: 20, lead: { id: '2', votes: 250 }, votes: { '1': 150, '2': 250 } },
];

const SETTLEMENTS = () => [
  { ekatte: '68134', name: 'Село А', region: '01. ПЛОВДИВ', valid: 100, sections: 2, lead: { id: '2', votes: 60 }, votes: { '1': 40, '2': 60 } },
  { ekatte: '68135', name: 'Село Б', region: '02. ВАРНА', valid: 80, sections: 1, lead: { id: '1', votes: 80 }, votes: { '1': 80 } },
];

// ---- esc --------------------------------------------------------------------

test('esc escapes HTML entities', () => {
  assert.equal(esc(`<a href="x">&`), '&lt;a href=&quot;x&quot;&gt;&amp;');
});
test('esc leaves undefined/null empty', () => {
  assert.equal(esc(undefined), '');
  assert.equal(esc(null), '');
  assert.equal(esc(0), '0');
});

// ---- fmt --------------------------------------------------------------------

test('fmt formats numbers with bg-BG thousands grouping', () => {
  assert.equal(fmt(60355), '60 355');
});
test('fmt renders 0 as 0', () => {
  assert.equal(fmt(0), '0');
});
test('fmt handles missing values', () => {
  assert.equal(fmt(null), '—');
  assert.equal(fmt(undefined), '—');
});
test('fmt groups millions and decimals', () => {
  assert.equal(fmt(1234567.5), '1 234 567,5');
});

// ---- normEkatte --------------------------------------------------------------

test('normEkatte strips non-digits and zero-pads to 5', () => {
  assert.equal(normEkatte('68134'), '68134');
  assert.equal(normEkatte(68134), '68134');
  assert.equal(normEkatte('SN-123'), '00123');
  assert.equal(normEkatte(123), '00123');
});

// ---- regionLabel ---------------------------------------------------------------

test('regionLabel strips the numeric prefix', () => {
  assert.equal(regionLabel({ region: '01. ПЛОВДИВ' }), 'ПЛОВДИВ');
  assert.equal(regionLabel({ region: '23, 24, 25 ИР' }), '23, 24, 25 ИР'); // already unprefixed
  assert.equal(regionLabel({}), '');
});

// ---- sumVotes ------------------------------------------------------------------

test('sumVotes aggregates votes and valid across records', () => {
  const { votes, valid } = sumVotes([
    { valid: 100, votes: { '1': 40, '2': 60 } },
    { valid: 50, votes: { '2': 20, '3': 30 } },
  ]);
  assert.equal(valid, 150);
  assert.deepEqual(votes, { '1': 40, '2': 80, '3': 30 });
});

// ---- countOverallOf --------------------------------------------------------------

test('countOverallOf tallies a party across districts', () => {
  assert.equal(countOverallOf(DISTRICTS(), '1'), 750); // 600 + 150
  assert.equal(countOverallOf(DISTRICTS(), '3'), 0);   // not present
});

// ---- candidateDisplayName ----------------------------------------------------------

test('candidateDisplayName uses the candidate name when present', () => {
  assert.equal(candidateDisplayName(REF(), '1'), '1. Дама едно и Кандидат един');
});
test('candidateDisplayName falls back to the party name before the first dash', () => {
  assert.equal(candidateDisplayName(REF(), '99'), '99. P'); // 'P-unofficial'.split('-')[0]
});
test('candidateDisplayName falls back to the id when unknown', () => {
  assert.equal(candidateDisplayName(REF(), '404'), '404. 404');
});

// ---- partyColorOf ------------------------------------------------------------------

test('partyColorOf returns the stored color', () => {
  assert.equal(partyColorOf(REF(), '1'), 'red');
});
test('partyColorOf defaults to #888 for unknown parties', () => {
  assert.equal(partyColorOf(REF(), '999'), '#888');
});

// ---- defaultCandidates --------------------------------------------------------------

test('defaultCandidates returns the top N candidates by overall votes', () => {
  const top = defaultCandidates(REF(), DISTRICTS(), 2);
  assert.deepEqual(top, ['1', '2']); // party 3 has no votes
});
test('defaultCandidates excludes zero-vote candidates', () => {
  const top = defaultCandidates(REF(), DISTRICTS());
  assert.ok(!top.includes('3'));
});
test('defaultCandidates sorts descending by votes', () => {
  const votes = defaultCandidates(REF(), DISTRICTS(), 6).map((id) => countOverallOf(DISTRICTS(), id));
  assert.deepEqual(votes, [...votes].sort((a, b) => b - a));
});

// ---- orderedCandidates --------------------------------------------------------------

test('orderedCandidates filters to the chosen set, ordered by votes desc', () => {
  const ordered = orderedCandidates(REF(), DISTRICTS(), new Set(['2', '1']));
  assert.deepEqual(ordered, ['1', '2']); // 750 > 650
});
test('orderedCandidates ignores chosen ids with no votes', () => {
  const ordered = orderedCandidates(REF(), DISTRICTS(), new Set(['1', '3']));
  assert.deepEqual(ordered, ['1']);
});

// ---- filterRows --------------------------------------------------------------------

test('filterRows matches name, settlement and winner (case-insensitive)', () => {
  const settlements = SETTLEMENTS();
  assert.equal(filterRows(settlements, 'село', REF()).length, 2);
  assert.equal(filterRows(settlements, 'варна', REF()).length, 0);          // region excluded
  assert.deepEqual(filterRows(settlements, 'дают две и кандидатют два', REF()), []); // no such
  assert.deepEqual(filterRows(settlements, 'дама две', REF()), [settlements[0]]);    // winner name
});
test('filterRows returns everything for an empty query', () => {
  const s = SETTLEMENTS();
  assert.equal(filterRows(s, '', REF()), s);
  assert.equal(filterRows(s, '   ', REF()), s);
});
test('filterRows deliberately ignores the region field', () => {
  const s = SETTLEMENTS();
  assert.equal(filterRows(s, 'пловдив', REF()).length, 0);
  assert.equal(filterRows(s, '51', REF()).length, 0); // from a region prefix "01."
});

// ---- columnValue ----------------------------------------------------------------------

test('columnValue returns per-column cell values', () => {
  const d = DISTRICTS()[0];
  assert.equal(columnValue(REF(), d, 'name'), d.name);
  assert.equal(columnValue(REF(), d, 'lead'), '1. Дама едно и Кандидат един');
  assert.equal(columnValue(REF(), d, 'sections'), 50);
  assert.equal(columnValue(REF(), d, 'valid'), 1000);
  assert.equal(columnValue(REF(), d, '2'), 400);
  assert.equal(columnValue(REF(), d, '3'), 0); // missing vote column
});
test('columnValue returns — when no winner', () => {
  assert.equal(columnValue(REF(), { lead: undefined, votes: {} }, 'lead'), '—');
});

// ---- sortRows --------------------------------------------------------------------------

test('sortRows sorts numbers numerically respecting direction', () => {
  const rows = DISTRICTS();
  const asc = sortRows(rows, { col: 'valid', dir: 1 }, REF());
  assert.deepEqual(asc.map((r) => r.valid), [400, 1000]);
  const desc = sortRows(rows, { col: 'valid', dir: -1 }, REF());
  assert.deepEqual(desc.map((r) => r.valid), [1000, 400]);
});
test('sortRows sorts network numbers by numeric value, not locale string', () => {
  // '10' must sort above '9' numerically (party vote columns are numbers).
  const rows = [
    { name: 'x1', votes: { '1': 10 } },
    { name: 'x2', votes: { '1': 9 } },
  ];
  const desc = sortRows(rows, { col: '1', dir: -1 }, REF());
  assert.deepEqual(desc.map((r) => r.votes['1']), [10, 9]);
});
test('sortRows sorts names by bg locale', () => {
  const rows = [{ name: 'БЪЛГАРГРАД' }, { name: 'АЛБЕНА' }];
  const asc = sortRows(rows, { col: 'name', dir: 1 }, REF());
  // In Bulgarian collation А < Б
  assert.deepEqual(asc.map((r) => r.name), ['АЛБЕНА', 'БЪЛГАРГРАД']);
});
test('sortRows disambiguates same-named rows by region when sorting by name', () => {
  const rows = [
    { name: 'Село' , region: '02. ВАРНА' },
    { name: 'Село' , region: '01. ПЛОВДИВ' },
  ];
  const asc = sortRows(rows, { col: 'name', dir: 1 }, REF());
  // Bulgarian collation: В < П, so ВАРНА sorts before ПЛОВДИВ.
  assert.deepEqual(asc.map((r) => r.region), ['02. ВАРНА', '01. ПЛОВДИВ']);
});
test('sortRows does not mutate the input array', () => {
  const rows = DISTRICTS();
  const before = rows.map((r) => r.name);
  sortRows(rows, { col: 'valid', dir: -1 }, REF());
  assert.deepEqual(rows.map((r) => r.name), before);
});
test('sortRows matches hand-written fixtures from the committed data layer', () => {
  const districts = readData('districts.json');
  const sorted = sortRows(districts, { col: 'valid', dir: -1 }, readData('meta.json'));
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i - 1].valid >= sorted[i].valid, 'districts must be sorted by valid desc');
  }
});
