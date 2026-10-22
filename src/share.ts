import { STATIONS, TFL_LINES } from './data.js';
import { avoidFromIssues, originLine, rankStations, type Avoid, type Mode } from './routing.js';
import { parseOriginSlug, parsePlan, planPath, stationSlug } from './links.js';
import { cleanText } from './venues.js';

// Server-side view of a shared plan link (/p?from=..&to=..[&and=..][&meet=..][&mode=..][&at=..]),
// used by the preview page and its image. Everything shown is recomputed from validated slugs.

export interface PlanSummary {
    stationId: string;
    stationName: string;
    lines: { name: string; color: string }[];
    people: { name: string; from: string; minutes: number }[];
    avg: number;
    max: number;
    mode: Mode;
    /** App path for this plan, without the venue. */
    appPath: string;
}

const MODES: Mode[] = ['fair', 'fast', 'direct'];

export function summarisePlan(search: string, avoid?: Avoid): PlanSummary | null {
    const origins = parsePlan(search);
    if (!origins) return null;
    const q = new URLSearchParams(search);
    const mode = (MODES as string[]).includes(q.get('mode') ?? '') ? (q.get('mode') as Mode) : 'fair';
    const people = origins.map((station, i) => ({ id: `p${i}`, name: i === 0 ? 'You' : i === 1 ? 'Friend' : `Friend ${i}`, station }));
    let ranked = rankStations(people, mode, avoid);
    if (!ranked.length && avoid) ranked = rankStations(people, mode);
    const meet = parseOriginSlug(q.get('meet'));
    const pick = (meet && !originLine(meet) && ranked.find((r) => r.stationId === meet)) || ranked[0];
    if (!pick) return null;
    let appPath = planPath(origins);
    if (pick.stationId !== ranked[0].stationId) appPath += `&meet=${stationSlug(pick.stationId)}`;
    if (mode !== 'fair') appPath += `&mode=${mode}`;
    return {
        stationId: pick.stationId,
        stationName: pick.station.name,
        lines: pick.station.lines.map((l) => ({ name: TFL_LINES[l].name, color: TFL_LINES[l].color })),
        people: pick.journeys.map((j) => {
            const line = originLine(j.person.station);
            return {
                name: j.person.name,
                from: line ? `${TFL_LINES[line].name} line` : STATIONS[j.person.station].name,
                minutes: j.route.minutes,
            };
        }),
        avg: pick.avg,
        max: pick.max,
        mode,
        appPath,
    };
}

/**
 * Accepts the venue named in a link only if it is one we would show for that station (our own
 * picks, or the cached live list), so nobody can put arbitrary text on a getaround.london card.
 */
export async function verifiedVenue(
    origin: string,
    stationId: string,
    name: string | null,
    fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
    const wanted = cleanText(name, 80)?.toLowerCase();
    if (!wanted) return null;
    const curated = STATIONS[stationId].venues.find((v) => v.name.toLowerCase() === wanted);
    if (curated) return curated.name;
    const lists = await Promise.all(
        ['drinks', 'coffee'].map((kind) =>
            fetchImpl(`${origin}/api/venues?station=${stationId}&kind=${kind}`, { signal: AbortSignal.timeout(4000) })
                .then((r) => (r.ok ? (r.json() as Promise<{ venues?: { name: string }[] }>) : { venues: [] }))
                .catch(() => ({ venues: [] as { name: string }[] })),
        ),
    );
    for (const list of lists) {
        const hit = (list.venues ?? []).find((v) => v.name.toLowerCase() === wanted);
        if (hit) return hit.name;
    }
    return null;
}

/** Live TfL disruption as routing costs, so cards match what the app shows (empty on any failure). */
export async function liveAvoid(origin: string, fetchImpl: typeof fetch = fetch): Promise<Avoid> {
    try {
        const r = await fetchImpl(`${origin}/api/status`, { signal: AbortSignal.timeout(3000) });
        const body = (await r.json()) as { lines?: Record<string, { severity: number }> };
        return avoidFromIssues(body.lines ?? {});
    } catch {
        return {};
    }
}
