/**
 * "After the job"'s reads and writes: what is asked of the server, and what
 * the pages make of the answers. The server here is a function over a few
 * rows shaped as the sample keeps them (the ledger's screens 47, 56, 59, 62).
 */
import { describe, expect, it } from "vitest";

import type { Figure, Grouped, ListQuery, Page, Row, Saved, StaffSession } from "../../staffSession.ts";
import {
  addDays,
  addYears,
  answerValues,
  byCallOrder,
  byClaimOrder,
  byComplaintOrder,
  callState,
  claimMoves,
  inAnswerFilter,
  inCover,
  makeCall,
  readAfterHome,
  readCalls,
  readClaims,
  readComplaints,
  readFeedback,
  readJobs,
  sayThanks,
  type Answer,
  type Call,
  type Claim,
  type Complaint,
} from "./data.ts";

const NOW = new Date("2026-07-28T08:35:00.000Z");

describe("days", () => {
  it("adds days and years as a calendar does", () => {
    expect(addDays("2026-07-28", -3)).toBe("2026-07-25");
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addYears("2025-11-18", 2)).toBe("2027-11-18");
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
  });

  it("says a claim is in cover while it was raised within the years from the fitting day, and unknown without them", () => {
    // wc1: fitted Tue 18 Nov 2025, two years on moving parts, raised Mon 13 Jul 2026.
    expect(inCover("2025-11-18", 2, "2026-07-13")).toBe(true);
    // wc2: fitted Wed 22 Apr 2026, one year on fabric, raised Mon 6 Jul 2026.
    expect(inCover("2026-04-22", 1, "2026-07-06")).toBe(true);
    expect(inCover("2024-04-22", 1, "2026-07-06")).toBe(false);
    expect(inCover("2025-04-22", 1, "2026-04-22")).toBe(true);
    expect(inCover(null, 1, "2026-07-06")).toBeNull();
    expect(inCover("2026-04-22", null, "2026-07-06")).toBeNull();
  });
});

describe("a call", () => {
  it("is made, past due, or coming up by the server's clock", () => {
    expect(callState(true, "2026-07-01T09:00:00Z", NOW)).toBe("made");
    expect(callState(false, "2026-07-28T08:00:00Z", NOW)).toBe("late");
    expect(callState(false, "2026-08-06T09:00:00Z", NOW)).toBe("soon");
  });

  it("lists the past due first (the oldest first), then the coming ones (soonest first), then the made ones (latest first)", () => {
    const call = (id: number, state: Call["state"], dueAt: string): Call => ({ id, jobId: null, job: null, ownerId: null, dueAt, text: null, callNo: 1, outcome: null, done: state === "made", doneAt: null, state });
    const sorted = [call(1, "made", "2026-05-01T09:00:00Z"), call(2, "soon", "2026-08-22T09:00:00Z"), call(3, "late", "2026-07-20T09:00:00Z"), call(4, "made", "2026-06-03T09:00:00Z"), call(5, "soon", "2026-08-06T09:00:00Z"), call(6, "late", "2026-07-01T09:00:00Z")].sort(byCallOrder);
    expect(sorted.map((one) => one.id)).toEqual([6, 3, 5, 2, 4, 1]);
  });
});

describe("an answer, a complaint, a claim", () => {
  const answer = (score: number, repliedAt: string | null): Answer => ({ id: score, jobId: null, job: null, score, text: null, theme: null, answeredOn: null, repliedAt, fix: null });

  it("is in a filter by its score and whether anybody replied", () => {
    expect(["all", "high", "low", "unreplied"].map((filter) => inAnswerFilter(answer(5, null), filter as never))).toEqual([true, true, false, true]);
    expect(["all", "high", "low", "unreplied"].map((filter) => inAnswerFilter(answer(3, "2026-04-21T09:00:00Z"), filter as never))).toEqual([true, false, true, false]);
  });

  it("sends a typed answer trimmed, an empty field as nothing", () => {
    expect(answerValues({ jobId: 2, score: 4, text: "  Good.  ", theme: " ", answeredOn: "2026-07-28" })).toEqual({ job_id: 2, score: 4, text: "Good.", theme: null, answered_on: "2026-07-28" });
  });

  it("lists complaints open first, then answered, then settled, the newest first in each", () => {
    const one = (id: number, state: Complaint["state"], raisedOn: string): Complaint => ({ id, companyId: null, company: null, contactId: null, contact: null, contactTitle: null, jobId: null, jobCode: null, ownerId: null, text: null, answer: null, cause: null, fairness: null, raisedOn, state });
    expect([one(1, "settled", "2026-07-09"), one(2, "open", "2026-07-16"), one(3, "answered", "2026-07-21"), one(4, "open", "2026-07-27")].sort(byComplaintOrder).map((row) => row.id)).toEqual([4, 2, 3, 1]);
  });

  it("lists claims to raise first and sorted last, and offers only the moves the table allows from each state", () => {
    const one = (id: number, state: Claim["state"], raisedOn: string): Claim => ({ id, jobId: null, job: null, contact: null, what: "", part: null, cover: null, coverYears: null, raisedOn, supplier: null, paidBy: null, state });
    expect([one(1, "sorted", "2026-06-24"), one(2, "with-supplier", "2026-07-27"), one(3, "to-raise", "2026-07-25"), one(4, "parts-coming", "2026-07-06"), one(5, "with-supplier", "2026-07-13")].sort(byClaimOrder).map((row) => row.id)).toEqual([3, 5, 2, 4, 1]);
    expect(claimMoves("to-raise")).toEqual(["raise"]);
    // With the supplier, a claim goes to "parts on the way" or is turned down: never straight to sorted.
    expect(claimMoves("with-supplier")).toEqual(["parts-coming"]);
    expect(claimMoves("parts-coming")).toEqual(["sorted"]);
    expect(claimMoves("sorted")).toEqual([]);
    expect(claimMoves("turned-down")).toEqual([]);
  });
});

