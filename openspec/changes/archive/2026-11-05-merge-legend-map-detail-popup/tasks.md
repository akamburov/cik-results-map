# Tasks

## 1. HTML Structure

- [x] 1.1 In `index.html`, remove the floating `<div id="legend">` element
- [x] 1.2 Restructure `#map-detail` into a collapsible sheet: a title bar button (`.detail-toggle`) holding a leading back-arrow button, the title text and the state chevron (`aria-expanded` / `aria-controls`), plus a `.detail-body` container for the content
- [x] 1.3 Remove the `×` close button markup from the popup and the `#footer` / `#stats-line` elements; keep a `#status` element that is hidden while empty
- [x] 1.4 Add an inline SVG icon and a `<span class="seg-label">` caption to each filter segmented button (Карта / Таблица, Райони / Населени места, Полигони / Точки) with `aria-label` + `title`

## 2. CSS

- [x] 2.1 Remove the `#legend` rules from `style.css` and move the `.sw` swatch rule under `.detail`
- [x] 2.2 Style the collapsible popup: always-visible title bar button, chevron rotation for expanded/collapsed, body `overflow: auto`, `max-height` (desktop ~45%, mobile ~60%)
- [x] 2.3 Style the overview body: candidate rows with a colour swatch, single-line ellipsised name (full name in `title`), a `total · share%` amount, and the existing 4px bar — same look as a record's rows
- [x] 2.4 Add a mobile media query (`max-width: 700px`) making `.topbar` and the filter row single-line: compact title with ellipsis, compact theme switch, `.seg-label` hidden so the controls are icon-only
- [x] 2.5 Style the standalone `#status` message so it appears without a persistent footer and stays readable on mobile
- [x] 2.6 Style the title-bar back arrow: hidden in overview mode, visible in record mode, visually distinct from the expand/collapse chevron

## 3. JavaScript — Popup State and Toggle

- [x] 3.1 Add `state.popupExpanded`, `state.popupMode`, `state.popupUserSet` and a `setPopupExpanded(bool)` helper that updates the class, `aria-expanded`, and the chevron
- [x] 3.2 Wire the title bar click to toggle the popup and set `state.popupUserSet = true`
- [x] 3.3 Apply the per-breakpoint default on boot: expanded on desktop, collapsed on mobile; re-apply on breakpoint-crossing resize only while the user has not toggled manually

## 4. JavaScript — Overview and Record Content

- [x] 4.1 Extract the existing candidate row markup (swatch + name + amount + bar) from `openRecord()` into one `candidateRowsHtml(votes, max)` helper so the overview and a record render identically
- [x] 4.2 Add `openOverview()` rendering the title `Общо за страната · N секции · N действителни гласа` from `meta.stats` and a body with all candidates via the shared helper, showing `N · x.x%` (share of `stats.totalValid`) with bars scaled to the national maximum; no region list and no winner
- [x] 4.3 Add the title-bar back arrow that calls `openOverview()` and is shown only in record mode
- [x] 4.4 Rework `openRecord(r)` to use the toggle title bar (`<name> [(region)] · N секции · N действителни`) and the shared row helper, keeping bars scaled to that record's maximum; keep `openDetail(key)` delegating to it
- [x] 4.5 Show the overview on initial load so an empty popup body never appears

## 5. JavaScript — Cleanup

- [x] 5.1 Delete `renderLegend()` and `updateStats()` and their calls in `renderTable()`; verify `renderTable()` still runs cleanly from the `popstate` handler (no dangling calls to the removed functions after back/forward navigation)
- [x] 5.2 Remove the `#stats-line` wiring and any `#legend` references from `app.js`
- [x] 5.3 Keep the boot error message flowing into `#status` (and hidden again after successful load)

## 6. Map Viewport and Map Click

- [x] 6.1 Replace the fixed `setView([42.7, 25.5], 7)` with `fitBounds` over the district geometry (fallback: district `lat`/`lon`), with padding and a `maxZoom` cap so the whole country is visible next to the expanded popup
- [x] 6.2 Fit on load and on every expand (including a breakpoint change); on collapse call `map.invalidateSize()` only, keeping the user's current view
- [x] 6.3 Add `map.on('click')` → `openOverview()` and call `DomEvent.stopPropagation()` in every feature click handler (choropleth, settlement choropleth, district points, settlement points) so record clicks do not reset the popup

## 7. Testing and Verification

- [x] 7.1 Desktop: page loads with the popup expanded showing the overview; the whole country is visible and the title shows the national section/vote counts
- [x] 7.2 Desktop: clicking the title bar collapses to the title bar only (chevron down) and expands again (chevron up); the map re-fits on expand and keeps the zoom on collapse
- [x] 7.3 Mobile: page loads with the popup collapsed to one line, header and filter row each on one line with icon-only controls, and tapping the title bar expands a scrollable body
- [x] 7.4 Overview lists all candidates with swatch, name, `total · share%` and a proportional bar (no regions, no winner); clicking a region or table row shows the same row layout scaled to that record
- [x] 7.5 No floating legend and no footer remain anywhere in the UI
- [x] 7.6 Back navigation: the title-bar arrow returns to the overview from a record, clicking empty map area does the same, and clicking a region/settlement/marker never resets the popup
- [x] 7.7 Theme switching updates the popup, title bar, and overview rows correctly
- [x] 7.8 Run locally with `node scripts/serve.mjs` and verify no console errors

## 8. Cleanup Verification

- [x] 8.1 Confirm desktop `fitBounds` shows the whole country and that collapsing does not change the user's zoom level
- [x] 8.2 Confirm overview bars are scaled to the largest candidate nationally while record bars scale to that record's largest, and that the overview shares sum to ~100%
