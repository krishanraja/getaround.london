import { LINE_ROUTES, STATIONS, TFL_LINES, type Station } from './data';

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
    return line ? `${TFL_LINES[line].name} line` : STATIONS[origin].name;
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

const cache = new Map<string, Route>();

/**
 * Dijkstra over (station, line) states. The transfer penalty steers the search
 * (heavier in "direct" mode); the reported minutes are always real ride + interchange time.
 */
export function computeRoute(startId: string, targetId: string, mode: Mode): Route {
    const cacheKey = `${startId}>${targetId}>${mode}`;
    const hit = cache.get(cacheKey);
    if (hit) return hit;

    const route = search(startId, targetId, mode);
    cache.set(cacheKey, route);
    return route;
}

function search(startId: string, targetId: string, mode: Mode): Route {
    const startLine = originLine(startId);
    const defaultLines = [originLines(startId)[0]];
    if (startId === targetId) return { minutes: 0, transfers: 0, lines: defaultLines };
    if (startLine && STATIONS[targetId].lines.includes(startLine)) {
        return { minutes: 0, transfers: 0, lines: [startLine], board: targetId };
    }

    const transferPenalty = mode === 'direct' ? 12 : 4;
    const dist: Record<string, number> = {};
    const prev: Record<string, Step> = {};
    const pq: { key: string; cost: number; station: string; line: string }[] = [];

    const starts: [string, string][] = startLine
        ? stationsOnLine(startLine).map((st) => [st, startLine])
        : STATIONS[startId].lines.map((line) => [startId, line]);
    for (const [station, line] of starts) {
        const key = `${station}|${line}`;
        dist[key] = 0;
        pq.push({ key, cost: 0, station, line });
    }

    while (pq.length > 0) {
        pq.sort((a, b) => a.cost - b.cost);
        const curr = pq.shift()!;
        if (curr.cost > (dist[curr.key] ?? Infinity)) continue;

        // Ride along the same line
        for (const [u, v, mins] of LINE_ROUTES[curr.line] || []) {
            const nextSt = u === curr.station ? v : v === curr.station ? u : null;
            if (!nextSt) continue;
            const nextKey = `${nextSt}|${curr.line}`;
            const nextCost = curr.cost + mins;
            if (nextCost < (dist[nextKey] ?? Infinity)) {
                dist[nextKey] = nextCost;
                prev[nextKey] = { prevKey: curr.key, type: 'ride', line: curr.line, mins };
                pq.push({ key: nextKey, cost: nextCost, station: nextSt, line: curr.line });
            }
        }

        // Switch line at the current station
        for (const otherLine of STATIONS[curr.station].lines) {
            if (otherLine === curr.line) continue;
            const nextKey = `${curr.station}|${otherLine}`;
            const nextCost = curr.cost + transferPenalty;
            if (nextCost < (dist[nextKey] ?? Infinity)) {
                dist[nextKey] = nextCost;
                prev[nextKey] = { prevKey: curr.key, type: 'transfer', line: otherLine, mins: TRANSFER_MINUTES };
                pq.push({ key: nextKey, cost: nextCost, station: curr.station, line: otherLine });
            }
        }
    }

    let bestKey: string | null = null;
    let bestCost = Infinity;
    for (const line of STATIONS[targetId].lines) {
        const k = `${targetId}|${line}`;
        if ((dist[k] ?? Infinity) < bestCost) {
            bestCost = dist[k];
            bestKey = k;
        }
    }
    if (!bestKey) return { minutes: Infinity, transfers: Infinity, lines: defaultLines };

    const steps: Step[] = [];
    let cur = bestKey;
    while (prev[cur]) {
        steps.unshift(prev[cur]);
        cur = prev[cur].prevKey;
    }

    let minutes = 0;
    let transfers = 0;
    const lines: string[] = [];
    for (const s of steps) {
        minutes += s.mins;
        if (s.type === 'transfer') transfers++;
        if (s.type === 'ride' && !lines.includes(s.line)) lines.push(s.line);
    }

    const route: Route = { minutes, transfers, lines: lines.length ? lines : defaultLines };
    if (startLine) route.board = cur.split('|')[0];
    return route;
}

export function rankStations(people: Person[], mode: Mode): Ranked[] {
    const results = Object.keys(STATIONS).map((stId) => {
        const journeys = people.map((p) => ({ person: p, route: computeRoute(p.station, stId, mode) }));

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
