import './style.css';
import { initViewport } from './viewport';
import { STATIONS, TFL_LINES, type Venue } from './data';
import {
    isValidOrigin,
    lineOrigin,
    nearestStation,
    originLine,
    originLines,
    originName,
    rankStations,
    type Mode,
    type Person,
    type Ranked,
} from './routing';

interface Friend { id: string; name: string; station: string | null; active: boolean }

interface State {
    userStation: string | null;
    mode: Mode;
    overrideStationId: string | null;
    editingTarget: string | null; // 'user' | friend.id
    sheetLineFilter: string | null;
    friends: Friend[];
}

// Beyond this, the nearest covered station is too far to be a sensible "you are here".
const MAX_GPS_DISTANCE_M = 15000;
// Everything must fit on one screen without scrolling; 4 travellers is the most that fits a small phone.
const MAX_FRIENDS = 3;

// Every visit is a one-off: you plus one other person, nothing stored between visits.
const state: State = {
    userStation: null,
    mode: 'fair',
    overrideStationId: null,
    editingTarget: null,
    sheetLineFilter: null,
    friends: [{ id: 'f1', name: 'Friend', station: null, active: true }],
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ---------- ranking ----------

function isReady(): boolean {
    return !!state.userStation && state.friends.every((f) => !f.active || !!f.station);
}

function activePeople(): Person[] {
    return [
        { id: 'user', name: 'You', station: state.userStation!, isUser: true },
        ...state.friends.filter((f) => f.active).map((f) => ({ ...f, station: f.station! })),
    ];
}

function currentPick(): { ranked: Ranked[]; current: Ranked } {
    const ranked = rankStations(activePeople(), state.mode);
    const current = state.overrideStationId
        ? ranked.find((r) => r.stationId === state.overrideStationId) || ranked[0]
        : ranked[0];
    return { ranked, current };
}

// ---------- AI venue suggestions ----------

const aiVenues = new Map<string, Venue[] | 'loading' | 'failed'>();

function requestAiVenues(stationId: string) {
    if (aiVenues.has(stationId)) return;
    aiVenues.set(stationId, 'loading');
    fetch(`/api/venues?station=${encodeURIComponent(stationId)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((body: { venues?: Venue[] }) => {
            aiVenues.set(stationId, Array.isArray(body.venues) ? body.venues : []);
        })
        .catch(() => aiVenues.set(stationId, 'failed'))
        .finally(() => {
            if (isReady() && currentPick().current.stationId === stationId) fitScreen();
        });
}

function venueRow(v: Venue): string {
    const ai = v.source === 'ai';
    return `
        <button type="button" data-action="share-venue" data-venue="${esc(v.name)}" class="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 active:bg-black/[0.02] cursor-pointer transition">
            <div class="min-w-0">
                <h4 class="text-[15px] font-semibold text-[#1C1C1E] truncate">${esc(v.name)}</h4>
                <p class="text-[13px] text-[#8E8E93] truncate">${ai ? '<span class="text-[#007AFF] font-medium">AI pick</span> · ' : ''}${esc(v.detail)}</p>
            </div>
            <span class="shrink-0 text-[12px] font-medium text-[#8E8E93] bg-[#F2F2F7] px-2.5 py-1 rounded-full">${esc(v.walk)} walk</span>
        </button>
    `;
}

const LOADING_ROW = `
    <div class="px-4 py-2.5 flex items-center justify-between gap-3 animate-pulse" aria-label="Finding more spots">
        <div class="space-y-1.5 flex-1 py-0.5">
            <div class="h-3.5 w-32 rounded-full bg-[#F2F2F7]"></div>
            <div class="h-3 w-48 rounded-full bg-[#F2F2F7]"></div>
        </div>
        <div class="h-6 w-16 rounded-full bg-[#F2F2F7]"></div>
    </div>
`;

function moreRow(count: number, loading: boolean, onlyRow: boolean, stationName: string): string {
    const label = onlyRow
        ? `${count} spot${count === 1 ? '' : 's'} by ${esc(stationName)}`
        : `${count} more spot${count === 1 ? '' : 's'}`;
    return `
        <button type="button" data-action="more-venues" class="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 active:bg-black/[0.02]">
            <span class="text-[14px] font-medium text-[#007AFF] truncate">${label}${loading ? ' · finding more…' : ''}</span>
            <span class="text-[#C7C7CC] text-[18px]" aria-hidden="true">›</span>
        </button>
    `;
}

function venuesFor(stationId: string): { venues: Venue[]; loading: boolean } {
    const extra = aiVenues.get(stationId);
    return {
        venues: [...(STATIONS[stationId].venues || []), ...(Array.isArray(extra) ? extra : [])],
        loading: extra === 'loading',
    };
}

/** Renders as many venue rows as fit the space left on screen; the rest sit behind "N more spots". */
function renderVenues(stationId: string) {
    const { venues, loading } = venuesFor(stationId);
    const list = $('venuesList');
    const box = $('venuesBox');
    const rows = venues.map(venueRow);
    if (loading) rows.push(LOADING_ROW);

    const fits = () => list.offsetHeight <= box.clientHeight + 1;
    list.innerHTML = rows.join('');
    if (fits()) return true;
    for (let shown = rows.length - 1; shown >= 0; shown--) {
        const hidden = venues.length - Math.min(shown, venues.length);
        list.innerHTML = rows.slice(0, shown).join('') + moreRow(hidden, loading, shown === 0, STATIONS[stationId].name);
        if (fits()) return shown >= Math.min(1, venues.length);
    }
    list.innerHTML = '';
    return false;
}

function openVenuesSheet() {
    const { current } = currentPick();
    const { venues, loading } = venuesFor(current.stationId);
    $('venuesSheetTitle').textContent = `Spots by ${current.station.name}`;
    $('venuesSheetList').innerHTML = venues.map(venueRow).join('') + (loading ? LOADING_ROW : '');
    openSheet('venuesSheet', 'venuesBackdrop', 'venuesPanel');
}

// ---------- one-screen fit ----------

// Applied in order until everything fits: shrink the diagram, drop the alternatives,
// drop the diagram, drop the line pills. Venue rows beyond the space go behind "More".
const COMPACT_STEPS: (() => void)[] = [
    () => document.documentElement.style.setProperty('--diagram-max', '96px'),
    () => document.documentElement.style.setProperty('--diagram-max', '70px'),
    () => $('heroAlternatives').classList.add('hidden'),
    () => $('heroDiagram').classList.add('hidden'),
    () => $('heroStationLines').classList.add('hidden'),
    () => $('venuesHeader').classList.add('hidden'),
    () => $('travellersList').classList.add('dense'),
];

function screenFits(): boolean {
    const main = $('screen');
    return main.scrollHeight <= main.clientHeight + 1;
}

function fitScreen() {
    const ready = isReady();
    document.documentElement.style.removeProperty('--diagram-max');
    for (const id of ['heroAlternatives', 'heroDiagram', 'heroStationLines']) {
        $(id).classList.toggle('hidden', !ready && id !== 'heroStationLines');
    }
    $('venuesHeader').classList.remove('hidden');
    $('travellersList').classList.remove('dense');
    if (!ready) return;
    const stationId = currentPick().current.stationId;
    const wanted = Math.min(2, venuesFor(stationId).venues.length);
    const venuesReachable = () =>
        !!$('venuesList').querySelector('[data-action="more-venues"]') ||
        $('venuesList').querySelectorAll('[data-action="share-venue"]').length === venuesFor(stationId).venues.length;
    // First try to keep a couple of real venue rows; failing that, settle for the venues being reachable.
    for (let step = 0; ; step++) {
        renderVenues(stationId);
        const shown = $('venuesList').querySelectorAll('[data-action="share-venue"]').length;
        const ok = screenFits() && (shown >= wanted || (step >= 3 && venuesReachable()));
        if (ok || step >= COMPACT_STEPS.length) break;
        COMPACT_STEPS[step]();
    }
}

// ---------- rendering ----------

function renderConvergenceDiagram(winner: Ranked) {
    const svg = $('convergenceSvg') as unknown as SVGSVGElement;
    const journeys = winner.journeys;
    const count = journeys.length;
    const rowHeight = 32;
    const totalHeight = Math.max(96, (count - 1) * rowHeight + 44);
    const midY = totalHeight / 2;

    svg.setAttribute('viewBox', `0 0 340 ${totalHeight}`);

    let html = '';
    journeys.forEach((j, i) => {
        const y = count === 1 ? midY : 22 + i * ((totalHeight - 44) / (count - 1));
        const lineColor = TFL_LINES[j.route.lines[0]]?.color || '#007AFF';
        const startStName = originName(j.person.station);

        html += `
            <path d="M 118 ${y} C 185 ${y}, 195 ${midY}, 258 ${midY}"
                  fill="none" stroke="${lineColor}" stroke-width="2.5" stroke-linecap="round" opacity="0.85" />
        `;

        const pillX = 176;
        const pillY = y * 0.58 + midY * 0.42;
        html += `
            <rect x="${pillX - 18}" y="${pillY - 9}" width="36" height="18" rx="9" fill="#F2F2F7" />
            <text x="${pillX}" y="${pillY + 3.5}" text-anchor="middle" fill="#1C1C1E" font-size="10" font-weight="600">${j.route.minutes}m</text>
        `;

        html += `
            <circle cx="118" cy="${y}" r="4.5" fill="${lineColor}" stroke="#FFFFFF" stroke-width="1.5" />
            <text x="106" y="${y - 2}" text-anchor="end" fill="#1C1C1E" font-size="12" font-weight="600">${esc(j.person.name.slice(0, 12))}</text>
            <text x="106" y="${y + 10}" text-anchor="end" fill="#8E8E93" font-size="9.5" font-weight="500">${esc(startStName)}</text>
        `;
    });

    html += `
        <circle cx="272" cy="${midY}" r="22" fill="#34C759" class="pulse-halo" />
        <circle cx="272" cy="${midY}" r="11" fill="#FFFFFF" stroke="#1C1C1E" stroke-width="4" />
        <rect x="256" y="${midY - 3}" width="32" height="6" rx="3" fill="#1C1C1E" />
        <text x="272" y="${midY + 28}" text-anchor="middle" fill="#1C1C1E" font-size="10.5" font-weight="700">MEET</text>
    `;

    svg.innerHTML = html;
}

function renderSegments() {
    (['fair', 'fast', 'direct'] as Mode[]).forEach((m) => {
        const btn = $(`seg-${m}`);
        const on = m === state.mode;
        btn.className = on
            ? 'py-1.5 rounded-xl transition bg-white text-[#1C1C1E] shadow-sm font-semibold'
            : 'py-1.5 rounded-xl transition text-[#8E8E93] hover:text-[#1C1C1E]';
        btn.setAttribute('aria-checked', String(on));
    });
}

function arrivedText(origin: string, atStation: string): string {
    const line = originLine(origin);
    return line ? `Meet on their ${TFL_LINES[line].name} line` : atStation;
}

function viaText(lines: string[], board?: string): string {
    const via = lines.map((l) => TFL_LINES[l].name).join(' → ');
    return board ? `Join at ${STATIONS[board].name} · ${via}` : `Via ${via}`;
}

function setReadyVisible(ready: boolean) {
    for (const id of ['heroTimeSummary', 'venuesSection']) {
        $(id).classList.toggle('hidden', !ready);
    }
    $('heroSetupHint').classList.toggle('hidden', ready);
}

function setupRow(target: string, avatar: string, avatarClass: string, title: string, prompt: string): string {
    return `
        <button type="button" data-action="edit-station" data-target="${esc(target)}" class="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 active:bg-black/[0.02] cursor-pointer transition">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-8 h-8 rounded-full ${avatarClass} text-[12px] font-bold flex items-center justify-center shrink-0">${avatar}</div>
                <div class="min-w-0">
                    <span class="block text-[15px] font-semibold text-[#1C1C1E] truncate">${title}</span>
                    <span class="block text-[12px] text-[#007AFF] font-medium mt-0.5">${prompt}</span>
                </div>
            </div>
            <span class="text-[#C7C7CC] text-[18px] shrink-0" aria-hidden="true">›</span>
        </button>
    `;
}

function renderSetup() {
    setReadyVisible(false);
    $('heroStationName').textContent = 'Where are you both?';
    $('heroStationLines').innerHTML = '';

    let rows = state.userStation
        ? setupRow('user', 'You', 'bg-[#007AFF] text-white', esc(originName(state.userStation)), 'Change')
        : setupRow('user', 'You', 'bg-[#007AFF] text-white', 'Your station', 'Tap to choose · or use ➤ to locate');
    for (const f of state.friends.filter((x) => x.active)) {
        rows += f.station
            ? setupRow(f.id, esc(f.name.slice(0, 2).toUpperCase()), 'bg-[#F2F2F7] text-[#1C1C1E]', `${esc(f.name)} · ${esc(originName(f.station))}`, 'Change')
            : setupRow(f.id, esc(f.name.slice(0, 2).toUpperCase()), 'bg-[#F2F2F7] text-[#1C1C1E]', `${esc(f.name)}’s station`, 'Tap to choose');
    }
    $('travellersList').innerHTML = rows;
    fitScreen();
}

function renderApp() {
    if (!isReady()) return renderSetup();
    setReadyVisible(true);
    const { ranked, current } = currentPick();

    // 1. Hero Card
    $('heroStationName').textContent = current.station.name;
    $('heroTimeSummary').textContent = `${current.avg}m avg · ${current.max}m max`;
    $('heroStationLines').innerHTML = current.station.lines
        .map((l) => {
            const line = TFL_LINES[l];
            return `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F2F2F7] text-[12px] font-medium text-[#1C1C1E]">
                    <span class="w-2 h-2 rounded-full" style="background:${line.color}"></span>
                    ${line.name}
                </span>
            `;
        })
        .join('');

    renderConvergenceDiagram(current);

    // 2. Alternatives Strip
    $('alternativesContainer').innerHTML = ranked
        .filter((r) => r.stationId !== current.stationId || state.overrideStationId)
        .slice(0, state.overrideStationId ? 3 : 2)
        .map((r) => {
            const isSelected = r.stationId === current.stationId;
            return `
                <button type="button" data-action="alternative" data-station="${r.stationId}" aria-pressed="${isSelected}" class="px-2.5 py-0.5 rounded-full text-[12px] font-medium shrink-0 transition ${
                    isSelected ? 'bg-[#1C1C1E] text-white' : 'bg-[#F2F2F7] text-[#1C1C1E] hover:bg-[#E5E5EA]'
                }">
                    ${r.station.name} · ${r.avg}m
                </button>
            `;
        })
        .join('');

    // 3. Travellers Grouped List
    const userJourney = current.journeys.find((j) => j.person.id === 'user')!;
    const userOrigin = state.userStation!;
    const userLines = originLines(userOrigin);
    const userPrimaryLine = TFL_LINES[userJourney.route.lines[0]];

    let rowsHTML = `
        <button type="button" data-action="edit-station" data-target="user" class="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 active:bg-black/[0.02] cursor-pointer transition">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-8 h-8 rounded-full bg-[#007AFF] text-white text-[12px] font-bold flex items-center justify-center shrink-0">You</div>
                <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                        <span class="text-[15px] font-semibold text-[#1C1C1E] truncate">${esc(originName(userOrigin))}</span>
                        <span class="text-[11px] text-[#007AFF] font-medium">Change</span>
                    </div>
                    <div class="flex items-center gap-1.5 mt-0.5">
                        <span class="w-2 h-2 rounded-full shrink-0" style="background:${userPrimaryLine.color}"></span>
                        <span class="text-[12px] text-[#8E8E93] truncate">
                            ${userJourney.route.minutes === 0 ? arrivedText(userOrigin, 'Already at meetup station') : viaText(userJourney.route.lines, userJourney.route.board)}
                        </span>
                    </div>
                </div>
            </div>
            <div class="text-right shrink-0">
                <span class="text-[15px] font-semibold text-[#1C1C1E]">${userJourney.route.minutes} min</span>
                <span class="block text-[11px] text-[#8E8E93]">${userJourney.route.transfers === 0 ? 'Direct' : `${userJourney.route.transfers} change`}</span>
            </div>
        </button>
    `;

    for (const friend of state.friends) {
        if (!friend.station) continue;
        const friendLines = originLines(friend.station);
        const j = current.journeys.find((item) => item.person.id === friend.id);
        const lineObj = j ? TFL_LINES[j.route.lines[0]] : TFL_LINES[friendLines[0]];
        const sharedLineId = friendLines.find((l) => userLines.includes(l));
        const name = esc(friend.name);

        rowsHTML += `
            <div class="px-4 py-2.5 flex items-center justify-between gap-3 ${friend.active ? '' : 'opacity-45'} transition">
                <button type="button" data-action="edit-station" data-target="${esc(friend.id)}" class="text-left flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
                    <div class="w-8 h-8 rounded-full bg-[#F2F2F7] text-[#1C1C1E] text-[13px] font-semibold flex items-center justify-center shrink-0">
                        ${esc(friend.name.slice(0, 2).toUpperCase())}
                    </div>
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5 min-w-0">
                            <span class="text-[15px] font-semibold text-[#1C1C1E] truncate shrink-0 max-w-[60%]">${name}</span>
                            <span class="text-[13px] text-[#8E8E93] truncate min-w-0">· ${esc(originName(friend.station))}</span>
                        </div>
                        <div class="flex items-center gap-1.5 mt-0.5 min-w-0">
                            <span class="w-2 h-2 rounded-full shrink-0" style="background:${lineObj.color}"></span>
                            <span class="text-[12px] text-[#8E8E93] truncate">
                                ${!friend.active ? 'Not in this meetup' : j!.route.minutes === 0 ? arrivedText(friend.station, 'Already there') : viaText(j!.route.lines, j!.route.board)}
                                ${friend.active && sharedLineId ? ` · <span class="text-[#007AFF] font-medium">Same line as you</span>` : ''}
                            </span>
                        </div>
                    </div>
                </button>

                <div class="flex items-center gap-3 shrink-0">
                    ${friend.active && j ? `
                        <button type="button" data-action="edit-station" data-target="${esc(friend.id)}" class="text-right cursor-pointer">
                            <span class="block text-[15px] font-semibold text-[#1C1C1E]">${j.route.minutes} min</span>
                            <span class="block text-[11px] text-[#8E8E93]">${j.route.transfers === 0 ? 'Direct' : `${j.route.transfers} chg`}</span>
                        </button>
                    ` : ''}
                    <button type="button" data-action="toggle-friend" data-friend="${esc(friend.id)}" role="switch" aria-checked="${friend.active}" aria-label="Include ${name}" class="w-11 h-6 rounded-full p-0.5 transition-colors duration-200 ${friend.active ? 'bg-[#34C759]' : 'bg-[#E5E5EA]'}">
                        <div class="w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${friend.active ? 'translate-x-5' : 'translate-x-0'}"></div>
                    </button>
                </div>
            </div>
        `;
    }

    $('travellersList').innerHTML = rowsHTML;

    // 4. Venues: curated first, AI suggestions appended when they arrive
    $('venueStationLabel').textContent = `${current.station.name} Exit`;
    requestAiVenues(current.stationId);
    fitScreen();
}

// ---------- actions ----------

function setMode(mode: Mode) {
    state.mode = mode;
    state.overrideStationId = null;
    renderSegments();
    renderApp();
}

function toggleFriend(friendId: string) {
    const activeCount = state.friends.filter((f) => f.active).length;
    const target = state.friends.find((f) => f.id === friendId);
    if (!target) return;
    if (target.active && activeCount <= 1) {
        showToast('Keep at least 1 friend active');
        return;
    }
    target.active = !target.active;
    state.overrideStationId = null;
    renderApp();
}

let lastFocus: HTMLElement | null = null;

function openSheet(sheetId: string, backdropId: string, panelId: string) {
    lastFocus = document.activeElement as HTMLElement | null;
    const sheet = $(sheetId);
    sheet.classList.remove('pointer-events-none');
    sheet.setAttribute('aria-hidden', 'false');
    $(backdropId).classList.replace('opacity-0', 'opacity-100');
    $(panelId).classList.replace('translate-y-full', 'translate-y-0');
}

function closeSheet(sheetId: string, backdropId: string, panelId: string) {
    const sheet = $(sheetId);
    if (sheet.classList.contains('pointer-events-none')) return;
    $(backdropId).classList.replace('opacity-100', 'opacity-0');
    $(panelId).classList.replace('translate-y-0', 'translate-y-full');
    sheet.setAttribute('aria-hidden', 'true');
    (document.activeElement as HTMLElement | null)?.blur();
    setTimeout(() => sheet.classList.add('pointer-events-none'), 300);
    lastFocus?.focus({ preventScroll: true });
}

const closeStationSheet = () => closeSheet('stationSheet', 'sheetBackdrop', 'sheetPanel');
const closeAddFriendSheet = () => closeSheet('addFriendSheet', 'addFriendBackdrop', 'addFriendPanel');
const closeVenuesSheet = () => closeSheet('venuesSheet', 'venuesBackdrop', 'venuesPanel');

function openStationSheet(targetId: string) {
    state.editingTarget = targetId;
    state.sheetLineFilter = null;
    $<HTMLInputElement>('stationSearchInput').value = '';

    const friend = state.friends.find((f) => f.id === targetId);
    $('sheetTitle').textContent = targetId === 'user' ? 'Your Nearest Station' : `${friend?.name}'s Nearest Station`;

    openSheet('stationSheet', 'sheetBackdrop', 'sheetPanel');
    renderSheetStations();
}

function renderSheetLineFilters() {
    const query = $<HTMLInputElement>('stationSearchInput').value.trim();
    const box = $('sheetLineFilter');
    box.classList.toggle('hidden', !!query);
    box.innerHTML = Object.values(TFL_LINES)
        .map((l) => {
            const active = state.sheetLineFilter === l.id;
            return `
            <button type="button" data-action="line-filter" data-line="${l.id}" aria-pressed="${active}" class="px-2.5 py-1 rounded-full text-[12px] font-medium inline-flex items-center gap-1.5 transition ${
                active ? 'bg-[#1C1C1E] text-white' : 'bg-white text-[#1C1C1E]'
            }">
                <span class="w-2 h-2 rounded-full" style="background:${l.color}"></span>
                ${l.name}
            </button>`;
        })
        .join('');
}

function editingOrigin(): string | null | undefined {
    return state.editingTarget === 'user'
        ? state.userStation
        : state.friends.find((f) => f.id === state.editingTarget)?.station;
}

function stationResultRow(st: (typeof STATIONS)[string], selected: boolean): string {
    return `
        <button type="button" data-action="choose-station" data-station="${st.id}" class="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 active:bg-black/[0.03]">
            <div class="min-w-0">
                <div class="text-[15px] font-semibold truncate ${selected ? 'text-[#007AFF]' : 'text-[#1C1C1E]'}">${esc(st.name)}</div>
                <div class="flex items-center gap-2 mt-0.5 overflow-hidden whitespace-nowrap">
                    ${st.lines
                        .map(
                            (l) => `<span class="inline-flex items-center gap-1 text-[11px] text-[#8E8E93]"><span class="w-2 h-2 rounded-full" style="background:${TFL_LINES[l].color}"></span>${TFL_LINES[l].name}</span>`,
                        )
                        .join('')}
                </div>
            </div>
            ${selected ? `<span class="text-[#007AFF] font-bold text-sm">✓</span>` : ''}
        </button>`;
}

/** Search → matching rows (trimmed to fit). Line picked → "anywhere on it" + its stops as chips. */
function renderSheetStations() {
    renderSheetLineFilters();
    const query = $<HTMLInputElement>('stationSearchInput').value.trim().toLowerCase();
    const current = editingOrigin();
    const box = $('sheetResults');
    const card = (inner: string) => `<div class="bg-white rounded-[20px] ios-shadow divide-y divide-black/[0.05] overflow-hidden">${inner}</div>`;
    const fits = () => (box.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;

    if (query) {
        const matches = Object.values(STATIONS)
            .filter((st) => st.name.toLowerCase().includes(query))
            .sort((a, b) => {
                const ap = a.name.toLowerCase().startsWith(query) ? 0 : 1;
                const bp = b.name.toLowerCase().startsWith(query) ? 0 : 1;
                return ap - bp || a.name.localeCompare(b.name);
            });
        if (!matches.length) {
            box.innerHTML = `<div class="py-5 text-center text-[14px] text-[#8E8E93]">No stations match “${esc(query)}”</div>`;
            return;
        }
        const rows = matches.map((st) => stationResultRow(st, st.id === current));
        for (let shown = rows.length; shown >= 1; shown--) {
            const hidden = rows.length - shown;
            box.innerHTML = card(
                rows.slice(0, shown).join('') +
                    (hidden ? `<div class="px-4 py-2 text-[12px] text-[#8E8E93]">+${hidden} more — keep typing</div>` : ''),
            );
            if (fits() <= box.clientHeight + 1) return;
        }
        return;
    }

    const lineId = state.sheetLineFilter;
    if (!lineId) {
        const label = current ? `Currently: <span class="text-[#1C1C1E] font-medium">${esc(originName(current))}</span>` : '';
        box.innerHTML = `<div class="pt-1 text-[13px] text-[#8E8E93] leading-snug">Tap a line to see its stops, or search above.${label ? `<br>${label}` : ''}</div>`;
        return;
    }

    const line = TFL_LINES[lineId];
    const origin = lineOrigin(lineId);
    const stops = Object.values(STATIONS)
        .filter((st) => st.lines.includes(lineId))
        .sort((a, b) => a.name.localeCompare(b.name));
    box.innerHTML = `
        <button type="button" data-action="choose-station" data-station="${origin}" class="w-full text-left bg-white rounded-[18px] ios-shadow px-4 py-2.5 flex items-center justify-between gap-3 active:bg-black/[0.03]">
            <div class="flex items-center gap-3 min-w-0">
                <span class="w-3 h-3 rounded-full shrink-0" style="background:${line.color}"></span>
                <div class="min-w-0">
                    <div class="text-[15px] font-semibold truncate ${origin === current ? 'text-[#007AFF]' : 'text-[#1C1C1E]'}">Anywhere on the ${line.name} line</div>
                    <div class="text-[11px] text-[#8E8E93]">Any stop works — we’ll pick the best one</div>
                </div>
            </div>
            ${origin === current ? `<span class="text-[#007AFF] font-bold text-sm">✓</span>` : ''}
        </button>
        <div class="mt-2.5 flex flex-wrap gap-1.5">
            ${stops
                .map(
                    (st) => `
                <button type="button" data-action="choose-station" data-station="${st.id}" class="px-3 py-1.5 rounded-full text-[13px] font-medium transition ${
                    st.id === current ? 'bg-[#007AFF] text-white' : 'bg-white text-[#1C1C1E] ios-shadow'
                }">${esc(st.name)}</button>`,
                )
                .join('')}
        </div>`;
}

function chooseStation(stationId: string) {
    if (!isValidOrigin(stationId)) return;
    if (state.editingTarget === 'user') {
        state.userStation = stationId;
        showToast(originLine(stationId) ? `You → anywhere on the ${originName(stationId)}` : `Located at ${originName(stationId)}`);
    } else {
        const friend = state.friends.find((f) => f.id === state.editingTarget);
        if (friend) {
            friend.station = stationId;
            friend.active = true;
            showToast(`${friend.name} → ${originName(stationId)}`);
        }
    }
    state.overrideStationId = null;
    closeStationSheet();
    renderApp();
}

function openAddFriendSheet() {
    if (state.friends.length >= MAX_FRIENDS) {
        showToast(`Up to ${MAX_FRIENDS + 1} people per meetup`);
        return;
    }
    const select = $<HTMLSelectElement>('newFriendStationSelect');
    const sorted = Object.values(STATIONS).sort((a, b) => a.name.localeCompare(b.name));
    select.innerHTML =
        `<optgroup label="Stations">${sorted.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</optgroup>` +
        `<optgroup label="Anywhere on a line">${Object.values(TFL_LINES)
            .map((l) => `<option value="${lineOrigin(l.id)}">Anywhere on the ${l.name} line</option>`)
            .join('')}</optgroup>`;
    $<HTMLInputElement>('newFriendNameInput').value = '';
    openSheet('addFriendSheet', 'addFriendBackdrop', 'addFriendPanel');
}

function confirmAddFriend() {
    const name = $<HTMLInputElement>('newFriendNameInput').value.trim().slice(0, 24);
    const station = $<HTMLSelectElement>('newFriendStationSelect').value;
    if (!isValidOrigin(station)) return;
    if (!name) {
        showToast('Enter a name first');
        return;
    }
    if (state.friends.length >= MAX_FRIENDS) return;
    state.friends.push({ id: 'f_' + Date.now(), name, station, active: true });
    state.overrideStationId = null;
    closeAddFriendSheet();
    renderApp();
    showToast(`Added ${name}`);
}

function locateUser(quiet = false) {
    if (!('geolocation' in navigator)) {
        if (!quiet) showToast('Location isn’t available on this device');
        return;
    }
    const btn = $('locateBtn');
    if (btn.classList.contains('is-locating')) return;
    btn.classList.add('is-locating');
    if (!quiet) showToast('Finding your nearest station…');

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            btn.classList.remove('is-locating');
            const { station, metres } = nearestStation(pos.coords.latitude, pos.coords.longitude);
            if (metres > MAX_GPS_DISTANCE_M) {
                if (quiet) return;
                showToast('You look outside central London — pick a station');
                openStationSheet('user');
                return;
            }
            state.userStation = station.id;
            state.overrideStationId = null;
            renderApp();
            const km = metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 10) * 10} m`;
            showToast(`Nearest station: ${station.name} · ${km}`);
        },
        (err) => {
            btn.classList.remove('is-locating');
            if (!quiet) showToast(err.code === err.PERMISSION_DENIED ? 'Location permission denied' : 'Couldn’t get your location');
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 },
    );
}

