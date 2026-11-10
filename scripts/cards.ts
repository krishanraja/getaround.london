// Social cards for every generated page, drawn at build time with the same satori + resvg pipeline as /api/og.
// 1200x630 PNG, the size every network crops cleanly (Facebook, LinkedIn, X, WhatsApp, iMessage, Slack, Discord).
// The answer sits in the left two thirds at a size that still reads in a 300px-wide link preview; the right third
// carries the brand picture (two people's routes meeting at one interchange), so a square crop keeps the words.

import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Style = Record<string, string | number>;
interface Node {
    type: string;
    props: { style?: Style; src?: string; width?: number; height?: number; children?: (Node | string)[] | Node | string };
}
type Child = Node | string | null | false | undefined;

const h = (type: string, style: Style, ...children: Child[]): Node => ({
    type,
    props: { style: { display: 'flex', ...style }, children: children.filter((c): c is Node | string => !!c) },
});
const img = (src: string, w: number, ht: number, style: Style = {}): Node => ({
    type: 'img',
    props: { src, width: w, height: ht, style: { width: w, height: ht, ...style } },
});

const PUBLIC = join(process.cwd(), 'public');
const fonts = [
    { name: 'Inter', data: readFileSync(join(PUBLIC, 'fonts/inter-400.woff')), weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: readFileSync(join(PUBLIC, 'fonts/inter-700.woff')), weight: 700 as const, style: 'normal' as const },
    { name: 'Outfit', data: readFileSync(join(PUBLIC, 'fonts/outfit-700.woff')), weight: 700 as const, style: 'normal' as const },
];
const MARK = `data:image/png;base64,${readFileSync(join(PUBLIC, 'mark-512.png')).toString('base64')}`;

const INK = '#1C1C1E';
const MUTED = '#6C6C70';
const SOFT = '#F2F2F7';
const PINK = '#FE598A';
const YELLOW = '#FABD29';
const RED = '#EB1B22';

export interface CardLine { name: string; color: string }

export interface Card {
    /** Small caps line above the headline, e.g. "HALFWAY BETWEEN BRIXTON & CAMDEN TOWN". */
    eyebrow: string;
    /** Optional small lead-in before the headline, e.g. "Meet at". */
    lead?: string;
    headline: string;
    /** One plain sentence under the headline. */
    sub?: string;
    /** Up to three line pills along the bottom. */
    lines?: CardLine[];
    /** Minute labels for the pink and yellow routes in the picture; omitted draws the picture without labels. */
    minutes?: [string, string];
    /** Label under the interchange ring. */
    ringLabel?: string;
}

function headlineSize(text: string): number {
    const n = text.length;
    if (n <= 12) return 96;
    if (n <= 16) return 84;
    if (n <= 22) return 72;
    if (n <= 34) return 62;
    return 54;
}

// The picture: two routes (pink and yellow, the two people in the mark) curving into one red interchange ring.
// No bar through the ring: a ring on a bar reads as TfL's roundel, and we are not TfL. Drawn as SVG; the minute bubbles and label are satori text laid over it so they use the real fonts.
const PIC_W = 380;
const PIC_H = 420;
const RING = { x: 290, y: 210 };
const pictureSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PIC_W}" height="${PIC_H}" viewBox="0 0 ${PIC_W} ${PIC_H}">
<path d="M28 92 C 150 92, 170 205, ${RING.x} ${RING.y}" fill="none" stroke="${PINK}" stroke-width="9" stroke-linecap="round"/>
<path d="M28 328 C 150 328, 170 215, ${RING.x} ${RING.y}" fill="none" stroke="${YELLOW}" stroke-width="9" stroke-linecap="round"/>
<circle cx="28" cy="92" r="17" fill="${PINK}"/>
<circle cx="28" cy="328" r="17" fill="${YELLOW}"/>
<circle cx="${RING.x}" cy="${RING.y}" r="76" fill="#E7F6EA"/>
<circle cx="${RING.x}" cy="${RING.y}" r="34" fill="#fff" stroke="${RED}" stroke-width="12"/>
<circle cx="${RING.x}" cy="${RING.y}" r="9" fill="${INK}"/>
</svg>`;
const PICTURE = `data:image/svg+xml;base64,${Buffer.from(pictureSvg).toString('base64')}`;

const bubble = (text: string, left: number, top: number) =>
    h(
        'div',
        { position: 'absolute', left, top, background: SOFT, borderRadius: 999, padding: '8px 18px', fontSize: 28, fontWeight: 700, color: INK },
        text,
    );

function picture(c: Card): Node {
    return h(
        'div',
        { position: 'relative', width: PIC_W, height: PIC_H, flexShrink: 0 },
        img(PICTURE, PIC_W, PIC_H),
        c.minutes ? bubble(c.minutes[0], 92, 104) : null,
        c.minutes ? bubble(c.minutes[1], 92, 262) : null,
        h(
            'div',
            { position: 'absolute', left: RING.x - 110, top: RING.y + 86, width: 220, justifyContent: 'center', fontSize: 24, fontWeight: 700, letterSpacing: 3, color: INK },
            c.ringLabel ?? 'MEET',
        ),
    );
}

function tree(c: Card): Node {
    const size = headlineSize(c.headline);
    return h(
        'div',
        { width: '100%', height: '100%', background: SOFT, padding: 36, fontFamily: 'Inter' },
        h(
            'div',
            { flex: 1, background: '#FFFFFF', borderRadius: 44, padding: '44px 40px 44px 60px', alignItems: 'center' },
            h(
                'div',
                { flexDirection: 'column', flex: 1, height: '100%', justifyContent: 'space-between', paddingRight: 16 },
                h(
                    'div',
                    { alignItems: 'center' },
                    img(MARK, 52, 52),
                    h(
                        'div',
                        { fontFamily: 'Outfit', fontSize: 36, fontWeight: 700, letterSpacing: -1, marginLeft: 12 },
                        h('span', { color: INK }, 'getaround'),
                        h('span', { color: RED }, '.london'),
                    ),
                ),
                h(
                    'div',
                    { flexDirection: 'column' },
                    h('div', { fontSize: 22, fontWeight: 700, letterSpacing: c.eyebrow.length > 34 ? 1.5 : 2.5, color: '#8E8E93', lineHeight: 1.3 }, c.eyebrow.toUpperCase()),
                    c.lead ? h('div', { fontSize: 38, color: '#3A3A3C', marginTop: 10 }, c.lead) : null,
                    h('div', { fontSize: size, fontWeight: 700, letterSpacing: size > 70 ? -2.5 : -1.5, color: INK, lineHeight: 1.04, marginTop: c.lead ? 2 : 10 }, c.headline),
                    c.sub ? h('div', { fontSize: 28, color: MUTED, lineHeight: 1.35, marginTop: 16 }, c.sub) : null,
                ),
                h(
                    'div',
                    { minHeight: 44 },
                    ...(c.lines ?? []).slice(0, 3).map((l) =>
                        h(
                            'div',
                            { alignItems: 'center', marginRight: 12, fontSize: 22, color: INK, background: SOFT, borderRadius: 999, padding: '8px 18px' },
                            h('div', { width: 14, height: 14, borderRadius: 999, background: l.color, marginRight: 10 }),
                            l.name,
                        ),
                    ),
                ),
            ),
            picture(c),
        ),
    );
}

export async function renderCard(c: Card): Promise<Buffer> {
    const svg = await satori(tree(c) as never, { width: 1200, height: 630, fonts });
    return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}
