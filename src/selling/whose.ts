/**
 * WHO "WE" ARE, for a change the server holds to a person's own rows or her
 * team's (plan 68 X3): which people's companies and territories a screen
 * offers to change. The server decides every write; this only keeps a screen
 * from offering a button it would refuse.
 *
 *  - the CRM admin (and the install's owner, read as her): anybody's;
 *  - a sales manager: herself and the people she leads. The page is not told
 *    whom she leads, so it is read from the deals she is answered (the server
 *    cuts them to her team's): the people who own one. A colleague of hers
 *    with no deal yet is left out, and the server is the one who says yes;
 *  - anybody else (a rep, the account manager): herself.
 *
 * A company is changed by whoever is its account owner, owns an open deal at
 * it, or by anybody (of a role that changes companies) while it is nobody's:
 * no account owner and no open deal. A territory by its owner's side, or by
 * anybody while it has no owner.
 */
import { leadRole } from "../shell/roles.ts";
import type { Grouped, StaffSession } from "../staffSession.ts";

export type Us = "anybody" | ReadonlySet<string>;

export async function readUs(session: StaffSession): Promise<Us> {
  const me = session.config.user?.id ?? null;
  const lead = leadRole((session.config.access?.roles ?? []).map((role) => role.slug));
  if (lead === "admin") return "anybody";
  if (me === null) return new Set();
  if (lead !== "sales-manager" || !session.can("deals", "read")) return new Set([me]);
  const owners = await session.figure<Grouped>({ table: "deals", shape: "categorical", groupBy: ["owner_id"], aggregations: [{ fn: "count", alias: "n" }], limit: 200 }).catch(() => null);
  return new Set([me, ...(owners?.items ?? []).flatMap((item) => (item.key === null || item.key === "" ? [] : [String(item.key)]))]);
}

const ours = (us: Us, person: string | null | undefined): boolean => us === "anybody" || (person !== null && person !== undefined && person !== "" && us.has(person));

/** Whether a company is ours to change: by its account owner, the owners of its open deals, or nobody's at all. */
export function mayChangeCompany(us: Us, accountOwner: string | null | undefined, openOwners: readonly (string | null)[]): boolean {
  if (us === "anybody") return true;
  const owners = openOwners.filter((one): one is string => one !== null && one !== "");
  if ((accountOwner === null || accountOwner === undefined || accountOwner === "") && owners.length === 0) return true;
  return ours(us, accountOwner) || owners.some((one) => ours(us, one));
}

/** Whether a territory is ours to change: its owner is one of us, or it has none. */
export const mayChangeTerritory = (us: Us, owner: string | null | undefined): boolean => owner === null || owner === undefined || owner === "" || ours(us, owner);

/** The owners of the open deals at each of some companies, read from the marks (every reader of Accounts reads them all). */
export async function openOwnersAt(session: StaffSession, companies: readonly number[]): Promise<Record<string, (string | null)[]>> {
  const out: Record<string, (string | null)[]> = {};
  if (companies.length === 0 || !session.can("deal_marks", "read")) return out;
  const page = await session.list<{ company_id: number | null; owner_id: string | null }>("deal_marks", {
    select: ["id", "company_id", "owner_id"],
    where: { and: [{ column: "state", op: "eq", value: "open" }, { column: "company_id", op: "in", value: [...companies] }] },
    limit: 500,
  });
  for (const row of page.rows) {
    if (row.company_id === null) continue;
    (out[String(row.company_id)] ??= []).push(row.owner_id ?? null);
  }
  return out;
}
