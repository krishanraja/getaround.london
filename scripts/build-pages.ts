// Generates the crawlable side of getaround.london into dist/ after `vite build`:
// station-pair answer pages, station pages, a hub, about/privacy/terms, sitemap.xml and llms.txt.
// Every number comes from the same routing code the app runs, so pages and app agree.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PICKABLE_LINES, STATIONS, TFL_LINES, lineLabel, linesPhrase, type Station } from '../src/data';
import { rankStations, type Mode, type Ranked } from '../src/routing';
import { SITE, pairSlug, planPath, stationSlug } from '../src/links';

const OUT = join(process.cwd(), 'dist');
const UPDATED = process.env.PAGES_UPDATED || '2026-10-22';
const humanDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const UPDATED_HUMAN = humanDate(UPDATED);
// The privacy policy has its own date: it changes when what we keep changes, not when times are recalculated.
const PRIVACY_UPDATED_HUMAN = humanDate('2026-10-28');
const CONTACT = 'hello@krishraja.com';

// Guide pages cover the featured central stations; the planner itself takes any London rail station.
const ids = Object.keys(STATIONS)
    .filter((id) => STATIONS[id].featured)
    .sort((a, b) => STATIONS[a].name.localeCompare(STATIONS[b].name));
const allStations = Object.keys(STATIONS).length;
const urls: string[] = [];

