/**
 * SNAGS, on the crew's phone (P22; the design's crew snag list): the snags of
 * his crew's visits, open ones first, each with its photo, its site, when it
 * is due, and "Put right", which asks what was done and a photo of it.
 *
 * The three counts are the server's, for his rows. The server holds him to
 * his crew's snags: a snag on another crew's visit is not his to read or put
 * right (`proofs/crm-crew.test.ts`).
 *
 * Address: `my-snags`.
 */
import { useCallback, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Dialog } from "../../ui/dialog.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { useJobsScreen } from "../jobs/parts.tsx";
import { dayKeyOf, discardFiles, fileSrc, isLive, putRight, readSnagCounts, readSnags, truthy, type CrewSnag, type CrewVisit, type SnagState } from "./data.ts";
import { PhotoField } from "./FileParts.tsx";
import { NoConnection, useConnection, type Connection } from "./Offline.tsx";

interface SnagData {
  snags: CrewSnag[];
  counts: Record<SnagState, number>;
  /** The visit each snag was raised on, for its site: his crew's visits only. */
  visits: Map<number, Pick<CrewVisit, "id" | "site_name" | "what" | "day">>;
}

const STATES: readonly SnagState[] = ["open", "waiting-part", "put-right"];

export function MySnags(_props: ScreenProps) {
  const t = useT();
  const { session, f, today, tick } = useJobsScreen();
  const conn = useConnection();
  const { load, reload } = useLoad<SnagData>(async () => {
    const [snags, counts] = await Promise.all([readSnags(session), readSnagCounts(session)]);
    const ids = [...new Set(snags.map((snag) => snag.visit_id).filter((id): id is number => id !== null))];
    const visits = ids.length === 0 ? [] : (await session.list<CrewVisit>("job_visits", { select: ["id", "site_name", "what", "day"], where: { column: "id", op: "in", value: ids }, limit: 200 })).rows;
    return { snags, counts, visits: new Map(visits.map((visit) => [visit.id, visit])) };
  }, [session]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["snags"], again);
  const [fixing, setFixing] = useState<CrewSnag | null>(null);
  const canFix = session.can("snags", "update");

  return (
    <div className="crm-cw mr-screen" data-screen="mysnags">
      <h1 className="crm-cw-title">{t("cw.snags.title")}</h1>
      <p className="crm-cw-quiet">{t("cw.snags.sub")}</p>
      {(conn.down || load.state === "failed") && (
        <NoConnection
          tried={conn.tried}
          busy={conn.busy}
          onRetry={() => {
            if (load.state === "failed") {
              conn.back();
              reload();
            } else conn.retry();
          }}
        />
      )}
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={120} />}>
        {(data) => (
          <>
            <div className="crm-cw-counts" data-testid="cw-snag-counts">
              {STATES.map((state) => (
                <div key={state} className="crm-cw-count mr-card" data-figure={state}>
                  <div className="crm-cw-count-value crm-mono" data-value>
                    {f.number(data.counts[state])}
                  </div>
                  <div className="crm-cw-count-label">{t(`cw.snags.count.${state}`)}</div>
                </div>
              ))}
            </div>
            {data.snags.length === 0 ? (
              <div className="crm-empty" data-testid="cw-snags-empty">
                <span className="crm-empty-icon">
                  <Icon name="check-check" size={20} />
                </span>
                <div className="crm-empty-title">{t("cw.snags.none")}</div>
                <p>{t("cw.snags.none.body")}</p>
              </div>
            ) : (
              <div className="crm-cw-snags">
                {data.snags.map((snag) => {
                  const visit = snag.visit_id === null ? undefined : data.visits.get(snag.visit_id);
                  const due = dayKeyOf(snag.due_on);
                  const live = isLive(snag);
                  const late = live && due !== null && due < today;
                  const fixed = dayKeyOf(snag.put_right_on);
                  const photo = live ? snag.photo : (snag.put_right_photo ?? snag.photo);
                  return (
                    <article key={snag.id} className="crm-cw-snag mr-card" data-snag={snag.id} data-state={snag.state}>
                      <div className="crm-cw-snag-top">
                        {photo !== null ? <img className="crm-cw-thumb" src={fileSrc(photo)} alt={t(live ? "cw.snag.photoAlt" : "cw.snag.fixedAlt", { what: snag.text })} /> : <span className="crm-cw-thumb crm-cw-thumb-none" aria-hidden="true">{t("cw.snag.noPhoto")}</span>}
                        <div className="crm-cw-snag-words">
                          <div className="crm-cw-snag-pills">
                            <span className="crm-pill" data-tone={!live ? "pos" : snag.state === "open" ? "danger" : "warn"}>
                              <Icon name={!live ? "check" : snag.state === "open" ? "circle-dot" : "truck"} size={12} />
                              {t(`jb.sg.state.${snag.state}`)}
                            </span>
                            {live && truthy(snag.stops_sign_off) && (
                              <span className="crm-pill" data-tone="danger">
                                {t("cw.snag.stopsShort")}
                              </span>
                            )}
                          </div>
                          <h2>{snag.text}</h2>
                          {visit !== undefined && (
                            <ScreenLink to="crewsign" rest={[visit.id]} className="crm-cw-joblink mr-gi">
                              {visit.site_name} · {visit.what}
                            </ScreenLink>
                          )}
                          <div className="crm-cw-quiet crm-mono" data-tone={late ? "danger" : undefined}>
                            {!live ? t("cw.snag.fixedOn", { day: fixed === null ? "" : f.dayShort(noonOf(fixed)) }) : due === null ? "" : t(late ? "cw.snag.wasDue" : "cw.snag.due", { day: f.dayShort(noonOf(due)) })}
                          </div>
                          {snag.put_right_note !== null && snag.put_right_note !== "" && <p className="crm-cw-note">{snag.put_right_note}</p>}
                        </div>
                      </div>
                      {live && canFix && (
                        <button type="button" className="crm-cw-bigbtn crm-cw-fixbtn mr-btn" onClick={() => setFixing(snag)}>
                          <Icon name="check" />
                          {t("cw.fix.open")}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            {fixing !== null && <PutRight snag={fixing} site={fixing.visit_id === null ? null : (data.visits.get(fixing.visit_id)?.site_name ?? null)} conn={conn} onClose={() => setFixing(null)} onDone={again} />}
          </>
        )}
      </Loaded>
    </div>
  );
}

/** "Put right": what was done, in a line, and a photo of it put right; both asked (D6 Q6, on the phone). */
function PutRight({ snag, site, conn, onClose, onDone }: { snag: CrewSnag; site: string | null; conn: Connection; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session } = useJobsScreen();
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lost, setLost] = useState(false);
  const onPhotos = useCallback((ids: string[]) => setPhoto(ids[0] ?? null), []);
  const hint = sending ? t("cw.fix.sending") : photo === null && note.trim() === "" ? t("cw.fix.need.both") : photo === null ? t("cw.fix.need.photo") : note.trim() === "" ? t("cw.fix.need.note") : t("cw.fix.ready");
  const ready = photo !== null && note.trim() !== "" && !sending;
  // A photo kept and never named by the snag is thrown away when the sheet is closed: nothing else would name it.
  const close = (): void => {
    if (photo !== null) void discardFiles(session, [photo]);
    onClose();
  };
  const save = async (): Promise<boolean> => {
    if (!ready || busy || photo === null) return true;
    setBusy(true);
    const sent = await putRight(session, snag, note, photo);
    setBusy(false);
    if (sent.state === "offline") {
      setLost(true);
      conn.lost(save);
      return false;
    }
    setLost(false);
    conn.back();
    if (sent.state === "refused") {
      toasts.show(t("ui.refused", { reason: reasonOf(sent.error, t) }), "danger", true);
      return true;
    }
    toasts.show(t("cw.fix.done", { what: snag.text }), "pos");
    onDone();
    onClose();
    return true;
  };
  return (
    <Dialog
      shape="box"
      icon="check"
      tone="accent"
      title={t("cw.fix.title")}
      subtitle={[snag.text, site].filter((part) => part !== null && part !== "").join(" · ")}
      onClose={close}
      busy={busy}
      name="cw-put-right"
      foot={
        <>
          <span className="crm-cw-hint" role="status" aria-live="polite">
            {lost ? t("cw.offline") : hint}
          </span>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" disabled={!ready || busy} onClick={() => void save()}>
            <Icon name="check" />
            {busy ? t("ui.saving") : t("cw.fix.go")}
          </button>
        </>
      }
    >
      <PhotoField table="snags" column="put_right_photo" label={t("cw.fix.photo")} max={1} round={0} onChange={onPhotos} onBusy={setSending} disabled={busy} />
      <label className="crm-label" htmlFor="crm-cw-fix-note">
        {t("cw.fix.what")}
      </label>
      <textarea id="crm-cw-fix-note" className="crm-input crm-cw-textarea mr-fld" rows={3} maxLength={400} value={note} placeholder={t("cw.fix.what.hint")} disabled={busy} onChange={(event) => setNote(event.target.value)} />
    </Dialog>
  );
}
