# Midpoint — delivery state (canonical)

PRODUCT TRUTH: a group of friends in London finds the fairest Tube station to meet and a spot by the exit.
LOCKED DESIGN: `london_tube_meetup_app.html` mock supplied by Krish on 2026-10-22, implemented 1:1.
NON-GOALS (v1): live TfL timings/disruptions, accounts, shared multi-device sessions, full network coverage.

## Built (branch claude/festive-pasteur-rs1du6)
- Mock ported to Vite + TS + compiled Tailwind; full-height mobile layout with sticky header and safe-area insets.
- Real geolocation, native share, localStorage persistence, HTML escaping of user-entered names.
- `/api/venues` Gemini function (search-grounded, station-id allowlist, sanitised output, CDN cached, graceful fallback).
- CI: `npm test` + `npm run build` on push/PR.

## Deviations from the mock (routine, mobile-first)
- Inputs 16px (was 14–15px) so iOS Safari doesn't zoom on focus; zoom lock removed for accessibility.
- Friend name no longer truncates before the station; hero pill no longer wraps at 320px.
- AI suggestions render as extra venue rows labelled "AI pick".

## Verification (2026-10-22, local preview, headless Chromium)
- 15/15 unit tests pass; production build passes.
- 390×844 and 320×640: no horizontal overflow; header stays fixed while content scrolls.
- GPS at Oxford Circus coords → "Nearest station: Oxford Circus · 40 m"; mode switch, sheet search/filter,
  add friend, reload persistence and clipboard share all pass.
- Script-bearing friend name rendered inert (no injected element, no execution).
- API failure → curated venues only. Live Gemini call: NOT verified (needs the deployed key).

## Known data approximations (inherited from the mock)
- Clapham High St is modelled on the Northern line (in reality Overground only; Clapham North is the Northern stop).
- Ride times are approximate; Bank stands in for the Bank/Monument complex.

## Open
- Decision: should friends be removable (currently toggle-only)?
- NEXT ACTION: Krish connects the Vercel project and sets GEMINI_API_KEY in Vercel env → deploy a preview
  together → verify live AI venues → attach tube.krishraja.com.
