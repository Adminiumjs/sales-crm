/**
 * AFTER THE JOB, SET UP IN SETTINGS (P24): who makes the aftercare calls a
 * signed-off job books (rule 16), and how soon each thing of the part is due.
 * A tab of Settings while the After the job part is on. The CRM admin's to
 * write (the server refuses anybody else), every other reader's to read.
 *
 * Nobody named is a choice, not a gap: the rule then gives the call to the rep
 * who sold the job (`else` on the setting). A sample person is offered only
 * while the row names them (the sample's own): a sample person cannot sign
 * in, and the rule passes over them.
 */
import { useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { Formatters } from "../../lib/format.ts";
import type { Person, StaffSession } from "../../staffSession.ts";
import { Loaded, LoadFailed, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";
import { SettingNumbers } from "../appsettings/Numbers.tsx";
import { Card, type Rights } from "../appsettings/parts.tsx";

const NOBODY = "";

export function AftercareSettings({ session, f, rights }: { session: StaffSession; f: Formatters; rights: Rights }) {
  const t = useT();
  const toasts = useToasts();
  const { load, reload } = useLoad(
    () =>
      Promise.all([
        session.list<{ id: number; aftercare_owner_id: string | null }>("settings", { select: ["id", "aftercare_owner_id"], limit: 1 }).then((page) => page.rows[0] ?? null),
        session.people(undefined, 200).catch(() => [] as Person[]),
      ]),
    [session],
  );
  const again = useCoalesced(reload);
  useLive(["settings"], again);
  const [busy, setBusy] = useState(false);
  const days = (n: number): string => t("aset.unit.days", undefined, n);

  return (
    <div role="tabpanel" aria-label={t("nav.group.aftercare")} className="crm-ast-panel crm-ast-narrow" data-panel="aftercare">
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={2} height={140} />}>
        {([row, people]) => {
          if (row === null) return <LoadFailed reload={reload} />;
          const held = row.aftercare_owner_id ?? NOBODY;
          // Who signs in, by name; the one the row names stays listed (a sample's own person too), and by "someone" when the people list no longer holds them.
          const offered = people.filter((person) => person.sample !== true || person.id === held);
          const missing = held !== NOBODY && !offered.some((person) => person.id === held);
          const can = rights.all;
          const choose = async (next: string): Promise<void> => {
            if (next === held) return;
            setBusy(true);
            await toasts.say(session.update("settings", row.id, { aftercare_owner_id: next === NOBODY ? null : next }, { seen: { aftercare_owner_id: row.aftercare_owner_id } }), () => t("ac.set.owner.saved"));
            setBusy(false);
            again();
          };
          return (
            <>
              <Card name="aftercare-owner" title={t("ac.set.owner")} sub={t("ac.set.owner.sub")}>
                <label className="crm-ast-label" htmlFor="crm-ac-owner">
                  {t("ac.set.owner")}
                </label>
                <select id="crm-ac-owner" className="crm-ast-input mr-fld" value={held} disabled={!can || busy} onChange={(event) => void choose(event.target.value)} data-testid="ac-set-owner">
                  <option value={NOBODY}>{t("ac.set.owner.none")}</option>
                  {missing && <option value={held}>{t("closed.someone")}</option>}
                  {offered.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </Card>
              <SettingNumbers
                session={session}
                f={f}
                can={can}
                name="aftercare-times"
                title={t("ac.set.times")}
                sub={t("ac.set.times.sub")}
                fields={[
                  { column: "aftercare_days", label: t("ac.set.call"), unit: days },
                  { column: "complaint_answer_days", label: t("ac.set.answer"), unit: days },
                  { column: "claim_red_days", label: t("ac.set.claim"), unit: days },
                ]}
              />
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
