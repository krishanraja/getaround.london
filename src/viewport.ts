// Keeps the app exactly the size of what the user can see, so nothing ever scrolls.
//
// Two problems this solves on phones:
// 1. Browser chrome and the on-screen keyboard change the visible height; CSS viewport
//    units lag behind. We mirror the visual viewport into --app-h / --app-top.
// 2. "Desktop site" mode ignores the viewport meta and lays the page out ~980px wide,
//    shrinking everything. On a touch-only device whose layout is much wider than its
//    screen, we zoom the root back up so the app fills the screen at normal size.

const DESKTOP = '(min-width: 640px) and (hover: hover) and (pointer: fine)';

function desktopSiteZoom(): number {
    const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(hover: hover)').matches;
    const screenW = window.screen?.width || 0;
    if (!touchOnly || !screenW) return 1;
    const ratio = window.innerWidth / screenW;
    return ratio > 1.15 ? ratio : 1;
}

let zoom = 1;

export function appZoom(): number {
    return zoom;
}

function sync() {
    const root = document.documentElement;
    const next = desktopSiteZoom();
    if (next !== zoom) {
        zoom = next;
        root.style.setProperty('zoom', zoom === 1 ? '' : String(zoom));
    }
    if (matchMedia(DESKTOP).matches && zoom === 1) {
        root.style.removeProperty('--app-h');
        root.style.removeProperty('--app-top');
    } else {
        const vv = window.visualViewport;
        const height = vv ? vv.height : window.innerHeight;
        const top = vv ? vv.offsetTop : 0;
        root.style.setProperty('--app-h', `${height / zoom}px`);
        root.style.setProperty('--app-top', `${top / zoom}px`);
    }
    window.dispatchEvent(new Event('app:resize'));
}

export function initViewport() {
    sync();
    window.visualViewport?.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', () => setTimeout(sync, 250));
    // Nothing may ever scroll: snap the document and any clipped box back if a browser
    // without overflow:clip pans it (e.g. to reveal a focused input).
    document.addEventListener(
        'scroll',
        (e) => {
            const el = e.target === document ? document.scrollingElement : (e.target as Element | null);
            if (el && (el.scrollTop || el.scrollLeft)) el.scrollTo(0, 0);
        },
        true,
    );
}
