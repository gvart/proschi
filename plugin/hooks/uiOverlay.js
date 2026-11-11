// ../plugin/src/uiOverlay.ts
var SCROLL_KEYS = ["up", "down", "pageup", "pagedown", "home", "end"];
var controlAt = (controls, x, y) => controls.find((c) => x >= c.col && x < c.col + c.columns && y >= c.row && y < c.row + c.rows)?.id ?? "";
var UiOverlay = (props, surface) => {
  surface.onPointer((e) => {
    const state = surface.state ?? { hover: "", down: "" };
    const id = e.type === "leave" ? "" : controlAt(props.controls ?? [], e.x, e.y);
    if (e.type === "down" && e.button === "left") {
      surface.setState({ hover: id, down: id });
      if (id) surface.post({ type: "down", id });
      return;
    }
    if (e.type === "up") {
      surface.setState({ hover: id, down: "" });
      surface.post(state.down && state.down === id ? { type: "press", id } : { type: "hover", id });
      return;
    }
    if (id !== state.hover) {
      surface.setState({ hover: id, down: state.down });
      surface.post({ type: "hover", id });
    }
  });
  surface.onKey((e) => {
    if (e.ctrl || e.meta) return;
    if (SCROLL_KEYS.includes(e.key)) surface.post({ type: "scroll", key: e.key });
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
