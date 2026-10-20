/**
 * TRAINING RECORDS (ledger screen 64): who holds which certificate and when
 * each runs out. A run-out certificate is a crew member who cannot go on that
 * site.
 *
 * "Runs out soon" is within the warning days of the settings (42 by default,
 * one setting for this screen and the crew's phone: ruling Q12). Every count
 * is the server's, for the reader's rows; the browser only says of each
 * certificate whether its last day is before today or within the warning days
 * of it, and how many days that is.
 *
 * The operations manager and the CRM admin add a certificate, renew one (a
 * new last day) and book its course (the day of it; a run-out certificate
 * with a course booked still counts as run out until it is renewed). Read-only
 * reads it with nothing to press. A rep, a manager and anybody else are
 * refused the certificates by the server.
 *
 * Address: `training`.
 */
import { useCallback, useId, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { initials } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { useScreen } from "../team/data.ts";
import type { CrewFacts } from "../jobs/data.ts";
import { Stat, useCrewFacts, useJobsScreen } from "../jobs/parts.tsx";
import { addCertificate, certState, changeCertificate, dayKeyOf, daysFrom, isDay, num, readCertFigures, readCertificates, readHoursSettings, removeCertificate, truthy, type CertFigures, type Certificate } from "./data.ts";
import { certTone } from "./parts.tsx";

interface Holder {
  user: string;
  name: string;
  crew: { id: number; name: string } | null;
  lead: boolean;
  since: string | null;
  certs: Certificate[];
}

/** Crew members in their crews' order (the lead first), then anybody else who holds a certificate. */
function holdersOf(facts: CrewFacts, certs: readonly Certificate[]): Holder[] {
  const out: Holder[] = [];
  const seen = new Set<string>();
  for (const crew of facts.crews) {
    const members = facts.members.filter((member) => member.crew_id === crew.id).sort((a, b) => Number(truthy(b.lead)) - Number(truthy(a.lead)) || a.id - b.id);
    for (const member of members) {
      if (seen.has(member.user_id)) continue;
      seen.add(member.user_id);
      out.push({ user: member.user_id, name: facts.names[member.user_id] ?? "", crew: { id: crew.id, name: crew.name }, lead: truthy(member.lead), since: dayKeyOf(member.since), certs: certs.filter((cert) => cert.user_id === member.user_id) });
    }
  }
  for (const cert of certs) {
    if (seen.has(cert.user_id)) continue;
    seen.add(cert.user_id);
    out.push({ user: cert.user_id, name: facts.names[cert.user_id] ?? "", crew: null, lead: false, since: null, certs: certs.filter((one) => one.user_id === cert.user_id) });
  }
  return out;
}

type Editing = { kind: "add"; holder: Holder } | { kind: "change"; cert: Certificate; holder: Holder; focus: "course" | "until" };

export function Training(_props: ScreenProps) {
  const t = useT();
  const { session, f, today, tick } = useJobsScreen();
  const { opens } = useScreen();
  const { load: facts, reload: reloadFacts } = useCrewFacts(session);
  const { load, reload } = useLoad(async () => {
    const settings = await readHoursSettings(session);
    const count = (table: string): Promise<number> => session.figure<{ value?: number | null }>({ table, shape: "single-metric", aggregations: [{ fn: "count", alias: "n" }] }).then((figure) => num(figure.value));
    const [certs, figures, members, crews] = await Promise.all([readCertificates(session), readCertFigures(session, today, settings.warnDays, true), count("crew_members"), count("crews")]);
    return { certs, figures, members, crews, warn: settings.warnDays };
  }, [session, today]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["certificates"], again);
  useLive(["crews", "crew_members"], useCoalesced(reloadFacts));
  const [editing, setEditing] = useState<Editing | null>(null);

  return (
    <div className="crm-screen crm-jb crm-hr mr-screen" data-screen="training">
      <div className="crm-screen-head">
        <div>
          <h1>{t("hr.tr.title")}</h1>
          <p className="crm-screen-sub crm-jb-lead">{t("hr.tr.sub")}</p>
        </div>
      </div>
      <Loaded load={facts} reload={reloadFacts} skeleton={<Skeleton rows={3} height={130} />}>
        {(crews) => (
          <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={130} />}>
            {(data) => {
              const holders = holdersOf(crews, data.certs);
              const out = data.certs.filter((cert) => certState(cert.valid_until, today, data.warn) === "out");
              return (
                <>
                  <div className="crm-kpis crm-jb-stats">
                    <Stat name="members" label={t("hr.tr.stat.members")} value={f.number(data.members)} sub={t("hr.tr.stat.members.sub", { crews: t("hr.tr.crews", { count: f.number(data.crews) }, data.crews), certs: t("hr.tr.certs", { count: f.number(data.figures.all), kinds: f.number(data.figures.kinds) }, data.figures.all) })} />
                    <Stat name="out" label={t("hr.tr.stat.out")} value={f.number(data.figures.out)} tone={data.figures.out > 0 ? "danger" : "pos"} sub={t(data.figures.out > 0 ? "hr.tr.stat.out.sub" : "hr.tr.stat.out.none")} />
                    <Stat name="soon" label={t("hr.tr.stat.soon", { days: f.number(data.warn) })} value={f.number(data.figures.soon)} tone={data.figures.soon > 0 ? "warn" : "pos"} sub={t(data.figures.soon > 0 ? "hr.tr.stat.soon.sub" : "hr.tr.stat.soon.none")} />
                  </div>
                  {data.figures.out > 0 && (
                    <div className="crm-banner" data-tone="danger" data-testid="hr-tr-out" role="status">
                      <Icon name="shield-x" size={16} />
                      <span>{data.figures.out === 1 && out.length === 1 ? outLine(t, f, out[0]!, holders) : t("hr.tr.out.many", { count: f.number(data.figures.out) }, data.figures.out)}</span>
                    </div>
                  )}
                  <ul className="crm-jb-list" aria-label={t("hr.tr.list")}>
                    {holders.map((holder) => (
                      <HolderCard key={holder.user} holder={holder} figures={data.figures} warn={data.warn} daysheet={opens("daysheet")} onEdit={setEditing} />
                    ))}
                  </ul>
                  {holders.length === 0 && (
                    <div className="crm-empty" data-testid="hr-tr-empty">
                      <span className="crm-empty-icon">
                        <Icon name="graduation-cap" size={20} />
                      </span>
                      <div className="crm-empty-title">{t("hr.tr.empty")}</div>
                      <p>{t("hr.tr.empty.body")}</p>
                    </div>
                  )}
                  {editing !== null && <CertDialog editing={editing} onClose={() => setEditing(null)} onDone={again} />}
                </>
              );
            }}
          </Loaded>
        )}
      </Loaded>
    </div>
  );
}

