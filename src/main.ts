import './style.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/outfit/700.css';
import { initViewport } from './viewport';
import { STATIONS, TFL_LINES, type Station } from './data';
import {
    isValidOrigin,
    lineOrigin,
    nearestStation,
    originLine,
    originLines,
    avoidFromIssues,
    rankStations,
    type Journey,
    type Mode,
    type Person,
    type Ranked,
} from './routing';
import { SITE, parseOriginSlug, parsePlan, planPath, stationSlug } from './links';
import {
    isOpenAt,
    londonMinuteOfWeek,
    londonTime,
    mapsSearchUrl,
    openAtMinute,
    type ApiVenue,
    type VenueKind,
    type VenuesResponse,
} from './venues';

// ---------- state ----------

type View = 'you' | 'them' | 'edit' | 'add' | 'result';

interface Traveller {
    id: string;
    name: string;
    origin: string | null;
}

interface State {
    view: View;
    travellers: Traveller[];
    editing: string;
    mode: Mode;
    overrideStationId: string | null;
    pickerLine: string | null;
    kind: VenueKind;
    selectedVenue: string | null;
    /** Venue name from a shared link, picked once the list loads. */
    wantedVenue: string | null;
    /** "Open at" time as a London minute-of-week; null means now. */
    openAt: number | null;
}

const MAX_TRAVELLERS = 4; // the most that fits one small screen without scrolling
const MAX_GPS_DISTANCE_M = 15000;

function freshState(): State {
    return {
        view: 'you',
        travellers: [
            { id: 'you', name: 'You', origin: null },
            { id: 't1', name: 'Friend', origin: null },
        ],
        editing: 'you',
        mode: 'fair',
        overrideStationId: null,
        pickerLine: null,
        kind: 'drinks',
        selectedVenue: null,
        wantedVenue: null,
        openAt: null,
    };
}

let state: State = freshState();
let nearbyHint: { stationId: string; metres: number } | null = null;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const you = () => state.travellers[0];
const traveller = (id: string) => state.travellers.find((t) => t.id === id);
const isYou = (id: string) => id === 'you';
const ready = () => state.travellers.every((t) => !!t.origin);

// ---------- ranking ----------

function people(): Person[] {
    return state.travellers.map((t) => ({ id: t.id, name: t.name, station: t.origin!, isUser: isYou(t.id) }));
}

/** Ranked meeting points that route around suspended lines (softened if that strands someone). */
function currentPick(): { ranked: Ranked[]; current: Ranked } {
    let ranked = rankStations(people(), state.mode, avoidFromIssues(lineIssues));
    if (!ranked.length) ranked = rankStations(people(), state.mode, avoidFromIssues(lineIssues, true));
    const current = (state.overrideStationId && ranked.find((r) => r.stationId === state.overrideStationId)) || ranked[0];
    return { ranked, current };
}

/** "Routed around the Piccadilly line (part suspended)" when live disruption changed the plan. */
function routedAroundNote(current: Ranked): string | null {
    const avoided = Object.keys(avoidFromIssues(lineIssues));
    if (!avoided.length) return null;
    const plain = rankStations(people(), state.mode);
    const before = (state.overrideStationId && plain.find((r) => r.stationId === state.overrideStationId)) || plain[0];
    const usedBefore = new Set(before.journeys.flatMap((j) => j.route.lines));
    const usedNow = new Set(current.journeys.flatMap((j) => j.route.lines));
    const lines = avoided.filter((l) => usedBefore.has(l) && !usedNow.has(l));
    if (!lines.length) return null;
    return `Routed around ${lines.map((l) => `the ${TFL_LINES[l].name} line (${lineIssues[l].text.toLowerCase()})`).join(' and ')}`;
}

// ---------- live data ----------

const venueCache = new Map<string, VenuesResponse | 'loading' | 'failed'>();
let lineIssues: Record<string, { severity: number; text: string }> = {};
let statusRequested = false;

