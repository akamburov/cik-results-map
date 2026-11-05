# Proposal

## Why

The map detail popup and the standalone legend currently compete for the same job. The popup lists candidate names and vote counts but gives no colour key, while the floating `#legend` panel repeats those names with swatches and floats over the tiles. The footer repeats summary numbers that belong next to the data they describe. Folding the legend into the popup removes a component, unclutters the map, and makes the colour key available exactly where users read the numbers — including a national overview that is useful before anything is clicked.

## What Changes

- The floating `#legend` panel is removed; its colour key is ported into the map detail popup — candidate rows in the popup get colour swatches.
- The popup becomes a collapsible sheet inside the map view: a title bar that is always visible, and a detail body that expands/collapses when the title bar is clicked. The `×` close button is replaced by an up/down chevron that reflects the state.
- The popup title carries the summary `xxx секции · x xxx действителни гласа` (national totals for the overview, the record's own totals for a region/settlement/section).
- New national overview content: candidate totals for the whole country — colour swatch, candidate name, national valid votes with the candidate's share of the national valid vote, and the same horizontal bar used for a record's rows (the legend itself, now with numbers). No per-region list and no winner column.
- Navigation back to the overview: a left-arrow control in the title bar (shown while a region, settlement, or section is open) and a click on empty map area both return the popup to the national overview.
- Desktop: the popup is expanded on initial load showing the overview; the map's initial viewport is fitted so the whole country is visible next to the open popup.
- Filter controls collapse to icon-only buttons on mobile and show icon plus caption on desktop, so the filter row stays on one line on small screens.
- Mobile: the popup loads collapsed (title bar only) and the user expands it by tapping the title bar; the header renders as a single line.
- The footer is removed: the stats line moves into the popup title, and the transient load/error status is shown only while it has a message.
- **BREAKING**: the floating legend and the footer are gone.

## Capabilities

### New Capabilities
- map-legend-popup: a collapsible map detail popup that carries the candidate colour legend, a national overview with per-region numbers, and per-record vote breakdowns

### Modified Capabilities

## Impact

- app.js
- index.html
- style.css
