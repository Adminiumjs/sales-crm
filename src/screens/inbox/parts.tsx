/** What the Inbox screens share: how long ago, where an enquiry came from, how keen a lead was. */
import type { TFunction } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import type { Formatters } from "../../lib/format.ts";
import { hasCompany, type Enquiry, type Source, type Warmth } from "./data.ts";

export const SOURCE_ICON: Record<Source, string> = { form: "globe", phone: "phone", show: "tent", chat: "message-square" };
export const WARM_TONE: Record<Warmth, "danger" | "warn" | "plain"> = { hot: "danger", warm: "warn", cold: "plain" };

/** "Today 08:12", "Yesterday 16:48", "4 days ago", then the date: by the server's clock, where the business is. */
export function whenOf(at: string, now: Date, f: Formatters, t: TFunction): string {
  const moment = new Date(at);
  const days = f.dayDiff(moment, now);
  if (days <= 0) return t("inbox.when.today", { time: f.time(moment) });
  if (days === 1) return t("inbox.when.yesterday", { time: f.time(moment) });
  if (days <= 30) return t("inbox.when.days", { count: f.number(days) }, days);
  return f.date(moment);
}

export const sourceLabel = (source: Source, t: TFunction): string => t(`inbox.source.${source}` as MessageKey);
/** Where an enquiry came from, as its card says it: a website form by the name its form gave it ("Website form · Showroom form"). */
export const sourceOf = (row: { source: Source; from_form?: string | null }, t: TFunction): string => {
  const form = row.from_form?.trim() ?? "";
  return row.source === "form" && form !== "" ? t("inbox.source.formNamed", { form }) : sourceLabel(row.source, t);
};
/** What an enquiry is about, as its card's headline says it: what they want, else their company; null when neither is known (a chat's question, with no company yet). */
export const subjectOf = (row: Pick<Enquiry, "wants" | "company_name">): string | null => row.wants ?? (hasCompany(row) ? row.company_name : null);
/** An enquiry's company as a screen shows it: its name, or "No company yet" for one that has none. */
export const companyText = (row: Pick<Enquiry, "company_name">, t: TFunction): string => (hasCompany(row) ? row.company_name : t("inbox.noCompany"));
/** Whom a button's label or a toast names: what the enquiry is about, else the person, else "No company yet". */
export const namedOf = (row: Pick<Enquiry, "wants" | "company_name" | "person">, t: TFunction): string => subjectOf(row) ?? row.person ?? t("inbox.noCompany");
/** The first step a deal made from an enquiry starts with: a call with the person, about what they want or their company when it is known. */
export function firstStepOf(row: Pick<Enquiry, "wants" | "company_name" | "person">, t: TFunction): string {
  const subject = subjectOf(row);
  if (subject === null) return row.person === null ? t("inbox.firstStep.plain") : t("inbox.firstStep.person", { person: row.person });
  return row.person === null ? t("inbox.firstStep.nobody", { subject }) : t("inbox.firstStep", { person: row.person, subject });
}
export const warmLabel = (warmth: Warmth, t: TFunction): string => t(`leads.warm.${warmth}` as MessageKey);

/** Two letters for a company's tile. */
export const tileOf = (name: string): string =>
  name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter((word) => word !== "")
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
