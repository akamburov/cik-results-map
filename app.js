/* app.js — vanilla-JS election results app (map + filterable table).
 * Loads the precomputed JSON from data/ and renders with Leaflet + DOM.
 * No framework, no bundler.
 */
'use strict';

const $ = (sel) => document.querySelector(sel);

const state = {
  meta: null,
  districts: [],
  settlements: [],
  sections: [],
  geo: { districts: null, settlements: null },
  settlementsByEkatte: null, // Map normEkatte -> settlement record
  unit: 'districts',        // 'districts' | 'settlements'
  mapPoints: true,          // show circle markers on top of the choropleth
  query: '',
  selectedParties: null,    // Set of party ids shown as table columns
  tableRow: {},            // current row unit name for detail
  sort: { col: 'valid', dir: -1 },
};

// ---- data loading ----------------------------------------------------------

async function loadData() {
  const [meta, districts, settlements, sections, geoDistricts, geoSettlements] = await Promise.all([
    fetch('./data/meta.json').then((r) => r.json()),
    fetch('./data/districts.json').then((r) => r.json()),
    fetch('./data/settlements.json').then((r) => r.json()),
    fetch('./data/sections.json').then((r) => r.json()),
    fetch('./data/districts-geo.json').then((r) => r.json()).catch(() => null),
    fetch('./data/settlements-geo.json').then((r) => r.json()).catch(() => null),
  ]);
  state.meta = meta;
  state.districts = districts;
  state.settlements = settlements;
  state.sections = sections;
  state.geo.districts = geoDistricts;
  state.geo.settlements = geoSettlements;
  state.settlementsByEkatte = new Map(
    settlements.map((s) => [normEkatte(s.ekatte), s])
  );

  // default selected parties = top N by overall valid votes
  const top = [...meta.parties]
    .map((p) => [p.id, countOverall(p.id)])
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id]) => id);
  state.selectedParties = new Set(top);
  renderChips();
  renderTable();
}

function countOverall(partyId) {
  let s = 0;
  for (const d of state.districts) s += (d.votes[partyId] || 0);
  return s;
}

// ---- helpers ---------------------------------------------------------------

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('bg-BG'));
const normEkatte = (v) => String(v).replace(/\D/g, '').padStart(5, '0');
const partyName = (id) => {
  const p = state.meta.parties.find((x) => x.id === id);
  return p ? p.name.split('-')[0] : id;
};
const partyColor = (id) => state.meta.partyColors[id] || '#888';
const rows = () => (state.unit === 'districts' ? state.districts : state.settlements);
const rowName = (r) => (state.unit === 'districts' ? r.name : r.name);

// ---- tabs ------------------------------------------------------------------

document.querySelectorAll('.tab').forEach((btn) =>
  btn.addEventListener('click', () => showTab(btn.dataset.tab))
);
function showTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === name + '-view'));
  if (name === 'map') {
    setTimeout(() => map.invalidateSize(), 0);
    $('.legend').classList.remove('hidden');
  } else {
    $('.legend').classList.add('hidden');
  }
}

// ---- filters ---------------------------------------------------------------

$('#unit').addEventListener('change', (e) => {
  state.unit = e.target.value;
  state.sort = { col: 'valid', dir: -1 };
  renderTable();
  renderMapLayers(); // update map layers to the selected unit
});
$('#search').addEventListener('input', (e) => {
  state.query = e.target.value.trim().toLowerCase();
  renderTable();
});

function renderChips() {
  const wrap = $('#party-chips');
  wrap.innerHTML = '';
  const ordered = [...state.meta.parties]
    .map((p) => [p, countOverall(p.id)])
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);
  for (const [p] of ordered) {
    const el = document.createElement('button');
    el.className = 'chip' + (state.selectedParties.has(p.id) ? '' : ' off');
    el.innerHTML = `<span class="dot" style="background:${partyColor(p.id)}"></span>${p.name.split('-')[0]}`;
    el.addEventListener('click', () => {
      if (state.selectedParties.has(p.id)) state.selectedParties.delete(p.id);
      else state.selectedParties.add(p.id);
      renderChips();
      renderTable();
    });
    wrap.appendChild(el);
  }
}

// ---- table -----------------------------------------------------------------

