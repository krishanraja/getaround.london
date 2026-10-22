import { cleanText } from '../src/venues.js';

// GET /api/status → { lines: { northern: { severity: 9, text: "Minor Delays" }, ... } }
// Live TfL line status (TfL Open Data). Only lines with a problem are returned.
// "overground" in our network maps onto the named Overground lines it covers.

const TFL_URL = 'https://api.tfl.gov.uk/Line/Mode/tube,elizabeth-line,overground/Status';
const OVERGROUND = ['mildmay', 'windrush', 'lioness'];
// 10 Good Service, 18 No Step Free Access, 19 Information: not a journey problem.
const FINE = new Set([10, 18, 19]);

interface TflLine {
    id: string;
    lineStatuses?: { statusSeverity: number; statusSeverityDescription?: string }[];
}

export interface LineIssue {
    severity: number;
    text: string;
}

export function summarise(lines: TflLine[]): Record<string, LineIssue> {
    const out: Record<string, LineIssue> = {};
    for (const line of lines) {
        const target = OVERGROUND.includes(line.id) ? 'overground' : line.id;
        for (const s of line.lineStatuses ?? []) {
            if (FINE.has(s.statusSeverity)) continue;
            const text = cleanText(s.statusSeverityDescription, 40) ?? 'Disruption';
            // Lower TfL severity numbers are worse.
            if (!out[target] || s.statusSeverity < out[target].severity) out[target] = { severity: s.statusSeverity, text };
        }
    }
    return out;
}

export async function GET(): Promise<Response> {
    try {
        const key = process.env.TFL_APP_KEY;
        const res = await fetch(key ? `${TFL_URL}?app_key=${encodeURIComponent(key)}` : TFL_URL, {
            signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) throw new Error(`TfL ${res.status}`);
        const lines = (await res.json()) as TflLine[];
        return new Response(JSON.stringify({ lines: summarise(lines) }), {
            headers: {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=120',
            },
        });
    } catch (err) {
        console.error('tfl status failed', err instanceof Error ? err.message : err);
        return new Response(JSON.stringify({ lines: {}, reason: 'upstream' }), {
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, s-maxage=60' },
        });
    }
}
