import { LINE_ROUTES, MEETING_POINTS, STATIONS, TFL_LINES, lineLabel, type Station } from './data.js';

// A traveller's origin is either a station id or `line:<lineId>`, meaning
// "anywhere on that line works for me": they can board at any of its stations.
const LINE_PREFIX = 'line:';

export const lineOrigin = (lineId: string) => `${LINE_PREFIX}${lineId}`;

export function originLine(origin: string): string | null {
    return origin.startsWith(LINE_PREFIX) ? origin.slice(LINE_PREFIX.length) : null;
}

export function isValidOrigin(origin: string): boolean {
    const line = originLine(origin);
    return line ? Object.hasOwn(LINE_ROUTES, line) : Object.hasOwn(STATIONS, origin);
}

/** Lines the traveller can start on. */
export function originLines(origin: string): string[] {
    const line = originLine(origin);
    return line ? [line] : STATIONS[origin].lines;
}

/** Short label: "Brixton" or "Victoria line". */
export function originName(origin: string): string {
    const line = originLine(origin);
    return line ? lineLabel(line) : STATIONS[origin].name;
}

export function stationsOnLine(lineId: string): string[] {
    const ids = new Set<string>();
    for (const [u, v] of LINE_ROUTES[lineId] || []) {
        ids.add(u);
        ids.add(v);
    }
    return [...ids];
}

export type Mode = 'fair' | 'fast' | 'direct';

export interface Route {
    minutes: number;
    transfers: number;
    lines: string[];
    /** For a line origin: the station on that line where the traveller joins. */
    board?: string;
}

export interface Person { id: string; name: string; station: string; isUser?: boolean }

export interface Journey { person: Person; route: Route }

export interface Ranked {
    stationId: string;
    station: Station;
    journeys: Journey[];
    avg: number;
    max: number;
    score: number;
}

// Real-world minutes added for an interchange, independent of mode.
const TRANSFER_MINUTES = 4;

interface Step { prevKey: string; type: 'ride' | 'transfer'; line: string; mins: number }

/** Extra search cost per ride on a line, from live disruption. Infinity means don't ride it at all. */
export type Avoid = Record<string, number>;

// TfL statusSeverity → how hard to avoid the line.
const BLOCKED = new Set([1, 2, 4, 16, 20]); // Closed, Suspended, Planned Closure, Not Running, Service Closed
const PARTLY = new Set([3, 5, 11]); // Part Suspended, Part Closure, Part Closed
const SEVERE = new Set([6]); // Severe Delays

export function avoidFromIssues(issues: Record<string, { severity: number }>, soften = false): Avoid {
    const out: Avoid = {};
    for (const [line, { severity }] of Object.entries(issues)) {
        if (BLOCKED.has(severity)) out[line] = soften ? 60 : Infinity;
        else if (PARTLY.has(severity)) out[line] = 30;
        else if (SEVERE.has(severity)) out[line] = 8;
    }
    return out;
}

const avoidKey = (a?: Avoid) =>
    a ? Object.keys(a).sort().map((k) => `${k}:${a[k]}`).join(',') : '';

// Typical wait to board, by how often trains run. It steers the search away from infrequent services
// (a Southeastern hop beats the Victoria line on paper, not on a platform) but is not added to the
// minutes we show, which stay ride plus interchange time like TfL's planner.
const BOARD_WAIT: Record<string, number> = { tube: 1, dlr: 1.5, 'elizabeth-line': 2, overground: 3, tram: 2.5, 'national-rail': 6 };
const wait = (line: string) => BOARD_WAIT[TFL_LINES[line].mode] ?? 2;

// Every ride out of a station, on any line.
const RIDES: Record<string, { to: string; line: string; mins: number }[]> = {};
for (const [line, edges] of Object.entries(LINE_ROUTES)) {
    for (const [u, v, mins] of edges) {
        (RIDES[u] ??= []).push({ to: v, line, mins });
        (RIDES[v] ??= []).push({ to: u, line, mins });
    }
}

