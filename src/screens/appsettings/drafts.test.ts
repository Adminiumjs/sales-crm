/** Settings' lists: what was typed in a field when the list is read again before it was sent. */
import { describe, expect, it } from "vitest";

import { keptDrafts } from "./Selling.tsx";

describe("what was typed, once the list is read again", () => {
  const server: Record<string, string> = { "name:6": "New stage", "odds:6": "50", "name:2": "Qualified" };
  const now = (key: string) => server[key];

  it("keeps words not sent yet while the server holds what the field held when the typing began", () => {
    // A stage just added, named before its own echo came back: the read that echo brings keeps the name.
    expect(keptDrafts({ "name:6": "Spec stage" }, { "name:6": "New stage" }, {}, now)).toEqual({ "name:6": "Spec stage" });
  });

  it("drops words once sent: the server's value is shown", () => {
    expect(keptDrafts({ "name:6": "Spec stage" }, { "name:6": "New stage" }, { "name:6": "Spec stage" }, now)).toEqual({});
  });

  it("drops words when somebody changed the field meanwhile, or the row went", () => {
    expect(keptDrafts({ "name:2": "Qualified leads" }, { "name:2": "Qualifying" }, {}, now)).toEqual({});
    expect(keptDrafts({ "name:9": "Gone" }, { "name:9": "Gone stage" }, {}, now)).toEqual({});
  });

  it("keeps each field on its own", () => {
    expect(keptDrafts({ "name:6": "Spec stage", "odds:6": "95" }, { "name:6": "New stage", "odds:6": "50" }, { "odds:6": "95" }, now)).toEqual({ "name:6": "Spec stage" });
  });
});