function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function write(path: string, html: string) {
    const file = join(OUT, path === '/' ? 'index.html' : `${path.slice(1)}.html`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
    urls.push(SITE + path);
}

const lineDot = (l: string) => `<span class="dot" style="background:${TFL_LINES[l].color}"></span>`;
const linesOf = (st: Station) => st.lines.map((l) => `<span class="pill">${lineDot(l)}${TFL_LINES[l].name}</span>`).join(' ');
/** A station's guide page when it has one, else just its name. */
const stationLink = (id: string) =>
    STATIONS[id].featured ? `<a href="/stations/${stationSlug(id)}">${esc(STATIONS[id].name)}</a>` : esc(STATIONS[id].name);
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const TIMES_NOTE =
    'TfL timetable run times on the Tube, DLR and trams, distance-based estimates for the Overground, Elizabeth line and National Rail, and 4 minutes for each change. They are estimates, not live times, and leave out walking to the station and waiting for a train.';

interface PageOpts {
    path: string;
    title: string;
    description: string;
    body: string;
    jsonLd?: object[];
    noindex?: boolean;
}

function page({ path, title, description, body, jsonLd = [], noindex }: PageOpts): string {
    const url = SITE + path;
    return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
${noindex ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index, follow, max-image-preview:large">'}
<meta property="og:type" content="article">
<meta property="og:site_name" content="getaround.london">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta property="og:locale" content="en_GB">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}/og-image.png">
<meta name="theme-color" content="#F2F2F7">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/inter-400.woff2" as="font" type="font/woff2" crossorigin>
<style>
@font-face{font-family:Inter;font-weight:400;font-display:swap;src:url(/fonts/inter-400.woff2) format('woff2')}
@font-face{font-family:Inter;font-weight:600;font-display:swap;src:url(/fonts/inter-600.woff2) format('woff2')}
@font-face{font-family:Inter;font-weight:700;font-display:swap;src:url(/fonts/inter-700.woff2) format('woff2')}
@font-face{font-family:Outfit;font-weight:700;font-display:swap;src:url(/fonts/outfit-700.woff2) format('woff2')}
:root{--ink:#1C1C1E;--muted:#6C6C70;--bg:#F2F2F7;--card:#fff;--blue:#007AFF;--red:#EB1B22}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 Inter,-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-wrap:break-word}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:720px;margin:0 auto;padding:0 20px}
header{padding:18px 0 6px}
.brand{display:inline-flex;align-items:center;gap:9px;color:var(--ink);font:700 20px/1 Outfit,Inter,sans-serif;letter-spacing:-.02em}
.brand img{width:30px;height:30px}.brand b{color:var(--red);font-weight:700}
.crumbs{font-size:13px;color:var(--muted);margin:14px 0 0}
h1{font-size:clamp(28px,6vw,40px);line-height:1.12;letter-spacing:-.02em;margin:10px 0 12px}
h2{font-size:20px;line-height:1.25;margin:34px 0 10px}
.lead{font-size:18px;color:#3A3A3C}
.card{background:var(--card);border-radius:20px;padding:18px 20px;box-shadow:0 2px 16px rgba(0,0,0,.04),0 0 1px rgba(0,0,0,.06);margin:14px 0}
.answer{font-size:22px;font-weight:700;letter-spacing:-.01em}
table{width:100%;border-collapse:collapse;font-size:15px}
th,td{text-align:left;padding:9px 8px;border-bottom:1px solid rgba(0,0,0,.06);vertical-align:top}
td:last-child,th:last-child{white-space:nowrap;text-align:right}
th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}
.pill{display:inline-flex;align-items:center;gap:6px;background:var(--bg);border-radius:99px;padding:2px 10px;font-size:13px;margin:2px 4px 2px 0;white-space:nowrap}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block}
.cta{display:inline-block;background:var(--ink);color:#fff;border-radius:16px;padding:13px 20px;font-weight:600;margin:6px 0}
.cta:hover{text-decoration:none;opacity:.9}
ul.plain{list-style:none;padding:0;margin:0}ul.plain li{padding:6px 0;border-bottom:1px solid rgba(0,0,0,.05)}
.cols{columns:2 220px;column-gap:28px}
.muted{color:var(--muted)}.small{font-size:13px}
details{background:var(--card);border-radius:16px;padding:12px 16px;margin:8px 0}summary{font-weight:600;cursor:pointer}
footer{margin:48px 0 36px;padding-top:18px;border-top:1px solid rgba(0,0,0,.08);font-size:13px;color:var(--muted)}
footer nav a{color:var(--muted);margin-right:16px}
</style>
${jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('\n')}
</head>
<body>
<div class="wrap">
<header><a class="brand" href="/" aria-label="getaround.london home"><img src="/mark-96.png" alt="" width="30" height="30"><span>getaround<b>.london</b></span></a></header>
<main>
${body}
</main>
<footer>
<nav><a href="/">Plan a meetup</a><a href="/meet">Meeting points</a><a href="/about">How it works</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
<p>Journey times are estimates, not live. Check <a href="https://tfl.gov.uk/">TfL</a> before you travel. Line status powered by TfL Open Data.</p>
<p class="small">An independent service by Mindmaker LLC. Not affiliated with Transport for London.</p>
</footer>
</div>
</body>
</html>
`;
}

const breadcrumbs = (items: [string, string][]) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + path })),
});

const faq = (qa: [string, string][]) => ({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});

function journeyRows(r: Ranked): string {
    return r.journeys
        .map((j) => {
            const st = STATIONS[j.person.station];
            const how = j.route.minutes === 0 ? 'Already there' : `${linesPhrase(j.route.lines)}${j.route.transfers ? `, ${j.route.transfers} change${j.route.transfers > 1 ? 's' : ''}` : ', direct'}`;
            return `<tr><td>${esc(st.name)}</td><td>${esc(how)}</td><td><strong>${j.route.minutes} min</strong></td></tr>`;
        })
        .join('');
}

function venuesList(st: Station): string {
    return `<ul class="plain">${st.venues
        .map((v) => `<li><strong>${esc(v.name)}</strong> <span class="muted">· ${esc(v.detail)} · ${esc(v.walk.replace('m', ' min'))} walk</span></li>`)
        .join('')}</ul>`;
}

// ---------- pair pages ----------

const pairsFor: Record<string, { slug: string; other: string; meet: string }[]> = Object.fromEntries(ids.map((id) => [id, []]));
const fairestCount: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));

for (let i = 0; i < ids.length; i++) {
    for (let k = i + 1; k < ids.length; k++) {
        const a = ids[i], b = ids[k];
        const A = STATIONS[a], B = STATIONS[b];
        const people = [
            { id: 'a', name: A.name, station: a },
            { id: 'b', name: B.name, station: b },
        ];
        const pick = (mode: Mode) => rankStations(people, mode);
        const fair = pick('fair');
        const best = fair[0];
        const fast = pick('fast')[0];
        const direct = pick('direct')[0];
        const alts = fair.slice(1, 4);
        const slug = pairSlug(a, b);
        const path = `/meet/${slug}`;
        pairsFor[a].push({ slug, other: b, meet: best.stationId });
        pairsFor[b].push({ slug, other: a, meet: best.stationId });
        if (best.stationId in fairestCount) fairestCount[best.stationId]++;

        const [ta, tb] = best.journeys.map((j) => j.route.minutes);
        const answer = `${best.station.name} is the fairest Tube station to meet between ${A.name} and ${B.name}: about ${ta} minutes from ${A.name} and ${tb} minutes from ${B.name}.`;
        const plan = planPath([a, b]);
        const others: string[] = [];
        if (fast.stationId !== best.stationId) others.push(`For the shortest total journey, meet at ${stationLink(fast.stationId)} (${fast.journeys.map((j) => j.route.minutes).join(' and ')} min).`);
        if (direct.stationId !== best.stationId && direct.stationId !== fast.stationId) others.push(`For the fewest changes, meet at ${stationLink(direct.stationId)}.`);

        const body = `
<p class="crumbs"><a href="/meet">Meeting points</a> › ${esc(A.name)} and ${esc(B.name)}</p>
<h1>Halfway between ${esc(A.name)} and ${esc(B.name)} by Tube</h1>
<p class="lead">${esc(answer)}</p>
<div class="card">
  <div class="muted small">Fairest place to meet</div>
  <div class="answer">${stationLink(best.stationId)}</div>
  <div>${linesOf(best.station)}</div>
  <table style="margin-top:12px"><thead><tr><th>From</th><th>Route</th><th>Time</th></tr></thead><tbody>${journeyRows(best)}</tbody></table>
  <p style="margin:14px 0 0"><a class="cta" href="${plan}">Open the live plan</a></p>
</div>
${others.length ? `<p>${others.join(' ')}</p>` : ''}
<h2>Places right by the exit at ${esc(best.station.name)}</h2>
${venuesList(best.station)}
<p class="small muted">Open the plan for live opening hours and ratings near the station.</p>
<h2>Other fair options</h2>
<ul class="plain">${alts.map((r) => `<li>${stationLink(r.stationId)} <span class="muted">· ${r.journeys.map((j) => `${j.route.minutes} min`).join(' and ')}</span></li>`).join('')}</ul>
<h2>Questions</h2>
<details><summary>Where should we meet if one of us is in ${esc(A.name)} and the other in ${esc(B.name)}?</summary><p>${esc(answer)} It balances the two journeys so neither of you travels much longer than the other.</p></details>
<details><summary>Can we start from a whole line instead of a station?</summary><p>Yes. In the planner, pick a line and choose "Anywhere on the line". getaround.london then picks the stop on that line that gives the fairest meeting point.</p></details>
<details><summary>How do you work out the times?</summary><p>${TIMES_NOTE}</p></details>
<p class="small muted">Times last calculated ${UPDATED_HUMAN}.</p>`;

        write(
            path,
            page({
                path,
                title: `Halfway between ${A.name} and ${B.name}: meet at ${best.station.name} | getaround.london`,
                description: `${answer} See routes, other fair options and pubs, bars and cafés by the exit.`,
                body,
                jsonLd: [
                    breadcrumbs([['getaround.london', '/'], ['Meeting points', '/meet'], [`${A.name} and ${B.name}`, path]]),
                    faq([
                        [`Where should we meet between ${A.name} and ${B.name}?`, answer],
                        ['How are the journey times worked out?', TIMES_NOTE],
                    ]),
                ],
            }),
        );
    }
}

// ---------- station pages ----------

for (const id of ids) {
    const st = STATIONS[id];
    const path = `/stations/${stationSlug(id)}`;
    const fairHere = ids
        .flatMap((a) => pairsFor[a].filter((p) => p.meet === id && a < p.other).map((p) => ({ ...p, a })))
        .slice(0, 24);
    const body = `
<p class="crumbs"><a href="/meet">Meeting points</a> › ${esc(st.name)}</p>
<h1>Meeting at ${esc(st.name)}</h1>
<p class="lead">${esc(st.name)} is served by the ${esc(andList(st.lines.map(lineLabel)))}. It is the fairest meeting point for ${fairestCount[id]} of the ${(ids.length * (ids.length - 1)) / 2} station pairs on these pages.</p>
<div>${linesOf(st)}</div>
<h2>Places right by the exit</h2>
${venuesList(st)}
<p><a class="cta" href="/">Plan a meetup</a></p>
${fairHere.length ? `<h2>Fair meeting point for</h2><ul class="plain cols">${fairHere.map((p) => `<li><a href="/meet/${p.slug}">${esc(STATIONS[p.a].name)} and ${esc(STATIONS[p.other].name)}</a></li>`).join('')}</ul>` : ''}
<h2>Meeting someone from ${esc(st.name)}</h2>
<ul class="plain cols">${pairsFor[id].map((p) => `<li><a href="/meet/${p.slug}">${esc(st.name)} and ${esc(STATIONS[p.other].name)}</a> <span class="muted small">· meet at ${esc(STATIONS[p.meet].name)}</span></li>`).join('')}</ul>`;
    write(
        path,
        page({
            path,
            title: `Meeting at ${st.name}: lines and places by the exit | getaround.london`,
            description: `${st.name} station: lines, good places to meet right by the exit, and the journeys it is the fairest meeting point for.`,
            body,
            jsonLd: [
                breadcrumbs([['getaround.london', '/'], ['Meeting points', '/meet'], [st.name, path]]),
                {
                    '@context': 'https://schema.org',
                    '@type': 'SubwayStation',
                    name: `${st.name} station`,
                    geo: { '@type': 'GeoCoordinates', latitude: st.lat, longitude: st.lng },
                    containedInPlace: { '@type': 'City', name: 'London' },
                },
            ],
        }),
    );
}

// ---------- hub ----------

write(
    '/meet',
    page({
        path: '/meet',
        title: 'Fair places to meet in London by Tube | getaround.london',
        description: `The fairest Tube station to meet between any two of ${ids.length} central and inner London stations, with journey times and places by the exit.`,
        body: `
<h1>Fair places to meet in London</h1>
<p class="lead">Pick the two stations you and a friend are coming from. Each page shows the fairest station to meet in the middle, how long each journey takes, and good places right by the exit.</p>
<p><a class="cta" href="/">Use the planner</a> <span class="muted small">for lines, up to 4 people and live pubs and bars.</span></p>
${ids
    .map(
        (a) => `<h2 id="${stationSlug(a)}"><a href="/stations/${stationSlug(a)}">${esc(STATIONS[a].name)}</a></h2>
<ul class="plain cols">${pairsFor[a]
            .slice()
            .sort((x, y) => STATIONS[x.other].name.localeCompare(STATIONS[y.other].name))
            .map((p) => `<li><a href="/meet/${p.slug}">and ${esc(STATIONS[p.other].name)}</a> <span class="muted small">· ${esc(STATIONS[p.meet].name)}</span></li>`)
            .join('')}</ul>`,
    )
    .join('\n')}`,
        jsonLd: [breadcrumbs([['getaround.london', '/'], ['Meeting points', '/meet']])],
    }),
);

// ---------- about ----------

const aboutQa: [string, string][] = [
    ['What is getaround.london?', 'A free planner that finds the fairest station for two to four people to meet in London, starting from any Tube, Overground, DLR, Elizabeth line, tram or National Rail station, then shows pubs, bars and cafés right by the exit.'],
    ['What does "fairest" mean?', 'By default it balances everyone\'s journey so nobody travels much longer than anyone else. You can switch to the fastest total journey or the fewest changes.'],
    ['What does "anywhere on a line" mean?', 'If someone can easily get to any stop on, say, the Victoria line, choose that line instead of one station. The planner then picks the stop on that line that makes the meetup fairest and tells them where to go.'],
    ['Are the times live?', `No. ${TIMES_NOTE} Live line status from TfL warns you about delays on the lines your route uses.`],
    ['Where do the places come from?', 'Live opening hours and ratings come from Google Maps. Where live data is not available we show our own picks and AI suggestions, labelled as such.'],
    ['Which exit should we use?', 'When you pick a place, the planner suggests the station exit nearest to it, using TfL\'s entrance locations, and times the walk from there.'],
    ['What if a line is suspended?', 'The planner reads live TfL line status and routes around suspended or closed lines, and tells you when it has done so.'],
    ['Which stations do you cover?', `Every Tube, Overground, DLR, Elizabeth line, tram and National Rail station in London's fare zones: ${allStations} stations, from Pinner and Hatch End to Surbiton and Stratford. Meeting points are central stations and interchanges further out. Guide pages cover ${ids.length} central stations.`],
];

write(
    '/about',
    page({
        path: '/about',
        title: 'How getaround.london works',
        description: 'How getaround.london picks the fairest Tube station to meet, what "anywhere on a line" means, and where the data comes from.',
        body: `
<h1>How it works</h1>
<p class="lead">Tell it where you are and where they are. It finds the station where your journeys are most even, then shows good places right by the exit.</p>
<div class="card">
<ol style="margin:0;padding-left:20px">
<li><strong>Where are you?</strong> Use your location, search for a station, or pick a whole line if any stop on it works for you.</li>
<li><strong>Where are they?</strong> Same again for the person you are meeting. Add up to two more people afterwards.</li>
<li><strong>Meet.</strong> You get the fairest station, each person's route and time, and pubs, bars and cafés by the exit. Share the plan as a link.</li>
</ol>
</div>
<h2>Questions</h2>
${aboutQa.map(([q, a]) => `<details open><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
<h2>Data</h2>
<p>Line status: TfL Open Data. Places: Google Maps Platform, plus our own picks and suggestions from Google Gemini. Routes: our own model of the network, using TfL's station and entrance locations.</p>
<p class="small muted">getaround.london is an independent service by Mindmaker LLC.</p>
<p>Questions or corrections: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`,
        jsonLd: [faq(aboutQa), breadcrumbs([['getaround.london', '/'], ['How it works', '/about']])],
    }),
);

// ---------- privacy ----------

write(
    '/privacy',
    page({
        path: '/privacy',
        title: 'Privacy | getaround.london',
        description: 'What getaround.london does and does not collect. No accounts, no cookies, no tracking.',
        body: `
<h1>Privacy</h1>
<p class="muted small">Last updated ${PRIVACY_UPDATED_HUMAN}</p>
<p class="lead">Short version: no accounts, no cookies, no tracking, no ads. We don't store your plans, and your location never leaves your phone.</p>
<h2>Your location</h2>
<p>If you tap "Use my location", your browser asks your permission and then shares your approximate position with the page. The page works out your nearest station on your own device. We never send your coordinates to our server or to anyone else.</p>
<h2>What we send to work out a plan</h2>
<p>When you see a result, your browser asks our server for places near the meeting station and for live line status. Those requests contain the station, not you. Our server then asks Google (Google Maps Platform and Google Gemini) about places near that station, and Transport for London about line status. Google and TfL see our server, not your device.</p>
<h2>What we keep</h2>
<p>Nothing about your plans, and no cookies. The app keeps a visit count and two small flags on your device, so it knows when to show a one-off note about donating and never to show it again. They never leave your device. Our hosting provider, Vercel, keeps standard request logs (such as IP address, browser type and time) for a short period to run and protect the service. Short-lived caches of place and line data hold no personal information.</p>
<h2>Feedback</h2>
<p>If you send a suggestion from the button in the corner, we keep your message, your email address if you give one, which screen you were on and your screen size, so we can read it and reply. Supabase, our database provider, stores it. Ask us and we will delete it.</p>
<h2>Donations</h2>
<p>If you choose to donate, you pay on Stripe's page and Stripe's privacy policy applies. We never see your card details.</p>
<h2>Sharing and links</h2>
<p>When you share a plan, the text goes wherever you send it. The link contains the stations or lines you picked, so anyone with the link can see them. If you open a place in Google Maps, Google's privacy policy applies to that visit.</p>
<h2>Your rights</h2>
<p>Under UK data protection law you can ask what personal data we hold about you and ask us to delete it. Because we keep no plans or profiles, there is usually nothing to find, but email us and we will check our hosting logs. You can also complain to the Information Commissioner's Office at <a href="https://ico.org.uk/">ico.org.uk</a>.</p>
<h2>Contact</h2>
<p>getaround.london is run by Mindmaker LLC. Email <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
<h2>Changes</h2>
<p>If this policy changes, we will update this page and the date at the top.</p>`,
    }),
);

// ---------- terms ----------

write(
    '/terms',
    page({
        path: '/terms',
        title: 'Terms | getaround.london',
        description: 'The terms for using getaround.london.',
        body: `
<h1>Terms</h1>
<p class="muted small">Last updated ${UPDATED_HUMAN}</p>
<p class="lead">getaround.london is a free tool from Mindmaker LLC ("we") to help you pick a fair place to meet. By using it you agree to these terms.</p>
<h2>Estimates, not guarantees</h2>
<p>Journey times are estimates based on typical in-train times plus 4 minutes for each change. They leave out walking to the station, waiting for trains, step-free routes, engineering works and closures. Always check <a href="https://tfl.gov.uk/">TfL</a> before you travel. Live line status comes from TfL Open Data and may lag behind what is happening on the network.</p>
<h2>Places</h2>
<p>Place details come from Google Maps, our own picks and AI suggestions. They can be wrong or out of date, and a place may be closed, full or no longer exist. Check before you go. We don't run, endorse or take bookings for any place we list.</p>
<h2>Fair use</h2>
<p>Use getaround.london for planning your own meetups. Don't overload it, scrape its data services, or try to break it.</p>
<h2>Liability</h2>
<p>We provide getaround.london as it is, without warranties. To the extent the law allows, we are not liable for missed trains, wasted journeys, or any loss from relying on it. Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or for anything else the law does not allow us to limit.</p>
<h2>Data</h2>
<p>Line status is powered by TfL Open Data. Place data is provided by Google Maps Platform. getaround.london is independent and not affiliated with Transport for London or Google.</p>
<h2>Law</h2>
<p>The law of England and Wales governs these terms, and the courts of England and Wales have jurisdiction.</p>
<h2>Contact</h2>
<p>Email <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`,
    }),
);

// ---------- sitemap + llms.txt ----------

writeFileSync(
    join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${SITE}/</loc><lastmod>${UPDATED}</lastmod><priority>1.0</priority></url>
${urls.map((u) => `<url><loc>${u}</loc><lastmod>${UPDATED}</lastmod></url>`).join('\n')}
</urlset>
`,
);

const lineSlugs = PICKABLE_LINES.map((id) => `${id}-line (${lineLabel(id)})`).join(', ');
writeFileSync(
    join(OUT, 'llms.txt'),
    `# getaround.london

> A free web app that finds the fairest London station for two to four people to meet, from any Tube, Overground, DLR, Elizabeth line, tram or National Rail station in London's fare zones, then lists pubs, bars and cafés right by the exit with live opening hours.

Use it when someone asks where to meet a friend in London, the halfway point between two London stations, or a pub near the middle of two places.

## Plan links (works for people and agents)

- Format: ${SITE}/?from=<origin>&to=<origin>[&and=<origin>,<origin>]
- An origin is any London station slug (for example surbiton, hatch-end, pinner, waterloo, kings-cross) or a whole line when any stop works (for example victoria-line, lioness-line).
- Line slugs: ${lineSlugs}.
- Example: ${SITE}/?from=brixton&to=camden-town opens the fairest station, each route, and places by the exit.

## Answer pages

- [All meeting points](${SITE}/meet): the fairest station between every pair of the ${ids.length} stations covered.
- Pair page format: ${SITE}/meet/<station-a>-and-<station-b> (slugs in alphabetical order), for example ${SITE}/meet/${pairSlug('brixton', 'camden_town')}.
- Station page format: ${SITE}/stations/<station>, for example ${SITE}/stations/oxford-circus.
- [How it works](${SITE}/about)

## Station slugs (every origin)

${Object.keys(STATIONS)
    .sort((a, b) => STATIONS[a].name.localeCompare(STATIONS[b].name))
    .map((id) => `- ${STATIONS[id].name}: ${stationSlug(id)}`)
    .join('\n')}

## Notes

- Times: ${TIMES_NOTE}
- Live line status from TfL Open Data. Places from Google Maps Platform.
- Run by Mindmaker LLC, independently of TfL.
- [Privacy](${SITE}/privacy) · [Terms](${SITE}/terms) · Contact: ${CONTACT}
`,
);

console.log(`pages: ${urls.length} (+ sitemap.xml, llms.txt)`);
