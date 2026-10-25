/**
 * The crew's phone (P22), what is worked out in the browser: which crews are
 * his, the week, the links a phone hands to its own apps, what a visit
 * offers, and what each save is as a line of the phone's offline queue: a
 * sign-off one create with a key, a put-right a change naming what it saw.
 */
import { describe, expect, it } from "vitest";

import { StaffError } from "../../staffSession.ts";
import { addressLines, checksOf, COPY_TO_MAX, copyToOk, crewsOf, fileIds, lastShift, mapsHref, offersSignOff, putRightLine, signOffLine, SNAGS_AT_SIGNING_MAX, snagLine, snagsAtSigning, snagOrder, stoppers, telHref, tickLine, ticksOpen, timeSpan, weekDays, type CrewSnag } from "./data.ts";
import { recordKey, signWhy } from "./queue.tsx";

const snag = (over: Partial<CrewSnag>): CrewSnag => ({ id: 1, job_id: 7, visit_id: 7, text: "Cable trays", stops_sign_off: false, state: "open", raised_on: "2026-07-21", raised_by_id: null, raised_by_contact_id: null, due_on: "2026-07-27", put_right_on: null, put_right_note: null, code: null, title: null, site: null, photo: null, put_right_photo: null, ...over });

describe("what the crew's day is made of", () => {
  it("knows his crews from the members the server lists, once each", () => {
    const members = [
      { id: 1, crew_id: 1, user_id: "usr_y", lead: true, phone: null, since: null },
      { id: 2, crew_id: 1, user_id: "usr_c", lead: false, phone: null, since: null },
      { id: 3, crew_id: 2, user_id: "usr_y", lead: false, phone: null, since: null },
    ];
    expect(crewsOf({ members }, "usr_y")).toEqual([1, 2]);
    expect(crewsOf({ members }, "usr_x")).toEqual([]);
    expect(crewsOf({ members }, null)).toEqual([]);
  });

  it("puts a day in its week, Monday first", () => {
    expect(weekDays("2026-08-04")).toEqual(["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"]);
    expect(weekDays("2026-08-09")[0]).toBe("2026-08-03");
  });

  it("works out a visit's end from its start and hours, and nothing from none", () => {
    expect(timeSpan("08:00", 6)).toEqual({ from: "08:00", to: "14:00" });
    expect(timeSpan("07:30", "2.5")).toEqual({ from: "07:30", to: "10:00" });
    expect(timeSpan(null, 6)).toBeNull();
    expect(timeSpan("08:00", null)).toBeNull();
  });

  it("keeps ticks open on a booked visit of today or later, and read-only once it is past or made", () => {
    expect(ticksOpen({ day: "2026-07-28", state: "booked" }, "2026-07-28")).toBe(true);
    expect(ticksOpen({ day: "2026-08-04", state: "booked" }, "2026-07-28")).toBe(true);
    expect(ticksOpen({ day: "2026-07-21", state: "booked" }, "2026-07-28")).toBe(false);
    expect(ticksOpen({ day: "2026-07-28", state: "done" }, "2026-07-28")).toBe(false);
  });

  it("offers 'Sign off the job' on a fitting or a return visit of an unsigned job, on its day or after, never on a drop or a signed job (B19)", () => {
    expect(offersSignOff({ kind: "install", day: "2026-07-21" }, false, "2026-07-28")).toBe(true);
    expect(offersSignOff({ kind: "return", day: "2026-07-28" }, false, "2026-07-28")).toBe(true);
    expect(offersSignOff({ kind: "return", day: "2026-08-04" }, false, "2026-07-28")).toBe(false);
    expect(offersSignOff({ kind: "drop", day: "2026-07-21" }, false, "2026-07-28")).toBe(false);
    expect(offersSignOff({ kind: "install", day: "2026-07-21" }, true, "2026-07-28")).toBe(false);
  });

  it("lists his snags open first, then waiting on a part, then put right, the newest raised first; and names the ones that stop a job's sign-off", () => {
    const all = [snag({ id: 1, state: "put-right" }), snag({ id: 2, state: "waiting-part" }), snag({ id: 3, raised_on: "2026-07-24" }), snag({ id: 4, stops_sign_off: true })];
    expect([...all].sort(snagOrder).map((one) => one.id)).toEqual([3, 4, 2, 1]);
    expect(stoppers(all, 7).map((one) => one.id)).toEqual([4]);
    expect(stoppers([snag({ stops_sign_off: true, state: "put-right" })], 7)).toEqual([]);
    expect(stoppers(all, 8)).toEqual([]);
  });
});