function buildPlan(venueName: string | null) {
    const { current } = currentPick();
    const spot = venueName || current.station.venues?.[0]?.name || current.station.name;
    const lines = current.journeys
        .map(
            (j) =>
                `• ${j.person.name}: ${j.route.minutes}m from ${j.route.board ? `${STATIONS[j.route.board].name}, ${originName(j.person.station)}` : originName(j.person.station)} (${j.route.lines
                    .map((l) => TFL_LINES[l].name)
                    .join(' → ')})`,
        )
        .join('\n');
    return { spot, text: `Meet at ${current.station.name} (${spot}) — ${current.avg} min avg\n${lines}` };
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

async function sharePlan(venueName: string | null = null) {
    if (!isReady()) {
        showToast('Pick both stations first');
        return;
    }
    const { spot, text } = buildPlan(venueName);
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        try {
            await navigator.share({ title: 'Midpoint meetup', text });
            return;
        } catch (err) {
            if ((err as DOMException).name === 'AbortError') return;
        }
    }
    showToast((await copyText(text)) ? `Copied invite for ${spot}` : 'Couldn’t copy — try again');
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
    }, 2200);
}

// ---------- wiring ----------

function bind() {
    $('locateBtn').addEventListener('click', () => locateUser());
    $('shareBtn').addEventListener('click', () => sharePlan());
    $('addFriendBtn').addEventListener('click', openAddFriendSheet);
    $('stationSearchInput').addEventListener('input', renderSheetStations);
    $('addFriendPanel').addEventListener('submit', (e) => {
        e.preventDefault();
        confirmAddFriend();
    });

    document.querySelectorAll<HTMLElement>('[data-mode]').forEach((btn) =>
        btn.addEventListener('click', () => setMode(btn.dataset.mode as Mode)),
    );

    document.addEventListener('click', (e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action], [data-close]');
        if (!el) return;
        if (el.dataset.close === 'station') return closeStationSheet();
        if (el.dataset.close === 'friend') return closeAddFriendSheet();
        if (el.dataset.close === 'venues') return closeVenuesSheet();

        switch (el.dataset.action) {
            case 'alternative':
                state.overrideStationId = el.dataset.station!;
                return renderApp();
            case 'edit-station':
                return openStationSheet(el.dataset.target!);
            case 'toggle-friend':
                return toggleFriend(el.dataset.friend!);
            case 'line-filter': {
                const line = el.dataset.line || null;
                state.sheetLineFilter = state.sheetLineFilter === line ? null : line;
                return renderSheetStations();
            }
            case 'more-venues':
                return openVenuesSheet();
            case 'choose-station':
                return chooseStation(el.dataset.station!);
            case 'share-venue':
                closeVenuesSheet();
                return sharePlan(el.dataset.venue ?? null);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        closeStationSheet();
        closeAddFriendSheet();
        closeVenuesSheet();
    });

    // Visible area changed (browser chrome, keyboard, rotation): re-fit everything.
    window.addEventListener('app:resize', () => {
        fitScreen();
        if ($('stationSheet').getAttribute('aria-hidden') === 'false') renderSheetStations();
    });
}

initViewport();
bind();
renderSegments();
renderApp();
document.fonts?.ready.then(() => fitScreen());

// If location was already granted on a previous visit, fill in "You" without prompting.
navigator.permissions
    ?.query({ name: 'geolocation' })
    .then((p) => {
        if (p.state === 'granted' && !state.userStation) locateUser(true);
    })
    .catch(() => {});
