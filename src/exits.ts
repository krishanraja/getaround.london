import { STATION_GEO } from './station-geo.js';
import { distanceMetres } from './routing.js';

// Which way out of the station for a given place. TfL publishes every entrance's position but not
// the signage numbers, so we name the nearest entrance by its compass side of the station.

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

export interface ExitHint {
    /** e.g. "north-west exit"; null when the station effectively has one way out. */
    label: string | null;
    /** Straight-line metres from that exit to the place. */
    metres: number;
}

export function nearestExit(stationId: string, lat: number, lng: number): ExitHint {
    const geo = STATION_GEO[stationId];
    if (!geo || !geo.exits.length) return { label: null, metres: geo ? distanceMetres(geo.lat, geo.lng, lat, lng) : 0 };
    let best = geo.exits[0];
    let bestD = Infinity;
    for (const e of geo.exits) {
        const d = distanceMetres(e.lat, e.lng, lat, lng);
        if (d < bestD) {
            bestD = d;
            best = e;
        }
    }
    const cLat = geo.exits.reduce((a, e) => a + e.lat, 0) / geo.exits.length;
    const cLng = geo.exits.reduce((a, e) => a + e.lng, 0) / geo.exits.length;
    const spread = Math.max(...geo.exits.map((e) => distanceMetres(cLat, cLng, e.lat, e.lng)));
    // One entrance, or all entrances bunched together: no meaningful choice to suggest.
    if (geo.exits.length < 2 || spread < 25) return { label: null, metres: bestD };
    const north = best.lat - cLat;
    const east = (best.lng - cLng) * Math.cos((cLat * Math.PI) / 180);
    const deg = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
    return { label: `${DIRS[Math.round(deg / 45) % 8]} exit`, metres: bestD };
}

/** "33-35 Wardour St, London" → "Wardour St". */
export function streetFrom(address: string | undefined): string | null {
    if (!address) return null;
    const first = address.split(',')[0].trim().replace(/^(unit|flat|suite)\s+\S+\s+/i, '');
    const street = first.replace(/^[\d\s\-–/a-zA-Z]{0,6}\d[a-zA-Z]?\s+/, '').trim();
    return /\b(st|street|rd|road|ln|lane|ave|avenue|pl|place|sq|square|row|way|yard|hill|walk|court|ct|gate|mews|market|terrace|close|bridge|cres|crescent|grove|gardens|embankment|parade|passage|alley|circus|broadway|strand|high)\b\.?$/i.test(street)
        ? street
        : null;
}
