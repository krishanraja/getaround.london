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
