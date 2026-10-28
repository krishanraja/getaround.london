// POST /api/feedback  { message, email?, screen?, viewport?, website? }
//
// The feedback form in the app's header. Each note becomes one row in Supabase
// (public.product_feedback, Mindmaker OS) through the submit_product_feedback function, called with
// the publishable key: the table itself is closed to that key, so the only thing it can do is add
// one checked row. No service-role key is used here. `website` is a honeypot only bots fill in.

const MAX_BODY = 8000;
const MAX_MESSAGE = 1000;
const MAX_CONTACT = 120;
const SCREENS = new Set(['you', 'them', 'edit', 'add', 'result']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export async function handleFeedback(request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
    if (!sameSite(request)) return reply(403, { error: 'origin' });
    const raw = await request.text();
    if (raw.length > MAX_BODY) return reply(413, { error: 'too long' });
    let body: Record<string, unknown>;
    try {
        body = JSON.parse(raw);
        if (!body || typeof body !== 'object') throw new Error('not an object');
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

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
        console.error('feedback not configured');
        return reply(503, { error: 'unconfigured' });
    }
    try {
        const res = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1/rpc/submit_product_feedback`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', apikey: key },
            body: JSON.stringify({ p_message: message, p_contact: contact || null, p_screen: screen, p_viewport: viewport }),
            signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) throw new Error(`Supabase ${res.status}`);
        return reply(204);
    } catch (err) {
        console.error('feedback save failed', err instanceof Error ? err.message : err);
        return reply(502, { error: 'upstream' });
    }
}

export function POST(request: Request): Promise<Response> {
    return handleFeedback(request);
}
