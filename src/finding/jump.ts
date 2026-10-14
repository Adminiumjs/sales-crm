/**
 * JUMP: what the palette lists, and how it asks the server for records.
 *
 * Two kinds of line:
 *
 *  - SCREENS: the person's own menu (`menuFor`), the screens under their name,
 *    and nothing else. A screen their roles do not hold is never offered,
 *    whatever they type. Matched here, by the words the menu shows.
 *  - RECORDS: deals, companies, contacts and quotes found by what is typed.
 *    Every one is a row the server answered THIS person: each table is read
 *    through the person's own session, so a colleague's deal is not there to
 *    be found, by any spelling, for somebody held to their own.
 *
 * WHY NOT ADMINIUM'S SEARCH DOOR (`GET /api/v1/search`). It answers rows of
 * the person's reach too, but it cannot be held to this app's tables from an
 * app's side: it looks through the first twenty tables of the install unless
 * given each table's qualified name (`main.crm_deals` on SQLite, a schema's
 * name elsewhere), and the side's config names tables bare (`crm_deals`).
 * Asked unqualified on the stand, "desk" finds a company and three enquiries
 * and not Dana's own "Fourth-floor desk rows". Its hits also say a record's
 * columns by their stored names (`scope …, company_id 4`), which no screen can
 * show. So each table is read by its name column instead.
 *
 * THE BUDGET. A person has 300 requests a minute. The palette asks nothing
 * while it lists screens, and nothing for fewer than two letters. Records are
 * asked once typing pauses (`PAUSE_MS`), at most one round every `GAP_MS`,
 * one request per table the person reads (four at most), and a word asked
 * once is not asked again while the palette is open. Typing a name costs four
 * to twelve requests; no way of typing costs more than 4 × 60 000 / `GAP_MS`
 * (160) a minute. A round still on its way when the next key comes is left to
 * land and its answer dropped: the server counted it when it arrived, so
 * cutting the line would save nothing.
 */
import type { MessageKey } from "../i18n/messages/index.ts";
import { OWN, USER_MENU, type RouteKey, type ShownGroup } from "../shell/routes.ts";
import type { Condition, StaffSession } from "../staffSession.ts";

export const PAUSE_MS = 280;
export const GAP_MS = 1500;
/** The fewest letters records are looked for by. */
export const MIN_LETTERS = 2;
/** How many of each kind of record a round asks for. */
export const PER_KIND = 5;
/** How many screens are listed before anything is typed. */
export const SCREENS_UNTYPED = 8;

export interface ScreenLine {
  kind: "screen";
  route: RouteKey;
  /** The words of the menu line, under `nav.item.` or `nav.own.`. */
  label: MessageKey;
}

export type RecordKind = "deal" | "company" | "contact" | "quote";

export interface RecordLine {
  kind: RecordKind;
  id: number;
  title: string;
  /** What follows the title, already in the reader's words where the server sent words. */
  sub: string | null;
  /** A deal's amount, the server's figure; null for anything else. */
  amount: number | string | null;
  /** A deal's state, so a closed one can say so. */
  state: string | null;
  /** Where it opens. */
  route: RouteKey;
}

/** The screens a person may jump to: their menu in its order, then the screens under their name. */
export function screenLines(groups: readonly ShownGroup[], own: (route: RouteKey) => boolean): ScreenLine[] {
  const out: ScreenLine[] = [];
  const seen = new Set<RouteKey>();
  for (const group of groups) {
    for (const item of group.items) {
      if (seen.has(item.route)) continue;
      seen.add(item.route);
      out.push({ kind: "screen", route: item.route, label: `nav.item.${item.label}` as MessageKey });
    }
  }
  for (const route of USER_MENU) {
    if (seen.has(route) || !OWN.includes(route) || !own(route)) continue;
    seen.add(route);
    out.push({ kind: "screen", route, label: `nav.own.${route}` as MessageKey });
  }
  return out;
}

/** Folded for matching: no case, no accents (é finds e), one space between words. */
export const fold = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** The screens whose words hold what was typed. Nothing typed: the first few, as the menu has them. */
export function matchScreens(lines: readonly ScreenLine[], typed: string, words: (line: ScreenLine) => string): ScreenLine[] {
  const q = fold(typed);
  if (q === "") return lines.slice(0, SCREENS_UNTYPED);
  return lines.filter((line) => fold(words(line)).includes(q));
}

/** What a typed word is matched as, in a `like`: its own `%` and `_` taken literally. */
export const likeOf = (typed: string): string => `%${typed.trim().replace(/[\\%_]/g, (one) => `\\${one}`)}%`;

