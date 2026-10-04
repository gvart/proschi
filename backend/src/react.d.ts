// frontend/src/types/canvas.ts, which the parser imports for types, names
// React's CSSProperties in edge styles; the Worker never renders, so a stand-in will do.
declare namespace React {
  type CSSProperties = Record<string, string | number>;
}