// ── the server, faked ─────────────────────────────────────────────────────────

interface Fake {
  session: StaffSession;
  lists: { ref: string; q: ListQuery }[];
  figures: Figure[];
  updates: { ref: string; id: unknown; values: Row; seen?: Row }[];
}

/** A session over fixed rows: a list answers the table's rows (cut by `limit`), a figure answers what `answer` says. */
function fake(rows: Record<string, Row[]>, answer: (figure: Figure) => unknown, opts: { cannot?: string[]; update?: (ref: string, id: unknown) => Saved; get?: Row | null } = {}): Fake {
  const lists: Fake["lists"] = [];
  const figures: Figure[] = [];
  const updates: Fake["updates"] = [];
  const session = {
    now: () => NOW,
    can: (ref: string) => !(opts.cannot ?? []).includes(ref),
    list: async (ref: string, q: ListQuery = {}): Promise<Page> => {
      lists.push({ ref, q });
      const all = rows[ref] ?? [];
      return { rows: all.slice(0, q.limit ?? 200), total: all.length, next: null };
    },
    figure: async (figure: Figure) => {
      figures.push(figure);
      return answer(figure);
    },
    update: async (ref: string, id: unknown, values: Row, more: { seen?: Row } = {}) => {
      updates.push({ ref, id, values, ...(more.seen === undefined ? {} : { seen: more.seen }) });
      return opts.update?.(ref, id) ?? { state: "saved", row: { id, ...values }, replayed: false, readBack: false };
    },
    get: async () => opts.get ?? null,
    people: async () => [{ id: "u-hugo", name: "Hugo Brandt" }],
    config: { user: { id: "u-hugo", name: "Hugo Brandt" } },
  } as unknown as StaffSession;
  return { session, lists, figures, updates };
}

const grouped = (items: [string | null, number][]): Grouped => ({ shape: "categorical", items: items.map(([key, n]) => ({ key, label: key, value: n, values: { n } })), total: 0 });
const where = (figure: Figure): string => JSON.stringify(figure.filters ?? []);

const JOBS: Row[] = [
  { id: 1, code: "J-01", title: "Reception refit, fourth floor", company_id: 11, contact_id: 21, owner: "u-dana" },
  { id: 6, code: "J-06", title: "Legal library shelving", company_id: 11, contact_id: 22, owner: "u-dana" },
  { id: 8, code: "J-08", title: "Studio meeting tables", company_id: 12, contact_id: 23, owner: "u-dana" },
];
const BASE: Record<string, Row[]> = {
  jobs: JOBS,
  sign_offs: [
    { job_id: 1, signed_at: "2025-11-18T16:00:00Z" },
    { job_id: 6, signed_at: "2026-05-06T15:00:00Z" },
    { job_id: 8, signed_at: "2026-07-25T15:00:00Z" },
  ],
  job_visits: [
    { job_id: 8, day: "2026-07-24" },
    { job_id: 1, day: "2025-11-18" },
    { job_id: 6, day: "2026-05-06" },
  ],
  companies: [
    { id: 11, name: "Cobalt Legal" },
    { id: 12, name: "Veldt Studios" },
  ],
  contacts: [
    { id: 21, name: "Tomas Reidy", job_title: "Facilities manager" },
    { id: 22, name: "Ines Vaughan", job_title: null },
    { id: 23, name: "Marta Kovac", job_title: "Studio manager" },
  ],
  settings: [{ aftercare_days: 28, complaint_answer_days: 3, claim_red_days: 21 }],
};

