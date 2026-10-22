import { describe, expect, it, vi, afterEach } from 'vitest';
import { LINE_ROUTES, MEETING_POINTS, PICKABLE_LINES, STATIONS, TFL_LINES, lineLabel, linesPhrase } from '../src/data';
import { computeRoute, isValidOrigin, nearestStation, rankStations } from '../src/routing';
import { extractJsonArray, isOpenAt, sanitizeVenues, walkMinutes } from '../src/venues';
import { GET, fetchPlaces, fetchVenues, rankPlaces } from '../api/venues';
import { summarise } from '../api/status';
import { pairSlug, parseOriginSlug, parsePlan, planPath } from '../src/links';
import { nearestExit, streetFrom } from '../src/exits';
import { STATION_GEO } from '../src/station-geo';
import { londonMinuteOfWeek, openAtMinute, weeklyHours } from '../src/venues';
import { avoidFromIssues } from '../src/routing';

const ids = Object.keys(STATIONS);

describe('network data', () => {
    it('only references known stations and lines', () => {
        for (const [line, edges] of Object.entries(LINE_ROUTES)) {
            expect(TFL_LINES[line]).toBeDefined();
            for (const [u, v, mins] of edges) {
                expect(STATIONS[u], u).toBeDefined();
                expect(STATIONS[v], v).toBeDefined();
                expect(STATIONS[u].lines, `${u} on ${line}`).toContain(line);
                expect(STATIONS[v].lines, `${v} on ${line}`).toContain(line);
                expect(mins).toBeGreaterThan(0);
            }
        }
    });

    it('places every station in the London fare-zone area', () => {
        for (const st of Object.values(STATIONS)) {
            expect(st.lat).toBeGreaterThan(51.25);
            expect(st.lat).toBeLessThan(51.75);
            expect(st.lng).toBeGreaterThan(-0.65);
            expect(st.lng).toBeLessThan(0.35);
        }
    });

    it('covers every kind of London rail, including the outer stations people asked for', () => {
        expect(Object.keys(STATIONS).length).toBeGreaterThan(600);
        expect(STATIONS.pinner.lines).toContain('metropolitan');
        expect(STATIONS.hatch_end.lines).toContain('lioness');
        expect(STATIONS.surbiton.lines).toContain('south-western-railway');
        const modes = new Set(Object.values(TFL_LINES).map((l) => l.mode));
        for (const m of ['tube', 'dlr', 'overground', 'elizabeth-line', 'tram', 'national-rail']) expect(modes.has(m as never), m).toBe(true);
        // The stations the app launched with keep their ids, so old links and pages still work.
        for (const id of ['kings_cross', 'victoria_stn', 'tottenham_court_road', 'clapham_high_st', 'shoreditch_high_st']) expect(STATIONS[id]?.featured, id).toBe(true);
        expect(Object.values(STATIONS).filter((s) => s.featured)).toHaveLength(31);
    });

    it('labels lines the way people say them', () => {
        expect(lineLabel('victoria')).toBe('Victoria line');
        expect(lineLabel('lioness')).toBe('Lioness line');
        expect(lineLabel('dlr')).toBe('DLR');
        expect(lineLabel('south-western-railway')).toBe('South Western Railway');
        expect(linesPhrase(['victoria', 'jubilee'])).toBe('Victoria then Jubilee line');
        expect(linesPhrase(['south-western-railway', 'jubilee'])).toBe('South Western Railway, then Jubilee line');
        expect(PICKABLE_LINES).toContain('metropolitan');
        expect(PICKABLE_LINES).not.toContain('southern');
    });
});

describe('computeRoute', () => {
    it('reaches every meeting point from every station', () => {
        for (const a of ids) for (const b of MEETING_POINTS) {
            expect(Number.isFinite(computeRoute(a, b, 'fast').minutes), `${a}->${b}`).toBe(true);
        }
        for (const mode of ['fair', 'direct'] as const) {
            for (const a of ['hatch_end', 'surbiton', 'pinner', 'woolwich_arsenal', 'east_croydon']) for (const b of MEETING_POINTS) {
                expect(Number.isFinite(computeRoute(a, b, mode).minutes), `${a}->${b}`).toBe(true);
            }
        }
    }, 30000);

    it('is zero for same station and symmetric-ish for direct rides', () => {
        expect(computeRoute('bank', 'bank', 'fair')).toMatchObject({ minutes: 0, transfers: 0 });
        expect(computeRoute('brixton', 'oxford_circus', 'fast')).toEqual({ minutes: 11, transfers: 0, lines: ['victoria'] });
    });

    it('counts interchanges', () => {
        const r = computeRoute('brixton', 'canary_wharf', 'fast');
        expect(r.transfers).toBeGreaterThanOrEqual(1);
        expect(r.lines.length).toBe(r.transfers + 1);
    });
});

