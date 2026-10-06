import { getRectOfNodes, type Node } from 'reactflow';

const PADDING = 32;

export function fileNameFor(title: string | undefined, extension: string): string {
  const base =
    (title ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'diagram';
  return `${base}.${extension}`;
}

export function downloadUrl(url: string, fileName: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
}

export function downloadText(text: string, fileName: string) {
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), fileName);
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, fileName);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function paperColor(): string {
  const channels = getComputedStyle(document.documentElement).getPropertyValue('--c-paper').trim();
  return channels ? `rgb(${channels})` : '#ffffff';
}

/**
 * Renders the whole diagram (not just the visible part) to PNG or SVG.
 * `nodes` must be React Flow's internal nodes so nested positions are absolute.
 */
export async function exportImage(format: 'png' | 'svg', nodes: Node[], viewport: HTMLElement, fileName: string) {
  // html-to-image is only needed here, so it loads on the first export.
  const { toPng, toSvg } = await import('html-to-image');
  const bounds = getRectOfNodes(nodes);
  const width = Math.ceil(bounds.width + PADDING * 2);
  const height = Math.ceil(bounds.height + PADDING * 2);
  const options = {
    // The page's paper colour, so a dark-theme export keeps its contrast.
    backgroundColor: paperColor(),
    width,
    height,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${PADDING - bounds.x}px, ${PADDING - bounds.y}px) scale(1)`,
    },
  };
  const url = format === 'png' ? await toPng(viewport, { ...options, pixelRatio: 2 }) : await toSvg(viewport, options);
  downloadUrl(url, fileName);
}

/** The size link previews show (Open Graph's 1.91:1). */
export const PREVIEW_WIDTH = 1200;
export const PREVIEW_HEIGHT = 630;
/** A small diagram is not blown up past this. */
const PREVIEW_MAX_ZOOM = 1.5;

/** Bytes of the image a base64 data URL holds. */
export const dataUrlBytes = (url: string): number => Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4);

/**
 * The transform that fits `bounds` centred on a `width`×`height` card with
 * `padding` round it, never zoomed past PREVIEW_MAX_ZOOM.
 */
export function previewTransform(bounds: { x: number; y: number; width: number; height: number }, width: number, height: number, padding: number) {
  const zoom = Math.min((width - 2 * padding) / Math.max(bounds.width, 1), (height - 2 * padding) / Math.max(bounds.height, 1), PREVIEW_MAX_ZOOM);
  const x = (width - bounds.width * zoom) / 2 - bounds.x * zoom;
  const y = (height - bounds.height * zoom) / 2 - bounds.y * zoom;
  return { zoom, x, y };
}

/**
 * The box round every node React Flow drew in `viewport`, in flow
 * coordinates: each node element is placed with `translate(x, y)` at its
 * absolute position, and its offset size is unscaled.
 */
export function drawnBounds(viewport: HTMLElement): { x: number; y: number; width: number; height: number } | undefined {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const element of viewport.querySelectorAll<HTMLElement>('.react-flow__node')) {
    const match = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(element.style.transform);
    if (!match) continue;
    const x = Number(match[1]);
    const y = Number(match[2]);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + element.offsetWidth);
    bottom = Math.max(bottom, y + element.offsetHeight);
  }
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : undefined;
}

/**
 * The link preview of a short link: the whole diagram centred on a
 * 1200×630 PNG, as a data URL. Tries half the size when the first is over
 * `maxBytes`; undefined when neither fits or nothing is drawn.
 */
export async function renderPreviewPng(viewport: HTMLElement, maxBytes: number): Promise<string | undefined> {
  const bounds = drawnBounds(viewport);
  if (!bounds) return undefined;
  const { toPng } = await import('html-to-image');
  for (const factor of [1, 0.5]) {
    const width = PREVIEW_WIDTH * factor;
    const height = PREVIEW_HEIGHT * factor;
    const { zoom, x, y } = previewTransform(bounds, width, height, PADDING * factor);
    const url = await toPng(viewport, {
      backgroundColor: paperColor(),
      width,
      height,
      pixelRatio: 1,
      style: { width: `${width}px`, height: `${height}px`, transform: `translate(${x}px, ${y}px) scale(${zoom})`, transformOrigin: '0 0' },
    });
    if (dataUrlBytes(url) <= maxBytes) return url;
  }
  return undefined;
}
