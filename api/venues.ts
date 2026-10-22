import { STATIONS, TFL_LINES } from '../src/data.js';
import { extractJsonArray, sanitizeVenues } from '../src/venues.js';

// GET /api/venues?station=<id>
// Asks Gemini (grounded with Google Search) for extra group-friendly spots by a
// station. Only known station ids are accepted, so the endpoint cannot be used as
// an open prompt relay, and responses are CDN-cached per station for a day.

const DEFAULT_MODEL = 'gemini-2.5-flash';
const TIMEOUT_MS = 25000;

function json(body: unknown, status: number, cache: string): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
    });
}

export function buildPrompt(stationId: string): string {
    const st = STATIONS[stationId];
    const lines = st.lines.map((l) => TFL_LINES[l].name).join(', ');
    const known = st.venues.map((v) => v.name).join('; ');
    return [
        `Suggest 3 real, currently open places to meet a group of friends within a 6 minute walk of ${st.name} station in London (${lines}).`,
        `Mix pubs, bars, cafés or food halls that can seat a small group. Do not include: ${known}.`,
        'Only include places you can confirm exist today. Never invent a venue.',
        'Reply with only a JSON array, no prose, of objects:',
        '{"name": string (venue name, max 40 chars), "detail": string (what it is and why it suits a group, max 45 chars, no full stop), "walkMinutes": integer 1-6}',
    ].join('\n');
}

export async function fetchVenues(stationId: string, apiKey: string, model: string, fetchImpl: typeof fetch = fetch) {
    const res = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: buildPrompt(stationId) }] }],
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0.4 },
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    const exclude = STATIONS[stationId].venues.map((v) => v.name);
    return sanitizeVenues(extractJsonArray(text), exclude, 3);
}

export async function GET(request: Request): Promise<Response> {
    const stationId = new URL(request.url).searchParams.get('station') ?? '';
    if (!Object.hasOwn(STATIONS, stationId)) {
        return json({ error: 'unknown station' }, 400, 'public, max-age=3600');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return json({ venues: [], reason: 'unconfigured' }, 200, 'no-store');

    try {
        const venues = await fetchVenues(stationId, apiKey, process.env.GEMINI_MODEL || DEFAULT_MODEL);
        return json({ venues }, 200, 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    } catch (err) {
        console.error('venues lookup failed', stationId, err instanceof Error ? err.message : err);
        return json({ venues: [], reason: 'upstream' }, 200, 'public, s-maxage=300');
    }
}
