/**
 * HELPING ON A COLLEAGUE'S DEAL (ruling 1d, owner 2026-10-25): a rep listed on
 * a deal she does not own ("Also on this deal") reads the deal and everything
 * on it, and comments. She changes nothing else of it: not its stage, amount,
 * contact or close, not its quotes, and she logs nothing on it and books
 * nothing for it. The deal's owner makes the changes.
 *
 * Not a helper:
 *  - the deal's owner;
 *  - whoever COVERS for the owner today (a cover lends an away colleague's
 *    deals, to be worked);
 *  - a reader whose screens are the team's (a sales manager, the CRM admin):
 *    the server holds each of them to their own rule.
 *
 * The screens draw no control a helper may not use, and say why where she
 * would look for it. The server is what holds it.
 *
 * Her OWN rows made on the deal before she was a helper only (a follow-up she
 * owns, a visit she is the rep of) stay hers to finish, move or call off;
 * nothing new of hers is hung on the deal.
 *
 * Which covers count: the ones the board reads (`pipeline/Pipeline.tsx`), so a
 * deal marked "covering" there is worked in its room and one marked "helping"
 * is not. With the Team part off no cover is read, and a lent deal reads as
 * one she helps on.
 */
import { useCallback } from "react";

import type { StaffSession } from "../staffSession.ts";
import { useSession } from "../session/session.tsx";
import { useLive, useLoad } from "../ui/load.tsx";
import { scopeOf } from "./figures.ts";

/** Whether the reader may read the covers the board reads: the Team part on, and the covers table read. */
export const readsCovers = (session: StaffSession): boolean => session.part("team") && session.can("covers", "read");

/** The people whose deals the reader covers on `today` (a business day, `YYYY-MM-DD`). Empty when no cover is read. */
export async function lentBy(session: StaffSession, today: string): Promise<ReadonlySet<string>> {
  const me = session.config.user?.id ?? null;
  if (me === null || !readsCovers(session)) return new Set();
  const page = await session
    .list<{ owner_id: string }>("covers", {
      select: ["owner_id"],
      where: { and: [{ column: "cover_id", op: "eq", value: me }, { column: "starts_on", op: "lte", value: today }, { or: [{ column: "ends_on", op: "gte", value: today }, { column: "ends_on", op: "is_null" }] }] },
      limit: 50,
    })
    .catch(() => ({ rows: [] as { owner_id: string }[] }));
  return new Set(page.rows.map((row) => row.owner_id));
}

/**
 * Whether the reader only helps on a deal owned by `ownerId`: her screens are her own (a rep, the account manager),
 * the deal is somebody else's, and she does not cover for its owner today.
 */
export function helpsOn(session: StaffSession, ownerId: string | null | undefined, lent: ReadonlySet<string>): boolean {
  const me = session.config.user?.id ?? null;
  if (scopeOf(session) === "team" || me === null) return false;
  if (ownerId === null || ownerId === undefined || ownerId === "" || ownerId === me) return false;
  return !lent.has(ownerId);
}

/**
 * The same for one deal's screen: true or false once known, null while the covers are still being read (a screen
 * then draws no control that changes the deal, and no line about helping either).
 */
export function useHelping(ownerId: string | null | undefined, today: string): boolean | null {
  const session = useSession();
  const me = session.config.user?.id ?? null;
  // Nothing to ask: the reader's own deal, or a reader the rule does not hold.
  const settled = ownerId === undefined ? null : !helpsOn(session, ownerId, new Set()) ? false : !readsCovers(session) ? true : undefined;
  const { load, reload } = useLoad(() => (settled === undefined ? lentBy(session, today) : Promise.resolve(new Set<string>())), [session, today, settled, me]);
  useLive(settled === undefined ? ["covers"] : [], useCallback(() => reload(), [reload]));
  if (settled !== undefined) return settled;
  return load.state === "ready" ? helpsOn(session, ownerId, load.data) : null;
}
