// London's rail network (generated from TfL open data in network.ts) plus our own picks for the
// stations the app launched with. Ride times are estimated in-train minutes; the router adds interchanges.
import { NET_EDGES, NET_LINES, NET_STATIONS, NET_WALKS } from './network.js';

export type LineMode = 'tube' | 'dlr' | 'overground' | 'elizabeth-line' | 'tram' | 'national-rail';
export interface Line { id: string; name: string; color: string; mode: LineMode }
export interface Venue { name: string; detail: string; walk: string; source?: 'curated' | 'ai' }
export interface Station {
    id: string;
    name: string;
    lat: number;
    lng: number;
    /** Lowest TfL fare zone; 0 for tram stops, which have none. */
    zone: number;
    lines: string[];
    venues: Venue[];
    /** Other stations a short walk away: [stationId, minutes]. */
    walks: [string, number][];
    /** A sensible place to suggest meeting: central, or an interchange further out. */
    meet: boolean;
    /** One of the stations we write guide pages for. */
    featured: boolean;
}

const MODE_ORDER: LineMode[] = ['tube', 'elizabeth-line', 'overground', 'dlr', 'tram', 'national-rail'];

export const TFL_LINES: Record<string, Line> = Object.fromEntries(
    NET_LINES.map(([id, name, color, mode]) => [id, { id, name, color, mode: mode as LineMode }]),
);

/** How a line reads in a sentence: "Victoria line", "Lioness line", "DLR", "Southern". */
export function lineLabel(id: string): string {
    const l = TFL_LINES[id];
    if (l.mode === 'tube' || l.mode === 'overground' || l.mode === 'elizabeth-line') return `${l.name} line`;
    return l.mode === 'tram' ? 'tram' : l.name;
}

/** "Victoria then Jubilee line", or "South Western Railway, then Jubilee line" once rail joins in. */
export function linesPhrase(lines: string[]): string {
    const labels = lines.map(lineLabel);
    return labels.every((l) => l.endsWith(' line')) ? `${lines.map((l) => TFL_LINES[l].name).join(' then ')} line` : labels.join(', then ');
}

/** "Any Northern line stop", "Any DLR stop", "Any tram stop". */
export function anyStopOn(line: string): string {
    return `Any ${lineLabel(line)} stop`;
}

/** Lines someone can say "anywhere on the X" about: Tube, Elizabeth, Overground, DLR, tram. */
// Busiest first, so small screens show the lines most people mean before "+N more lines".
const LINE_ORDER = [
    'victoria', 'central', 'northern', 'jubilee', 'piccadilly', 'elizabeth', 'district', 'circle', 'bakerloo', 'metropolitan',
    'hammersmith-city', 'waterloo-city', 'mildmay', 'windrush', 'lioness', 'weaver', 'suffragette', 'liberty', 'dlr', 'tram',
];
export const PICKABLE_LINES: string[] = Object.values(TFL_LINES)
    .filter((l) => l.mode !== 'national-rail')
    .map((l) => l.id)
    .sort((a, b) => (LINE_ORDER.indexOf(a) + 1 || 99) - (LINE_ORDER.indexOf(b) + 1 || 99));

