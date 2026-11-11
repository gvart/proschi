// A stand-in for hooks/raster.cjs in the hooks tests: a diagram's PNGs, and each panel cut into one tile per control.

/** Every control a panel's data names, as the UI kit would place it (the step panel's keys are the kit's own). */
function controlsOf(panel: Record<string, unknown>): { id: string; hotkey?: string; disabled?: boolean }[] {
  const out: { id: string; hotkey?: string; disabled?: boolean }[] = []
  if (panel.kind === 'step') {
    const keys = (panel.hotkeys ?? {}) as Record<string, string>
    for (const id of ['first', 'prev', 'play', 'next', 'last', 'exit']) out.push({ id, ...(keys[id] ? { hotkey: keys[id] } : {}) })
    return out
  }
  if (panel.kind === 'tabs') {
    for (const t of panel.tabs as { id: string; hotkey?: string }[]) out.push({ id: t.id, ...(t.hotkey ? { hotkey: t.hotkey } : {}) })
    return out
  }
  const walk = (v: unknown, key?: string): void => {
    if (Array.isArray(v)) return v.forEach(x => walk(x))
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    if (key !== 'source' && typeof o.id === 'string' && ('label' in o || 'icon' in o || 'outcome' in o || 'options' in o)) {
      out.push({ id: o.id, ...(typeof o.hotkey === 'string' ? { hotkey: o.hotkey } : {}), ...(o.disabled ? { disabled: true } : {}) })
      if (Array.isArray(o.options) && o.open) for (const opt of o.options as { value: string }[]) out.push({ id: `${o.id}=${opt.value}` })
    }
    for (const [k, x] of Object.entries(o)) if (k !== 'options') walk(x, k)
  }
  walk(panel)
  return out
}

/** What the helper answers `input` with. */
export function answer(input: Record<string, unknown>, size = { width: 1600, height: 900 }): unknown {
  if (input.kind === 'panels') {
    const panels = (input.panels as { id: string; panel: Record<string, unknown>; columns: number }[]).map(req => {
      const controls = controlsOf(req.panel)
      const name = `/tmp/proschi-raster/${req.panel.kind}`
      const tiles = [
        { col: 0, row: 0, columns: req.columns, rows: 1, file: `${name}-top.png` },
        ...controls.map((c, i) => ({
          col: 0,
          row: 1 + i,
          columns: req.columns,
          rows: 1,
          file: `${name}-${c.id}.png`,
          controls: [
            {
              col: 0,
              columns: req.columns,
              hoverFile: `${name}-${c.id}-hover.png`,
              pressedFile: `${name}-${c.id}-pressed.png`,
              control: { id: c.id, kind: 'button', ...(c.hotkey ? { hotkey: c.hotkey } : {}), ...(c.disabled ? { disabled: true } : {}) },
            },
          ],
        })),
      ]
      return { id: req.id, kind: req.panel.kind, columns: req.columns, rows: tiles.length, cellPx: { width: 16, height: 34 }, tiles }
    })
    return { panels }
  }
  const options = (input.options ?? {}) as { play?: unknown; maxWidthPx?: number; grid?: { room: number; maxRows: number; cellPx: { width: number; height: number } } }
  const out = { ...size, base: '/tmp/proschi-raster/base.png', cellHint: { columns: Math.ceil(size.width / 16), rows: Math.ceil(size.height / 32) } }
  const g = options.grid
  if (g) {
    // As the helper: scaled to the room, cut into tiles of 16×8 cells; a step's packet covers tile k in frame k.
    const width = Math.min(size.width, options.maxWidthPx ?? size.width)
    const height = (size.height * width) / size.width
    const f = Math.min(1, (g.room * g.cellPx.width) / width, (g.maxRows * g.cellPx.height) / height)
    const columns = Math.ceil((width * f) / g.cellPx.width)
    const rows = Math.ceil((height * f) / g.cellPx.height)
    const tiles: { col: number; row: number; columns: number; rows: number; width: number; height: number }[] = []
    for (let row = 0; row < rows; row += 8) for (let col = 0; col < columns; col += 16) tiles.push({ col, row, columns: Math.min(16, columns - col), rows: Math.min(8, rows - row), width: 0, height: 0 })
    const grid = {
      columns,
      rows,
      tiles,
      base: tiles.map((_, i) => `/tmp/proschi-raster/base-${i}.png`),
      ...(options.play ? { steps: Array.from({ length: 7 }, (_, s) => ({ behind: tiles.map((_, i) => `/tmp/proschi-raster/s${s}-t${i}.png`), frames: [0, 1, 2].map(k => ({ [k]: `/tmp/proschi-raster/s${s}-f${k}.png` })) })) } : {}),
    }
    return { ...out, grid }
  }
  const frames = Array.from({ length: 7 }, (_, s) => [0, 1, 2].map(k => `/tmp/proschi-raster/s${s}-f${k}.png`))
  return options.play ? { ...out, frames } : out
}
