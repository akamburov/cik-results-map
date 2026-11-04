/* app.js — vanilla-JS election results app (map + filterable table).
 * Loads the precomputed JSON from data/ and renders with Leaflet + DOM.
 * No framework, no bundler.
 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const state = {
  meta: null,
  districts: [],
  settlements: [],
  sections: [],
  geo: { districts: null, settlements: null },
  settlementsByEkatte: null, // Map normEkatte -> settlement record
  tab: 'map',               // 'map' | 'table'
  unit: 'districts',        // 'districts' | 'settlements'
  mapMode: 'choropleth',    // 'choropleth' | 'dots'
  query: '',
  selectedCandidates: null, // Set of candidate/party list numbers shown as table columns
  defaultCandidates: null,  // Set of default candidate numbers (top 6 by votes)
  tableRow: {},            // current row unit name for detail
  sort: { col: 'valid', dir: -1 },
};

// ---- theme ----------------------------------------------------------------

const THEME_KEY = 'theme';

// Toggle the palette: light/dark, persisted, and mirrored onto the switch.
// index.html already resolved the initial theme before first paint (stored
// choice → OS preference → light); this keeps the UI in sync and handles
// later clicks / OS changes.
function applyTheme(theme, persist) {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('#theme-switch .seg-btn').forEach((b) => {
    const on = b.dataset.themeValue === theme;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      // storage blocked (private mode / tracking prevention) — theme still applies
    }
  }
  // the uncounted-settlement hatch is baked per palette, so rebuild it
  stripePattern = null;
  if (map) renderMapLayers();
}

function initTheme() {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', false);
  document.querySelectorAll('#theme-switch .seg-btn').forEach((b) =>
    b.addEventListener('click', () => applyTheme(b.dataset.themeValue, true))
  );
  // follow the OS while the user has made no explicit choice
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (mq) {
    const onChange = (e) => {
      let stored = null;
      try {
        stored = localStorage.getItem(THEME_KEY);
      } catch (err) {
        // ignore
      }
      if (!stored) applyTheme(e.matches ? 'dark' : 'light', false);
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
}

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

  // default selected candidates = top N by overall valid votes
  const top = [...meta.candidates]
    .map((c) => [c.partyId, countOverall(c.partyId)])
    .filter(([, votes]) => votes > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id]) => id);
  state.defaultCandidates = new Set(top);

  loadStateFromUrl();
  syncControlsToState();
  renderChips();
  renderTable();
}

function countOverall(partyId) {
  let s = 0;
  for (const d of state.districts) s += (d.votes[partyId] || 0);
  return s;
}

// ---- url state sync --------------------------------------------------------

function loadStateFromUrl() {
  const params = new URLSearchParams(window.location.search);

  // Tab
  const view = params.get('view');
  if (view === 'map' || view === 'table') state.tab = view;

  // Unit
  const unit = params.get('unit');
  if (unit === 'districts' || unit === 'settlements') state.unit = unit;

  // Map Mode
  const mode = params.get('mode');
  if (mode === 'choropleth' || mode === 'dots') state.mapMode = mode;

  // Query search
  const q = params.get('q');
  if (q != null) state.query = q.trim();

  // Selected candidate columns
  const candidates = params.get('candidates') || params.get('parties');
  if (candidates != null) {
    const list = candidates.split(',').map((s) => s.trim()).filter((id) => state.meta.candidates.some((c) => c.partyId === id));
    state.selectedCandidates = new Set(list);
  } else if (!state.selectedCandidates) {
    state.selectedCandidates = new Set(state.defaultCandidates);
  }

  // Sort column & direction
  const sort = params.get('sort');
  if (sort) {
    const dir = params.get('dir') === 'asc' ? 1 : -1;
    state.sort = { col: sort, dir };
  }
}

function syncControlsToState() {
  // Sync tab active class
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === state.tab + '-view'));
  const isMap = state.tab === 'map';
  $('#map-controls').classList.toggle('hidden', !isMap);
  $('#table-controls').classList.toggle('hidden', isMap);
  if (isMap) {
    if (map) setTimeout(() => map.invalidateSize(), 0);
    $('#legend').classList.remove('hidden');
  } else {
    $('#legend').classList.add('hidden');
  }

  // Sync unit switch buttons
  document.querySelectorAll('#unit-mode .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.unit === state.unit);
  });

  // Sync map mode buttons
  document.querySelectorAll('#map-mode .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === state.mapMode);
  });

  // Sync search input
  const searchInput = $('#search');
  if (searchInput) searchInput.value = state.query || '';
}

function updateUrl() {
  const params = new URLSearchParams();

  // Tab (default is map)
  if (state.tab !== 'map') params.set('view', state.tab);

  // Unit (default is districts)
  if (state.unit !== 'districts') params.set('unit', state.unit);

  // Map mode (default is choropleth)
  if (state.mapMode !== 'choropleth') params.set('mode', state.mapMode);

  // Search query
  if (state.query) params.set('q', state.query);

  // Selected candidate columns (if different from default top 6)
  if (state.selectedCandidates) {
    const isDefault =
      state.defaultCandidates &&
      state.selectedCandidates.size === state.defaultCandidates.size &&
      [...state.selectedCandidates].every((id) => state.defaultCandidates.has(id));
    if (!isDefault) {
      params.set('candidates', getOrderedCandidates().join(','));
    }
  }

  // Sort column & direction (default is valid desc)
  if (state.sort.col !== 'valid' || state.sort.dir !== -1) {
    params.set('sort', state.sort.col);
    params.set('dir', state.sort.dir === 1 ? 'asc' : 'desc');
  }

  const qs = params.toString();
  const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', newUrl);
}

// ---- helpers ---------------------------------------------------------------

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('bg-BG').replace(/\u00A0/g, ' '));
const normEkatte = (v) => String(v).replace(/\D/g, '').padStart(5, '0');
const candidateName = (id) => {
  const c = state.meta.candidates.find((x) => x.partyId === id);
  const name = c && c.name ? c.name : (() => {
    const p = state.meta.parties.find((x) => x.id === id);
    return p ? p.name.split('-')[0] : id;
  })();
  return `${id}. ${name}`;
};
const partyColor = (id) => state.meta.partyColors[id] || '#888';
const getOrderedCandidates = () => {
  if (!state.selectedCandidates) return [];
  return [...state.meta.candidates]
    .map((c) => [c.partyId, countOverall(c.partyId)])
    .filter(([id, votes]) => votes > 0 && state.selectedCandidates.has(id))
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
};
const rows = () => (state.unit === 'districts' ? state.districts : state.settlements);
const rowName = (r) => (state.unit === 'districts' ? r.name : r.name);
// Region label for display only (strips the "01. " prefix); never part of
// the search query matching, so typing a region does not filter settlements.
const regionLabel = (r) => (r.region ? String(r.region).replace(/^\s*\d+\.\s*/, '') : '');
const rowKey = (r) => (state.unit === 'districts' ? `d:${r.name}` : `s:${r.ekatte}`);

