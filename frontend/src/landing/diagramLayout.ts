/**
 * Two hand-made layouts for the hero diagram: the wide one written into
 * index.html, and a tall one for phones, where the wide diagram would shrink
 * its labels to an unreadable size. Values are SVG attributes by element id.
 */

type Attrs = Record<string, string>;

export interface DiagramLayout {
  viewBox: string;
  elements: Record<string, Attrs>;
}

const at = (x: number, y: number): Attrs => ({ transform: `translate(${x} ${y})` });

export const wideLayout: DiagramLayout = {
  viewBox: '0 0 640 344',
  elements: {
    'd-group': { x: '206', y: '14', width: '204', height: '316' },
    'd-group-label': { x: '218', y: '34' },
    'edge-web-api': { d: 'M166 90 H231' },
    'edge-api-db': { d: 'M308 124 V228' },
    'edge-api-events': { d: 'M383 90 H472' },
    'label-web-api': { x: '186', y: '81', 'text-anchor': 'middle' },
    'label-api-db': { x: '316', y: '180', 'text-anchor': 'start' },
    'label-api-events': { x: '442', y: '81', 'text-anchor': 'middle' },
    'node-web': at(16, 56),
    'node-api': at(233, 56),
    'node-db': at(233, 230),
    'node-events': at(474, 56),
    'd-legend': at(474, 248),
    'd-titleblock': at(16, 256),
  },
};

export const tallLayout: DiagramLayout = {
  viewBox: '0 0 380 424',
  elements: {
    'd-group': { x: '8', y: '112', width: '364', height: '184' },
    'd-group-label': { x: '20', y: '132' },
    'edge-web-api': { d: 'M99 80 V146' },
    'edge-api-db': { d: 'M174 182 H212' },
    'edge-api-events': { d: 'M99 216 V338' },
    'label-web-api': { x: '107', y: '102', 'text-anchor': 'start' },
    'label-api-db': { x: '193', y: '174', 'text-anchor': 'middle' },
    'label-api-events': { x: '107', y: '322', 'text-anchor': 'start' },
    'node-web': at(24, 16),
    'node-api': at(24, 148),
    'node-db': at(214, 144),
    'node-events': at(24, 340),
    'd-legend': at(214, 352),
    'd-titleblock': at(214, 32),
  },
};

export function applyLayout(svg: SVGSVGElement, layout: DiagramLayout) {
  svg.setAttribute('viewBox', layout.viewBox);
  for (const [id, attrs] of Object.entries(layout.elements)) {
    const el = svg.querySelector(`#${id}`);
    if (!el) continue;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  }
  svg.classList.toggle('is-tall', layout === tallLayout);
}

/** Keeps the diagram in the layout that suits the current width. */
export function responsiveLayout(svg: SVGSVGElement, onChange?: () => void) {
  const query = window.matchMedia('(max-width: 599px)');
  const update = () => {
    applyLayout(svg, query.matches ? tallLayout : wideLayout);
    onChange?.();
  };
  update();
  query.addEventListener('change', update);
}
