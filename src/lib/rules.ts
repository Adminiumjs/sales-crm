/**
 * WHETHER A RULE IS SWITCHED ON (ruling R7).
 *
 * Ten of the app's rules tell people (a nudge, a hand-over, the weekly
 * summaries) and ship switched off: whoever runs the install switches them
 * on in Adminium, which no role of the app may do. A screen that depends on
 * one says so from the rule's real state, never from a guess.
 *
 * Adminium answers `GET /api/v1/apps/<key>/rules` with each shipped rule's
 * key, name and whether it is on, to anybody who may open the staff side.
 * One request answers every rule, so it is asked once and kept a minute: a
 * page that shows three rules' states spends one request, and a switch
 * flipped meanwhile is seen on the next look.
 *
 * "unknown" is an answer of its own: the request failed, the server is older
 * than the route, or the app ships no rule of that key. A screen then claims
 * nothing ("set by the person who runs this install").
 */
import type { StaffSession } from "../staffSession.ts";

export type RuleState = "on" | "off" | "unknown";

/** The app's key in Adminium: its rules are asked under it. */
const APP_KEY = "crm";
const KEEP_MS = 60_000;

type Reader = Pick<StaffSession, "call">;
interface Held {
  at: number;
  rules: Promise<Record<string, boolean> | null>;
}
const held = new WeakMap<object, Held>();

async function ask(session: Reader): Promise<Record<string, boolean> | null> {
  try {
    const reply = await session.call<{ rules?: unknown }>("GET", `/apps/${APP_KEY}/rules`);
    if (reply === null || typeof reply !== "object" || !Array.isArray(reply.rules)) return null;
    const out: Record<string, boolean> = {};
    for (const rule of reply.rules as { key?: unknown; on?: unknown }[]) if (typeof rule?.key === "string" && typeof rule.on === "boolean") out[rule.key] = rule.on;
    return out;
  } catch {
    return null;
  }
}

/** Every shipped rule's state, by key; null when it could not be read. Asked once a minute for a session. */
export function ruleStates(session: Reader, now: () => number = Date.now): Promise<Record<string, boolean> | null> {
  const kept = held.get(session);
  if (kept !== undefined && now() - kept.at < KEEP_MS) return kept.rules;
  const rules = ask(session);
  held.set(session, { at: now(), rules });
  // A failed read is not kept: the next look asks again.
  void rules.then((answer) => {
    if (answer === null && held.get(session)?.rules === rules) held.delete(session);
  });
  return rules;
}

/** Whether one rule is switched on, by its key in the manifest (`nudge-quiet`, `week-rep`, `deal-handed-over`). */
export async function ruleState(session: Reader, key: string, now: () => number = Date.now): Promise<RuleState> {
  const rules = await ruleStates(session, now);
  const on = rules?.[key];
  return on === undefined ? "unknown" : on ? "on" : "off";
}
