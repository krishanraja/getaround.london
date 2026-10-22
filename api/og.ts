import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { liveAvoid, summarisePlan, verifiedVenue } from '../src/share.js';

// GET /api/og?from=..&to=..[&and][&meet][&mode][&at] → 1200x630 PNG preview card for a plan.

type Style = Record<string, string | number>;
interface Node {
    type: string;
    props: { style?: Style; src?: string; width?: number; height?: number; children?: (Node | string)[] | Node | string };
}

const h = (type: string, style: Style, ...children: (Node | string | null | false)[]): Node => ({
    type,
    props: { style: { display: 'flex', ...style }, children: children.filter((c): c is Node | string => !!c) },
});

const fontCache = new Map<string, Promise<ArrayBuffer>>();
function font(origin: string, file: string): Promise<ArrayBuffer> {
    if (!fontCache.has(file)) {
        fontCache.set(
            file,
            fetch(`${origin}/fonts/${file}`).then((r) => {
                if (!r.ok) throw new Error(`font ${file} ${r.status}`);
                return r.arrayBuffer();
            }),
        );
    }
    return fontCache.get(file)!;
}

export async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const plan = summarisePlan(url.search, await liveAvoid(url.origin));
    if (!plan) return new Response('Unknown plan', { status: 400 });
    const [venue, inter400, inter700, outfit700] = await Promise.all([
        verifiedVenue(url.origin, plan.stationId, url.searchParams.get('at')),
        font(url.origin, 'inter-400.woff'),
        font(url.origin, 'inter-700.woff'),
        font(url.origin, 'outfit-700.woff'),
    ]);

    const nameSize = plan.stationName.length > 18 ? 76 : 96;
    const card = h(
        'div',
        { width: '100%', height: '100%', background: '#F2F2F7', padding: 40, fontFamily: 'Inter' },
        h(
            'div',
            { flex: 1, flexDirection: 'column', background: '#FFFFFF', borderRadius: 44, padding: '48px 60px', justifyContent: 'space-between' },
            h(
                'div',
                { flexDirection: 'column' },
                h('div', { fontSize: 26, fontWeight: 700, letterSpacing: 3, color: '#8E8E93' }, 'MEET AT'),
                h('div', { fontSize: nameSize, fontWeight: 700, letterSpacing: -2.5, color: '#1C1C1E', lineHeight: 1.05, marginTop: 6 }, plan.stationName),
                venue
                    ? h(
                          'div',
                          { fontSize: 40, color: '#3A3A3C', marginTop: 14 },
                          'then ',
                          h('span', { fontWeight: 700, color: '#1C1C1E', marginLeft: 12 }, venue),
                      )
                    : null,
                h(
                    'div',
                    { marginTop: 26, flexWrap: 'wrap' },
                    ...plan.people.map((p) =>
                        h(
                            'div',
                            { alignItems: 'center', background: '#F2F2F7', borderRadius: 999, padding: '10px 22px', marginRight: 14, marginBottom: 12, fontSize: 28, color: '#1C1C1E' },
                            h('span', { fontWeight: 700 }, p.name),
                            h('span', { color: '#6C6C70', marginLeft: 10 }, `${p.from} · ${p.minutes} min`),
                        ),
                    ),
                ),
            ),
            h(
                'div',
                { alignItems: 'center', justifyContent: 'space-between' },
                h(
                    'div',
                    { alignItems: 'center' },
                    { type: 'img', props: { src: `${url.origin}/mark-512.png`, width: 64, height: 64, style: { width: 64, height: 64 } } },
                    h(
                        'div',
                        { fontFamily: 'Outfit', fontSize: 40, fontWeight: 700, letterSpacing: -1, marginLeft: 14 },
                        h('span', { color: '#1C1C1E' }, 'getaround'),
                        h('span', { color: '#EB1B22', marginLeft: -1 }, '.london'),
                    ),
                ),
                h(
                    'div',
                    {},
                    ...plan.lines.slice(0, 3).map((l) =>
                        h(
                            'div',
                            { alignItems: 'center', marginLeft: 12, fontSize: 24, color: '#1C1C1E', background: '#F2F2F7', borderRadius: 999, padding: '6px 16px' },
                            h('div', { width: 14, height: 14, borderRadius: 999, background: l.color, marginRight: 10 }),
                            l.name,
                        ),
                    ),
                ),
            ),
        ),
    );

    const svg = await satori(card as never, {
        width: 1200,
        height: 630,
        fonts: [
            { name: 'Inter', data: inter400, weight: 400, style: 'normal' },
            { name: 'Inter', data: inter700, weight: 700, style: 'normal' },
            { name: 'Outfit', data: outfit700, weight: 700, style: 'normal' },
        ],
    });
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
    return new Response(png, {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=300, s-maxage=600' },
    });
}
