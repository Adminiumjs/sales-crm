/**
 * SIGN-OFF, THE OFFICE'S VIEW (ledger screen 44, at a desk): every job, signed
 * or not; for the one picked, the five checks, its snags, who signed and when,
 * and the signature the crew's phone took.
 *
 * WHAT IS NOT HERE. Signing a job off is the crew's, on the phone, with the
 * customer's drawn signature and the photos of the finished work: those are
 * files on a row (engine task T26), which this install does not have yet, so
 * the office signs nothing here and the screen says so. A sign-off once made
 * is never changed, by anybody (F19): a correction would be a new one that
 * names it, and the newest stands.
 *
 * What the office does here: adds a snag (one that stops the sign-off or not),
 * and keeps a job's site (`SiteDialog`). Addresses: `sign-off/<job>`, and
 * `sign-off/refused/<record>` from the bell (a sign-off refused on arrival,
 * plan 68 S19: `crew/RefusedOffice.tsx`).
 */
import { useCallback, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { useNav } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey, type Condition } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";
import { CHECKS, crewPeople, dayKeyOf, num, readJobs, readSignOffs, readSnags, readSnagsByJob, signatureSrc, truthy, type CrewFacts, type Job, type SignOff, type Snag, type Visit, VISIT_LOOKUPS } from "./data.ts";
import { hoursOf, useCrewFacts, useJobsScreen } from "./parts.tsx";
import { SiteDialog } from "./SiteDialog.tsx";
import { RefusedOnArrival, useRefusals, type RefusedSignOff } from "../crew/RefusedOffice.tsx";
import { usePeopleNames } from "../crew/queue.tsx";

interface SignData {
  jobs: Job[];
  signed: Map<number, SignOff>;
  snags: Snag[];
  byJob: Record<string, { all: number; live: number }>;
  installs: Visit[];
  /** Jobs in all, signed off, and not yet: each the server's count. */
  states: { all: number; signed: number; open: number };
}