describe('rankStations', () => {
    it('reproduces the mock default pick', () => {
        const people = [
            { id: 'user', name: 'You', station: 'brixton' },
            { id: 'f1', name: 'Liam', station: 'highbury_islington' },
            { id: 'f2', name: 'Priya', station: 'canary_wharf' },
            { id: 'f3', name: 'Sam', station: 'shepherds_bush' },
        ];
        const ranked = rankStations(people, 'fair');
        expect(ranked).toHaveLength(MEETING_POINTS.length);
        expect(ranked[0].score).toBeLessThanOrEqual(ranked[1].score);
        expect(ranked[0].journeys).toHaveLength(4);
    });

    it('picks the shared station when everyone is already there', () => {
        const people = ['a', 'b'].map((id) => ({ id, name: id, station: 'waterloo' }));
        expect(rankStations(people, 'fast')[0].stationId).toBe('waterloo');
    });
});

describe('nearestStation', () => {
    it('finds the station you are standing at', () => {
        expect(nearestStation(51.5155, -0.1418).station.id).toBe('oxford_circus');
        expect(nearestStation(51.4625, -0.1150).station.id).toBe('brixton');
    });

    it('reports distance so far-away users can be rejected', () => {
        expect(nearestStation(53.4808, -2.2426).metres).toBeGreaterThan(200000); // Manchester
    });
});

describe('venue sanitising', () => {
    it('extracts arrays from fenced model output', () => {
        expect(extractJsonArray('Sure!\n```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
        expect(extractJsonArray('no json here')).toEqual([]);
        expect(extractJsonArray('[broken')).toEqual([]);
    });

    it('drops malformed, duplicate, excluded and markup-bearing entries', () => {
        const out = sanitizeVenues(
            [
                { name: 'The Clachan', detail: 'Pub', walkMinutes: 2 },
                { name: '<img src=x onerror=alert(1)>Spot', detail: 'Bar <b>nice</b>', walkMinutes: 3 },
                { name: 'Far', detail: 'Too far', walkMinutes: 40 },
                { name: 'NoDetail', walkMinutes: 2 },
                'string',
                { name: 'Good Café', detail: 'Big tables for groups', walk: '4m' },
                { name: 'GOOD CAFÉ', detail: 'dupe', walkMinutes: 3 },
            ],
            ['The Clachan'],
        );
        expect(out.map((v) => v.name)).toEqual(['img src=x onerror=alert(1)Spot', 'Good Café']);
        expect(out.every((v) => !/[<>]/.test(v.name + v.detail))).toBe(true);
        expect(out[1]).toEqual({ name: 'Good Café', detail: 'Big tables for groups', walk: '4m', source: 'ai' });
    });
});

describe('/api/venues', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('rejects unknown stations without calling Gemini', async () => {
        const res = await GET(new Request('https://x/api/venues?station=__proto__'));
        expect(res.status).toBe(400);
    });

    it('rejects unknown kinds', async () => {
        const res = await GET(new Request('https://x/api/venues?station=bank&kind=__proto__'));
        expect(res.status).toBe(400);
    });

    it('returns an empty list when no key is configured', async () => {
        vi.stubEnv('GEMINI_API_KEY', '');
        vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
        const res = await GET(new Request('https://x/api/venues?station=bank'));
        expect(await res.json()).toEqual({ source: 'none', venues: [], reason: 'unconfigured' });
    });

    it('sends the key as a header and sanitises the reply', async () => {
        const fake = vi.fn(async (_url: string, init: RequestInit) => {
            expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
            const body = JSON.parse(init.body as string);
            expect(body.contents[0].parts[0].text).toContain('Bank');
            expect(body.tools).toEqual([{ google_search: {} }]);
            return new Response(
                JSON.stringify({
                    candidates: [{ content: { parts: [{ text: '[{"name":"The Ned","detail":"x","walkMinutes":1},{"name":"Sushisamba","detail":"Rooftop dining","walkMinutes":5}]' }] } }],
                }),
            );
        });
        const venues = await fetchVenues('bank', 'k', 'gemini-2.5-flash', fake as unknown as typeof fetch);
        expect(fake.mock.calls[0][0]).not.toContain('k=');
        expect(venues).toEqual([{ name: 'Sushisamba', detail: 'Rooftop dining', walk: '5m', source: 'ai' }]);
    });

    it('degrades to an empty list on upstream failure', async () => {
        vi.stubEnv('GEMINI_API_KEY', 'k');
        vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const res = await GET(new Request('https://x/api/venues?station=bank'));
        expect(await res.json()).toEqual({ source: 'none', venues: [], reason: 'upstream' });
        spy.mockRestore();
    });

    it('falls back from Places to Gemini when Places fails', async () => {
        vi.stubEnv('GEMINI_API_KEY', 'g');
        vi.stubEnv('GOOGLE_MAPS_API_KEY', 'm');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
            String(url).includes('places.googleapis.com')
                ? new Response('quota', { status: 429 })
                : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '[{"name":"Jamaica Wine House","detail":"Historic City pub","walkMinutes":3}]' }] } }] })),
        );
        const body = await (await GET(new Request('https://x/api/venues?station=bank&kind=drinks'))).json();
        expect(body.source).toBe('ai');
        expect(body.venues[0]).toMatchObject({ name: 'Jamaica Wine House', walkMin: 3 });
        spy.mockRestore();
    });
});

