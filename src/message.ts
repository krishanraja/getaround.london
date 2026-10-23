import { STATIONS, TFL_LINES, lineLabel } from './data.js';
import { originLine, type Route } from './routing.js';

// The plan as a message the sender pastes into WhatsApp, written for the friend reading it: their
// route first, the sender's second, one link at the end (WhatsApp turns it into the plan's card).
// *asterisks* are WhatsApp bold; plainMessage() drops them for other apps.

export interface MessagePerson {
    /** "Me" for the sender; a name for anyone else. */
    name: string;
    isSender: boolean;
    /** A station id, or line:<id> for "anywhere on that line". */
    origin: string;
    route: Route;
}

export interface MessageVenue {
    name: string;
    type?: string;
    walkMin: number;
    exit?: string;
    street?: string;
}

export interface MessageInput {
    station: string;
    people: MessagePerson[];
    venue?: MessageVenue | null;
    /** e.g. "minor delays on the Victoria line" */
    issues?: string[];
    /** e.g. "the Piccadilly line (part suspended)" */
    avoided?: string[];
    link: string;
}

const nameOf = (id: string) => STATIONS[id]?.name ?? id;
/** "the Victoria line", but just "West Midlands Trains" for a rail operator. */
const theLine = (id: string) => (TFL_LINES[id]?.mode === 'national-rail' ? lineLabel(id) : `the ${lineLabel(id)}`);

/** One line on how someone gets there: "Mildmay line from Caledonian Road & Barnsbury, change at
 *  Highbury & Islington for the Victoria line". */
export function routeSentence(origin: string, route: Route, station: string): string {
    const startLine = originLine(origin);
    if (route.minutes === 0) return startLine ? `Ride the ${lineLabel(startLine)} to ${station}` : 'Already there';
    const legs = route.legs ?? [];
    if (!legs.length) return lineLabel(route.lines[0]);

    const parts: string[] = [];
    const first = legs[0];
    const ridingOwnLine = startLine && first.line === startLine;
    if (!startLine) parts.push(`${lineLabel(first.line)} from ${nameOf(first.from)}`);
    else if (ridingOwnLine) parts.push(`${lineLabel(first.line)} to ${nameOf(first.to)}`);
    else parts.push(`Head to ${nameOf(first.from)} on the ${lineLabel(startLine)}, then ${theLine(first.line)}`);

    for (let i = 1; i < legs.length; i++) {
        const leg = legs[i];
        const walked = leg.from !== legs[i - 1].to;
        if (walked) parts.push(`walk to ${nameOf(leg.from)} for ${theLine(leg.line)}`);
        else if (i === 1 && ridingOwnLine) parts.push(`then ${theLine(leg.line)}`);
        else parts.push(`change at ${nameOf(leg.from)} for ${theLine(leg.line)}`);
    }
    return parts.join(', ');
}

export function planMessage({ station, people, venue, issues = [], avoided = [], link }: MessageInput): string {
    const sender = people.find((p) => p.isSender);
    const others = people.filter((p) => !p.isSender);
    const pair = sender && others.length === 1 ? others[0] : null;
    const out: string[] = [];

    if (pair) {
        const you = pair.route.minutes;
        const me = sender!.route.minutes;
        // Zero minutes means the meeting point is their station, or on the line they are already on.
        const yoursAlready = originLine(pair.origin) ? 'right on your line' : 'your station';
        const mineAlready = originLine(sender!.origin) ? 'right on my line' : 'my station';
        const times =
            you === 0 && me === 0
                ? "It's right on both our routes."
                : you === 0
                  ? `It's ${yoursAlready}, and about ${me} min for me.`
                  : me === 0
                    ? `It's about ${you} min for you, and ${mineAlready}.`
                    : you === me
                      ? `It's about ${you} min for each of us.`
                      : `It's about ${you} min for you and ${me} min for me.`;
        out.push(`Shall we meet at *${station}*? ${times}`, '');
        out.push(`*Your way:* ${routeSentence(pair.origin, pair.route, station)}.`);
        out.push(`*Mine:* ${routeSentence(sender!.origin, sender!.route, station)}.`);
    } else {
        const times = people.map((p) => p.route.minutes);
        const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
        out.push(`Shall we meet at *${station}*? It's about ${avg} min each, ${Math.max(...times)} at most.`, '');
        for (const p of people) {
            const how = routeSentence(p.origin, p.route, station);
            out.push(`*${p.name}:* ${how}${p.route.minutes ? ` (${p.route.minutes} min)` : ''}.`);
        }
    }

    if (venue) {
        const from = venue.exit ? `the ${venue.exit}` : 'the station';
        out.push(
            '',
            `Then *${venue.name}*${venue.type ? ` (${venue.type.toLowerCase()})` : ''}, a ${venue.walkMin} min walk from ${from}${venue.street ? `, on ${venue.street}` : ''}.`,
        );
    }
    const notes = [
        ...issues.map((i) => `Heads up: ${i}.`),
        ...(avoided.length ? [`This avoids ${avoided.join(' and ')}.`] : []),
    ];
    if (notes.length) out.push('', ...notes);
    out.push('', `Plan and directions: ${link}`);
    return out.join('\n');
}

/** The same message for apps without WhatsApp's *bold*. */
export function plainMessage(message: string): string {
    return message.replace(/\*/g, '');
}