export function SignOffScreen({ rest }: ScreenProps) {
  const t = useT();
  const nav = useNav();
  const { session, f, tick } = useJobsScreen();
  const { load: facts, reload: reloadFacts } = useCrewFacts(session);
  const { load, reload } = useLoad<SignData>(
    () =>
      Promise.all([
        readJobs(session),
        readSignOffs(session),
        readSnags(session),
        readSnagsByJob(session),
        session.list<Visit>("job_visits", { where: { column: "kind", op: "eq", value: "install" }, lookup: VISIT_LOOKUPS, order: ["day.desc"], limit: 200 }).then((page) => page.rows),
        Promise.all([[], [{ column: "state", op: "eq", value: "signed-off" }], [{ column: "state", op: "neq", value: "signed-off" }]].map((filters) =>
          session.figure<{ value?: number | null }>({ table: "jobs", shape: "single-metric", filters: filters as Condition[], aggregations: [{ fn: "count", alias: "n" }] }).then((answer) => num(answer.value)),
        )),
      ]).then(([jobs, signed, snags, byJob, installs, [all, signedN, open]]) => ({ jobs, signed, snags, byJob, installs, states: { all: all ?? 0, signed: signedN ?? 0, open: open ?? 0 } })),
    [session],
  );
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["jobs", "sign_offs", "snags", "job_visits"], again);
  const [site, setSite] = useState<Job | null>(null);
  const refusals = useRefusals(session);

  return (
    <div className="crm-screen crm-jb mr-screen" data-screen="signoff">
      <Loaded load={facts} reload={reloadFacts} skeleton={<Skeleton rows={3} height={140} />}>
        {(crews) => (
          <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={140} />}>
            {(data) => {
              const installOf = (jobId: number): Visit | undefined => data.installs.find((visit) => visit.job_id === jobId);
              // Newest install first; a job not signed off yet is picked first.
              const order = [...data.jobs].sort((a, b) => (dayKeyOf(installOf(b.id)?.day) ?? "").localeCompare(dayKeyOf(installOf(a.id)?.day) ?? "") || b.id - a.id);
              // From the bell, a refused sign-off's record: its job.
              const asked = rest[0] === "refused" && rest[1] !== undefined && /^\d+$/.test(rest[1]) ? (refusals.byId(Number(rest[1]))?.job_id ?? null) : rest[0] !== undefined && /^\d+$/.test(rest[0]) ? Number(rest[0]) : null;
              const job = order.find((one) => one.id === asked) ?? order.find((one) => !data.signed.has(one.id)) ?? order[0];
              return (
                <>
                  <div className="crm-screen-head">
                    <div>
                      <h1>{t("jb.so.title")}</h1>
                      <p className="crm-screen-sub crm-jb-lead">{t("jb.so.sub")}</p>
                    </div>
                    <span className="crm-pill" data-tone={data.states.open > 0 ? "warn" : "pos"} data-testid="jb-so-line">
                      <Icon name="clipboard-check" size={14} />
                      {t("jb.so.line", { all: f.number(data.states.all), signed: f.number(data.states.signed), open: f.number(data.states.open) })}
                    </span>
                  </div>
                  <div className="crm-chips crm-jb-picker" role="group" aria-label={t("jb.so.which")}>
                    {order.map((one) => {
                      const on = installOf(one.id);
                      return (
                        <button key={one.id} type="button" className="crm-chip-btn mr-chip" aria-pressed={job?.id === one.id} data-job={one.id} onClick={() => nav.replace("signoff", one.id)}>
                          <span className="crm-jb-dot" data-tone={data.signed.has(one.id) ? "pos" : "warn"} aria-hidden="true" />
                          {[one.code, one.site_name].filter((part) => part !== null).join(" · ")}
                          {dayKeyOf(on?.day) !== null && <span className="crm-mono crm-jb-quiet">{f.dayShort(noonOf(dayKeyOf(on?.day)!))}</span>}
                        </button>
                      );
                    })}
                  </div>
                  {job === undefined ? (
                    <div className="crm-empty">
                      <span className="crm-empty-icon">
                        <Icon name="clipboard-check" size={20} />
                      </span>
                      <div className="crm-empty-title">{t("jb.so.none")}</div>
                      <p>{t("jb.so.none.body")}</p>
                    </div>
                  ) : (
                    <div className="crm-jb-so">
                      <JobSignOff job={job} install={installOf(job.id)} signOff={data.signed.get(job.id) ?? null} refused={data.signed.has(job.id) ? undefined : refusals.of(job.id)} snags={data.snags.filter((snag) => snag.job_id === job.id)} counts={data.byJob[String(job.id)] ?? { all: 0, live: 0 }} crews={crews} onDone={again} />
                      <aside className="crm-jb-so-side">
                        <section className="crm-jb-panel" aria-labelledby="crm-jb-ask-h">
                          <h2 id="crm-jb-ask-h" className="crm-jb-fact-head">
                            {t("jb.so.ask")}
                          </h2>
                          <div className="crm-jb-ask">
                            <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                              {(job.ask_for ?? "?").slice(0, 1)}
                            </span>
                            <div>
                              <div>{job.ask_for ?? t("jb.ds.nobodyNamed")}</div>
                              {job.site_phone !== null && job.site_phone !== "" && (
                                <a className="crm-mono crm-jb-quiet" href={`tel:${job.site_phone.replace(/[^\d+]/g, "")}`} dir="ltr">
                                  {job.site_phone}
                                </a>
                              )}
                            </div>
                          </div>
                          <div className="crm-jb-quiet">{[job.address_lines, job.town].filter((part) => part !== null && part !== "").join(", ") || t("jb.ds.noAddress")}</div>
                          {session.can("jobs", "update") && (
                            <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-testid="jb-site-edit" onClick={() => setSite(job)}>
                              <Icon name="pencil" size={13} />
                              {t("jb.site.edit")}
                            </button>
                          )}
                        </section>
                        <section className="crm-jb-panel" aria-labelledby="crm-jb-others-h">
                          <h2 id="crm-jb-others-h" className="crm-jb-fact-head">
                            {t("jb.so.others")}
                          </h2>
                          <ul className="crm-jb-others">
                            {order
                              .filter((one) => one.id !== job.id)
                              .map((one) => {
                                const counts = data.byJob[String(one.id)] ?? { all: 0, live: 0 };
                                return (
                                  <li key={one.id}>
                                    <button type="button" className="crm-jb-other mr-gi" data-job={one.id} onClick={() => nav.replace("signoff", one.id)}>
                                      <span className="crm-jb-other-words">
                                        <strong>{[one.code, one.title].filter((part) => part !== null).join(" · ")}</strong>
                                        <span className="crm-jb-quiet">
                                          {one.site_name} · {counts.all === 0 ? t("jb.so.snags.none") : t("jb.so.snags.count", { all: f.number(counts.all), live: f.number(counts.live) }, counts.all)}
                                        </span>
                                      </span>
                                      {!data.signed.has(one.id) && refusals.of(one.id) !== undefined ? (
                                        <span className="crm-pill" data-tone="danger" data-testid="jb-so-other-refused">
                                          {t("offline.state.refused")}
                                        </span>
                                      ) : (
                                        <span className="crm-pill" data-tone={data.signed.has(one.id) ? "pos" : "warn"}>
                                          {t(data.signed.has(one.id) ? "jb.so.state.signed" : "jb.so.state.open")}
                                        </span>
                                      )}
                                    </button>
                                  </li>
                                );
                              })}
                          </ul>
                        </section>
                      </aside>
                    </div>
                  )}
                  {site !== null && <SiteDialog job={site} session={session} country={null} onClose={() => setSite(null)} onDone={again} />}
                </>
              );
            }}
          </Loaded>
        )}
      </Loaded>
    </div>
  );
}

