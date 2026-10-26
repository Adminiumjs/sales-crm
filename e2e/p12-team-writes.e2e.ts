/**
 * Plan 68, T04 (S5): the Team screens' five writes and their left-out pieces, on the sample, on the ledger's Tuesday
 * 28 July 2026. A conversation started with its people; the meeting's running order ticked off ("N of 6 covered")
 * and a decision carried over; a coaching area with its why, what good looks like and live number, added and renamed;
 * a one-to-one's "what to cover" ticked, something else raised, its length, and its actions under it; a new starter
 * with her patch and the last starter's steps.
 *
 * WHAT A SPEC MAKES starts "Spec: " and is taken away after every test, with the running order's ticks put back.
 *
 * WHY THE NAME: it runs with the other team specs, BEFORE `quotes.e2e.ts` (which leaves two deals lost and so moves
 * the closed figures a coaching area may show).
 */
import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "./fixtures.ts";
import { csrf, type Data, ledgerClock, rows, STAFF, watch } from "./helpers.ts";
import { me, room } from "./p12-helpers.ts";

// The ledger's figures are those of 09:35 (a follow-up falls due at 10:00): the stand's clock is put back there for this file.
test.beforeAll(() => ledgerClock());

const isYes = (value: unknown): boolean => value === true || value === 1 || value === "1";
const spec = { column: "text", op: "like", value: "Spec: %" };

async function tidy(api: (person: string) => Promise<APIRequestContext>, data: Data): Promise<void> {
  const owner = await api("owner");
  const ownerHeaders = await csrf(owner);
  const drop = async (who: APIRequestContext, headers: Record<string, string>, table: string, id: number): Promise<void> => {
    expect((await who.delete(data(table, `/${String(id)}?confirm=true`), { headers })).status(), `${table} ${String(id)}`).toBeLessThan(300);
  };
  // The conversations a spec started: their messages, their people, then them.
  for (const row of await rows<{ id: number }>(owner, data, "messages", spec)) await drop(owner, ownerHeaders, "messages", row.id);
  for (const thread of await rows<{ id: number }>(owner, data, "threads", { column: "title", op: "like", value: "Spec: %" })) {
    for (const row of await rows<{ id: number }>(owner, data, "messages", { column: "thread_id", op: "eq", value: thread.id })) await drop(owner, ownerHeaders, "messages", row.id);
    for (const row of await rows<{ id: number }>(owner, data, "thread_members", { column: "thread_id", op: "eq", value: thread.id })) await drop(owner, ownerHeaders, "thread_members", row.id);
    await drop(owner, ownerHeaders, "threads", thread.id);
  }
  for (const row of await rows<{ id: number }>(owner, data, "actions", spec)) await drop(owner, ownerHeaders, "actions", row.id);
  const ivy = await api("ivy");
  const ivyHeaders = await csrf(ivy);
  for (const row of await rows<{ id: number }>(ivy, data, "one_to_one_sessions", { column: "notes", op: "like", value: "Spec: %" })) await drop(ivy, ivyHeaders, "one_to_one_sessions", row.id);
  for (const row of await rows<{ id: number }>(ivy, data, "coaching_areas", { column: "title", op: "like", value: "Spec: %" })) await drop(ivy, ivyHeaders, "coaching_areas", row.id);
  for (const row of await rows<{ id: number }>(ivy, data, "meeting_decisions", spec)) await drop(ivy, ivyHeaders, "meeting_decisions", row.id);
  for (const row of await rows<{ id: number; covered: unknown }>(ivy, data, "meeting_slots")) {
    if (isYes(row.covered)) expect((await ivy.patch(data("meeting_slots", `/${String(row.id)}`), { data: { values: { covered: false } }, headers: ivyHeaders })).status()).toBe(200);
  }
  for (const starter of await rows<{ id: number }>(ivy, data, "starters", { column: "name", op: "like", value: "Spec: %" })) {
    for (const step of await rows<{ id: number }>(ivy, data, "starter_steps", { column: "starter_id", op: "eq", value: starter.id })) await drop(ivy, ivyHeaders, "starter_steps", step.id);
    await drop(ivy, ivyHeaders, "starters", starter.id);
  }
}

