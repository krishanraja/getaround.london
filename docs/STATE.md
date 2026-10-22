# getaround.london — delivery state (canonical)

PRODUCT TRUTH: someone in London finds the fairest Tube station to meet one other person (up to 4 people), and a good
pub, bar or café right by the exit, in about a minute on a phone.
ORIGIN: `london_tube_meetup_app.html` mock supplied by Krish on 2026-10-22; brand icon from Krish's Drive
(`getaroundlondon-icon.png`).
NON-GOALS (v1): live journey times, accounts, stored sessions, bookings, full network coverage (31 stations).

## Locked product rules (Krish, 2026-10-22)
- One-off sessions: you + one person, nothing persisted. "Start again" resets. Max 4 people.
- One ask per screen: "Where are you?" (step 1), "Where are they?" (step 2), then the result.
- "Anywhere on a line" is chosen by tapping a line, then the "Anywhere on the X line" card. Rows explain it
  ("Head to X on the Northern line, then the Elizabeth line").
- Nothing ever scrolls, and no text is ever truncated. Screens compact in steps; extra venues sit behind "N more
  places"; pickers trim behind "+N more". Phones held sideways get a "Turn your phone upright" card.
- Brand: getaround.london wordmark (Outfit 700, ink + roundel red #EB1B22) beside Krish's roundel icon. Second person
  stays "Friend".
- Subtle footer links on the first screens: How it works · Meeting points · Privacy · Terms.

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
- 30/30 unit tests (routing, line origins, Places request/ranking/fallback, open-now on cached data, TfL mapping, links).
- No-scroll + no-truncation audit: 5 phone sizes (320x568 → 412x915), Android desktop-site, desktop, keyboard-open
  (390x420) × all states (step 1/line/search, step 2, result 2 and 4 people with disruptions, venues sheet, add, edit,
  restart): 0 failures. Landscape phone shows the rotate card with no document scroll.
- Copy: no em dashes or banned words in app or 500 generated pages.

## Domains
- getaround.london primary (Vercel DNS; Namecheap NS → Vercel), www.getaround.london 308 → apex.
- The domain needed `zone: true` in Vercel (set via API 2026-10-22); until then Vercel's nameservers refused queries.
- tube.krishraja.com 308 → getaround.london.

## Live checks (production, 2026-10-22)
- /api/venues with GOOGLE_MAPS_API_KEY: real Places results (e.g. Oxford Circus drinks: Simmons Bar, The Little
  Violet Door, The Windmill Mayfair; Green Park coffee: Queens of Mayfair, Blank Street) in under 1 s.
- First production deploy crashed /api/venues (extensionless ESM import); fixed in b13a252 with a regression test.
- /api/status live from TfL (Piccadilly part suspended, Bakerloo minor delays at check time).

## Open
- TfL roundel: the icon is roundel-inspired; TfL protects the roundel as a trademark. Krish's call whether to get advice.
- Operator named on /privacy as "an independent project by Krish Raja"; confirm or replace with the legal entity.
- Not verified on physical iOS/Android devices.
- NEXT ACTION: verify live Places + TfL on getaround.london after deploy; then Krish taps through on his phone.
