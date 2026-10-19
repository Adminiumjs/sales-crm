/**
 * SIGN OFF THE JOB, on the crew's phone (P22; the design's "Sign off the
 * job"), reached from the visit that finishes the work.
 *
 * Open: the five checks, the job's snags (and "Add a snag", one that stops the
 * sign-off or not), photos of the finished work, the customer's name and
 * their signature. "Sign off" says beside it what is still needed; while a
 * snag that stops the sign-off is open it names that snag and nothing else.
 *
 * ONE REQUEST. The signature pad and the photo field send their files as the
 * person keeps each; "Sign off" then makes ONE sign-off with a retry key
 * (`data.ts`, `signOff`). A lost reply is sent again with the same key and
 * answers the row the first one made. Refused (a snag that stops it was
 * raised meanwhile, or a colleague signed first), the files are thrown away
 * and the screen says why and which snag; the customer signs again.
 *
 * Signed: the sign-off as it was made, read-only (its signature and photos
 * shown from the files), and "Add a snag". Nobody changes a sign-off.
 *
 * Address: `sign-off-the-job/<visit>`.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { NoRecord } from "../../shell/pages.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { useJobsScreen } from "../jobs/parts.tsx";
import { AddSnag } from "./AddSnag.tsx";
import { CHECKS, dayKeyOf, discardFiles, fileIds, fileSrc, isLive, readSignOffs, readSnags, signOff, stoppers, truthy, type CrewSnag, type CrewVisit, type SignOff } from "./data.ts";
import { PhotoField, SignaturePad } from "./FileParts.tsx";
import { NoConnection, useConnection, type Connection } from "./Offline.tsx";

/** The five checks' words: the office's own (P20), in the order the columns are. */
const CHECK_WORDS: readonly MessageKey[] = ["jb.check.count", "jb.check.damage", "jb.check.keys", "jb.check.clean", "jb.check.show"];

interface JobData {
  visit: CrewVisit | null;
  snags: CrewSnag[];
  signed: SignOff | null;
}

export function SignOffJob({ rest }: ScreenProps) {
  const t = useT();
  const { session, f, tick } = useJobsScreen();
  const conn = useConnection();
  const id = rest[0] !== undefined && /^\d{1,15}$/.test(rest[0]) ? Number(rest[0]) : null;
  const { load, reload } = useLoad<JobData>(async () => {
    if (id === null) return { visit: null, snags: [], signed: null };
    const visit = await session.get<CrewVisit>("job_visits", id);
    if (visit === null) return { visit: null, snags: [], signed: null };
    const [snags, signed] = await Promise.all([readSnags(session, [visit.job_id]), readSignOffs(session, [visit.job_id])]);
    return { visit, snags, signed: signed.get(visit.job_id) ?? null };
  }, [session, id]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["snags", "sign_offs", "job_visits"], again);

  return (
    <div className="crm-cw mr-screen" data-screen="crewsign">
      <ScreenLink to="myday" rest={load.state === "ready" && load.data.visit !== null && dayKeyOf(load.data.visit.day) !== null ? [dayKeyOf(load.data.visit.day)!] : []} className="crm-cw-backlink mr-gi">
        <Icon name="chevron-left" size={16} className="crm-cw-flip" />
        {t("cw.day.title")}
      </ScreenLink>
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
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={160} />}>
        {(data) =>
          data.visit === null ? (
            <NoRecord home={{ route: "myday", item: null }} />
          ) : data.signed !== null ? (
            <Signed visit={data.visit} signed={data.signed} snags={data.snags} conn={conn} onDone={again} />
          ) : (
            <OpenSignOff visit={data.visit} snags={data.snags} conn={conn} onDone={again} f={f} />
          )
        }
      </Loaded>
    </div>
  );
}

