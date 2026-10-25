/**
 * Plan 67 gate G2, "The rule editor's new fields", in Adminium's console (Automations) with the CRM installed, as the
 * install's owner, on two rules of this spec's own over the CRM's deals (a table with a staff column, Owner, and a link
 * to a company whose Account owner is one too). The CRM's shipped rules are not touched. Both rules are made paused,
 * so neither runs, and both are deleted at the end (the first from its own menu, as a person would).
 *
 *  1. A rule on a deal changed: "Send to" the person on this record, by its own column (Owner) and by one of a linked
 *     row (Company → Account owner); the Urgent switch; a "Create record" step given a name, whose hint says how a later
 *     step reads it, and `{{steps.<name>.<column>}}` written in the step after it, kept by the server.
 *  2. A rule by the clock: every day at 08:00 for each deal, "once each time it starts to match" (once per record, and
 *     again when it matches anew); a "Send each person a summary" step with a section of the person's own deals. A new
 *     such rule cannot be saved today, so the fields are saved on a copy of the CRM's "A deal has gone quiet".
 *
 * Two engine faults are pinned by tests of their own, expected to fail until the engine is fixed: the New rule dialog
 * names the summary step "Send email", and a new clock rule once per record cannot be saved from the editor.
 */
import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, watch } from "./helpers.ts";
import { words } from "./zw-helpers.ts";

const say = words("en-US");

test.use({ actionTimeout: 20_000 });
const STAMP = String(Date.now()).slice(-6);
const RECORD_RULE = `Spec: a deal changed ${STAMP}`;
const CLOCK_RULE = `Spec: each morning ${STAMP}`;

interface RuleView {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { kind: string; schedule?: { kind: string; time?: string }; forEach?: { table: string; once?: boolean | "per-spell" } };
  graph: { nodes: { id: string; kind: string; title?: string; action?: Record<string, unknown> }[] };
}

async function rulesNamed(owner: APIRequestContext, prefix: string): Promise<RuleView[]> {
  return ((await (await owner.get("/api/v1/automations")).json()) as { rules: RuleView[] }).rules.filter((rule) => rule.name.startsWith(prefix));
}

async function ruleById(owner: APIRequestContext, id: string): Promise<RuleView> {
  const res = await owner.get(`/api/v1/automations/${id}`);
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as RuleView | { rule: RuleView } | { data: RuleView };
  return "rule" in body ? body.rule : "data" in body ? body.data : body;
}

/** Make a paused rule in the New rule dialog, and land in its flow on the step that is not finished. */
/** The step inspector: the drawer with a step's name in it (the drawer does not carry its `step-inspector` test id). */
const stepInspector = (page: Page) => page.getByRole("dialog").filter({ has: page.getByTestId("insp-title") });

