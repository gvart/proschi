// Kept apart from command.ts so the CLI can print its usage without loading the renderer.
export const RENDER_USAGE = `  proschi render [--out <dir>] [--format svg|md|html|hld-md|hld-html] <file>`;

export const RENDER_HELP = `render  Writes the diagram as static files into --out (default: the current
        directory). svg (default): architecture.svg and <usecase>--<scenario>.svg
        per scenario; md: <file>.md with Mermaid blocks; html: <file>.html with
        the SVGs; hld-md / hld-html: <file>.hld.md / <file>.hld.html, the
        high-level design document (overview, requirements, capacity,
        components, data model, APIs, scenarios, decisions, risks).
        Refuses (exit 1) when the document has errors.`;
