/**
 * Vehicles and crew's own numbers on the settings row (P25): how many days
 * before a certificate runs out it is said to run out soon (Training, and the
 * crew's My certificates: ruling Q12, 42 by default), and how many before a
 * vehicle's inspection is due it is said to be due soon. Held between bounds
 * by the server (`rules.validation`, mirrored in `appsettings/data.ts`
 * `BOUNDS`). Shown on the Crews tab while the part is on; the CRM admin's to
 * write (the server refuses anybody else), every other reader's to read.
 */
import { useT } from "../../i18n/index.tsx";
import { SettingNumbers } from "../appsettings/Numbers.tsx";
import { useJobsScreen } from "../jobs/parts.tsx";

export function FleetNumbers() {
  const t = useT();
  const { session, f } = useJobsScreen();
  const slugs = (session.config.access?.roles ?? []).map((role) => role.slug).filter((slug) => slug.startsWith("crm-"));
  const can = session.can("settings", "update") && (slugs.length === 0 || slugs.includes("crm-admin"));
  return (
    <SettingNumbers
      session={session}
      f={f}
      can={can}
      name="fleet-numbers"
      title={t("hr.set.title")}
      sub={t("hr.set.sub")}
      fields={[
        { column: "certificate_warn_days", label: t("hr.set.cert"), unit: (n) => t("aset.unit.days", undefined, n) },
        { column: "inspection_warn_days", label: t("hr.set.inspection"), unit: (n) => t("aset.unit.days", undefined, n) },
      ]}
    />
  );
}