// Our own picks near the stations the app launched with; Google Places covers everywhere live.
const CURATED: Record<string, Venue[]> = {
    kings_cross: [
        { name: "The Lighterman", detail: "Canalside pub · Granary Sq", walk: "3m" },
        { name: "Caravan Coffee", detail: "All-day roastery & tables", walk: "4m" },
    ],
    euston: [
        { name: "The Euston Tap", detail: "Craft beer lodge at station gate", walk: "1m" },
        { name: "Drummond Villa", detail: "Quiet neighbourhood tavern", walk: "3m" },
    ],
    oxford_circus: [
        { name: "The Clachan", detail: "Historic pub off Carnaby St", walk: "2m" },
        { name: "Kingly Court", detail: "Covered 3-storey courtyard", walk: "3m" },
    ],
    tottenham_court_road: [
        { name: "Arcade Food Hall", detail: "Group tables under Centre Point", walk: "1m" },
        { name: "The Toucan", detail: "Classic Soho Square pub", walk: "2m" },
    ],
    bond_street: [
        { name: "Mercato Mayfair", detail: "Vaulted church food hall", walk: "3m" },
        { name: "The Coach & Horses", detail: "St Christopher’s Place pub", walk: "2m" },
    ],
    baker_street: [
        { name: "The Globe", detail: "Directly opposite station exit", walk: "1m" },
        { name: "Monocle Café", detail: "Calm Chiltern St coffee spot", walk: "4m" },
    ],
    paddington: [
        { name: "Pergola Paddington", detail: "Covered rooftop gardens", walk: "2m" },
        { name: "Mad Bishop & Bear", detail: "Inside Paddington concourse", walk: "1m" },
    ],
    notting_hill_gate: [
        { name: "Churchill Arms", detail: "Iconic flower-clad pub", walk: "4m" },
        { name: "Guillam Coffee", detail: "Single-origin espresso lounge", walk: "1m" },
    ],
    shepherds_bush: [
        { name: "Defectors Weld", detail: "Spacious green-side pub", walk: "1m" },
        { name: "Albertine Wine Bar", detail: "Cosy neighborhood wine bar", walk: "4m" },
    ],
    south_kensington: [
        { name: "The Hoop & Toy", detail: "By the pedestrian piazza", walk: "1m" },
        { name: "Hjem Kensington", detail: "Danish bakery & coffee", walk: "2m" },
    ],
    green_park: [
        { name: "Shepherd Market", detail: "Hidden Mayfair village square", walk: "3m" },
        { name: "The Red Lion", detail: "Historic Crown Passage snug", walk: "4m" },
    ],
    piccadilly_circus: [
        { name: "Soho Grind", detail: "Espresso bar & cocktails", walk: "3m" },
        { name: "St James’s Market", detail: "Quiet pedestrian courtyard", walk: "2m" },
    ],
    leicester_square: [
        { name: "Seven Dials Market", detail: "Covent Garden food hall", walk: "4m" },
        { name: "The Harp", detail: "Award-winning ale house", walk: "3m" },
    ],
    holborn: [
        { name: "Princess Louise", detail: "Victorian tiled gin palace", walk: "2m" },
        { name: "Catalyst Roasters", detail: "Minimalist coffee & brunch", walk: "3m" },
    ],
    farringdon: [
        { name: "The Castle", detail: "Pub & terrace opposite exit", walk: "1m" },
        { name: "Exmouth Market", detail: "Pedestrian street & wine bars", walk: "4m" },
    ],
    bank: [
        { name: "The Ned", detail: "Grand 1920s banking hall bars", walk: "1m" },
        { name: "Lamb Tavern", detail: "Inside Leadenhall Market", walk: "3m" },
    ],
    liverpool_street: [
        { name: "Old Spitalfields", detail: "Covered market & wine bars", walk: "3m" },
        { name: "Hamilton Hall", detail: "Right at Bishopsgate exit", walk: "1m" },
    ],
    shoreditch_high_st: [
        { name: "BOXPARK", detail: "Next door to station exit", walk: "1m" },
        { name: "Boundary Rooftop", detail: "Redchurch St café & bar", walk: "2m" },
    ],
    whitechapel: [
        { name: "The Culpeper", detail: "Rooftop greenhouse pub", walk: "5m" },
        { name: "Grounded London", detail: "Spacious coffee roastery", walk: "2m" },
    ],
    stratford: [
        { name: "Roof East", detail: "Rooftop bar & street food", walk: "2m" },
        { name: "Crate Brewery", detail: "Canalside taproom & pizza", walk: "6m" },
    ],
    canary_wharf: [
        { name: "Pergola on the Wharf", detail: "Crossrail Place roof garden", walk: "2m" },
        { name: "Market Halls", detail: "Waterside food hall & bar", walk: "3m" },
    ],
    canada_water: [
        { name: "Leadbelly’s Bar", detail: "Deal Porter Square brasserie", walk: "2m" },
        { name: "WatchHouse Dock", detail: "Waterside specialty coffee", walk: "2m" },
    ],
    london_bridge: [
        { name: "Borough Market", detail: "Artisan market & taverns", walk: "2m" },
        { name: "Vinegar Yard", detail: "Courtyard bar outside exit", walk: "1m" },
    ],
    waterloo: [
        { name: "Lower Marsh Market", detail: "Independent cafes & pubs", walk: "2m" },
        { name: "The Sidings", detail: "Underneath Waterloo arches", walk: "1m" },
    ],
    westminster: [
        { name: "The Red Lion", detail: "Classic Whitehall tavern", walk: "2m" },
        { name: "Tattershall Castle", detail: "Thames Embankment boat bar", walk: "3m" },
    ],
    victoria_stn: [
        { name: "Market Halls Victoria", detail: "Roof terrace opposite exit", walk: "1m" },
        { name: "Notes Coffee & Wine", detail: "Nova Victoria piazza", walk: "2m" },
    ],
    brixton: [
        { name: "Brixton Village", detail: "Covered courtyard kitchens", walk: "2m" },
        { name: "Trinity Arms", detail: "Leafy square pub & firepit", walk: "3m" },
    ],
    clapham_high_st: [
        { name: "Venn Street Records", detail: "Vinyl bar next to station", walk: "2m" },
        { name: "The Bobbin", detail: "Calm gastropub in Old Town", walk: "4m" },
    ],
    camden_town: [
        { name: "The Hawley Arms", detail: "Camden Lock rooftop pub", walk: "3m" },
        { name: "Hawley Wharf", detail: "Canalside food hall", walk: "4m" },
    ],
    highbury_islington: [
        { name: "The Compton Arms", detail: "Leafy backstreet pub", walk: "3m" },
        { name: "Prawn on the Lawn", detail: "Highbury Corner wine bar", walk: "2m" },
    ],
    finsbury_park: [
        { name: "Faltering Fullback", detail: "Treehouse garden pub", walk: "5m" },
        { name: "Boulangerie Bon Matin", detail: "Cafe right by station exit", walk: "1m" },
    ],
};

