// Fails when a key-shaped string sits in a tracked file, or when the built browser script names a
// server-only variable or a database address. This repository is public: a key committed here is
// a key published.
//
//   npx tsx scripts/check-secrets.ts          scan every tracked file
//   npx tsx scripts/check-secrets.ts --dist   also scan dist/ (run after the build)
//
// It prints the file, the line and the kind of match, never the matched text.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHAPES: [string, RegExp][] = [
    ['Supabase publishable key', /sb_publishable_[A-Za-z0-9_-]{20,}/],
    ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{20,}/],
    ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
    ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
    ['Stripe live key', /(?:sk|rk)_live_[0-9A-Za-z]{16,}/],
    ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
    ['Slack token', /xox[abprs]-[A-Za-z0-9-]{10,}/],
    ['AWS access key', /AKIA[0-9A-Z]{16}/],
    ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['Supabase project address', /[a-z]{20}\.supabase\.co/],
];

// Only the browser bundle: server-only names must never reach it.
const DIST_ONLY: [string, RegExp][] = [
    ['server variable name', /FEEDBACK_FORWARD_(?:URL|BEARER)|SUPABASE_(?:URL|PUBLISHABLE_KEY|SERVICE_ROLE)|GEMINI_API_KEY|GOOGLE_MAPS_API_KEY/],
    ['database address', /\.supabase\.co/],
];

export function findSecrets(text: string, shapes: [string, RegExp][] = SHAPES): { line: number; kind: string }[] {
    const hits: { line: number; kind: string }[] = [];
    text.split('\n').forEach((l, i) => {
        for (const [kind, re] of shapes) if (re.test(l)) hits.push({ line: i + 1, kind });
    });
    return hits;
}

function isBinary(buf: Buffer): boolean {
    return buf.subarray(0, 8000).includes(0);
}

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

function main(): void {
    const root = resolve(fileURLToPath(import.meta.url), '../..');
    const problems: string[] = [];
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const f of tracked) {
        const p = join(root, f);
        if (!existsSync(p)) continue;
        const buf = readFileSync(p);
        if (isBinary(buf)) continue;
        for (const h of findSecrets(buf.toString('utf8'))) problems.push(`${f}:${h.line} ${h.kind}`);
    }
    if (process.argv.includes('--dist')) {
        const dist = join(root, 'dist');
        if (!existsSync(dist)) {
            console.error('check-secrets: dist/ not found; run the build first');
            process.exit(1);
        }
        for (const p of walk(dist)) {
            if (!/\.(js|html|css|json|txt|xml|webmanifest)$/.test(p)) continue;
            const text = readFileSync(p, 'utf8');
            for (const h of findSecrets(text, [...SHAPES, ...DIST_ONLY])) problems.push(`${relative(root, p)}:${h.line} ${h.kind}`);
        }
    }
    if (problems.length) {
        console.error(`check-secrets: ${problems.length} key-shaped string(s) found (values not shown):`);
        for (const p of problems) console.error(`  ${p}`);
        process.exit(1);
    }
    console.log(`check-secrets: clean (${tracked.length} tracked files${process.argv.includes('--dist') ? ' and dist/' : ''})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
