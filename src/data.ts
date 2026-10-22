// Network data carried over from the approved mock. Ride times are approximate
// in-train minutes; interchange cost is applied by the router.

export interface Line { id: string; name: string; color: string }
export interface Venue { name: string; detail: string; walk: string; source?: 'curated' | 'ai' }
export interface Station { id: string; name: string; lat: number; lng: number; lines: string[]; venues: Venue[] }

export const TFL_LINES: Record<string, Line> = {
    victoria:   { id: 'victoria',   name: 'Victoria',       color: '#0098D4' },
    central:    { id: 'central',    name: 'Central',        color: '#E32017' },
    northern:   { id: 'northern',   name: 'Northern',       color: '#262626' },
    jubilee:    { id: 'jubilee',    name: 'Jubilee',        color: '#868F98' },
    piccadilly: { id: 'piccadilly', name: 'Piccadilly',     color: '#003688' },
    elizabeth:  { id: 'elizabeth',  name: 'Elizabeth',      color: '#6950A1' },
    overground: { id: 'overground', name: 'Overground',     color: '#EE7C0E' },
    district:   { id: 'district',   name: 'District',       color: '#00782A' },
    circle:     { id: 'circle',     name: 'Circle',         color: '#E6B800' },
    bakerloo:   { id: 'bakerloo',   name: 'Bakerloo',       color: '#B36305' }
};

