# getaround.london — delivery state (canonical)

PRODUCT TRUTH: someone in London finds the fairest station to meet one other person (up to 4 people), starting from
any London rail station, and a good pub, bar or café right by the exit, in about a minute on a phone.
ORIGIN: `london_tube_meetup_app.html` mock supplied by Krish on 2026-10-22; brand icon from Krish's Drive
(`getaroundlondon-icon.png`).
NON-GOALS: live journey times, accounts, stored sessions, bookings.

## Locked product rules (Krish, 2026-10-22)
- One-off sessions: you + one person, nothing persisted. "Start again" resets. Max 4 people.
- One ask per screen: "Where are you?" (step 1), "Where are they?" (step 2), then the result.
- "Anywhere on a line" is chosen by tapping a line, then the "Anywhere on the X line" card. Rows explain it
  ("Head to X on the Northern line, then the Elizabeth line").
- Component stability is sacrosanct (Krish, 2026-10-22). Every traveller row has one anatomy (avatar | name, origin,
  route | minutes | remove slot) on fixed columns, so minutes and names line up whatever the content. Live data
  arriving (TfL status, places) never moves the frame: places use fixed-size placeholders, the places card always
  fills its region, compaction tiers are judged on fixed sizes and only tighten until the screen size changes or
  someone is added. Shared links wait up to 0.8 s for TfL status so the plan is drawn once. Feedback appears where
  the user acted ("Copied. Now paste it" on the button); toasts sit over the header, never over the plan.
- Nothing ever scrolls, and no text is ever truncated. Screens compact in steps; extra venues sit behind "N more
  places"; pickers trim behind "+N more". Phones held sideways get a "Turn your phone upright" card.