describe("the jobs a page names", () => {
  it("gives each its code, title, company, contact, sign-off and fitting day, each read only where the reader may", async () => {
    const { session, lists } = fake(BASE, () => ({ value: 0 }));
    const jobs = await readJobs(session, [8, 1, 8]);
    expect(jobs.get(8)).toEqual({ id: 8, code: "J-08", title: "Studio meeting tables", companyId: 12, company: "Veldt Studios", contactId: 23, contact: "Marta Kovac", contactTitle: "Studio manager", ownerId: "u-dana", signedAt: "2026-07-25T15:00:00Z", fittedOn: "2026-07-24" });
    expect(lists.find((one) => one.ref === "jobs")?.q.where).toEqual({ column: "id", op: "in", value: [8, 1] });
    expect(lists.find((one) => one.ref === "job_visits")?.q.where).toEqual({ and: [{ column: "job_id", op: "in", value: [8, 1] }, { column: "kind", op: "eq", value: "install" }] });
  });

  it("leaves a job's facts empty, and asks nothing, where the reader does not read the jobs", async () => {
    const { session, lists } = fake(BASE, () => ({ value: 0 }), { cannot: ["jobs", "sign_offs", "job_visits"] });
    const jobs = await readJobs(session, [1]);
    expect(jobs.get(1)).toMatchObject({ code: null, title: null, company: null, signedAt: null, fittedOn: null });
    expect(lists.map((one) => one.ref)).toEqual([]);
  });

  it("asks no deal's owner of somebody who reads no deal", async () => {
    const { session, lists } = fake(BASE, () => ({ value: 0 }), { cannot: ["deals"] });
    await readJobs(session, [1]);
    expect(lists.find((one) => one.ref === "jobs")?.q.lookup).toBeUndefined();
  });
});

describe("Aftercare calls", () => {
  const CALLS: Row[] = [
    { id: 1, job_id: 1, owner_id: "u-hugo", due_at: "2025-12-16T10:00:00Z", text: "Aftercare call", call_no: 1, outcome: "none", done: true, done_at: "2025-12-16T10:30:00Z" },
    { id: 6, job_id: 6, owner_id: "u-hugo", due_at: "2026-06-03T09:00:00Z", text: "Aftercare call", call_no: 1, outcome: "more-work", done: 1, done_at: "2026-06-03T09:30:00Z" },
    { id: 9, job_id: 6, owner_id: "u-hugo", due_at: "2026-08-06T09:00:00Z", text: "Aftercare call", call_no: 2, outcome: null, done: false, done_at: null },
    { id: 8, job_id: 8, owner_id: "u-hugo", due_at: "2026-08-22T09:00:00Z", text: "Aftercare call", call_no: 1, outcome: null, done: false, done_at: null },
  ];

  it("asks the server each count, told apart by its clock, and lists the calls with their jobs", async () => {
    const { session, figures } = fake({ ...BASE, follow_ups: CALLS }, (figure) => {
      const w = where(figure);
      if (w.includes('"more-work"')) return { value: 1 };
      if (w.includes('"lt"')) return { value: 0 };
      if (w.includes('"gte"')) return { value: 2 };
      if (w.includes('"value":true')) return { value: 2 };
      return { value: 4 };
    });
    const data = await readCalls(session);
    expect([data.total, data.made, data.late, data.soon, data.moreWork]).toEqual([4, 2, 0, 2, 1]);
    // Every figure is of the aftercare calls only, and "past due" is the server's moment, not the browser's.
    expect(figures.every((figure) => where(figure).includes('{"column":"kind","op":"eq","value":"aftercare"}'))).toBe(true);
    expect(figures.some((figure) => where(figure).includes(`{"column":"due_at","op":"lt","value":"${NOW.toISOString()}"}`))).toBe(true);
    expect(data.rows.map((call) => [call.id, call.state])).toEqual([
      [9, "soon"],
      [8, "soon"],
      [6, "made"],
      [1, "made"],
    ]);
    expect(data.rows[0]!.job?.code).toBe("J-06");
    expect(data.rows[0]!.callNo).toBe(2);
    expect(data.names["u-hugo"]).toBe("Hugo Brandt");
    expect(data.settings.aftercareDays).toBe(28);
  });

  it("makes a call once: done with its outcome, only while it still reads as not done", async () => {
    const { session, updates } = fake(BASE, () => ({ value: 0 }));
    expect(await makeCall(session, 9, "more-work")).toEqual({ state: "saved", mine: true });
    expect(updates).toEqual([{ ref: "follow_ups", id: 9, values: { done: true, outcome: "more-work" }, seen: { done: false } }]);
  });

  it("reads the row back when a colleague made it first, and says so", async () => {
    const refused = { state: "refused", error: Object.assign(new Error("changed"), { status: 409, code: "ROW_CHANGED", details: {} }) } as unknown as Saved;
    const { session } = fake(BASE, () => ({ value: 0 }), { update: () => refused, get: { id: 9, done: true } });
    expect(await makeCall(session, 9, "none")).toEqual({ state: "saved", mine: false });
  });

  it("says nothing certain when the reply is lost and the row cannot be read", async () => {
    const { session } = fake(BASE, () => ({ value: 0 }), { update: () => ({ state: "unknown" }), get: null });
    expect(await makeCall(session, 9, "none")).toEqual({ state: "unknown" });
  });
});

