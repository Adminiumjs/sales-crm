/**
 * WHETHER A PERSON MAY BE E-MAILED, AS ADMINIUM KEEPS IT: the consent log and
 * the do-not-email list are the server's (Adminium 0.3.38), not columns of
 * this app. A contact's "may be e-mailed" switch mirrors the newsletter's
 * answer; what the contact sheet SAYS of it (since when, who ticked it, an
 * unsubscribe, the do-not-email list) is read from the log here.
 *
 * Two doors, each judged as a change or a read of the row itself (its table's
 * grant and the row inside the person's reach):
 *  - the record's panel: its standing per purpose, and the do-not-email entry;
 *  - "They said no": the record's address goes on the do-not-email list.
 */
import type { StaffSession } from "../staffSession.ts";

/** Where a yes or a no came from, as the log says it. */
export type ConsentSource = "form" | "import" | "staff" | "review" | "unsubscribe" | "relay" | "bounce" | "system" | "person";

/** The event that set a purpose's standing, as much of it as the sheet reads. */
export interface ConsentEvent {
  state: "yes" | "no" | "replied";
  source: ConsentSource;
  detail: string | null;
  staff: { id: string; label: string } | null;
  at: number;
}

/** A record's standing, as the panel door answers it. */
export interface ConsentPanel {
  declared: boolean;
  erased: boolean;
  purposes: { purpose: "newsletter" | "surveys"; state: "yes" | "no" | "not-asked"; event: ConsentEvent | null }[];
  stopped: { since: number; reason: string; origin: string | null } | null;
  mayChange: boolean;
}

const recordOf = (session: StaffSession, ref: string, id: number | string) => ({ connectionId: session.connectionId, table: session.tableId(ref), recordId: String(id) });

/** A record's standing per purpose and its do-not-email entry. Throws what the server said (an older Adminium has no such door). */
export async function consentPanel(session: StaffSession, ref: string, id: number | string): Promise<ConsentPanel> {
  return ((await session.call<{ data: ConsentPanel }>("POST", "/consent/panel", recordOf(session, ref, id))).data);
}

/** "They said no": the record's address on the do-not-email list. `added` is false when it was there already. */
export async function saidNo(session: StaffSession, ref: string, id: number | string): Promise<{ added: boolean; since: number }> {
  const doc = await session.call<{ data: { added: boolean; stopped: { since: number } } }>("POST", "/consent/said-no", recordOf(session, ref, id));
  return { added: doc.data.added, since: doc.data.stopped.since };
}

/** What the contact sheet says of the newsletter: one line, by the log's answer and where it came from. */
export type NewsletterLine =
  | { kind: "since"; at: number; by: string }
  | { kind: "sinceAt"; at: number }
  | { kind: "before" }
  | { kind: "unsubscribed"; at: number }
  | { kind: "review"; at: number }
  | { kind: "no" };

/**
 * The newsletter's line. A yes the send's review confirmed as one from before
 * records were kept reads "before"; an unsubscribe, by the link or by the mail
 * service, and a no at the send's review are named with their day; any other
 * no is "No". Null when the log has heard nothing of the person: the row's own
 * stamps say who ticked the switch and when, as they did before the log.
 */
export function newsletterLine(panel: Pick<ConsentPanel, "purposes">): NewsletterLine | null {
  const standing = panel.purposes.find((one) => one.purpose === "newsletter");
  const event = standing?.event ?? null;
  if (standing === undefined || standing.state === "not-asked") return null;
  if (standing.state === "yes") {
    // A yes the log holds from another row of the same address is not shown here: the row's own stamps speak.
    if (event === null) return null;
    if (event.detail === "before-records") return { kind: "before" };
    if (event.source === "staff" || event.source === "review") return event.staff === null ? { kind: "sinceAt", at: event.at } : { kind: "since", at: event.at, by: event.staff.label };
    return { kind: "sinceAt", at: event.at };
  }
  if (event?.source === "unsubscribe" || event?.source === "relay") return { kind: "unsubscribed", at: event.at };
  if (event?.source === "review") return { kind: "review", at: event.at };
  return { kind: "no" };
}