- Brand: getaround.london wordmark (Outfit 700, ink + red #EB1B22) beside the mark. Mark v2 (approved by Krish
  2026-10-23): the two people are the hero (pink #FE598A, yellow #FABD29, map-pin bodies), standing on a tube line
  (#0046A0) with one interchange ring (red) where they meet; no roundel. Drawn in scripts/build-icons.ts, which writes
  every icon size; Drive folder holds getaroundlondon-icon.png (1024) + .svg master, old file renamed "(previous)".
  Second person stays "Friend".
- Subtle footer links on the first screens: How it works · Meeting points · Privacy · Terms, plus
  "Independent. Not affiliated with TfL." Operator: Mindmaker LLC (holding company) on privacy/terms/footers.
- Exits: the chosen venue gets the nearest station exit (TfL entrance positions, named by compass side) and the
  walk is timed from that exit. TfL publishes no signage exit numbers, so we never claim "Exit 3".
- Disruption: routing skips suspended/closed lines (TfL severity 1,2,4,16,20), strongly avoids part-suspended
  (3,5,11) and mildly severe delays (6); the hero says "Avoiding X line (status)". If that strands someone, it softens.
- Share: "Copy for WhatsApp" (bold headings, preview link first, directions last) + native share. Links go to
  /p?… which serves a per-plan preview card (satori + resvg) and opens the plan; the venue on a card must match a
  venue we would list for that station. Cards and /p titles use the same live TfL disruption routing as the app
  (cached 10 min).
- "Open now / Open at HH:00" picker filters venues by Google's weekly hours.
- The copied message is written for the friend (Krish, 2026-10-23): "Shall we meet at X? It's about N min for you and
  M min for me", *Your way* (with where to change) then *Mine*, the pub and walk, heads-up on delays, and one link
  at the end (WhatsApp turns it into the plan card). No Google Maps URL; the plan page has the Maps button. Built
  by src/message.ts (tested). The preview card names stations, not You/Friend, since both people read it.
- Location button: fixed two-line anatomy (title + detail, 60px in every state). With location already allowed it
  reads "<Station>" / "Nearest station · 100 m away"; long names step down to 14px instead of wrapping.
- Rotate card: never while a text field is focused, and only when device and visible area are both landscape.
  Focus changes only toggle the card (re-rendering on focus swallowed taps on chips; caught by the audit).
- Step 1 and step 2 must never look alike (Krish, 2026-10-23: "I barely notice it's a changed screen and think it's
  just crashed"; mock approved "Looks good"). A You -> Them stepper with the two people from the mark, a pink or
  yellow person tile beside the question, and on step 2 a "You: <station> · tap to change" card in the slot where
  "Use my location" sits on step 1. The header keeps one height whether or not "Start again" shows.
- Every screen change slides like a native app (Krish, 2026-10-23: "the first screen slide over to the 2nd and so
  on"): the old screen pushes out as the new one comes in, forward to the left (you, them, plan, add/edit), back to
  the right (Back, recap card, Start again, a new person added). View transitions on #screen only, so the header
  and desktop frame stay still; older browsers get the new screen sliding in alone; reduced motion gets no slide.
- Loading never looks glitchy (Krish, 2026-10-23). The app is veiled (html.boot, set inline) until its first screen
  is drawn with its real fonts (or 0.7 s), then fades in once: no half-built step, no shared link flashing step 1,
  no font swap. The first-screen fonts are preloaded (vite.config.ts). On a slow load the mark breathes in the
  middle after 0.6 s. If the script fails, the static screen shows after 4 s. Places still loading shimmer; when
  they arrive, the venue line, the "Open now" row and the places fade in where the placeholders were. /p opens on
  the app's background, not a white page. Without JavaScript nothing is veiled.
- Header corner (Krish, 2026-10-28: "think holistically about the design system... I do not want things feeling
  jittery"). The header's right side is one right-anchored cluster: [install] [Start again] [feedback]. Feedback holds
  the corner and never moves; Start again comes and goes only with a screen change; install (Chrome and Edge offer it
  late) sits furthest left so it arriving or leaving moves nothing. Every control is 32px on the same white surface. On
  narrow phones (360px and below with install possible) Start again keeps only its icon; the check always counts the
  install slot where install could be offered, so it never flips when the offer arrives.
- Feedback: the speech-bubble button opens a panel that grows from the corner and sits just under the header, clear
  of the keyboard. While it is open the app holds its height (viewport.ts holdHeight), so the keyboard slides over
  the plan instead of squashing it, and nothing re-fits until it closes. The Send button carries every state
  ("Sending…", "Write a note first", "Couldn't send. Try again"); the thank-you covers the form at the same size and
  the panel closes itself. Notes go to Supabase (Mindmaker OS, public.product_feedback) through
  submit_product_feedback, called server-side with the publishable key; no service-role key anywhere.
- Donation note (Krish, 2026-10-28: "Free forever. A one-off donation would be very kind"): from the second visit
  (a visit is a tab session; reloads do not count), once ever, 1.2 s after the first screen settles. It overlays the
  header like a phone notification and never takes space. It goes on ✕, on Donate, when a toast needs the slot, when
  a sheet or the feedback panel opens, or on any screen change. Stripe Payment Link with a donor-chosen amount
  (src/support.ts DONATE_URL; empty hides the note). Storage blocked means it never shows.
- Install: Chrome's beforeinstallprompt is caught inline in index.html (before the app script) and held; the header
  button calls prompt() and then goes, whatever the choice. Glyph: phone on touch screens, monitor on computers.
- Place tabs stay Drinks · Coffee (Krish, 2026-10-28, after trying Food: "the main feature was which station to meet
  near so I fear we will over complicate"). The tab opens on the time: coffee 05:00 to 16:59, drinks from 17:00
  (London). A tap sticks for the session; plan links carry &kind= so the friend opens the same list and place.

## Network (Krish, 2026-10-22: "Hatch End or Pinner", "Surbiton and Stratford")
- Origins: every Tube, Overground (6 lines), DLR, Elizabeth line, tram and National Rail stop in a TfL fare zone:
  633 stations merged by TfL interchange hub, 33 lines, 1022 hops, 43 walking links (Bank and Monument etc.).
  Generated by scripts/build-network.ts from TfL's Route Sequence API into src/network.ts (rerun to refresh).
- Run times: TfL timetable intervals for Tube, DLR and tram (averaged across stopping patterns, so fast
  Metropolitan trains are their own hops); distance-based estimates for Overground, Elizabeth line and National Rail
  (TfL publishes no timetable API for those). Router adds 4 min per change; a per-mode boarding wait steers away from
  infrequent services but is not shown in minutes.
- Calibration vs TfL Journey Planner (weekday midday, 18 pairs, in tests): every pair within 25%, median about 4%.
  Surbiton + Stratford meet at Waterloo (22 min SWR, 19 min Jubilee).
- Meeting points: 329 (zone 1-2 stations, outer interchanges with 2+ rail lines, the 31 featured stations).
- The 31 launch stations keep their ids and names (old links, pages, curated picks, TfL exits). Guide pages stay on
  those 31; pair pages name non-featured meeting points without linking. llms.txt lists every station slug.
- Picker: 20 pickable lines (Tube, Elizabeth, Overground, DLR, tram) ordered busiest first, paging with "+N more
  lines"; search also finds lines by name; search draws at most 16 rows (16-40 ms per keystroke).
- Line status now covers Tube, Elizabeth, Overground lines, DLR and tram by their own ids. National Rail status is
  left out (TfL reports it per operator).

## Built (main)
- Vite + TS + Tailwind, self-hosted Inter/Outfit (no Google Fonts call). viewport.ts pins the app to the visual
  viewport and counter-zooms Chrome "Desktop site" mode.
- `/api/venues?station&kind=drinks|coffee`: Google Places (New) Nearby Search when GOOGLE_MAPS_API_KEY is set
  (rating, review count, open now / closes at, good for groups, Maps link; closed places sort last; cached 1h);
  Gemini fallback for drinks; curated picks last. Attribution "Live hours and ratings from Google Maps".
- `/api/status`: TfL Open Data line status; disruptions shown on route rows and line pills (cached 2 min).
- Deep links: `/?from=<slug>&to=<slug>[&and=a,b]`; Share sends text + plan link + chosen venue Maps link.
- SEO/GEO: 465 `/meet/<a>-and-<b>` answer pages, 31 `/stations/<slug>`, `/meet` hub, `/about`, `/privacy`, `/terms`,
  sitemap.xml (500 URLs), llms.txt (incl. deep-link format), robots.txt welcoming AI crawlers, JSON-LD
  (WebApplication, FAQPage, BreadcrumbList, SubwayStation), OG/Twitter image 1200x630.

## Verification (2026-10-22, local build, headless Chromium)
- 44/44 unit tests (routing, line origins, Places request/ranking/fallback, open-now on cached data, TfL mapping, links,
  exits, opening hours incl. BST/GMT, disruption routing, plan previews and venue verification).
- No-scroll + no-truncation audit: 5 phone sizes (320x568 → 412x915), Android desktop-site, desktop, keyboard-open
  (390x420) × all states (step 1/line/search, step 2, result 2 and 4 people with disruptions, venues sheet, add, edit,
  restart): 0 failures. Landscape phone shows the rotate card with no document scroll.
- Rotate card (fixed 2026-10-22 after Krish hit it on Android): shown only when the device reports landscape AND the
  visible area is wider than tall. The keyboard alone (portrait device, area wider than tall) never shows it. Audit
  covers 412x400 and 360x330 keyboard-open portrait phones.
- Copy: no em dashes or banned words in app or 500 generated pages.
- Stability audit (fit3, 2026-10-22, local build): adds aligned minutes/name columns, text cut by any clipping
  container, names split mid-word, toast over the plan, and a late-data run (status at 300 ms, places held back)
  at 360x640, 390x844 and 412x915: 0 failures, nothing moved.

## Verification (2026-10-28, local build, headless Chromium, places and status mocked)
- 62/62 unit tests (new: tab by time, tabs kept through /p, verifiedVenue across both lists, feedback endpoint:
  origin, lengths, email, honeypot, publishable key header, upstream failure).
- Audit at 320x568, 360x640, 390x844, 412x915 and desktop, 132 checks, 0 failures: header fits in step 1, step 2
  and result with install offered (Start again shows its label at 390px and up); install calls prompt() and hides;
  install arriving late moves nothing; donation note absent on visit 1 and on reload, shown on visit 2 with the
  Stripe link, moves nothing appearing or closing, never returns; feedback opens focused, stays on screen, a 40%
  keyboard moves nothing behind it, empty send asks for a note, send thanks at the same panel size, closes itself
  with the plan unmoved; tab default by London time and shared tab kept at 04:30, 09:00, 13:00, 16:59, 17:00, 19:00.
- Found in passing: tailwind.config.js defines the `desk` screen as raw, which turns off Tailwind's min-[…]
  variants, so every `min-[360px]:` class in index.html (wordmark 19px, header px-5, larger mark) has never been in
  the build. New code uses plain media queries in style.css. The old classes are left as they render today.

## Domains
- getaround.london primary (Vercel DNS; Namecheap NS → Vercel), www.getaround.london 308 → apex.
- The domain needed `zone: true` in Vercel (set via API 2026-10-22); until then Vercel's nameservers refused queries.
- tube.krishraja.com 308 → getaround.london.

## Live checks (production, 2026-10-22)
- /api/venues with GOOGLE_MAPS_API_KEY: real Places results (e.g. Oxford Circus drinks: Simmons Bar, The Little
  Violet Door, The Windmill Mayfair; Green Park coffee: Queens of Mayfair, Blank Street) in under 1 s.
- First production deploy crashed /api/venues (extensionless ESM import); fixed in b13a252 with a regression test.
- /api/status live from TfL (Piccadilly part suspended, Bakerloo minor delays at check time).
- Full no-scroll + no-truncation audit against https://getaround.london with real Google and TfL data: 0 failures
  across all phone sizes, desktop-site mode, desktop and keyboard-open. All 500 pages, sitemap, robots, llms.txt and
  OG image return 200; www and tube.krishraja.com 308 to the apex with path preserved; live bundle = tested build.

- Stability fix a674750 live (2026-10-22): live bundle = audited build (index-BkMX_hX2.js); fit3 against
  https://getaround.london with real Google and TfL data (Piccadilly severe delays at the time): 0 failures across
  all sizes and states; late-data run moved nothing at 360x640, 390x844, 412x915.

- London-wide network b99a111 live (2026-10-22): live bundle = audited build; /api/venues for Surbiton and Hatch End
  return Google places with walks timed from the station; /p?from=surbiton&to=stratford previews "Meet at Waterloo"
  (card 200 PNG); llms.txt lists every slug; fit3 against production with real data: 0 failures, late data moved
  nothing.
- Step identity + screen slide ca9caa1 live (2026-10-23, dpl_DUgjU4hb19MBNTpP9jGmNeWk6EDP): live bundle
  index-DgZqvSJR.js / index-oLhoIpLC.css = audited build; on production all seven moves slide the right way (you->them,
  Back, them->plan, plan->add, add->plan, Start again), no console errors, tap then Back lands on step 1; fit3 against
  production: 0 failures. Headless Chromium only; Safari and a physical phone not yet checked.

- Feedback store live (2026-10-28, approved by Krish): migration product_feedback on Mindmaker OS
  (gojpffsrxybbpbdzzrvs). Readback: RLS on, no anon/authenticated table grants, submit_product_feedback is security
  definer with an empty search_path, executable by anon only. Vercel getaround.london has SUPABASE_URL and
  SUPABASE_PUBLISHABLE_KEY (preview + production, encrypted). The RPC call api/feedback.ts makes returned 204 and
  wrote one row ("[test] getaround feedback path check", kept until Krish says to delete it); with the same key, read
  and direct insert on the table return 401 and an empty message returns 400. Advisors: the expected "anon can
  execute a security definer function" warning for submit_product_feedback (it is the one door) and "RLS without
  policy" info. Anyone holding this project's publishable key can call it without the app's origin check or
  honeypot; worst case is junk rows of at most 1000 characters. Not yet proven: the deployed /api/feedback on Vercel
  reading its env vars (the branch preview is behind Vercel login).
- Install: Chrome reports no installability errors on https://getaround.london (manifest only, no service worker).

## Open
- Decided (Krish, 2026-10-22): not affiliated with TfL at all; say so subtly. Operator is Mindmaker LLC.
- Governing law in /terms is England and Wales; Mindmaker LLC may be incorporated elsewhere. Krish to confirm.
- Not verified on physical iOS/Android devices.
- National Rail times are estimates from distance; infrequent services (an hourly Southern) can look better than
  they are. No National Rail disruption data.
- NEXT ACTION: Krish taps through getaround.london on his phone (Hatch End or Pinner, Surbiton, a venue, Copy for
  WhatsApp, paste into a chat and check the preview card).
