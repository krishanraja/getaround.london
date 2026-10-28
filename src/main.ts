import './style.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/outfit/700.css';
import { holdHeight, initViewport } from './viewport';
import { DONATE_URL, countVisit, markSupportShown, shouldAskForSupport } from './support';
import { PICKABLE_LINES, STATIONS, TFL_LINES, anyStopOn, lineLabel, linesPhrase, type Station } from './data';
import {
    isValidOrigin,
    lineOrigin,
    nearestStation,
    originLine,
    originLines,
    originName,
    avoidFromIssues,
    rankStations,
    type Journey,
    type Mode,
    type Person,
    type Ranked,
} from './routing';
import { SITE, parseOriginSlug, parsePlan, planPath, stationSlug } from './links';
import { planMessage, plainMessage } from './message';
import {
    isOpenAt,
    isVenueKind,
    kindForTime,
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
        // Coffee through the day, a drink from five (London time).
        kind: kindForTime(londonMinuteOfWeek(new Date())),
        selectedVenue: null,
        wantedVenue: null,
        openAt: null,
    };
}

let state: State = freshState();
/** Where the line chips start: they page on with "+N more lines". */
let lineOffset = 0;
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

/** "Avoiding Piccadilly line (part suspended)" when live disruption changed the plan. One short line. */
/** Disrupted lines the plan would have used without live status: what routing went around. */
function avoidedLines(current: Ranked): string[] {
    const avoided = Object.keys(avoidFromIssues(lineIssues));
    if (!avoided.length) return [];
    const plain = rankStations(people(), state.mode);
    const before = (state.overrideStationId && plain.find((r) => r.stationId === state.overrideStationId)) || plain[0];
    const usedBefore = new Set(before.journeys.flatMap((j) => j.route.lines));
    const usedNow = new Set(current.journeys.flatMap((j) => j.route.lines));
    return avoided.filter((l) => usedBefore.has(l) && !usedNow.has(l));
}

/** "Avoiding Piccadilly line (part suspended)" when live disruption changed the plan. One short line. */
function routedAroundNote(current: Ranked): string | null {
    const lines = avoidedLines(current);
    if (!lines.length) return null;
    return `Avoiding ${lines.map((l) => `${lineLabel(l)} (${lineIssues[l].text.toLowerCase()})`).join(' and ')}`;
}

// ---------- live data ----------

const venueCache = new Map<string, VenuesResponse | 'loading' | 'failed'>();
let lineIssues: Record<string, { severity: number; text: string }> = {};
let statusLoad: Promise<void> | null = null;

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

function requestStatus(): Promise<void> {
    statusLoad ??= fetch('/api/status')
        .then((r) => r.json())
        .then((body: { lines?: typeof lineIssues }) => {
            lineIssues = body.lines ?? {};
            if (state.view === 'result') renderResult();
        })
        .catch(() => {});
    return statusLoad;
}

