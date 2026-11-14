// POST /api/feedback  { message, email?, screen?, viewport?, website? }
//
// The feedback form in the app's header. The browser posts here, same origin, and holds no key and
// no database address. This function holds neither either: it validates the note, rate-limits the
// sender, and forwards the clean row server to server to a Control Center route, which stores it in
// public.product_feedback. The route and a bearer that allows only that one write live in two
// server environment variables, FEEDBACK_FORWARD_URL and FEEDBACK_FORWARD_BEARER, set in Vercel.
// Neither has a VITE_ prefix, so Vite never writes them into the public script, and
// scripts/check-secrets.ts fails the build if the built script names them.
//
// Unset, the form says it could not send (503) and nothing goes anywhere. `website` is a honeypot
// only bots fill in. Ruling (Krish, 2026-11-14): a server route that holds the key, no key in the
// browser, after the shared publishable key was revoked.

const MAX_BODY = 8000;
const MAX_MESSAGE = 1000;
const MAX_CONTACT = 120;
const SCREENS = new Set(['you', 'them', 'edit', 'add', 'result']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 5;

/** Plain text: no control characters or markup, at most one blank line in a row. */
export function cleanMessage(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const s = value
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return s || null;
}

/**
 * Fixed windows per client address: LIMIT notes per WINDOW_MS. Per function instance, so it is a
 * speed bump against a script hammering one warm instance, not a guarantee; the receiver and the
 * table's own checks bound what any row can hold.
 */
export function createLimiter(now: () => number = () => Date.now()): (ip: string) => boolean {
    const seen = new Map<string, { start: number; count: number }>();
    return (ip) => {
        const t = now();
        for (const [k, v] of seen) if (t - v.start > WINDOW_MS) seen.delete(k);
        const s = seen.get(ip) ?? { start: t, count: 0 };
        if (s.count >= LIMIT) return false;
        s.count += 1;
        seen.set(ip, s);
        return true;
    };
}

const defaultLimiter = createLimiter();

function reply(status: number, body?: unknown): Response {
    return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
}

/** Only the app itself may post: this deployment's own origin, or the live site. */
function sameSite(request: Request): boolean {
    const origin = request.headers.get('origin');
    if (!origin) return false;
    return origin === new URL(request.url).origin || origin === 'https://getaround.london';
}

function clientIp(request: Request): string {
    return (
        (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ||
        request.headers.get('x-real-ip') ||
        'unknown'
    );
}

export async function handleFeedback(
    request: Request,
    fetchImpl: typeof fetch = fetch,
    allow: (ip: string) => boolean = defaultLimiter,
): Promise<Response> {
    if (!sameSite(request)) return reply(403, { error: 'origin' });
    const raw = await request.text();
    if (raw.length > MAX_BODY) return reply(413, { error: 'too long' });
    let body: Record<string, unknown>;
    try {
        body = JSON.parse(raw);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    } catch {
        return reply(400, { error: 'json' });
    }
    // A bot filled the hidden field: say thanks, keep nothing.
    if (typeof body.website === 'string' && body.website.trim()) return reply(204);

    const message = cleanMessage(body.message);
    if (!message || message.length > MAX_MESSAGE) return reply(400, { error: 'message' });
    const contact = typeof body.email === 'string' ? body.email.trim() : '';
    if (contact && (contact.length > MAX_CONTACT || !EMAIL.test(contact))) return reply(400, { error: 'email' });
    const screen = typeof body.screen === 'string' && SCREENS.has(body.screen) ? body.screen : null;
    const viewport = typeof body.viewport === 'string' && /^\d{2,5}x\d{2,5}$/.test(body.viewport) ? body.viewport : null;

    if (!allow(clientIp(request))) return reply(429, { error: 'slow down' });

    const url = process.env.FEEDBACK_FORWARD_URL;
    const bearer = process.env.FEEDBACK_FORWARD_BEARER;
    if (!url || !bearer) {
        console.error('feedback not configured');
        return reply(503, { error: 'unconfigured' });
    }
    try {
        const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
            body: JSON.stringify({ site: 'getaround.london', message, contact: contact || null, screen, viewport }),
            signal: AbortSignal.timeout(6000),
        });
        // The status only. Never the body, which can echo the note.
        if (!res.ok) throw new Error(`refused ${res.status}`);
        return reply(204);
    } catch (err) {
        const reason = err instanceof Error && err.message.startsWith('refused') ? err.message : 'unreachable';
        console.error(`feedback forward ${reason}`);
        return reply(502, { error: 'upstream' });
    }
}

export function POST(request: Request): Promise<Response> {
    return handleFeedback(request);
}