function Header({ visit, kicker }: { visit: CrewVisit; kicker: string }) {
  const { f } = useJobsScreen();
  const t = useT();
  const day = dayKeyOf(visit.day);
  return (
    <div className="crm-cw-sohead">
      <div className="crm-cw-kicker">{kicker}</div>
      <h1>{visit.site_name}</h1>
      <div className="crm-cw-quiet">
        {visit.what}
        {day !== null && <span className="crm-mono"> · {t("cw.sign.visitDay", { day: f.dayShort(new Date(`${day}T12:00:00Z`)) })}</span>}
      </div>
    </div>
  );
}

/** A sign-off as it was made: read, never changed. */
function Signed({ visit, signed, snags, conn, onDone }: { visit: CrewVisit; signed: SignOff; snags: CrewSnag[]; conn: Connection; onDone: () => void }) {
  const t = useT();
  const { f } = useJobsScreen();
  const signature = fileIds(signed.signature)[0] ?? null;
  const photos = fileIds(signed.photos);
  const live = snags.filter(isLive);
  return (
    <div className="crm-cw-done" data-testid="cw-signed-page">
      <span className="crm-cw-done-mark" aria-hidden="true">
        <Icon name="check-check" size={22} />
      </span>
      <Header visit={visit} kicker={t("cw.signed.title")} />
      <p className="crm-cw-done-line" data-testid="cw-signed-by">
        {t("cw.signed.by", { name: signed.signer_name, day: f.dayLong(new Date(signed.signed_at)) })}
      </p>
      {signature !== null ? (
        <img className="crm-cw-sigimg" src={fileSrc(signature)} alt={t("cw.signed.sigAlt", { name: signed.signer_name })} data-testid="cw-signature" />
      ) : (
        <p className="crm-cw-quiet" data-testid="cw-no-signature">
          {t("cw.signed.noSignature")}
        </p>
      )}
      <h2 className="crm-cw-h2">{t("cw.signed.checked")}</h2>
      <ul className="crm-cw-checked">
        {CHECKS.map((check, i) => (
          <li key={check} data-on={truthy(signed[check]) ? "1" : "0"}>
            <span className="crm-cw-box" aria-hidden="true">
              {truthy(signed[check]) && <Icon name="check" size={13} />}
            </span>
            <span>{t(CHECK_WORDS[i]!)}</span>
            {!truthy(signed[check]) && <span className="crm-cw-quiet">{t("cw.signed.notTicked")}</span>}
          </li>
        ))}
      </ul>
      {live.length > 0 && (
        <>
          <h2 className="crm-cw-h2">{t("cw.signed.live")}</h2>
          <ul className="crm-cw-snaglist">
            {live.map((snag) => (
              <li key={snag.id}>
                <span>{snag.text}</span>
                <span className="crm-cw-quiet">{t(`jb.sg.state.${snag.state}`)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h2 className="crm-cw-h2">{t("cw.sign.photos")}</h2>
      {photos.length === 0 ? (
        <p className="crm-cw-quiet">{t("cw.signed.noPhotos")}</p>
      ) : (
        <div className="crm-cw-photos" data-testid="cw-photos">
          {photos.map((photo, i) => (
            <img key={photo} src={fileSrc(photo)} alt={t("cw.signed.photoAlt", { n: f.number(i + 1) })} />
          ))}
        </div>
      )}
      <AddSnag id="crm-cw-add-signed" visitId={visit.id} site={visit.site_name} withStops={false} conn={conn} onDone={onDone} />
      <ScreenLink to="myday" className="crm-cw-bigbtn mr-gi">
        <Icon name="sun" />
        {t("cw.sign.backToDay")}
      </ScreenLink>
    </div>
  );
}

type Outcome = { kind: "snag"; snag: string | null } | { kind: "signed" } | { kind: "other"; reason: string } | null;

function OpenSignOff({ visit, snags, conn, onDone, f }: { visit: CrewVisit; snags: CrewSnag[]; conn: Connection; onDone: () => void; f: ReturnType<typeof useJobsScreen>["f"] }) {
  const t = useT();
  const toasts = useToasts();
  const { session } = useJobsScreen();
  const [checks, setChecks] = useState<boolean[]>(() => CHECKS.map(() => false));
  const [signer, setSigner] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photosBusy, setPhotosBusy] = useState(false);
  const [round, setRound] = useState(0);
  const [key, setKey] = useState(() => newClientKey());
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const live = snags.filter(isLive);
  const stop = stoppers(snags, visit.job_id)[0];
  const ticked = checks.filter(Boolean).length;
  const suggest = visit.ask_for !== null && visit.ask_for.trim() !== "" && signer.trim() === "" ? visit.ask_for.trim() : null;

  // Files kept and not yet named by a sign-off are thrown away when the person leaves without signing: nothing else would name them.
  const pending = useRef<string[]>([]);
  pending.current = [...(signature === null ? [] : [signature]), ...photos];
  useEffect(
    () => () => {
      if (pending.current.length > 0) void discardFiles(session, pending.current);
    },
    [session],
  );

  const needed: string[] = [];
  if (ticked < CHECKS.length) needed.push(t("cw.sign.need.checks", { n: f.number(CHECKS.length - ticked) }, CHECKS.length - ticked));
  if (signer.trim() === "") needed.push(t("cw.sign.need.name"));
  if (signature === null) needed.push(t("cw.sign.need.signature"));
  const hint = stop !== undefined ? t("cw.sign.stopped", { snag: stop.text }) : photosBusy ? t("cw.sign.photosBusy") : needed.length > 0 ? t("cw.sign.needed", { list: needed.join(t("cw.sign.listJoin")) }) : t("cw.sign.ready");
  const ready = stop === undefined && !photosBusy && needed.length === 0;

  const onSignature = useCallback((id: string | null) => {
    setSignature(id);
    setOutcome(null);
  }, []);
  const onPhotos = useCallback((ids: string[]) => setPhotos(ids), []);

  const press = async (): Promise<boolean> => {
    if (!ready || signature === null || busy) return true;
    setBusy(true);
    setOutcome(null);
    const done = await signOff(session, { visitId: visit.id, checks, signer, signature, photos }, key);
    setBusy(false);
    if (done.state === "offline") {
      // Kept as typed, the files and the key with it: "Try again" sends the same sign-off.
      conn.lost(press);
      return false;
    }
    conn.back();
    if (done.state === "signed") {
      pending.current = [];
      setSignature(null);
      setPhotos([]);
      toasts.show(t("cw.sign.done", { site: visit.site_name }), "pos");
      onDone();
      return true;
    }
    // Refused: the files were thrown away. The pad and the field start again, empty; a new key for the next try.
    setSignature(null);
    setPhotos([]);
    setRound((n) => n + 1);
    setKey(newClientKey());
    if (done.why === "snag") {
      const fresh = await readSnags(session, [visit.job_id]).catch(() => snags);
      setOutcome({ kind: "snag", snag: stoppers(fresh, visit.job_id)[0]?.text ?? null });
    } else if (done.why === "signed") setOutcome({ kind: "signed" });
    else setOutcome({ kind: "other", reason: reasonOf(done.error, t) });
    onDone();
    return true;
  };

  return (
    <div className="crm-cw-so" data-testid="cw-sign-open">
      <Header visit={visit} kicker={t("cw.sign.title")} />

      <section className="crm-cw-sec" aria-labelledby="crm-cw-checks-h">
        <div className="crm-cw-sec-head">
          <h2 id="crm-cw-checks-h" className="crm-cw-h2">
            {t("cw.sign.checks")}
          </h2>
          <span className="crm-cw-quiet crm-mono">{t("cw.sign.checks.of", { n: f.number(ticked), all: f.number(CHECKS.length) })}</span>
        </div>
        <div className="crm-cw-checks">
          {CHECKS.map((check, i) => (
            <button key={check} type="button" className="crm-cw-check mr-row" role="checkbox" aria-checked={checks[i] === true} data-check={check} disabled={busy} onClick={() => setChecks((was) => was.map((on, j) => (j === i ? !on : on)))}>
              <span className="crm-cw-box" aria-hidden="true">
                {checks[i] === true && <Icon name="check" size={14} />}
              </span>
              <span>{t(CHECK_WORDS[i]!)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="crm-cw-sec" aria-labelledby="crm-cw-snags-h" data-testid="cw-sign-snags">
        <div className="crm-cw-sec-head">
          <h2 id="crm-cw-snags-h" className="crm-cw-h2">
            {t("cw.visit.snags")}
          </h2>
          <span className="crm-cw-quiet crm-mono">{t("cw.sign.snags.count", { all: f.number(snags.length), live: f.number(live.length) })}</span>
        </div>
        {snags.length > 0 && (
          <ul className="crm-cw-snaglist">
            {snags.map((snag) => (
              <li key={snag.id} data-snag={snag.id} data-stops={isLive(snag) && truthy(snag.stops_sign_off) ? "1" : "0"}>
                <span>{snag.text}</span>
                <span className="crm-cw-quiet">
                  {t(`jb.sg.state.${snag.state}`)}
                  {isLive(snag) && truthy(snag.stops_sign_off) && ` · ${t("cw.snag.stopsShort")}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <AddSnag id="crm-cw-add-open" visitId={visit.id} site={visit.site_name} withStops conn={conn} onDone={onDone} />
      </section>

      <section className="crm-cw-sec" aria-labelledby="crm-cw-photos-h" data-testid="cw-sign-photos">
        <h2 id="crm-cw-photos-h" className="crm-cw-h2">
          {t("cw.sign.photos")}
        </h2>
        <p className="crm-cw-quiet">{t("cw.sign.photos.hint")}</p>
        <PhotoField table="sign_offs" column="photos" label={t("cw.sign.photos.label")} max={6} round={round} onChange={onPhotos} onBusy={setPhotosBusy} disabled={busy} />
      </section>

      <section className="crm-cw-sec" aria-labelledby="crm-cw-customer-h" data-testid="cw-sign-customer">
        <h2 id="crm-cw-customer-h" className="crm-cw-h2">
          {t("cw.sign.customer")}
        </h2>
        <label className="crm-label" htmlFor="crm-cw-signer">
          {t("cw.sign.name")}
        </label>
        <input id="crm-cw-signer" className="crm-input mr-fld" value={signer} maxLength={120} autoComplete="off" placeholder={t("cw.sign.name.hint")} disabled={busy} onChange={(event) => setSigner(event.target.value)} />
        {suggest !== null && (
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-40 crm-cw-suggest mr-gi" onClick={() => setSigner(suggest)}>
            <Icon name="user-round-check" />
            {t("cw.sign.use", { name: suggest })}
          </button>
        )}
        <SignaturePad table="sign_offs" column="signature" label={t("cw.sign.signature")} round={round} onChange={onSignature} disabled={busy} />
      </section>

      {outcome !== null && (
        <div className="crm-cw-refused" role="alert" data-testid="cw-refused">
          <Icon name="circle-alert" size={16} />
          <span>
            {outcome.kind === "snag" ? (outcome.snag === null ? t("cw.sign.refused.snagAny") : t("cw.sign.refused.snag", { snag: outcome.snag })) : outcome.kind === "signed" ? t("cw.sign.refused.signed") : t("ui.refused", { reason: outcome.reason })}{" "}
            {t("cw.sign.refused.files")}
          </span>
        </div>
      )}

      <div className="crm-cw-signfoot">
        <button type="button" className="crm-cw-signbtn mr-btn" disabled={!ready || busy} onClick={() => void press()} data-testid="cw-sign-go">
          <Icon name="clipboard-check" />
          {busy ? t("ui.saving") : t("cw.sign.go")}
        </button>
        <span className="crm-cw-hint" role="status" aria-live="polite" data-testid="cw-sign-hint">
          {hint}
        </span>
      </div>
    </div>
  );
}