/** Binary min-heap keyed on cost. */
class Heap {
    private items: { key: string; cost: number }[] = [];
    get size() {
        return this.items.length;
    }
    push(item: { key: string; cost: number }) {
        const a = this.items;
        a.push(item);
        for (let i = a.length - 1; i > 0; ) {
            const p = (i - 1) >> 1;
            if (a[p].cost <= a[i].cost) break;
            [a[p], a[i]] = [a[i], a[p]];
            i = p;
        }
    }
    pop() {
        const a = this.items;
        const top = a[0];
        const last = a.pop()!;
        if (a.length) {
            a[0] = last;
            for (let i = 0; ; ) {
                const l = 2 * i + 1;
                const r = l + 1;
                let m = i;
                if (l < a.length && a[l].cost < a[m].cost) m = l;
                if (r < a.length && a[r].cost < a[m].cost) m = r;
                if (m === i) break;
                [a[m], a[i]] = [a[i], a[m]];
                i = m;
            }
        }
        return top;
    }
}

interface Tree { dist: Map<string, number>; prev: Map<string, Step> }

const trees = new Map<string, Tree>();

/**
 * One Dijkstra from an origin over (station, line) states, reaching every station at once. The
 * transfer penalty and disruption costs steer the search; reported minutes stay real ride,
 * interchange and walking time.
 */
function tree(startId: string, mode: Mode, avoid: Avoid): Tree {
    const key = `${startId}>${mode}>${avoidKey(avoid)}`;
    const hit = trees.get(key);
    if (hit) return hit;
    if (trees.size > 300) trees.clear();

    const startLine = originLine(startId);
    const transferPenalty = mode === 'direct' ? 12 : 4;
    const dist = new Map<string, number>();
    const prev = new Map<string, Step>();
    const heap = new Heap();
    const starts: [string, string][] = startLine
        ? stationsOnLine(startLine).map((st) => [st, startLine])
        : STATIONS[startId].lines.map((line) => [startId, line]);
    for (const [station, line] of starts) {
        const k = `${station}|${line}`;
        const cost = startLine ? 0 : wait(line);
        dist.set(k, cost);
        heap.push({ key: k, cost });
    }
    const relax = (k: string, cost: number, step: Step) => {
        if (cost < (dist.get(k) ?? Infinity)) {
            dist.set(k, cost);
            prev.set(k, step);
            heap.push({ key: k, cost });
        }
    };

    while (heap.size) {
        const { key: k, cost } = heap.pop();
        if (cost > (dist.get(k) ?? Infinity)) continue;
        const bar = k.indexOf('|');
        const station = k.slice(0, bar);
        const line = k.slice(bar + 1);

        // Ride along the same line (unless it is suspended right now)
        const penalty = avoid[line] ?? 0;
        if (penalty !== Infinity) {
            for (const r of RIDES[station] ?? []) {
                if (r.line === line) relax(`${r.to}|${line}`, cost + r.mins + penalty, { prevKey: k, type: 'ride', line, mins: r.mins });
            }
        }
        // Change line here, or walk to a station next door and change there
        for (const other of STATIONS[station].lines) {
            if (other !== line) relax(`${station}|${other}`, cost + transferPenalty + wait(other), { prevKey: k, type: 'transfer', line: other, mins: TRANSFER_MINUTES });
        }
        for (const [next, walk] of STATIONS[station].walks) {
            for (const other of STATIONS[next].lines) {
                relax(`${next}|${other}`, cost + transferPenalty + walk + wait(other), { prevKey: k, type: 'transfer', line: other, mins: walk });
            }
        }
    }
    const t = { dist, prev };
    trees.set(key, t);
    return t;
}

const routes = new Map<string, Route>();

