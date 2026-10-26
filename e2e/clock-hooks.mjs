/**
 * A load hook for the stand's server (registered by `e2e/clock.mjs`): the server's per-minute rate store keeps the
 * REAL clock, as it does in production, while the rest of the server reads the stand's clock.
 *
 * The stand moves JavaScript's clock (the ledger's 09:35, put back by a spec with `ledgerClock`). The rate store
 * (`apps/server/dist/plugins/core.js`, `createBucketStoreClass`) closes a window only once `Date.now()` passes its end,
 * so a window opened before the clock went back stayed open for as long as it went back, and a person's 300 requests a
 * minute lasted forty minutes. Only that one line is changed, and only in the stand; if the line is not found the server
 * runs as it is and says so.
 */
const TARGET = "/apps/server/dist/plugins/core.js";
const LINE = "        incr(key, callback, timeWindow) {\n            const now = Date.now();";

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.endsWith(TARGET) || result.source === undefined || result.source === null) return result;
  const source = typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);
  if (!source.includes(LINE)) {
    process.stderr.write("[stand clock] the rate store's clock line was not found: it keeps the stand's clock\n");
    return result;
  }
  process.stderr.write("[stand clock] the rate store keeps the real clock\n");
  return { ...result, source: source.replace(LINE, LINE.replace("Date.now()", "(globalThis.__standRealNow ?? Date.now)()")) };
}