function requestVenues(stationId: string, kind: VenueKind) {
    const key = `${stationId}|${kind}`;
    if (venueCache.has(key)) return;
    venueCache.set(key, 'loading');
    fetch(`/api/venues?station=${encodeURIComponent(stationId)}&kind=${kind}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((body: VenuesResponse) => venueCache.set(key, body))
        .catch(() => venueCache.set(key, 'failed'))
        .finally(() => {
            if (state.view === 'result' && currentPick().current.stationId === stationId) renderResult();
        });
}

function requestStatus() {
    if (statusRequested) return;
    statusRequested = true;
    fetch('/api/status')
        .then((r) => r.json())
        .then((body: { lines?: typeof lineIssues }) => {
            lineIssues = body.lines ?? {};
            if (state.view === 'result') renderResult();
        })
        .catch(() => {});
}

interface ShownVenue {
    id: string;
    name: string;
    meta: string;
    walkMin: number;
    mapsUrl: string;
    open?: boolean;
    live: boolean;
    type?: string;
    exit?: string;
    street?: string;
}

function walkFromCurated(walk: string): number {
    return parseInt(walk, 10) || 3;
}

let liveKnown: boolean | null = null;
function liveSupported(): boolean {
    if (liveKnown !== null) return liveKnown;
    for (const v of venueCache.values()) {
        if (typeof v === 'object') {
            liveKnown = v.source === 'google';
            return liveKnown;
        }
    }
    return false;
}

const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });

const clock = (minuteOfWeek: number) => {
    const m = ((minuteOfWeek % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

function fromApi(v: ApiVenue, live: boolean): ShownVenue {
    const parts = [v.type];
    if (v.rating) parts.push(`★ ${v.rating.toFixed(1)}${v.ratings ? ` (${compact.format(v.ratings)})` : ''}`);
    let open: boolean | undefined;
    if (state.openAt !== null) {
        open = openAtMinute(v, state.openAt);
        if (open !== undefined) parts.push(`${open ? 'Open' : 'Closed'} at ${clock(state.openAt)}`);
    } else {
        open = isOpenAt(v);
        if (open === true) parts.push(v.nextClose ? `Open till ${londonTime(v.nextClose)}` : 'Open now');
        if (open === false) parts.push(v.nextOpen ? `Closed, opens ${londonTime(v.nextOpen)}` : 'Closed now');
    }
    if (v.groups) parts.push('Good for groups');
    if (!live && v.detail) parts.push(v.detail);
    return {
        id: `a:${v.name}`,
        name: v.name,
        meta: parts.join(' · '),
        walkMin: v.walkMin,
        mapsUrl: v.mapsUrl,
        open,
        live,
        type: v.type,
        exit: v.exit,
        street: v.street,
    };
}

/** "3 min from the north-west exit, Argyll St" or "3 min walk". */
function walkText(v: ShownVenue): string {
    // Non-breaking hyphen so "north-west" never splits across lines.
    const where = v.exit ? `from the ${v.exit.replace(/-/g, '\u2011')}` : 'walk';
    return `${v.walkMin} min ${where}${v.street ? `, ${v.street}` : ''}`;
}

/** Live Google data when we have it; otherwise our own picks plus AI suggestions. */
function venuesFor(stationId: string): { venues: ShownVenue[]; loading: boolean; live: boolean } {
    const st = STATIONS[stationId];
    const res = venueCache.get(`${stationId}|${state.kind}`);
    const loading = res === 'loading' || res === undefined;
    if (res && typeof res === 'object' && res.source === 'google' && res.venues.length) {
        const venues = res.venues.map((v) => fromApi(v, true));
        // For a later time, places open then come first.
        if (state.openAt !== null) venues.sort((a, b) => (a.open === false ? 1 : 0) - (b.open === false ? 1 : 0));
        return { venues, loading: false, live: true };
    }
    const curated: ShownVenue[] =
        state.kind === 'drinks' || !liveSupported()
            ? (st.venues || []).map((v) => ({
                  id: `c:${v.name}`,
                  name: v.name,
                  meta: v.detail,
                  walkMin: walkFromCurated(v.walk),
                  mapsUrl: mapsSearchUrl(v.name, st.name),
                  live: false,
              }))
            : [];
    const ai = res && typeof res === 'object' && res.source === 'ai' ? res.venues.map((v) => fromApi(v, false)) : [];
    return { venues: [...curated, ...ai], loading, live: false };
}

// ---------- text helpers ----------

function linesText(lines: string[]): string {
    return lines.map((l) => TFL_LINES[l].name).join(' then ');
}

function routeText(t: Traveller, j: Journey): string {
    const line = originLine(t.origin!);
    const yours = isYou(t.id);
    if (j.route.minutes === 0) {
        if (line) return `It's on ${yours ? 'your' : 'their'} ${TFL_LINES[line].name} line`;
        return yours ? "You're already there" : "They're already there";
    }
    const changes = j.route.transfers === 0 ? 'direct' : `${j.route.transfers} change${j.route.transfers === 1 ? '' : 's'}`;
    if (line && j.route.board) {
        const board = STATIONS[j.route.board].name;
        const [first, ...rest] = j.route.lines;
        if (first === line) {
            return `Take the ${TFL_LINES[line].name} line from ${board}${rest.length ? `, then the ${linesText(rest)} line` : ''}`;
        }
        return `Head to ${board} on the ${TFL_LINES[line].name} line, then the ${linesText(j.route.lines)} line`;
    }
    return `${linesText(j.route.lines)} line, ${changes}`;
}

function originLabel(origin: string): string {
    const line = originLine(origin);
    return line ? `anywhere on the ${TFL_LINES[line].name} line` : STATIONS[origin].name;
}

// ---------- view switching ----------

function show(view: View) {
    state.view = view;
    const isResult = view === 'result';
    $('stepView').classList.toggle('hidden', isResult);
    $('resultView').classList.toggle('hidden', !isResult);
    const started = state.travellers.some((t) => t.origin) || state.travellers.length > 2;
    $('restartBtn').classList.toggle('hidden', !started);
    $('restartBtn').classList.toggle('inline-flex', started);
    if (isResult) {
        requestStatus();
        renderResult();
    } else {
        state.pickerLine = null;
        $<HTMLInputElement>('searchInput').value = '';
        $<HTMLInputElement>('nameInput').value = '';
        fitStep();
    }
}

function restart() {
    state = freshState();
    history.replaceState(null, '', '/');
    show('you');
    showToast('Starting again');
}

// ---------- step view (one question per screen) ----------

function pickTarget(): { id: string; name: string; isYou: boolean } {
    if (state.view === 'you') return { id: 'you', name: 'You', isYou: true };
    if (state.view === 'them') return { id: 't1', name: 'Friend', isYou: false };
    if (state.view === 'add') return { id: 'new', name: 'them', isYou: false };
    const t = traveller(state.editing)!;
    return { id: t.id, name: t.name, isYou: isYou(t.id) };
}

