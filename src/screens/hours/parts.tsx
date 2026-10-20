/**
 * What the time sheet and training screens share: a line's hours in words, a
 * week's tone, a certificate's "days left".
 */
import { useT } from "../../i18n/index.tsx";
import type { Formatters } from "../../lib/format.ts";
import { num, type CertState, type SheetState } from "./data.ts";

/** "7 h + 1.5 h": on the job, and travel when there was some. */
export function HoursText({ f, hours, travel }: { f: Formatters; hours: unknown; travel: unknown }) {
  const t = useT();
  const on = t("hr.h", { n: f.number(num(hours)) });
  return <>{num(travel) > 0 ? t("hr.plus", { on, travel: t("hr.h", { n: f.number(num(travel)) }) }) : on}</>;
}

/** The edge colour of a week's row: signed off, sent back, waiting. */
export const sheetTone = (state: SheetState | "none"): "pos" | "warn" | "info" | undefined => (state === "signed-off" ? "pos" : state === "sent-back" ? "warn" : state === "sent" ? "info" : undefined);

/** The tone of a certificate: run out, runs out soon, in date. */
export const certTone = (state: CertState): "danger" | "warn" | undefined => (state === "out" ? "danger" : state === "soon" ? "warn" : undefined);