describe('Google Places', () => {
    const st = STATIONS.oxford_circus;
    const place = (name: string, extra: Record<string, unknown> = {}) => ({
        displayName: { text: name },
        primaryTypeDisplayName: { text: 'Pub' },
        location: { latitude: st.lat + 0.001, longitude: st.lng },
        googleMapsUri: 'https://maps.google.com/?cid=1',
        businessStatus: 'OPERATIONAL',
        ...extra,
    });

    it('sends key and field mask as headers and searches around the station', async () => {
        const fake = vi.fn(async (_url: string, init: RequestInit) => {
            const h = init.headers as Record<string, string>;
            expect(h['X-Goog-Api-Key']).toBe('m');
            expect(h['X-Goog-FieldMask']).toContain('places.currentOpeningHours.openNow');
            const body = JSON.parse(init.body as string);
            expect(body.locationRestriction.circle.center).toEqual({ latitude: st.lat, longitude: st.lng });
            expect(body.includedPrimaryTypes).toContain('pub');
            return new Response(JSON.stringify({ places: [place('The Argyll Arms', { rating: 4.4, userRatingCount: 3000 })] }));
        });
        const out = await fetchPlaces('oxford_circus', 'drinks', 'm', fake as unknown as typeof fetch);
        expect(fake.mock.calls[0][0]).not.toContain('key=');
        expect(out[0]).toMatchObject({ name: 'The Argyll Arms', type: 'Pub', rating: 4.4, ratings: 3000 });
        expect(out[0].walkMin).toBeGreaterThanOrEqual(1);
        expect(out[0].exit).toMatch(/^(north|north-east|north-west) exit$/);
    });

    it('retries with broader types when Google rejects a type', async () => {
        const fake = vi
            .fn()
            .mockResolvedValueOnce(new Response('bad type', { status: 400 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ places: [place('Bar Two')] })));
        const out = await fetchPlaces('oxford_circus', 'drinks', 'm', fake as unknown as typeof fetch);
        expect(JSON.parse(fake.mock.calls[1][1].body).includedPrimaryTypes).toEqual(['bar']);
        expect(out.map((v) => v.name)).toEqual(['Bar Two']);
    });

    it('ranks open, well-reviewed, group-friendly places first and drops closed businesses', () => {
        const out = rankPlaces(
            [
                place('Closed for good', { businessStatus: 'CLOSED_PERMANENTLY', rating: 5, userRatingCount: 9999 }),
                place('Shut tonight', { rating: 4.8, userRatingCount: 5000, currentOpeningHours: { openNow: false } }),
                place('Solid local', { rating: 4.3, userRatingCount: 800, currentOpeningHours: { openNow: true } }),
                place('Group spot', { rating: 4.3, userRatingCount: 800, goodForGroups: true, currentOpeningHours: { openNow: true } }),
                place('<b>Bad</b> markup', { rating: 4, userRatingCount: 10 }),
            ],
            'oxford_circus',
        );
        expect(out.map((v) => v.name)).toEqual(['Group spot', 'Solid local', 'bBad/b markup', 'Shut tonight']);
        expect(out[0].groups).toBe(true);
    });

    it('never claims a cached place is still open after it closes', () => {
        const now = Date.parse('2026-10-22T23:30:00Z');
        expect(isOpenAt({ name: 'x', type: 'Pub', walkMin: 1, mapsUrl: '', openNow: true, nextClose: '2026-10-22T23:00:00Z' }, now)).toBe(false);
        expect(isOpenAt({ name: 'x', type: 'Pub', walkMin: 1, mapsUrl: '', openNow: false, nextOpen: '2026-10-22T23:00:00Z' }, now)).toBe(true);
        expect(isOpenAt({ name: 'x', type: 'Pub', walkMin: 1, mapsUrl: '' }, now)).toBeUndefined();
    });

    it('estimates walks from straight-line distance', () => {
        expect(walkMinutes(0)).toBe(1);
        expect(walkMinutes(400)).toBe(7);
    });
});