export const STATIONS: Record<string, Station> = {
    kings_cross: {
        id: 'kings_cross', name: "King's Cross", lat: 51.5308, lng: -0.1238, lines: ['victoria', 'northern', 'piccadilly', 'circle'],
        venues: [
            { name: 'The Lighterman', detail: 'Canalside pub · Granary Sq', walk: '3m' },
            { name: 'Caravan Coffee', detail: 'All-day roastery & tables', walk: '4m' }
        ]
    },
    euston: {
        id: 'euston', name: 'Euston', lat: 51.5282, lng: -0.1337, lines: ['victoria', 'northern', 'overground'],
        venues: [
            { name: 'The Euston Tap', detail: 'Craft beer lodge at station gate', walk: '1m' },
            { name: 'Drummond Villa', detail: 'Quiet neighbourhood tavern', walk: '3m' }
        ]
    },
    oxford_circus: {
        id: 'oxford_circus', name: 'Oxford Circus', lat: 51.5152, lng: -0.1415, lines: ['victoria', 'central', 'bakerloo'],
        venues: [
            { name: 'The Clachan', detail: 'Historic pub off Carnaby St', walk: '2m' },
            { name: 'Kingly Court', detail: 'Covered 3-storey courtyard', walk: '3m' }
        ]
    },
    tottenham_court_road: {
        id: 'tottenham_court_road', name: 'Tottenham Court Rd', lat: 51.5165, lng: -0.131, lines: ['central', 'northern', 'elizabeth'],
        venues: [
            { name: 'Arcade Food Hall', detail: 'Group tables under Centre Point', walk: '1m' },
            { name: 'The Toucan', detail: 'Classic Soho Square pub', walk: '2m' }
        ]
    },
    bond_street: {
        id: 'bond_street', name: 'Bond Street', lat: 51.5142, lng: -0.1494, lines: ['central', 'jubilee', 'elizabeth'],
        venues: [
            { name: 'Mercato Mayfair', detail: 'Vaulted church food hall', walk: '3m' },
            { name: 'The Coach & Horses', detail: 'St Christopher’s Place pub', walk: '2m' }
        ]
    },
    baker_street: {
        id: 'baker_street', name: 'Baker Street', lat: 51.5226, lng: -0.1571, lines: ['bakerloo', 'jubilee', 'circle'],
        venues: [
            { name: 'The Globe', detail: 'Directly opposite station exit', walk: '1m' },
            { name: 'Monocle Café', detail: 'Calm Chiltern St coffee spot', walk: '4m' }
        ]
    },
    paddington: {
        id: 'paddington', name: 'Paddington', lat: 51.5154, lng: -0.1755, lines: ['elizabeth', 'bakerloo', 'circle', 'district'],
        venues: [
            { name: 'Pergola Paddington', detail: 'Covered rooftop gardens', walk: '2m' },
            { name: 'Mad Bishop & Bear', detail: 'Inside Paddington concourse', walk: '1m' }
        ]
    },
    notting_hill_gate: {
        id: 'notting_hill_gate', name: 'Notting Hill Gate', lat: 51.5094, lng: -0.1967, lines: ['central', 'circle', 'district'],
        venues: [
            { name: 'Churchill Arms', detail: 'Iconic flower-clad pub', walk: '4m' },
            { name: 'Guillam Coffee', detail: 'Single-origin espresso lounge', walk: '1m' }
        ]
    },
    shepherds_bush: {
        id: 'shepherds_bush', name: "Shepherd's Bush", lat: 51.5046, lng: -0.2187, lines: ['central', 'overground'],
        venues: [
            { name: 'Defectors Weld', detail: 'Spacious green-side pub', walk: '1m' },
            { name: 'Albertine Wine Bar', detail: 'Cosy neighborhood wine bar', walk: '4m' }
        ]
    },
    south_kensington: {
        id: 'south_kensington', name: 'South Kensington', lat: 51.4941, lng: -0.1738, lines: ['piccadilly', 'district', 'circle'],
        venues: [
            { name: 'The Hoop & Toy', detail: 'By the pedestrian piazza', walk: '1m' },
            { name: 'Hjem Kensington', detail: 'Danish bakery & coffee', walk: '2m' }
        ]
    },
    green_park: {
        id: 'green_park', name: 'Green Park', lat: 51.5067, lng: -0.1428, lines: ['victoria', 'piccadilly', 'jubilee'],
        venues: [
            { name: 'Shepherd Market', detail: 'Hidden Mayfair village square', walk: '3m' },
            { name: 'The Red Lion', detail: 'Historic Crown Passage snug', walk: '4m' }
        ]
    },
    piccadilly_circus: {
        id: 'piccadilly_circus', name: 'Piccadilly Circus', lat: 51.5098, lng: -0.1342, lines: ['piccadilly', 'bakerloo'],
        venues: [
            { name: 'Soho Grind', detail: 'Espresso bar & cocktails', walk: '3m' },
            { name: 'St James’s Market', detail: 'Quiet pedestrian courtyard', walk: '2m' }
        ]
    },
    leicester_square: {
        id: 'leicester_square', name: 'Leicester Square', lat: 51.5113, lng: -0.1281, lines: ['northern', 'piccadilly'],
        venues: [
            { name: 'Seven Dials Market', detail: 'Covent Garden food hall', walk: '4m' },
            { name: 'The Harp', detail: 'Award-winning ale house', walk: '3m' }
        ]
    },
    holborn: {
        id: 'holborn', name: 'Holborn', lat: 51.5174, lng: -0.1201, lines: ['central', 'piccadilly'],
        venues: [
            { name: 'Princess Louise', detail: 'Victorian tiled gin palace', walk: '2m' },
            { name: 'Catalyst Roasters', detail: 'Minimalist coffee & brunch', walk: '3m' }
        ]
    },
    farringdon: {
        id: 'farringdon', name: 'Farringdon', lat: 51.5203, lng: -0.1053, lines: ['elizabeth', 'circle'],
        venues: [
            { name: 'The Castle', detail: 'Pub & terrace opposite exit', walk: '1m' },
            { name: 'Exmouth Market', detail: 'Pedestrian street & wine bars', walk: '4m' }
        ]
    },
    bank: {
        id: 'bank', name: 'Bank', lat: 51.5133, lng: -0.0886, lines: ['central', 'northern', 'circle', 'district'],
        venues: [
            { name: 'The Ned', detail: 'Grand 1920s banking hall bars', walk: '1m' },
            { name: 'Lamb Tavern', detail: 'Inside Leadenhall Market', walk: '3m' }
        ]
    },
    liverpool_street: {
        id: 'liverpool_street', name: 'Liverpool Street', lat: 51.5178, lng: -0.0823, lines: ['central', 'elizabeth', 'overground', 'circle'],
        venues: [
            { name: 'Old Spitalfields', detail: 'Covered market & wine bars', walk: '3m' },
            { name: 'Hamilton Hall', detail: 'Right at Bishopsgate exit', walk: '1m' }
        ]
    },
    shoreditch_high_st: {
        id: 'shoreditch_high_st', name: 'Shoreditch High St', lat: 51.5233, lng: -0.0752, lines: ['overground'],
        venues: [
            { name: 'BOXPARK', detail: 'Next door to station exit', walk: '1m' },
            { name: 'Boundary Rooftop', detail: 'Redchurch St café & bar', walk: '2m' }
        ]
    },
    whitechapel: {
        id: 'whitechapel', name: 'Whitechapel', lat: 51.5195, lng: -0.061, lines: ['elizabeth', 'overground', 'district'],
        venues: [
            { name: 'The Culpeper', detail: 'Rooftop greenhouse pub', walk: '5m' },
            { name: 'Grounded London', detail: 'Spacious coffee roastery', walk: '2m' }
        ]
    },
    stratford: {
        id: 'stratford', name: 'Stratford', lat: 51.5416, lng: -0.0042, lines: ['central', 'jubilee', 'elizabeth', 'overground'],
        venues: [
            { name: 'Roof East', detail: 'Rooftop bar & street food', walk: '2m' },
            { name: 'Crate Brewery', detail: 'Canalside taproom & pizza', walk: '6m' }
        ]
    },
    canary_wharf: {
        id: 'canary_wharf', name: 'Canary Wharf', lat: 51.5033, lng: -0.0184, lines: ['jubilee', 'elizabeth'],
        venues: [
            { name: 'Pergola on the Wharf', detail: 'Crossrail Place roof garden', walk: '2m' },
            { name: 'Market Halls', detail: 'Waterside food hall & bar', walk: '3m' }
        ]
    },
    canada_water: {
        id: 'canada_water', name: 'Canada Water', lat: 51.4982, lng: -0.0502, lines: ['jubilee', 'overground'],
        venues: [
            { name: 'Leadbelly’s Bar', detail: 'Deal Porter Square brasserie', walk: '2m' },
            { name: 'WatchHouse Dock', detail: 'Waterside specialty coffee', walk: '2m' }
        ]
    },
    london_bridge: {
        id: 'london_bridge', name: 'London Bridge', lat: 51.5049, lng: -0.0863, lines: ['jubilee', 'northern'],
        venues: [
            { name: 'Borough Market', detail: 'Artisan market & taverns', walk: '2m' },
            { name: 'Vinegar Yard', detail: 'Courtyard bar outside exit', walk: '1m' }
        ]
    },
    waterloo: {
        id: 'waterloo', name: 'Waterloo', lat: 51.5036, lng: -0.1143, lines: ['jubilee', 'northern', 'bakerloo'],
        venues: [
            { name: 'Lower Marsh Market', detail: 'Independent cafes & pubs', walk: '2m' },
            { name: 'The Sidings', detail: 'Underneath Waterloo arches', walk: '1m' }
        ]
    },
    westminster: {
        id: 'westminster', name: 'Westminster', lat: 51.501, lng: -0.1254, lines: ['jubilee', 'circle', 'district'],
        venues: [
            { name: 'The Red Lion', detail: 'Classic Whitehall tavern', walk: '2m' },
            { name: 'Tattershall Castle', detail: 'Thames Embankment boat bar', walk: '3m' }
        ]
    },
    victoria_stn: {
        id: 'victoria_stn', name: 'Victoria', lat: 51.4965, lng: -0.1447, lines: ['victoria', 'circle', 'district'],
        venues: [
            { name: 'Market Halls Victoria', detail: 'Roof terrace opposite exit', walk: '1m' },
            { name: 'Notes Coffee & Wine', detail: 'Nova Victoria piazza', walk: '2m' }
        ]
    },
    brixton: {
        id: 'brixton', name: 'Brixton', lat: 51.4627, lng: -0.1145, lines: ['victoria'],
        venues: [
            { name: 'Brixton Village', detail: 'Covered courtyard kitchens', walk: '2m' },
            { name: 'Trinity Arms', detail: 'Leafy square pub & firepit', walk: '3m' }
        ]
    },
    clapham_high_st: {
        id: 'clapham_high_st', name: 'Clapham High St', lat: 51.4653, lng: -0.1325, lines: ['northern', 'overground'],
        venues: [
            { name: 'Venn Street Records', detail: 'Vinyl bar next to station', walk: '2m' },
            { name: 'The Bobbin', detail: 'Calm gastropub in Old Town', walk: '4m' }
        ]
    },
    camden_town: {
        id: 'camden_town', name: 'Camden Town', lat: 51.5392, lng: -0.1426, lines: ['northern'],
        venues: [
            { name: 'The Hawley Arms', detail: 'Camden Lock rooftop pub', walk: '3m' },
            { name: 'Hawley Wharf', detail: 'Canalside food hall', walk: '4m' }
        ]
    },
    highbury_islington: {
        id: 'highbury_islington', name: 'Highbury & Islington', lat: 51.546, lng: -0.104, lines: ['victoria', 'overground'],
        venues: [
            { name: 'The Compton Arms', detail: 'Leafy backstreet pub', walk: '3m' },
            { name: 'Prawn on the Lawn', detail: 'Highbury Corner wine bar', walk: '2m' }
        ]
    },
    finsbury_park: {
        id: 'finsbury_park', name: 'Finsbury Park', lat: 51.5642, lng: -0.1065, lines: ['victoria', 'piccadilly'],
        venues: [
            { name: 'Faltering Fullback', detail: 'Treehouse garden pub', walk: '5m' },
            { name: 'Boulangerie Bon Matin', detail: 'Cafe right by station exit', walk: '1m' }
        ]
    }
};