describe("what the office changed", () => {
  const row = { day: "2026-08-04", start_time: "08:00", crew_id: 1, tick_loaded: false };
  it("finds the last real move of day, start or crew in a history whose entries hold whole rows, and passes over a tick", () => {
    const entries = [
      { createdAt: 3000, actorLabel: "Yusuf Adeyemi", changes: { before: { ...row, start_time: "07:30" }, after: { ...row, start_time: "07:30", tick_loaded: true } } },
      { createdAt: 2000, actorLabel: "Ada Novak", changes: { before: row, after: { ...row, start_time: "07:30" } } },
    ];
    expect(lastShift(entries)).toEqual({ day: null, start: "08:00", crewId: null, by: "Ada Novak", at: new Date(2000) });
    expect(lastShift([entries[0]!])).toBeNull();
  });
  it("reads a day moved, and passes over a booking that first gives a waiting visit its day", () => {
    expect(lastShift([{ createdAt: "1000", actorLabel: "Ada Novak", changes: { before: row, after: { ...row, day: "2026-08-06" } } }])).toMatchObject({ day: "2026-08-04", start: null });
    expect(lastShift([{ createdAt: 1000, actorLabel: "Ada Novak", changes: { before: { ...row, day: null }, after: row } }])).toBeNull();
  });
});