const named = (column: string, typed: string): Condition => ({ column, op: "ilike", value: likeOf(typed) });

/** Which tables a person's records are looked for in: the ones whose part is on and that they read. */
export function kindsFor(session: Pick<StaffSession, "part" | "can">): RecordKind[] {
  const out: RecordKind[] = [];
  // A deal's line names its stage: somebody who reads deals and no stage (the operations manager, who reads a won deal's
  // name to make its job) has no deal room to open either.
  if (session.part("selling") && session.can("deals", "read") && session.can("stages", "read")) out.push("deal");
  if (session.part("accounts") && session.can("companies", "read")) out.push("company");
  if (session.part("accounts") && session.can("contacts", "read")) out.push("contact");
  if (session.part("quotes") && session.can("quotes", "read")) out.push("quote");
  return out;
}

export const ROUTE_OF: Record<RecordKind, RouteKey> = { deal: "deal", company: "companies", contact: "contacts", quote: "quotes" };

const text = (value: unknown): string | null => (value === null || value === undefined || value === "" ? null : String(value));

/**
 * One round: each table the person reads, by its name column, as the person.
 * A table that refuses (a part switched off meanwhile, a right taken away)
 * gives no lines; the others still answer.
 */
export async function findRecords(session: Pick<StaffSession, "part" | "can" | "list">, typed: string, words: { version: (n: number) => string }): Promise<RecordLine[]> {
  const q = typed.trim();
  if (q.length < MIN_LETTERS) return [];
  const kinds = kindsFor(session);
  const asks = kinds.map(async (kind): Promise<RecordLine[]> => {
    try {
      if (kind === "deal") {
        const page = await session.list<{ id: number; name: string; state: string; amount: number | string; company: string | null; stage: string | null }>("deals", {
          select: ["id", "name", "state", "amount"],
          lookup: ["company:company_id.name", "stage:stage_id.label"],
          where: named("name", q),
          order: ["name"],
          limit: PER_KIND,
        });
        return page.rows.map((row) => ({ kind, id: row.id, title: row.name, sub: [text(row.company), text(row.stage)].filter((one) => one !== null).join(" · ") || null, amount: row.amount, state: row.state, route: ROUTE_OF[kind] }));
      }
      if (kind === "company") {
        const page = await session.list<{ id: number; name: string; sector: string | null; town: string | null }>("companies", { select: ["id", "name", "sector", "town"], where: named("name", q), order: ["name"], limit: PER_KIND });
        return page.rows.map((row) => ({ kind, id: row.id, title: row.name, sub: [text(row.sector), text(row.town)].filter((one) => one !== null).join(" · ") || null, amount: null, state: null, route: ROUTE_OF[kind] }));
      }
      if (kind === "contact") {
        const page = await session.list<{ id: number; name: string; job_title: string | null; company: string | null }>("contacts", { select: ["id", "name", "job_title"], lookup: ["company:company_id.name"], where: named("name", q), order: ["name"], limit: PER_KIND });
        return page.rows.map((row) => ({ kind, id: row.id, title: row.name, sub: [text(row.job_title), text(row.company)].filter((one) => one !== null).join(" · ") || null, amount: null, state: null, route: ROUTE_OF[kind] }));
      }
      // A quote by its number: the family's (Q-1002, what the customer and the rep call it) or the version's own document number.
      const page = await session.list<{ id: number; number: string | null; family_no: string | null; version: number | null; deal: string | null }>("quotes", {
        select: ["id", "number", "family_no", "version"],
        lookup: session.can("deals", "read") ? ["deal:deal_id.name"] : [],
        where: { or: [named("family_no", q), named("number", q)] },
        order: ["family_no", "version.desc"],
        limit: PER_KIND,
      });
      return page.rows.map((row) => ({ kind, id: row.id, title: `${row.family_no ?? row.number ?? ""} · ${words.version(row.version ?? 1)}`, sub: text(row.deal), amount: null, state: null, route: ROUTE_OF[kind] }));
    } catch {
      return [];
    }
  });
  return (await Promise.all(asks)).flat();
}

/**
 * When the next round may go: once typing has paused, and not sooner than
 * `GAP_MS` after the last round left. `last` is when the last one left (or
 * null), `now` the browser's clock (a wait, not a date: the server's clock is
 * not needed for it).
 */
export const roundDelay = (last: number | null, now: number): number => Math.max(PAUSE_MS, last === null ? 0 : last + GAP_MS - now);

/** Whether a screen line names the place the person is on (marked "here"). */
export const isHere = (line: ScreenLine, current: RouteKey | null): boolean => line.route === current;

