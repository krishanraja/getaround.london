import type { Venue } from './data';

// Shared between the browser and the /api/venues function: whatever Gemini
// returns is untrusted text, so it is reduced to this exact shape before use.

const MAX_NAME = 40;
const MAX_DETAIL = 90;

function clean(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const s = value.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

function cleanWalk(value: unknown): string | null {
    const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n < 1 || n > 10) return null;
    return `${Math.round(n)}m`;
}

/** Pulls the first JSON array out of model text (which may be fenced or chatty). */
export function extractJsonArray(text: string): unknown[] {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end <= start) return [];
    try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function sanitizeVenues(raw: unknown[], exclude: string[] = [], limit = 3): Venue[] {
    const seen = new Set(exclude.map((n) => n.toLowerCase()));
    const out: Venue[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        const name = clean(r.name, MAX_NAME);
        const detail = clean(r.detail, MAX_DETAIL);
        const walk = cleanWalk(r.walkMinutes ?? r.walk);
        if (!name || !detail || !walk) continue;
        if (seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        out.push({ name, detail, walk, source: 'ai' });
        if (out.length >= limit) break;
    }
    return out;
}

// ---------- live venues (shared shape between /api/venues and the app) ----------

export type VenueKind = 'drinks' | 'coffee';

/** In the order the tabs show them. */
export const VENUE_KINDS: VenueKind[] = ['drinks', 'coffee'];

export function isVenueKind(value: unknown): value is VenueKind {
    return typeof value === 'string' && (VENUE_KINDS as string[]).includes(value);
}

/** What people usually meet for at this London time: coffee (and a bite) through the day, a drink
 *  from five. */
export function kindForTime(minuteOfWeek: number): VenueKind {
    const hour = Math.floor((((minuteOfWeek % 1440) + 1440) % 1440) / 60);
    return hour >= 5 && hour < 17 ? 'coffee' : 'drinks';
}

export interface ApiVenue {
    name: string;
    /** "Pub", "Cocktail bar", "Café"… */
    type: string;
    walkMin: number;
    mapsUrl: string;
    rating?: number;
    ratings?: number;
    openNow?: boolean;
    /** ISO times; the client re-checks them so a cached response never claims a closed place is open. */
    nextClose?: string;
    nextOpen?: string;
    groups?: boolean;
    detail?: string;
    /** Nearest station exit, e.g. "north-west exit". */
    exit?: string;
    /** Street name, e.g. "Argyll St". */
    street?: string;
    /** Weekly opening ranges in London minutes-of-week (Sunday 00:00 = 0); a range may run past 10080. */
    hours?: [number, number][];
}

export interface VenuesResponse {
    source: 'google' | 'ai' | 'none';
    venues: ApiVenue[];
    reason?: string;
}

export function cleanText(value: unknown, max: number): string | null {
    return clean(value, max);
}

/** Straight-line metres to an approximate walk, rounded up (~80 m/min, 1.3 street factor). */
export function walkMinutes(metres: number): number {
    return Math.max(1, Math.ceil((metres * 1.3) / 80));
}

export function mapsSearchUrl(name: string, near: string): string {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, near ${near} station, London`)}`;
}

/** Open right now, given a possibly cached response. */
export function isOpenAt(v: ApiVenue, now = Date.now()): boolean | undefined {
    if (v.openNow === undefined) return undefined;
    if (v.openNow) return !(v.nextClose && Date.parse(v.nextClose) <= now);
    return !!(v.nextOpen && Date.parse(v.nextOpen) <= now);
}

export function londonTime(iso: string): string {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(
        new Date(iso),
    );
}

// ---------- weekly opening hours ----------

const WEEK = 7 * 1440;

interface PeriodPoint { day?: number; hour?: number; minute?: number }

/** Google's regularOpeningHours.periods → compact minute-of-week ranges. Open 24/7 has no close. */
export function weeklyHours(periods: { open?: PeriodPoint; close?: PeriodPoint }[] | undefined): [number, number][] | null {
    if (!Array.isArray(periods) || !periods.length) return null;
    const at = (p: PeriodPoint) => (p.day ?? 0) * 1440 + (p.hour ?? 0) * 60 + (p.minute ?? 0);
    const out: [number, number][] = [];
    for (const p of periods) {
        if (!p.open) continue;
        if (!p.close) return [[0, WEEK]];
        const o = at(p.open);
        let c = at(p.close);
        if (c <= o) c += WEEK;
        out.push([o, c]);
    }
    return out.length ? out : null;
}

/** Day of week and minutes past midnight in London for a moment. */
export function londonMinuteOfWeek(date: Date): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return day * 1440 + parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);
}

export function openAtMinute(v: ApiVenue, minute: number): boolean | undefined {
    if (!v.hours) return undefined;
    return v.hours.some(([o, c]) => (minute >= o && minute < c) || (minute + WEEK >= o && minute + WEEK < c));
}