function renderStep() {
    const target = pickTarget();
    const v = state.view;
    for (const id of ['stepFooter', 'stepHint', 'locateBtn']) $(id).classList.remove('hidden');
    $('stepKicker').parentElement!.classList.remove('hidden');
    $('stepView').classList.remove('compact');
    $('stepKicker').textContent =
        v === 'you' ? 'Step 1 of 2' : v === 'them' ? 'Step 2 of 2' : v === 'add' ? 'Add someone' : 'Change a start point';
    $('stepTitle').textContent = target.isYou
        ? 'Where are you?'
        : v === 'edit' && target.name !== 'Friend'
          ? `Where is ${target.name}?`
          : 'Where are they?';
    $('stepHint').textContent = target.isYou
        ? 'Your nearest station. Or a whole line, if any stop on it works for you.'
        : 'Their nearest station. Or a whole line, if any stop on it works for them.';
    $('stepBack').classList.toggle('hidden', v === 'you');
    $('nameField').classList.toggle('hidden', v !== 'add');
    $('locateBtn').classList.toggle('hidden', !target.isYou);
    $('locateLabel').textContent = nearbyHint
        ? `Use ${STATIONS[nearbyHint.stationId].name}, nearest to you`
        : 'Use my location';
    $('stepFooter').classList.toggle('hidden', v !== 'you' && v !== 'them');
    renderPicker();
}

function currentOrigin(): string | null {
    const t = pickTarget();
    return t.id === 'new' ? null : traveller(t.id)?.origin ?? null;
}

const chip = (attrs: string, label: string, on = false) =>
    `<button type="button" ${attrs} class="px-3 py-1.5 rounded-full text-[14px] font-medium transition ${
        on ? 'bg-[#007AFF] text-white' : 'bg-white text-[#1C1C1E] ios-shadow'
    }">${label}</button>`;

let pickerTrimmed = false;

/** Renders the picker, moving trailing chips/rows behind a "+N more" note until it fits. */
function renderPicker() {
    const area = $('pickArea');
    const query = $<HTMLInputElement>('searchInput').value.trim().toLowerCase();
    const current = currentOrigin();
    const target = pickTarget();

    type Part = { head: string; items: string[]; tail: (hidden: number) => string; wrap: (inner: string) => string };
    let part: Part;

    if (query) {
        const matches = Object.values(STATIONS)
            .filter((st) => st.name.toLowerCase().includes(query))
            .sort((a, b) => {
                const ap = a.name.toLowerCase().startsWith(query) ? 0 : 1;
                const bp = b.name.toLowerCase().startsWith(query) ? 0 : 1;
                return ap - bp || a.name.localeCompare(b.name);
            });
        if (!matches.length) {
            pickerTrimmed = false;
            area.innerHTML = `<div id="pickInner"><p class="pt-2 text-[15px] text-[#6C6C70]">No station matches “${esc(query)}”. We cover 31 central and inner London stations for now.</p></div>`;
            return;
        }
        part = {
            head: '',
            items: matches.map((st) => stationRow(st, st.id === current)),
            tail: (n) => (n ? `<p class="px-4 py-2.5 text-[13px] text-[#6C6C70]">${n} more. Keep typing to narrow it down.</p>` : ''),
            wrap: (inner) => `<div class="bg-white rounded-[18px] ios-shadow divide-y divide-black/[0.05] overflow-hidden">${inner}</div>`,
        };
    } else if (!state.pickerLine) {
        part = {
            head: `<p class="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#8E8E93]">Or pick a line</p>`,
            items: Object.values(TFL_LINES).map(
                (l) => `<button type="button" data-action="pick-line" data-line="${l.id}" class="px-3 py-1.5 rounded-full bg-white ios-shadow text-[14px] font-medium text-[#1C1C1E] inline-flex items-center gap-1.5">
                    <span class="w-2.5 h-2.5 rounded-full" style="background:${l.color}"></span>${l.name}</button>`,
            ),
            tail: (n) => (n ? `<span class="self-center text-[13px] text-[#6C6C70]">+${n} more lines</span>` : ''),
            wrap: (inner) => `<div class="flex flex-wrap gap-2">${inner}</div>`,
        };
    } else {
        const line = TFL_LINES[state.pickerLine];
        const origin = lineOrigin(line.id);
        const stops = Object.values(STATIONS)
            .filter((st) => st.lines.includes(line.id))
            .sort((a, b) => a.name.localeCompare(b.name));
        const whoAny = target.isYou ? 'Any stop works for you.' : 'Any stop works for them.';
        const on = origin === current;
        part = {
            head: `
                <button type="button" data-action="pick-line" data-line="" class="mb-2 text-[14px] font-medium text-[#007AFF]">‹ All lines</button>
                <button type="button" data-action="choose" data-origin="${origin}" class="w-full text-left rounded-[18px] px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition ${
                    on ? 'bg-[#007AFF] text-white' : 'bg-white ios-shadow'
                }">
                    <span class="w-3.5 h-3.5 rounded-full shrink-0 ring-2 ring-white" style="background:${line.color}"></span>
                    <span class="min-w-0">
                        <span class="block text-[16px] font-semibold">Anywhere on the ${line.name} line</span>
                        <span class="block text-[13px] ${on ? 'text-white/85' : 'text-[#6C6C70]'}">${whoAny} We pick the fairest one.</span>
                    </span>
                </button>
                <p class="mt-3 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#8E8E93]">Or one ${line.name} line stop</p>`,
            items: stops.map((st) => chip(`data-action="choose" data-origin="${st.id}"`, esc(st.name), st.id === current)),
            tail: (n) => (n ? `<span class="self-center text-[13px] text-[#6C6C70]">+${n} more, search above</span>` : ''),
            wrap: (inner) => `<div class="flex flex-wrap gap-2">${inner}</div>`,
        };
    }

    const render = (shown: number) => {
        area.innerHTML = `<div id="pickInner">${part.head}${part.wrap(part.items.slice(0, shown).join('') + part.tail(part.items.length - shown))}</div>`;
    };
    const fits = () => $('pickInner').offsetHeight <= area.clientHeight + 1;
    for (let shown = part.items.length; shown >= 0; shown--) {
        render(shown);
        pickerTrimmed = shown < part.items.length;
        if (fits()) return;
    }
}

