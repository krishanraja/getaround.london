# getaround.london

Mobile-first web app that picks the fairest Tube station for two to four people to meet, then shows live pubs, bars and cafés right by the exit. Live at https://getaround.london.

- **One ask per screen**: "Where are you?", "Where are they?", then the result. A start point can be a station or anywhere on a line.
- **Equal time / Fastest / Fewest changes** ranking over a (station, line) graph of 31 central and inner stations.
- **Live venues** by the exit from Google Places, **live line status** from TfL, plan **deep links** and native share.
- One-off sessions: nothing is stored. Nothing scrolls and no text is truncated, on any screen size.

## Stack

Vite + TypeScript + Tailwind (compiled, no CDN). One Vercel function: `api/venues.ts`.

```
npm install
npm run dev        # app at http://localhost:5173 (AI venues need `vercel dev`)
npm test           # routing, geolocation, sanitising, API handler
npm run build
```

## Google Places (live venues)

`GOOGLE_MAPS_API_KEY` (server-side only) enables `/api/venues` live results from Places API (New) Nearby Search:
rating, review count, open now, good for groups, Maps link. Restrict the key to Places API (New) and set a daily
quota. Without it the app falls back to Gemini (below) and the curated picks.

## TfL line status

`/api/status` reads TfL Open Data line status. Optional `TFL_APP_KEY` raises TfL's rate limit.

## Pages for search and AI

`npm run build` runs `scripts/build-pages.ts` after Vite: 465 station-pair answer pages, 31 station pages, `/meet`,
`/about`, `/privacy`, `/terms`, `sitemap.xml` and `llms.txt`, all computed by the same routing code as the app.

## Feedback

The speech-bubble button in the header opens a short form. `api/feedback.ts` saves each note as a row in
`public.product_feedback` (Supabase, Mindmaker OS) by calling the `submit_product_feedback` function with the
**publishable** key: that key can add one checked row and cannot read anything back. Needs `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY`. Without them the form says it could not send.

## Donations and install

From someone's second visit, a one-off note slides over the header with a link to Stripe (`DONATE_URL` in
`src/support.ts`; empty hides it). In Chrome and Edge an install button appears in the header when the browser
offers to install the app.

## Gemini

`GEMINI_API_KEY` is read **server-side only** by `api/venues.ts`; it never reaches the browser bundle.
The endpoint only accepts known station ids (no free-form prompts) and is CDN-cached per station for 24 h,
so spend is bounded to roughly one call per station per day. Without a key, or on any upstream failure,
the app shows the curated venues only. `GEMINI_MODEL` optionally overrides the default `gemini-2.5-flash`.

## Deploy (Vercel)

Production deploys from `main`. Environment variables live in Vercel (a GitHub variable is not visible to Vercel
builds): `GOOGLE_MAPS_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, optional
`TFL_APP_KEY`, `GEMINI_MODEL`. Domain: getaround.london
(Vercel DNS), www redirects to the apex.
