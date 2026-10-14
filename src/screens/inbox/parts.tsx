/** What the Inbox screens share: how long ago, where an enquiry came from, how keen a lead was. */
import type { TFunction } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import type { Formatters } from "../../lib/format.ts";
import type { Source, Warmth } from "./data.ts";

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