function stationRow(st: Station, selected: boolean): string {
    return `
        <button type="button" data-action="choose" data-origin="${st.id}" class="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 active:bg-black/[0.03]">
            <span class="min-w-0">
                <span class="block text-[16px] font-semibold ${selected ? 'text-[#007AFF]' : 'text-[#1C1C1E]'}">${esc(st.name)}</span>
                <span class="flex flex-wrap gap-x-2 mt-0.5">${st.lines
                    .map((l) => `<span class="inline-flex items-center gap-1 text-[12px] text-[#6C6C70]"><span class="w-2 h-2 rounded-full" style="background:${TFL_LINES[l].color}"></span>${TFL_LINES[l].name}</span>`)
                    .join('')}</span>
            </span>
            ${selected ? '<span class="text-[#007AFF] font-bold">✓</span>' : ''}
        </button>`;
}

// Room for the picker's options: drop the least useful chrome first.
const STEP_COMPACT: (() => void)[] = [
    () => $('stepFooter').classList.add('hidden'),
    () => $('stepHint').classList.add('hidden'),
    () => $('stepView').classList.add('compact'),
    () => {
        if (state.pickerLine || $<HTMLInputElement>('searchInput').value) $('locateBtn').classList.add('hidden');
    },
    () => $('stepKicker').parentElement!.classList.add('hidden'),
];

function fitStep() {
    if (state.view === 'result') return;
    renderStep();
    for (let i = 0; i < STEP_COMPACT.length && pickerTrimmed; i++) {
        STEP_COMPACT[i]();
        renderPicker();
    }
}

function choose(origin: string) {
    if (!isValidOrigin(origin)) return;
    const v = state.view;
    if (v === 'add') {
        if (state.travellers.length >= MAX_TRAVELLERS) return;
        const typed = $<HTMLInputElement>('nameInput').value.trim().slice(0, 20);
        const name = typed || `Friend ${state.travellers.length}`;
        state.travellers.push({ id: `t${Date.now()}`, name, origin });
        state.overrideStationId = null;
        state.selectedVenue = null;
        show('result');
        showToast(`Added ${name}`);
        return;
    }
    const t = v === 'you' ? you() : v === 'them' ? traveller('t1')! : traveller(state.editing)!;
    t.origin = origin;
    state.overrideStationId = null;
    state.selectedVenue = null;
    if (v === 'you') return show(traveller('t1')!.origin ? 'result' : 'them');
    show('result');
}

function stepBack() {
    if (state.view === 'them') return show('you');
    show(ready() ? 'result' : 'you');
}

// ---------- result view ----------

function renderConvergenceDiagram(winner: Ranked) {
    const svg = $('convergenceSvg') as unknown as SVGSVGElement;
    const journeys = winner.journeys;
    const count = journeys.length;
    const totalHeight = Math.max(96, (count - 1) * 32 + 44);
    const midY = totalHeight / 2;
    svg.setAttribute('viewBox', `0 0 340 ${totalHeight}`);
    let html = '';
    journeys.forEach((j, i) => {
        const y = count === 1 ? midY : 22 + i * ((totalHeight - 44) / (count - 1));
        const color = TFL_LINES[j.route.lines[0]]?.color || '#007AFF';
        const line = originLine(j.person.station);
        const from = line ? `${TFL_LINES[line].name} line` : STATIONS[j.person.station].name;
        const pillY = y * 0.58 + midY * 0.42;
        html += `
            <path d="M 118 ${y} C 185 ${y}, 195 ${midY}, 258 ${midY}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" opacity="0.85" />
            <rect x="158" y="${pillY - 9}" width="36" height="18" rx="9" fill="#F2F2F7" />
            <text x="176" y="${pillY + 3.5}" text-anchor="middle" fill="#1C1C1E" font-size="10" font-weight="600">${j.route.minutes}m</text>
            <circle cx="118" cy="${y}" r="4.5" fill="${color}" stroke="#FFFFFF" stroke-width="1.5" />
            <text x="106" y="${y - 2}" text-anchor="end" fill="#1C1C1E" font-size="12" font-weight="600">${esc(j.person.name)}</text>
            <text x="106" y="${y + 10}" text-anchor="end" fill="#6C6C70" font-size="9.5" font-weight="500">${esc(from)}</text>`;
    });
    html += `
        <circle cx="272" cy="${midY}" r="22" fill="#34C759" class="pulse-halo" />
        <circle cx="272" cy="${midY}" r="11" fill="#FFFFFF" stroke="#EB1B22" stroke-width="4" />
        <rect x="256" y="${midY - 3}" width="32" height="6" rx="3" fill="#0046A2" />
        <text x="272" y="${midY + 28}" text-anchor="middle" fill="#1C1C1E" font-size="10.5" font-weight="700">MEET</text>`;
    svg.innerHTML = html;
}

function renderSegments() {
    (['fair', 'fast', 'direct'] as Mode[]).forEach((m) => {
        const btn = $(`seg-${m}`);
        const on = m === state.mode;
        btn.className = on
            ? 'py-1.5 rounded-xl transition bg-white text-[#1C1C1E] shadow-sm font-semibold'
            : 'py-1.5 rounded-xl transition text-[#6C6C70]';
        btn.setAttribute('aria-checked', String(on));
    });
}

function renderKinds() {
    $('venueKinds').classList.toggle('hidden', !liveSupported());
    document.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => {
        const on = b.dataset.kind === state.kind;
        b.className = `px-2.5 py-0.5 rounded-full transition ${on ? 'bg-white shadow-sm font-semibold text-[#1C1C1E]' : 'text-[#6C6C70]'}`;
        b.setAttribute('aria-checked', String(on));
    });
}

