import { STATIONS, TFL_LINES } from '../src/data.js';
import { nearestExit, streetFrom } from '../src/exits.js';
import {
    cleanText,
    extractJsonArray,
    mapsSearchUrl,
    sanitizeVenues,
    walkMinutes,
    weeklyHours,
    type ApiVenue,
    type VenueKind,
    type VenuesResponse,
} from '../src/venues.js';

// GET /api/venues?station=<id>&kind=drinks|coffee
//
// 1. Google Places (New) Nearby Search, when GOOGLE_MAPS_API_KEY is set: live opening
//    hours, rating, "good for groups", Maps link. Cached per station+kind for an hour.
// 2. Otherwise Gemini with Google Search grounding (drinks only), cached for a day.
// Only known station ids are accepted, so neither key can be used as an open relay.

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = 25000;
const PLACES_TIMEOUT_MS = 8000;
const RADIUS_M = 500;

const PLACES_FIELDS = [
    'places.id',
    'places.displayName',
    'places.primaryTypeDisplayName',
    'places.location',
    'places.googleMapsUri',
    'places.businessStatus',
    'places.rating',
    'places.userRatingCount',
    'places.currentOpeningHours.openNow',
    'places.currentOpeningHours.nextCloseTime',
    'places.currentOpeningHours.nextOpenTime',
    'places.goodForGroups',
    'places.shortFormattedAddress',
    'places.regularOpeningHours.periods',
].join(',');

// First list is preferred; fall back to broader, long-standing types if Google rejects one.
const PLACE_TYPES: Record<VenueKind, string[][]> = {
    drinks: [['pub', 'bar', 'wine_bar'], ['bar']],
    coffee: [['coffee_shop', 'cafe'], ['cafe']],
};

function json(body: unknown, status: number, cache: string): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
    });
}

interface Place {
    displayName?: { text?: string };
    primaryTypeDisplayName?: { text?: string };
    location?: { latitude: number; longitude: number };
    googleMapsUri?: string;
    businessStatus?: string;
    rating?: number;
    userRatingCount?: number;
    currentOpeningHours?: { openNow?: boolean; nextCloseTime?: string; nextOpenTime?: string };
    regularOpeningHours?: { periods?: Parameters<typeof weeklyHours>[0] };
    goodForGroups?: boolean;
    shortFormattedAddress?: string;
}

export function rankPlaces(places: Place[], stationId: string, limit = 8): ApiVenue[] {
    const st = STATIONS[stationId];
    const out: (ApiVenue & { score: number })[] = [];
    for (const p of places) {
        if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
        const name = cleanText(p.displayName?.text, 60);
        if (!name || !p.location) continue;
        // Walk from the nearest exit (TfL entrance positions), not the middle of the station.
        const exit = nearestExit(stationId, p.location.latitude, p.location.longitude);
        const walkMin = walkMinutes(exit.metres);
        const url = p.googleMapsUri && /^https:\/\/(maps\.google\.com|www\.google\.com\/maps|maps\.app\.goo\.gl)/.test(p.googleMapsUri)
            ? p.googleMapsUri
            : mapsSearchUrl(name, st.name);
        const v: ApiVenue = {
            name,
            type: cleanText(p.primaryTypeDisplayName?.text, 30) ?? 'Bar',
            walkMin,
            mapsUrl: url,
        };
        if (typeof p.rating === 'number') v.rating = Math.round(p.rating * 10) / 10;
        if (typeof p.userRatingCount === 'number') v.ratings = p.userRatingCount;
        const now = p.currentOpeningHours;
        if (now && typeof now.openNow === 'boolean') v.openNow = now.openNow;
        if (now?.nextCloseTime) v.nextClose = now.nextCloseTime;
        if (now?.nextOpenTime) v.nextOpen = now.nextOpenTime;
        if (p.goodForGroups === true) v.groups = true;
        if (exit.label) v.exit = exit.label;
        const street = streetFrom(cleanText(p.shortFormattedAddress, 80) ?? undefined);
        if (street) v.street = street;
        const week = weeklyHours(p.regularOpeningHours?.periods);
        if (week) v.hours = week;
        // Well reviewed and busy, but "right by the exit" matters: each walking minute costs about
        // what a step from 2,000 to 1,000 reviews does.
        const score = (v.rating ?? 3.6) * Math.log10((v.ratings ?? 0) + 10) + (v.groups ? 0.6 : 0) - walkMin * 0.35;
        out.push({ ...v, score });
    }
    // Anything closed right now goes after everything that is (or may be) open.
    const closed = (v: ApiVenue) => (v.openNow === false ? 1 : 0);
    return out
        .sort((a, b) => closed(a) - closed(b) || b.score - a.score)
        .slice(0, limit)
        .map(({ score: _s, ...v }) => v);
}

export async function fetchPlaces(stationId: string, kind: VenueKind, apiKey: string, fetchImpl: typeof fetch = fetch) {
    const st = STATIONS[stationId];
    const attempts = PLACE_TYPES[kind];
    for (let i = 0; i < attempts.length; i++) {
        const res = await fetchImpl('https://places.googleapis.com/v1/places:searchNearby', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': PLACES_FIELDS },
            body: JSON.stringify({
                includedPrimaryTypes: attempts[i],
                maxResultCount: 20,
                rankPreference: 'POPULARITY',
                languageCode: 'en-GB',
                regionCode: 'GB',
                locationRestriction: { circle: { center: { latitude: st.lat, longitude: st.lng }, radius: RADIUS_M } },
            }),
            signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
        });
        if (res.status === 400 && i < attempts.length - 1) continue;
        if (!res.ok) throw new Error(`Places ${res.status}`);
        const data = (await res.json()) as { places?: Place[] };
        return rankPlaces(data.places ?? [], stationId);
    }
    return [];
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
            signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
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
    const params = new URL(request.url).searchParams;
    const stationId = params.get('station') ?? '';
    const kind = (params.get('kind') ?? 'drinks') as VenueKind;
    if (!Object.hasOwn(STATIONS, stationId) || !Object.hasOwn(PLACE_TYPES, kind)) {
        return json({ error: 'unknown station or kind' }, 400, 'public, max-age=3600');
    }

    const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
    if (mapsKey) {
        try {
            const venues = await fetchPlaces(stationId, kind, mapsKey);
            const body: VenuesResponse = { source: 'google', venues };
            return json(body, 200, 'public, max-age=600, s-maxage=3600, stale-while-revalidate=600');
        } catch (err) {
            console.error('places lookup failed', stationId, kind, err instanceof Error ? err.message : err);
        }
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (kind !== 'drinks' || !geminiKey) {
        const body: VenuesResponse = { source: 'none', venues: [], reason: mapsKey ? 'upstream' : 'unconfigured' };
        return json(body, 200, 'public, s-maxage=300');
    }
    try {
        const st = STATIONS[stationId];
        const venues: ApiVenue[] = (await fetchVenues(stationId, geminiKey, process.env.GEMINI_MODEL || GEMINI_MODEL)).map((v) => ({
            name: v.name,
            type: 'Suggested',
            detail: v.detail,
            walkMin: parseInt(v.walk, 10) || 5,
            mapsUrl: mapsSearchUrl(v.name, st.name),
        }));
        const body: VenuesResponse = { source: 'ai', venues };
        return json(body, 200, 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    } catch (err) {
        console.error('venues lookup failed', stationId, err instanceof Error ? err.message : err);
        const body: VenuesResponse = { source: 'none', venues: [], reason: 'upstream' };
        return json(body, 200, 'public, s-maxage=300');
    }
}