interface ShownVenue {
    id: string;
    name: string;
    /** Type, rating: the first detail line. */
    meta: string;
    /** Open/closed and extras: the second detail line. */
    status?: string;
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
    const status: string[] = [];
    let open: boolean | undefined;
    if (state.openAt !== null) {
        open = openAtMinute(v, state.openAt);
        if (open !== undefined) status.push(`${open ? 'Open' : 'Closed'} at ${clock(state.openAt)}`);
    } else {
        open = isOpenAt(v);
        if (open === true) status.push(v.nextClose ? `Open till ${londonTime(v.nextClose)}` : 'Open now');
        if (open === false) status.push(v.nextOpen ? `Closed, opens ${londonTime(v.nextOpen)}` : 'Closed now');
    }
    if (v.groups) status.push('Good for groups');
    if (!live && v.detail) status.push(v.detail);
    return {
        id: `a:${v.name}`,
        name: v.name,
        meta: parts.filter(Boolean).join(' · '),
        status: status.join(' · ') || undefined,
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


function routeText(t: Traveller, j: Journey, stationName: string): string {
    const line = originLine(t.origin!);
    const yours = isYou(t.id);
    if (j.route.minutes === 0) {
        if (line) return `Ride the ${lineLabel(line)} to ${stationName}`;
        return yours ? "You're already there" : "They're already there";
    }
    const changes = j.route.transfers === 0 ? 'direct' : `${j.route.transfers} change${j.route.transfers === 1 ? '' : 's'}`;
    if (line && j.route.board) {
        const board = STATIONS[j.route.board].name;
        const [first, ...rest] = j.route.lines;
        if (first === line) {
            return `Take the ${lineLabel(line)} from ${board}${rest.length ? `, then the ${linesPhrase(rest)}` : ''}`;
        }
        return `Change at ${board} for the ${linesPhrase(j.route.lines)}`;
    }
    return `${linesPhrase(j.route.lines)}, ${changes}`;
}

function originLabel(origin: string): string {
    const line = originLine(origin);
    return line ? anyStopOn(line) : STATIONS[origin].name;
}

/** Someone already on the meeting line has no fixed time to show. */
function minutesText(t: Traveller, j: Journey): string {
    return j.route.minutes === 0 && originLine(t.origin!) ? 'On line' : `${j.route.minutes} min`;
}

function initials(name: string): string {
    const words = name.trim().split(/\s+/);
    return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

// ---------- view switching ----------

/** One of the two people from the mark, as a small glyph. */
function personGlyph(color: string, size = 18): string {
    return `<svg width="${size}" height="${size}" viewBox="88 80 140 350" aria-hidden="true"><path d="M 158 422 L 94.6 333.4 A 78 78 0 1 1 221.4 333.4 Z" fill="${color}"/><circle cx="158" cy="148" r="62" fill="${color}"/></svg>`;
}

const PINK = '#FE598A';
const YELLOW = '#FABD29';

/** You then Them: the current step in colour, a done step ticked, the next one grey. */
function renderStepper(view: View) {
    const stepper = $('stepper');
    const on = view === 'you' || view === 'them';
    stepper.classList.toggle('hidden', !on);
    stepper.classList.toggle('flex', on);
    $('stepKicker').classList.toggle('sr-only', on);
    if (!on) return;
    const step = (color: string, label: string, status: 'now' | 'done' | 'next') => `
        <span class="flex items-center gap-1.5">
            ${personGlyph(status === 'next' ? '#D1D1D6' : color)}
            <span class="text-[13px] ${status === 'now' ? 'font-semibold text-[#1C1C1E]' : status === 'done' ? 'font-medium text-[#6C6C70]' : 'font-medium text-[#AEAEB2]'}">${label}${status === 'done' ? ' ✓' : ''}</span>
        </span>`;
    const you = view === 'you' ? 'now' : 'done';
    const them = view === 'them' ? 'now' : 'next';
    stepper.innerHTML = `${step(PINK, 'You', you)}<span class="w-7 h-[3px] rounded-full ${view === 'them' ? 'bg-[#0046A0]' : 'bg-[#D1D1D6]'}"></span>${step(YELLOW, 'Them', them)}`;
}

let lastView: View | null = null;
/** Where each screen sits in the journey: moving right pushes the screen left, like a native app. */
const VIEW_ORDER: Record<View, number> = { you: 0, them: 1, result: 2, edit: 3, add: 3 };

function show(view: View) {
    const from = lastView;
    lastView = view;
    state.view = view;
    if (from !== view) hideSupport();
    const moving = from !== null && from !== view && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!moving) return applyView(view);
    const dir = VIEW_ORDER[view] >= VIEW_ORDER[from] ? 'forward' : 'back';
    if (document.startViewTransition) {
        // The old screen slides out as the new one slides in; the header stays put.
        const root = document.documentElement;
        root.dataset.slide = dir;
        const t = document.startViewTransition(() => applyView(view));
        t.ready.catch(() => {}); // skipped when another tap lands first
        t.finished.finally(() => {
            if (state.view === view) delete root.dataset.slide;
        });
        return;
    }
    // Browsers without view transitions: the new screen slides in on its own.
    applyView(view);
    const el = $(view === 'result' ? 'resultView' : 'stepView');
    el.classList.remove('step-in-right', 'step-in-left');
    void el.offsetWidth;
    el.classList.add(dir === 'forward' ? 'step-in-right' : 'step-in-left');
}

function applyView(view: View) {
    // A newer show() may have landed while this one waited for its transition.
    if (state.view !== view) return;
    const isResult = view === 'result';
    $('stepView').classList.toggle('hidden', isResult);
    $('resultView').classList.toggle('hidden', !isResult);
    const started = state.travellers.some((t) => t.origin) || state.travellers.length > 2;
    $('restartBtn').classList.toggle('hidden', !started);
    $('restartBtn').classList.toggle('inline-flex', started);
    fitHeader();
    if (isResult) {
        requestStatus();
        renderResult();
    } else {
        state.pickerLine = null;
        lineOffset = 0;
        $<HTMLInputElement>('searchInput').value = '';
        $<HTMLInputElement>('nameInput').value = '';
        fitStep();
    }
}

function restart() {
    state = freshState();
    history.replaceState(null, '', '/');
    resetFit();
    show('you');
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
    $('stepKicker').classList.remove('invisible');
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
    renderStepper(v);
    const face = $('stepFace');
    face.style.background = target.isYou ? 'rgba(254, 89, 138, 0.15)' : 'rgba(250, 189, 41, 0.2)';
    face.innerHTML = personGlyph(target.isYou ? PINK : YELLOW, 24);
    const showRecap = v === 'them' && !!you().origin;
    $('youRecap').classList.toggle('hidden', !showRecap);
    $('youRecap').classList.toggle('flex', showRecap);
    if (showRecap) {
        $('recapGlyph').innerHTML = personGlyph(PINK, 20);
        fitLine($('recapLabel'), `You: ${originName(you().origin!)}`);
    }
    $('nameField').classList.toggle('hidden', v !== 'add');
    $('locateBtn').classList.toggle('hidden', !target.isYou);
    if (nearbyHint) setLocate(STATIONS[nearbyHint.stationId].name, `Nearest station · ${distanceText(nearbyHint.metres)} away`);
    else setLocate('Use my location', 'Finds your nearest station');
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
let pickerShown = 0;
/** Everything that matched, drawn or not. */
let pickerCount = 0;

/** Renders the picker, moving trailing chips/rows behind a "+N more" note until it fits. */
function renderPicker() {
    const area = $('pickArea');
    const query = $<HTMLInputElement>('searchInput').value.trim().toLowerCase();
    const current = currentOrigin();
    const target = pickTarget();

    type Part = {
        head: string;
        items: string[];
        tail: (hidden: number) => string;
        wrap: (inner: string) => string;
        count?: number;
        /** What to show when even the head and no items will not fit (a tiny screen, keyboard up). */
        minimal?: string;
    };
    let part: Part;

    if (query) {
        const norm = (s: string) => s.toLowerCase().replace(/[’'.]/g, '');
        const q = norm(query);
        const matches = Object.values(STATIONS)
            .filter((st) => norm(st.name).includes(q))
            .sort((a, b) => {
                const ap = norm(a.name).startsWith(q) ? 0 : 1;
                const bp = norm(b.name).startsWith(q) ? 0 : 1;
                return ap - bp || a.name.localeCompare(b.name);
            });
        // Lines match from the start of a word, from two letters: "li" finds Lioness and Liberty, "s" finds none.
        const lines = q.length < 2 ? [] : PICKABLE_LINES.filter((l) => norm(lineLabel(l)).split(/[\s&-]+/).some((w) => w.startsWith(q)));
        if (!matches.length && !lines.length) {
            pickerTrimmed = false;
            area.innerHTML = `<div id="pickInner"><p class="pt-2 text-[15px] text-[#6C6C70]">No station matches “${esc(query)}”. We cover every Tube, Overground, DLR, Elizabeth line, tram and rail station in London’s fare zones.</p></div>`;
            return;
        }
        part = {
            head: '',
            // Only the best 16 are ever drawn (a screen holds about 10); the tail still counts them all.
            items: [...lines.map((l) => lineRow(l)), ...matches.map((st) => stationRow(st, st.id === current))].slice(0, 16),
            count: lines.length + matches.length,
            tail: (n) => (n ? `<p class="px-4 py-2.5 text-[13px] text-[#6C6C70]">${n} more. Keep typing to narrow it down.</p>` : ''),
            wrap: (inner) => `<div class="bg-white rounded-[18px] ios-shadow divide-y divide-black/[0.05] overflow-hidden">${inner}</div>`,
        };
    } else if (!state.pickerLine) {
        // Every line is reachable: chips page on with "+N more", and search finds lines by name.
        const page = PICKABLE_LINES.slice(lineOffset);
        part = {
            head: `<p class="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#8E8E93]">Or pick a line</p>`,
            items: [
                ...(lineOffset ? [`<button type="button" data-action="more-lines" data-offset="0" class="px-3 py-1.5 rounded-full text-[14px] font-medium text-[#007AFF]">‹ First lines</button>`] : []),
                ...page.map(
                    (id) => `<button type="button" data-action="pick-line" data-line="${id}" class="px-3 py-1.5 rounded-full bg-white ios-shadow text-[14px] font-medium text-[#1C1C1E] inline-flex items-center gap-1.5">
                    <span class="w-2.5 h-2.5 rounded-full" style="background:${TFL_LINES[id].color}"></span>${TFL_LINES[id].name}</button>`,
                ),
            ],
            tail: (n) =>
                n ? `<button type="button" data-action="more-lines" data-offset="${PICKABLE_LINES.length - n}" class="px-3 py-1.5 rounded-full text-[14px] font-medium text-[#007AFF]">+${n} more lines</button>` : '',
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
        const lineHead = `
                <button type="button" data-action="pick-line" data-line="" class="mb-2 text-[14px] font-medium text-[#007AFF]">‹ All lines</button>
                <button type="button" data-action="choose" data-origin="${origin}" class="w-full text-left rounded-[18px] px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition ${
                    on ? 'bg-[#007AFF] text-white' : 'bg-white ios-shadow'
                }">
                    <span class="w-3.5 h-3.5 rounded-full shrink-0 ring-2 ring-white" style="background:${line.color}"></span>
                    <span class="min-w-0">
                        <span class="block text-[16px] font-semibold">Anywhere on the ${esc(lineLabel(line.id))}</span>
                        <span class="block text-[13px] ${on ? 'text-white/85' : 'text-[#6C6C70]'}">${whoAny} We pick the fairest one.</span>
                    </span>
                </button>`;
        part = {
            head: `${lineHead}
                <p class="mt-3 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#8E8E93]">Or one ${esc(lineLabel(line.id))} stop</p>`,
            minimal: lineHead,
            items: stops.map((st) => chip(`data-action="choose" data-origin="${st.id}"`, esc(st.name), st.id === current)),
            tail: (n) => (n ? `<span class="self-center text-[13px] text-[#6C6C70]">+${n} more, search above</span>` : ''),
            wrap: (inner) => `<div class="flex flex-wrap gap-2">${inner}</div>`,
        };
    }

    const render = (shown: number) => {
        area.innerHTML = `<div id="pickInner">${part.head}${part.wrap(part.items.slice(0, shown).join('') + part.tail((part.count ?? part.items.length) - shown))}</div>`;
    };
    // Exact edges, not whole-pixel heights: under the zoom applied for "Desktop site" mode a
    // sub-pixel overhang would otherwise slip through and clip the last row.
    const fits = () => $('pickInner').getBoundingClientRect().bottom <= area.getBoundingClientRect().bottom + 0.5;
    // The most items that fit, by binary search: a search can match hundreds of stations.
    const total = part.items.length;
    pickerCount = part.count ?? total;
    render(total);
    if (fits()) {
        pickerTrimmed = total < (part.count ?? total);
        pickerShown = total;
        return;
    }
    let lo = 0;
    let hi = total - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        render(mid);
        if (fits()) lo = mid;
        else hi = mid - 1;
    }
    render(lo);
    pickerTrimmed = lo < (part.count ?? total);
    pickerShown = lo;
    if (!fits() && part.minimal !== undefined) area.innerHTML = `<div id="pickInner">${part.minimal}</div>`;
}

function lineRow(id: string): string {
    const l = TFL_LINES[id];
    return `
        <button type="button" data-action="pick-line" data-line="${id}" class="w-full text-left px-4 py-2.5 flex items-center gap-3 active:bg-black/[0.03]">
            <span class="w-3 h-3 rounded-full shrink-0" style="background:${l.color}"></span>
            <span class="min-w-0 text-[16px] font-semibold text-[#1C1C1E]">Anywhere on the ${esc(lineLabel(id))}</span>
        </button>`;
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
        if (state.pickerLine || $<HTMLInputElement>('searchInput').value) {
            $('locateBtn').classList.add('hidden');
            $('youRecap').classList.add('hidden');
            $('youRecap').classList.remove('flex');
        }
    },
    // Last resort: drop the "Step 1 of 2" kicker, but never the Back button beside it.
    () => {
        if ($('stepBack').classList.contains('hidden')) $('stepKicker').parentElement!.classList.add('hidden');
        else $('stepKicker').classList.add('invisible');
    },
];

function fitStep() {
    if (state.view === 'result') return;
    renderStep();
    // A broad search can never show every match, so it would end up fully compact anyway: go
    // straight there and measure once, which keeps typing quick.
    if (pickerTrimmed && pickerCount > 16 && $<HTMLInputElement>('searchInput').value.trim()) {
        STEP_COMPACT.forEach((compact) => compact());
        renderPicker();
        return;
    }
    // Line chips page on with "+N more lines", so the screen only gives up its hint and links when
    // too few chips fit; search results and a line's stops take all the room they can get.
    const chips = () => !state.pickerLine && !$<HTMLInputElement>('searchInput').value.trim();
    for (let i = 0; i < STEP_COMPACT.length && pickerTrimmed && !(chips() && pickerShown >= 8); i++) {
        STEP_COMPACT[i]();
        renderPicker();
    }
}

function choose(origin: string) {
    if (!isValidOrigin(origin)) return;
    const v = state.view;
    if (v === 'add') {
        if (state.travellers.length >= MAX_TRAVELLERS) return;
        const typed = $<HTMLInputElement>('nameInput').value.trim().slice(0, 16);
        const name = typed || `Friend ${state.travellers.length}`;
        state.travellers.push({ id: `t${Date.now()}`, name, origin });
        state.overrideStationId = null;
        state.selectedVenue = null;
        resetFit();
        show('result');
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
        const from = line ? lineLabel(line) : STATIONS[j.person.station].name;
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
        <rect x="252" y="${midY - 3}" width="40" height="6" rx="3" fill="#0046A0" />
        <circle cx="272" cy="${midY}" r="9" fill="#FFFFFF" stroke="#EB1B22" stroke-width="4" />
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

// Every row has the same anatomy: avatar | name, origin, route | minutes | remove slot. The minutes and
// remove columns are fixed widths (the slot stays when there is nothing to remove), so columns line up.
function travellerRow(t: Traveller, j: Journey, stationName: string): string {
    const color = TFL_LINES[j.route.lines[0]]?.color || TFL_LINES[originLines(t.origin!)[0]].color;
    const issues = (j.route.minutes === 0 ? [] : j.route.lines)
        .filter((l) => lineIssues[l])
        .map((l) => `${TFL_LINES[l].name}: ${lineIssues[l].text.toLowerCase()}`);
    const removable = state.travellers.indexOf(t) >= 2;
    const avatar = isYou(t.id)
        ? '<span class="avatar w-8 h-8 rounded-full bg-[#007AFF] text-white text-[11px] font-bold flex items-center justify-center">You</span>'
        : `<span class="avatar w-8 h-8 rounded-full bg-[#F2F2F7] text-[#1C1C1E] text-[12px] font-semibold flex items-center justify-center">${esc(initials(t.name))}</span>`;
    const remove = removable
        ? `<button type="button" data-action="remove" data-id="${esc(t.id)}" aria-label="Remove ${esc(t.name)}" class="flex items-center justify-center text-[#AEAEB2] text-[17px] active:text-[#1C1C1E]">✕</button>`
        : '<span aria-hidden="true"></span>';
    return `
        <div class="trow grid grid-cols-[minmax(0,1fr)_2.25rem]">
            <button type="button" data-action="edit" data-id="${esc(t.id)}" class="tgrid min-w-0 text-left pl-4 py-2.5 grid items-center gap-x-2.5 active:bg-black/[0.02]">
                ${avatar}
                <span class="min-w-0">
                    <span class="block text-[15px] font-semibold text-[#1C1C1E] leading-snug">${esc(t.name)}</span>
                    <span class="block text-[13px] text-[#6C6C70] leading-snug">${esc(originLabel(t.origin!))}</span>
                    <span class="detail flex items-start gap-1.5 mt-0.5 text-[12px] text-[#6C6C70] leading-snug"><span class="w-2 h-2 mt-[5px] rounded-full shrink-0" style="background:${color}"></span><span>${esc(routeText(t, j, stationName))}</span></span>
                    ${issues.map((s) => `<span class="block mt-0.5 text-[12px] font-medium text-[#C4332B] leading-snug">⚠ ${esc(s)}</span>`).join('')}
                </span>
                <span class="text-right tabular-nums text-[15px] font-semibold text-[#1C1C1E] whitespace-nowrap">${minutesText(t, j)}</span>
            </button>
            ${remove}
        </div>`;
}

function venueRow(v: ShownVenue, selected: boolean): string {
    const info = [v.meta, `${v.walkMin} min walk`].filter(Boolean).join(' · ');
    return `
        <div class="vrow flex items-center ${selected ? 'bg-[#007AFF]/[0.06]' : ''}">
            <button type="button" data-action="pick-venue" data-venue="${esc(v.id)}" aria-pressed="${selected}" class="flex-1 min-w-0 text-left pl-4 pr-2 py-2 flex items-start gap-2.5 active:bg-black/[0.02]">
                <span class="mt-[3px] w-4 h-4 shrink-0 rounded-full border-2 ${selected ? 'border-[#007AFF] bg-[#007AFF]' : 'border-[#C7C7CC]'} flex items-center justify-center">${selected ? '<span class="w-1.5 h-1.5 rounded-full bg-white"></span>' : ''}</span>
                <span class="min-w-0">
                    <span class="block text-[15px] font-semibold text-[#1C1C1E] leading-snug">${esc(v.name)}</span>
                    <span class="block text-[13px] leading-snug text-[#6C6C70]">${esc(info)}</span>
                    ${v.status ? `<span class="block text-[13px] leading-snug ${v.open === false ? 'text-[#C4332B]' : 'text-[#6C6C70]'}">${esc(v.status)}</span>` : ''}
                </span>
            </button>
            <a href="${esc(v.mapsUrl)}" target="_blank" rel="noopener" aria-label="Directions to ${esc(v.name)} in Google Maps" title="Open in Google Maps" class="shrink-0 mr-3 w-9 h-9 rounded-full bg-[#007AFF]/10 text-[#007AFF] flex items-center justify-center">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>
            </a>
        </div>`;
}

// Same line heights as the real two lines, so nothing moves when the place arrives.
const HERO_VENUE_LOADING = `
    <span class="block py-[3px]" aria-label="Finding a place"><span class="skeleton block h-[14.6px] w-40 rounded-full"></span></span>
    <span class="block py-[3px]"><span class="skeleton block h-[11.9px] w-56 max-w-full rounded-full"></span></span>`;

const LOADING_ROW = `
    <div class="px-4 py-3 flex items-center gap-3" aria-label="Finding places">
        <div class="space-y-1.5 flex-1"><div class="skeleton h-3.5 w-32 rounded-full"></div><div class="skeleton h-3 w-48 rounded-full"></div></div>
        <div class="skeleton h-6 w-20 rounded-full"></div>
    </div>`;

const ATTRIBUTION = 'Live hours and ratings from Google Maps';

/** Closes the card when every place fits; sits at the card's foot so the card never ends in a gap. */
function attributionRow(live: boolean): string {
    return live ? `<p class="mt-auto px-4 py-1.5 text-[11px] text-[#8E8E93]">${ATTRIBUTION}</p>` : '';
}

/** "N more places", carrying the Google attribution as its caption so it costs no extra row. It sits at
 *  the card's foot, or fills the card when it is the only row, so the card never ends in a blank band. */
function moreRow(count: number, onlyRow: boolean, stationName: string, live: boolean): string {
    const label = onlyRow ? `${count} places by ${esc(stationName)}` : `${count} more place${count === 1 ? '' : 's'}`;
    return `
        <button type="button" data-action="more-venues" class="${onlyRow ? 'flex-1' : 'mt-auto'} w-full text-left px-4 py-2 flex items-center justify-between gap-3 active:bg-black/[0.02]">
            <span class="min-w-0">
                <span class="block text-[14px] font-medium text-[#007AFF]">${label}</span>
                ${live ? `<span class="block text-[11px] text-[#8E8E93]">${ATTRIBUTION}</span>` : ''}
            </span>
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
    // The card always fills its region (a fixed frame); content fits if nothing spills inside it.
    const fits = () => list.scrollHeight <= list.clientHeight + 1;

    if (!rows.length) {
        list.innerHTML = `<p class="px-4 py-3 text-[14px] text-[#6C6C70]">No places to suggest here yet. Share the plan and pick somewhere together.</p>`;
        return;
    }
    list.innerHTML = rows.join('') + attributionRow(live);
    if (fits()) return;
    for (let shown = rows.length - 1; shown >= 0; shown--) {
        const hidden = ordered.length - Math.min(shown, ordered.length);
        list.innerHTML = rows.slice(0, shown).join('') + moreRow(hidden, shown === 0, STATIONS[stationId].name, live);
        if (fits()) return;
    }
}

/** Restarts a one-off fade on an element whose content just arrived. */
function arrive(el: HTMLElement) {
    el.classList.remove('arrive');
    void el.offsetWidth;
    el.classList.add('arrive');
}

/** Which station's places were still loading at the last draw, so their arrival can fade in once. */
let placesLoadingKey = '';

function renderResult() {
    if (!ready()) return show('you');
    const { ranked, current } = currentPick();
    requestVenues(current.stationId, state.kind);
    const placesKey = `${current.stationId}|${state.kind}`;
    const placesLoading = venuesFor(current.stationId).loading;
    const placesArrived = placesLoadingKey === placesKey && !placesLoading;
    placesLoadingKey = placesLoading ? placesKey : '';

    $('heroStationName').textContent = current.station.name;
    $('heroTimeSummary').textContent = `${current.avg}m avg · ${current.max}m max`;
    const spot = selectedVenue(current.stationId);
    $('heroVenue').innerHTML = spot
        ? `<span class="block">then <strong class="font-semibold text-[#1C1C1E]">${esc(spot.name)}</strong></span><span class="block text-[13px] text-[#6C6C70]">${esc(walkText(spot))}</span>`
        : venuesFor(current.stationId).loading
          ? HERO_VENUE_LOADING
          : '';
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
        .map((t) => travellerRow(t, current.journeys.find((j) => j.person.id === t.id)!, current.station.name))
        .join('');
    $('addPersonBtn').classList.toggle('hidden', state.travellers.length >= MAX_TRAVELLERS);

    renderSegments();
    renderKinds();
    renderOpenAt(current.stationId);
    syncUrl();
    fitResult(current.stationId);
    if (placesArrived) {
        arrive($('heroVenue'));
        arrive($('venuesHeader'));
        arrive($('venuesList'));
    }
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

// Room the places card needs, by tier: two places, then one, then just "N places by X".
// Fixed sizes, not the loaded list, so places arriving never changes the layout.
const PLACE_ROW = 72;
const PLACES_EXTRA = 58; // "N more places" row with its Google caption
const placesFloor = (tier: number) => (tier < 3 ? 2 * PLACE_ROW : tier < 6 ? PLACE_ROW : 0) + PLACES_EXTRA;

// Tiers only tighten while the screen size stays the same: live data arriving, picking a place or a
// mode never makes parts of the screen jump in or out. Adding someone or starting again re-plans it.
let fitTier = 0;
let fitFrame = '';
function resetFit() {
    fitTier = 0;
}

function fitResult(stationId: string) {
    const frame = $('appFrame');
    const size = `${frame.clientWidth}x${frame.clientHeight}`;
    if (size !== fitFrame) {
        fitFrame = size;
        fitTier = 0;
    }
    document.documentElement.style.removeProperty('--diagram-max');
    for (const id of ['heroAlternatives', 'heroDiagram', 'heroStationLines', 'venuesHeader', 'modeControl', 'whoHeader']) $(id).classList.remove('hidden');
    $('hero').classList.remove('compact');
    $('heroVenue').classList.toggle('hidden', !$('heroVenue').innerHTML);
    $('travellersList').classList.remove('dense', 'no-detail');
    for (let i = 0; i < fitTier; i++) RESULT_COMPACT[i]();
    while (fitTier < RESULT_COMPACT.length && !(resultFits() && $('venuesBox').clientHeight >= placesFloor(fitTier))) {
        RESULT_COMPACT[fitTier++]();
    }
    renderVenues(stationId);
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
    hideSupport();
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

function distanceText(metres: number): string {
    return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.max(50, Math.round(metres / 50) * 50)} m`;
}

/** Title and detail for the location button. A long station name steps its size down to stay on one
 *  line; only if it still cannot fit does it wrap (never cut). */
function setLocate(title: string, detail: string) {
    $('locateSub').textContent = detail;
    fitLine($('locateLabel'), title);
}

/** Sets a one-line title, stepping its size down to fit; only wraps (never cuts) if it still can't. */
function fitLine(label: HTMLElement, text: string) {
    label.textContent = text;
    label.style.whiteSpace = '';
    for (const size of [16, 15, 14, 13]) {
        label.style.fontSize = `${size}px`;
        if (label.scrollWidth <= label.clientWidth + 1) return;
    }
    label.style.whiteSpace = 'normal';
}

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
    setLocate('Finding you…', 'Allow location if your phone asks');
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            btn.classList.remove('is-locating');
            const { station, metres } = nearestStation(pos.coords.latitude, pos.coords.longitude);
            if (metres > MAX_GPS_DISTANCE_M) {
                renderStep();
                return showToast('You look outside London. Search for a station instead.');
            }
            showToast(`Nearest station: ${station.name}, ${distanceText(metres)} away`);
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
    // The tab the sender is on, so the friend opens the same list and finds the same place.
    path += `&kind=${state.kind}`;
    return `${prefix}${path}${spot ? `&at=${encodeURIComponent(spot.name).replace(/%20/g, '+')}` : ''}`;
}

function syncUrl() {
    history.replaceState(null, '', planUrl());
}

/** The plan as a message for the friend: see message.ts. */
function buildWhatsApp(): string {
    const { current } = currentPick();
    const spot = selectedVenue(current.stationId);
    // The /p link serves a preview card for this exact plan, then opens it.
    const link = SITE + planUrl('/p').replace('/p/?', '/p?');
    const issues = [...new Set(current.journeys.flatMap((j) => (j.route.minutes ? j.route.lines : [])))]
        .filter((l) => lineIssues[l])
        .map((l) => `${lineIssues[l].text.toLowerCase()} on the ${lineLabel(l)}`);
    return planMessage({
        station: current.station.name,
        people: current.journeys.map((j) => {
            const t = traveller(j.person.id)!;
            return { name: isYou(t.id) ? 'Me' : t.name, isSender: isYou(t.id), origin: t.origin!, route: j.route };
        }),
        venue: spot && { name: spot.name, type: spot.type, walkMin: spot.walkMin, exit: spot.exit, street: spot.street },
        issues,
        avoided: avoidedLines(current).map((l) => `the ${lineLabel(l)} (${lineIssues[l].text.toLowerCase()})`),
        link,
    });
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

// The button itself confirms the copy, so nothing pops up over the plan.
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
async function copyForWhatsApp() {
    const label = $('whatsappLabel');
    label.textContent = (await copyText(buildWhatsApp())) ? 'Copied. Now paste it' : 'Couldn’t copy';
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (label.textContent = 'Copy for WhatsApp'), 2600);
}

async function sharePlan() {
    const text = plainMessage(buildWhatsApp());
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
    // The toast owns the slot over the header.
    hideSupport();
    const toast = $('iosToast');
    $('iosToastText').textContent = text;
    toast.classList.remove('opacity-0', '-translate-y-2');
    toast.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', '-translate-y-2');
    }, 2600);
}

// ---------- header: install and fit ----------

interface InstallPrompt extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
type InstallWindow = Window & { __installPrompt?: InstallPrompt | null; __appInstalled?: boolean };
type RelatedApps = Navigator & { getInstalledRelatedApps?: () => Promise<{ platform: string }[]> };

const standalone = () => matchMedia('(display-mode: standalone)').matches;
/** This browser can install web apps (Chrome, Edge, Samsung) and we are not already the installed app. */
const installPossible = () => 'onbeforeinstallprompt' in window && !standalone();
/** getaround is already on this device, so there is nothing to install. */
const installedHere = () => !!(window as InstallWindow).__appInstalled;

// Chrome's own install glyphs: a phone on touch screens, a monitor on computers.
const INSTALL_PHONE = '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M12 7.5v7m-3-3 3 3 3-3"/></svg>';
const INSTALL_DESKTOP = '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8.5 20.5h7M12 16.5v4M12 6.5v6m-2.5-2.5 2.5 2.5 2.5-2.5"/></svg>';

/** Shows the install button from the first frame wherever the browser can install web apps, unless
 *  getaround is already installed. Chrome only offers its own install dialog after a tap and 30 seconds
 *  on the page, so the button never waits for that. It sits leftmost of the right-anchored cluster,
 *  so it going (once installed) never moves anything else. */
function syncInstall() {
    const btn = $('installBtn');
    const can = installPossible() && !installedHere();
    const was = !btn.classList.contains('hidden');
    if (can && !btn.innerHTML) btn.innerHTML = matchMedia('(pointer: coarse)').matches ? INSTALL_PHONE : INSTALL_DESKTOP;
    btn.classList.toggle('hidden', !can);
    btn.classList.toggle('flex', can);
    if (can && !was && !document.documentElement.classList.contains('boot')) arrive(btn);
}

async function installApp() {
    const w = window as InstallWindow;
    const prompt = w.__installPrompt;
    if (!prompt) {
        // Chrome is not offering its dialog yet: point to its own install item instead.
        return showToast(
            matchMedia('(pointer: coarse)').matches
                ? 'To install, open your browser’s ⋮ menu and tap Add to home screen'
                : 'To install, use the install icon in the address bar or your browser’s ⋮ menu',
        );
    }
    // A prompt works once. Chrome offers a new one later if they said no; installing hides the button.
    w.__installPrompt = null;
    try {
        await prompt.prompt();
        if ((await prompt.userChoice).outcome === 'accepted') w.__appInstalled = true;
    } catch {
        // Chrome refused (already shown, or gone): the next tap gives the menu hint.
    }
    syncInstall();
}

/** Already installed from this browser? Chrome can tell us (the manifest names the app), so the
 *  button stays away. Usually answered before the first screen is revealed. */
function checkInstalled() {
    if (!installPossible()) return;
    (navigator as RelatedApps)
        .getInstalledRelatedApps?.()
        .then((apps) => {
            if (!apps.some((a) => a.platform === 'webapp')) return;
            (window as InstallWindow).__appInstalled = true;
            syncInstall();
        })
        .catch(() => {});
}

/** On a narrow phone "Start again" keeps only its icon so the wordmark and the corner buttons fit.
 *  It counts the install button's room whenever install could still be offered, so that button
 *  arriving later never flips this. Runs only when the screen or its size changes. */
function fitHeader() {
    const header = $('appHeader');
    const restart = $('restartBtn');
    restart.classList.remove('icon-only');
    if (restart.classList.contains('hidden')) return;
    const css = getComputedStyle(header);
    const room = header.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) - parseFloat(css.columnGap || '0');
    const actions = $('headerActions');
    const install = $('installBtn');
    const gap = parseFloat(getComputedStyle(actions).columnGap || '0');
    const reserve = installPossible() && install.classList.contains('hidden') ? 32 + gap : 0;
    if ($('homeLink').scrollWidth + actions.scrollWidth + reserve > room + 0.5) restart.classList.add('icon-only');
}

// ---------- feedback ----------

let feedbackOpen = false;
/** A resize that arrived while feedback was open: fit once it closes. */
let fitPending = false;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
let feedbackFocus: HTMLElement | null = null;

function openFeedback() {
    if (feedbackOpen) return;
    hideSupport();
    feedbackOpen = true;
    // The keyboard slides over the screen behind instead of squashing it.
    holdHeight(true);
    feedbackFocus = document.activeElement as HTMLElement | null;
    clearTimeout(feedbackTimer);
    $('feedbackThanks').classList.remove('is-in');
    $('feedbackThanks').setAttribute('aria-hidden', 'true');
    setSendLabel('Send');
    const layer = $('feedbackLayer');
    layer.classList.remove('pointer-events-none');
    layer.classList.add('is-open');
    layer.setAttribute('aria-hidden', 'false');
    layer.querySelector('.sheet-backdrop')!.classList.replace('opacity-0', 'opacity-100');
    $('feedbackBtn').setAttribute('aria-expanded', 'true');
    // Inside the tap, so phones bring the keyboard straight up.
    $('feedbackMessage').focus({ preventScroll: true });
}

function closeFeedback() {
    if (!feedbackOpen) return;
    feedbackOpen = false;
    clearTimeout(feedbackTimer);
    (document.activeElement as HTMLElement | null)?.blur();
    const layer = $('feedbackLayer');
    layer.classList.remove('is-open');
    layer.setAttribute('aria-hidden', 'true');
    layer.querySelector('.sheet-backdrop')!.classList.replace('opacity-100', 'opacity-0');
    $('feedbackBtn').setAttribute('aria-expanded', 'false');
    setTimeout(() => {
        if (!feedbackOpen) layer.classList.add('pointer-events-none');
    }, 300);
    feedbackFocus?.focus({ preventScroll: true });
    // Let the keyboard finish going down before following the screen's height again.
    setTimeout(() => {
        if (feedbackOpen) return;
        holdHeight(false);
        if (fitPending) {
            fitPending = false;
            refit();
        }
    }, 400);
}

let sendLabelTimer: ReturnType<typeof setTimeout> | undefined;
/** The button itself says what happened, so the panel never changes size. */
function setSendLabel(text: string, revertAfter = 0) {
    clearTimeout(sendLabelTimer);
    $('feedbackSendLabel').textContent = text;
    if (revertAfter) sendLabelTimer = setTimeout(() => ($('feedbackSendLabel').textContent = 'Send'), revertAfter);
}

async function sendFeedback(e: Event) {
    e.preventDefault();
    const message = $<HTMLTextAreaElement>('feedbackMessage');
    const email = $<HTMLInputElement>('feedbackEmail');
    const send = $<HTMLButtonElement>('feedbackSend');
    if (send.disabled) return;
    if (!message.value.trim()) {
        message.focus({ preventScroll: true });
        return setSendLabel('Write a note first', 2200);
    }
    if (email.value.trim() && !email.checkValidity()) {
        email.focus({ preventScroll: true });
        return setSendLabel('Check the email address', 2200);
    }
    send.disabled = true;
    setSendLabel('Sending…');
    try {
        const res = await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                message: message.value,
                email: email.value.trim(),
                screen: state.view,
                // The app's own size: held at its pre-keyboard height while this panel is open.
                viewport: `${$('appFrame').clientWidth}x${$('appFrame').clientHeight}`,
                website: $<HTMLInputElement>('feedbackTrap').value,
            }),
        });
        if (!res.ok) throw new Error(String(res.status));
        message.value = '';
        email.value = '';
        setSendLabel('Send');
        (document.activeElement as HTMLElement | null)?.blur();
        $('feedbackThanks').classList.add('is-in');
        $('feedbackThanks').setAttribute('aria-hidden', 'false');
        feedbackTimer = setTimeout(closeFeedback, 1800);
    } catch {
        setSendLabel('Couldn’t send. Try again', 3000);
    } finally {
        send.disabled = false;
    }
}

