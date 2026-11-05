/* app.js — vanilla-JS election results app (map + filterable table).
 * Loads the precomputed JSON from data/ and renders with Leaflet 2.0 + DOM.
 * No framework, no bundler. ESM module (Leaflet 2.0 importmap in index.html).
 */
import { LeafletMap, TileLayer, LayerGroup, CircleMarker, GeoJSON, Canvas, DomEvent } from 'leaflet';
import { MarkerClusterGroup } from './vendor/leaflet.markercluster/src/index.js';

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
  popupExpanded: true,       // popup detail sheet open/closed
  popupMode: 'overview',     // 'overview' (national) | 'record'
  popupUserSet: false,        // true once the user toggled the popup manually
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
  if (map) {
    renderMapLayers();
  }
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
  // Sync tab active class + pressed state
  document.querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.tab === state.tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === state.tab + '-view'));
  const isMap = state.tab === 'map';
  $('#map-controls').classList.toggle('hidden', !isMap);
  $('#table-controls').classList.toggle('hidden', isMap);
  // Returning to the map tab: the container was display:none (0 size), so the
  // canvas vector layers were not drawn. Re-invalidate the size and re-render
  // the layers so the polygons/points actually appear (no click needed), then
  // restore the view we captured when we left — we do NOT re-fit, so the map
  // stays exactly where the user had it (no move to a new centre).
  if (isMap && map) {
    const restore = savedMapView;
    savedMapView = null;
    // Restore the view synchronously (before the map's first paint) so it never
    // shows a stale/default centre while the layers re-lay out (fixes the
    // Istanbul flash, worst in the dots/marker-cluster view).
    if (restore) map.setView(restore.center, restore.zoom, { animate: false });
    setTimeout(() => {
      map.invalidateSize();
      renderMapLayers();
    }, 0);
  } else if (map) {
    // Leaving the map tab: capture the current view to restore on return.
    savedMapView = { center: map.getCenter(), zoom: map.getZoom() };
  }

  // Sync unit switch buttons
  document.querySelectorAll('#unit-mode .seg-btn').forEach((b) => {
    const on = b.dataset.unit === state.unit;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });

  // Sync map mode buttons
  document.querySelectorAll('#map-mode .seg-btn').forEach((b) => {
    const on = b.dataset.mode === state.mapMode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
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
    document.querySelectorAll('#unit-mode .seg-btn').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
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
}

function shortName(id) {
  const n = candidateName(id);
  return n.length > 24 ? n.slice(0, 22) + '…' : n;
}

// ---- status ----------------------------------------------------------------

// Show a transient status/error message only while it has content; hidden
// otherwise (replaces the old always-visible footer stats line).
function setStatus(msg) {
  const el = $('#status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

// ---- map -------------------------------------------------------------------

let map = null;
let fillLayer = null;   // choropleth (GeoJSON polygons)
let markerLayer = null; // circle markers / clusters
let basemap = null;

function createBasemap() {
  basemap = new TileLayer(
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      maxZoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }
  ).addTo(map);
}

function initMap() {
  map = new LeafletMap('map', { renderer: new Canvas() });
  createBasemap();
  renderMapLayers();

  document.querySelectorAll('#map-mode .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#map-mode .seg-btn').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      state.mapMode = btn.dataset.mode;
      updateUrl();
      renderMapLayers();
    });
  });

  // Clicking empty map area returns to the national overview. Region,
  // settlement and marker clicks stop propagation, so they never reach here.
  map.on('click', () => { if (!mapClickSuppressed) openOverview(); });
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
    new GeoJSON(f, {
      style: { color: '#ffffff', weight: 1, fillColor: partyColor(leadId), fillOpacity: 0.8 },
    })
      .bindTooltip(
        recs.length > 1
          ? `${merged.name}<br>` + recs.map((r) => `${r.name.split('.')[0]} ИР: ${candidateName(r.lead.id)}`).join(' · ')
          : `${rowName(merged)} — ${candidateName(leadId)}`
      )
      .on('click', (e) => { openRecord(merged); DomEvent.stopPropagation(e); })
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
  x.fillStyle = dark ? 'rgba(20,23,28,0.65)' : 'rgba(233,236,240,0.55)';
  x.fillRect(0, 0, 12, 12);
  x.strokeStyle = dark ? '#6b7686' : '#8d949c';
  x.lineWidth = 1.4;
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
      new GeoJSON(f, {
        style: { color: '#b7bdc4', weight: 0.6, fillColor: getStripePattern(), fillOpacity: 0.85, stroke: false },
      })
        .bindTooltip('Землище без образувана секция')
        .addTo(layer);
      continue;
    }
    const r = state.settlementsByEkatte.get(normEkatte(f.properties.ekatte));
    if (!r || !r.lead || !r.valid) continue;
    new GeoJSON(f, {
      style: { color: '#ffffff', weight: 0.6, fillColor: partyColor(r.lead.id), fillOpacity: 0.75, stroke: false },
    })
      .bindTooltip(`${r.name} — ${candidateName(r.lead.id)} · ${fmt(r.valid)}`)
      .on('click', (e) => { openRecord(r); DomEvent.stopPropagation(e); })
      .addTo(layer);
  }
}