/** Close the step inspector (it covers the flow), as a person does before pressing another step. */
async function closeInspector(page: Page): Promise<void> {
  await stepInspector(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(stepInspector(page)).toBeHidden();
}

/** A "Send each person a summary" step's first section: the person's own deals. */
async function addSection(inspector: Locator): Promise<void> {
  await expect(inspector.getByTestId("digest-add")).toBeVisible();
  await inspector.getByTestId("digest-add").click();
  await inspector.getByTestId("digest-key-0").fill("open-deals");
  const dealsOption = (await inspector.getByTestId("digest-table-0").locator("option").allInnerTexts()).find((label) => TABLE.deals.test(label.trim()))!;
  await inspector.getByTestId("digest-table-0").selectOption({ label: dealsOption });
  await inspector.getByTestId("digest-owner-0").selectOption({ label: "Owner" });
  await expect(inspector.getByTestId("digest-section-0")).toBeVisible();
}

/** Press Save and answer what the server said. */
async function trySave(page: Page): Promise<{ status: number; body: string }> {
  if (await stepInspector(page).isVisible()) await closeInspector(page);
  const saved = page.waitForResponse((res) => /\/api\/v1\/automations\/[^/]+$/.test(new URL(res.url()).pathname) && res.request().method() === "PATCH");
  await page.getByTestId("rule-save").click();
  const reply = await saved;
  return { status: reply.status(), body: await reply.text() };
}

/** A table as the rule editor's pickers name it (the app's label: "Deal" or "Deals"). */
const TABLE = { deals: /^Deals?$/, followUps: /^Follow-ups?$/ } as const;

async function newRule(page: Page, name: string, trigger: string, table: RegExp | null, action: string): Promise<string> {
  await page.getByTestId("new-rule").click();
  const modal = page.getByTestId("new-rule-modal");
  await modal.getByTestId("new-rule-name").fill(name);
  await modal.getByTestId("new-rule-trigger").selectOption(trigger);
  if (table !== null) {
    await modal.getByTestId("new-rule-table").getByRole("combobox").fill(table.source.slice(1, 5));
    await page.getByRole("option", { name: table }).first().click();
  }
  await modal.getByTestId("new-rule-action").selectOption(action);
  const enable = modal.getByTestId("new-rule-enable");
  if ((await enable.getAttribute("aria-checked")) === "true") await enable.click();
  await expect(enable).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("new-rule-create").click();
  await expect(page).toHaveURL(/[?&]rule=/);
  // The step inspector opens at once, over the dialog's "Rule saved" panel (whose Done it hides under its scrim): a person
  // closes the inspector, presses Done, and opens the step again.
  await expect(stepInspector(page)).toBeVisible();
  await stepInspector(page).getByRole("button", { name: "Close", exact: true }).click();
  await page.getByTestId("new-rule-done-button").click();
  await expect(page.getByTestId("new-rule-done")).toBeHidden();
  return new URL(page.url()).searchParams.get("rule")!;
}

async function save(page: Page): Promise<void> {
  if (await stepInspector(page).isVisible()) await closeInspector(page);
  const saved = page.waitForResponse((res) => /\/api\/v1\/automations\/[^/]+$/.test(new URL(res.url()).pathname) && res.request().method() === "PATCH");
  await page.getByTestId("rule-save").click();
  const reply = await saved;
  expect(reply.status(), `the rule is saved: ${await reply.text()}`).toBe(200);
  await expect(page.getByTestId("rule-save-chip")).toHaveText("All changes saved");
}

test("the rule editor's new fields, on two paused rules of the spec's own over deals", async ({ as, api }) => {
  test.setTimeout(240_000);
  const owner = await api("owner");
  const page = await (await as("owner")).newPage();
  const problems = watch(page);
  let copyId = "";
  try {
    await page.goto("/automations");
    await expect(page.getByTestId("new-rule")).toBeVisible();

    // 1. A rule on a deal changed, telling somebody.
    const recordId = await newRule(page, RECORD_RULE, "updated", TABLE.deals, "notification");
    const inspector = stepInspector(page);
    await page.getByTestId("flow-node-n2").click();
    await expect(inspector).toBeVisible();
    await inspector.getByTestId("notif-mode").selectOption("column");
    const who = inspector.getByTestId("notif-column");
    // Its own staff column, and the staff column of the row its company link leads to.
    const offered = await who.locator("option").allInnerTexts();
    expect(offered).toEqual(expect.arrayContaining(["Owner", "Company → Account owner"]));
    await who.selectOption({ label: "Owner" });
    await expect(who).toHaveValue("owner_id");
    await who.selectOption({ label: "Company → Account owner" });
    await expect(who).toHaveValue("company_id.account_owner_id");
    await inspector.getByTestId("notif-title").fill("Spec: {{record.name}} changed");
    await inspector.getByTestId("notif-body").fill("Its company's account owner is told.");
    await expect(inspector.getByTestId("notif-urgent")).toHaveAttribute("aria-checked", "false");
    await inspector.getByTestId("notif-urgent").click();
    await expect(inspector.getByTestId("notif-urgent")).toHaveAttribute("aria-checked", "true");
    await expect(inspector).toContainText(say("automations:notif.urgentBody"));

    // A "Create record" step with a name, before the notice: its hint says how a later step reads it.
    await closeInspector(page);
    await page.getByRole("button", { name: "Insert step here" }).last().click();
    await page.getByTestId("step-picker").getByTestId("step-pick-create").click();
    await expect(inspector.getByTestId("rec-name")).toBeVisible();
    await inspector.getByRole("combobox", { name: "Table" }).fill("Foll");
    await page.getByRole("option", { name: TABLE.followUps }).first().click();
    await inspector.getByTestId("rec-name").fill("made");
    await expect(inspector.getByTestId("rec-name-hint")).toHaveText(say("automations:rec.nameHint", { token: "{{steps.made.column}}" }));
    // …and the step after it reads the row it made.
    await closeInspector(page);
    await page.locator('[data-testid^="flow-node-"]').filter({ hasText: "Send notification" }).last().click();
    await inspector.getByTestId("notif-body").fill("A follow-up was made for it, due {{steps.made.due_at}}.");
    await picture(page, "zw-rule-editor-record");
    await save(page);
    const record = await ruleById(owner, recordId);
    expect(record.enabled).toBe(false);
    const tell = record.graph.nodes.find((node) => node.action?.["kind"] === "notification")!;
    const create = record.graph.nodes.find((node) => node.action?.["name"] === "made");
    expect(create, JSON.stringify(record.graph.nodes.map((node) => node.action ?? node.kind))).toBeDefined();
    expect(String(create!.action?.["kind"])).toMatch(/create/i);
    expect(tell.action).toMatchObject({ urgent: true, body: "A follow-up was made for it, due {{steps.made.due_at}}." });
    expect(JSON.stringify(tell.action?.["to"])).toContain("company_id.account_owner_id");
    expect(record.graph.nodes.indexOf(create!)).toBeLessThan(record.graph.nodes.indexOf(tell));

    // 2. A rule by the clock, once each time a deal starts to match, with a summary for each person.
    const clockId = await newRule(page, CLOCK_RULE, "schedule", null, "digest");
    await page.getByTestId("flow-node-n1").click();
    await expect(inspector).toBeVisible();
    await inspector.getByTestId("trig-schedule-kind").selectOption("daily");
    await inspector.getByTestId("trig-time").fill("08:00");
    await inspector.getByRole("combobox", { name: "For each record of" }).fill("Deal");
    await page.getByRole("option", { name: TABLE.deals }).first().click();
    await expect(inspector.getByTestId("trig-once")).toHaveAttribute("aria-checked", "true");
    await inspector.getByTestId("trig-per-spell").click();
    await expect(inspector.getByTestId("trig-per-spell")).toHaveAttribute("aria-checked", "true");
    await expect(inspector).toContainText("A record that stops matching and matches again later is run again");
    await closeInspector(page);
    await page.getByTestId("flow-node-n2").click();
    await addSection(inspector);
    await picture(page, "zw-rule-editor-clock");
    // Not saved: a new rule by the clock, once per record, is refused by the server for want of a condition the editor has no
    // place for (the fault test below). The draft is taken away, and the same fields are walked on a rule that has conditions.
    await owner.delete(`/api/v1/automations/${clockId}`, { headers: await csrf(owner) });

    // The same fields on a clock rule that has its conditions: a copy of the CRM's "A deal has gone quiet" (the shipped
    // rule itself is not changed), switched to once ever and back to once each time it starts to match, with a summary.
    const shipped = ((await (await owner.get("/api/v1/automations")).json()) as { rules: (RuleView & { managed?: { key: string; templateKey: string } | null })[] }).rules.find((rule) => rule.managed?.key === "crm" && rule.managed.templateKey === "nudge-quiet")!;
    await page.goto(`/automations?app=crm&rule=${shipped.id}`);
    await expect(page.locator('[data-part="rule-shipped-note"]')).toBeVisible();
    const duplicated = page.waitForResponse((res) => res.url().endsWith(`/api/v1/automations/${shipped.id}/duplicate`));
    await page.getByTestId("rule-copy").click();
    const made = (await (await duplicated).json()) as Partial<RuleView> & { rule?: RuleView; data?: RuleView; managed?: unknown };
    copyId = made.id ?? made.rule?.id ?? made.data?.id ?? "";
    expect(copyId, JSON.stringify(made).slice(0, 300)).not.toBe("");
    await expect(page).toHaveURL(new RegExp(`rule=${copyId}`));
    // The copy is the person's own (no app's), listed with every rule rather than the app's: opened there, no "came with" note.
    expect((made.managed ?? null) === null || (await ruleById(owner, copyId)).name.includes("copy"), JSON.stringify(made).slice(0, 300)).toBe(true);
    await page.goto(`/automations?rule=${copyId}`);
    await expect(page.getByTestId(`rule-card-${copyId}`)).toHaveAttribute("aria-current", /true|page/);
    await expect(page.locator('[data-part="rule-shipped-note"]')).toHaveCount(0);
    await page.locator('[data-testid^="flow-node-"][aria-label^="A deal has gone quiet"]').click();
    await expect(inspector.getByTestId("trig-once")).toHaveAttribute("aria-checked", "true");
    await expect(inspector.getByTestId("trig-per-spell")).toHaveAttribute("aria-checked", "true");
    await inspector.getByTestId("trig-per-spell").click();
    await save(page);
    expect((await ruleById(owner, copyId)).trigger.forEach?.once).toBe(true);
    await page.locator('[data-testid^="flow-node-"][aria-label^="A deal has gone quiet"]').click();
    await inspector.getByTestId("trig-per-spell").click();
    await expect(inspector.getByTestId("trig-per-spell")).toHaveAttribute("aria-checked", "true");
    await closeInspector(page);
    await page.getByTestId("flow-add-end").click();
    await page.getByTestId("step-picker").getByTestId("step-pick-digest").click();
    await addSection(inspector);
    await save(page);
    const copy = await ruleById(owner, copyId);
    expect(copy.enabled).toBe(false);
    expect(copy.trigger).toMatchObject({ kind: "schedule", forEach: { once: "per-spell" } });
    const digest = copy.graph.nodes.find((node) => node.action?.["kind"] === "digest")!;
    expect(JSON.stringify(digest.action)).toContain("open-deals");
    expect(JSON.stringify(digest.action)).toContain("owner_id");
    expect((await ruleById(owner, shipped.id)).trigger.forEach?.once, "the shipped rule is as it was").toBe("per-spell");

    // The first rule deleted from its own menu, its name typed first.
    await page.getByTestId(`rule-card-${recordId}`).click();
    await page.getByTestId("rule-menu").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm).toContainText("Its run history goes with it. This cannot be undone.");
    await confirm.getByRole("textbox").fill(RECORD_RULE);
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByTestId(`rule-card-${recordId}`)).toHaveCount(0);
    expect(problems).toEqual([]);
  } finally {
    const headers = await csrf(owner);
    if (copyId !== "") await owner.delete(`/api/v1/automations/${copyId}`, { headers });
    for (const rule of await rulesNamed(owner, "Spec: ")) {
      // This run's, and any an earlier run left (each run's names carry its own stamp).
      if (rule.name.startsWith("Spec: a deal changed ") || rule.name.startsWith("Spec: each morning ")) await owner.delete(`/api/v1/automations/${rule.id}`, { headers });
    }
  }
  expect(await rulesNamed(owner, `Spec: a deal changed ${STAMP}`)).toEqual([]);
  expect(await rulesNamed(owner, `Spec: each morning ${STAMP}`)).toEqual([]);
});