describe("What customers said", () => {
  const ANSWERS: Row[] = [
    { id: 2, job_id: 8, score: 5, text: "In and out in a morning.", theme: "Drawings matched the room", answered_on: "2026-07-27", replied_at: null, fix_written: null },
    { id: 3, job_id: 6, score: 5, text: "Two floors, no fuss.", theme: null, answered_on: "2026-05-09", replied_at: "2026-05-10T09:00:00Z", fix_written: null },
  ];

  it("asks every figure of the server, and names the signed-off jobs with no answer yet", async () => {
    const { session, figures } = fake({ ...BASE, feedback: ANSWERS }, (figure) => {
      if (figure.shape === "categorical") return grouped([["Drawings matched the room", 1], [null, 2], ["A date moved", 1]]);
      if (figure.aggregations?.[0]?.fn === "avg") return { value: 4.4 };
      const w = where(figure);
      if (w.includes('"fix_written"')) return { value: 1 };
      if (w.includes('"lte"')) return { value: 1 };
      if (w.includes('"gte"')) return { value: 4 };
      if (w.includes('"not_null"')) return { value: 4 };
      if (w.includes('"is_null"')) return { value: 1 };
      return { value: 5 };
    });
    const data = await readFeedback(session);
    expect([data.count, data.average, data.replied, data.high, data.low, data.lowFixed, data.unreplied]).toEqual([5, 4.4, 4, 4, 1, 1, 1]);
    // The most named first; "no theme" counted by the server like any other.
    expect(data.themes).toEqual([
      { theme: null, n: 2 },
      { theme: "A date moved", n: 1 },
      { theme: "Drawings matched the room", n: 1 },
    ]);
    expect(figures.find((figure) => figure.shape === "categorical")?.groupBy).toEqual(["theme"]);
    // J-01 was signed off and has no answer; J-06 and J-08 have one.
    expect(data.waiting?.map((job) => job.code)).toEqual(["J-01"]);
    expect(data.rows.map((row) => [row.id, row.job?.code, row.answeredOn])).toEqual([
      [2, "J-08", "2026-07-27"],
      [3, "J-06", "2026-05-09"],
    ]);
  });

  it("cannot say which jobs are waiting when it cannot read the sign-offs", async () => {
    const { session } = fake({ ...BASE, feedback: ANSWERS }, (figure) => (figure.shape === "categorical" ? grouped([]) : { value: 0 }), { cannot: ["sign_offs"] });
    expect((await readFeedback(session)).waiting).toBeNull();
  });

  it("keeps a thank-you once, at the server's moment", async () => {
    const { session, updates } = fake(BASE, () => ({ value: 0 }));
    expect(await sayThanks(session, 2)).toEqual({ state: "saved", mine: true });
    expect(updates).toEqual([{ ref: "feedback", id: 2, values: { replied_at: NOW.toISOString() }, seen: { replied_at: null } }]);
  });
});

