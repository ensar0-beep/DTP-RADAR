# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Dış Ticaret Radar" (DTP Radar) — a single-file Turkish-language web app for bank branch staff to find
export/import target companies. It's one large HTML file, no build step, no package.json, no server code.
Users upload monthly DİİB (Dahilde İşleme İzin Belgesi) Excel exports; the app parses, aggregates, and
lets branch employees filter/sort companies by location, import/export volume, and premium-list membership
(TİM İlk 1000 İhracatçı, Turquality).

## Repository state (important, non-obvious)

- The working file is versioned by hand as `index_NN.html` (e.g. `index_39.html`), incrementing NN on each
  save. Only one `index_NN.html` should exist in the tree at a time — when starting work, check `git status`
  and `ls` for the current highest-numbered file; don't assume a filename from a previous session.
- There is no `index.html` — the numbered file is deployed directly (check how/where it's hosted before
  assuming a deploy path).
- Git history is currently a single squashed commit; don't rely on file history for context.

## Running / testing

No build tooling exists. Open the HTML file directly in a browser (or serve the directory with any static
file server) to test. There are no automated tests, linter, or package manager — verify changes manually in
a browser, including both the branch-login flow and the admin-login flow (see Architecture below), and both
light/dark themes (`data-theme="light"` toggle in the top-right).

## Architecture

Everything lives in one file: inline `<style>` block, then a single `<script>` block (~1900 lines) containing
all app logic. There is no module system — all functions and the `S` state object are globals in one scope.

**Global state** is the `S` object (defined near the top of the `<script>` block): loaded files/records,
Firebase user/admin flags, geocoding cache, star/important/visit maps keyed by branch username, TİM and
Turquality lookup tables, and admin's manual firm-merge map. There is no framework — UI updates are done by
directly calling `render()`-family functions that regenerate `innerHTML` after state changes; there's no
virtual DOM or reactivity system, so after mutating `S` you must explicitly call the relevant render function.

**Screens** are plain `<div>`s toggled via `hidden`, not routes: `#gateScreen` (login gate), `#appWrap` (main
firm-browsing app), `#visitListScreen` (branch's saved visit list), `#adminFullPanel` (admin dashboard, itself
tab-switched between `#adminOverviewScreen` / `#adminBranchesScreen` / `#adminAudiencesScreen` /
`#adminFirmViewScreen` via `showAdminScreen()`).

**Auth model (Firebase Auth, email/password with synthetic emails)** — there are two disjoint account kinds
distinguished purely by which fake email domain the user's address ends in:
- Branch accounts: `<username>@sube.disticaretradar.local` — username must exist as a key in the hardcoded
  `SUBE_TABLE` (username → [display name, lat, lon]) for the branch's identity/location to resolve.
  `SUBE_TABLE` is a large hardcoded map of ~400 bank branch usernames/coordinates.
  Also see `ADMIN_TABLE` — display names for the admin usernames below.
- Admin accounts: `<username>@admin.disticaretradar.local` — username must be listed in `ADMIN_TABLE`.
`S.isAdmin` is set (in `initFirebase()`'s `onAuthStateChanged` handler) only when the email matches the admin
domain *and not* the branch domain — this is the sole authorization check, so any change to login/signup
logic must preserve that mutual exclusivity. `renderGate()` gates the entire app behind `S.user` being non-null.

**Data pipeline**: `handleFiles()` reads uploaded `.xlsx` via SheetJS (`XLSX`), `parseSheet()` locates header
columns by regex (Turkish column names, handles diacritics/synonyms) and extracts firm/address/VKN/import/
export values per row, `monthFromName()` infers the YYYY-MM period from the filename. `aggregate()` sums
records for the selected period into one row per firm (keyed by a normalized-uppercase name), merges in TİM
(`parseTim`/`timInfo`) and Turquality (`parseTq`/`tqInfo`) enrichment. `filtered()` applies search/il/province/
radius/checkbox filters and sorting on top of `aggregate()`'s output; `applyStarPriority()` and
`applyManualMerges()` are separate post-processing layers (admin star pinning, admin manual firm-dedup) that
wrap `filtered()`'s result rather than being folded into it — keep them composable/separate when editing.

**Cloud sync (Firebase Realtime Database)**, wired in `loadCloud()`: each top-level RTDB path
(`months/<YYYY-MM>`, `tim`, `tq`, `starred/<branchUsername>`, `important/<branchUsername>`,
`visits/<branchUsername>`, `manualMerges`, `loginLogs/<branchUsername>`) has a live `.on("value", …)`
listener that mirrors into `S`, and a corresponding writer function (e.g. `deleteMonthFromCloud`,
`toggleStarForTarget`, admin save handlers around line 2780+) that pushes local edits back. Monthly records
are compressed for storage via `packRecords()`/`unpackRecords()` (array-of-arrays instead of objects) —
preserve that shape if you touch the sync path. Firebase config/API key is embedded directly in the file
(`firebaseConfig` near the top of the script) — this is a client app talking to a public Firebase project;
don't "fix" this by moving it server-side without being asked, that's a deliberate part of the deployment model.

**Location/mapping**: Leaflet (`initMap`, `drawMap`) renders firm markers; distance uses a bundled offline
`IL_COORD`/`ILCE_COORD` coordinate table first (`localCoord`, `haversine`) and falls back to Nominatim
(`nominatim`, `geocodeVisible`, `refineMahalle`) for addresses it can't resolve locally, with results cached
in `S.geoCache` and rate-limited through `S.geoQueue`/`S.geoBusy`.

## Conventions when editing

- All user-facing strings, comments, and variable names mixing Turkish business terms are intentional —
  match the existing Turkish naming (`sube` = branch, `firma` = firm, `belge` = document) rather than
  translating to English.
- CSS custom properties (`--bg`, `--panel`, `--text`, etc.) on `:root` and `[data-theme="light"]` drive
  theming; add new colors as variables in both blocks rather than hardcoding hex values in component rules.
- `$(id)` is a shorthand for `document.getElementById(id)` — used throughout instead of `querySelector`.