export const LINE_ROUTES: Record<string, [string, string, number][]> = {
    victoria: [
        ['brixton', 'victoria_stn', 8],
        ['victoria_stn', 'green_park', 2],
        ['green_park', 'oxford_circus', 2],
        ['oxford_circus', 'euston', 4],
        ['euston', 'kings_cross', 2],
        ['kings_cross', 'highbury_islington', 3],
        ['highbury_islington', 'finsbury_park', 2]
    ],
    central: [
        ['shepherds_bush', 'notting_hill_gate', 3],
        ['notting_hill_gate', 'bond_street', 5],
        ['bond_street', 'oxford_circus', 2],
        ['oxford_circus', 'tottenham_court_road', 2],
        ['tottenham_court_road', 'holborn', 2],
        ['holborn', 'bank', 4],
        ['bank', 'liverpool_street', 2],
        ['liverpool_street', 'stratford', 8]
    ],
    northern: [
        ['camden_town', 'euston', 3],
        ['euston', 'kings_cross', 2],
        ['euston', 'tottenham_court_road', 4],
        ['tottenham_court_road', 'leicester_square', 2],
        ['leicester_square', 'waterloo', 3],
        ['kings_cross', 'bank', 6],
        ['bank', 'london_bridge', 2],
        ['london_bridge', 'waterloo', 3],
        ['waterloo', 'clapham_high_st', 9]
    ],
    jubilee: [
        ['baker_street', 'bond_street', 2],
        ['bond_street', 'green_park', 2],
        ['green_park', 'westminster', 2],
        ['westminster', 'waterloo', 2],
        ['waterloo', 'london_bridge', 3],
        ['london_bridge', 'canada_water', 3],
        ['canada_water', 'canary_wharf', 3],
        ['canary_wharf', 'stratford', 6]
    ],
    piccadilly: [
        ['south_kensington', 'green_park', 4],
        ['green_park', 'piccadilly_circus', 2],
        ['piccadilly_circus', 'leicester_square', 2],
        ['leicester_square', 'holborn', 2],
        ['holborn', 'kings_cross', 3],
        ['kings_cross', 'finsbury_park', 5]
    ],
    elizabeth: [
        ['paddington', 'bond_street', 3],
        ['bond_street', 'tottenham_court_road', 2],
        ['tottenham_court_road', 'farringdon', 3],
        ['farringdon', 'liverpool_street', 2],
        ['liverpool_street', 'whitechapel', 3],
        ['whitechapel', 'stratford', 5],
        ['whitechapel', 'canary_wharf', 4]
    ],
    overground: [
        ['shepherds_bush', 'euston', 14],
        ['euston', 'highbury_islington', 7],
        ['highbury_islington', 'shoreditch_high_st', 8],
        ['shoreditch_high_st', 'liverpool_street', 3],
        ['shoreditch_high_st', 'whitechapel', 3],
        ['whitechapel', 'canada_water', 5],
        ['canada_water', 'clapham_high_st', 12],
        ['highbury_islington', 'stratford', 10]
    ],
    bakerloo: [
        ['paddington', 'baker_street', 4],
        ['baker_street', 'oxford_circus', 3],
        ['oxford_circus', 'piccadilly_circus', 2],
        ['piccadilly_circus', 'waterloo', 4]
    ],
    circle: [
        ['paddington', 'baker_street', 4],
        ['baker_street', 'kings_cross', 5],
        ['kings_cross', 'farringdon', 4],
        ['farringdon', 'liverpool_street', 4],
        ['liverpool_street', 'bank', 3],
        ['bank', 'westminster', 6],
        ['westminster', 'victoria_stn', 4],
        ['victoria_stn', 'south_kensington', 4],
        ['south_kensington', 'notting_hill_gate', 5],
        ['notting_hill_gate', 'paddington', 3]
    ],
    district: [
        ['notting_hill_gate', 'paddington', 3],
        ['notting_hill_gate', 'south_kensington', 5],
        ['south_kensington', 'victoria_stn', 4],
        ['victoria_stn', 'westminster', 4],
        ['westminster', 'bank', 6],
        ['bank', 'whitechapel', 5]
    ]
};