// Engine fault: the New rule dialog has no label for the summary step, so it offers it as "Send email" (apps/dashboard/src/automations/rules/NewRuleModal.tsx:90-97).
test("the New rule dialog offers the summary step by its name", async ({ as }) => {
  test.fail();
  const page = await (await as("owner")).newPage();
  await page.goto("/automations");
  await page.getByTestId("new-rule").click();
  const offered = await page.getByTestId("new-rule-modal").getByTestId("new-rule-action").locator("option").evaluateAll((options) => options.map((option) => [(option as HTMLOptionElement).value, option.textContent?.trim() ?? ""]));
  expect(Object.fromEntries(offered)["digest"]).toBe("Send each person a summary");
});

// Engine fault: a scan once per record needs a condition (apps/server/src/automations/validate.ts:641) and the trigger inspector has none to write (apps/dashboard/src/automations/flow/inspector/TriggerSettings.tsx:375).
test("a new rule by the clock, once each time a deal starts to match, saves from the editor", async ({ as, api }) => {
  test.fail();
  test.setTimeout(120_000);
  const owner = await api("owner");
  const page = await (await as("owner")).newPage();
  let clockId = "";
  try {
    await page.goto("/automations");
    clockId = await newRule(page, `Spec: each morning ${STAMP} b`, "schedule", null, "digest");
    const inspector = stepInspector(page);
    await page.getByTestId("flow-node-n1").click();
    await inspector.getByTestId("trig-schedule-kind").selectOption("daily");
    await inspector.getByTestId("trig-time").fill("08:00");
    await inspector.getByRole("combobox", { name: "For each record of" }).fill("Deal");
    await page.getByRole("option", { name: TABLE.deals }).first().click();
    await inspector.getByTestId("trig-per-spell").click();
    await closeInspector(page);
    await page.getByTestId("flow-node-n2").click();
    await addSection(inspector);
    const saved = await trySave(page);
    expect(saved.status, saved.body).toBe(200);
    expect((await ruleById(owner, clockId)).trigger).toMatchObject({ kind: "schedule", schedule: { kind: "daily", time: "08:00" }, forEach: { once: "per-spell" } });
  } finally {
    if (clockId !== "") await owner.delete(`/api/v1/automations/${clockId}`, { headers: await csrf(owner) });
  }
});
