// Kept apart from command.ts so the CLI can print its usage without loading the renderer.
export const RENDER_USAGE = `  proschi render [--out <dir>] [--format svg|md|html] <file>`;

export const RENDER_HELP = `render  Writes the diagram as static files into --out (default: the current
        directory). svg (default): architecture.svg and <usecase>--<scenario>.svg
        per scenario; md: <file>.md with Mermaid blocks; html: <file>.html with
        the SVGs. Refuses (exit 1) when the document has errors.`;
