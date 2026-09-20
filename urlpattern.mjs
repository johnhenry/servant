/**
 * This package's engines floor is Node 26+, which has a native global
 * URLPattern (confirmed directly, along with EventTarget/Event/
 * CustomEvent/ErrorEvent -- see controls.mjs). No polyfill dependency
 * needed.
 */
export const URLPatternImpl = globalThis.URLPattern;