// ---- tabs ------------------------------------------------------------------

document.querySelectorAll('.tab').forEach((btn) =>
  btn.addEventListener('click', () => showTab(btn.dataset.tab))
);
function showTab(name) {
  state.tab = name;
  updateUrl();
  syncControlsToState();
}

// ---- filters ---------------------------------------------------------------

document.querySelectorAll('#unit-mode .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#unit-mode .seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.unit = btn.dataset.unit;
    state.sort = { col: 'valid', dir: -1 };
    updateUrl();
    renderTable();
    renderMapLayers(); // update map layers to the selected unit
  });
});
$('#search').addEventListener('input', (e) => {
  state.query = e.target.value.trim();
  updateUrl();
  renderTable();
});

function renderChips() {
  const wrap = $('#party-chips');
  wrap.innerHTML = '';
  const ordered = [...state.meta.candidates]
    .map((c) => [c, countOverall(c.partyId)])
    .filter(([, votes]) => votes > 0)
    .sort((a, b) => b[1] - a[1]);
  for (const [c] of ordered) {
    const el = document.createElement('button');
    el.className = 'chip' + (state.selectedCandidates.has(c.partyId) ? '' : ' off');
    el.innerHTML = `<span class="dot" style="background:${partyColor(c.partyId)}"></span>${candidateName(c.partyId)}`;
    el.addEventListener('click', () => {
      if (state.selectedCandidates.has(c.partyId)) state.selectedCandidates.delete(c.partyId);
      else state.selectedCandidates.add(c.partyId);
      updateUrl();
      renderChips();
      renderTable();
    });
    wrap.appendChild(el);
  }
}

// ---- table -----------------------------------------------------------------

