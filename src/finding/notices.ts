/**
 * THE PERSON'S NOTICES: Adminium's own, at `/api/v1/me/notifications`.
 *
 * The bell reads the newest page and the unread count in one request, marks
 * one notice read when it is opened, and marks them all read on asking. Each
 * of these is the person's own: the session is the scope, and nobody else's
 * notice can be read or marked from here.
 *
 * LIVE, BY ASKING ONCE A MINUTE. Adminium does tell a person's open pages
 * of a new notice, on the channel `notifications:<their id>`, but listening
 * there holds one more connection open for as long as the page is, and a
 * browser keeps at most six to one server over HTTP/1.1 (every tab of it
 * together). A screen already holds up to three for its own live lists; with
 * the bell's on top, the deal room and its call notes open in one browser
 * left the call notes' reads waiting for good. So the bell asks: every
 * `POLL_MS` while the page is shown, at once when the page is shown again or
 * the window takes the focus (not sooner than `NUDGE_MS` after the last ask),
 * when the list is opened, and after a notice is marked read.
 */
import type { StaffSession } from "../staffSession.ts";

export interface Notice {
  id: string;
  /** `mention`, `report.ready`, …: a stable key, words chosen by it. */
  kind: string;
  /** Who did what the notice says, as the server names them. */
  actorLabel: string;
  /** The server's own sentence, in its words (for a kind the app has no words of its own for). */
  title: string;
  /** For a mention: the record named ("Deal: Fourth-floor desk rows"), or only its table's name for somebody who cannot open it. */
  body: string | null;
  entity: Record<string, unknown> | null;
  actionUrl: string | null;
  opens?: { appKey: string; path: string };
  readAt: number | null;
  createdAt: number;
}

export interface NoticePage {
  items: Notice[];
  unreadCount: number;
  nextCursor: string | null;
}

/** How many notices the bell lists. */
export const BELL_LIMIT = 20;
/** How often the bell asks while the page is shown: once a minute. */
export const POLL_MS = 60_000;
/** The least time between two asks set off by the page being shown again. */
export const NUDGE_MS = 10_000;

/** Whether a nudge (the page shown again, the window focused) should ask now, given when the last ask went. */
export const shouldNudge = (last: number | null, now: number): boolean => last === null || now - last >= NUDGE_MS;

export async function readNotices(session: Pick<StaffSession, "call">, limit = BELL_LIMIT): Promise<NoticePage> {
  return (await session.call<{ data: NoticePage }>("GET", `/me/notifications?limit=${String(limit)}`)).data;
}

/** Mark one read. Answers the unread count after it. */
export async function markRead(session: Pick<StaffSession, "call">, id: string): Promise<number> {
  return (await session.call<{ data: { updated: boolean; unreadCount: number } }>("POST", `/me/notifications/${encodeURIComponent(id)}/read`, {})).data.unreadCount;
}

export async function markAllRead(session: Pick<StaffSession, "call">): Promise<number> {
  return (await session.call<{ data: { updated: number; unreadCount: number } }>("POST", "/me/notifications/read-all", {})).data.unreadCount;
}
