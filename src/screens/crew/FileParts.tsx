/**
 * Adminium's signature pad and photo field on the crew's screens
 * (`kitParts.ts`, engine T26). Each sends its file to the file column named,
 * with the person's own session, as soon as the person keeps it, and hands
 * the screen the file's id; the screen names the ids in the one record it
 * saves.
 *
 * A part that cannot be drawn here (an Adminium with no kit) says so in its
 * place: without the pad there is no signature, so the sign-off cannot be
 * made on this phone, and the screen says that too.
 *
 * `round` going up mounts the part afresh, empty: after a refused sign-off
 * whose files were thrown away, the pad must not keep showing one.
 *
 * FILES STAY ON THE PHONE (plan 68 S19). The parts are given the offline
 * queue's `fetch`: what they "send" is kept on the phone under a `phone_…` id,
 * and the queue sends it, first, when the save naming it goes. A part's own
 * "take it out" throws the phone's copy away.
 */
import { useMemo } from "react";

import { useT } from "../../i18n/index.tsx";
import { kitCommon, mountPart } from "../../kitParts.ts";
import type { StaffConfig } from "../../staffConnection.ts";
import { useSession } from "../../session/session.tsx";
import { KitPart } from "../../ui/kit.tsx";
import { useQueue } from "./queue.tsx";

interface Target {
  connectionId: string;
  table: string;
  column: string;
  csrfToken: string;
  locale: string;
  dir: "ltr" | "rtl";
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

function useTarget(table: string, column: string): Target {
  const session = useSession();
  const config = session.config;
  const queue = useQueue();
  const held = useMemo(() => queue.fetchFor((input, init) => fetch(input, init)), [queue]);
  return useMemo(() => ({ connectionId: session.connectionId, table: session.tableId(table), column, csrfToken: config.csrfToken ?? "", ...kitCommon(config), fetch: held }), [session, config, table, column, held]);
}

/**
 * Load the two file parts once, at the start, while there is signal: a part
 * is a file of its own on the server, and a form opened later with no signal
 * (Put right on Snags) still draws its photo field.
 */
export function warmFileParts(config: StaffConfig): void {
  if (typeof document === "undefined") return;
  for (const part of ["photos", "signature"] as const) {
    const element = document.createElement("div");
    void mountPart(config, part, element, { connectionId: "", table: "", column: "", csrfToken: "", ...kitCommon(config), onChange: () => undefined, disabled: true }).then(
      (made) => made.unmount(),
      () => undefined,
    );
  }
}

function Missing() {
  const t = useT();
  return (
    <p className="crm-cw-nokit" role="status">
      {t("cw.kit.missing")}
    </p>
  );
}

export function SignaturePad({ table, column, label, round, onChange, disabled = false }: { table: string; column: string; label: string; round: number; onChange: (id: string | null) => void; disabled?: boolean }) {
  const target = useTarget(table, column);
  const props = useMemo(() => ({ ...target, label, onChange, disabled }), [target, label, onChange, disabled]);
  return <KitPart key={round} part="signature" props={props} className="crm-cw-kit" fallback={() => <Missing />} />;
}

export function PhotoField({ table, column, label, max, round, onChange, onBusy, disabled = false }: { table: string; column: string; label: string; max: number; round: number; onChange: (ids: string[]) => void; onBusy: (busy: boolean) => void; disabled?: boolean }) {
  const target = useTarget(table, column);
  const props = useMemo(() => ({ ...target, label, max, onChange, onBusy, disabled }), [target, label, max, onChange, onBusy, disabled]);
  return <KitPart key={round} part="photos" props={props} className="crm-cw-kit" fallback={() => <Missing />} />;
}
