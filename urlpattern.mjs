/**
 * URLPattern isn't a global on every Node version in this package's own
 * engines range (>=18.19) -- ship `urlpattern-polyfill` as a real
 * dependency so route compilation works identically everywhere, but prefer
 * a native global when one exists (Deno/Bun/Cloudflare Workers/newer Node
 * don't need the polyfill). Never require the consumer to add it
 * themselves. Mirrors `@johnhenry/servable`'s identical `src/urlpattern.ts`
 * -- same reasoning, same precedence, just plain JS instead of TS here.
 */
import { URLPattern as URLPatternPolyfill } from "urlpattern-polyfill";

export const URLPatternImpl = globalThis.URLPattern ?? URLPatternPolyfill;