// ---------- support (the one-off donation note) ----------

let visits = 0;
let supportTimer: ReturnType<typeof setTimeout> | undefined;

/** After the first screen settles, on the second visit or later, once ever. */
function askForSupportSoon() {
    if (!shouldAskForSupport(visits)) return;
    clearTimeout(supportTimer);
    supportTimer = setTimeout(() => {
        // Not over a sheet, the feedback panel or the rotate card: try again next visit.
        const busy =
            feedbackOpen ||
            !$('venuesSheet').classList.contains('pointer-events-none') ||
            document.documentElement.classList.contains('sideways');
        if (busy || !shouldAskForSupport(visits)) return;
        markSupportShown();
        const note = $('supportNote');
        note.inert = false;
        note.setAttribute('aria-hidden', 'false');
        note.classList.add('is-in');
    }, 1200);
}

/** Slides the note away (and cancels it if it was about to come). It never comes back. */
function hideSupport() {
    clearTimeout(supportTimer);
    const note = $('supportNote');
    if (!note.classList.contains('is-in')) return;
    note.classList.remove('is-in');
    note.setAttribute('aria-hidden', 'true');
    note.inert = true;
}

/** Fits whichever screen is showing to the current size. */
function refit() {
    fitHeader();
    if (state.view === 'result') renderResult();
    else fitStep();
}