export function computeRoute(startId: string, targetId: string, mode: Mode, avoid?: Avoid): Route {
    const cacheKey = `${startId}>${targetId}>${mode}>${avoidKey(avoid)}`;
    const hit = routes.get(cacheKey);
    if (hit) return hit;
    if (routes.size > 20000) routes.clear();
    const route = search(startId, targetId, mode, avoid ?? {});
    routes.set(cacheKey, route);
    return route;
}

function search(startId: string, targetId: string, mode: Mode, avoid: Avoid): Route {
    const startLine = originLine(startId);
    const defaultLines = [originLines(startId)[0]];
    if (startId === targetId) return { minutes: 0, transfers: 0, lines: defaultLines };
    if (startLine && STATIONS[targetId].lines.includes(startLine)) {
        return { minutes: 0, transfers: 0, lines: [startLine], board: targetId };
    }

    const { dist, prev } = tree(startId, mode, avoid);
    let bestKey: string | null = null;
    let bestCost = Infinity;
    for (const line of STATIONS[targetId].lines) {
        const k = `${targetId}|${line}`;
        if ((dist.get(k) ?? Infinity) < bestCost) {
            bestCost = dist.get(k)!;
            bestKey = k;
        }
    }
    if (!bestKey) return { minutes: Infinity, transfers: Infinity, lines: defaultLines };

    const steps: Step[] = [];
    let cur = bestKey;
    while (prev.has(cur)) {
        steps.unshift(prev.get(cur)!);
        cur = prev.get(cur)!.prevKey;
    }
    // A change of line straight after starting is just choosing which platform to start from.
    while (steps.length && steps[0].type === 'transfer' && !startLine && steps[0].mins === TRANSFER_MINUTES) steps.shift();

    let minutes = 0;
    let transfers = 0;
    const lines: string[] = [];
    for (const s of steps) {
        minutes += s.mins;
        if (s.type === 'transfer') transfers++;
        if (s.type === 'ride' && lines[lines.length - 1] !== s.line) lines.push(s.line);
    }
    // Count changes between the lines actually ridden; joining from "anywhere on the X line" onto
    // another line is one more.
    transfers = Math.max(0, lines.length - 1) + (startLine && lines.length && lines[0] !== startLine ? 1 : 0);

    const route: Route = { minutes: Math.round(minutes), transfers, lines: lines.length ? lines : defaultLines };
    if (startLine) route.board = cur.split('|')[0];
    return route;
}

export function rankStations(people: Person[], mode: Mode, avoid?: Avoid): Ranked[] {
    const results = MEETING_POINTS.map((stId) => {
        const journeys = people.map((p) => ({ person: p, route: computeRoute(p.station, stId, mode, avoid) }));

        const times = journeys.map((j) => j.route.minutes);
        const total = times.reduce((a, b) => a + b, 0);
        const avg = Math.round(total / journeys.length);
        const max = Math.max(...times);
        const spread = max - Math.min(...times);
        const totalChanges = journeys.reduce((a, j) => a + j.route.transfers, 0);

        let score: number;
        if (mode === 'fair') score = max * 1.7 + spread * 0.9 + avg * 0.6 + totalChanges * 2.5;
        else if (mode === 'fast') score = total + totalChanges * 2;
        else score = totalChanges * 15 + max + avg * 0.5;

        return { stationId: stId, station: STATIONS[stId], journeys, avg, max, score };
    });

    return results.filter((r) => Number.isFinite(r.score)).sort((a, b) => a.score - b.score);
}

/** Great-circle distance in metres. */
export function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearestStation(lat: number, lng: number): { station: Station; metres: number } {
    let best = Object.values(STATIONS)[0];
    let bestD = Infinity;
    for (const st of Object.values(STATIONS)) {
        const d = distanceMetres(lat, lng, st.lat, st.lng);
        if (d < bestD) {
            bestD = d;
            best = st;
        }
    }
    return { station: best, metres: bestD };
}