function renderMapLayers() {
  if (fillLayer) map.removeLayer(fillLayer);
  if (markerLayer) map.removeLayer(markerLayer);
  fillLayer = new LayerGroup().addTo(map);
  markerLayer = new LayerGroup().addTo(map);

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
    new CircleMarker([d.lat, d.lon], {
      radius: r,
      color: '#ffffff',
      weight: 1.5,
      fillColor: partyColor(d.lead.id),
      fillOpacity: 0.9,
    })
      .bindTooltip(`${d.name} — ${candidateName(d.lead.id)}`)
      .on('click', (e) => { openRecord(d); DomEvent.stopPropagation(e); })
      .addTo(layer);
  }
}

function renderSettlementPoints(layer) {
  const cluster = new MarkerClusterGroup({
    maxClusterRadius: 38,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    polygonOptions: { weight: 0.5, color: '#fff' },
  });
  const sliced = state.settlements.filter((s) => s.lead && s.valid > 0);
  const maxValid = Math.max(...sliced.map((s) => s.valid));
  for (const s of sliced) {
    const r = 3 + 10 * Math.sqrt(s.valid / maxValid);
    new CircleMarker([s.lat, s.lon], {
      radius: r,
      color: '#ffffff',
      weight: 0.9,
      fillColor: partyColor(s.lead.id),
      fillOpacity: 0.85,
    })
      .bindTooltip(`${s.name} — ${candidateName(s.lead.id)}`)
      .on('click', (e) => { openRecord(s); DomEvent.stopPropagation(e); })
      .addTo(cluster);
  }
  layer.addLayer(cluster);
}

// Suppress a map-background click that fires in the same event as a feature
// click, so a record is not immediately reset back to the overview.
let mapClickSuppressed = false;

// The map view captured while it is hidden (table tab), restored when we return
// to the map tab instead of re-fitting (so the map does not move).
let savedMapView = null;

function openRecord(r) {
  if (!r) return;
  state.popupMode = 'record';
  mapClickSuppressed = true;
  setTimeout(() => { mapClickSuppressed = false; }, 0);
  const reg = regionLabel(r);
  const regTxt = reg ? ` (${reg})` : '';
  $('#detail-title').textContent = `${r.name}${regTxt} · ${fmt(r.sections)} секции · ${fmt(r.valid)} действителни гласа`;
  $('#detail-back').classList.remove('hidden');
  const arr = Object.entries(r.votes);
  const max = arr.length ? Math.max(...arr.map(([, v]) => v)) : 1;
  $('#map-detail-body').innerHTML = candidateRowsHtml(r.votes, max);
  setPopupExpanded(true, true);
}

// Shared per-candidate row markup (swatch + ellipsised name + amount + bar),
// used by both the national overview and a single record. `maxvalue` scales
// the bars; `shareOf` (optional) appends the candidate's share of that total.
function candidateRowsHtml(votes, maxvalue, shareOf) {
  return Object.entries(votes)
    .sort((a, b) => b[1] - a[1])
    .map(([pid, v]) => {
      const share = shareOf ? ` · ${(100 * v / shareOf).toFixed(1)}%` : '';
      return `<div class="row bar"><span class="sw" style="background:${partyColor(pid)}"></span>` +
        `<span class="cname" title="${esc(candidateName(pid))}">${esc(candidateName(pid))}</span>` +
        `<span class="amt">${fmt(v)}${share}</span></div>` +
        `<div style="height:4px;background:var(--border)"><div style="height:4px;width:${(100 * v / maxvalue).toFixed(1)}%;background:${partyColor(pid)}"></div></div>`;
    })
    .join('');
}