// ---------- wiring ----------

function bind() {
    $('locateBtn').addEventListener('click', locateUser);
    $('restartBtn').addEventListener('click', restart);
    $('stepBack').addEventListener('click', stepBack);
    $('youRecap').addEventListener('click', () => show('you'));
    $('shareBtn').addEventListener('click', sharePlan);
    $('installBtn').addEventListener('click', installApp);
    window.addEventListener('app:installable', () => {
        syncInstall();
        fitHeader();
    });
    $('feedbackBtn').addEventListener('click', openFeedback);
    $('feedbackPanel').addEventListener('submit', sendFeedback);
    const link = $<HTMLAnchorElement>('supportLink');
    link.href = DONATE_URL;
    // They went to give: thank them by getting out of the way.
    link.addEventListener('click', () => setTimeout(hideSupport, 150));
    $('supportClose').addEventListener('click', hideSupport);
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
        if (el.dataset.close === 'feedback') return closeFeedback();
        switch (el.dataset.action) {
            case 'more-lines':
                lineOffset = Number(el.dataset.offset) || 0;
                return fitStep();
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
        if (e.key !== 'Escape') return;
        if (feedbackOpen) return closeFeedback();
        closeSheet();
        hideSupport();
    });

    window.addEventListener('app:resize', () => {
        // Behind the feedback panel the screen stays exactly as it was; fit once it closes.
        if (feedbackOpen) {
            fitPending = true;
            return;
        }
        refit();
    });
}

