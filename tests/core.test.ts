import { describe, expect, it, vi, afterEach } from 'vitest';
import { LINE_ROUTES, STATIONS, TFL_LINES } from '../src/data';
import { computeRoute, isValidOrigin, nearestStation, rankStations } from '../src/routing';
import { extractJsonArray, isOpenAt, sanitizeVenues, walkMinutes } from '../src/venues';
import { GET, fetchPlaces, fetchVenues, rankPlaces } from '../api/venues';
import { summarise } from '../api/status';
import { pairSlug, parseOriginSlug, parsePlan, planPath } from '../src/links';

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

    it('places every station inside Greater London', () => {
        for (const st of Object.values(STATIONS)) {
            expect(st.lat).toBeGreaterThan(51.4);
            expect(st.lat).toBeLessThan(51.6);
            expect(st.lng).toBeGreaterThan(-0.3);
            expect(st.lng).toBeLessThan(0.05);
        }
    });
});

describe('computeRoute', () => {
    it('reaches every station from every station in all modes', () => {
        for (const mode of ['fair', 'fast', 'direct'] as const) {
            for (const a of ids) for (const b of ids) {
                const r = computeRoute(a, b, mode);
                expect(Number.isFinite(r.minutes), `${a}->${b}`).toBe(true);
            }
        }
    });

    it('is zero for same station and symmetric-ish for direct rides', () => {
        expect(computeRoute('bank', 'bank', 'fair')).toMatchObject({ minutes: 0, transfers: 0 });
        expect(computeRoute('brixton', 'oxford_circus', 'fast')).toEqual({ minutes: 12, transfers: 0, lines: ['victoria'] });
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
        expect(ranked).toHaveLength(ids.length);
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
        expect(out[0]).toMatchObject({ name: 'The Argyll Arms', type: 'Pub', rating: 4.4, ratings: 3000, walkMin: 2 });
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
    it('keeps only real problems, maps Overground lines and keeps the worst severity', () => {
        const out = summarise([
            { id: 'victoria', lineStatuses: [{ statusSeverity: 10, statusSeverityDescription: 'Good Service' }] },
            { id: 'piccadilly', lineStatuses: [{ statusSeverity: 6, statusSeverityDescription: 'Severe Delays' }] },
            { id: 'mildmay', lineStatuses: [{ statusSeverity: 9, statusSeverityDescription: 'Minor Delays' }] },
            { id: 'windrush', lineStatuses: [{ statusSeverity: 2, statusSeverityDescription: 'Suspended' }] },
            { id: 'central', lineStatuses: [{ statusSeverity: 18, statusSeverityDescription: 'No Step Free Access' }] },
        ]);
        expect(out).toEqual({
            piccadilly: { severity: 6, text: 'Severe Delays' },
            overground: { severity: 2, text: 'Suspended' },
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

    it('reaches every station from every line in all modes', () => {
        for (const line of Object.keys(LINE_ROUTES)) for (const b of ids) {
            expect(Number.isFinite(computeRoute(`line:${line}`, b, 'direct').minutes), `${line}->${b}`).toBe(true);
        }
    });
});