const CHECK_KEYS = ["count", "damage", "keys", "clean", "show"] as const;

function JobSignOff({ job, install, signOff, refused, snags, counts, crews, onDone }: { job: Job; install: Visit | undefined; signOff: SignOff | null; refused: RefusedSignOff | undefined; snags: Snag[]; counts: { all: number; live: number }; crews: CrewFacts; onDone: () => void }) {
  const t = useT();
  const nav = useNav();
  const names = usePeopleNames();
  const toasts = useToasts();
  const { session, f } = useJobsScreen();
  const [text, setText] = useState("");
  const [stops, setStops] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = useState(() => ({ value: newClientKey() }))[0];
  const live = snags.filter((snag) => snag.state !== "put-right");
  const stopper = live.find((snag) => truthy(snag.stops_sign_off));
  const installDay = dayKeyOf(install?.day);
  const crew = crews.crews.find((one) => one.id === install?.crew_id);
  const checked = signOff === null ? 0 : CHECKS.filter((check) => truthy(signOff[check])).length;
  const canSnag = session.can("snags", "create") && job.state !== "signed-off";
  const src = signOff === null ? null : signatureSrc(signOff.signature);
  const [sigFailed, setSigFailed] = useState(false);

  const addSnag = async (): Promise<void> => {
    if (text.trim() === "" || busy) return;
    setBusy(true);
    const saved = await toasts.say(session.create("snags", { job_id: job.id, text: text.trim(), stops_sign_off: stops, raised_by_id: session.config.user?.id ?? null }, key.value), () =>
      t(stops ? "jb.so.snag.stops.done" : "jb.so.snag.done", { job: job.code ?? "" }),
    );
    setBusy(false);
    if (saved !== null) {
      key.value = newClientKey();
      setText("");
      setStops(false);
      onDone();
    }
  };

  return (
    <article className="crm-jb-so-card" data-testid="jb-so-card" data-job={job.id} data-signed={signOff === null ? "0" : "1"}>
      <div className="crm-jb-so-head">
        <span className="crm-jb-tile" data-tone={signOff === null ? "warn" : "pos"} aria-hidden="true">
          <Icon name="clipboard-check" size={16} />
        </span>
        <div className="crm-jb-so-words">
          <h2>{[job.code, job.title].filter((part) => part !== null).join(" · ")}</h2>
          <div className="crm-jb-quiet">
            {job.site_name}
            {job.town !== null && job.town !== "" ? ` · ${job.town}` : ""}
          </div>
          <span className="crm-pill" data-tone={signOff !== null ? "pos" : refused !== undefined ? "danger" : "warn"} data-testid="jb-so-state">
            {refused !== undefined ? t("offline.office.pill") : t(signOff !== null ? "jb.so.state.signed" : stopper !== undefined ? "jb.so.state.refused" : job.state === "installed" ? "jb.so.state.waiting" : "jb.so.state.open")}
          </span>
        </div>
        <div className="crm-jb-so-end">
          {installDay !== null && <div data-testid="jb-so-done">{t("jb.so.done", { day: f.date(noonOf(installDay)) })}</div>}
          {install !== undefined && (
            <div className="crm-jb-quiet">
              {[crew?.name, t("jb.crewMembers", { count: f.number(install.crew_size ?? 0) }, install.crew_size ?? 0), t("jb.rt.hoursOnSite", { n: hoursOf(f, install.hours) })].filter((part) => part !== undefined).join(" · ")}
            </div>
          )}
        </div>
      </div>

      <section className="crm-jb-so-block" aria-labelledby="crm-jb-checks-h">
        <div className="crm-jb-so-block-head">
          <h3 id="crm-jb-checks-h">{t("jb.so.checks")}</h3>
          <span className="crm-mono" data-figure="checks">
            {t("jb.so.checks.count", { done: f.number(checked), of: f.number(CHECKS.length) })}
          </span>
        </div>
        <ul className="crm-jb-checks">
          {CHECKS.map((check, i) => {
            const on = signOff !== null && truthy(signOff[check]);
            return (
              <li key={check} data-on={on ? "1" : "0"}>
                <span className="crm-jb-tick-box" aria-hidden="true">
                  {on && <Icon name="check" size={12} />}
                </span>
                <span>{t(`jb.check.${CHECK_KEYS[i]!}`)}</span>
                <span className="crm-sr">{t(on ? "jb.ds.ticked" : "jb.ds.notTicked")}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="crm-jb-so-block" aria-labelledby="crm-jb-sosnags-h">
        <div className="crm-jb-so-block-head">
          <h3 id="crm-jb-sosnags-h">{t("jb.so.snags")}</h3>
          <span className="crm-mono" data-figure="snags" data-tone={counts.live > 0 ? "warn" : "pos"}>
            {counts.all === 0 ? t("jb.so.snags.none") : t("jb.so.snags.count", { all: f.number(counts.all), live: f.number(counts.live) }, counts.all)}
          </span>
        </div>
        {snags.length > 0 && (
          <ul className="crm-jb-so-snags">
            {snags.map((snag) => {
              const live_ = snag.state !== "put-right";
              const stopping = live_ && truthy(snag.stops_sign_off);
              return (
                <li key={snag.id} data-tone={stopping ? "danger" : live_ ? "warn" : undefined} data-snag={snag.id}>
                  <Icon name={stopping ? "octagon-alert" : live_ ? "triangle-alert" : "check"} size={15} />
                  <span>
                    {snag.text} · {t(`jb.sg.state.${snag.state}`)}
                    {stopping ? ` · ${t("jb.sg.stops")}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {canSnag && (
          <div className="crm-jb-so-add" data-testid="jb-so-add">
            <input
              className="crm-input mr-fld"
              aria-label={t("jb.so.snag.what")}
              placeholder={t("jb.so.snag.what")}
              value={text}
              maxLength={400}
              disabled={busy}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addSnag();
                }
              }}
            />
            <label className="crm-jb-check">
              <input type="checkbox" checked={stops} disabled={busy} onChange={(event) => setStops(event.target.checked)} />
              {t("jb.so.snag.stops")}
            </label>
            <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" disabled={text.trim() === "" || busy} onClick={() => void addSnag()}>
              <Icon name="plus" size={13} />
              {t("jb.so.snag.add")}
            </button>
          </div>
        )}
      </section>

      <section className="crm-jb-so-block" aria-labelledby="crm-jb-photos-h">
        <div className="crm-jb-so-block-head">
          <h3 id="crm-jb-photos-h">{t("jb.so.photos")}</h3>
        </div>
        <p className="crm-jb-quiet">{refused !== undefined ? t("offline.office.noPhotos") : t(signOff === null ? "jb.so.photos.later" : "jb.so.photos.none")}</p>
      </section>

      <section className="crm-jb-so-block" aria-labelledby="crm-jb-who-h">
        <div className="crm-jb-so-block-head">
          <h3 id="crm-jb-who-h">{t("jb.so.who")}</h3>
        </div>
        {signOff !== null ? (
          <div className="crm-jb-signed" data-testid="jb-so-signed">
            <div className="crm-jb-signed-line">
              <Icon name="check" size={15} />
              <strong>{signOff.signer_name}</strong>
              <span className="crm-mono crm-jb-quiet">{t("jb.so.signedOn", { day: f.date(new Date(signOff.signed_at)) })}</span>
            </div>
            {src !== null && !sigFailed ? (
              <img className="crm-jb-signature" src={src} alt={t("jb.so.signature.alt", { name: signOff.signer_name })} onError={() => setSigFailed(true)} />
            ) : (
              <p className="crm-jb-quiet">{t("jb.so.signature.none")}</p>
            )}
            {signOff.copy_sent_to !== null && signOff.copy_sent_to !== "" && <p className="crm-jb-quiet">{t("jb.so.copy", { to: signOff.copy_sent_to })}</p>}
            <p className="crm-jb-quiet" data-testid="jb-so-sealed">
              {t("jb.so.sealed")}
            </p>
          </div>
        ) : (
          <div className="crm-jb-unsigned">
            {refused !== undefined && <RefusedOnArrival record={refused} names={names} f={f} onOpenSnag={session.can("snags", "read") ? () => nav.go("snags") : undefined} />}
            <p className="crm-jb-hint" data-tone={stopper !== undefined ? "danger" : undefined} data-testid="jb-so-hint">
              {stopper !== undefined ? t("jb.so.stopped", { what: stopper.text }) : t("jb.so.onPhone")}
            </p>
            <p className="crm-jb-quiet">{t("jb.so.later")}</p>
            {crewPeople(crews, install?.crew_id ?? null).length > 0 && (
              <p className="crm-jb-quiet">
                {t("jb.so.crew", {
                  people: crewPeople(crews, install?.crew_id ?? null)
                    .map((person) => person.name)
                    .filter((name) => name !== "")
                    .join(", "),
                })}
              </p>
            )}
          </div>
        )}
      </section>
    </article>
  );
}
