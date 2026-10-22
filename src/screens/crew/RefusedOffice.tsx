/**
 * A SIGN-OFF REFUSED ON ARRIVAL, as the office reads it (plan 68 S19, the
 * design's office "Refused on arrival"). The crew's phone writes the record
 * when the refusal comes back (`queue.tsx`); it says who signed and when, on
 * whose phone, when it reached the server, and the snag that stopped it. It
 * holds no checks, no photos and no signature. It stands until the job has a
 * sign-off.
 */
import { useCallback, useEffect, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { Formatters } from "../../lib/format.ts";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import type { Row, StaffSession } from "../../staffSession.ts";
import { useLive } from "../../ui/load.tsx";

export interface RefusedSignOff extends Row {
  id: number;
  job_id: number;
  visit_id: number;
  signer_name: string;
  signed_at: string;
  reached_at: string;
  by_id: string;
  snag_id: number;
  snag_text: string | null;
  snag_by_id: string | null;
  snag_raised_at: string | null;
  snag_raised_on: string | null;
}

/** The newest refused sign-off of each job, and each by its own id: none for a reader who may not read them. */
export function useRefusals(session: StaffSession): { of: (job: number) => RefusedSignOff | undefined; byId: (id: number) => RefusedSignOff | undefined } {
  const [rows, setRows] = useState<RefusedSignOff[]>([]);
  const [round, setRound] = useState(0);
  const readable = session.can("refused_sign_offs", "read");
  useEffect(() => {
    if (!readable) return;
    let gone = false;
    session
      .list<RefusedSignOff>("refused_sign_offs", { order: ["reached_at.desc", "id.desc"], limit: 200 })
      .then((page) => !gone && setRows(page.rows))
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [session, readable, round]);
  useLive(readable ? ["refused_sign_offs"] : [], useCallback(() => setRound((n) => n + 1), []));
  const of = useCallback((job: number) => rows.find((row) => Number(row.job_id) === job), [rows]);
  const byId = useCallback((id: number) => rows.find((row) => Number(row.id) === id), [rows]);
  return { of, byId };
}

const at = (f: Formatters, iso: string | null): string => (iso === null ? "" : `${f.dayShort(new Date(iso))}, ${f.time(new Date(iso))}`);

/** The danger box on the office's Sign-off: what was refused, why, and what to do. */
export function RefusedOnArrival({ record, names, f, onOpenSnag }: { record: RefusedSignOff; names: Record<string, string>; f: Formatters; onOpenSnag?: (() => void) | undefined }) {
  const t = useT();
  const raised = record.snag_raised_at !== null ? at(f, record.snag_raised_at) : record.snag_raised_on !== null ? f.dayShort(noonOf(String(record.snag_raised_on).slice(0, 10))) : "";
  const who = record.snag_by_id === null ? undefined : names[record.snag_by_id];
  const words = { signer: record.signer_name, member: names[record.by_id] ?? "—", signed: at(f, record.signed_at), reached: at(f, record.reached_at), snag: record.snag_text ?? "", raised };
  return (
    <div className="crm-q-office" role="alert" data-testid="jb-so-refused">
      <Icon name="circle-x" size={17} />
      <div className="crm-q-office-words">
        <p>{who === undefined ? t("offline.office.lineNobody", words) : t("offline.office.line", { ...words, who })}</p>
        <p>{t("offline.office.todo")}</p>
        {onOpenSnag !== undefined && (
          <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" onClick={onOpenSnag}>
            <Icon name="wrench" size={13} />
            {t("offline.office.open")}
          </button>
        )}
        <p className="crm-jb-quiet">{t("offline.office.noSignature")}</p>
      </div>
    </div>
  );
}