test.afterEach(async ({ api, data }) => {
  await tidy(api, data);
});

test("Messages: a new conversation is made with its people; with one colleague already talked to, that one opens (T04, D3, D12)", async ({ as, api, data }) => {
  const context = await as("dana");
  await room(context.request, data, 80);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}messages`);
  await expect(page.locator(".crm-ms-thread")).toHaveCount(4);
  const before = (await rows(context.request, data, "threads")).length;

  // Priya alone: the two of them already talk, so that conversation opens and nothing is made.
  await page.getByTestId("msgs-new").click();
  let dialog = page.getByRole("dialog", { name: "New conversation" });
  await expect(dialog.getByTestId("msgs-new-note")).toHaveText("Pick one colleague for a conversation between the two of you, or several for a group.");
  await expect(dialog.getByRole("button", { name: "Start the conversation" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Priya", exact: true }).click();
  await expect(dialog.getByTestId("msgs-new-note")).toHaveText("You and Priya already have a conversation: it opens.");
  await dialog.getByRole("button", { name: "Open the conversation" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("msgs-talk").locator(".crm-ms-talk-head")).toContainText("Priya Raman");
  expect((await rows(context.request, data, "threads")).length).toBe(before);

  // Sam and Leo: a group, named, made with its three people in one save.
  await page.getByTestId("msgs-new").click();
  dialog = page.getByRole("dialog", { name: "New conversation" });
  await dialog.getByRole("button", { name: "Sam", exact: true }).click();
  await expect(dialog.getByTestId("msgs-new-note")).toHaveText("Just you and Sam. Nobody else can join a two-person conversation: start a new one for that.");
  await dialog.getByRole("button", { name: "Leo", exact: true }).click();
  await expect(dialog.getByTestId("msgs-new-note")).toHaveText("A group conversation. Anybody in it can bring a colleague in later, who then reads it from its start.");
  await dialog.getByLabel("Name the group").fill("Spec: the Leeds show");
  await dialog.getByRole("button", { name: "Start the conversation" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("The group conversation is started.");
  await expect(dialog).toHaveCount(0);
  const talk = page.getByTestId("msgs-talk");
  await expect(talk.locator(".crm-ms-talk-head")).toContainText("Spec: the Leeds show");
  await expect(talk.locator(".crm-ms-talk-head")).toContainText("Dana, Sam, Leo");
  await expect(page.locator(".crm-ms-thread")).toHaveCount(5);
  const made = (await rows<{ id: number; kind: string }>(context.request, data, "threads", { column: "title", op: "eq", value: "Spec: the Leeds show" }))[0]!;
  expect(made.kind).toBe("group");
  expect((await rows(context.request, data, "thread_members", { column: "thread_id", op: "eq", value: made.id })).length).toBe(3);
  await talk.getByLabel("A message to Spec: the Leeds show").fill("Spec: who takes the stand on Friday?");
  await talk.getByRole("button", { name: "Send" }).click();
  await expect(talk.locator(".crm-ms-msg", { hasText: "Spec: who takes the stand on Friday?" })).toHaveCount(1);
  // Leo reads it; Priya, outside it, is answered none of it.
  expect((await rows(await api("leo"), data, "messages", { column: "thread_id", op: "eq", value: made.id })).length).toBe(1);
  expect((await rows(await api("priya"), data, "threads", { column: "id", op: "eq", value: made.id })).length).toBe(0);
  expect(problems).toEqual([]);
});

test("Weekly meeting: the running order ticked off, N of 6 covered; a decision carried over; a rep reads both and presses neither", async ({ as, api, data }) => {
  const context = await as("ivy");
  await room(context.request, data, 80);
  const ivy = context.request;
  const meeting = (await rows<{ id: number }>(ivy, data, "meetings"))[0]!;
  expect((await ivy.post(data("meeting_decisions"), { data: { values: { meeting_id: meeting.id, text: "Spec: agree who covers Priya’s book in August", who_id: await me(ivy) } }, headers: await csrf(ivy) })).status()).toBe(201);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}weekly-meeting`);
  const order = page.getByTestId("mt-order");
  await expect(page.getByTestId("mt-covered")).toHaveText("0 of 6 covered");
  await order.getByRole("checkbox", { name: "Where we are", exact: true }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Where we are is covered.");
  await order.getByRole("checkbox", { name: "Dana", exact: true }).click();
  await expect(page.getByTestId("mt-covered")).toHaveText("2 of 6 covered");
  await expect(order.locator('.crm-mt-slot[data-covered="1"]')).toHaveCount(2);
  expect((await rows<{ covered: unknown }>(ivy, data, "meeting_slots")).filter((slot) => isYes(slot.covered)).length).toBe(2);
  // Taken off again.
  await order.getByRole("checkbox", { name: "Dana", exact: true }).click();
  await expect(page.getByTestId("mt-covered")).toHaveText("1 of 6 covered");

  // The decision still open: carried over to next time.
  const last = page.getByTestId("mt-last");
  const open = last.locator('li[data-state="open"]');
  await expect(open).toHaveCount(1);
  await open.getByRole("button", { name: "Carry over: Spec: agree who covers Priya’s book in August" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Carried over to next time.");
  await expect(last.locator('li[data-state="open"]')).toHaveCount(0);
  const decision = (await rows<{ state: string }>(ivy, data, "meeting_decisions", { column: "text", op: "like", value: "Spec: %" }))[0]!;
  expect(decision.state).toBe("carried");

  // Priya: the ticks to read, none to press, and the server refuses her one.
  const priya = await as("priya");
  const priyaPage = await priya.newPage();
  await priyaPage.goto(`${STAFF}weekly-meeting`);
  await expect(priyaPage.getByTestId("mt-covered")).toHaveText("1 of 6 covered");
  await expect(priyaPage.getByTestId("mt-order").getByRole("checkbox", { disabled: false })).toHaveCount(0);
  const slot = (await rows<{ id: number }>(priya.request, data, "meeting_slots"))[0]!;
  expect((await priya.request.patch(data("meeting_slots", `/${String(slot.id)}`), { data: { values: { covered: true } }, headers: await csrf(priya.request) })).status()).toBe(403);
  expect((await (await api("grace")).get(data("meeting_slots", "?limit=1"))).status()).toBe(200);
  expect(problems).toEqual([]);
});

test("Coaching: each area's why, what good looks like and live number; the manager adds an area and renames it; the rep reads it", async ({ as, data }) => {
  const context = await as("ivy");
  await room(context.request, data, 100);
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}coaching`);
  await expect(page.getByTestId("co-who")).toContainText("Dana Whitlock");
  const areas = page.locator(".crm-co-area");
  await expect(areas).toHaveCount(2);
  await expect(areas.nth(0).locator(".crm-co-why")).toHaveText("Three of her deals slipped a week because nobody came back on time.");
  await expect(areas.nth(0).getByTestId("co-good")).toHaveText("Nothing past due on a Friday afternoon.");
  // Her three follow-ups past due, as the server counts them at 09:35.
  await expect(areas.nth(0).getByTestId("co-live")).toHaveText(/^3\s*past due right now$/);
  await expect(areas.nth(1).getByTestId("co-live")).toContainText("open to won, last twelve months");

  // An area of her own: open deals, the server's six.
  await page.getByTestId("co-new-area").click();
  let dialog = page.getByRole("dialog", { name: "Add an area" });
  await dialog.getByLabel("What to work on").fill("Spec: ask for the order");
  await dialog.getByLabel("Why it matters").fill("Spec: two of her deals stalled at Verbal.");
  await dialog.getByLabel("What good looks like").fill("Spec: a signed order inside a week of the yes.");
  await dialog.getByLabel("Measured by").selectOption({ label: "Open deals" });
  await dialog.getByRole("button", { name: "Add the area" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Spec: ask for the order is on the plan.");
  await expect(areas).toHaveCount(3);
  await expect(areas.nth(2).getByTestId("co-live")).toHaveText(/^6\s*open deals of their own$/);

  // Renamed.
  await areas.nth(2).getByRole("button", { name: "Change Spec: ask for the order" }).click();
  dialog = page.getByRole("dialog", { name: "Change the area" });
  await expect(dialog.getByLabel("What to work on")).toHaveValue("Spec: ask for the order");
  await dialog.getByLabel("What to work on").fill("Spec: ask for the whole order");
  await dialog.getByRole("button", { name: "Save the area" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Saved: Spec: ask for the whole order.");
  await expect(areas.nth(2).locator("h2")).toHaveText("Spec: ask for the whole order");

  // Dana reads the new area and its number, and adds or renames none.
  const dana = await as("dana");
  const danaPage = await dana.newPage();
  await danaPage.goto(`${STAFF}coaching`);
  const hers = danaPage.locator(".crm-co-area");
  await expect(hers).toHaveCount(3);
  await expect(hers.nth(2).locator("h2")).toHaveText("Spec: ask for the whole order");
  await expect(hers.nth(2).getByTestId("co-good")).toHaveText("Spec: a signed order inside a week of the yes.");
  await expect(hers.nth(0).getByTestId("co-live")).toHaveText(/^3\s*past due right now$/);
  await expect(danaPage.getByTestId("co-new-area")).toHaveCount(0);
  await expect(danaPage.getByRole("button", { name: /^Change / })).toHaveCount(0);
  const area = (await rows<{ id: number }>(dana.request, data, "coaching_areas", { column: "title", op: "like", value: "Spec: %" }))[0]!;
  expect((await dana.request.patch(data("coaching_areas", `/${String(area.id)}`), { data: { values: { title: "Spec: mine" } }, headers: await csrf(dana.request) })).status()).toBe(403);
  expect(problems).toEqual([]);
});

test("One-to-one notes: what to cover ticked off and something else raised, kept with the session, its length, and its action under it", async ({ as, data, stand }) => {
  const context = await as("ivy");
  await room(context.request, data, 100);
  const ivy = context.request;
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}one-to-ones`);
  await expect(page.getByTestId("notes-who")).toContainText("Dana Whitlock");
  const cover = page.getByTestId("notes-raise");
  await cover.locator('[data-raise="sitting"]').getByRole("checkbox").click();
  await cover.locator('[data-raise="late"]').getByRole("checkbox").click();
  await expect(cover.locator('[data-on="1"]')).toHaveCount(2);
  await cover.getByLabel("Something else to raise").fill("Spec: the August cover");
  await cover.getByRole("button", { name: "Add", exact: true }).click();
  await expect(cover.locator('[data-raise="raised"]')).toContainText("Spec: the August cover");
  await expect(cover.locator('[data-raise="raised"]')).toContainText("Added by Ivy");

  await page.getByTestId("notes-new").click();
  const form = page.getByRole("form", { name: "New session" });
  await form.getByLabel("What we talked about, one line each").fill("Spec: the August cover is Sam's.");
  await form.getByLabel("How long, in minutes").fill("30");
  await expect(form).toContainText("3 lines ticked or added are kept with it.");
  await form.getByLabel("Action 1", { exact: true }).fill("Spec: brief Sam on Cobalt Legal");
  await form.getByRole("button", { name: "Save the session" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Session saved with 1 action.");
  // The agenda starts again; the session keeps what was covered.
  await expect(cover.locator('[data-on="1"]')).toHaveCount(0);
  await expect(cover.locator('[data-raise="raised"]')).toHaveCount(0);
  const first = page.locator(".crm-no-session").first();
  await expect(first.getByTestId("notes-minutes")).toHaveText("30 minutes");
  await expect(first.getByTestId("notes-covered").locator("li")).toHaveText(["The deal longest in its stage", "Follow-ups past due", "Spec: the August cover"]);
  // An action keeps its session from stage 2 on (T04): stage 1 has no `actions.session_id`, and lists none under it.
  const keepsSession = stand.stage >= 2;
  if (keepsSession) await expect(first.getByTestId("notes-session-actions").locator(".crm-tw-action")).toHaveText(/Spec: brief Sam on Cobalt Legal/);
  else await expect(first.getByTestId("notes-session-actions")).toHaveCount(0);
  const session = (await rows<Record<string, unknown>>(ivy, data, "one_to_one_sessions", { column: "notes", op: "like", value: "Spec: %" }))[0]!;
  expect([isYes(session["cover_sitting"]), isYes(session["cover_biggest"]), isYes(session["cover_target"]), isYes(session["cover_late"]), session["raised"], Number(session["minutes"])]).toEqual([true, false, false, true, "Spec: the August cover", 30]);
  const action = (await rows<{ session_id: number | null }>(ivy, data, "actions", { column: "text", op: "eq", value: "Spec: brief Sam on Cobalt Legal" }))[0]!;
  expect(action.session_id).toBe(keepsSession ? session["id"] : undefined);

  // Dana reads what was covered, and ticks nothing of the agenda.
  const dana = await as("dana");
  const danaPage = await dana.newPage();
  await danaPage.goto(`${STAFF}one-to-ones`);
  await expect(danaPage.locator(".crm-no-session").first().getByTestId("notes-covered").locator("li")).toHaveCount(3);
  await expect(danaPage.getByTestId("notes-raise").getByRole("checkbox")).toHaveCount(0);
  await expect(danaPage.getByLabel("Something else to raise")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("New starter: her patch, the server's count; a starter made with the last one's steps; a rep makes none", async ({ as, data }) => {
  const context = await as("ivy");
  await room(context.request, data, 100);
  const ivy = context.request;
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto(`${STAFF}new-starter`);
  await expect(page.getByTestId("st-patch").locator(".crm-stat-value")).toHaveText("2");
  await expect(page.getByTestId("st-patch")).toContainText("Accounts in Scotland, from Leo");

  await page.getByTestId("st-new").click();
  const dialog = page.getByRole("dialog", { name: "New starter" });
  await dialog.getByLabel("Name", { exact: true }).fill("Spec: Ola Berg");
  await dialog.getByLabel("First day").fill("2026-08-17");
  await dialog.getByLabel("Patch", { exact: true }).selectOption({ label: "North" });
  await expect(dialog.getByRole("checkbox")).toBeChecked();
  await expect(dialog).toContainText("Start with Nia’s 12 steps, none ticked");
  await dialog.getByRole("button", { name: "Add the starter" }).click();
  await expect(page.locator(".crm-toast")).toHaveText("Spec: Ola Berg is on the list, with 12 steps.");
  await expect(page.getByRole("group", { name: "Which starter" }).getByRole("button")).toHaveCount(2);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Spec: Ola Berg");
  await expect(page.getByTestId("st-done")).toHaveText("0 of 12 done");
  const north = (await rows<{ id: number; name: string }>(ivy, data, "territories")).find((place) => place.name === "North")!;
  const companies = (await rows(ivy, data, "companies", { column: "territory_id", op: "eq", value: north.id })).length;
  await expect(page.getByTestId("st-patch").locator(".crm-stat-value")).toHaveText(String(companies));
  await expect(page.getByTestId("st-patch")).toContainText("Accounts in North, from Dana");
  const ola = (await rows<{ id: number; manager_id: string; patch: number }>(ivy, data, "starters", { column: "name", op: "eq", value: "Spec: Ola Berg" }))[0]!;
  expect([ola.manager_id, ola.patch]).toEqual([await me(ivy), north.id]);
  const steps = await rows<{ done: unknown }>(ivy, data, "starter_steps", { column: "starter_id", op: "eq", value: ola.id });
  expect([steps.length, steps.filter((step) => isYes(step.done)).length]).toEqual([12, 0]);

  // Dana reads who starts and her patch, and makes no starter.
  const dana = await as("dana");
  const danaPage = await dana.newPage();
  await danaPage.goto(`${STAFF}new-starter`);
  await expect(danaPage.getByTestId("st-patch")).toContainText("Accounts in Scotland, from Leo");
  await expect(danaPage.getByTestId("st-new")).toHaveCount(0);
  const refused = await dana.request.post(data("starters"), { data: { values: { name: "Spec: no", starts_on: "2026-09-01", manager_id: await me(dana.request) } }, headers: await csrf(dana.request) });
  expect(refused.status()).toBe(403);
  expect(problems).toEqual([]);
});

test("the sales manager sets no target of her own, nor her own first-year target, and marks only the decisions of a meeting she runs (plan 68 X2)", async ({ as, api, data }) => {
  const admin = await api("tessa");
  const adminHeaders = await csrf(admin);
  const context = await as("ivy");
  await room(context.request, data, 80);
  const ivy = context.request;
  const ivyHeaders = await csrf(ivy);
  const ivyId = await me(ivy);
  const page = await context.newPage();
  const problems = watch(page);
  const made = async (ref: string, values: Record<string, unknown>): Promise<number> => {
    const res = await admin.post(data(ref), { data: { values }, headers: adminHeaders });
    expect(res.status(), await res.text()).toBe(201);
    return ((await res.json()) as { data: { id: number } }).data.id;
  };
  const drop = async (ref: string, id: number): Promise<void> => {
    expect((await admin.delete(data(ref, `/${String(id)}?confirm=true`), { headers: adminHeaders })).status()).toBeLessThan(300);
  };

  // HER OWN TARGET, set by the CRM admin: her row is shown with no button, the page says who sets it, the server says no.
  const target = await made("targets", { rep_id: ivyId, year: 2026, amount: 300000 });
  try {
    await page.goto(`${STAFF}targets`);
    const row = page.locator(`.crm-tg-row[data-rep="${ivyId}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: /^Change the target of Ivy/ })).toHaveCount(0);
    await expect(page.locator(".crm-tg-row", { hasText: "Dana Whitlock" }).getByRole("button", { name: /^Change the target of Dana/ })).toBeVisible();
    await expect(page.getByTestId("tg-own")).toHaveText("Your own target is set by the CRM admin.");
    expect((await ivy.patch(data("targets", `/${String(target)}`), { data: { values: { amount: 1 } }, headers: ivyHeaders })).status()).toBe(404);
  } finally {
    await drop("targets", target);
  }

  // HER OWN STARTER ROW: its first-year target is not hers to set, and the page says who does.
  const starter = await made("starters", { name: "Spec: Ivy Sandoval", starts_on: "2026-09-07", manager_id: ivyId, user_id: ivyId });
  try {
    await page.goto(`${STAFF}new-starter`);
    await page.getByRole("group", { name: "Which starter" }).getByRole("button", { name: /Spec: Ivy Sandoval/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Spec: Ivy Sandoval");
    await expect(page.getByTestId("st-target-own")).toHaveText("Your own first-year target is set by the CRM admin.");
    await expect(page.getByRole("button", { name: /half the average target/ })).toHaveCount(0);
    expect((await ivy.patch(data("starters", `/${String(starter)}`), { data: { values: { first_year_target: 1 } }, headers: ivyHeaders })).status()).toBe(404);
  } finally {
    await drop("starters", starter);
  }

  // A MEETING THE CRM ADMIN RUNS, before the sample's: its decisions are hers to mark, not Ivy's.
  const next = (await rows<{ id: number; at: string }>(ivy, data, "meetings", undefined, "&order=at"))[0]!;
  const meeting = await made("meetings", { at: new Date(Date.parse(next.at) - 2 * 3_600_000).toISOString(), minutes: 30 });
  const decision = await made("meeting_decisions", { meeting_id: meeting, text: "Spec: the CRM admin's own decision", who_id: ivyId });
  try {
    expect((await rows<{ run_by_id: string }>(admin, data, "meetings", { column: "id", op: "eq", value: meeting }))[0]!.run_by_id).toBe(await me(admin));
    await page.goto(`${STAFF}weekly-meeting`);
    const last = page.getByTestId("mt-last");
    await expect(last.locator("li", { hasText: "Spec: the CRM admin's own decision" })).toBeVisible();
    await expect(last.getByRole("button", { name: /^Mark done|^Carry over/ })).toHaveCount(0);
    await expect(page.getByTestId("mt-runner")).toHaveText("The decisions are marked by Tessa, who runs this meeting.");
    expect((await ivy.patch(data("meeting_decisions", `/${String(decision)}`), { data: { values: { state: "done" } }, headers: ivyHeaders })).status()).toBe(404);
  } finally {
    await drop("meeting_decisions", decision);
    await drop("meetings", meeting);
  }
  expect(problems).toEqual([]);
});
