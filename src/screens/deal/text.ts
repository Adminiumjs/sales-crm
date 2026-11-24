/**
 * A TEXT FROM A DEAL (plan 80): "Send a text" beside "Log the call".
 *
 * The text goes through Adminium's own door, `POST /texts/send`, as the person
 * signed in: the server reads the number on the contact's row (under their row
 * limits), and its send path judges everything else. That door answers:
 *
 *  - `queued`: on its way (never "delivered": the provider says that later);
 *  - `held`: outside the sending hours, it goes at `opensAt`;
 *  - `refused` with a `reason`: nothing went. A `no-consent` is "no yes given
 *    to THIS app": a yes to another app's texts does not count. Somebody who
 *    texted the business in the last 7 days may be answered without one.
 *
 * Only a text that is queued or held is logged on the deal, as an activity of
 * kind `text` (the opening line, then the words). A refused one logs nothing.
 *
 * ONE PRESS, ONE TEXT. The send carries a client key made once per draft (the
 * person and the words), and the activity its own retry key. A press after a
 * lost reply sends both again: the server answers the delivery the first made,
 * and the activity the first save made, so neither is made twice.
 */
import type { MessageKey } from "../../i18n/messages/index.ts";
import { LostReply, StaffError, type Saved, type StaffSession } from "../../staffSession.ts";
import type { Activity, Contact } from "./data.ts";

/** The most a text the server takes holds (`TEXT_BODY_MAX`); the opt-out line is added after. */
export const TEXT_MAX = 1600;

/** The door's answer, as it is sent. */
export interface TextResult {
  outcome: "queued" | "held" | "refused";
  deliveryId: string | null;
  opensAt: number | null;
  reason: string | null;
}
export interface TextReply {
  threadId: string | null;
  /** The number it went to, masked (`+44 ••• 789`); null for a reader who may not see it. */
  sentTo: string | null;
  result: TextResult;
}

export type TextSent =
  /** Queued or held, and logged (or not: `logged` says how the activity's save ended). */
  | { state: "went"; outcome: "queued" | "held"; opensAt: Date | null; sentTo: string | null; logged: Saved<Activity> }
  | { state: "refused"; reason: string }
  /** The server answered no before judging the text: its status, code and reason. */
  | { state: "failed"; error: StaffError }
  /** No answer came: it may have gone. The same keys again are safe. */
  | { state: "unknown" };

export interface TextKeys {
  text: string;
  activity: string;
}

/** The people of the deal a text can go to: those with a number on file, the deal's main contact first. */
export function textable(people: readonly Contact[], mainId: number | null): Contact[] {
  const withNumber = people.filter((one) => typeof one.phone === "string" && one.phone.trim() !== "");
  return [...withNumber.filter((one) => one.id === mainId), ...withNumber.filter((one) => one.id !== mainId)];
}

/** What the activity keeps: the opening line, then the words as they were sent. */
export const textActivity = (opening: string, body: string): string => `${opening}\n${body.trim()}`.slice(0, 4000);

/**
 * Send the text, then log it on the deal when it went. `opening` writes the
 * activity's first line once the outcome is known (a held text says when it goes).
 */
export async function sendText(
  session: Pick<StaffSession, "call" | "create" | "connectionId" | "tableId">,
  input: { dealId: number; contactId: number; body: string; opening: (went: { outcome: "queued" | "held"; opensAt: Date | null; sentTo: string | null }) => string },
  keys: TextKeys,
): Promise<TextSent> {
  let reply: TextReply;
  try {
    const doc = await session.call<{ data: TextReply }>("POST", "/texts/send", {
      connection: session.connectionId,
      table: session.tableId("contacts"),
      row: String(input.contactId),
      column: "phone",
      body: input.body.trim(),
      clientKey: keys.text,
    });
    reply = doc.data;
  } catch (error) {
    if (error instanceof StaffError) return { state: "failed", error };
    if (error instanceof LostReply) return { state: "unknown" };
    throw error;
  }
  const result = reply.result;
  if (result.outcome === "refused") return { state: "refused", reason: result.reason ?? "" };
  const went = { outcome: result.outcome, opensAt: result.outcome === "held" && result.opensAt !== null ? new Date(result.opensAt) : null, sentTo: reply.sentTo };
  const logged = await session.create<Activity>("activities", { deal_id: input.dealId, kind: "text", text: textActivity(input.opening(went), input.body) }, keys.activity);
  return { state: "went", ...went, logged };
}

