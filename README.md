# Midpoint — London Tube Meetup

Mobile-first web app that picks the fairest Tube station for a group to meet, then shows spots right outside the exit.

- **Equal Time / Fastest / Fewest Changes** ranking over a (station, line) graph of 31 central stations.
- **Locate**: browser geolocation → nearest covered station (rejects positions more than 15 km away).
- **Share**: native share sheet on phones, clipboard elsewhere.
- **Venues**: hand-curated spots, plus up to 3 "AI pick" suggestions from Gemini (grounded with Google Search) via `/api/venues`.
- Travellers, mode and stations persist in `localStorage`.

## Stack

Vite + TypeScript + Tailwind (compiled, no CDN). One Vercel function: `api/venues.ts`.

```
npm install
npm run dev        # app at http://localhost:5173 (AI venues need `vercel dev`)
npm test           # routing, geolocation, sanitising, API handler
npm run build
```

## Gemini

`GEMINI_API_KEY` is read **server-side only** by `api/venues.ts`; it never reaches the browser bundle.
The endpoint only accepts known station ids (no free-form prompts) and is CDN-cached per station for 24 h,
so spend is bounded to roughly one call per station per day. Without a key, or on any upstream failure,
the app shows the curated venues only. `GEMINI_MODEL` optionally overrides the default `gemini-2.5-flash`.

## Deploy (Vercel)

1. Import this repo as a Vercel project (framework preset: Vite; `vercel.json` is included).
2. Add `GEMINI_API_KEY` to the project's Environment Variables (Production + Preview).
   A GitHub *variable* is not visible to Vercel builds — it must be set in Vercel.
3. Add the domain `tube.krishraja.com` and point a `CNAME tube → cname.vercel-dns.com` record at it.