function travellerRow(t: Traveller, j: Journey): string {
    const color = TFL_LINES[j.route.lines[0]]?.color || TFL_LINES[originLines(t.origin!)[0]].color;
    const issues = (j.route.minutes === 0 ? [] : j.route.lines)
        .filter((l) => lineIssues[l])
        .map((l) => `${TFL_LINES[l].name}: ${lineIssues[l].text.toLowerCase()}`);
    const removable = state.travellers.indexOf(t) >= 2;
    const avatar = isYou(t.id)
        ? '<span class="w-8 h-8 rounded-full bg-[#007AFF] text-white text-[11px] font-bold flex items-center justify-center shrink-0">You</span>'
        : `<span class="w-8 h-8 rounded-full bg-[#F2F2F7] text-[#1C1C1E] text-[12px] font-semibold flex items-center justify-center shrink-0">${esc(t.name.slice(0, 2).toUpperCase())}</span>`;
    return `
        <div class="trow flex items-stretch">
            <button type="button" data-action="edit" data-id="${esc(t.id)}" class="flex-1 min-w-0 text-left px-4 py-2.5 flex items-center gap-3 active:bg-black/[0.02]">
                ${avatar}
                <span class="flex-1 min-w-0">
                    <span class="block text-[15px] font-semibold text-[#1C1C1E] leading-snug">${esc(t.name)} <span class="font-normal text-[#6C6C70]">· ${esc(originLabel(t.origin!))}</span></span>
                    <span class="detail flex items-start gap-1.5 mt-0.5 text-[12px] text-[#6C6C70] leading-snug"><span class="w-2 h-2 mt-[5px] rounded-full shrink-0" style="background:${color}"></span><span>${esc(routeText(t, j))}</span></span>
                    ${issues.map((s) => `<span class="block mt-0.5 text-[12px] font-medium text-[#C4332B] leading-snug">⚠ ${esc(s)}</span>`).join('')}
                </span>
                <span class="shrink-0 text-[15px] font-semibold text-[#1C1C1E] whitespace-nowrap">${j.route.minutes} min</span>
            </button>
            ${removable ? `<button type="button" data-action="remove" data-id="${esc(t.id)}" aria-label="Remove ${esc(t.name)}" class="shrink-0 w-10 flex items-center justify-center text-[#AEAEB2] text-[18px] active:text-[#1C1C1E]">✕</button>` : ''}
        </div>`;
}

function venueRow(v: ShownVenue, selected: boolean): string {
    const meta = [v.meta, walkText(v)].filter(Boolean).join(' · ');
    return `
        <div class="vrow flex items-center ${selected ? 'bg-[#007AFF]/[0.06]' : ''}">
            <button type="button" data-action="pick-venue" data-venue="${esc(v.id)}" aria-pressed="${selected}" class="flex-1 min-w-0 text-left pl-4 pr-2 py-2 flex items-start gap-2.5 active:bg-black/[0.02]">
                <span class="mt-[3px] w-4 h-4 shrink-0 rounded-full border-2 ${selected ? 'border-[#007AFF] bg-[#007AFF]' : 'border-[#C7C7CC]'} flex items-center justify-center">${selected ? '<span class="w-1.5 h-1.5 rounded-full bg-white"></span>' : ''}</span>
                <span class="min-w-0">
                    <span class="block text-[15px] font-semibold text-[#1C1C1E] leading-snug">${esc(v.name)}</span>
                    <span class="block text-[13px] leading-snug ${v.open === false ? 'text-[#C4332B]' : 'text-[#6C6C70]'}">${esc(meta)}</span>
                </span>
            </button>
            <a href="${esc(v.mapsUrl)}" target="_blank" rel="noopener" aria-label="Directions to ${esc(v.name)} in Google Maps" title="Open in Google Maps" class="shrink-0 mr-3 w-9 h-9 rounded-full bg-[#007AFF]/10 text-[#007AFF] flex items-center justify-center">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>
            </a>
        </div>`;
}

const LOADING_ROW = `
    <div class="px-4 py-3 flex items-center gap-3 animate-pulse" aria-label="Finding places">
        <div class="space-y-1.5 flex-1"><div class="h-3.5 w-32 rounded-full bg-[#F2F2F7]"></div><div class="h-3 w-48 rounded-full bg-[#F2F2F7]"></div></div>
        <div class="h-6 w-20 rounded-full bg-[#F2F2F7]"></div>
    </div>`;

function attributionRow(live: boolean): string {
    return live ? '<p class="px-4 py-1.5 text-[11px] text-[#8E8E93]">Live hours and ratings from Google Maps</p>' : '';
}

function moreRow(count: number, onlyRow: boolean, stationName: string): string {
    const label = onlyRow ? `${count} places by ${esc(stationName)}` : `${count} more place${count === 1 ? '' : 's'}`;
    return `
        <button type="button" data-action="more-venues" class="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 active:bg-black/[0.02]">
            <span class="text-[14px] font-medium text-[#007AFF]">${label}</span>
            <span class="text-[#C7C7CC] text-[18px]" aria-hidden="true">›</span>
        </button>`;
}

function selectedVenue(stationId: string): ShownVenue | null {
    const { venues } = venuesFor(stationId);
    if (!state.selectedVenue && state.wantedVenue) {
        const wanted = venues.find((v) => v.name.toLowerCase() === state.wantedVenue!.toLowerCase());
        if (wanted) state.selectedVenue = wanted.id;
    }
    return venues.find((v) => v.id === state.selectedVenue) ?? venues.find((v) => v.open !== false) ?? venues[0] ?? null;
}

/** The hour choices for "Open at": the rest of tonight, London time. */
function openAtOptions(): { value: number; label: string }[] {
    const now = londonMinuteOfWeek(new Date());
    const dayStart = now - (now % 1440);
    const hour = Math.floor((now % 1440) / 60);
    const out: { value: number; label: string }[] = [];
    for (let h = hour + 1; h <= hour + 8 && out.length < 8; h++) {
        if (h > 25) break; // up to 01:00 tomorrow
        out.push({ value: (dayStart + h * 60) % (7 * 1440), label: `Open at ${clock(h * 60)}` });
    }
    return out;
}

