// The getaround.london mark: two people, the hero, standing on a tube line with one interchange
// where they meet. Draws it as SVG and writes every icon size the site uses into public/.
// Run: npx tsx scripts/build-icons.ts [--drive <out.png>]
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';

const C = { pink: '#FE598A', yellow: '#FABD29', blue: '#0046A0', red: '#EB1B22' };

// A person: a round head sitting on a map-pin body that points down at the line.
function person(cx: number, headY: number, color: string): string {
    const R = 78;
    const cy = headY + 140;
    const tipY = cy + 134;
    const t = Math.acos(R / (tipY - cy));
    const lx = cx - R * Math.sin(t);
    const rx = cx + R * Math.sin(t);
    const ly = cy + R * Math.cos(t);
    const body = `M ${cx} ${tipY} L ${lx.toFixed(1)} ${ly.toFixed(1)} A ${R} ${R} 0 1 1 ${rx.toFixed(1)} ${ly.toFixed(1)} Z`;
    return `<path d="${body}" fill="${color}" stroke="#fff" stroke-width="14" stroke-linejoin="round"/><circle cx="${cx}" cy="${headY}" r="62" fill="${color}" stroke="#fff" stroke-width="14"/>`;
}

/** The mark on a 512 grid; `scale` shrinks it about the centre (for Android's maskable safe zone). */
export function markSvg({ background, scale = 1 }: { background?: string; scale?: number } = {}): string {
    const lineY = 362;
    const art = `<rect x="20" y="${lineY - 22}" width="472" height="44" rx="22" fill="${C.blue}"/>${person(158, 148, C.pink)}${person(354, 148, C.yellow)}<circle cx="256" cy="${lineY}" r="30" fill="#fff" stroke="${C.red}" stroke-width="13"/>`;
    const shift = (256 * (1 - scale)).toFixed(2);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${background ? `<rect width="512" height="512" fill="${background}"/>` : ''}<g transform="translate(${shift} ${shift}) scale(${scale})">${art}</g></svg>`;
}

const png = (svg: string, size: number) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

/** An .ico holding PNG images (supported by every current browser). */
function ico(images: { size: number; data: Buffer }[]): Buffer {
    const header = Buffer.alloc(6 + 16 * images.length);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);
    let offset = header.length;
    images.forEach(({ size, data }, i) => {
        const e = 6 + 16 * i;
        header.writeUInt8(size >= 256 ? 0 : size, e);
        header.writeUInt8(size >= 256 ? 0 : size, e + 1);
        header.writeUInt16LE(1, e + 4);
        header.writeUInt16LE(32, e + 6);
        header.writeUInt32LE(data.length, e + 8);
        header.writeUInt32LE(offset, e + 12);
        offset += data.length;
    });
    return Buffer.concat([header, ...images.map((i) => i.data)]);
}

const out = (file: string, data: Buffer | string) => writeFileSync(`public/${file}`, data);
const onWhite = markSvg({ background: '#FFFFFF' });

out('mark.svg', markSvg());
out('mark-512.png', png(markSvg(), 512));
out('mark-96.png', png(markSvg(), 96));
out('icon-512.png', png(onWhite, 512));
out('icon-192.png', png(onWhite, 192));
out('apple-touch-icon.png', png(onWhite, 180));
// Android crops maskable icons to a circle of 80% width: keep the line's ends inside it.
out('icon-maskable-512.png', png(markSvg({ background: '#FFFFFF', scale: 0.74 }), 512));
out('favicon-32.png', png(markSvg(), 32));
out('favicon-16.png', png(markSvg(), 16));
out('favicon.ico', ico([16, 32, 48].map((size) => ({ size, data: png(markSvg(), size) }))));

const drive = process.argv.indexOf('--drive');
if (drive > -1) writeFileSync(process.argv[drive + 1], png(onWhite, 1254));
console.log('icons written to public/');