describe("links a phone hands to its own apps", () => {
  const where = addressLines({ site_address: "Unit 6, Fen Road Park", site_town: "Cambridge" });
  it("writes the address as the visit carries it: its lines, then the town", () => {
    expect(where).toEqual(["Unit 6, Fen Road Park", "Cambridge"]);
    expect(addressLines({ site_address: null, site_town: null })).toEqual([]);
  });

  it("opens Apple's maps on an Apple phone, geo: on any other phone, and OpenStreetMap in a new tab on a desk (B16)", () => {
    const q = encodeURIComponent("Unit 6, Fen Road Park, Cambridge");
    expect(mapsHref(where, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", true)).toEqual({ href: `https://maps.apple.com/?q=${q}`, newTab: false });
    expect(mapsHref(where, "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile", true)).toEqual({ href: `geo:0,0?q=${q}`, newTab: false });
    expect(mapsHref(where, "Mozilla/5.0 (X11; Linux x86_64)", false)).toEqual({ href: `https://www.openstreetmap.org/search?query=${q}`, newTab: true });
  });

  it("calls a number by its digits and a leading plus only", () => {
    expect(telHref("0113 496 0190")).toBe("tel:01134960190");
    expect(telHref("+44 (0)113 496-0190")).toBe("tel:+4401134960190");
    expect(telHref("ask at the desk")).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});

describe("a save of the phone's: a line of the offline queue (plan 68 S19)", () => {
  const SIG = "file_01SIGNATURE0000000000000A";
  const PHOTO = "file_01PHOTO000000000000000000B";
  const HELD_SIG = "phone_SIGNATURE000000000000000000A";
  const HELD_PHOTO = "phone_PHOTO00000000000000000000000B";

  it("reads the ids a file column holds, as text or as a list kept as JSON", () => {
    expect(fileIds(SIG)).toEqual([SIG]);
    expect(fileIds([PHOTO, SIG])).toEqual([PHOTO, SIG]);
    expect(fileIds(JSON.stringify([PHOTO]))).toEqual([PHOTO]);
    expect(fileIds(null)).toEqual([]);
    expect(fileIds("not a file")).toEqual([]);
  });

  it("tells the server's refusals of a sign-off apart: a snag that stops it, a sign-off already there, anything else", () => {
    const of = (error: StaffError) => signWhy({ refusal: { status: error.status, code: error.code, message: "", details: error.details, at: "" } });
    expect(of(new StaffError(422, "VALIDATION_FAILED", "", { fields: { job_id: { code: "not-allowed" } } }))).toBe("snag");
    expect(of(new StaffError(409, "UNIQUE_VIOLATION", "", { columns: ["job_id", "version"] }))).toBe("signed");
    expect(of(new StaffError(403, "FORBIDDEN", ""))).toBe("other");
  });

  it("makes a sign-off ONE create carrying its key: the five checks, the name, the signature and the photos, and what the customer was shown; refused, the signature goes", () => {
    const open = [
      { text: " Edge trim lifting ", due_on: "2026-08-03", put_right_note: null },
      { text: "Wrong castors", due_on: "2026-07-30T00:00:00.000Z", put_right_note: " Right castors go out on Thursday. " },
    ];
    const words = ["Everything on the list is on site", "Nothing damaged,\n nothing marked", "Keys", "Floor", "Shown"];
    const line = signOffLine({ visitId: 7, jobId: 3, site: "Tandem Robotics", checks: [true, true, true, true, true], signer: " Yusuf Demir ", signature: HELD_SIG, photos: [HELD_PHOTO], open, checkWords: words }, "KEY");
    expect(line.op).toEqual({
      type: "create",
      table: "sign_offs",
      key: "KEY",
      values: {
        visit_id: 7,
        signer_name: "Yusuf Demir",
        signature: HELD_SIG,
        photos: [HELD_PHOTO],
        check_1: true,
        check_2: true,
        check_3: true,
        check_4: true,
        check_5: true,
        snags_at_signing: JSON.stringify([
          { what: "Edge trim lifting", by: "2026-08-03", note: "" },
          { what: "Wrong castors", by: "2026-07-30", note: "Right castors go out on Thursday." },
        ]),
        // One check a line, whatever line breaks a translation holds.
        check_words: "Everything on the list is on site\nNothing damaged, nothing marked\nKeys\nFloor\nShown",
      },
    });
    // Nothing open: an empty list, which the copy prints as "Nothing was left to put right."
    const none = signOffLine({ visitId: 7, jobId: 3, site: "T", checks: [true, true, true, true, true], signer: "Y", signature: HELD_SIG, photos: [], open: [], checkWords: words }, "KEY2");
    expect(none.op.type === "create" && none.op.values["snags_at_signing"]).toBe("[]");
    expect(line.dropOnRefusal).toEqual(["signature"]);
    expect(line.meta).toMatchObject({ visit: 7, job: 3, signer: "Yusuf Demir", checks: 5, photos: 1 });
    expect(line.op.type === "create" && checksOf(line.op.values)).toEqual([true, true, true, true, true]);
  });

  it("sends the signed copy also to an address typed on the form, with the sign-off itself, and checks it as the server does", () => {
    const words = ["a", "b", "c", "d", "e"];
    const draft = { visitId: 7, jobId: 3, site: "T", checks: [true, true, true, true, true], signer: "Y", signature: HELD_SIG, photos: [], open: [], checkWords: words };
    const typed = signOffLine({ ...draft, copyTo: "  site.office@tandem.example " }, "KEY3");
    expect(typed.op.type === "create" && typed.op.values["copy_sent_to"]).toBe("site.office@tandem.example");
    // None typed: the column is left out, as before (the job's contact gets the copy either way).
    for (const copyTo of [undefined, "", "   "]) {
      const none = signOffLine({ ...draft, ...(copyTo === undefined ? {} : { copyTo }) }, "KEY4");
      expect(none.op.type === "create" && "copy_sent_to" in none.op.values).toBe(false);
    }
    for (const ok of ["", "  ", "a@b.co", " site.office@harbour-fitouts.stand ", "ana+copy@fernway-clinics.com"]) expect(copyToOk(ok), ok).toBe(true);
    for (const bad of ["ana", "ana@", "ana@fernway", "@fernway.com", "ana belova@fernway.com", "ana@fern way.com", `${"a".repeat(COPY_TO_MAX)}@x.co`]) expect(copyToOk(bad), bad).toBe(false);
  });

  it("keeps the open snags within the column's bound by dropping the last ones, never the list's shape", () => {
    const open = Array.from({ length: 120 }, (_, i) => ({ text: `Snag ${String(i)} ${"x".repeat(380)}`, due_on: "2026-08-03", put_right_note: "n".repeat(100) }));
    const text = snagsAtSigning(open);
    expect(text.length).toBeLessThanOrEqual(SNAGS_AT_SIGNING_MAX);
    const kept = JSON.parse(text) as { what: string }[];
    expect(kept.length).toBeGreaterThan(10);
    expect(kept.length).toBeLessThan(120);
    expect(kept[0]!.what.startsWith("Snag 0 ")).toBe(true);
  });

  it("makes a put-right a change that names the state it saw, and a tick a change of the visit alone", () => {
    expect(putRightLine(snag({ id: 4, state: "waiting-part" }), "Tandem Robotics", " New top ", HELD_PHOTO).op).toEqual({ type: "update", table: "snags", id: 4, values: { state: "put-right", put_right_note: "New top", put_right_photo: HELD_PHOTO }, seen: { state: "waiting-part" } });
    expect(tickLine({ id: 7, job_id: 3, site_name: "Tandem Robotics" }, "tick_done", true).op).toEqual({ type: "update", table: "job_visits", id: 7, values: { tick_done: true } });
    expect(snagLine({ visitId: 7, jobId: 3, site: "Tandem Robotics", text: " Gap ", stops: true, photo: null }, "usr_y", "SNAGKEY").op).toEqual({ type: "create", table: "snags", key: "SNAGKEY", values: { visit_id: 7, text: "Gap", stops_sign_off: true, raised_by_id: "usr_y" } });
  });

  it("writes a refused sign-off's record with a key made from the sign-off's own, so the same refusal is one record", () => {
    expect(recordKey("KEY0000000000000000000000000001")).toBe("REY0000000000000000000000000001");
    expect(recordKey("KEY0000000000000000000000000001")).not.toBe("KEY0000000000000000000000000001");
  });
});
