import { LINE_ROUTES, STATIONS } from './data.js';
import { lineOrigin, originLine } from './routing.js';

// Public URLs shared by the app (deep links, share) and the static page generator.

export const SITE = 'https://getaround.london';

export function stationSlug(id: string): string {
    return id === 'victoria_stn' ? 'victoria' : id.replace(/_/g, '-');
}

const SLUG_TO_STATION: Record<string, string> = Object.fromEntries(
    Object.keys(STATIONS).map((id) => [stationSlug(id), id]),
);

/** "waterloo" for a station, "victoria-line" for anywhere on a line. */
export function originSlug(origin: string): string {
    const line = originLine(origin);
    return line ? `${line}-line` : stationSlug(origin);
}

export function parseOriginSlug(slug: string | null | undefined): string | null {
    if (!slug) return null;
    const s = slug.trim().toLowerCase();
    const m = /^([a-z]+)-line$/.exec(s);
    if (m && Object.hasOwn(LINE_ROUTES, m[1])) return lineOrigin(m[1]);
    return Object.hasOwn(SLUG_TO_STATION, s) ? SLUG_TO_STATION[s] : null;
}

/** /?from=waterloo&to=victoria-line[&and=bank,stratford] */
export function planPath(origins: string[]): string {
    const [from, to, ...rest] = origins.map(originSlug);
    const q = new URLSearchParams({ from, to });
    if (rest.length) q.set('and', rest.join(','));
    return `/?${q.toString()}`;
}

export function parsePlan(search: string): string[] | null {
    const q = new URLSearchParams(search);
    const from = parseOriginSlug(q.get('from'));
    const to = parseOriginSlug(q.get('to'));
    if (!from || !to) return null;
    const rest = (q.get('and') || '')
        .split(',')
        .map(parseOriginSlug)
        .filter((o): o is string => !!o)
        .slice(0, 2);
    return [from, to, ...rest];
}

/** Stable, alphabetical pair page: /meet/brixton-and-camden-town */
export function pairSlug(a: string, b: string): string {
    const [x, y] = [stationSlug(a), stationSlug(b)].sort();
    return `${x}-and-${y}`;
}
