// One-off data refresh: London's rail network from TfL's open Route Sequence API.
// Every Tube, Overground, DLR, Elizabeth line, tram and National Rail stop inside a TfL fare zone,
// merged into stations by TfL's interchange hubs, with ride times estimated from track distance.
// Writes src/network.ts. Run: npx tsx scripts/build-network.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const API = 'https://api.tfl.gov.uk';
const MODES = ['tube', 'dlr', 'overground', 'elizabeth-line', 'tram', 'national-rail'];
const CACHE = process.env.TFL_CACHE || '.tfl-cache';

interface Stop { id: string; stationId?: string; topMostParentId?: string; name: string; lat: number; lon: number; zone?: string; modes?: string[] }
interface Timetable { timetable?: { routes?: { stationIntervals?: { intervals: { stopId: string; timeToArrival: number }[] }[] }[] } }
interface Seq {
    lineId: string;
    lineName: string;
    mode: string;
    stopPointSequences: { stopPoint: Stop[] }[];
    orderedLineRoutes: { naptanIds: string[]; serviceType?: string }[];
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// TfL rate-limits anonymous callers: pace requests, back off on 429, cache to disk.
async function get<T>(path: string): Promise<T> {
    const file = `${CACHE}/${path.replace(/[^a-z0-9]+/gi, '_')}.json`;
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T;
    for (let attempt = 0; attempt < 6; attempt++) {
        await pause(700);
        const res = await fetch(API + path);
        if (res.status === 429) {
            await pause(5000 * (attempt + 1));
            continue;
        }
        if (!res.ok) throw new Error(`${res.status} ${path}`);
        const body = await res.json();
        mkdirSync(CACHE, { recursive: true });
        writeFileSync(file, JSON.stringify(body));
        return body as T;
    }
    throw new Error(`rate limited ${path}`);
}

// TfL-run lines use TfL's published run times. National Rail (and any TfL gap) falls back to an
// average speed between stops (km/h over the straight line, so it absorbs track curvature) plus
// minutes per stop, calibrated against TfL Journey Planner.
export const SPEED: Record<string, { kmh: number; dwell: number }> = {
    tube: { kmh: 33, dwell: 0.6 },
    dlr: { kmh: 27, dwell: 0.5 },
    overground: { kmh: 30, dwell: 0.8 },
    'elizabeth-line': { kmh: 48, dwell: 0.8 },
    tram: { kmh: 21, dwell: 0.4 },
    'national-rail': { kmh: 60, dwell: 1 },
};

const COLOURS: Record<string, string> = {
    bakerloo: '#B36305', central: '#E32017', circle: '#E6B800', district: '#00782A', 'hammersmith-city': '#E899AC',
    jubilee: '#868F98', metropolitan: '#9B0056', northern: '#262626', piccadilly: '#003688', victoria: '#0098D4',
    'waterloo-city': '#6BC1AA', dlr: '#00A4A7', elizabeth: '#6950A1', tram: '#5FB526', liberty: '#676D70',
    lioness: '#F1A40F', mildmay: '#2774AE', suffragette: '#18A95D', weaver: '#893B67', windrush: '#DC241F',
};
const RAIL_COLOUR = '#5C6670';

const NAMES: Record<string, string> = {
    'hammersmith-city': 'Hammersmith & City', 'waterloo-city': 'Waterloo & City', elizabeth: 'Elizabeth', dlr: 'DLR', tram: 'Tram',
};

function clean(name: string): string {
    return name
        .replace(/\s+(Underground|Rail|DLR|ELL|Elizabeth line|Overground)\s+Station$/i, '')
        .replace(/\s+(Station|Tram Stop|Stop)$/i, '')
        .replace(/^London\s+(?=(Waterloo|Euston|Victoria|Paddington|Liverpool Street|Fenchurch Street|Cannon Street|Charing Cross|Marylebone|Blackfriars|King's Cross|St Pancras))/, '')
        .replace(/ Line\)$/, ')')
        .replace(/\s+/g, ' ')
        .trim();
}

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
};

// The 31 stations the app launched with keep their ids and names, so links and pages never break.
const LEGACY: Record<string, [string, string]> = {
    HUBKGX: ['kings_cross', "King's Cross"], HUBEUS: ['euston', 'Euston'], '940GZZLUOXC': ['oxford_circus', 'Oxford Circus'],
    HUBTCR: ['tottenham_court_road', 'Tottenham Court Rd'], HUBBDS: ['bond_street', 'Bond Street'], '940GZZLUBST': ['baker_street', 'Baker Street'],
    HUBPAD: ['paddington', 'Paddington'], '940GZZLUNHG': ['notting_hill_gate', 'Notting Hill Gate'], HUBSPB: ['shepherds_bush', "Shepherd's Bush"],
    '940GZZLUSKS': ['south_kensington', 'South Kensington'], '940GZZLUGPK': ['green_park', 'Green Park'], '940GZZLUPCC': ['piccadilly_circus', 'Piccadilly Circus'],
    '940GZZLULSQ': ['leicester_square', 'Leicester Square'], '940GZZLUHBN': ['holborn', 'Holborn'], HUBZFD: ['farringdon', 'Farringdon'],
    HUBBAN: ['bank', 'Bank'], HUBLST: ['liverpool_street', 'Liverpool Street'], '910GSHRDHST': ['shoreditch_high_st', 'Shoreditch High St'],
    HUBZWL: ['whitechapel', 'Whitechapel'], HUBSRA: ['stratford', 'Stratford'], HUBCAW: ['canary_wharf', 'Canary Wharf'],
    HUBZCW: ['canada_water', 'Canada Water'], HUBLBG: ['london_bridge', 'London Bridge'], HUBWAT: ['waterloo', 'Waterloo'],
    HUBWSM: ['westminster', 'Westminster'], HUBVIC: ['victoria_stn', 'Victoria'], HUBBRX: ['brixton', 'Brixton'],
    '910GCLPHHS': ['clapham_high_st', 'Clapham High St'], '940GZZLUCTN': ['camden_town', 'Camden Town'],
    HUBHHY: ['highbury_islington', 'Highbury & Islington'], HUBFPK: ['finsbury_park', 'Finsbury Park'],
};

const slug = (name: string) =>
    name.toLowerCase().replace(/&/g, 'and').replace(/['.]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const zoneOf = (z?: string) => {
    const n = (z ?? '').split(/[+/]/).map(Number).filter((x) => x >= 1 && x <= 9);
    return n.length ? Math.min(...n) : 0;
};

async function main() {
    const lines = await get<{ id: string; name: string; modeName: string }[]>(`/Line/Mode/${MODES.join(',')}`);
    const stops = new Map<string, Stop & { mode: string }>();
    const edges = new Map<string, { line: string; a: string; b: string; mins: number }>();
    const lineMeta = new Map<string, { name: string; mode: string }>();

    // Real run times: TfL timetables give minutes from a terminus to every later stop, for every
    // stopping pattern (so fast Metropolitan trains appear as their own, shorter hops).
    const timed = new Map<string, number[]>();
    const pairKey = (line: string, a: string, b: string) => [line, ...[a, b].sort()].join('|');
    const patternEdges: { line: string; a: string; b: string }[] = [];

    for (const line of lines) {
        for (const dir of ['outbound', 'inbound']) {
            let seq: Seq;
            try {
                seq = await get<Seq>(`/Line/${line.id}/Route/Sequence/${dir}?serviceTypes=Regular`);
            } catch {
                continue;
            }
            for (const s of seq.stopPointSequences ?? []) {
                // Inside a TfL fare zone; trams have no zones but run wholly within London.
                for (const p of s.stopPoint) if (zoneOf(p.zone) || line.modeName === 'tram') stops.set(p.id, { ...p, mode: line.modeName });
            }
            if (line.modeName !== 'national-rail') {
                const termini = new Set((seq.orderedLineRoutes ?? []).map((r) => r.naptanIds[0]));
                for (const t of termini) {
                    let tt: Timetable;
                    try {
                        tt = await get<Timetable>(`/Line/${line.id}/Timetable/${t}?direction=${dir}`);
                    } catch {
                        continue;
                    }
                    for (const route of tt.timetable?.routes ?? []) {
                        for (const pattern of route.stationIntervals ?? []) {
                            const seqStops = [{ stopId: t, timeToArrival: 0 }, ...pattern.intervals];
                            for (let i = 1; i < seqStops.length; i++) {
                                const a = seqStops[i - 1].stopId;
                                const b = seqStops[i].stopId;
                                if (a === b) continue;
                                const mins = Math.max(0.5, seqStops[i].timeToArrival - seqStops[i - 1].timeToArrival);
                                const k = pairKey(line.id, a, b);
                                timed.set(k, [...(timed.get(k) ?? []), mins]);
                                patternEdges.push({ line: line.id, a, b });
                            }
                        }
                    }
                }
            }
            for (const r of seq.orderedLineRoutes ?? []) {
                for (let i = 1; i < r.naptanIds.length; i++) {
                    const a = stops.get(r.naptanIds[i - 1]);
                    const b = stops.get(r.naptanIds[i]);
                    if (!a || !b || a.id === b.id) continue;
                    const key = pairKey(line.id, a.id, b.id);
                    if (!edges.has(key)) edges.set(key, { line: line.id, a: a.id, b: b.id, mins: 0 });
                    lineMeta.set(line.id, { name: NAMES[line.id] ?? line.name, mode: line.modeName });
                }
            }
        }
        process.stdout.write('.');
    }
    // Skip-stop hops from fast patterns join the graph too.
    for (const e of patternEdges) {
        const a = stops.get(e.a);
        const b = stops.get(e.b);
        const key = pairKey(e.line, e.a, e.b);
        if (a && b && lineMeta.has(e.line) && !edges.has(key)) edges.set(key, { line: e.line, a: e.a, b: e.b, mins: 0 });
    }
    let fromTimetable = 0;
    for (const [key, e] of edges) {
        // TfL publishes whole minutes from the terminus; averaging hops across patterns undoes the rounding.
        const t = timed.get(key);
        if (t?.length) {
            e.mins = Math.round((t.reduce((x, y) => x + y, 0) / t.length) * 10) / 10;
            fromTimetable++;
            continue;
        }
        const sp = SPEED[stops.get(e.a)!.mode];
        e.mins = Math.round(((km(stops.get(e.a)!, stops.get(e.b)!) / sp.kmh) * 60 + sp.dwell) * 10) / 10;
    }
    console.log(`\n${fromTimetable} of ${edges.size} hops timed from TfL timetables`);

    // Stops → stations: TfL's interchange hub when there is one, else the station itself.
    const nodeOf = (s: Stop) => (s.topMostParentId?.startsWith('HUB') ? s.topMostParentId : s.stationId || s.topMostParentId || s.id);
    const nodes = new Map<string, { members: (Stop & { mode: string })[] }>();
    for (const s of stops.values()) {
        const k = nodeOf(s);
        if (!nodes.has(k)) nodes.set(k, { members: [] });
        nodes.get(k)!.members.push(s);
    }
    const used = new Set<string>();
    for (const e of edges.values()) used.add(nodeOf(stops.get(e.a)!)).add(nodeOf(stops.get(e.b)!));

    const RANK: Record<string, number> = { tube: 0, 'elizabeth-line': 1, overground: 2, dlr: 3, 'national-rail': 4, tram: 5 };
    const out: { key: string; id: string; name: string; lat: number; lng: number; zone: number; rank: number; mode: string }[] = [];
    for (const [key, n] of nodes) {
        if (!used.has(key)) continue;
        const lead = [...n.members].sort((x, y) => RANK[x.mode] - RANK[y.mode])[0];
        const zones = n.members.map((m) => zoneOf(m.zone)).filter(Boolean);
        let name = clean(lead.name);
        // An interchange hub is one place: "Hammersmith", not "Hammersmith (H&C)".
        if (key.startsWith('HUB')) name = name.replace(/\s*\([^)]*\)$/, '');
        out.push({ key, id: '', name, lat: +lead.lat.toFixed(6), lng: +lead.lon.toFixed(6), zone: zones.length ? Math.min(...zones) : 0, rank: RANK[lead.mode], mode: lead.mode });
    }
    // Two different stations with one name (Bethnal Green): the non-Tube one says which network it is.
    const MODE_LABEL: Record<string, string> = { overground: 'Overground', dlr: 'DLR', 'elizabeth-line': 'Elizabeth line', 'national-rail': 'Rail', tram: 'Tram' };
    const byName = new Map<string, typeof out>();
    for (const n of out) byName.set(n.name, [...(byName.get(n.name) ?? []), n]);
    for (const group of byName.values()) {
        if (group.length < 2) continue;
        group.sort((a, b) => a.rank - b.rank).slice(1).forEach((n) => (n.name = `${n.name} (${MODE_LABEL[n.mode] ?? n.mode})`));
    }
    const taken = new Set<string>();
    for (const n of out) {
        const legacy = LEGACY[n.key];
        if (legacy) [n.id, n.name] = legacy;
        else n.id = slug(n.name);
        while (taken.has(n.id)) n.id += '_2';
        taken.add(n.id);
    }

    const lineList = [...lineMeta].map(([id, m]) => [id, m.name, COLOURS[id] ?? RAIL_COLOUR, m.mode]);
    const nodeIndex = new Map(out.map((n, i) => [n.key, i]));
    const edgeList = [...edges.values()].map((e) => [e.line, nodeIndex.get(nodeOf(stops.get(e.a)!))!, nodeIndex.get(nodeOf(stops.get(e.b)!))!, e.mins]);

    // Separate stations a short walk apart (Bank and Monument, Clapham North and Clapham High Street).
    const walks: [number, number, number][] = [];
    for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
            const m = km({ lat: out[i].lat, lon: out[i].lng }, { lat: out[j].lat, lon: out[j].lng }) * 1000;
            if (m <= 350) walks.push([i, j, Math.round((m * 1.3) / 75 + 2)]);
        }
    }

    const header = `// Generated by scripts/build-network.ts from TfL open data (Route Sequence API). Do not edit by hand.
// Lines: [id, name, colour, mode]. Stations: [id, tflId, name, lat, lng, zone (0 = no zone, trams)].
// Edges: [line, fromIndex, toIndex, minutes]. Walks: [fromIndex, toIndex, minutes] between nearby stations.
`;
    writeFileSync(
        'src/network.ts',
        header +
            `export const NET_LINES: [string, string, string, string][] = ${JSON.stringify(lineList)};\n` +
            `export const NET_STATIONS: [string, string, string, number, number, number][] = ${JSON.stringify(out.map((n) => [n.id, n.key, n.name, n.lat, n.lng, n.zone]))};\n` +
            `export const NET_EDGES: [string, number, number, number][] = ${JSON.stringify(edgeList)};\n` +
            `export const NET_WALKS: [number, number, number][] = ${JSON.stringify(walks)};\n`,
    );
    console.log(`\nlines ${lineList.length}, stations ${out.length}, edges ${edgeList.length}, walks ${walks.length}`);
}

main();
