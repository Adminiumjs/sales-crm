/**
 * The message registry.
 *
 * The app's strings are split across area modules under `../strings/` so they
 * can be authored without one enormous file. This module is the only place
 * that knows they are separate: it flattens them into one bundle per locale,
 * which is what the runtime looks keys up in.
 *
 * Keys must be unique across areas — a later area silently wins a collision,
 * so namespace them (`base.*`).
 */
import type { Translated } from "../untranslated.ts";
import { LOCALE_TAGS, type LocaleTag } from "../locales.ts";
import { base } from "../strings/base.ts";
import { customer } from "../strings/customer.ts";
import { quotes } from "../strings/quotes.ts";
import { selling } from "../strings/selling.ts";
import { shell } from "../strings/shell.ts";
import { today } from "../strings/today.ts";
import { visits } from "../strings/visits.ts";
import { SURFACE_SIDE } from "../../surface.ts";

/**
 * Parity guard. `en-US` defines the keys; the other seven must each carry a
 * string for every one of them. A translation module that is missing an English
 * key is a COMPILE error here rather than a silent per-key fallback to English
 * at runtime — which is the failure mode this whole layer exists to prevent.
 */
type Area<EN extends Record<string, string>> = { "en-US": EN } & Record<
  Exclude<LocaleTag, "en-US">,
  Translated<EN>
>;

const AREAS: [Area<(typeof base)["en-US"]>, Area<(typeof shell)["en-US"]>, Area<(typeof today)["en-US"]>, Area<(typeof selling)["en-US"]>, Area<(typeof quotes)["en-US"]>, Area<(typeof visits)["en-US"]>, Area<(typeof customer)["en-US"]>] = [base, shell, today, selling, quotes, visits, customer];

/**
 * The customer side is one page: it ships its own strings and the few shared
 * ones, not the staff screens'. `SURFACE_SIDE` folds at build time, so the
 * tables left out here are not in that bundle at all.
 */
const SHIPPED: readonly Partial<Record<LocaleTag, Record<string, string>>>[] = SURFACE_SIDE === "customer" ? [base, customer] : AREAS;

export const MESSAGES = Object.fromEntries(
  LOCALE_TAGS.map((t) => [t, Object.assign({}, ...SHIPPED.map((a) => a[t] ?? {}))]),
) as Record<LocaleTag, Record<string, string>>;

/** Keys are typed off English — the source of truth — so a typo is a compile error. */
export type MessageKey = keyof (typeof base)["en-US"] | keyof (typeof shell)["en-US"] | keyof (typeof today)["en-US"] | keyof (typeof selling)["en-US"] | keyof (typeof quotes)["en-US"] | keyof (typeof visits)["en-US"] | keyof (typeof customer)["en-US"];