describe('TfL status', () => {
    it('keeps only real problems per line and the worst severity', () => {
        const out = summarise([
            { id: 'victoria', lineStatuses: [{ statusSeverity: 10, statusSeverityDescription: 'Good Service' }] },
            { id: 'piccadilly', lineStatuses: [{ statusSeverity: 6, statusSeverityDescription: 'Severe Delays' }] },
            { id: 'mildmay', lineStatuses: [{ statusSeverity: 9, statusSeverityDescription: 'Minor Delays' }] },
            { id: 'windrush', lineStatuses: [{ statusSeverity: 2, statusSeverityDescription: 'Suspended' }] },
            { id: 'central', lineStatuses: [{ statusSeverity: 13, statusSeverityDescription: 'No Step Free Access' }] },
            { id: 'dlr', lineStatuses: [{ statusSeverity: 9, statusSeverityDescription: 'Minor Delays' }, { statusSeverity: 3, statusSeverityDescription: 'Part Suspended' }] },
        ]);
        expect(out).toEqual({
            piccadilly: { severity: 6, text: 'Severe Delays' },
            mildmay: { severity: 9, text: 'Minor Delays' },
            windrush: { severity: 2, text: 'Suspended' },
            dlr: { severity: 3, text: 'Part Suspended' },
        });
    });
});

describe('links', () => {
    it('round-trips stations and lines through readable slugs', () => {
        expect(parseOriginSlug('kings-cross')).toBe('kings_cross');
        expect(parseOriginSlug('victoria')).toBe('victoria_stn');
        expect(parseOriginSlug('victoria-line')).toBe('line:victoria');
        expect(parseOriginSlug('nope-line')).toBeNull();
        expect(parseOriginSlug('__proto__')).toBeNull();
        const path = planPath(['waterloo', 'line:elizabeth', 'stratford']);
        expect(path).toBe('/?from=waterloo&to=elizabeth-line&and=stratford');
        expect(parsePlan(path.slice(1))).toEqual(['waterloo', 'line:elizabeth', 'stratford']);
        expect(parsePlan('?from=waterloo')).toBeNull();
    });

    it('builds one stable page per station pair', () => {
        expect(pairSlug('camden_town', 'brixton')).toBe('brixton-and-camden-town');
        expect(pairSlug('brixton', 'camden_town')).toBe('brixton-and-camden-town');
        const all = new Set<string>();
        for (const a of ids) for (const b of ids) if (a !== b) all.add(pairSlug(a, b));
        expect(all.size).toBe((ids.length * (ids.length - 1)) / 2);
    });
});

