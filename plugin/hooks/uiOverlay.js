// ../plugin/src/uiOverlay.ts
var at = (controls, x, y) => controls.find((c) => x >= c.col && x < c.col + c.columns && y >= c.row && y < c.row + c.rows)?.id ?? "";
var UiOverlay = (props, surface) => {
  surface.onPointer((e) => {
    const id = e.type === "leave" ? "" : at(props.controls ?? [], e.x, e.y);
    const fine = { fx: e.fine?.x ?? null, fy: e.fine?.y ?? null };
    if (e.type === "down" && e.button === "left") surface.post({ type: "press", id, x: e.x, y: e.y, ...fine });
    if ((e.type === "move" || e.type === "leave" || e.type === "enter") && id !== (surface.state?.hover ?? "")) {
      surface.setState({ hover: id });
      surface.post({ type: "hover", id, x: e.x, y: e.y, ...fine });
    }
  });
  return surface.elements.Box({ width: surface.columns || void 0, height: surface.rows || void 0 });
};
var uiOverlay_default = UiOverlay;
export {
  uiOverlay_default as default
};
