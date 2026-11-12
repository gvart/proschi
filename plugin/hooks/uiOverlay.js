// ../plugin/src/uiOverlay.ts
var ARROWS = ["left", "right", "up", "down"];
var SCROLL_KEYS = ["up", "down", "pageup", "pagedown", "home", "end"];
var controlAt = (controls, x, y) => controls.find((c) => x >= c.col && x < c.col + c.columns && y >= c.row && y < c.row + c.rows)?.id ?? "";
var UiOverlay = (props, surface) => {
  surface.onPointer((e) => {
    const state = surface.state ?? { hover: "", down: "" };
    const id = e.type === "leave" ? "" : controlAt(props.controls ?? [], e.x, e.y);
    if (props.drag && e.type === "down" && e.button === "left" && !id) {
      const n = (state.n ?? 0) + 1;
      surface.setState({ ...state, n, drag: { n, sx: e.x, sy: e.y } });
      surface.post({ type: "drag", n, sx: e.x, sy: e.y, x: e.x, y: e.y });
      return;
    }
    if (state.drag && (e.type === "move" || e.type === "up")) {
      const d = state.drag;
      if (e.type === "up") surface.setState({ ...state, drag: void 0 });
      surface.post({ type: "drag", ...d, x: e.x, y: e.y, ...e.type === "up" ? { end: true } : {} });
      return;
    }
    if (e.type === "down" && e.button === "left") {
      surface.setState({ ...state, hover: id, down: id });
      if (id) surface.post({ type: "down", id });
      return;
    }
    if (e.type === "up") {
      surface.setState({ ...state, hover: id, down: "" });
      surface.post(state.down && state.down === id ? { type: "press", id } : { type: "hover", id });
      return;
    }
    if (id !== state.hover) {
      surface.setState({ ...state, hover: id });
      surface.post({ type: "hover", id });
    }
  });
  surface.onKey((e) => {
    if (e.ctrl || e.meta) return;
    if (props.drag && ARROWS.includes(e.key)) surface.post({ type: "key", key: e.key });
    else if (SCROLL_KEYS.includes(e.key)) surface.post({ type: "scroll", key: e.key });
    else if (e.key.length === 1) surface.post({ type: "key", key: e.key.toLowerCase() });
  });
  return surface.elements.Box({ width: surface.columns || void 0, height: surface.rows || void 0 });
};
var uiOverlay_default = UiOverlay;
export {
  SCROLL_KEYS,
  controlAt,
  uiOverlay_default as default
};
