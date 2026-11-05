# Design

## Context

Today `index.html` has three summary-ish surfaces: a floating `#legend` panel (`position: fixed`, candidate names + swatches, rendered by `renderLegend()`), a `#map-detail` panel inside `#map-view` that `openRecord()` fills with per-candidate bars after a map click or a table row click, and a `#footer` holding `#stats-line` (counted sections / total valid / leader) plus `#status` (loading and error messages). `renderTable()` calls `renderLegend()` and `updateStats()`, `initMap()` creates the Leaflet map with a fixed `setView([42.7, 25.5], 7)`, and `style.css` has no media queries.

The legend and the popup already show the same candidate list, so they are one component split in two. This change makes the popup that component, adds a national overview as its default content, and drops the footer.

See proposal.md - Why for motivation.

## Goals / Non-Goals

**Goals:**
- One component: the popup carries the legend (candidate swatches), the numbers, and the per-record breakdown.
- A collapsible popup whose always-visible title bar is the toggle — no `×`, no footer toggle.
- Desktop: expanded on load with the national overview; map fitted so the whole country is visible.
- Mobile: collapsed on load, opened by tapping the title bar; one-line header.
- Remove the floating legend and the footer.

**Non-Goals:**
- Do not change `data/*.json`, the preprocessing pipeline, or the choropleth/point rendering.
- Do not add URL state for the popup (it stays transient; the URL contract is unchanged).
- Do not add new filters, sorting, or unit modes.

## Decisions

