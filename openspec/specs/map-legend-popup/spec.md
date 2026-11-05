# Map Legend Popup Specification

## Purpose

Lets users read the candidate colour legend with national totals, and a single record's vote breakdown, in one collapsible popup instead of a floating legend plus a separate detail panel and footer.

## Requirements

### Requirement: Map detail popup SHALL carry the candidate legend
The popup SHALL show the candidate colour key itself; no floating legend panel SHALL exist.

#### Scenario: Legend swatches in the popup
- **WHEN** the popup body is shown (overview or a selected record)
- **THEN** every listed candidate row shows a colour swatch matching that candidate's map colour, next to the candidate name

#### Scenario: Floating legend removed
- **WHEN** the map view is rendered
- **THEN** no separate legend element is displayed anywhere outside the popup

### Requirement: Popup title bar SHALL toggle the popup body
The popup SHALL have a title bar that is always visible and a body that expands and collapses when the title bar is clicked; the title bar SHALL NOT offer a close button and SHALL indicate the state with an up/down chevron.

#### Scenario: Collapse an expanded popup
- **WHEN** the popup is expanded and the user clicks the title bar
- **THEN** the body collapses so only the title bar remains visible, and the chevron points down

#### Scenario: Expand a collapsed popup
- **WHEN** the popup is collapsed and the user clicks the title bar
- **THEN** the body expands, the chevron points up, and the map resizes so the whole country stays visible

#### Scenario: Title bar reflects state
- **WHEN** the popup changes between expanded and collapsed
- **THEN** the title bar conveys the state to assistive technology (e.g. `aria-expanded`)

### Requirement: Popup title SHALL show the summary counts
The popup title bar SHALL display `<sections> секции · <valid> действителни гласа` for the content shown below it — national totals in the overview, the record's own totals when a region, settlement, or section is selected.

#### Scenario: Overview title
- **WHEN** the popup shows the national overview
- **THEN** the title reads the national counted sections and total valid votes (e.g. `12 364 секции · 1 439 313 действителни гласа`)

#### Scenario: Record title
- **WHEN** the user opens a region, settlement, or section
- **THEN** the title includes that record's name and its own section and valid-vote counts

### Requirement: Desktop SHALL show the national overview on initial load
On viewports wider than the mobile breakpoint, the popup SHALL be expanded on initial load showing the national overview, and the map SHALL be initially fitted so the whole country is visible next to the expanded popup.

#### Scenario: Initial desktop load
- **WHEN** the page loads on a desktop-width viewport
- **THEN** the popup is expanded with the overview and the full map extent (all regions, including `32. Извън страната` on the map where geometry exists) is visible

#### Scenario: Whole country stays visible after toggling
- **WHEN** the popup is expanded or collapsed on desktop
- **THEN** the map resizes and re-fits so the full country remains visible

### Requirement: National overview SHALL list candidate totals for the whole country
The overview body SHALL list every candidate with a colour swatch, the candidate name, the candidate's national valid vote total and its share of the national valid vote, plus a proportional horizontal bar, using the same row layout as a record's candidate rows. The overview SHALL NOT list regions, sections per region, or winners.

#### Scenario: Overview contents
- **WHEN** the popup shows the national overview
- **THEN** every candidate appears once, with a colour swatch, a name, the national valid vote total together with its share of the national valid vote, and a horizontal bar whose length is proportional to the votes, sorted by votes

#### Scenario: Bars are shared with the record view
- **WHEN** the user compares the overview with a region, settlement, or section record
- **THEN** both use the same row layout (name, amount, bar), with the overview bars scaled to the national maximum and the record bars to that record's maximum

#### Scenario: Overview totals match the country
- **WHEN** the overview is shown
- **THEN** the candidate totals are the sums over all regions and match the national valid vote total in the title

### Requirement: Popup SHALL return to the national overview
The popup SHALL offer a way back to the national overview from a selected record: a left-arrow control in the title bar while a record is shown, and a click on empty map area. Clicks on a region, settlement, or section SHALL NOT be treated as empty-map clicks.

#### Scenario: Arrow returns to the overview
- **WHEN** a region, settlement, or section is open and the user clicks the left-arrow control
- **THEN** the popup body shows the national overview again and the record summary in the title is replaced by the national one

#### Scenario: Empty map returns to the overview
- **WHEN** the popup shows a record and the user clicks the map where there is no region, settlement, or marker
- **THEN** the popup body shows the national overview

#### Scenario: Record clicks do not fall through
- **WHEN** the user clicks a coloured region, settlement polygon, or marker
- **THEN** that record is shown and the popup does not additionally reset to the overview

### Requirement: Mobile SHALL start collapsed and expand on tap
On viewports at or below the mobile breakpoint, the popup SHALL load collapsed and the title bar SHALL be the control that opens it; the header SHALL render as a single line.

#### Scenario: Initial mobile load
- **WHEN** the page loads on a mobile-width viewport
- **THEN** only the popup title bar is visible, the map occupies the remaining height, and the header occupies one line

#### Scenario: Mobile expand
- **WHEN** the user taps the popup title bar on mobile
- **THEN** the body expands over a bounded height, scrolls internally, and the tap on the title bar collapses it again

### Requirement: Filter controls SHALL adapt to the viewport
Filter and mode controls SHALL show an icon plus a caption on desktop and an icon only on mobile, keeping an accessible name in both cases, so the filter row stays a single line on small screens.

#### Scenario: Desktop filter labels
- **WHEN** the page renders on a desktop-width viewport
- **THEN** each map/table, unit, and map-mode control shows both its icon and its caption

#### Scenario: Mobile filter icons
- **WHEN** the page renders on a mobile-width viewport
- **THEN** those controls show only their icons, keep an accessible name (label or title), expose their pressed state, and the filter row remains one line

### Requirement: Footer SHALL be removed and stats SHALL live in the popup title
The persistent footer SHALL be removed; the summary numbers SHALL appear in the popup title, and the transient load/error status SHALL be visible only while it carries a message.

#### Scenario: No footer
- **WHEN** the page renders in any state
- **THEN** no footer bar with stats is displayed

#### Scenario: Load error still surfaces
- **WHEN** data loading fails
- **THEN** the error message is shown to the user without a persistent footer, and disappears once loading succeeds