function renderOpenAt(stationId: string) {
    const res = venueCache.get(`${stationId}|${state.kind}`);
    const hasHours = !!(res && typeof res === 'object' && res.source === 'google' && res.venues.some((v) => v.hours));
    const options = hasHours ? openAtOptions() : [];
    $('openAtWrap').classList.toggle('hidden', !options.length);
    $('openAtWrap').classList.toggle('inline-flex', !!options.length);
    $('venuesLabel').classList.toggle('hidden', !!options.length);
    if (!options.length) return;
    if (state.openAt !== null && !options.some((o) => o.value === state.openAt)) state.openAt = null;
    $<HTMLSelectElement>('openAt').innerHTML =
        `<option value="">Open now</option>` +
        options.map((o) => `<option value="${o.value}" ${o.value === state.openAt ? 'selected' : ''}>${o.label}</option>`).join('');
    $('openAtText').textContent = options.find((o) => o.value === state.openAt)?.label ?? 'Open now';
}

/** As many venue rows as fit; the rest go behind "N more places". The chosen venue always shows first. */
function renderVenues(stationId: string) {
    const { venues, loading, live } = venuesFor(stationId);
    const chosen = selectedVenue(stationId);
    const ordered = chosen ? [chosen, ...venues.filter((v) => v.id !== chosen.id)] : venues;
    const rows = ordered.map((v) => venueRow(v, v.id === chosen?.id));
    if (loading) rows.push(LOADING_ROW);
    const list = $('venuesList');
    const box = $('venuesBox');
    const fits = () => list.offsetHeight <= box.clientHeight + 1;

    if (!rows.length) {
        list.innerHTML = `<p class="px-4 py-3 text-[14px] text-[#6C6C70]">No places to suggest here yet. Share the plan and pick somewhere together.</p>`;
        return;
    }
    list.innerHTML = rows.join('') + attributionRow(live);
    if (fits()) return;
    for (let shown = rows.length - 1; shown >= 0; shown--) {
        const hidden = ordered.length - Math.min(shown, ordered.length);
        list.innerHTML =
            rows.slice(0, shown).join('') + moreRow(hidden, shown === 0, STATIONS[stationId].name) + (shown ? attributionRow(live) : '');
        if (fits()) return;
    }
    list.innerHTML = moreRow(ordered.length, true, STATIONS[stationId].name);
}

function renderResult() {
    if (!ready()) return show('you');
    const { ranked, current } = currentPick();
    requestVenues(current.stationId, state.kind);

    $('heroStationName').textContent = current.station.name;
    $('heroTimeSummary').textContent = `${current.avg}m avg · ${current.max}m max`;
    const spot = selectedVenue(current.stationId);
    $('heroVenue').classList.toggle('hidden', !spot);
    if (spot) $('heroVenue').innerHTML = `then <strong class="font-semibold text-[#1C1C1E]">${esc(spot.name)}</strong>, ${esc(walkText(spot))}`;
    const note = routedAroundNote(current);
    $('heroNote').classList.toggle('hidden', !note);
    $('heroNote').textContent = note ? `↺ ${note}` : '';
    $('heroStationLines').innerHTML = current.station.lines
        .map((l) => {
            const line = TFL_LINES[l];
            const issue = lineIssues[l] ? ` <span class="text-[#C4332B]" title="${esc(lineIssues[l].text)}">⚠</span>` : '';
            return `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F2F2F7] text-[12px] font-medium text-[#1C1C1E]"><span class="w-2 h-2 rounded-full" style="background:${line.color}"></span>${line.name}${issue}</span>`;
        })
        .join('');
    renderConvergenceDiagram(current);

    $('alternativesContainer').innerHTML = ranked
        .filter((r) => r.stationId !== current.stationId)
        .slice(0, 2)
        .map(
            (r) =>
                `<button type="button" data-action="alternative" data-station="${r.stationId}" class="px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-[#F2F2F7] text-[#1C1C1E]">${esc(r.station.name)} · ${r.avg}m</button>`,
        )
        .join('');

    $('travellersList').innerHTML = state.travellers
        .map((t) => travellerRow(t, current.journeys.find((j) => j.person.id === t.id)!))
        .join('');
    $('addPersonBtn').classList.toggle('hidden', state.travellers.length >= MAX_TRAVELLERS);

    renderSegments();
    renderKinds();
    renderOpenAt(current.stationId);
    syncUrl();
    fitResult(current.stationId);
}

// Applied in order until the result fits one screen. Least useful first: the alternatives, then the
// diagram and line pills (to make room for at least one venue), then density, then the rest.
const RESULT_COMPACT: (() => void)[] = [
    () => document.documentElement.style.setProperty('--diagram-max', '96px'),
    () => document.documentElement.style.setProperty('--diagram-max', '70px'),
    () => $('heroAlternatives').classList.add('hidden'),
    () => $('heroDiagram').classList.add('hidden'),
    () => $('heroStationLines').classList.add('hidden'),
    () => $('travellersList').classList.add('dense'),
    () => $('venuesHeader').classList.add('hidden'),
    () => $('travellersList').classList.add('no-detail'),
    () => $('modeControl').classList.add('hidden'),
    // Last resorts for very small screens with a full group:
    () => state.travellers.length >= MAX_TRAVELLERS && $('whoHeader').classList.add('hidden'),
    () => $('hero').classList.add('compact'),
    () => $('heroVenue').classList.add('hidden'),
];

function resultFits(): boolean {
    const view = $('resultView');
    return view.scrollHeight <= view.clientHeight + 1;
}