function renderTable() {
  const q = (state.query || '').trim().toLowerCase();
  const data = rows().filter((r) => {
    if (!q) return true;
    const name = (rowName(r) || '').toLowerCase();
    const settle = (r.settlement || r.name || '').toLowerCase();
    const lead = r.lead ? candidateName(r.lead.id).toLowerCase() : '';
    // NOTE: r.region is intentionally excluded from the search fields.
    return name.includes(q) || settle.includes(q) || lead.includes(q);
  });

  const candidateIds = getOrderedCandidates();
  const thead = $('#thead');
  const tbody = $('#tbody');

  const cols = [
    { key: 'name', label: state.unit === 'districts' ? 'Избирателен район' : 'Населено място', align: 'left', cls: 'col-name' },
    { key: 'lead', label: 'Победител', align: 'left', cls: 'col-lead' },
    { key: 'sections', label: 'Секции' },
    { key: 'valid', label: 'Действителни' },
    ...candidateIds.map((id) => ({ key: id, label: shortName(id), title: candidateName(id), p: true })),
  ];

  // cells of these columns are capped in CSS (.cell-text) so very long names
  // ("Обединено кралство …, Лондон") wrap instead of widening the table
  const cellClass = (c) => [c.align === 'left' ? 'col-align-left' : '', c.cls || ''].filter(Boolean).join(' ');

  thead.innerHTML = cols
    .map((c) => {
      const active = state.sort.col === c.key;
      const arrow = active ? (state.sort.dir < 0 ? ' ▾' : ' ▴') : '';
      const cls = cellClass(c);
      const alignClass = cls ? ` class="${cls}"` : '';
      const titleAttr = c.title ? ` title="${c.title.replace(/"/g, '&quot;')}"` : '';
      return `<th data-col="${c.key}"${alignClass}${titleAttr}>${c.label}${arrow}</th>`;
    })
    .join('');

  thead.querySelectorAll('th').forEach((th) =>
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sort.col === col) state.sort.dir *= -1;
      else state.sort = { col, dir: -1 };
      updateUrl();
      renderTable();
    })
  );

  const val = (r, col) => {
    if (col === 'name') return rowName(r);
    if (col === 'lead') return r.lead ? candidateName(r.lead.id) : '—';
    if (col === 'sections') return r.sections;
    if (col === 'valid') return r.valid;
    return (r.votes[col] || 0);
  };

  data.sort((a, b) => {
    const av = val(a, state.sort.col);
    const bv = val(b, state.sort.col);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * state.sort.dir;
    const cmp = String(av).localeCompare(String(bv), 'bg');
    // same-named settlements: keep the rows deterministic by region
    if (cmp === 0 && state.sort.col === 'name') {
      return regionLabel(a).localeCompare(regionLabel(b), 'bg');
    }
    return cmp * state.sort.dir;
  });

  tbody.innerHTML = data
    .map((r) => {
      const cells = cols.map((c) => {
        const cls = cellClass(c);
        const clsAttr = cls ? ` class="${cls}"` : '';
        // recolor the "Победител" cell with the winning party's color
        const leadStyle = c.key === 'lead' && r.lead ? ` style="color:${partyColor(r.lead.id)};font-weight:600"` : '';
        if (c.key === 'name') {
          // muted region in parentheses disambiguates same-named settlements
          const reg = state.unit === 'settlements' ? regionLabel(r) : '';
          const suffix = reg ? ` <span class="row-region">(${esc(reg)})</span>` : '';
          const full = esc(reg ? `${rowName(r)} (${reg})` : rowName(r));
          return `<td${clsAttr}><span class="cell-text" title="${full}">${esc(rowName(r))}${suffix}</span></td>`;
        }
        const v = val(r, c.key);
        const text = typeof v === 'number' ? fmt(v) : v;
        const body = c.cls ? `<span class="cell-text" title="${esc(v)}">${text}</span>` : text;
        return `<td${clsAttr}${leadStyle}>${body}</td>`;
      });
      return `<tr data-key="${esc(rowKey(r))}">${cells.join('')}</tr>`;
    })
    .join('') || '<tr><td colspan="9" class="muted">Няма резултати.</td></tr>';

  tbody.querySelectorAll('tr[data-key]').forEach((tr) =>
    tr.addEventListener('click', () => openDetail(tr.dataset.key))
  );

  renderLegend();
  updateStats();
}

function shortName(id) {
  const n = candidateName(id);
  return n.length > 24 ? n.slice(0, 22) + '…' : n;
}

// ---- legend & stats --------------------------------------------------------

function renderLegend() {
  const leg = $('#legend');
  const order = [...state.meta.candidates]
    .map((c) => [c, countOverall(c.partyId)])
    .filter(([, votes]) => votes > 0)
    .sort((a, b) => b[1] - a[1]);
  leg.innerHTML = '<div class="muted" style="margin-bottom:6px;font-weight:600">Кандидати</div>' +
    '<div class="items">' +
    order.map(([c]) => `<div class="li"><span class="sw" style="background:${partyColor(c.partyId)}"></span><span>${candidateName(c.partyId)}</span></div>`).join('') +
    '</div>';
}