function renderTable() {
  const data = rows().filter((r) => {
    if (!state.query) return true;
    const name = rowName(r).toLowerCase();
    const settle = (r.name || '').toLowerCase();
    const lead = r.lead ? partyName(r.lead.id).toLowerCase() : '';
    return name.includes(state.query) || settle.includes(state.query) || lead.includes(state.query);
  });

  const partyIds = [...state.selectedParties];
  const thead = $('#thead');
  const tbody = $('#tbody');

  const cols = [
    { key: 'name', label: state.unit === 'districts' ? 'Избирателен район' : 'Населено място', align: 'left' },
    { key: 'lead', label: 'Победител' },
    { key: 'sections', label: 'Секции' },
    { key: 'valid', label: 'Действителни' },
    ...partyIds.map((id) => ({ key: id, label: shortName(id), p: true })),
  ];

  thead.innerHTML = cols
    .map((c) => {
      const active = state.sort.col === c.key;
      const arrow = active ? (state.sort.dir < 0 ? ' ▾' : ' ▴') : '';
      return `<th data-col="${c.key}">${c.label}${arrow}</th>`;
    })
    .join('');

  thead.querySelectorAll('th').forEach((th) =>
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sort.col === col) state.sort.dir *= -1;
      else state.sort = { col, dir: -1 };
      renderTable();
    })
  );

  const val = (r, col) => {
    if (col === 'name') return rowName(r);
    if (col === 'lead') return r.lead ? partyName(r.lead.id) : '—';
    if (col === 'sections') return r.sections;
    if (col === 'valid') return r.valid;
    return (r.votes[col] || 0);
  };

  data.sort((a, b) => {
    const av = val(a, state.sort.col);
    const bv = val(b, state.sort.col);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * state.sort.dir;
    return String(av).localeCompare(String(bv), 'bg') * state.sort.dir;
  });

  tbody.innerHTML = data
    .map((r) => {
      const cells = cols.map((c) => {
        const v = val(r, c.key);
        const color = c.p ? ` background:${partyColor(c.key)}` : '';
        return `<td>${typeof v === 'number' ? fmt(v) : v}</td>`;
      });
      const leadColor = r.lead ? ` style="color:${partyColor(r.lead.id)};font-weight:600"` : '';
      // recolor the "Победител" cell + lead id cell
      return `<tr data-name="${rowName(r)}">${cells
        .map((td, i) => (cols[i].key === 'lead' ? td.replace('<td>', `<td${leadColor}>`) : td))
        .join('')}</tr>`;
    })
    .join('') || '<tr><td colspan="9" class="muted">Няма резултати.</td></tr>';

  tbody.querySelectorAll('tr[data-name]').forEach((tr) =>
    tr.addEventListener('click', () => openDetail(tr.dataset.name))
  );

  renderLegend();
  updateStats();
}

function shortName(id) {
  const p = state.meta.parties.find((x) => x.id === id);
  if (!p) return id;
  const n = p.name.split('-')[0];
  return n.length > 18 ? n.slice(0, 16) + '…' : n;
}

// ---- legend & stats --------------------------------------------------------

function renderLegend() {
  const leg = $('#legend');
  const order = [...state.meta.parties]
    .map((p) => [p, countOverall(p.id)])
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);
  leg.innerHTML = '<div class="muted" style="margin-bottom:4px">Партии</div>' +
    order.map(([p]) => `<div class="li"><span class="sw" style="background:${partyColor(p.id)}"></span>${p.name.split('-')[0]}</div>`).join('');
}

function updateStats() {
  const s = state.meta.stats;
  $('#stats-line').textContent =
    `${s.countedSections} секции · ${fmt(s.totalValid)} действителни гласа · Лидер: ${s.leader ? partyName(s.leader.id) : '—'}`;
}

// ---- map -------------------------------------------------------------------

let map = null;
let fillLayer = null;   // choropleth (GeoJSON polygons)
let markerLayer = null; // circle markers / clusters