/** First load: index.html veils the app (.boot) so it never shows half-built or swaps its type. Once the
 *  first screen is drawn with its real fonts (or after 0.7 s at most) it fades in, once. */
function reveal() {
    const root = document.documentElement;
    if (!root.classList.contains('boot')) return;
    const fonts = document.fonts?.ready ?? Promise.resolve();
    Promise.race([fonts, new Promise((r) => setTimeout(r, 700))]).then(() => {
        refit();
        requestAnimationFrame(() => {
            root.classList.remove('boot');
            askForSupportSoon();
        });
    });
}

function start() {
    initViewport();
    bind();
    requestStatus();
    const plan = parsePlan(location.search);
    const q = new URLSearchParams(location.search);
    state.wantedVenue = q.get('at')?.slice(0, 80) || null;
    const meet = parseOriginSlug(q.get('meet'));
    const mode = q.get('mode');
    if (mode === 'fast' || mode === 'direct') state.mode = mode;
    const kind = q.get('kind');
    if (isVenueKind(kind)) state.kind = kind;
    syncInstall();
    checkInstalled();
    visits = countVisit();
    if (plan) {
        state.travellers = plan.map((origin, i) => ({
            id: i === 0 ? 'you' : i === 1 ? 't1' : `t${i}`,
            name: i === 0 ? 'You' : i === 1 ? 'Friend' : `Friend ${i}`,
            origin,
        }));
        if (meet && STATIONS[meet]) state.overrideStationId = meet;
        // Wait briefly for live status so the plan is drawn once, already routed around disruption.
        $('stepView').classList.add('hidden');
        Promise.race([requestStatus(), new Promise((r) => setTimeout(r, 800))]).then(() => {
            show('result');
            reveal();
        });
    } else {
        show('you');
        reveal();
    }
    document.fonts?.ready.then(() => {
        fitHeader();
        if (state.view === 'result') renderResult();
        else if (!plan) fitStep();
    });
    // A weight first used later (say the semibold "Anywhere on the X line" card) arrives after the
    // screen was measured; measure again so nothing it widens ends up cut off.
    document.fonts?.addEventListener?.('loadingdone', () => {
        if (feedbackOpen) return void (fitPending = true);
        fitHeader();
        if (state.view === 'result') renderResult();
        else if (!$('stepView').classList.contains('hidden')) fitStep();
    });

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
