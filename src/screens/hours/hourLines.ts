/**
 * MY HOURS' saves as lines of the phone's offline queue (plan 68 S19): the
 * week's sheet (made by the first day written, with no screen of its own: a
 * quiet line), a day, a day changed, and the week sent for sign-off. A day
 * written to a week made on this phone names that week's line (`$line`), so
 * it goes once the week has its row.
 */
import type { LineRef, NewLine, OpId } from "../../offlineQueue.ts";
import type { LineDraft, SheetLine, SheetState } from "./data.ts";

const dayMeta = (monday: string, draft: LineDraft) => ({ monday, day: draft.day, what: draft.what.trim(), hours: draft.hours, travel: draft.travel, visit: draft.visitId });

/** The week's sheet, made the first time he writes a day of it. */
export const sheetLine = (user: string, monday: string, key: string): NewLine => ({
  kind: "sheet",
  quiet: true,
  meta: { monday },
  op: { type: "create", table: "time_sheets", values: { user_id: user, week_of: monday }, key },
});

/** A day written to a sheet: one the server has, or the week's line on this phone. */
export const dayLine = (sheet: number | LineRef, monday: string, draft: LineDraft, key: string): NewLine => ({
  kind: "day",
  meta: dayMeta(monday, draft),
  op: { type: "create", table: "time_sheet_lines", values: { sheet_id: sheet, day: draft.day, what: draft.what.trim(), hours: draft.hours, travel_hours: draft.travel, visit_id: draft.visitId }, key },
});

/** A day's line changed. */
export const dayChangeLine = (line: Pick<SheetLine, "id">, monday: string, draft: LineDraft): NewLine => ({
  kind: "day-change",
  meta: { ...dayMeta(monday, draft), line: line.id },
  op: { type: "update", table: "time_sheet_lines", id: line.id, values: { day: draft.day, what: draft.what.trim(), hours: draft.hours, travel_hours: draft.travel, visit_id: draft.visitId } },
});

/** The week sent for sign-off, from the state the screen saw. */
export const sendWeekLine = (sheet: OpId, monday: string, from: SheetState): NewLine => ({
  kind: "send-week",
  meta: { monday, again: from === "sent-back" },
  op: { type: "act", table: "time_sheets", id: sheet, action: "send", from },
});
