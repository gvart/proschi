// Files the Worker imports as modules (wrangler.jsonc `rules`): WebAssembly,
// compiled at upload, and fonts, as bytes.
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
declare module '*.woff' {
  const data: ArrayBuffer;
  export default data;
}