function updateStats() {
  const s = state.meta.stats;
  $('#stats-line').textContent =
    `${fmt(s.countedSections)} секции · ${fmt(s.totalValid)} действителни гласа · Лидер: ${s.leader ? candidateName(s.leader.id) : '—'}`;
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

  document.querySelectorAll('#map-mode .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#map-mode .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.mapMode = btn.dataset.mode;
      updateUrl();
      renderMapLayers();
    });
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
          ? `${merged.name}<br>` + recs.map((r) => `${r.name.split('.')[0]} ИР: ${candidateName(r.lead.id)}`).join(' · ')
          : `${rowName(merged)} — ${candidateName(leadId)}`
      )
      .on('click', () => openRecord(merged))
      .addTo(layer);
  }
}

// Reusable diagonal grey hatch pattern for cadastral territories with no polled
// section (preferCanvas lets us pass a CanvasPattern as the fill).
let stripePattern = null;
function getStripePattern() {
  if (stripePattern) return stripePattern;
  const dark = document.documentElement.dataset.theme === 'dark';
  const c = document.createElement('canvas');
  c.width = 12;
  c.height = 12;
  const x = c.getContext('2d');
  x.fillStyle = dark ? 'rgba(43,49,59,0.85)' : 'rgba(233,236,240,0.55)';
  x.fillRect(0, 0, 12, 12);
  x.strokeStyle = dark ? '#4c5666' : '#a4aab1';
  x.lineWidth = 1.1;
  x.beginPath();
  x.moveTo(0, 12);
  x.lineTo(12, 0);
  x.stroke();
  stripePattern = x.createPattern(c, 'repeat');
  return stripePattern;
}

function settlementChoropleth(layer) {
  for (const f of state.geo.settlements.features) {
    if (f.properties.uncounted) {
      L.geoJSON(f, {
        style: { color: '#b7bdc4', weight: 0.6, fillColor: getStripePattern(), fillOpacity: 0.85, stroke: false },
      })
        .bindTooltip('Землище без образувана секция')
        .addTo(layer);
      continue;
    }
    const r = state.settlementsByEkatte.get(normEkatte(f.properties.ekatte));
    if (!r || !r.lead || !r.valid) continue;
    L.geoJSON(f, {
      style: { color: '#ffffff', weight: 0.6, fillColor: partyColor(r.lead.id), fillOpacity: 0.75, stroke: false },
    })
      .bindTooltip(`${r.name} — ${candidateName(r.lead.id)} · ${fmt(r.valid)}`)
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
    if (state.mapMode === 'choropleth') {
      if (state.geo.districts) renderChoropleth(fillLayer);
    } else {
      renderDistrictPoints(markerLayer);
    }
  } else {
    if (state.mapMode === 'choropleth') {
      if (state.geo.settlements) settlementChoropleth(fillLayer);
    } else {
      renderSettlementPoints(markerLayer);
    }
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
      .bindTooltip(`${d.name} — ${candidateName(d.lead.id)}`)
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
      .bindTooltip(`${s.name} — ${candidateName(s.lead.id)}`)
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
  const reg = regionLabel(r);
  const regHtml = reg ? ` <span class="row-region">(${esc(reg)})</span>` : '';
  panel.innerHTML = `<h3 class="detail-head"><span class="detail-title">${esc(r.name)}${regHtml} <span class="muted">· ${fmt(r.valid)} действителни</span></span><button class="close-detail" aria-label="Затвори">&times;</button></h3>` +
    arr
      .map(
        ([pid, v]) =>
          `<div class="row bar"><span>${candidateName(pid)}</span><span class="amt">${fmt(v)}</span></div>` +
          `<div style="height:4px;background:var(--border)"><div style="height:4px;width:${(100 * v / max).toFixed(1)}%;background:${partyColor(pid)}"></div></div>`
      )
      .join('');
  
  panel.querySelector('.close-detail').onclick = () => panel.classList.add('hidden');
  
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openDetail(key) {
  const r = rows().find((x) => rowKey(x) === key);
  openRecord(r);
}

// Back / forward navigation
window.addEventListener('popstate', () => {
  if (!state.meta) return;
  loadStateFromUrl();
  syncControlsToState();
  renderChips();
  renderTable();
  if (map) renderMapLayers();
});

// ---- boot ------------------------------------------------------------------

(async () => {
  initTheme();
  $('#status').textContent = 'Зареждане на данни…';
  try {
    await loadData();
    $('#status').textContent = '';
    initMap();
  } catch (err) {
    $('#status').textContent = 'Грешка при зареждане на данните. Стартирай `node scripts/serve.mjs` и отвори през http://localhost:8000 (не през file://).';
    console.error(err);
  }
})();
