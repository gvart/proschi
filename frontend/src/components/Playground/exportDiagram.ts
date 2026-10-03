import { toPng, toSvg } from 'html-to-image';
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
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  downloadUrl(url, fileName);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Renders the whole diagram (not just the visible part) to PNG or SVG.
 * `nodes` must be React Flow's internal nodes so nested positions are absolute.
 */
export async function exportImage(format: 'png' | 'svg', nodes: Node[], viewport: HTMLElement, fileName: string) {
  const bounds = getRectOfNodes(nodes);
  const width = Math.ceil(bounds.width + PADDING * 2);
  const height = Math.ceil(bounds.height + PADDING * 2);
  const options = {
    backgroundColor: '#ffffff',
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