// National overview: the legend itself, with each candidate's share of the
// whole country. Replaces the removed floating legend and footer stats.
function openOverview() {
  state.popupMode = 'overview';
  const s = state.meta.stats;
  $('#detail-title').textContent = `Общо · ${fmt(s.countedSections)} секции · ${fmt(s.totalValid)} действителни гласа`;
  $('#detail-back').classList.add('hidden');
  const votes = {};
  for (const c of state.meta.candidates) votes[c.partyId] = countOverall(c.partyId);
  const max = Math.max(...Object.values(votes), 1);
  $('#map-detail-body').innerHTML = candidateRowsHtml(votes, max, s.totalValid);
}

// Flatten a GeoJSON geometry's [lng, lat] coordinates into `out`.
function collectCoords(geom, out) {
  if (!geom) return;
  if (Array.isArray(geom)) {
    if (geom.length >= 2 && typeof geom[0] === 'number') {
      out.push(geom);
    } else {
      for (const g of geom) collectCoords(g, out);
    }
  }
}

// Fit the map so the whole country is visible (padding for the open popup).
function fitMapToCountry() {
  if (!map) return;
  let coords = [];
  if (state.geo.districts && state.geo.districts.features) {
    for (const f of state.geo.districts.features) collectCoords(f.geometry, coords);
  }
  if (!coords.length) coords = state.districts.map((d) => [d.lon, d.lat]);
  if (!coords.length) return;
  const lats = coords.map((c) => c[1]);
  const lngs = coords.map((c) => c[0]);
  map.fitBounds(
    [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
    { padding: [12, 12], maxZoom: 8, animate: false }
  );
}

// Expand/collapse the popup. Fitting happens only when expanding, so a
// collapse keeps the user's current zoom (per design); the size is always
// invalidated so the map fills the freed space.
function setPopupExpanded(expanded, doFit) {
  state.popupExpanded = expanded;
  const detail = $('#map-detail');
  detail.classList.toggle('collapsed', !expanded);
  const tg = $('#detail-toggle');
  tg.setAttribute('aria-expanded', String(expanded));
  tg.setAttribute('aria-label', expanded ? 'Скриване на разбивката' : 'Показване на разбивката');
  if (map) {
    map.invalidateSize();
    // The canvas vector layers do not redraw on invalidateSize alone, so
    // re-render them (both on expand and collapse) or they disappear.
    renderMapLayers();
    if (doFit && expanded) fitMapToCountry();
  }
}

// Title-bar controls: the title toggles the sheet; the back arrow returns to
// the national overview from a record.
$('#detail-toggle').addEventListener('click', () => {
  state.popupUserSet = true;
  setPopupExpanded(!state.popupExpanded, true);
});
$('#detail-back').addEventListener('click', () => openOverview());

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
  setStatus('Зареждане на данни…');
  try {
    await loadData();
    setStatus('');
    initMap();
    // Per-breakpoint default: expanded on desktop, collapsed on mobile. The
    // collapsed bar still carries the national summary to invite a tap.
    const isMobile = window.matchMedia('(max-width: 700px)').matches;
    state.popupExpanded = !isMobile;
    openOverview();
    setPopupExpanded(!isMobile, true);
  } catch (err) {
    setStatus('Грешка при зареждане на данните. Стартирай `node scripts/serve.mjs` и отвори през http://localhost:8000 (не през file://).');
    console.error(err);
  }
})();

// Re-apply the per-breakpoint default when crossing the mobile breakpoint,
// but only until the user has toggled the popup manually (per design).
const mobileMq = window.matchMedia('(max-width: 700px)');
const onBreakpoint = (e) => {
  if (state.popupUserSet || !state.meta) return;
  setPopupExpanded(!e.matches, true);
};
if (mobileMq.addEventListener) mobileMq.addEventListener('change', onBreakpoint);
else if (mobileMq.addListener) mobileMq.addListener(onBreakpoint);
