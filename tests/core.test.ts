import { describe, expect, it, vi, afterEach } from 'vitest';
import { LINE_ROUTES, STATIONS, TFL_LINES } from '../src/data';
import { computeRoute, nearestStation, rankStations } from '../src/routing';
import { extractJsonArray, sanitizeVenues } from '../src/venues';
import { GET, fetchVenues } from '../api/venues';

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

    it('returns an empty list when the key is not configured', async () => {
        vi.stubEnv('GEMINI_API_KEY', '');
        const res = await GET(new Request('https://x/api/venues?station=bank'));
        expect(await res.json()).toEqual({ venues: [], reason: 'unconfigured' });
        expect(res.headers.get('cache-control')).toBe('no-store');
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
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const res = await GET(new Request('https://x/api/venues?station=bank'));
        expect(await res.json()).toEqual({ venues: [], reason: 'upstream' });
        spy.mockRestore();
    });
});