function fitResult(stationId: string) {
    document.documentElement.style.removeProperty('--diagram-max');
    for (const id of ['heroAlternatives', 'heroDiagram', 'heroStationLines', 'venuesHeader', 'modeControl', 'whoHeader']) $(id).classList.remove('hidden');
    $('hero').classList.remove('compact');
    $('heroVenue').classList.toggle('hidden', !selectedVenue(stationId));
    $('travellersList').classList.remove('dense', 'no-detail');
    const total = venuesFor(stationId).venues.length;
    const wanted = Math.min(2, total);
    // Venues count as reachable only if what we drew (rows or the "N places" row) fully fits its box.
    const venuesFit = () => $('venuesList').offsetHeight <= $('venuesBox').clientHeight + 1;
    const reachable = () =>
        venuesFit() &&
        (!!$('venuesList').querySelector('[data-action="more-venues"]') ||
            $('venuesList').querySelectorAll('[data-action="pick-venue"]').length >= total);
    for (let step = 0; ; step++) {
        renderVenues(stationId);
        const shown = $('venuesList').querySelectorAll('[data-action="pick-venue"]').length;
        // Two venues ideally; one once the alternatives are gone; just "N places" only after density.
        const ok =
            resultFits() && venuesFit() && (shown >= wanted || (step >= 3 && shown >= 1) || (step >= 6 && reachable()));
        if (ok || step >= RESULT_COMPACT.length) break;
        RESULT_COMPACT[step]();
    }
}

// ---------- venues sheet ----------

let lastFocus: HTMLElement | null = null;

function openVenuesSheet() {
    const { current } = currentPick();
    const { venues, loading, live } = venuesFor(current.stationId);
    const chosen = selectedVenue(current.stationId);
    $('venuesSheetTitle').textContent = `Places by ${current.station.name}`;
    const list = $('venuesSheetList');
    const box = $('venuesSheetBox');
    const rows = venues.map((v) => venueRow(v, v.id === chosen?.id));
    lastFocus = document.activeElement as HTMLElement | null;
    const sheet = $('venuesSheet');
    sheet.classList.remove('pointer-events-none');
    sheet.setAttribute('aria-hidden', 'false');
    $('venuesBackdrop').classList.replace('opacity-0', 'opacity-100');
    $('venuesPanel').classList.replace('translate-y-full', 'translate-y-0');
    // The sheet never scrolls either: show what fits.
    for (let shown = rows.length; shown >= 1; shown--) {
        list.innerHTML = rows.slice(0, shown).join('') + (loading ? LOADING_ROW : '') + attributionRow(live);
        if (list.offsetHeight <= box.clientHeight + 1) break;
    }
}

function closeSheet() {
    const sheet = $('venuesSheet');
    if (sheet.classList.contains('pointer-events-none')) return;
    $('venuesBackdrop').classList.replace('opacity-100', 'opacity-0');
    $('venuesPanel').classList.replace('translate-y-0', 'translate-y-full');
    sheet.setAttribute('aria-hidden', 'true');
    setTimeout(() => sheet.classList.add('pointer-events-none'), 300);
    lastFocus?.focus({ preventScroll: true });
}

// ---------- location ----------

function locateUser() {
    if (nearbyHint) {
        const id = nearbyHint.stationId;
        nearbyHint = null;
        return choose(id);
    }
    if (!('geolocation' in navigator)) return showToast('Location isn’t available on this device. Search instead.');
    const btn = $('locateBtn');
    if (btn.classList.contains('is-locating')) return;
    btn.classList.add('is-locating');
    $('locateLabel').textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            btn.classList.remove('is-locating');
            const { station, metres } = nearestStation(pos.coords.latitude, pos.coords.longitude);
            if (metres > MAX_GPS_DISTANCE_M) {
                renderStep();
                return showToast('You look outside central London. Search for a station instead.');
            }
            const km = metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 10) * 10} m`;
            showToast(`Nearest station: ${station.name}, ${km} away`);
            choose(station.id);
        },
        (err) => {
            btn.classList.remove('is-locating');
            renderStep();
            showToast(err.code === err.PERMISSION_DENIED ? 'Location is off. Search or pick a line instead.' : 'Couldn’t find you. Search instead.');
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 },
    );
}

// ---------- share ----------

/** The app URL for this plan, including the chosen venue so a reload or a shared link keeps it. */
function planUrl(prefix = ''): string {
    const { current } = currentPick();
    const spot = selectedVenue(current.stationId);
    // Pin the station and mode the sender is looking at, so the preview and the receiver see the same plan.
    let path = planPath(state.travellers.map((t) => t.origin!)) + `&meet=${stationSlug(current.stationId)}`;
    if (state.mode !== 'fair') path += `&mode=${state.mode}`;
    return `${prefix}${path}${spot ? `&at=${encodeURIComponent(spot.name)}` : ''}`;
}

function syncUrl() {
    history.replaceState(null, '', planUrl());
}

function journeyLine(j: Journey): string {
    const t = traveller(j.person.id)!;
    const line = originLine(t.origin!);
    if (j.route.minutes === 0) return `${t.name}: already ${line ? `on the ${TFL_LINES[line].name} line` : 'there'}`;
    const how = line && j.route.board
        ? `${TFL_LINES[line].name} line to ${STATIONS[j.route.board].name}${j.route.lines[0] === line ? '' : `, then ${linesText(j.route.lines)} line`}`
        : `${linesText(j.route.lines)} line`;
    const from = line ? '' : ` from ${STATIONS[t.origin!].name}`;
    return `${t.name}: ${j.route.minutes} min${from}, ${how}`;
}

/**
 * The plan as a WhatsApp message: *bold* for the essentials, and the plan link early so WhatsApp
 * shows its preview card (station, pub, everyone's times).
 */
function buildWhatsApp(): string {
    const { current } = currentPick();
    const spot = selectedVenue(current.stationId);
    // The /p link serves a preview card for this exact plan, then opens it.
    const link = SITE + planUrl('/p').replace('/p/?', '/p?');
    const issues = [...new Set(current.journeys.flatMap((j) => (j.route.minutes ? j.route.lines : [])))]
        .filter((l) => lineIssues[l])
        .map((l) => `Heads up: ${TFL_LINES[l].name} line ${lineIssues[l].text.toLowerCase()}`);
    const note = routedAroundNote(current);
    return [
        `*Let's meet at ${current.station.name}*`,
        ...(spot ? [`Then *${spot.name}*${spot.type ? ` (${spot.type.toLowerCase()})` : ''}, ${walkText(spot)}`] : []),
        link,
        '',
        ...current.journeys.map(journeyLine),
        ...(note ? [`${note}.`] : []),
        ...issues,
        ...(spot ? ['', `Directions: ${spot.mapsUrl}`] : []),
    ].join('\n');
}