describe('line origins', () => {
    it('validates origins', () => {
        expect(isValidOrigin('line:victoria')).toBe(true);
        expect(isValidOrigin('brixton')).toBe(true);
        expect(isValidOrigin('line:nope')).toBe(false);
        expect(isValidOrigin('line:__proto__')).toBe(false);
    });

    it('costs nothing to meet anywhere on your own line', () => {
        expect(computeRoute('line:victoria', 'green_park', 'fair')).toEqual({ minutes: 0, transfers: 0, lines: ['victoria'], board: 'green_park' });
    });

    it('boards at the best stop on the line', () => {
        // Nearest Victoria stop to Bond Street is Oxford Circus (2m Central) or Green Park (2m Jubilee),
        // which beats anything from a single fixed station like Brixton.
        const fromLine = computeRoute('line:victoria', 'bond_street', 'fast');
        expect(fromLine.minutes).toBe(2 + 4);
        expect(fromLine.minutes).toBeLessThan(computeRoute('brixton', 'bond_street', 'fast').minutes);
        // Joins at Oxford Circus and changes to the Central line for one stop.
        expect(fromLine).toMatchObject({ minutes: 6, transfers: 1, lines: ['central'] });
        expect(['oxford_circus', 'green_park']).toContain(fromLine.board);
        expect(computeRoute('brixton', 'bond_street', 'fast').board).toBeUndefined();
    });

    it('ranks a friend at a station on your line as the meetup', () => {
        const ranked = rankStations(
            [
                { id: 'user', name: 'You', station: 'line:victoria' },
                { id: 'f1', name: 'Friend', station: 'brixton' },
            ],
            'fair',
        );
        expect(ranked[0].stationId).toBe('brixton');
        expect(ranked[0].max).toBe(0);
    });

    it('reaches every meeting point from every pickable line', () => {
        for (const line of PICKABLE_LINES) for (const b of MEETING_POINTS) {
            expect(Number.isFinite(computeRoute(`line:${line}`, b, 'direct').minutes), `${line}->${b}`).toBe(true);
        }
    });
});

describe('serverless bundle', () => {
    // Vercel runs api/*.ts as native Node ESM: every relative runtime import reachable from a function
    // must carry an explicit .js extension, or the function crashes on load (vitest would not notice).
    it('uses explicit .js extensions on runtime imports reachable from api/', async () => {
        const { readFileSync, readdirSync } = await import('node:fs');
        const { dirname, join, resolve } = await import('node:path');
        const root = resolve(__dirname, '..');
        const seen = new Set<string>();
        const bad: string[] = [];
        const visit = (file: string) => {
            if (seen.has(file)) return;
            seen.add(file);
            const src = readFileSync(file, 'utf8');
            for (const m of src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'(\.[^']+)'/gm)) {
                const spec = m[1];
                if (!spec.endsWith('.js')) bad.push(`${file.replace(root, '')} -> ${spec}`);
                else visit(join(dirname(file), spec.replace(/\.js$/, '.ts')));
            }
        };
        for (const f of readdirSync(join(root, 'api'))) if (f.endsWith('.ts')) visit(join(root, 'api', f));
        expect(bad).toEqual([]);
    });
});

describe('station exits', () => {
    it('has TfL entrances for every featured station', () => {
        for (const id of ids.filter((i) => STATIONS[i].featured)) expect(STATION_GEO[id]?.exits.length, id).toBeGreaterThan(0);
    });

    it('stays quiet about exits where we have no entrance data', () => {
        const hint = nearestExit('surbiton', STATIONS.surbiton.lat + 0.003, STATIONS.surbiton.lng);
        expect(hint.label).toBeNull();
        expect(hint.metres).toBeGreaterThan(300); // walked from the station, never 0
        expect(hint.metres).toBeLessThan(360);
    });

    it('names the exit on the side of the station facing the place', () => {
        const oc = STATION_GEO.oxford_circus;
        expect(nearestExit('oxford_circus', oc.lat + 0.003, oc.lng).label).toMatch(/^north/);
        expect(nearestExit('oxford_circus', oc.lat - 0.003, oc.lng).label).toMatch(/^south/);
        expect(nearestExit('oxford_circus', oc.lat, oc.lng + 0.004).label).toMatch(/east exit$/);
    });

    it('stays quiet when a station has one way out', () => {
        expect(nearestExit('shoreditch_high_st', 51.524, -0.07).label).toBeNull();
    });

    it('pulls a street name out of a short address', () => {
        expect(streetFrom('33-35 Wardour St, London')).toBe('Wardour St');
        expect(streetFrom('6 Argyll Street, London')).toBe('Argyll Street');
        expect(streetFrom('Kingly Court, London')).toBe('Kingly Court');
        expect(streetFrom('Unit 4, The Arches, London')).toBeNull();
        expect(streetFrom(undefined)).toBeNull();
    });
});

