/**
 * Preloaded into the stand's server (`node --import`): its clock starts at
 * `CRM_STAND_NOW` (epoch ms) and runs on from there.
 *
 * The sample's figures are written for one moment, 09:35 on Tuesday 28 July
 * 2026, and its dates are placed from the day it is added. The stand adds the
 * sample at that moment, so every figure a spec reads is the ledger's own, on
 * any day the specs run. Only JavaScript's clock moves; the server reads its
 * "now" from it, and tells the app (the staff config's `now`).
 *
 * The stand may set it again while the server runs: a SIGUSR2, with the new
 * moment in `CRM_STAND_CLOCK_FILE` as "<ms>" or "<ms> still" (held there, for
 * the seconds the sample takes to go in).
 *
 * The server's per-minute rate store is the one part that keeps the real clock (`e2e/clock-hooks.mjs`), as it does in
 * production: else a clock put back keeps every window opened before it open for as long as it was put back.
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";

const target = Number(process.env.CRM_STAND_NOW);
if (Number.isFinite(target)) {
  const RealDate = Date;
  // The server's rate store keeps the real clock (`e2e/clock-hooks.mjs`): only the business's time is the stand's.
  globalThis.__standRealNow = () => RealDate.now();
  register(new URL("./clock-hooks.mjs", import.meta.url));
  let offset = target - RealDate.now();
  let still = null;
  const now = () => still ?? RealDate.now() + offset;
  const file = process.env.CRM_STAND_CLOCK_FILE;
  if (file) {
    process.on("SIGUSR2", () => {
      const [at, mode] = readFileSync(file, "utf8").trim().split(/\s+/);
      const next = Number(at);
      if (!Number.isFinite(next)) return;
      offset = next - RealDate.now();
      still = mode === "still" ? next : null;
    });
  }
  class StandDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(now());
      else super(...args);
    }
    static now() {
      return now();
    }
  }
  globalThis.Date = StandDate;
}
