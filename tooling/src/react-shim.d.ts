// frontend/src/types/canvas.ts mentions a couple of React types in UI-only
// fields. The tooling never touches them; this keeps it from depending on React.
declare namespace React {
  type CSSProperties = Record<string, string | number>;
  type ReactNode = unknown;
}
