import { addEventListener, removeEventListener } from "./controls.mjs";

// Attach to process object
Object.assign(globalThis, {
  addEventListener,
  removeEventListener,
});
