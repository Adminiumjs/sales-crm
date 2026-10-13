/**
 * THE ACTIVITY FEED: what was logged on the open deals, newest first.
 *
 * It is read from the three tables the app itself writes: `activities`
 * (calls, emails, meetings, notes), `deal_stage_changes` (a rule writes one
 * line per move) and `deal_amount_changes` (a rule writes one when a quote is
 * sent). Each is cut to the reader's deals by the server. The page reads the
 * newest of each and lays them in one order; it never asks a record's
 * history one deal at a time.
 *
 * NOT IN THE FEED: the design's "other changes" (a renamed deal, a moved
 * close date, a new owner). Those live in each record's own history, which
 * has no door across records; reading it for every deal would be a request
 * per deal with no bound.
 *
 * WHO ADDS UP. A kind's count is the server's. "Everything" carries no
 * count: it would be three tables' counts added here.
 */
import { useCallback, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { Icon } from "../../shell/icons.tsx";
import type { Condition, Grouped, StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { byKey, num, OPEN, peopleOf, useScreen, type People } from "./data.ts";

const PAGE = 20;
/** A list answers 200 rows at most: as far back as one look goes. */
const FURTHEST = 200;
/** The feed follows this many open deals, the most recently active first. */
const DEALS = 400;
const KINDS = ["call", "email", "meeting", "note"] as const;
const TYPES = ["all", ...KINDS, "stage", "amount"] as const;
type Type = (typeof TYPES)[number];
const ICONS: Record<Exclude<Type, "all">, string> = { call: "contact", email: "mail", meeting: "calendar-days", note: "notebook-pen", stage: "arrow-right-left", amount: "file-text" };

interface Entry {
  key: string;
  type: Exclude<Type, "all">;
  at: string;
  who: string | null;
  deal: string | null;
  company: string | null;
  text: string | null;
  from?: string | null;
  to?: string | null;
  amount?: number | string;
  quote?: string | null;
}
interface FeedData {
  people: People;
  entries: Entry[];
  more: boolean;
  /** Each kind's count for the person shown; null where the reader may not read that table. */
  counts: Partial<Record<Exclude<Type, "all">, number>>;
  cut: boolean;
}

async function openDeals(session: StaffSession): Promise<{ ids: number[]; cut: boolean }> {
  const ids: number[] = [];
  let total = 0;
  for (let offset = 0; offset < DEALS; offset += 200) {
    const page = await session.list<{ id: number }>("deals", { select: ["id"], where: OPEN, order: ["last_activity_at.desc", "id"], limit: 200, offset, count: "exact" });
    ids.push(...page.rows.map((row) => row.id));
    total = page.total ?? ids.length;
    if (page.rows.length < 200) break;
  }
  return { ids, cut: total > ids.length };
}

async function read(session: StaffSession, type: Type, who: string | null, upTo: number): Promise<FeedData> {
  const [people, deals] = await Promise.all([peopleOf(session), openDeals(session)]);
  if (deals.ids.length === 0) return { people, entries: [], more: false, counts: {}, cut: false };
  const onOpen: Condition = { column: "deal_id", op: "in", value: deals.ids };
  const by = (column: string): Condition[] => (who === null ? [onOpen] : [onOpen, { column, op: "eq", value: who }]);
  const amounts = session.can("deal_amount_changes", "read") && who === null;
  const wants = (one: Exclude<Type, "all">): boolean => type === "all" || type === one;
  const activityKinds = KINDS.filter(wants);
  const [byKind, stageCount, amountCount, activities, stages, amountRows] = await Promise.all([
    session.figure<Grouped>({ table: "activities", shape: "categorical", filters: by("author_id"), groupBy: ["kind"], aggregations: [{ fn: "count", alias: "n" }], limit: 20 }),
    session.figure<{ value: number }>({ table: "deal_stage_changes", shape: "single-metric", filters: by("by_id"), aggregations: [{ fn: "count", alias: "n" }] }),
    amounts ? session.figure<{ value: number }>({ table: "deal_amount_changes", shape: "single-metric", filters: [onOpen], aggregations: [{ fn: "count", alias: "n" }] }) : Promise.resolve(null),
    activityKinds.length === 0
      ? Promise.resolve(null)
      : session.list<Record<string, unknown>>("activities", {
          select: ["id", "kind", "text", "author_id", "at"],
          where: { and: [...by("author_id"), ...(type === "all" ? [] : [{ column: "kind", op: "eq" as const, value: type }])] },
          order: ["at.desc", "id.desc"],
          lookup: ["deal:deal_id.name", "company:deal_id.company_id.name"],
          limit: upTo,
          count: "exact",
        }),
    wants("stage")
      ? session.list<Record<string, unknown>>("deal_stage_changes", {
          select: ["id", "by_id", "at"],
          where: { and: by("by_id") },
          order: ["at.desc", "id.desc"],
          lookup: ["deal:deal_id.name", "company:deal_id.company_id.name", "from:from_stage_id.label", "to:to_stage_id.label"],
          limit: upTo,
          count: "exact",
        })
      : Promise.resolve(null),
    wants("amount") && amounts
      ? session.list<Record<string, unknown>>("deal_amount_changes", { select: ["id", "amount", "at"], where: onOpen, order: ["at.desc", "id.desc"], lookup: ["deal:deal_id.name", "company:deal_id.company_id.name", "quote:quote_id.number"], limit: upTo, count: "exact" })
      : Promise.resolve(null),
  ]);
  const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
  const entries: Entry[] = [
    ...(activities?.rows ?? []).map((row): Entry => ({ key: `a${String(row["id"])}`, type: row["kind"] as Entry["type"], at: String(row["at"]), who: text(row["author_id"]), deal: text(row["deal"]), company: text(row["company"]), text: text(row["text"]) })),
    ...(stages?.rows ?? []).map((row): Entry => ({ key: `s${String(row["id"])}`, type: "stage", at: String(row["at"]), who: text(row["by_id"]), deal: text(row["deal"]), company: text(row["company"]), text: null, from: text(row["from"]), to: text(row["to"]) })),
    ...(amountRows?.rows ?? []).map((row): Entry => ({ key: `m${String(row["id"])}`, type: "amount", at: String(row["at"]), who: null, deal: text(row["deal"]), company: text(row["company"]), text: null, amount: row["amount"] as number | string, quote: text(row["quote"]) })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key.localeCompare(b.key)));
  const kinds = byKey(byKind, "n");
  const counts: FeedData["counts"] = { stage: num(stageCount.value) };
  for (const kind of KINDS) counts[kind] = kinds[kind]?.["n"] ?? 0;
  if (amountCount !== null) counts.amount = num(amountCount.value);
  const held = [activities, stages, amountRows].some((page) => page !== null && (page.total ?? page.rows.length) > page.rows.length);
  return { people, entries: entries.slice(0, upTo), more: held || entries.length > upTo, counts, cut: deals.cut };
}

export function Feed() {
  const t = useT();
  const { session, f } = useScreen();
  const me = session.config.user?.id ?? null;
  const [now, setNow] = useState(() => session.now());
  const [type, setType] = useState<Type>("all");
  const [who, setWho] = useState<string | null>(null);
  const [upTo, setUpTo] = useState(PAGE);
  const { load, reload } = useLoad(() => read(session, type, who, upTo), [session, type, who, upTo]);
  const again = useCallback(() => {
    setNow(session.now());
    reload();
  }, [session, reload]);
  useLive(["activities", "deal_stage_changes", "deal_amount_changes", "deals"], again);
  const pick = (next: Type): void => (setType(next), setUpTo(PAGE));
  const whose = (next: string | null): void => (setWho(next), setUpTo(PAGE));

  return (
    <div className="crm-screen crm-feed mr-screen" data-screen="feed">
      <div className="crm-screen-head">
        <div>
          <h1>{t("feed.title")}</h1>
          <p className="crm-screen-sub">{t("feed.sub")}</p>
        </div>
        {me !== null && (
          <button type="button" className="crm-chip-btn mr-chip" aria-pressed={who === me} onClick={() => whose(who === me ? null : me)}>
            {t("feed.mine")}
          </button>
        )}
      </div>
      <Loaded load={load} reload={again} skeleton={<Skeleton rows={6} height={72} />}>
        {(data) => {
          const name = (id: string | null): string | null => (id === null ? null : (data.people.names[id] ?? t("team.someone")));
          const groups: { day: string; items: Entry[] }[] = [];
          for (const entry of data.entries) {
            const day = f.dayKey(new Date(entry.at));
            const last = groups.at(-1);
            if (last !== undefined && last.day === day) last.items.push(entry);
            else groups.push({ day, items: [entry] });
          }
          const heading = (at: Date): string => {
            const ago = f.dayDiff(at, now);
            return ago === 0 ? t("feed.today", { day: f.dayShort(at) }) : ago === 1 ? t("feed.yesterday", { day: f.dayShort(at) }) : f.dayLong(at);
          };
          return (
            <>
              <div className="crm-chips" role="group" aria-label={t("feed.types")}>
                {TYPES.filter((one) => one === "all" || data.counts[one] !== undefined).map((one) => (
                  <button key={one} type="button" className="crm-chip-btn mr-chip" aria-pressed={type === one} data-type={one} onClick={() => pick(one)}>
                    {one !== "all" && <Icon name={ICONS[one]} size={13} />}
                    {t(`feed.kind.${one}` as MessageKey)}
                    {one !== "all" && <span className="crm-chip-count crm-mono">{f.number(data.counts[one] ?? 0)}</span>}
                  </button>
                ))}
              </div>
              <div className="crm-chips crm-feed-people" role="group" aria-label={t("feed.people")}>
                <button type="button" className="crm-chip-btn mr-chip" aria-pressed={who === null} onClick={() => whose(null)}>
                  {t("feed.everyone")}
                </button>
                {data.people.reps.map((id) => (
                  <button key={id} type="button" className="crm-chip-btn mr-chip" aria-pressed={who === id} onClick={() => whose(id)}>
                    {firstName(name(id) ?? "")}
                  </button>
                ))}
              </div>
              {data.cut && <p className="crm-tm-outside">{t("feed.cut", { count: f.number(DEALS) })}</p>}

              <div className="crm-feed-days" aria-busy={load.state === "ready" && load.again}>
                {groups.map((group) => (
                  <section key={group.day} className="crm-feed-day" aria-label={heading(new Date(group.items[0]!.at))}>
                    <div className="crm-feed-day-head">
                      <span className="crm-tm-label">{heading(new Date(group.items[0]!.at))}</span>
                      <span className="crm-feed-rule" />
                    </div>
                    <ul className="crm-feed-list mr-card">
                      {group.items.map((entry) => {
                        const person = name(entry.who);
                        return (
                          <li key={entry.key} className="crm-feed-entry" data-type={entry.type}>
                            <span className="crm-feed-icon" data-type={entry.type}>
                              <Icon name={ICONS[entry.type]} size={15} />
                            </span>
                            <div className="crm-tm-grow">
                              <div className="crm-feed-top">
                                <span className="crm-tm-name">{entry.deal ?? ""}</span>
                                {entry.company !== null && (
                                  <span className="crm-chip">
                                    <span className="crm-dot" data-tone="accent" />
                                    {entry.company}
                                  </span>
                                )}
                                <span className="crm-pill">{t(`feed.label.${entry.type}` as MessageKey)}</span>
                                <span className="crm-feed-who">
                                  {person !== null && (
                                    <>
                                      <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                                        {initials(person)}
                                      </span>
                                      {firstName(person)}
                                    </>
                                  )}
                                  <span className="crm-mono">{f.time(new Date(entry.at))}</span>
                                </span>
                              </div>
                              <p>
                                {entry.type === "stage"
                                  ? entry.from === null || entry.from === undefined
                                    ? t("feed.opened", { to: entry.to ?? "" })
                                    : t("feed.moved", { from: entry.from, to: entry.to ?? "" })
                                  : entry.type === "amount"
                                    ? entry.quote === null || entry.quote === undefined
                                      ? t("feed.amount", { amount: f.money(entry.amount) })
                                      : t("feed.amount.quote", { amount: f.money(entry.amount), quote: entry.quote })
                                    : (entry.text ?? "")}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
              {data.entries.length === 0 && (
                <div className="crm-empty">
                  <span className="crm-empty-icon">
                    <Icon name="history" size={21} />
                  </span>
                  <div className="crm-empty-title">{t("feed.empty")}</div>
                  <p>{t("feed.empty.body")}</p>
                </div>
              )}
              {data.more && upTo < FURTHEST && (
                <div className="crm-more">
                  <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi" onClick={() => setUpTo((n) => Math.min(FURTHEST, n + PAGE))}>
                    {t("feed.more")}
                  </button>
                </div>
              )}
              {data.more && upTo >= FURTHEST && <p className="crm-tm-outside">{t("feed.end")}</p>}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
