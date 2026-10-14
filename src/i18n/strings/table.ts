/**
 * An area's strings written a KEY at a time: the English, then the seven
 * translations beside it, in the order of `ORDER`. `tables` turns that into
 * what the registry takes, one table per language.
 *
 * Written this way a key cannot be given seven translations and miss the
 * eighth (the row is a tuple of eight), and a translator reads each sentence
 * next to the English it stands for.
 *
 * A plural is written `one|other` (Czech `one|few|other`, Arabic
 * `zero|one|two|few|many|other`, Chinese one form): see `PLURAL_ORDER`.
 */
import type { LocaleTag } from "../locales.ts";

export const ORDER = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "zh-CN", "zh-TW", "ar-EG"] as const satisfies readonly LocaleTag[];

export type Row = readonly [en: string, de: string, fr: string, da: string, cs: string, zhCN: string, zhTW: string, ar: string];

export function tables<const K extends string>(rows: Record<K, Row>): Record<LocaleTag, Record<K, string>> {
  const out = Object.fromEntries(ORDER.map((tag) => [tag, {} as Record<K, string>])) as Record<LocaleTag, Record<K, string>>;
  for (const key of Object.keys(rows) as K[]) ORDER.forEach((tag, i) => (out[tag][key] = rows[key][i]!));
  return out;
}
