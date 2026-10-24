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
import { accounts } from "../strings/accounts.ts";
import { appsettings } from "../strings/appsettings.ts";
import { aftersale } from "../strings/aftersale.ts";
import { aftercare } from "../strings/aftercare.ts";
import { base } from "../strings/base.ts";
import { cover } from "../strings/cover.ts";
import { customer } from "../strings/customer.ts";
import { callnotes } from "../strings/callnotes.ts";
import { finding } from "../strings/finding.ts";
import { deal } from "../strings/deal.ts";
import { inbox } from "../strings/inbox.ts";
import { own } from "../strings/own.ts";
import { quotes } from "../strings/quotes.ts";
import { selling } from "../strings/selling.ts";
import { shell } from "../strings/shell.ts";
import { supply } from "../strings/supply.ts";
import { team } from "../strings/team.ts";
import { teamwork } from "../strings/teamwork.ts";
import { territory } from "../strings/territory.ts";
import { today } from "../strings/today.ts";
import { visits } from "../strings/visits.ts";
import { showroom } from "../strings/showroom.ts";
import { jobs } from "../strings/jobs.ts";
import { crew } from "../strings/crew.ts";
import { hours } from "../strings/hours.ts";
import { fleet } from "../strings/fleet.ts";
import { offline } from "../strings/offline.ts";
import { vandays } from "../strings/vandays.ts";
import { removals } from "../strings/removals.ts";
import { scorecard } from "../strings/scorecard.ts";
import { dealrules } from "../strings/dealrules.ts";
import { guards } from "../strings/guards.ts";
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

/** One line an area: a screen group adds its own line here and to `MessageKey`, and nothing else in this file. */
const AREAS = [
  base satisfies Area<(typeof base)["en-US"]>,
  shell satisfies Area<(typeof shell)["en-US"]>,
  today satisfies Area<(typeof today)["en-US"]>,
  selling satisfies Area<(typeof selling)["en-US"]>,
  quotes satisfies Area<(typeof quotes)["en-US"]>,
  deal satisfies Area<(typeof deal)["en-US"]>,
  visits satisfies Area<(typeof visits)["en-US"]>,
  team satisfies Area<(typeof team)["en-US"]>,
  cover satisfies Area<(typeof cover)["en-US"]>,
  teamwork satisfies Area<(typeof teamwork)["en-US"]>,
  accounts satisfies Area<(typeof accounts)["en-US"]>,
  inbox satisfies Area<(typeof inbox)["en-US"]>,
  own satisfies Area<(typeof own)["en-US"]>,
  territory satisfies Area<(typeof territory)["en-US"]>,
  aftersale satisfies Area<(typeof aftersale)["en-US"]>,
  aftercare satisfies Area<(typeof aftercare)["en-US"]>,
  customer satisfies Area<(typeof customer)["en-US"]>,
  appsettings satisfies Area<(typeof appsettings)["en-US"]>,
  finding satisfies Area<(typeof finding)["en-US"]>,
  callnotes satisfies Area<(typeof callnotes)["en-US"]>,
  supply satisfies Area<(typeof supply)["en-US"]>,
  showroom satisfies Area<(typeof showroom)["en-US"]>,
  jobs satisfies Area<(typeof jobs)["en-US"]>,
  crew satisfies Area<(typeof crew)["en-US"]>,
  hours satisfies Area<(typeof hours)["en-US"]>,
  fleet satisfies Area<(typeof fleet)["en-US"]>,
  offline satisfies Area<(typeof offline)["en-US"]>,
  vandays satisfies Area<(typeof vandays)["en-US"]>,
  removals satisfies Area<(typeof removals)["en-US"]>,
  scorecard satisfies Area<(typeof scorecard)["en-US"]>,
  dealrules satisfies Area<(typeof dealrules)["en-US"]>,
  guards satisfies Area<(typeof guards)["en-US"]>,
] as const;

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
export type MessageKey =
  | keyof (typeof base)["en-US"]
  | keyof (typeof shell)["en-US"]
  | keyof (typeof today)["en-US"]
  | keyof (typeof selling)["en-US"]
  | keyof (typeof quotes)["en-US"]
  | keyof (typeof deal)["en-US"]
  | keyof (typeof visits)["en-US"]
  | keyof (typeof team)["en-US"]
  | keyof (typeof cover)["en-US"]
  | keyof (typeof teamwork)["en-US"]
  | keyof (typeof accounts)["en-US"]
  | keyof (typeof inbox)["en-US"]
  | keyof (typeof own)["en-US"]
  | keyof (typeof customer)["en-US"]
  | keyof (typeof appsettings)["en-US"]
  | keyof (typeof finding)["en-US"]
  | keyof (typeof callnotes)["en-US"]
  | keyof (typeof territory)["en-US"]
  | keyof (typeof aftersale)["en-US"]
  | keyof (typeof aftercare)["en-US"]
  | keyof (typeof supply)["en-US"]
  | keyof (typeof showroom)["en-US"]
  | keyof (typeof jobs)["en-US"]
  | keyof (typeof crew)["en-US"]
  | keyof (typeof hours)["en-US"]
  | keyof (typeof fleet)["en-US"]
  | keyof (typeof offline)["en-US"]
  | keyof (typeof vandays)["en-US"]
  | keyof (typeof removals)["en-US"]
  | keyof (typeof scorecard)["en-US"]
  | keyof (typeof dealrules)["en-US"]
  | keyof (typeof guards)["en-US"];