- **Host element**: keep `#map-detail` (and its `.detail` class) as the popup; delete `#legend` from `index.html` and the `#legend` / `#legend .items` / `#legend .li` / `#legend .sw` rules from `style.css`, moving `.sw` under `.detail`.
- **Collapsible structure**: the popup is a flex column — a title bar (always rendered) and a body (`#map-detail .detail-body`) that is hidden when collapsed. The title bar is a real control: `<button class="detail-toggle" aria-expanded="…" aria-controls="map-detail-body">` containing the title text and a chevron span; the chevron points up when expanded and down when collapsed (single SVG rotated by CSS, or two glyphs). The old `.close-detail` `×` button is removed.
- **State**: `state.popupExpanded` (bool) plus `state.popupMode` (`'overview' | 'record'`) and `state.popupUserSet` (true once the user has toggled manually). `setPopupExpanded(bool)` updates the class, the `aria-expanded` flag and the chevron; it also calls `map.invalidateSize()` and re-runs the fit so the country stays visible.
- **Overview mode** (`openOverview()`): title = `Общо за страната · <stats.countedSections> секции · <stats.totalValid> действителни гласа` (via `fmt`). Body = one row per candidate, sorted by national votes desc: colour swatch (`partyColor()`), candidate name, amount rendered as `522 628 · 36.3%` (total plus share of `stats.totalValid`), and the existing horizontal bar — the same markup the record view already emits. Extract the current inline row/bar template from `openRecord()` into one `candidateRowsHtml(votes, max)` helper so both views render identically; only the bar scale differs (national maximum vs the record's maximum). Names run up to 63 characters, so rows stay single-column with `text-overflow: ellipsis` and the full name in a `title` attribute. No region list, no winner column.
- **Overview height**: 27 rows at ~24px (row + 4px bar) ≈ 650px, roughly 1.8 screens inside a 40% desktop panel; raise the desktop `max-height` to ~45% and let the body scroll rather than compressing the bars.
- **Record mode** (`openRecord(r)`, unchanged trigger paths): title = `<name> [(region)] · <r.sections> секции · <r.valid> действителни`; body = existing per-candidate bars, with the swatch added to each row. `openDetail(key)` (table row click) still delegates to `openRecord`.
- **Back to the overview**: in record mode the title bar shows a leading `chevron-left` button that calls `openOverview()`; it is hidden in overview mode. It is a separate control from the right-hand expand/collapse chevron, so the title bar never overloads one click with two meanings.
- **Empty-map click**: `map.on('click', …)` calls `openOverview()`. Every per-feature click handler (`renderChoropleth`, `settlementChoropleth`, `renderDistrictPoints`, `renderSettlementPoints`) must call `DomEvent.stopPropagation()` so a record click does not also fire the map click; the uncounted-settlement polygons have no handler and therefore intentionally fall through to the overview.
- **Defaults and breakpoint**: mobile = `matchMedia('(max-width: 700px)')`. On boot, after data load and `initMap()`: desktop → `setPopupExpanded(true)` + `openOverview()`; mobile → `setPopupExpanded(false)` + `openOverview()` (so the collapsed bar still shows the national summary). A resize that crosses the breakpoint re-applies the default only while `state.popupUserSet` is false.
- **Layout**: the popup stays an in-flow child of `#map-view` (a flex column), so expanding it shrinks the map instead of overlaying it: `max-height: 40%` on desktop, `min(60vh, 60%)` on mobile, body `overflow: auto`. Every expand/collapse calls `map.invalidateSize()`.
- **Map fit**: replace the hard-coded `setView([42.7, 25.5], 7)` after layers exist with `map.fitBounds(bounds, { padding: [12, 12], maxZoom: 8 })`, where `bounds` comes from the `districts-geo.json` features (fallback: district `lat`/`lon` points from `districts.json`). Fit policy: fit once after load, and on every **expand** (also after a breakpoint change); on **collapse** only call `invalidateSize()` so the country does not zoom in and out on each click, keeping the user's view. `32. Извън страната` has no polygon, so it never widens the bounds.
- **Footer removal**: drop `<footer id="footer">` and `#stats-line`; delete `updateStats()` and its call in `renderTable()`. Keep the status message as a slim `<div id="status" role="status">` that is `hidden` while empty (set by the boot `try/catch`), so load/error information still reaches the user without a persistent bar.
- **Mobile header and filters**: media query at `max-width: 700px` makes `.topbar` `flex-wrap: nowrap` with `h1 { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }` and a compact `.theme-switch`, so the header is exactly one line. Every `.seg-btn` (Карта / Таблица, Райони / Населени места, Полигони / Точки) gets an inline SVG icon plus a `<span class="seg-label">` caption: both visible on desktop, `.seg-label` hidden on mobile (icon-only), with `aria-label` + `title` carrying the name and `aria-pressed` the state. The filter row then stays on one line as well.
- **Tabs**: the popup lives inside `#map-view`, so switching to the table tab hides it with the view; no extra toggle bookkeeping is needed.
- **Theme and accessibility**: popup colours keep using the existing CSS variables; the title bar toggle, the back arrow, and the expand/collapse chevron are native `<button>`s with names, and the map's polygons stay non-focusable — the popup body is now the keyboard-reachable path to a record (table rows and, previously, legend rows).

## Risks / Trade-offs

- **Risk**: on desktop the expanded popup steals map height and can leave the map cramped on short screens.
  - **Mitigation**: `fitBounds` runs on load and on each expand, the body scrolls, and collapsing is a single click on the title.
- **Risk**: the title bar is now the only affordance, so a user who never clicks it may not discover the breakdown.
  - **Mitigation**: desktop starts expanded; mobile shows the chevron plus summary numbers in the collapsed bar as an invitation to tap.
- **Risk**: removing the footer removes a place for the "start `node scripts/serve.mjs`" error hint.
  - **Mitigation**: the status element keeps the same message and only appears when there is something to say.
- **Risk**: painting a record and then clicking nearby empty map area resets the popup by accident.
  - **Mitigation**: only the map background handler resets, and per-feature clicks stop propagation, so a slight miss on a small settlement polygon still opens that polygon rather than clearing the panel.
- **Trade-off**: the overview is a country-wide candidate list only, so a region's own numbers are reached by clicking the region (or a table row), not from the overview body.

## Migration Plan

1. `index.html`: remove `#legend`; replace `#map-detail`'s static container with the toggle title bar (back arrow + title + chevron) + body skeleton; remove `#footer`/`#stats-line` and keep `#status`; add inline icons + `<span class="seg-label">` captions to the segmented controls.
2. `style.css`: drop `#legend` rules, add `.detail` collapsible/toggle/chevron/swatch/overview-row styles, and under `max-width: 700px` hide `.seg-label`, compact `.topbar`, and keep the filter row on one line.
3. `app.js`: add `openOverview()`, `setPopupExpanded()`, `state.popupExpanded/popupMode/popupUserSet`; rework `openRecord()` into the toggle title bar + swatch rows; add the title-bar back arrow and `map.on('click')` → `openOverview()` with `DomEvent.stopPropagation()` in every feature handler; delete `renderLegend()`/`updateStats()` and their calls; fit on load and on expand only, `invalidateSize()` on collapse.
4. Verify desktop and mobile behaviour in the local server (`node scripts/serve.mjs`), including theme switch, table tab, empty-map click, and icon-only filters.
5. Deploy to GitHub Pages (no build step).

## Open Questions

- None blocking. Settled: share of the national valid vote sits next to the raw total, and the overview reuses the record view's bar layout via a shared row renderer.