describe('opening hours', () => {
    const periods = [
        { open: { day: 5, hour: 12, minute: 0 }, close: { day: 6, hour: 1, minute: 0 } }, // Fri 12:00 → Sat 01:00
        { open: { day: 0, hour: 12, minute: 0 }, close: { day: 0, hour: 22, minute: 30 } }, // Sun
    ];
    it('compacts Google periods, including past midnight', () => {
        expect(weeklyHours(periods)).toEqual([[5 * 1440 + 720, 6 * 1440 + 60], [720, 1350]]);
        expect(weeklyHours([{ open: { day: 0, hour: 0, minute: 0 } }])).toEqual([[0, 10080]]);
        expect(weeklyHours(undefined)).toBeNull();
    });
    it('answers "open at" for any London time', () => {
        const v = { name: 'x', type: 'Pub', walkMin: 1, mapsUrl: '', hours: weeklyHours(periods)! };
        expect(openAtMinute(v, 5 * 1440 + 23 * 60)).toBe(true); // Fri 23:00
        expect(openAtMinute(v, 6 * 1440 + 30)).toBe(true); // Sat 00:30, after midnight
        expect(openAtMinute(v, 6 * 1440 + 120)).toBe(false); // Sat 02:00
        expect(openAtMinute(v, 23 * 60)).toBe(false); // Sun 23:00
        expect(openAtMinute({ ...v, hours: undefined }, 0)).toBeUndefined();
    });
    it('reads London time across the clock change', () => {
        expect(londonMinuteOfWeek(new Date('2026-07-03T19:00:00Z'))).toBe(5 * 1440 + 20 * 60); // Fri 20:00 BST
        expect(londonMinuteOfWeek(new Date('2026-12-04T19:00:00Z'))).toBe(5 * 1440 + 19 * 60); // Fri 19:00 GMT
    });
});

describe('disruption-aware routing', () => {
    it('maps TfL severities to avoid costs', () => {
        expect(avoidFromIssues({ victoria: { severity: 2 }, piccadilly: { severity: 3 }, central: { severity: 6 }, jubilee: { severity: 9 } })).toEqual({
            victoria: Infinity,
            piccadilly: 30,
            central: 8,
        });
        expect(avoidFromIssues({ victoria: { severity: 2 } }, true)).toEqual({ victoria: 60 });
    });

    it('routes around a suspended line and reports the real time', () => {
        const normal = computeRoute('brixton', 'oxford_circus', 'fast');
        expect(normal.lines).toEqual(['victoria']);
        const around = computeRoute('brixton', 'oxford_circus', 'fast', { victoria: Infinity });
        expect(around.lines).not.toContain('victoria'); // Brixton's rail station takes over
        expect(around.minutes).toBeGreaterThan(normal.minutes);
        expect(Number.isFinite(computeRoute('line:victoria', 'oxford_circus', 'fast', { victoria: Infinity }).minutes)).toBe(true);
        const fromBank = computeRoute('bank', 'oxford_circus', 'fast', { central: Infinity });
        expect(fromBank.lines).not.toContain('central');
        expect(fromBank.minutes).toBeGreaterThan(computeRoute('bank', 'oxford_circus', 'fast').minutes);
    });

    it('moves the meeting point when a line is suspended', () => {
        const people = [
            { id: 'a', name: 'A', station: 'bank' },
            { id: 'b', name: 'B', station: 'notting_hill_gate' },
        ];
        const usual = rankStations(people, 'fair')[0];
        const avoided = rankStations(people, 'fair', { central: Infinity })[0];
        expect(usual.journeys.some((j) => j.route.lines.includes('central'))).toBe(true);
        expect(avoided.journeys.every((j) => !j.route.lines.includes('central'))).toBe(true);
    });
});

