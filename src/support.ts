// The one-off donation note. It shows once, on the second visit or later, and only ever reads or
// writes a visit count and two flags on this device. Storage can be missing or blocked (private
// windows, strict settings): then nothing is counted and the note never shows.

/** Stripe Payment Link where people choose their own amount. Empty keeps the note hidden. */
export const DONATE_URL = 'https://buy.stripe.com/6oUaEX3Zv2IsfNz9iAak000';

const VISITS = 'ga:visits';
const SHOWN = 'ga:donate-shown';
const COUNTED = 'ga:visit-counted';

function read(store: () => Storage, key: string): string | null {
    try {
        return store().getItem(key);
    } catch {
        return null;
    }
}

function write(store: () => Storage, key: string, value: string): boolean {
    try {
        store().setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

/** Counts this visit once per tab (reloads and screen changes are the same visit). Returns the count,
 *  or 0 when the device will not remember it. */
export function countVisit(): number {
    const visits = parseInt(read(local, VISITS) ?? '0', 10) || 0;
    if (read(session, COUNTED)) return visits;
    const next = visits + 1;
    if (!write(local, VISITS, String(next))) return 0;
    write(session, COUNTED, '1');
    return next;
}

/** Second visit or later, a link to give to, and never shown before. */
export function shouldAskForSupport(visits: number): boolean {
    return !!DONATE_URL && visits >= 2 && !read(local, SHOWN);
}

/** Once it has been on screen it never comes back. */
export function markSupportShown() {
    write(local, SHOWN, '1');
}
