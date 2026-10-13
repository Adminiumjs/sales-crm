import { readState, standUp } from "./stand.mjs";

/** Start the stand, unless one is already up and answering. */
export default async function globalSetup(): Promise<void> {
  const state = readState();
  if (state?.ready === true) {
    try {
      if ((await fetch(`${String(state.url)}/api/v1/healthz`)).ok) return;
    } catch {
      // Its server is gone: start again.
    }
  }
  await standUp();
}
