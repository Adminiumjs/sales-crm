/**
 * What the app ships beside its tables: the rules that run by themselves, the
 * e-mails, and the outbox that sends them.
 *
 * Read against the manifest. That a rule runs and a mail is queued is proved
 * against an install, on three engines, in the engine's repo.
 */

import { describe, expect, it } from "vitest";

import manifest from "../../whole/manifest.json";

const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];
type Text = string | Record<string, string>;
interface Rule {
  key: string;
  name: Text;
  description?: Text;
  enabled: boolean;
  module?: string;
  trigger: { kind: string; event?: string; table?: string; changedColumn?: string; when?: unknown[]; schedule?: Record<string, unknown>; forEach?: { table: string; once: boolean | string; where: { left: { field: string }; op: string; right?: unknown }[] } };
  graph: {
    nodes: {
      id: string;
      kind: string;
      action?: Action;
      condition?: unknown;
      branches?: { id: string; nodes: { id: string; kind: string; action?: Action; condition?: unknown }[] }[];
    }[];
  };
}
interface Section {
  key: string;
  table: string;
  owner: string;
  reach?: string;
  sum?: string[];
  by?: string;
  target?: Record<string, string>;
  where?: unknown[];
}
interface Action {
  kind: string;
  table?: string;
  values?: Record<string, string>;
  to?: { roles?: string[]; column?: string };
  title?: Text;
  body?: Text;
  templateKey?: string;
  sections?: Section[];
}
interface Template {
  key: string;
  locales: Record<string, { subject: string; footer?: string; blocks: { block: string; showWhen?: { var: string }; data: { text: string; section?: string; empty?: string; label?: string; url?: string; lines?: { label: string; amount: string }[] } }[] }>;
}
const m = manifest as unknown as {
  automations: Rule[];
  emailTemplates: Template[];
  outbox: { kinds: Record<string, string>; links: Record<string, string>; columns: Record<string, string>; producers: Record<string, unknown>[] };
  frontends: { side: string; records?: Record<string, string> }[];
  roles: { key: string }[];
  requiredSchema: { tables: { ref: string; columns: { ref: string; type: string; nullable?: boolean; rules?: { personal?: boolean; copy?: unknown; staff?: boolean; mentions?: unknown } }[] }[] };
};
const rule = (key: string): Rule => m.automations.find((one) => one.key === key)!;
const steps = (key: string) => rule(key).graph.nodes.filter((node) => node.kind === "action").map((node) => node.action!);
/** Every step of a rule, a fork's own steps where the fork sits. */
const walked = (key: string) => rule(key).graph.nodes.flatMap((node) => [node, ...(node.branches ?? []).flatMap((branch) => branch.nodes)]);
const inAll = (text: Text | undefined): boolean => typeof text === "object" && LOCALES.every((locale) => (text[locale] ?? "").trim() !== "");
const names = (text: string): string[] => [...text.matchAll(/\{\{([^}|]+)/g)].map((found) => found[1]!.trim()).sort();

describe("the rules the app ships", () => {
  // What the app cannot work without is switched on as it is installed; what tells people is the owner's to switch on.
  const WORKS = ["deal-made", "deal-stage-changed", "deal-stage-was", "deal-won-job", "quote-sent-amount", "approval-asked"];
  const TELLS = ["nudge-quiet", "nudge-stuck", "nudge-soon", "follow-up-due", "quote-runs-out", "deal-handed-over", "approval-given", "approval-refused", "week-rep", "week-manager"];
  // Jobs on site tells a crew at once that today's or tomorrow's sheet changed (e-mail 10). It arrives with its part, which an
  // update brings switched off; the rule is on, so the day the owner switches the part on the crew is told.
  const CREW = ["day-sheet-changed", "day-sheet-crew", "day-sheet-moved"];
  // After the job books the aftercare call a signed-off job is owed (rule 16): on, as its part brings it.
  const AFTER = ["aftercare-call"];
  // A sign-off refused on arrival tells the operations manager (plan 68 S19): on, as its part brings it.
  const OFFICE = ["sign-off-refused"];
  // A customer's yes on a lost deal tells its owner (plan 68 R1a): it tells people, and ships on (D2).
  const YES = ["quote-yes-on-lost"];

  it("are twenty-two: six the app works by, a late yes, three that tell a crew, one that tells the office of a refused sign-off and one that books aftercare, switched on, and ten that tell people, switched off; each named and described in eight languages", () => {
    expect(m.automations.map((one) => one.key)).toEqual([...WORKS, ...YES, ...TELLS, ...CREW, ...OFFICE, ...AFTER]);
    for (const one of m.automations) {
      expect(one.enabled, one.key).toBe(WORKS.includes(one.key) || YES.includes(one.key) || CREW.includes(one.key) || OFFICE.includes(one.key) || AFTER.includes(one.key));
      expect(inAll(one.name), `${one.key} name`).toBe(true);
      expect(inAll(one.description), `${one.key} description`).toBe(true);
    }
  });

  // A rule reads the deal as it is when the rule RUNS, a minute after the write. So the deal keeps, written by the server
  // at the move itself, the move just made and the one before it, and the rules copy both into the history, each once.
  const column = (table: string, ref: string) => m.requiredSchema.tables.find((one) => one.ref === table)!.columns.find((one) => one.ref === ref)!;
  const line = (from: string, to: string, by: string, when: string, key: string) => ({
    kind: "record.create",
    table: "deal_stage_changes",
    values: { deal_id: "{{record.id}}", from_stage_id: `{{record.${from}}}`, to_stage_id: `{{record.${to}}}`, by_id: `{{record.${by}}}`, at: `{{record.${when}}}`, move_key: `{{record.${key}}}` },
  });
  const notYet = (key: string) => ({ left: { count: { table: "deal_stage_changes", matchColumn: "move_key", equalsField: key } }, op: "is", right: 0 });
  const historyOf = (key: string) => walked(key).filter((node) => node.id !== "t" && node.id !== "mark").map((node) => [node.id, node.kind, node.action ?? node.condition]);

  it("a customer's yes on a lost deal tells the deal's owner, in the bell, and nobody else (R1a)", () => {
    expect(rule("quote-yes-on-lost").trigger).toEqual({
      kind: "record",
      event: "updated",
      table: "quotes",
      changedColumn: "status",
      // The deal is read when the rule runs, by a count: no copy of its state is needed for the rule.
      when: [{ left: { field: "status" }, op: "is", right: "accepted" }, { left: { count: { table: "deals", matchColumn: "id", equalsField: "deal_id", where: { left: { field: "state" }, op: "is", right: "lost" } } }, op: "gt", right: 0 }],
    });
    const tell = steps("quote-yes-on-lost") as unknown as { kind: string; to: unknown; title: Record<string, string>; body: Record<string, string> }[];
    expect(tell.map((one) => [one.kind, one.to])).toEqual([["notification", { column: "deal_id.owner_id" }]]);
    expect(inAll(tell[0]!.title) && inAll(tell[0]!.body)).toBe(true);
  });

  it("a deal made gets its mark and the first line of its history", () => {
    expect(rule("deal-made").trigger).toEqual({ kind: "record", event: "created", table: "deals" });
    expect(steps("deal-made")).toEqual([
      { kind: "record.create", table: "deal_marks", values: { deal_id: "{{record.id}}" } },
      // From no stage, into the stage it started in, by who made it, at that moment: read from what the deal keeps of its
      // making for good, so a deal moved on before this rule runs still opens where it opened.
      { kind: "record.create", table: "deal_stage_changes", values: { deal_id: "{{record.id}}", to_stage_id: "{{record.first_stage_id}}", by_id: "{{record.opened_by_id}}", at: "{{record.opened_at}}" } },
    ]);
    expect(column("deals", "first_stage_id").rules).toEqual({ stamp: { set: { copy: "stage_id" }, on: "create" } });
    expect(column("deals", "opened_by_id").rules).toEqual({ stamp: { set: "user-id", on: "create" } });
    expect(column("deals", "opened_at").rules).toEqual({ stamp: { set: "now", on: "create" } });
  });

  it("a deal that changes stage gets a line in its history that names where from, where to, who and when, and only then", () => {
    expect(rule("deal-stage-changed").trigger).toEqual({ kind: "record", event: "updated", table: "deals", changedColumn: "stage_id" });
    expect(historyOf("deal-stage-changed")).toEqual([
      // The move the deal holds now, unless a run before this one wrote it…
      ["this-move", "branch", notYet("move_key")],
      ["line", "action", line("stage_from_id", "stage_id", "stage_by_id", "entered_stage_at", "move_key")],
      // …and the move before it, when the deal was moved again before the rule for that one ran.
      ["had-earlier", "condition", { left: { field: "prev_move_key" }, op: "not_empty" }],
      // (the deal's making is a move from no stage, and has its own line)
      ["earlier-was-a-move", "condition", { left: { field: "prev_from_stage_id" }, op: "not_empty" }],
      ["earlier-missing", "condition", notYet("prev_move_key")],
      ["earlier-line", "action", line("prev_from_stage_id", "stage_from_id", "prev_by_id", "prev_at", "prev_move_key")],
    ]);
    // A second rule on the same change (decision 131): each move's run reads the deal AS IT WAS just before that move,
    // which holds the move before it, and writes it unless a run wrote it already. However many moves come before the
    // rules run, each run writes the one its own "before" holds, and none is lost. (A rule's condition reads the row only,
    // so what the deal was is first kept on the deal, where the conditions can read it.)
    expect(rule("deal-stage-was").trigger).toEqual(rule("deal-stage-changed").trigger);
    expect(rule("deal-stage-was").enabled).toBe(true);
    const was = (from: string, to: string, by: string, when: string, key: string) => ({
      kind: "record.create",
      table: "deal_stage_changes",
      values: { deal_id: "{{record.id}}", from_stage_id: `{{was.${from}}}`, to_stage_id: `{{was.${to}}}`, by_id: `{{was.${by}}}`, at: `{{was.${when}}}`, move_key: `{{was.${key}}}` },
    });
    expect(historyOf("deal-stage-was")).toEqual([
      ["keep-was", "action", { kind: "record.update", values: { was_move_key: "{{was.move_key}}", was_from_stage: "{{was.stage_from_id}}" } }],
      ["was-a-move", "condition", { left: { field: "was_from_stage" }, op: "not_empty" }],
      ["was-keyed", "condition", { left: { field: "was_move_key" }, op: "not_empty" }],
      ["was-missing", "condition", notYet("was_move_key")],
      ["was-line", "action", was("stage_from_id", "stage_id", "stage_by_id", "entered_stage_at", "move_key")],
    ]);
    // Who set the stage is kept on the deal as a person writes it, and handed on: a line a rule writes has no writer of its own.
    expect(column("deals", "stage_by_id").rules).toEqual({ staff: true, stamp: { set: "user-id", on: { columns: ["stage_id"] } } });
    expect(column("deal_stage_changes", "by_id").rules).toEqual({ staff: true });
    // A line's moment is the move's, written by the rule; no stamp of the minute the rule ran.
    expect(column("deal_stage_changes", "at")).toMatchObject({ type: "timestamptz", default: "now" });
    expect(column("deal_stage_changes", "at").rules).toBeUndefined();
    // No move is written twice.
    expect(column("deal_stage_changes", "move_key")).toMatchObject({ type: "text", nullable: true, unique: true });
  });

  it("keeps on the deal, at the move, the stage it left, and the move before it", () => {
    const deals = m.requiredSchema.tables.find((one) => one.ref === "deals")!.columns;
    const on = { columns: ["stage_id"] };
    const kept = Object.fromEntries(deals.filter((one) => (one.rules as { stamp?: { on?: unknown } } | undefined)?.stamp !== undefined && JSON.stringify((one.rules as { stamp: { on: unknown } }).stamp.on) === JSON.stringify(on)).map((one) => [one.ref, (one.rules as { stamp: { set: unknown } }).stamp.set]));
    expect(kept).toEqual({
      prev_from_stage_id: { copy: "stage_from_id" },
      prev_by_id: { copy: "stage_by_id" },
      prev_at: { copy: "entered_stage_at" },
      prev_move_key: { copy: "move_key" },
      stage_from_id: { copy: "stage_kept_id" },
      stage_kept_id: { copy: "stage_id" },
      entered_stage_at: "now",
      stage_by_id: "user-id",
      move_key: { hashOf: { columns: ["id", "stage_from_id", "stage_id", "entered_stage_at", "stage_by_id", "prev_move_key"] } },
    });
    // The order is the mechanism: a stamp reads the row as the stamps BEFORE it left it, so each copy sits before its source.
    const at = (ref: string) => deals.findIndex((one) => one.ref === ref);
    for (const [copy, source] of [["prev_from_stage_id", "stage_from_id"], ["prev_by_id", "stage_by_id"], ["prev_at", "entered_stage_at"], ["stage_from_id", "stage_kept_id"]] as const) expect(at(copy), `${copy} before ${source}`).toBeLessThan(at(source));
    // Nobody types any of them, the CRM admin included (plan 68 X6): every role that changes a deal says what it writes.
    const roles = (manifest as unknown as { roles: { key: string; permissions: string[]; limits?: Record<string, { writable?: string[] }> }[] }).roles;
    for (const role of roles.filter((one) => one.permissions.includes("table:@deals:update"))) expect(role.limits?.["deals"]?.writable, role.key).toBeDefined();
    for (const role of roles.filter((one) => one.limits?.["deals"]?.writable !== undefined)) for (const ref of [...Object.keys(kept), "first_stage_id", "opened_by_id", "opened_at", "was_move_key", "was_from_stage"]) expect(role.limits!["deals"]!.writable, `${role.key} ${ref}`).not.toContain(ref);
  });

  it("a deal won gets its job, once", () => {
    expect(rule("deal-won-job").trigger).toEqual({ kind: "record", event: "updated", table: "deals", changedColumn: "state", when: [{ left: { field: "state" }, op: "is", right: "won" }] });
    // Won, reopened and won again: the job is there already, and a deal has one job.
    expect(rule("deal-won-job").graph.nodes.find((node) => node.kind === "condition")?.condition).toEqual({ left: { count: { table: "jobs", matchColumn: "deal_id", equalsField: "id" } }, op: "is", right: 0 });
    expect(steps("deal-won-job")).toEqual([{ kind: "record.create", table: "jobs", values: { deal_id: "{{record.id}}", site_name: "{{record.name}}" } }]);
  });

  it("an approval asked is told to the asker's team lead, else the CRM admin, never the asker, in eight languages", () => {
    expect(rule("approval-asked").trigger).toEqual({ kind: "record", event: "updated", table: "quotes", changedColumn: "approval", when: [{ left: { field: "approval" }, op: "is", right: "asked" }] });
    const [tell] = steps("approval-asked");
    // Ruling of §0 and decision 136: whoever leads a team the asker is in and opens the quote; with nobody, the CRM admin.
    expect(tell).toMatchObject({ kind: "notification", to: { column: "asked_by_id", lead: true, else: { roles: ["admin"] } } });
    expect(staff("quotes", "asked_by_id")).toBe(true);
    expect(m.roles.map((role) => role.key)).toContain("admin");
    expect(inAll(tell!.title) && inAll(tell!.body)).toBe(true);
    // Who asked, by name: the lead is told who, in every language.
    for (const locale of LOCALES) expect((tell!.body as Record<string, string>)[locale], locale).toContain("{{asked_by_id.name}}");
    // The same variables in every language: a translation that dropped the number would still read well.
    for (const text of [tell!.title, tell!.body] as Record<string, string>[]) for (const locale of LOCALES) expect(names(text[locale]!), locale).toEqual(names(text["en-US"]!));
  });

  it("reads only columns of the row a rule runs for, as it is or (on a change) as it was, and the name of a person a staff column of it names", () => {
    const columns = (table: string) => new Set(m.requiredSchema.tables.find((one) => one.ref === table)!.columns.map((column) => column.ref));
    const holdsStaff = (table: string, column: string): boolean => m.requiredSchema.tables.find((one) => one.ref === table)!.columns.find((one) => one.ref === column)?.rules?.staff === true;
    const wrong: string[] = [];
    for (const one of m.automations) {
      const table = one.trigger.table ?? one.trigger.forEach?.table;
      // A rule by the clock with no rows of its own (a weekly summary) has no record to read.
      const own = table === undefined ? new Set<string>() : columns(table);
      const changed = one.trigger.kind === "record" && one.trigger.event === "updated";
      for (const read of names(JSON.stringify(one.graph))) {
        const [scope, column, more] = read.split(".");
        if (scope === "record" && own.has(column!) && more === undefined) continue;
        // `{{was.<column>}}`: only a rule run by a change has the row as it was.
        if (scope === "was" && changed && own.has(column!) && more === undefined) continue;
        // `{{<staff column>.name}}`: the person's name, never a link.
        if (table !== undefined && column === "name" && more === undefined && holdsStaff(table, scope!)) continue;
        wrong.push(`${one.key}: {{${read}}}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  const staff = (table: string, column: string): boolean => m.requiredSchema.tables.find((one) => one.ref === table)!.columns.find((one) => one.ref === column)?.rules?.staff === true;

  it("three nudges tell a deal's owner, once each time the deal starts to match", () => {
    for (const key of ["nudge-quiet", "nudge-stuck", "nudge-soon"]) {
      const { trigger } = rule(key);
      expect(trigger.schedule, key).toEqual({ kind: "daily", time: "08:00" });
      expect(trigger.forEach, key).toMatchObject({ table: "deals", once: "per-spell" });
      // Only an open deal is nudged.
      expect(trigger.forEach!.where[0], key).toEqual({ left: { field: "state" }, op: "is", right: "open" });
      expect(steps(key), key).toMatchObject([{ kind: "notification", to: { column: "owner_id" } }]);
    }
    // The days are the business's (decision 136): read from the settings row at each morning's run, the number written
    // here only while the setting holds none. The same three settings the Nudges screen and Settings show.
    const setting = (column: string) => ({ table: "settings", column });
    expect(rule("nudge-quiet").trigger.forEach!.where[1]).toEqual({ left: { field: "last_activity_at" }, op: "more_than_ago", right: { amount: 7, unit: "days", setting: setting("nudge_quiet_days") } });
    expect(rule("nudge-stuck").trigger.forEach!.where[1]).toEqual({ left: { field: "entered_stage_at" }, op: "more_than_ago", right: { amount: 21, unit: "days", setting: setting("nudge_stuck_days") } });
    // Closing within the days set, and not yet at the last stage (whose odds are 0.9).
    expect(rule("nudge-soon").trigger.forEach!.where.slice(1)).toEqual([
      { left: { field: "expected_close" }, op: "within_next", right: { amount: 7, unit: "days", setting: setting("nudge_soon_days") } },
      { left: { field: "stage_odds" }, op: "lt", right: 0.9 },
    ]);
    expect(staff("deals", "owner_id")).toBe(true);
    // A fresh install's settings say what the rules fall back to, so nothing changes until somebody moves a number.
    const settingsDefault = (ref: string): unknown => (m.requiredSchema.tables.find((one) => one.ref === "settings")!.columns.find((one) => one.ref === ref) as { default?: unknown } | undefined)?.default;
    for (const [key, ref, days] of [["nudge-quiet", "nudge_quiet_days", 7], ["nudge-stuck", "nudge_stuck_days", 21], ["nudge-soon", "nudge_soon_days", 7]] as const) expect([settingsDefault(ref), key]).toEqual([days, key]);
    // No notice states a number of days the business may have changed.
    for (const key of ["nudge-quiet", "nudge-stuck"]) for (const locale of LOCALES) expect((steps(key)[0]!.body as Record<string, string>)[locale], `${key} ${locale}`).not.toMatch(/\d/);
  });

  it("tells one person, never a whole role, of what is theirs", () => {
    const to = (key: string) => steps(key)[0]!.to;
    expect(to("follow-up-due")).toEqual({ column: "owner_id" });
    expect(rule("follow-up-due").trigger.forEach).toMatchObject({ table: "follow_ups", once: "per-spell" });
    // A quote has no owner of its own: its deal's owner is told.
    expect(to("quote-runs-out")).toEqual({ column: "deal_id.owner_id" });
    expect(rule("quote-runs-out").trigger.forEach).toMatchObject({ table: "quotes", once: "per-spell" });
    expect(to("deal-handed-over")).toEqual({ column: "owner_id" });
    expect(rule("deal-handed-over").trigger).toEqual({ kind: "record", event: "updated", table: "deals", changedColumn: "owner_id" });
    for (const [key, decided] of [["approval-given", "approved"], ["approval-refused", "refused"]] as const) {
      expect(to(key), key).toEqual({ column: "asked_by_id" });
      expect(rule(key).trigger.when, key).toEqual([{ left: { field: "approval" }, op: "is", right: decided }]);
    }
    for (const [table, column] of [["follow_ups", "owner_id"], ["quotes", "asked_by_id"]] as const) expect(staff(table, column), `${table}.${column}`).toBe(true);
  });

  it("says each notice in eight languages, with the same variables in each", () => {
    for (const key of TELLS.filter((one) => !one.startsWith("week-"))) {
      const [tell] = steps(key);
      expect(inAll(tell!.title), key).toBe(true);
      for (const text of [tell!.title, tell!.body].filter((one) => one !== undefined) as Record<string, string>[]) for (const locale of LOCALES) expect(names(text[locale]!), `${key} ${locale}`).toEqual(names(text["en-US"]!));
    }
  });

  it("writes each rep their own week and each sales manager her team's, on Mondays unless they chose another day", () => {
    for (const [key, roles, template, sections] of [
      ["week-rep", ["rep", "account-manager"], "crm-week-rep", ["open", "cover", "due", "slipped", "sitting", "quiet"]],
      ["week-manager", ["sales-manager"], "crm-week-manager", ["reps", "cover", "closing", "quiet", "sitting", "slipped"]],
    ] as const) {
      expect(rule(key).trigger, key).toEqual({ kind: "schedule", schedule: { kind: "weekly", dayOfWeek: 1, time: "07:00" } });
      const [sum] = steps(key);
      expect(sum, key).toMatchObject({ kind: "digest", templateKey: template, to: { roles } });
      expect(sum!.sections!.map((section) => section.key), key).toEqual(sections);
      // Each section is of rows by the staff column that names their owner.
      for (const section of sum!.sections!) expect(staff(section.table, section.owner), `${key} ${section.key}`).toBe(true);
      // A rep's sections are her own rows; every section of a manager's reaches the people she leads, and no further.
      for (const section of sum!.sections!) expect(section.reach, `${key} ${section.key}`).toBe(key === "week-manager" ? "team" : undefined);
      // The template draws every section, in every language, and says something when a section is empty.
      const drawn = m.emailTemplates.find((one) => one.key === template)!;
      for (const locale of LOCALES) {
        const rows = drawn.locales[locale]!.blocks.filter((block) => block.block === "email.rows");
        expect(rows.map((block) => block.data.section).sort(), `${template} ${locale}`).toEqual([...sections].sort());
        for (const block of rows) expect((block.data.empty ?? "").trim(), `${template} ${locale}`).not.toBe("");
        expect((drawn.locales[locale]!.footer ?? "").trim(), `${template} ${locale}`).not.toBe("");
      }
    }
  });

  it("adds a week's sums up on the server, and measures cover as one figure over one target", () => {
    const section = (key: string, name: string) => steps(key)[0]!.sections!.find((one) => one.key === name)!;
    // The rep: what her open deals add up to, at full value and weighted.
    expect(section("week-rep", "open")).toMatchObject({ table: "deals", owner: "owner_id", sum: ["amount", "weighted_value"], where: [{ left: { field: "state" }, op: "is", right: "open" }] });
    // The manager: a line a person, each with their open deals' sums.
    expect(section("week-manager", "reps")).toMatchObject({ table: "deals", owner: "owner_id", reach: "team", by: "owner", sum: ["amount", "weighted_value"] });
    // Cover: what counts toward the target (a won deal's amount, an open deal's weighted value: one stored column) over the year's target.
    const target = { table: "targets", owner: "rep_id", column: "amount", year: "year", of: "target_value" };
    for (const key of ["week-rep", "week-manager"]) expect(section(key, "cover"), key).toMatchObject({ table: "deals", owner: "owner_id", by: "owner", sum: ["target_value"], target, where: [{ left: { field: "state" }, op: "is_not", right: "lost" }] });
    expect(staff("targets", "rep_id")).toBe(true);
    // A figure a reader cannot be answered is left out, so each target and cover is written with a backup.
    for (const template of ["crm-week-rep", "crm-week-manager"]) {
      for (const locale of LOCALES) {
        const words = JSON.stringify(m.emailTemplates.find((one) => one.key === template)!.locales[locale]);
        const bare = [...words.matchAll(/\{\{((?:row\.)?(?:target|cover)[^}]*)\}\}/g)].map((found) => found[1]!).filter((read) => !read.includes("|"));
        expect(bare, `${template} ${locale}`).toEqual([]);
      }
    }
  });
});

describe("a comment on a deal may mention a colleague", () => {
  it("marks the comment's text, and says the mention is about the deal", () => {
    const text = m.requiredSchema.tables.find((one) => one.ref === "comments")!.columns.find((one) => one.ref === "text")!;
    expect(text.rules?.mentions).toEqual({ about: "deal_id" });
  });
});

describe("the e-mails the app ships", () => {
  const TO_ONE = ["crm-quote-sent", "crm-quote-accepted", "crm-handover-intro", "crm-approval-asked", "crm-visit-confirmed", "crm-visit-moved", "crm-visit-cancelled", "crm-referral-thanks", "crm-showroom-confirmed", "crm-showroom-moved", "crm-showroom-cancelled", "crm-delivery-booked", "crm-delivery-moved", "crm-delivery-cancelled"];
  const shape = (key: string, locale = "en-US") => m.emailTemplates.find((one) => one.key === key)!.locales[locale]!.blocks.map((block) => block.block);

  it("are seventeen: fifteen to one address and two weekly summaries, each in eight languages with a subject and no empty block", () => {
    expect(m.emailTemplates.map((one) => one.key)).toEqual(["crm-quote-sent", "crm-quote-accepted", "crm-handover-intro", "crm-approval-asked", "crm-week-rep", "crm-week-manager", "crm-visit-confirmed", "crm-visit-moved", "crm-visit-cancelled", "crm-referral-thanks", "crm-showroom-confirmed", "crm-showroom-moved", "crm-showroom-cancelled", "crm-delivery-booked", "crm-delivery-moved", "crm-delivery-cancelled", "crm-signed-copy", "crm-certificate-asked"]);
    for (const template of m.emailTemplates) {
      expect(Object.keys(template.locales), template.key).toEqual(LOCALES);
      for (const locale of LOCALES) {
        const content = template.locales[locale]!;
        expect(content.subject.trim(), `${template.key} ${locale}`).not.toBe("");
        // The same blocks in every language: a translation that dropped one would still read well.
        expect(content.blocks.map((block) => block.block), `${template.key} ${locale}`).toEqual(shape(template.key));
        for (const block of content.blocks) {
          if (block.block === "email.button") expect(String(block.data.label).trim(), `${template.key} ${locale}`).not.toBe("");
          if (block.block === "email.text" || block.block === "email.heading") expect(String(block.data.text).trim(), `${template.key} ${locale}`).not.toBe("");
          for (const fact of block.data.lines ?? []) expect(fact.label.trim() !== "" && fact.amount.trim() !== "", `${template.key} ${locale}`).toBe(true);
        }
      }
    }
    expect(TO_ONE.every((key) => m.emailTemplates.some((one) => one.key === key))).toBe(true);
  });

  it("draws each for a mail client: a heading, its words, its facts as rows, and the button the design gives it", () => {
    // The quote: the deal's name, what it comes to, until when, and the button that opens the customer's page.
    expect(shape("crm-quote-sent")).toEqual(["email.heading", "email.text", "email.tax-breakdown", "email.text", "email.button", "email.text"]);
    expect(shape("crm-quote-accepted")).toEqual(["email.heading", "email.text", "email.text"]);
    // A visit: who comes (only when the rep can be named), day, time, where, what for. No button: a mail client drops a calendar file made in the page.
    expect(shape("crm-visit-confirmed")).toEqual(["email.heading", "email.text", "email.text", "email.tax-breakdown"]);
    expect(shape("crm-visit-moved")).toEqual(["email.heading", "email.text", "email.text", "email.tax-breakdown"]);
    expect(shape("crm-visit-cancelled")).toEqual(["email.heading", "email.text", "email.text", "email.tax-breakdown", "email.text"]);
    // The rep is named by the people list's name, never their address; somebody suspended or removed reads empty and the line is left out.
    for (const [key, name] of [["crm-visit-confirmed", "visit.rep_id.name"], ["crm-visit-moved", "visit.rep_id.name"], ["crm-visit-cancelled", "was.rep_id.name"]] as const) {
      for (const locale of LOCALES) {
        const block = m.emailTemplates.find((one) => one.key === key)!.locales[locale]!.blocks[2]!;
        expect((block.data as { onlyWith?: string }).onlyWith, `${key} ${locale}`).toBe(name);
        expect(block.data.text, `${key} ${locale}`).toContain(`{{${name}}}`);
      }
    }
    // A showroom booking (P19): day, time, space, how many; what they come to see and where the showroom is, each only when it is known.
    expect(shape("crm-showroom-confirmed")).toEqual(["email.heading", "email.text", "email.tax-breakdown", "email.text", "email.text"]);
    expect(shape("crm-showroom-moved")).toEqual(["email.heading", "email.text", "email.tax-breakdown", "email.text"]);
    expect(shape("crm-showroom-cancelled")).toEqual(["email.heading", "email.text", "email.tax-breakdown", "email.text"]);
    for (const locale of LOCALES) expect(m.emailTemplates.find((one) => one.key === "crm-showroom-confirmed")!.locales[locale]!.blocks.slice(3).map((block) => block.showWhen), locale).toEqual([{ var: "booking.note" }, { var: "practice.showroom_address" }]);
    // The thank-you: its sentence, and the code only when the referral holds one.
    expect(shape("crm-referral-thanks")).toEqual(["email.heading", "email.text", "email.text", "email.box"]);
    for (const locale of LOCALES) expect(m.emailTemplates.find((one) => one.key === "crm-referral-thanks")!.locales[locale]!.blocks.slice(2).map((block) => block.showWhen), locale).toEqual([{ var: "referral.reward" }, { var: "referral.reward" }]);
    // A delivery: its facts, and the office's phone only when the install keeps one.
    for (const key of ["crm-delivery-booked", "crm-delivery-moved", "crm-delivery-cancelled"]) {
      expect(shape(key)).toEqual(["email.heading", "email.text", "email.tax-breakdown", "email.text"]);
      for (const locale of LOCALES) expect(m.emailTemplates.find((one) => one.key === key)!.locales[locale]!.blocks[3]!.showWhen, `${key} ${locale}`).toEqual({ var: "practice.office_phone" });
    }
    // Each says why the reader got it.
    for (const key of ["crm-quote-sent", "crm-visit-confirmed", "crm-visit-moved", "crm-visit-cancelled", "crm-referral-thanks", "crm-delivery-booked", "crm-delivery-moved", "crm-delivery-cancelled"]) for (const locale of LOCALES) expect((m.emailTemplates.find((one) => one.key === key)!.locales[locale]!.footer ?? "").trim(), `${key} ${locale}`).not.toBe("");
  });

  it("every button carries its record, and no customer's e-mail names a number of ours, a stage or another customer", () => {
    for (const locale of LOCALES) {
      const button = m.emailTemplates.find((one) => one.key === "crm-quote-sent")!.locales[locale]!.blocks.find((block) => block.block === "email.button")!;
      // The customer's page, opened by the quote's own code: the link names this quote and no other.
      expect(button.data.url, locale).toBe("{{manage_url}}#{{quote.share_code}}");
    }
    const customers = ["crm-quote-sent", "crm-visit-confirmed", "crm-visit-moved", "crm-visit-cancelled", "crm-referral-thanks", "crm-delivery-booked", "crm-delivery-moved", "crm-delivery-cancelled"];
    for (const key of customers) {
      const read = names(JSON.stringify(m.emailTemplates.find((one) => one.key === key)!.locales["en-US"]));
      // Never a key of ours, a stage, who owns the deal, or (on the thank-you) the deal or the company that was introduced.
      // (`.number` after a column is how it is written, not a column called "number": a visit's hours, `{{job_visit.hours.number}}`.)
      for (const name of read) expect(name.replace(/^(job_visit\.hours)\.number$/, "$1"), `${key} {{${name}}}`).not.toMatch(/(^|\.)(id|number|stage_id|stage_odds|owner_id|rep_id|target_value|weighted_value)$/);
      if (key === "crm-referral-thanks") for (const name of read) expect(name.startsWith("deal.") || name.startsWith("referral.company") || name === "referral.referred_name", name).toBe(false);
    }
    // A removed visit is read from what the message kept, never from the row that is gone.
    expect(names(JSON.stringify(m.emailTemplates.find((one) => one.key === "crm-visit-cancelled")!.locales["en-US"])).filter((name) => name.startsWith("visit."))).toEqual([]);
    expect(names(JSON.stringify(m.emailTemplates.find((one) => one.key === "crm-delivery-cancelled")!.locales["en-US"])).filter((name) => name.startsWith("job_visit."))).toEqual([]);
  });

  it("opens a record from a notice in the app's own screen: a deal, a quote, a company, a contact, a site visit", () => {
    const staffSide = m.frontends.find((side) => side.side === "staff")!;
    expect(staffSide.records).toEqual({ deals: "/deals/{id}", quotes: "/quotes/{id}", companies: "/companies/{id}", contacts: "/contacts/{id}", site_visits: "/visits/notes/{id}", refused_sign_offs: "/sign-off/refused/{id}" });
    // Every rule that tells people is about one of them, about a follow-up (which has no screen of its own), or about a
    // visit to a job, told to its crew (whose phone screens arrive with the crew's part of stage 2, P22), or about a sign-off
    // refused on arrival, which opens the office's Sign-off at its job (plan 68 S19).
    const told = new Set(m.automations.filter((one) => steps(one.key).some((step) => step.kind === "notification")).map((one) => one.trigger.table ?? one.trigger.forEach?.table));
    expect([...told].sort()).toEqual(["deals", "follow_ups", "job_visits", "quotes", "refused_sign_offs"]);
  });

  it("read the same variables in every language", () => {
    for (const template of m.emailTemplates) {
      const read = (locale: string) => names(JSON.stringify(template.locales[locale]));
      for (const locale of LOCALES) expect(read(locale), `${template.key} ${locale}`).toEqual(read("en-US"));
    }
  });
});

describe("the outbox", () => {
  it("has a template for each kind", () => {
    expect(m.outbox.kinds).toEqual({
      "quote-sent": "crm-quote-sent",
      "quote-accepted": "crm-quote-accepted",
      "handover-intro": "crm-handover-intro",
      "approval-asked": "crm-approval-asked",
      "visit-confirmed": "crm-visit-confirmed",
      "visit-moved": "crm-visit-moved",
      "visit-cancelled": "crm-visit-cancelled",
      "referral-thanks": "crm-referral-thanks",
      "showroom-confirmed": "crm-showroom-confirmed",
      "showroom-moved": "crm-showroom-moved",
      "showroom-cancelled": "crm-showroom-cancelled",
      "delivery-booked": "crm-delivery-booked",
      "delivery-moved": "crm-delivery-moved",
      "delivery-cancelled": "crm-delivery-cancelled",
      // A sign-off's copy, to the job's contact or to the address typed on the sign-off (e-mail 17).
      "signed-copy": "crm-signed-copy",
      "signed-copy-to": "crm-signed-copy",
      "certificate-asked": "crm-certificate-asked",
    });
    for (const key of Object.values(m.outbox.kinds)) expect(m.emailTemplates.map((one) => one.key)).toContain(key);
  });

  it("writes a line in the deal's history when a quote is sent: the amount before tax, and the quote it came from", () => {
    expect(rule("quote-sent-amount").trigger).toEqual({ kind: "record", event: "updated", table: "quotes", changedColumn: "status", when: [{ left: { field: "status" }, op: "is", right: "sent" }] });
    expect(steps("quote-sent-amount")).toEqual([{ kind: "record.create", table: "deal_amount_changes", values: { deal_id: "{{record.deal_id}}", quote_id: "{{record.id}}", amount: "{{record.subtotal}}" } }]);
  });

  it("mails a quote that reaches \"sent\" to the address kept on it, and so its acceptance", () => {
    expect(m.outbox.producers.slice(0, 2)).toEqual([{ kind: "quote-sent", module: "quotes", link: "quote_id", recipient: { column: "sent_to_email", name: "sent_to_name" }, onChange: { table: "quotes", column: "status", to: "sent" }, replyTo: { staff: "deal_id.owner_id" } },
      // …and when it is accepted, by the customer or by the office, the same address is told so: an acceptance nobody there made does not pass unseen.
      { kind: "quote-accepted", module: "quotes", link: "quote_id", recipient: { column: "sent_to_email", name: "sent_to_name" }, onChange: { table: "quotes", column: "status", to: "accepted" } },
    ]);
    // A reply to the quote's e-mail goes to the rep who owns its deal (her sign-in address, read when the mail goes).
    const quotes = m.requiredSchema.tables.find((one) => one.ref === "quotes")!;
    const column = (ref: string) => quotes.columns.find((one) => one.ref === ref)!;
    // Until it is sent, a quote shows where it will go: the contact's address as it is today, personal data like the contact's own.
    expect(column("to_email")).toMatchObject({ type: "text", nullable: true, rules: { personal: true, copy: { via: "sent_to_contact_id", from: "email", mode: "always", follow: true } } });
    expect(column("to_name")).toMatchObject({ type: "text", nullable: true, rules: { copy: { via: "sent_to_contact_id", from: "name", mode: "always", follow: true } } });
    // Sending stamps where it went, and that no longer follows the contact: the record of who was mailed stays true.
    expect(column("sent_to_email").rules).toEqual({ personal: true, stamp: { set: { copy: "to_email" }, on: { column: "status", values: ["sent"] } } });
    expect(column("sent_to_name").rules).toEqual({ stamp: { set: { copy: "to_name" }, on: { column: "status", values: ["sent"] } } });
  });
});

describe("a site visit tells the customer", () => {
  const producer = (kind: string) => m.outbox.producers.find((one) => one["kind"] === kind)!;
  const told = { setting: { table: "settings", column: "visit_emails" } };
  const booked = { column: "state", eq: "booked" };

  it("when it is booked, when its time moves, and when it is cancelled: three e-mails, one switch", () => {
    expect(producer("visit-confirmed")).toEqual({ kind: "visit-confirmed", module: "selling", link: "visit_id", gate: told, onCreate: { table: "site_visits", where: booked }, replyTo: { staff: "rep_id" } });
    // Each move is told, with the time the visit had; a change of its length or its purpose is not a move.
    expect(producer("visit-moved")).toEqual({ kind: "visit-moved", module: "selling", link: "visit_id", gate: told, onChange: { table: "site_visits", columns: ["starts_at"], changed: true, where: booked }, batchMinutes: 15, was: ["starts_at"], replyTo: { staff: "rep_id" } });
    // A cancel removes the visit, so the mail reads what the message kept. A visit already made is removed by nobody.
    expect(producer("visit-cancelled")).toEqual({ kind: "visit-cancelled", module: "selling", link: "visit_id", gate: told, onDelete: { table: "site_visits", where: booked }, was: ["starts_at", "purpose", "rep_id"] });
    expect(m.outbox.links["visit"]).toBe("visit_id");
    expect(m.outbox.columns["was"]).toBe("was");
    const column = (table: string, ref: string) => m.requiredSchema.tables.find((one) => one.ref === table)!.columns.find((one) => one.ref === ref)!;
    expect(column("outbox", "was")).toMatchObject({ type: "text", nullable: true });
    // The switch is the CRM admin's, on as installed; the booking dialog reads it.
    expect(column("settings", "visit_emails")).toMatchObject({ type: "bool", default: true });
    const roles = (manifest as unknown as { roles: { key: string; limits?: Record<string, { writable?: string[] }> }[] }).roles;
    expect(roles.find((one) => one.key === "sales-manager")!.limits!["settings"]!.writable).not.toContain("visit_emails");
    // A reply to the confirmation reaches the rep who goes.
    expect(column("site_visits", "rep_id").rules?.staff).toBe(true);
    // What is kept of a moved or a removed visit is never personal data.
    for (const ref of ["starts_at", "purpose"]) expect(column("site_visits", ref).rules?.personal, ref).toBeUndefined();
  });
});

describe("a referral is thanked", () => {
  it("by an e-mail to who made the introduction, once, when somebody fills the moment of the thanks", () => {
    expect(m.outbox.producers.find((one) => one["kind"] === "referral-thanks")).toEqual({
      kind: "referral-thanks",
      module: "accounts",
      link: "referral_id",
      onChange: { table: "referrals", columns: ["thanked_at"], changed: true, where: { column: "thanked_at", isNull: false } },
      replyTo: { staff: "thanked_by_id" },
    });
    expect(m.outbox.links["referral"]).toBe("referral_id");
    const referrals = m.requiredSchema.tables.find((one) => one.ref === "referrals")!.columns;
    // Who thanked is the server's to say, and a reply reaches them.
    expect(referrals.find((one) => one.ref === "thanked_by_id")!.rules).toEqual({ staff: true, stamp: { set: "user-id", on: { column: "thanked_at", filled: true } } });
    // The message finds its reader by the one link a referral has to a contact.
    expect(referrals.filter((one) => (one as { references?: string }).references === "contacts").map((one) => one.ref)).toEqual(["from_contact_id"]);
  });
});
