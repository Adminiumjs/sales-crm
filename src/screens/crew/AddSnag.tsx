/**
 * "Add a snag", from the crew's phone: what is wrong, a photo, and (while the
 * job is not signed off) whether it stops the sign-off. Saved as one create
 * with a retry key, on the visit, so the server finds its job and its crew.
 *
 * With no signal it is kept on the phone, photo and all, and sent when the
 * signal is back (plan 68 S19); the visit lists it meanwhile as new.
 */
import { useCallback, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import { newClientKey } from "../../staffSession.ts";
import { useSession } from "../../session/session.tsx";
import { useToasts } from "../../ui/toast.tsx";
import { snagLine } from "./data.ts";
import { PhotoField } from "./FileParts.tsx";
import { useSave } from "./Offline.tsx";

export function AddSnag({ visitId, jobId, site, withStops, onDone, id }: { visitId: number; jobId: number; site: string; withStops: boolean; onDone: () => void; id: string }) {
  const t = useT();
  const session = useSession();
  const toasts = useToasts();
  const save = useSave();
  const [text, setText] = useState("");
  const [stops, setStops] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const [key, setKey] = useState(() => newClientKey());
  const canWrite = session.can("snags", "create");
  const onPhotos = useCallback((ids: string[]) => setPhoto(ids[0] ?? null), []);

  const add = async (): Promise<void> => {
    if (text.trim() === "" || sending || busy) return;
    setBusy(true);
    const done = await save(snagLine({ visitId, jobId, site, text, stops: withStops && stops, photo }, session.config.user?.id ?? null, key));
    setBusy(false);
    if (done.state === "refused") return;
    if (done.state === "sent") toasts.show(t(withStops && stops ? "cw.snag.done.stops" : "cw.snag.done", { site }), "pos");
    // Sent, or kept on the phone with its photo: the form starts again.
    setText("");
    setStops(false);
    setPhoto(null);
    setKey(newClientKey());
    setRound((n) => n + 1);
    onDone();
  };

  if (!canWrite) return null;
  return (
    <div className="crm-cw-add" data-testid="cw-add-snag">
      <label className="crm-label" htmlFor={id}>
        {t("cw.snag.add")}
      </label>
      <input
        id={id}
        className="crm-input mr-fld"
        value={text}
        maxLength={400}
        placeholder={t("cw.snag.what")}
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void add();
          }
        }}
      />
      <PhotoField table="snags" column="photo" label={t("cw.snag.photo")} max={1} round={round} onChange={onPhotos} onBusy={setSending} disabled={busy} />
      {withStops && (
        <button type="button" className="crm-cw-check mr-row" role="checkbox" aria-checked={stops} disabled={busy} onClick={() => setStops((was) => !was)}>
          <span className="crm-cw-box" aria-hidden="true">
            {stops && <Icon name="check" size={14} />}
          </span>
          <span>{t("cw.snag.stops")}</span>
        </button>
      )}
      <div className="crm-cw-add-foot">
        <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" disabled={busy || sending || text.trim() === ""} onClick={() => void add()}>
          <Icon name="plus" />
          {busy ? t("ui.saving") : t("cw.snag.go")}
        </button>
      </div>
    </div>
  );
}
