import { describe, expect, it } from "vitest";

import type { StaffSession } from "../staffSession.ts";
import { helpsOn, lentBy } from "./helping.ts";

/** A session as much as the two functions read of it: who is signed in, with which roles, and what a covers list answers. */
function sessionOf(roles: string[], covers: { owner_id: string }[] = [], parts: string[] = ["team"]): { session: StaffSession; asked: unknown[] } {
  const asked: unknown[] = [];
  const session = {
    config: { user: { id: "usr_priya", name: "Priya Raman" }, access: { roles: roles.map((role) => ({ slug: `crm-${role}` })) } },
    part: (id: string) => parts.includes(id),
    can: (table: string, action: string) => table === "covers" && action === "read",
    list: (table: string, query: unknown) => {
      asked.push({ table, query });
      return Promise.resolve({ rows: covers });
    },
  } as unknown as StaffSession;
  return { session, asked };
}

describe("who only helps on a deal (ruling 1d)", () => {
  it("a rep on a colleague's deal she does not cover", () => {
    const { session } = sessionOf(["rep"]);
    expect(helpsOn(session, "usr_dana", new Set())).toBe(true);
    expect(helpsOn(session, "usr_dana", new Set(["usr_dana"]))).toBe(false);
    expect(helpsOn(session, "usr_priya", new Set())).toBe(false);
    expect(helpsOn(session, null, new Set())).toBe(false);
  });

  it("the account manager listed on an open deal helps too; the team's readers never do", () => {
    expect(helpsOn(sessionOf(["account-manager"]).session, "usr_dana", new Set())).toBe(true);
    for (const role of ["sales-manager", "admin", "read-only"]) expect(helpsOn(sessionOf([role]).session, "usr_dana", new Set()), role).toBe(false);
  });

  it("reads the covers running today that name her as the cover, as the board does; none with Team off", async () => {
    const { session, asked } = sessionOf(["rep"], [{ owner_id: "usr_dana" }]);
    expect([...(await lentBy(session, "2026-07-28"))]).toEqual(["usr_dana"]);
    expect(JSON.stringify(asked)).toContain('"cover_id","op":"eq","value":"usr_priya"');
    expect(JSON.stringify(asked)).toContain('"starts_on","op":"lte","value":"2026-07-28"');
    const off = sessionOf(["rep"], [{ owner_id: "usr_dana" }], []);
    expect([...(await lentBy(off.session, "2026-07-28"))]).toEqual([]);
    expect(off.asked).toEqual([]);
  });
});
