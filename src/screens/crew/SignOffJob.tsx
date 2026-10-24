/**
 * SIGN OFF THE JOB, on the crew's phone (P22; the design's "Sign off the
 * job"), reached from the visit that finishes the work.
 *
 * Open: the five checks, the job's snags (and "Add a snag", one that stops the
 * sign-off or not), photos of the finished work, the customer's name and
 * their signature. "Sign off" says beside it what is still needed; while a
 * snag that stops the sign-off is open it names that snag and nothing else.
 *
 * ONE REQUEST, KEPT ON THE PHONE WITH NO SIGNAL (plan 68 S19). The signature
 * pad and the photo field keep their files on the phone; "Sign off" makes ONE
 * sign-off with a retry key, its files sent first (`data.ts`, `signOffLine`;
 * `offlineQueue.ts`). With no signal it waits on the phone, and this page
 * says it is signed on this phone and the office gets it when there is
 * signal.
 *
 * Refused (a snag that stops it was raised meanwhile, or a colleague signed
 * first), at once or when it arrives: the page says why and names the snag;
 * the five checks, the name and the photos stay on the phone for the next try
 * and the signature does not (the customer signs for what is true when they
 * sign). The office learns of a refusal for a snag from the record the phone
 * writes (`queue.tsx`).
 *
 * Signed: the sign-off as it was made, read-only (its signature and photos
 * shown from the files), and "Add a snag". Nobody changes a sign-off.
 *
 * Address: `sign-off-the-job/<visit>`.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { latest, type QueueLine } from "../../offlineQueue.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink, useNav } from "../../shell/nav.tsx";
import { NoRecord } from "../../shell/pages.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";
import { useJobsScreen } from "../jobs/parts.tsx";
import { AddSnag } from "./AddSnag.tsx";
import { CHECKS, checksOf, dayKeyOf, fileIds, fileSrc, isLive, readSignOffs, readSnags, signOffLine, stoppers, truthy, type CrewSnag, type CrewVisit, type SignOff } from "./data.ts";
import { PhotoField, SignaturePad } from "./FileParts.tsx";
import { RefusedBox, SignalLine, useReadAgainOnSignal, useSave, WaitChip } from "./Offline.tsx";
import { useHeldSrc, useQueue, useQueueLines } from "./queue.tsx";

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
  const { lines } = useQueueLines();
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
  useReadAgainOnSignal(load.state === "failed", reload);

  return (
    <div className="crm-cw mr-screen" data-screen="crewsign">
      <ScreenLink to="myday" rest={load.state === "ready" && load.data.visit !== null && dayKeyOf(load.data.visit.day) !== null ? [dayKeyOf(load.data.visit.day)!] : []} className="crm-cw-backlink mr-gi">
        <Icon name="chevron-left" size={16} className="crm-cw-flip" />
        {t("cw.day.title")}
      </ScreenLink>
      <SignalLine failed={load.state === "failed"} />
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={160} />}>
        {(data) => {
          if (data.visit === null) return <NoRecord home={{ route: "myday", item: null }} />;
          if (data.signed !== null) return <Signed visit={data.visit} signed={data.signed} snags={data.snags} onDone={again} />;
          const job = data.visit.job_id;
          const kept = latest(lines, (line) => line.kind === "sign-off" && line.meta["job"] === job);
          // Just sent, and the page not yet read again: the signed page is on its way.
          const sent = latest(lines, (line) => line.kind === "sign-off" && line.meta["job"] === job, ["sent"]);
          if (kept === undefined && sent !== undefined && sent.sentAt !== null && Date.now() - new Date(sent.sentAt).getTime() < 60_000) return <Skeleton rows={3} height={160} />;
          if (kept !== undefined && kept.state !== "refused") return <KeptSignOff visit={data.visit} line={kept} snags={data.snags} onDone={again} />;
          return <OpenSignOff key={kept?.id ?? "fresh"} visit={data.visit} snags={data.snags} refused={kept} onDone={again} f={f} />;
        }}
      </Loaded>
    </div>
  );
}

function Header({ visit, kicker, tile }: { visit: CrewVisit; kicker: string; tile?: "hourglass" }) {
  const { f } = useJobsScreen();
  const t = useT();
  const day = dayKeyOf(visit.day);
  return (
    <div className="crm-cw-sohead">
      {tile !== undefined && (
        <span className="crm-cw-done-mark" aria-hidden="true">
          <Icon name={tile} size={22} />
        </span>
      )}
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
function Signed({ visit, signed, snags, onDone }: { visit: CrewVisit; signed: SignOff; snags: CrewSnag[]; onDone: () => void }) {
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
      <CheckedList on={CHECKS.map((check) => truthy(signed[check]))} />
      <LiveSnags live={live} />
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
      <AddSnag id="crm-cw-add-signed" visitId={visit.id} jobId={visit.job_id} site={visit.site_name} withStops={false} onDone={onDone} />
      <ScreenLink to="myday" className="crm-cw-bigbtn mr-gi">
        <Icon name="sun" />
        {t("cw.sign.backToDay")}
      </ScreenLink>
    </div>
  );
}

function CheckedList({ on }: { on: readonly boolean[] }) {
  const t = useT();
  return (
    <>
      <h2 className="crm-cw-h2">{t("cw.signed.checked")}</h2>
      <ul className="crm-cw-checked">
        {CHECKS.map((check, i) => (
          <li key={check} data-on={on[i] === true ? "1" : "0"}>
            <span className="crm-cw-box" aria-hidden="true">
              {on[i] === true && <Icon name="check" size={13} />}
            </span>
            <span>{t(CHECK_WORDS[i]!)}</span>
            {on[i] !== true && <span className="crm-cw-quiet">{t("cw.signed.notTicked")}</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

function LiveSnags({ live }: { live: readonly CrewSnag[] }) {
  const t = useT();
  if (live.length === 0) return null;
  return (
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
  );
}

/** One of the phone's photos, with the button that takes it out of the next sign-off. */
function HeldPhoto({ id, n, onOut, disabled }: { id: string; n: number; onOut?: (() => void) | undefined; disabled?: boolean }) {
  const t = useT();
  const { f } = useJobsScreen();
  const src = useHeldSrc(id);
  return (
    <div className="crm-q-held-one">
      {src === null ? <span className="crm-q-photo crm-q-photo-none" aria-hidden="true" /> : <img className="crm-q-photo" src={src} alt={t("cw.signed.photoAlt", { n: f.number(n) })} />}
      {onOut !== undefined && (
        <button type="button" className="crm-q-held-out mr-gi" aria-label={t("offline.so.takeOut", { n: f.number(n) })} disabled={disabled} onClick={onOut}>
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  );
}

const lineValues = (line: QueueLine): Record<string, unknown> => (line.op.type === "act" ? (line.op.values ?? {}) : line.op.values);
const heldPhotos = (line: QueueLine | undefined): string[] => {
  const photos = line === undefined ? null : lineValues(line)["photos"];
  return Array.isArray(photos) ? photos.filter((id): id is string => typeof id === "string" && id.startsWith("phone_")) : [];
};

/** Signed on this phone, waiting for signal: what it holds, and that the office gets it when the phone has signal. */
function KeptSignOff({ visit, line, snags, onDone }: { visit: CrewVisit; line: QueueLine; snags: CrewSnag[]; onDone: () => void }) {
  const t = useT();
  const { f } = useJobsScreen();
  const values = lineValues(line);
  const made = new Date(line.madeAt);
  const photos = heldPhotos(line);
  return (
    <div className="crm-cw-done" data-testid="cw-sign-kept">
      <Header visit={visit} kicker={t("offline.so.waitingHead")} tile="hourglass" />
      <p className="crm-q-signed-box" data-testid="cw-kept-by">
        {t("offline.so.signedBy", { name: String(values["signer_name"] ?? ""), day: f.dayLong(made), time: f.time(made) })} <WaitChip line={line} />
      </p>
      <CheckedList on={checksOf(values)} />
      <LiveSnags live={snags.filter(isLive)} />
      <h2 className="crm-cw-h2">{t("cw.sign.photos")}</h2>
      {photos.length === 0 ? (
        <p className="crm-cw-quiet">{t("cw.signed.noPhotos")}</p>
      ) : (
        <div className="crm-q-held" data-testid="cw-kept-photos">
          {photos.map((id, i) => (
            <HeldPhoto key={id} id={id} n={i + 1} />
          ))}
        </div>
      )}
      <p className="crm-cw-quiet" data-testid="cw-kept-line">
        {t("offline.so.waitingLine")}
      </p>
      <AddSnag id="crm-cw-add-kept" visitId={visit.id} jobId={visit.job_id} site={visit.site_name} withStops={false} onDone={onDone} />
      <ScreenLink to="myday" className="crm-cw-bigbtn mr-gi">
        <Icon name="sun" />
        {t("cw.sign.backToDay")}
      </ScreenLink>
    </div>
  );
}

function OpenSignOff({ visit, snags, refused, onDone, f }: { visit: CrewVisit; snags: CrewSnag[]; refused: QueueLine | undefined; onDone: () => void; f: ReturnType<typeof useJobsScreen>["f"] }) {
  const t = useT();
  const nav = useNav();
  const toasts = useToasts();
  const queue = useQueue();
  const save = useSave();
  const { lines } = useQueueLines();
  // After a refusal the five checks, the name and the photos are still on the phone; the signature is not.
  const was = refused === undefined ? null : lineValues(refused);
  const [checks, setChecks] = useState<boolean[]>(() => (was === null ? CHECKS.map(() => false) : checksOf(was)));
  const [signer, setSigner] = useState(() => (was === null ? "" : String(was["signer_name"] ?? "")));
  const [held, setHeld] = useState<string[]>(() => heldPhotos(refused));
  const [signature, setSignature] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photosBusy, setPhotosBusy] = useState(false);
  const [round, setRound] = useState(0);
  const [key, setKey] = useState(() => newClientKey());
  const [busy, setBusy] = useState(false);
  const live = snags.filter(isLive);
  // A snag that stops it, as the server has it, or raised on this phone and still waiting to go.
  const waitingStop = lines.find((line) => line.kind === "snag" && line.state !== "sent" && line.state !== "refused" && line.meta["job"] === visit.job_id && line.meta["stops"] === true);
  const stop = stoppers(snags, visit.job_id)[0]?.text ?? (waitingStop === undefined ? undefined : String(waitingStop.meta["text"] ?? ""));
  const ticked = checks.filter(Boolean).length;
  const suggest = visit.ask_for !== null && visit.ask_for.trim() !== "" && signer.trim() === "" ? visit.ask_for.trim() : null;
  const max = Math.max(0, 6 - held.length);

  // Files kept on the phone and not yet named by a sign-off are thrown away when the person leaves without signing: nothing
  // else would name them. One a kept sign-off names stays (the queue answers "held").
  const pending = useRef<string[]>([]);
  pending.current = [...(signature === null ? [] : [signature]), ...photos];
  useEffect(
    () => () => {
      for (const one of pending.current) void queue.drop(one);
    },
    [queue],
  );

  const needed: string[] = [];
  if (ticked < CHECKS.length) needed.push(t("cw.sign.need.checks", { n: f.number(CHECKS.length - ticked) }, CHECKS.length - ticked));
  if (signer.trim() === "") needed.push(t("cw.sign.need.name"));
  if (signature === null) needed.push(t("cw.sign.need.signature"));
  const hint = stop !== undefined ? t("cw.sign.stopped", { snag: stop }) : photosBusy ? t("cw.sign.photosBusy") : needed.length > 0 ? t("cw.sign.needed", { list: needed.join(t("cw.sign.listJoin")) }) : t("cw.sign.ready");
  const ready = stop === undefined && !photosBusy && needed.length === 0;

  const onSignature = useCallback((id: string | null) => setSignature(id), []);
  const onPhotos = useCallback((ids: string[]) => setPhotos(ids), []);

  const press = async (): Promise<void> => {
    if (!ready || signature === null || busy) return;
    setBusy(true);
    // The customer signs for what this screen shows them: the job's open snags and the checks in these words.
    const line = signOffLine({ visitId: visit.id, jobId: visit.job_id, site: visit.site_name, checks, signer, signature, photos: [...held, ...photos], open: live, checkWords: CHECK_WORDS.map((words) => t(words)) }, key);
    const done = await save(line, { keepRefused: true });
    // The refused try this one takes over: its photos are this one's now.
    if (refused !== undefined) await queue.remove(refused.id);
    pending.current = [];
    setBusy(false);
    if (done.state === "sent") {
      setSignature(null);
      setPhotos([]);
      toasts.show(t("cw.sign.done", { site: visit.site_name }), "pos");
      onDone();
      return;
    }
    if (done.state === "refused") {
      // The page draws again from the refused line: the checks, the name and the photos kept, the signature not.
      setKey(newClientKey());
      setRound((n) => n + 1);
      onDone();
    }
  };

  const keptCount = held.length;
  return (
    <div className="crm-cw-so" data-testid="cw-sign-open">
      <Header visit={visit} kicker={t("cw.sign.title")} />

      {refused !== undefined && (
        <RefusedBox line={refused} onSnag={refused.meta["stopped"] === undefined ? undefined : () => nav.go("mysnags")}>
          <p data-testid="cw-refused-kept">{keptCount === 0 ? t("offline.so.keptNoPhotos") : t("offline.so.keptPhotos", { n: f.number(keptCount) }, keptCount)}</p>
        </RefusedBox>
      )}

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
        <AddSnag id="crm-cw-add-open" visitId={visit.id} jobId={visit.job_id} site={visit.site_name} withStops onDone={onDone} />
      </section>

      <section className="crm-cw-sec" aria-labelledby="crm-cw-photos-h" data-testid="cw-sign-photos">
        <h2 id="crm-cw-photos-h" className="crm-cw-h2">
          {t("cw.sign.photos")}
        </h2>
        <p className="crm-cw-quiet">{t("cw.sign.photos.hint")}</p>
        {held.length > 0 && (
          <div className="crm-q-held" role="group" aria-label={t("offline.so.heldPhotos")} data-testid="cw-held-photos">
            {held.map((id, i) => (
              <HeldPhoto key={id} id={id} n={i + 1} disabled={busy} onOut={() => setHeld((now) => now.filter((one) => one !== id))} />
            ))}
          </div>
        )}
        {max > 0 && <PhotoField table="sign_offs" column="photos" label={t("cw.sign.photos.label")} max={max} round={round} onChange={onPhotos} onBusy={setPhotosBusy} disabled={busy} />}
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