async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.setAttribute('readonly', '');
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(temp);
        return ok;
    }
}

async function copyForWhatsApp() {
    showToast((await copyText(buildWhatsApp())) ? 'Copied. Paste it into WhatsApp.' : 'Couldn’t copy. Try again.');
}

async function sharePlan() {
    const text = buildWhatsApp().replace(/\*/g, '');
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        try {
            await navigator.share({ title: 'Our meetup plan', text });
            return;
        } catch (err) {
            if ((err as DOMException).name === 'AbortError') return;
        }
    }
    showToast((await copyText(text)) ? 'Plan copied. Paste it into your chat.' : 'Couldn’t copy. Try again.');
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(text: string) {
    const toast = $('iosToast');
    $('iosToastText').textContent = text;
    toast.classList.remove('opacity-0', 'translate-y-2');
    toast.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', 'translate-y-2');
    }, 2600);
}

// ---------- wiring ----------

function bind() {
    $('locateBtn').addEventListener('click', locateUser);
    $('restartBtn').addEventListener('click', restart);
    $('stepBack').addEventListener('click', stepBack);
    $('shareBtn').addEventListener('click', sharePlan);
    $('whatsappBtn').addEventListener('click', copyForWhatsApp);
    $('openAt').addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        state.openAt = v === '' ? null : parseInt(v, 10);
        state.selectedVenue = null;
        renderResult();
    });
    $('addPersonBtn').addEventListener('click', () => {
        if (state.travellers.length >= MAX_TRAVELLERS) return showToast(`Up to ${MAX_TRAVELLERS} people per meetup`);
        show('add');
    });
    $('searchInput').addEventListener('input', () => {
        state.pickerLine = null;
        fitStep();
    });
    $('homeLink').addEventListener('click', (e) => {
        e.preventDefault();
        if (state.view === 'you' && !you().origin) return;
        restart();
    });

    document.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) =>
        b.addEventListener('click', () => {
            state.mode = b.dataset.mode as Mode;
            state.overrideStationId = null;
            state.selectedVenue = null;
            renderResult();
        }),
    );
    document.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) =>
        b.addEventListener('click', () => {
            state.kind = b.dataset.kind as VenueKind;
            state.selectedVenue = null;
            renderResult();
        }),
    );

    document.addEventListener('click', (e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action], [data-close]');
        if (!el) return;
        if (el.dataset.close === 'venues') return closeSheet();
        switch (el.dataset.action) {
            case 'pick-line':
                state.pickerLine = el.dataset.line || null;
                $<HTMLInputElement>('searchInput').value = '';
                return fitStep();
            case 'choose':
                return choose(el.dataset.origin!);
            case 'edit':
                state.editing = el.dataset.id!;
                return show('edit');
            case 'remove':
                state.travellers = state.travellers.filter((t) => t.id !== el.dataset.id);
                state.overrideStationId = null;
                state.selectedVenue = null;
                return show('result');
            case 'alternative':
                state.overrideStationId = el.dataset.station!;
                state.selectedVenue = null;
                return renderResult();
            case 'pick-venue':
                state.selectedVenue = el.dataset.venue!;
                closeSheet();
                return renderResult();
            case 'more-venues':
                return openVenuesSheet();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSheet();
    });

    window.addEventListener('app:resize', () => {
        if (state.view === 'result') renderResult();
        else fitStep();
    });
}

function start() {
    initViewport();
    bind();
    const plan = parsePlan(location.search);
    const q = new URLSearchParams(location.search);
    state.wantedVenue = q.get('at')?.slice(0, 80) || null;
    const meet = parseOriginSlug(q.get('meet'));
    const mode = q.get('mode');
    if (mode === 'fast' || mode === 'direct') state.mode = mode;
    if (plan) {
        state.travellers = plan.map((origin, i) => ({
            id: i === 0 ? 'you' : i === 1 ? 't1' : `t${i}`,
            name: i === 0 ? 'You' : i === 1 ? 'Friend' : `Friend ${i}`,
            origin,
        }));
        if (meet && STATIONS[meet]) state.overrideStationId = meet;
        show('result');
    } else {
        show('you');
    }
    document.fonts?.ready.then(() => (state.view === 'result' ? renderResult() : fitStep()));

    // If location is already allowed, offer the nearest station on the first screen (no prompt, no jump).
    navigator.permissions
        ?.query({ name: 'geolocation' })
        .then((p) => {
            if (p.state !== 'granted') return;
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const { station, metres } = nearestStation(pos.coords.latitude, pos.coords.longitude);
                    if (metres > MAX_GPS_DISTANCE_M || state.view !== 'you') return;
                    nearbyHint = { stationId: station.id, metres };
                    fitStep();
                },
                () => {},
                { timeout: 8000, maximumAge: 300000 },
            );
        })
        .catch(() => {});
}

start();