function initMap() {
  map = L.map('map', { preferCanvas: true }).setView([42.7, 25.5], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(map);
  renderMapLayers();
  $('#points-toggle').addEventListener('click', () => {
    state.mapPoints = !state.mapPoints;
    $('#points-toggle').classList.toggle('off', !state.mapPoints);
    renderMapLayers();
  });
}

const sumVotes = (recs) => {
  const votes = {};
  let valid = 0;
  for (const r of recs) {
    valid += r.valid;
    for (const [id, v] of Object.entries(r.votes)) votes[id] = (votes[id] || 0) + v;
  }
  return { votes, valid };
};

// Choropleth: color polygons by the winner(s) of the joined rows.
function renderChoropleth(layer) {
  for (const f of state.geo.districts.features) {
    const recs = f.properties.districts
      .map((name) => state.districts.find((d) => d.name === name))
      .filter(Boolean);
    if (!recs.length) continue;
    const merged = recs.length === 1
      ? recs[0]
      : (() => {
          const { votes, valid } = sumVotes(recs);
          return { name: 'София (град) — 23, 24, 25 ИР', votes, valid, sections: recs.reduce((s, r) => s + r.sections, 0) };
        })();
    const leadId = Object.entries(merged.votes).sort((a, b) => b[1] - a[1])[0][0];
    L.geoJSON(f, {
      style: { color: '#ffffff', weight: 1, fillColor: partyColor(leadId), fillOpacity: 0.8 },
    })
      .bindTooltip(
        recs.length > 1
          ? `${merged.name}<br>` + recs.map((r) => `${r.name.split('.')[0]} ИР: ${partyName(r.lead.id)}`).join(' · ')
          : `${rowName(merged)} — ${partyName(leadId)}`
      )
      .on('click', () => openRecord(merged))
      .addTo(layer);
  }
}

function settlementChoropleth(layer) {
  for (const f of state.geo.settlements.features) {
    const r = state.settlementsByEkatte.get(normEkatte(f.properties.ekatte));
    if (!r || !r.lead || !r.valid) continue;
    L.geoJSON(f, {
      style: { color: '#ffffff', weight: 0.6, fillColor: partyColor(r.lead.id), fillOpacity: 0.75, stroke: false },
    })
      .bindTooltip(`${r.name} — ${partyName(r.lead.id)} · ${fmt(r.valid)}`)
      .on('click', () => openRecord(r))
      .addTo(layer);
  }
}

function renderMapLayers() {
  if (fillLayer) map.removeLayer(fillLayer);
  if (markerLayer) map.removeLayer(markerLayer);
  fillLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);

  if (state.unit === 'districts') {
    if (state.geo.districts) renderChoropleth(fillLayer);
    if (state.mapPoints) renderDistrictPoints(markerLayer);
  } else {
    if (state.geo.settlements) settlementChoropleth(fillLayer);
    if (state.mapPoints) renderSettlementPoints(markerLayer);
  }
}

function renderDistrictPoints(layer) {
  const maxValid = Math.max(...state.districts.map((d) => d.valid));
  for (const d of state.districts) {
    if (!d.lead) continue;
    const r = 6 + 22 * Math.sqrt(d.valid / maxValid);
    L.circleMarker([d.lat, d.lon], {
      radius: r,
      color: '#ffffff',
      weight: 1.5,
      fillColor: partyColor(d.lead.id),
      fillOpacity: 0.9,
    })
      .bindTooltip(`${d.name} — ${partyName(d.lead.id)}`)
      .on('click', () => openRecord(d))
      .addTo(layer);
  }
}

function renderSettlementPoints(layer) {
  const cluster = L.markerClusterGroup({
    maxClusterRadius: 38,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    polygonOptions: { weight: 0.5, color: '#fff' },
  });
  const sliced = state.settlements.filter((s) => s.lead && s.valid > 0);
  const maxValid = Math.max(...sliced.map((s) => s.valid));
  for (const s of sliced) {
    const r = 3 + 10 * Math.sqrt(s.valid / maxValid);
    L.circleMarker([s.lat, s.lon], {
      radius: r,
      color: '#ffffff',
      weight: 0.9,
      fillColor: partyColor(s.lead.id),
      fillOpacity: 0.85,
    })
      .bindTooltip(`${s.name} — ${partyName(s.lead.id)}`)
      .on('click', () => openRecord(s))
      .addTo(cluster);
  }
  layer.addLayer(cluster);
}

function openRecord(r) {
  if (!r) return;
  const panel = $('#map-detail');
  panel.classList.remove('hidden');
  const arr = Object.entries(r.votes).sort((a, b) => b[1] - a[1]);
  const max = arr.length ? arr[0][1] : 1;
  panel.innerHTML = `<h3>${r.name} <span class="muted">· ${fmt(r.valid)} действителни</span></h3>` +
    arr
      .map(
        ([pid, v]) =>
          `<div class="row bar"><span>${partyName(pid)}</span><span class="amt">${fmt(v)}</span></div>` +
          `<div style="height:4px;background:#e8ebf0"><div style="height:4px;width:${(100 * v / max).toFixed(1)}%;background:${partyColor(pid)}"></div></div>`
      )
      .join('');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openDetail(name) {
  const r = rows().find((x) => rowName(x) === name);
  openRecord(r);
}

// ---- boot ------------------------------------------------------------------

(async () => {
  $('#status').textContent = 'Зареждане на данни…';
  try {
    await loadData();
    $('#status').textContent = 'Готово.';
    initMap();
  } catch (err) {
    $('#status').textContent = 'Грешка при зареждане на данните. Стартирай `node scripts/serve.mjs` и отвори през http://localhost:8000 (не през file://).';
    console.error(err);
  }
})();
