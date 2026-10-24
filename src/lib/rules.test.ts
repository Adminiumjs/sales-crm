import { describe, expect, it } from "vitest";

import manifest from "../../whole/manifest.json";
import { StaffError } from "../staffSession.ts";
import { ruleState, ruleStates } from "./rules.ts";

/** A session that answers the rules route, counting how often it is asked. */
function session(answer: () => unknown) {
  const asked: string[] = [];
  return {
    asked,
    call: async <T>(method: string, path: string): Promise<T> => {
      asked.push(`${method} ${path}`);
      return answer() as T;
    },
  };
}
const RULES = { rules: [{ key: "nudge-quiet", name: "A deal has gone quiet", on: true }, { key: "week-rep", name: "Each week", on: false }] };

describe("whether a rule is switched on", () => {
  it("answers on, off, and unknown for a rule the app does not ship", async () => {
    const s = session(() => RULES);
    expect(await ruleState(s, "nudge-quiet")).toBe("on");
    expect(await ruleState(s, "week-rep")).toBe("off");
    expect(await ruleState(s, "no-such-rule")).toBe("unknown");
  });

  it("asks Adminium once for every rule, under the app's key, and again after a minute", async () => {
    const s = session(() => RULES);
    let clock = 1_000;
    const now = () => clock;
    await Promise.all([ruleState(s, "nudge-quiet", now), ruleState(s, "week-rep", now), ruleState(s, "nudge-stuck", now)]);
    expect(s.asked).toEqual(["GET /apps/crm/rules"]);
    clock += 59_000;
    await ruleState(s, "week-rep", now);
    expect(s.asked).toHaveLength(1);
    clock += 2_000;
    await ruleState(s, "week-rep", now);
    expect(s.asked).toHaveLength(2);
  });

  it("claims nothing when the answer cannot be read: a refusal, a lost reply, an older server's shape", async () => {
    for (const broken of [
      () => {
        throw new StaffError(403, "FORBIDDEN", "No.");
      },
      () => {
        throw new TypeError("Failed to fetch");
      },
      () => ({ data: [] }),
      () => null,
      () => ({ rules: "many" }),
    ]) {
      const s = session(broken);
      expect(await ruleState(s, "nudge-quiet")).toBe("unknown");
      expect(await ruleStates(s)).toBeNull();
      // A failed read is asked again, not kept for a minute.
      expect(s.asked).toHaveLength(2);
    }
  });

  it("skips an entry that is not a rule's state, and keeps the others", async () => {
    const s = session(() => ({ rules: [{ key: "nudge-soon", on: "yes" }, { on: true }, null, { key: "nudge-stuck", on: false }] }));
    expect(await ruleStates(s)).toEqual({ "nudge-stuck": false });
  });

  it("is asked by the keys the manifest ships: every rule that tells people has one", () => {
    const keys = (manifest as unknown as { automations: { key: string; enabled: boolean }[] }).automations.filter((rule) => !rule.enabled).map((rule) => rule.key);
    expect(keys).toEqual(["nudge-quiet", "nudge-stuck", "nudge-soon", "follow-up-due", "quote-runs-out", "deal-handed-over", "approval-given", "week-rep", "week-manager"]);
  });
});