export const STATIONS: Record<string, Station> = {};
for (const [id, , name, lat, lng, zone] of NET_STATIONS) {
    STATIONS[id] = { id, name, lat, lng, zone, lines: [], venues: CURATED[id] ?? [], walks: [], meet: false, featured: id in CURATED };
}

export const LINE_ROUTES: Record<string, [string, string, number][]> = {};
for (const [line, a, b, mins] of NET_EDGES) {
    const u = NET_STATIONS[a][0];
    const v = NET_STATIONS[b][0];
    (LINE_ROUTES[line] ??= []).push([u, v, mins]);
    for (const s of [u, v]) if (!STATIONS[s].lines.includes(line)) STATIONS[s].lines.push(line);
}
for (const [a, b, mins] of NET_WALKS) {
    STATIONS[NET_STATIONS[a][0]].walks.push([NET_STATIONS[b][0], mins]);
    STATIONS[NET_STATIONS[b][0]].walks.push([NET_STATIONS[a][0], mins]);
}

const lineOrder = (l: string) => MODE_ORDER.indexOf(TFL_LINES[l].mode) * 100 + (PICKABLE_LINES.indexOf(l) + 1 || 99);
for (const st of Object.values(STATIONS)) {
    st.lines.sort((a, b) => lineOrder(a) - lineOrder(b));
    const rail = st.lines.filter((l) => TFL_LINES[l].mode !== 'tram');
    st.meet = st.featured || (rail.length > 0 && st.zone >= 1 && st.zone <= 2) || rail.length >= 2;
}

/** Where a meetup can be suggested. */
export const MEETING_POINTS: string[] = Object.keys(STATIONS).filter((id) => STATIONS[id].meet);