/** A year in the reader's digits, never grouped ("2019", not "2,019"). */
const yearOf = (day: string, locale: string): string => new Intl.NumberFormat(locale, { useGrouping: false }).format(Number(day.slice(0, 4)));

function outLine(t: ReturnType<typeof useT>, f: ReturnType<typeof useJobsScreen>["f"], cert: Certificate, holders: readonly Holder[]): string {
  const holder = holders.find((one) => one.user === cert.user_id);
  const until = dayKeyOf(cert.valid_until) ?? cert.valid_until;
  const course = dayKeyOf(cert.course_on);
  const line = t(holder?.crew ? "hr.tr.out.one" : "hr.tr.out.oneNoCrew", { name: holder?.name ?? "", crew: holder?.crew?.name ?? "", cert: cert.name, day: f.dayShort(noonOf(until)) });
  return course === null ? line : `${line} ${t("hr.tr.out.course", { day: f.dayShort(noonOf(course)) })}`;
}

function HolderCard({ holder, figures, warn, daysheet, onEdit }: { holder: Holder; figures: CertFigures; warn: number; daysheet: boolean; onEdit: (editing: Editing) => void }) {
  const t = useT();
  const { session, f, today } = useJobsScreen();
  const { locale } = useI18n();
  const outN = figures.outBy[holder.user] ?? 0;
  const soonN = figures.soonBy[holder.user] ?? 0;
  const tone = outN > 0 ? "danger" : soonN > 0 ? "warn" : "pos";
  const canChange = session.can("certificates", "update");
  return (
    <li className="crm-jb-row crm-hr-holder mr-card" data-holder={holder.user} data-tone={tone}>
      <div className="crm-jb-row-top">
        <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
          {initials(holder.name || "?")}
        </span>
        <div className="crm-jb-row-words">
          <div className="crm-jb-row-line">
            <strong>{holder.name}</strong>
            {holder.crew !== null && <span className="crm-pill">{holder.crew.name}</span>}
          </div>
          <div className="crm-hr-holder-line">
            <span className="crm-jb-quiet">{t(holder.lead ? "hr.lead" : holder.crew === null ? "hr.nocrew" : "hr.member")}</span>
            {holder.since !== null && <span className="crm-mono crm-jb-quiet">{t("hr.tr.since", { year: yearOf(holder.since, locale) })}</span>}
            <span className="crm-hr-summary" data-tone={tone} data-testid="hr-tr-summary">
              {outN > 0 ? t("hr.tr.sum.out", { count: f.number(outN) }, outN) : soonN > 0 ? t("hr.tr.sum.soon", { count: f.number(soonN) }, soonN) : holder.certs.length === 0 ? t("hr.tr.sum.none") : t("hr.tr.sum.ok")}
            </span>
          </div>
        </div>
        {daysheet && holder.crew !== null && (
          <ScreenLink to="daysheet" rest={[today, holder.crew.id]} className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
            <Icon name="notebook-tabs" size={14} />
            {t("hr.tr.daysheet")}
          </ScreenLink>
        )}
      </div>
      <ul className="crm-hr-certgrid">
        {holder.certs.map((cert) => {
          const until = dayKeyOf(cert.valid_until) ?? cert.valid_until;
          const state = certState(until, today, warn);
          const left = daysFrom(today, until);
          const course = dayKeyOf(cert.course_on);
          return (
            <li key={cert.id} className="crm-hr-certrow" data-cert={cert.id} data-state={state} data-tone={certTone(state)}>
              <span className="crm-hr-certname">{cert.name}</span>
              <span className="crm-hr-certend">
                <span className="crm-mono crm-hr-when" data-figure="when">
                  {[state === "out" ? t("hr.tr.ranOut", { day: f.dayShort(noonOf(until)) }) : t("hr.left", { count: f.number(left) }, left), course === null ? null : t("hr.tr.booked", { day: f.dayShort(noonOf(course)) })].filter((part) => part !== null).join(" · ")}
                </span>
                {canChange && state !== "ok" && course === null && (
                  <button type="button" className="crm-btn crm-btn-ghost crm-btn-28 mr-gi" aria-label={t("hr.tr.book.label", { cert: cert.name, name: holder.name })} onClick={() => onEdit({ kind: "change", cert, holder, focus: "course" })}>
                    {t("hr.tr.book")}
                  </button>
                )}
                {canChange && (
                  <button type="button" className="crm-btn crm-btn-ghost crm-btn-28 mr-gi" aria-label={t("hr.tr.change.label", { cert: cert.name, name: holder.name })} onClick={() => onEdit({ kind: "change", cert, holder, focus: "until" })}>
                    <Icon name="pencil" size={12} />
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {session.can("certificates", "create") && (
        <div className="crm-jb-row-foot">
          <span />
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" aria-label={t("hr.tr.add.label", { name: holder.name })} onClick={() => onEdit({ kind: "add", holder })}>
            <Icon name="plus" size={14} />
            {t("hr.tr.add")}
          </button>
        </div>
      )}
    </li>
  );
}

/** Add a certificate for somebody; or renew one (its last day), book its course, or take it off. */
function CertDialog({ editing, onClose, onDone }: { editing: Editing; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useJobsScreen();
  const id = useId();
  const cert = editing.kind === "change" ? editing.cert : null;
  const [name, setName] = useState("");
  const [until, setUntil] = useState(cert === null ? "" : (dayKeyOf(cert.valid_until) ?? ""));
  const [course, setCourse] = useState(cert === null ? "" : (dayKeyOf(cert.course_on) ?? ""));
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [key] = useState(() => newClientKey());
  const ready = !busy && isDay(until) && (course === "" || isDay(course)) && (cert !== null || name.trim() !== "");
  const who = editing.holder.name;

  const save = async (): Promise<void> => {
    if (!ready) return;
    setBusy(true);
    const row =
      cert === null
        ? await toasts.say(addCertificate(session, editing.holder.user, name, until, key), () => t("hr.tr.added", { cert: name.trim(), name: who }))
        : await toasts.say(changeCertificate(session, cert, { valid_until: until, course_on: course === "" ? null : course }), () => t("hr.tr.changed", { cert: cert.name, name: who }));
    setBusy(false);
    onDone();
    if (row !== null) onClose();
  };
  const remove = async (): Promise<void> => {
    if (cert === null) return;
    if (!removing) return setRemoving(true);
    setBusy(true);
    const row = await toasts.say(removeCertificate(session, cert), () => t("hr.tr.removed", { cert: cert.name, name: who }));
    setBusy(false);
    onDone();
    if (row !== null) onClose();
  };
  return (
    <Dialog
      shape="box"
      icon="graduation-cap"
      tone="accent"
      title={cert === null ? t("hr.tr.add.title", { name: who }) : cert.name}
      subtitle={cert === null ? undefined : who}
      onClose={onClose}
      busy={busy}
      name="hr-cert"
      foot={
        <>
          {cert !== null && session.can("certificates", "delete") ? (
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi" data-tone="danger" disabled={busy} onClick={() => void remove()}>
              <Icon name="trash-2" size={14} />
              {t(removing ? "hr.tr.remove.sure" : "hr.tr.remove")}
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" data-testid="hr-cert-save" disabled={!ready} onClick={() => void save()}>
            <Icon name="check" />
            {busy ? t("ui.saving") : t(cert === null ? "hr.tr.add.go" : "hr.tr.change.go")}
          </button>
        </>
      }
    >
      {cert === null && (
        <>
          <label className="crm-label" htmlFor={`${id}-name`}>
            {t("hr.tr.name")}
          </label>
          <input id={`${id}-name`} data-autofocus className="crm-input mr-fld" value={name} maxLength={120} placeholder={t("hr.tr.name.hint")} disabled={busy} onChange={(event) => setName(event.target.value)} />
        </>
      )}
      <label className="crm-label" htmlFor={`${id}-until`}>
        {t("hr.mc.until")}
      </label>
      <input id={`${id}-until`} {...(editing.kind === "change" && editing.focus === "until" ? { "data-autofocus": true } : {})} className="crm-input crm-mono mr-fld" type="date" value={until} disabled={busy} onChange={(event) => setUntil(event.target.value)} />
      {cert !== null && (
        <>
          <label className="crm-label" htmlFor={`${id}-course`}>
            {t("hr.tr.course")}
          </label>
          <input id={`${id}-course`} {...(editing.kind === "change" && editing.focus === "course" ? { "data-autofocus": true } : {})} className="crm-input crm-mono mr-fld" type="date" value={course} disabled={busy} onChange={(event) => setCourse(event.target.value)} />
          <p className="crm-jb-quiet">{t("hr.tr.course.hint")}</p>
          {isDay(until) && <p className="crm-jb-quiet" data-testid="hr-cert-until">{t("hr.tr.until.words", { day: f.dayLong(noonOf(until)) })}</p>}
        </>
      )}
    </Dialog>
  );
}
