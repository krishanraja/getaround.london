import { SITE } from '../src/links.js';
import { summarisePlan, verifiedVenue } from '../src/share.js';

// GET /p?from=..&to=..[&and][&meet][&mode][&at]  (rewritten here by vercel.json)
// A tiny page whose preview card (WhatsApp, iMessage, Slack, X) shows this exact plan, then opens
// it in the app. People are sent straight on; link-preview bots read the tags.

function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const plan = summarisePlan(url.search);
    if (!plan) return Response.redirect(`${url.origin}/`, 302);
    const venue = await verifiedVenue(url.origin, plan.stationId, url.searchParams.get('at'));
    const app = plan.appPath + (venue ? `&at=${encodeURIComponent(venue)}` : '');
    const image = `${SITE}/api/og${app.slice(1)}`;
    const title = venue ? `Meet at ${plan.stationName}, then ${venue}` : `Meet at ${plan.stationName}`;
    const description = `${plan.people.map((p) => `${p.name} ${p.minutes} min`).join(' · ')}. The fairest Tube station to meet, by getaround.london.`;
    const html = `<!DOCTYPE html>
<html lang="en-GB"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | getaround.london</title>
<meta name="robots" content="noindex">
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="getaround.london">
<meta property="og:url" content="${esc(SITE + '/p' + app.slice(1))}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="icon" href="/favicon.ico">
<meta http-equiv="refresh" content="0;url=${esc(app)}">
<script>location.replace(${JSON.stringify(app)})</script>
</head><body style="font:16px system-ui;padding:24px"><a href="${esc(app)}">Open the plan: ${esc(title)}</a></body></html>`;
    return new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300, s-maxage=3600' },
    });
}