describe("Customer complaints", () => {
  const COMPLAINTS: Row[] = [
    { id: 1, company_id: 13, contact_id: 24, job_id: 4, owner_id: "u-sam", text: "We cleared the floor.", answer: null, cause: "late", fairness: "serious", raised_on: "2026-07-16", state: "open", company: "Nordwind Logistics", contact: "Petra Lindqvist", contact_title: null, job: "J-04" },
    { id: 3, company_id: 14, contact_id: 25, job_id: 5, owner_id: "u-dana", text: "The ward is grey.", answer: "Our error.", cause: "wrong", fairness: "serious", raised_on: "2026-07-09", state: "settled", company: "Fernway Clinics", contact: "Ana Belova", contact_title: null, job: "J-05" },
  ];

  it("counts by state and cause on the server, and holds 'overdue' to the setting's days back from the server's today", async () => {
    const { session, figures, lists } = fake({ ...BASE, complaints: COMPLAINTS }, (figure) => {
      if (figure.shape === "categorical") return figure.groupBy?.[0] === "state" ? grouped([["open", 3], ["answered", 2], ["settled", 2]]) : grouped([["late", 2], ["damaged", 1], ["wrong", 2], ["crew", 1], ["silence", 1]]);
      const w = where(figure);
      if (w.includes('"raised_on"')) return { value: 2 };
      if (w.includes('"not_null"')) return { value: 5 };
      if (w.includes('"is_null"')) return { value: 2 };
      return { value: 7 };
    });
    const data = await readComplaints(session, "2026-07-28");
    expect(data.byState).toEqual({ open: 3, answered: 2, settled: 2 });
    expect([data.total, data.slow, data.onJob, data.beforeJob]).toEqual([7, 2, 5, 2]);
    expect(data.topCauses).toEqual(["late", "wrong"]);
    expect(data.topCount).toBe(2);
    expect(figures.some((figure) => where(figure) === JSON.stringify([{ column: "state", op: "eq", value: "open" }, { column: "raised_on", op: "lte", value: "2026-07-25" }]))).toBe(true);
    expect(lists.find((one) => one.ref === "complaints")?.q.lookup).toEqual(["company:company_id.name", "contact:contact_id.name", "contact_title:contact_id.job_title", "job:job_id.code"]);
    expect(data.rows.map((row) => [row.id, row.state, row.jobCode, row.answer])).toEqual([
      [1, "open", "J-04", null],
      [3, "settled", "J-05", "Our error."],
    ]);
  });
});

describe("Warranty claims", () => {
  const CLAIMS: Row[] = [
    { id: 2, job_id: 6, contact_id: 22, what: "Ward seating fabric pilling", part: "Corridor seating", cover: "fabric", cover_years: 1, raised_on: "2026-07-06", supplier_name: "Trellis Textiles", paid_by: "supplier", state: "parts-coming", contact: "Ana Belova" },
    { id: 3, job_id: 8, contact_id: 23, what: "Table leg weld cracked", part: "Meeting table", cover: "frame", cover_years: 5, raised_on: "2026-07-27", supplier_name: "Ostrom Seating", paid_by: null, state: "with-supplier", contact: "Marta Kovac" },
  ];

  it("counts by state and who paid on the server, and takes the longest open from the server's own order", async () => {
    const { session, lists } = fake({ ...BASE, warranty_claims: CLAIMS }, (figure) => {
      if (figure.shape === "categorical") return figure.groupBy?.[0] === "state" ? grouped([["to-raise", 1], ["with-supplier", 2], ["parts-coming", 1], ["sorted", 1]]) : grouped([["supplier", 2], ["us", 1], ["__null", 2]]);
      return { value: where(figure).includes('"in"') ? 4 : 5 };
    });
    const data = await readClaims(session);
    expect(data.byState).toEqual({ "to-raise": 1, "with-supplier": 2, "parts-coming": 1, sorted: 1, "turned-down": 0 });
    expect([data.total, data.inHand]).toEqual([5, 4]);
    expect(data.paid).toEqual({ supplier: 2, us: 1, none: 0, open: 2 });
    expect(data.oldest?.id).toBe(2);
    expect(lists.find((one) => one.ref === "warranty_claims" && one.q.limit === 1)?.q.where).toEqual({ column: "state", op: "in", value: ["to-raise", "with-supplier", "parts-coming"] });
    expect(data.rows.map((row) => [row.id, row.job?.fittedOn])).toEqual([
      [3, "2026-07-24"],
      [2, "2026-05-06"],
    ]);
  });
});

describe("the account manager's home", () => {
  it("reads only the lists of the pages the person may open", async () => {
    const { session, lists, figures } = fake({ ...BASE, follow_ups: [], complaints: [], feedback: [] }, () => ({ value: 3 }));
    const data = await readAfterHome(session, "2026-07-28", { calls: true, complaints: false, answers: true });
    expect(data.complaints).toBeNull();
    expect(data.calls).toEqual({ due: 3, late: 3, rows: [] });
    expect(data.answers).toEqual({ unreplied: 3, rows: [] });
    expect(lists.some((one) => one.ref === "complaints" || one.ref === "settings")).toBe(false);
    expect(figures.some((figure) => figure.table === "complaints")).toBe(false);
  });
});