describe('shared plan previews', async () => {
    const { summarisePlan, verifiedVenue } = await import('../src/share');

    it('recomputes the plan from the link, honouring a pinned station and mode', () => {
        const s = summarisePlan('?from=brixton&to=camden-town')!;
        expect(s.stationName).toBe(rankStations([
            { id: 'a', name: 'a', station: 'brixton' },
            { id: 'b', name: 'b', station: 'camden_town' },
        ], 'fair')[0].station.name);
        expect(s.people.map((p) => p.name)).toEqual(['You', 'Friend']);
        const pinned = summarisePlan('?from=brixton&to=camden-town&meet=green-park&mode=fast')!;
        expect(pinned.stationName).toBe('Green Park');
        expect(pinned.appPath).toBe('/?from=brixton&to=camden-town&meet=green-park&mode=fast');
        expect(summarisePlan('?from=brixton')).toBeNull();
        expect(summarisePlan('?from=brixton&to=camden-town&meet=victoria-line')!.stationName).not.toBe('');
    });

    it('matches the app when a line is suspended', async () => {
        const { liveAvoid } = await import('../src/share');
        const status = vi.fn(async () => new Response(JSON.stringify({ lines: { central: { severity: 2 } } })));
        const avoid = await liveAvoid('https://x', status as unknown as typeof fetch);
        expect(avoid).toEqual({ central: Infinity });
        const usual = summarisePlan('?from=bank&to=notting-hill-gate')!;
        const around = summarisePlan('?from=bank&to=notting-hill-gate', avoid)!;
        expect(usual.lines.map((l) => l.name)).toContain('Central');
        expect(around.lines.map((l) => l.name)).not.toContain('Central');
        expect(around.stationName).not.toBe(usual.stationName);
        const down = vi.fn(async () => { throw new Error('offline'); });
        expect(await liveAvoid('https://x', down as unknown as typeof fetch)).toEqual({});
    });

    it('only shows a venue name we would list ourselves', async () => {
        const fake = vi.fn(async (url: string) =>
            new Response(JSON.stringify({ venues: url.includes('kind=drinks') ? [{ name: 'The Clarence' }] : [] })),
        );
        const f = fake as unknown as typeof fetch;
        expect(await verifiedVenue('https://x', 'green_park', 'the clarence', f)).toBe('The Clarence');
        expect(await verifiedVenue('https://x', 'green_park', 'Shepherd Market', f)).toBe('Shepherd Market'); // our own pick
        expect(await verifiedVenue('https://x', 'green_park', 'Anything I like', f)).toBeNull();
        expect(await verifiedVenue('https://x', 'green_park', null, f)).toBeNull();
    });
});

describe('London-wide journeys', () => {
    it('meets Surbiton and Stratford at Waterloo', () => {
        const top = rankStations(
            [
                { id: 'you', name: 'You', station: 'surbiton' },
                { id: 'f', name: 'Friend', station: 'stratford' },
            ],
            'fair',
        )[0];
        expect(top.stationId).toBe('waterloo');
        expect(top.journeys.map((j) => j.route.lines)).toEqual([['south-western-railway'], ['jubilee']]);
        expect(top.max).toBeLessThanOrEqual(25);
    });

    it('takes slugs for any station and hyphenated lines', () => {
        expect(parseOriginSlug('hatch-end')).toBe('hatch_end');
        expect(parseOriginSlug('pinner')).toBe('pinner');
        expect(parseOriginSlug('surbiton')).toBe('surbiton');
        expect(parseOriginSlug('lioness-line')).toBe('line:lioness');
        expect(parseOriginSlug('hammersmith-city-line')).toBe('line:hammersmith-city');
        expect(parsePlan('?from=surbiton&to=stratford')).toEqual(['surbiton', 'stratford']);
    });

    // TfL Journey Planner, weekday midday, station to station (2026-10-22). Times here are ride plus
    // interchange, so they should sit close; this guards the generated run times and router.
    const PLANNER: [string, string, number][] = [
        ['surbiton', 'waterloo', 20], ['hatch_end', 'euston', 26], ['pinner', 'baker_street', 26], ['stratford', 'bank', 11],
        ['brixton', 'oxford_circus', 11], ['stratford', 'waterloo', 17], ['east_croydon', 'victoria_stn', 16],
        ['wimbledon', 'earls_court', 19], ['clapham_junction', 'shepherds_bush', 12], ['ealing_broadway', 'bond_street', 13],
        ['walthamstow_central', 'highbury_islington', 12], ['surbiton', 'stratford', 47], ['hatch_end', 'brixton', 46],
        ['pinner', 'surbiton', 63], ['richmond', 'bank', 31], ['woolwich', 'farringdon', 18], ['uxbridge', 'kings_cross', 46],
        ['morden', 'camden_town', 38],
    ];
    it('stays close to TfL Journey Planner times', () => {
        const errors = PLANNER.map(([a, b, tfl]) => {
            const ours = computeRoute(a, b, 'fast').minutes;
            const e = Math.abs(ours - tfl) / tfl;
            expect(e, `${a} to ${b}: ours ${ours}, TfL ${tfl}`).toBeLessThan(0.25);
            return e;
        });
        const sorted = [...errors].sort((x, y) => x - y);
        expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(0.08);
    });
});
