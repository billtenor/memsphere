/** Shared canvas chrome and viewport interactions for workflow and artifact graphs. */
export type GraphStatistics = {
    agent: number;
    human: number;
    code: number;
};
export function graphStatistics(actions: ReadonlyArray<{
    actor?: string;
    collect?: unknown;
}>): GraphStatistics {
    return { agent: actions.filter(a => !a.collect && (a.actor ?? 'agent') === 'agent').length, human: actions.filter(a => !a.collect && a.actor === 'human').length, code: actions.filter(a => a.collect).length };
}
export function createGraphCanvas(options: {
    locale?: string;
    viewport?: HTMLDivElement;
} = {}) {
    const english = options.locale?.startsWith('en'), t = (zh: string, en: string) => english ? en : zh;
    const element = document.createElement('section');
    element.className = 'pg-canvas';
    const style = document.createElement('style');
    style.textContent = graphCanvasStyles;
    element.append(style);
    const header = document.createElement('div');
    header.className = 'pg-tools';
    header.hidden = true;
    const metadata = document.createElement('div');
    metadata.className = 'pg-metadata';
    header.append(metadata);
    const viewport = options.viewport ?? document.createElement('div');
    viewport.classList.add('pg-viewport');
    viewport.tabIndex = 0;
    const world = document.createElement('div');
    world.className = 'pg-world';
    viewport.append(world);
    const controls = document.createElement('div');
    controls.className = 'pg-controls';
    const events = new AbortController();
    let scale = 1, width = 746, height = 450, drag: {
        pointer: number;
        x: number;
        y: number;
        left: number;
        top: number;
    } | undefined;
    const zoom = (value: number) => {
        scale = value;
        world.style.transform = `scale(${scale})`;
        world.style.marginBottom = `${height * (scale - 1)}px`;
        world.style.marginRight = `${width * (scale - 1)}px`;
    };
    const button = (label: string, run: () => void) => {
        const b = document.createElement('button');
        b.className = 'pg-button';
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', run, { signal: events.signal });
        return b;
    };
    const zoomButton = (plus: boolean) => {
        const b = button('', () => zoom(Math.max(.3, Math.min(2, scale + (plus ? .1 : -.1)))));
        b.setAttribute('aria-label', plus ? t('放大', 'Zoom in') : t('缩小', 'Zoom out'));
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', plus ? 'M3 8h10M8 3v10' : 'M3 8h10');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-linecap', 'round');
        svg.append(path);
        b.append(svg);
        return b;
    };
    controls.append(zoomButton(false), zoomButton(true), button('100%', () => zoom(1)), button(t('适配', 'Fit'), () => zoom(Math.min(1, Math.min(viewport.clientWidth / width, viewport.clientHeight / height)))));
    element.append(header, viewport, controls);
    viewport.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.pointerType === 'touch' || (event.target as Element).closest('button,path,a,input,select,textarea,summary,[contenteditable]'))
            return;
        event.preventDefault();
        drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
        viewport.dataset.dragging = 'true';
        viewport.setPointerCapture(event.pointerId);
    }, { signal: events.signal });
    viewport.addEventListener('pointermove', event => {
        if (!drag || drag.pointer !== event.pointerId)
            return;
        viewport.scrollLeft = drag.left + drag.x - event.clientX;
        viewport.scrollTop = drag.top + drag.y - event.clientY;
    }, { signal: events.signal });
    const stop = () => {
        const previous = drag;
        drag = undefined;
        delete viewport.dataset.dragging;
        if (previous && viewport.hasPointerCapture(previous.pointer))
            viewport.releasePointerCapture(previous.pointer);
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
        viewport.addEventListener(name, stop, { signal: events.signal });
    window.addEventListener('blur', stop, { signal: events.signal });
    const setSummary = (title: string, summary: string) => {
        header.hidden = false;
        metadata.replaceChildren();
        const badge = document.createElement('span');
        badge.className = 'pg-badge';
        badge.textContent = title;
        const text = document.createElement('span');
        text.textContent = summary;
        metadata.append(badge, text);
    };
    return { element, header, viewport, world, stopPan: stop, setSummary,
        setSize(w: number, h: number) {
            width = w;
            height = h;
            world.dataset.width = String(w);
            world.dataset.height = String(h);
            world.style.width = `${w}px`;
            world.style.height = `${h}px`;
            zoom(scale);
        },
        setStatistics(value?: GraphStatistics) {
            if (!value) {
                header.hidden = true;
                return;
            }
            setSummary(t('流程', 'Graph'), `${t('Agent 步骤', 'Agent steps')} ${value.agent} · ${t('Human 步骤', 'Human steps')} ${value.human} · ${t('代码步骤', 'Code steps')} ${value.code}`);
        },
        dispose() {
            stop();
            events.abort();
            element.remove();
        }
    };
}
const graphCanvasStyles = `
.pg-canvas{min-width:0;color:var(--mem-view-color-text);background:var(--mem-view-color-surface);font:14px/1.55 var(--mem-view-font-sans)}
.pg-canvas .pg-tools{display:flex;gap:12px;margin:0;padding:12px 24px;background:var(--mem-view-color-canvas);border-bottom:1px solid var(--mem-view-color-border)}
.pg-canvas .pg-metadata{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--mem-view-color-text-muted);flex-wrap:wrap;margin-right:auto}
.pg-canvas .pg-metadata>.pg-badge{padding:1px 6px;border-radius:5px;font-size:10px;background:var(--mem-view-color-accent-soft);color:var(--mem-view-color-accent)}
.pg-canvas .pg-viewport{position:relative;overflow:auto;min-height:360px;height:clamp(360px,calc(100dvh - 300px),640px);max-height:none;background:var(--mem-view-color-canvas);background-image:radial-gradient(var(--mem-view-color-border) .8px,transparent .8px);background-size:18px 18px;touch-action:pan-x pan-y;cursor:grab}
.pg-canvas .pg-viewport[data-dragging=true]{cursor:grabbing;user-select:none}
.pg-canvas .pg-world{position:relative;transform-origin:0 0;margin:0;min-height:0}
.pg-canvas .pg-controls{display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:10px 13px;border-top:1px solid var(--mem-view-color-border);background:var(--mem-view-color-surface)}
.pg-canvas .pg-controls>.pg-button{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:30px;height:30px;padding:4px 8px;font:11px/1.5 var(--mem-view-font-sans);border:1px solid var(--mem-view-color-border);border-radius:6px;background:var(--mem-view-color-surface);color:var(--mem-view-color-text);cursor:pointer}
.pg-canvas .pg-controls>.pg-button:focus-visible{outline:2px solid var(--mem-view-color-accent);outline-offset:2px}
.pg-canvas .graph-edge{fill:none;stroke:var(--mem-view-color-text-muted);stroke-width:1.5;opacity:1;vector-effect:non-scaling-stroke}
.pg-canvas .graph-edge[data-highlighted=true],.pg-canvas .graph-edge[data-lit=true]{stroke:var(--mem-view-color-accent);stroke-width:1.5;opacity:1}
.pg-canvas [hidden]{display:none}
`;