/** The sentence for a refusal, by the server's reason. Each takes `{name}`. */
export function refusedKey(reason: string): MessageKey {
  switch (reason) {
    case "no-consent":
      return "text.r.noConsent";
    case "unconfirmed-consent":
      return "text.r.confirm";
    case "stopped":
      return "text.r.stopped";
    case "country-blocked":
    case "country-blocked-for-marketing":
      return "text.r.cn";
    case "unreadable-phone":
      return "text.r.badNumber";
    case "cannot-receive-text":
      return "text.r.cannotReceive";
    case "not-connected":
    case "no-sender":
      return "text.r.notSetUp";
    case "off-by-operator":
      return "text.r.off";
    case "daily-limit":
      return "text.r.dailyLimit";
    case "past-its-moment":
    case "no-send-window":
      return "text.r.noWindow";
    case "too-long":
      return "text.r.tooLong";
    case "asks-for-yes":
      return "text.r.yes";
    case "credential-in-template":
    case "value-has-link":
      return "text.r.link";
    case "no-opt-out-contact":
    case "opt-out-changed":
      return "text.r.optOut";
    case "promises-reply":
      return "text.r.noReplies";
    case "template-empty":
      return "text.r.empty";
    case "unfilled-placeholder":
    case "value-too-long":
      return "text.r.words";
    case "not-allowed":
      return "text.fail.forbidden";
    case "could-not-check":
    case "could-not-queue":
      return "text.r.again";
    case "earlier-send-open":
      return "text.r.open";
    default:
      return "text.r.other";
  }
}

/** The sentence for a door that said no before judging the text: 403, 404, 422 and the rest. */
export function failedWords(error: StaffError): { key: MessageKey; message?: string } {
  if (error.status === 403) return { key: "text.fail.forbidden" };
  if (error.status === 404) return { key: "text.fail.gone" };
  if (error.status === 422 && error.details["reason"] === "not-a-phone-column") return { key: "text.fail.notPhone" };
  return { key: "text.fail.refused", message: error.message };
}

// ── whether texts can go at all, and where a person stands ──────────────────

/**
 * Whether this server can send a text now (a provider and a sender saved, not
 * switched off): `GET /texts/ready`, which says nothing of the account. Null
 * when it could not be asked: the page then offers the button and lets the
 * server's answer say why a text did not go.
 */
export async function textsReady(session: Pick<StaffSession, "call">): Promise<boolean | null> {
  try {
    return (await session.call<{ data: { ready: boolean } }>("GET", "/texts/ready")).data.ready;
  } catch {
    return null;
  }
}

export const STANDING_STATES = ["yes", "no", "not-asked", "stopped", "no-phone"] as const;
export type StandingState = (typeof STANDING_STATES)[number];
export const HOWS = ["in-person", "phone", "paper", "email"] as const;
export type How = (typeof HOWS)[number];

export interface Answer {
  at: number;
  source: string;
  how: string | null;
  by: { id: string; label: string } | null;
  wordingVersion: string | null;
}
/** A person's standing for texts from THIS app, as `GET /texts/consent` answers it. */
export interface Standing {
  ready: boolean;
  masked: string | null;
  service: { state: StandingState; answer: Answer | null };
  marketing: { state: StandingState; answer: Answer | null };
  stopped: { since: number; reason: string; liftBy: "start" | "business" | "never" } | null;
}

const contactRecord = (session: Pick<StaffSession, "connectionId" | "tableId">, contactId: number) => ({ connection: session.connectionId, table: session.tableId("contacts"), row: String(contactId), column: "phone" });

export type Read<T> = { state: "ok"; value: T } | { state: "failed"; error: StaffError } | { state: "unknown" };

async function asked<T>(run: () => Promise<T>): Promise<Read<T>> {
  try {
    return { state: "ok", value: await run() };
  } catch (error) {
    if (error instanceof StaffError) return { state: "failed", error };
    if (error instanceof LostReply) return { state: "unknown" };
    throw error;
  }
}

/** Where a contact stands for this app's texts. Every read is audited by the server, so it is asked when shown, never for a list. */
export function readStanding(session: Pick<StaffSession, "call" | "connectionId" | "tableId">, contactId: number): Promise<Read<Standing>> {
  const query = new URLSearchParams(contactRecord(session, contactId)).toString();
  return asked(async () => (await session.call<{ data: Standing }>("GET", `/texts/consent?${query}`)).data);
}

/**
 * Record the yes a contact gave a member of staff (in person, on the phone, on
 * paper, by e-mail), with the words they were given and their version, or
 * their no. A yes never lifts a STOP: only the person can, by texting START.
 */
export function recordAnswer(
  session: Pick<StaffSession, "call" | "connectionId" | "tableId">,
  contactId: number,
  answer: { state: "yes"; how: How; wording: { text: string; version: string } } | { state: "no"; how: How },
): Promise<Read<Standing>> {
  return asked(async () => (await session.call<{ data: Standing }>("POST", "/texts/consent", { ...contactRecord(session, contactId), ...answer })).data);
}

/** The words a contact is read before their yes is recorded: the enquiry form's box, version 1 (`whole/manifest.json`). */
export const BOX_VERSION = "1";
