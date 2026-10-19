/**
 * "Add a snag", from the crew's phone: what is wrong, a photo, and (while the
 * job is not signed off) whether it stops the sign-off. Saved as one create
 * with a retry key, on the visit, so the server finds its job and its crew.
 *
 * Without a connection the line says so and the words stay in the field.
 */
import { useCallback, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import { newClientKey } from "../../staffSession.ts";
import { useSession } from "../../session/session.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { raiseSnag } from "./data.ts";
import { PhotoField } from "./FileParts.tsx";
import type { Connection } from "./Offline.tsx";

export function AddSnag({ visitId, site, withStops, conn, onDone, id }: { visitId: number; site: string; withStops: boolean; conn: Connection; onDone: () => void; id: string }) {
  const t = useT();
  const session = useSession();
  const toasts = useToasts();
  const [text, setText] = useState("");
  const [stops, setStops] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const [key, setKey] = useState(() => newClientKey());
  const canWrite = session.can("snags", "create");
  const onPhotos = useCallback((ids: string[]) => setPhoto(ids[0] ?? null), []);

  const save = async (): Promise<boolean> => {
    if (text.trim() === "" || sending) return true;
    setBusy(true);
    const sent = await raiseSnag(session, { visitId, text, stops: withStops && stops, photo }, key);
    setBusy(false);
    if (sent.state === "offline") {
      conn.lost(save);
      return false;
    }
    conn.back();
    if (sent.state === "refused") {
      toasts.show(t("ui.refused", { reason: reasonOf(sent.error, t) }), "danger", true);
      return true;
    }
    toasts.show(t(withStops && stops ? "cw.snag.done.stops" : "cw.snag.done", { site }), "pos");
    setText("");
    setStops(false);
    setPhoto(null);
    setKey(newClientKey());
    setRound((n) => n + 1);
    onDone();
    return true;
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
            void save();
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
        <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" disabled={busy || sending || text.trim() === ""} onClick={() => void save()}>
          <Icon name="plus" />
          {busy ? t("ui.saving") : t("cw.snag.go")}
        </button>
      </div>
    </div>
  );
}
