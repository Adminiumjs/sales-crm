/**
 * SETTINGS' PAIRS (plan 68 X4): four settings the server keeps on one side of
 * another (E14), each refusal naming BOTH columns (`out-of-range` on each):
 * warm below stale, the quote's warning below its validity, the working day's
 * start before its end, the showroom's opening before its closing. A screen
 * that saves one of them says the refusal in the reader's words, naming both
 * settings; any other refusal is passed on as it came.
 */
import type { MessageKey } from "../../i18n/messages/index.ts";
import { StaffError, type Saved } from "../../staffSession.ts";

/** Each pair: the setting that stays below (or before), the one it stays below, and the sentence that names both. */
export const PAIRS: readonly (readonly [string, string, MessageKey])[] = [
  ["sitting_warm_days", "sitting_stale_days", "guards.pair.sitting"],
  ["quote_warn_days", "quote_valid_days", "guards.pair.quotes"],
  ["work_from", "work_to", "guards.pair.work"],
  ["showroom_opens", "showroom_closes", "guards.pair.showroom"],
];

/** The sentence for a refusal of the settings row: a pair both of whose columns were refused, or the depot's country. */
export function pairWords(error: StaffError): MessageKey | null {
  const fields = error.fields;
  const pair = PAIRS.find(([own, other]) => fields[own] === "out-of-range" && fields[other] === "out-of-range");
  if (pair !== undefined) return pair[2];
  if (fields["depot_country"] !== undefined && error.status === 422) return "guards.country.unknown";
  return null;
}

/** A save of the settings row with a pair's refusal said in `t`'s words; every other end as it came. */
export async function withPairWords<R>(save: Promise<Saved<R>>, t: (key: MessageKey) => string): Promise<Saved<R>> {
  const saved = await save;
  if (saved.state !== "refused") return saved;
  const key = pairWords(saved.error);
  return key === null ? saved : { state: "refused", error: new StaffError(saved.error.status, saved.error.code, t(key), saved.error.details) };
}
