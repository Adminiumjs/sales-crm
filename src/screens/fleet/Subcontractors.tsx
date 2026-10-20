/**
 * SUBCONTRACTORS (ledger screen 68): the people brought in when the crews
 * will not cover the week, their rates and days, and whether their insurance
 * lets them on a site today. "Chase the certificate" sends e-mail 11 (a
 * certificate asked for) to the subcontractor's own address: the screen
 * writes when it was asked, and the server stamps who asked and queues the
 * e-mail; nothing else sends it. Asking does not make anybody covered.
 *
 * Counts and sums are the server's (`readSubFigures`); a row's spend is the
 * server's own formula (day rate times days used). "Ran out 28 days ago"
 * takes the day from the server's own today.
 */
import { useCallback, useState, type ReactNode } from "react";

import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { initials } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { chase, chasedOn, changedOf, covered, dayKeyOf, daysSince, num, readSubFigures, readSubs, subValues, type Sub, type SubDraft } from "./data.ts";
import { dateWords, Figure, FormError, useFleetScreen, useOpens } from "./parts.tsx";

type Filter = "all" | "ok" | "out";

export function Subcontractors(_props: ScreenProps) {
  const t = useT();
  const { session, f, today, tick } = useFleetScreen();
  const opens = useOpens();
  const visits = session.part("jobs") && session.can("job_visits", "read");
  const { load, reload } = useLoad(async () => {
    const [subs, figures, people] = await Promise.all([readSubs(session), readSubFigures(session, today, visits), session.people(undefined, 200).catch(() => [])]);
    return { subs, figures, names: Object.fromEntries(people.map((person) => [person.id, person.name])) as Record<string, string> };
  }, [session, today, visits]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["subcontractors", ...(visits ? ["job_visits"] : [])], again);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Sub | "new" | null>(null);
  const canAdd = session.can("subcontractors", "create");

  return (
    <div className="crm-screen crm-fl mr-screen" data-screen="subs">
      <div className="crm-screen-head">
        <div>
          <h1>{t("fl.sb.title")}</h1>
          <p className="crm-screen-sub crm-fl-lead">{t("fl.sb.sub")}</p>
        </div>
        {canAdd && (
          <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" data-testid="fl-sb-add" onClick={() => setEditing("new")}>
            <Icon name="plus" />
            {t("fl.sb.add")}
          </button>
        )}
      </div>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={120} />}>
        {(data) => {
          const out = data.subs.filter((sub) => dayKeyOf(sub.insurance_until) !== null && !covered(sub, today));
          const shown = data.subs
            .filter((sub) => filter === "all" || (filter === "ok" ? covered(sub, today) : !covered(sub, today)))
            .sort((a, b) => Number(covered(a, today)) - Number(covered(b, today)) || num(b.days_used) - num(a.days_used) || a.id - b.id);
          return (
            <>
              <div className="crm-kpis crm-fl-stats">
                <Figure name="on-books" label={t("fl.sb.stat.all")} value={f.number(data.figures.all)} sub={t("fl.sb.stat.all.sub", { covered: f.number(data.figures.covered) })} />
                <Figure name="days" label={t("fl.sb.stat.days")} value={f.number(data.figures.days)} sub={t("fl.sb.stat.days.sub", { money: f.money(data.figures.spent) })} />
                <Figure
                  name="out"
                  label={t("fl.sb.stat.out")}
                  value={f.number(data.figures.runOut)}
                  tone={data.figures.runOut > 0 ? "danger" : "pos"}
                  sub={data.figures.runOut > 0 ? t("fl.sb.stat.out.sub") : t("fl.sb.stat.out.none")}
                />
              </div>
              {data.figures.unknown > 0 && (
                <p className="crm-fl-quiet" data-testid="fl-sb-unknown">
                  {t("fl.sb.unknown", { count: f.number(data.figures.unknown) }, data.figures.unknown)}
                </p>
              )}
              {data.figures.runOut > 0 && (
                <div className="crm-banner" data-tone="danger" data-testid="fl-sb-out">
                  <Icon name="shield-x" size={16} />
                  <span>
                    {data.figures.runOut === 1 && out[0] !== undefined
                      ? t("fl.sb.out.one", { name: out[0].name, days: f.number(daysSince(f, dayKeyOf(out[0].insurance_until)!, today)) }, daysSince(f, dayKeyOf(out[0].insurance_until)!, today))
                      : t("fl.sb.out.many", { count: f.number(data.figures.runOut) }, data.figures.runOut)}
                  </span>
                </div>
              )}
              {data.figures.undated !== null && data.figures.undated > 0 && (
                <div className="crm-banner" data-tone="accent" data-testid="fl-sb-undated">
                  <Icon name="calendar-clock" size={16} />
                  <span>{t("fl.sb.undated", { count: f.number(data.figures.undated) }, data.figures.undated)}</span>
                  {opens("deliveries") && (
                    <ScreenLink to="deliveries" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
                      <Icon name="truck" size={14} />
                      {t("fl.sb.week")}
                    </ScreenLink>
                  )}
                </div>
              )}
              <div className="crm-chips" role="group" aria-label={t("fl.sb.filter")}>
                {(["all", "ok", "out"] as const).map((one) => (
                  <button key={one} type="button" className="crm-chip-btn mr-chip" aria-pressed={filter === one} data-filter={one} onClick={() => setFilter(one)}>
                    {t(`fl.sb.filter.${one}`)}
                    <span className="crm-chip-count crm-mono">{f.number(one === "all" ? data.figures.all : one === "ok" ? data.figures.covered : data.figures.all - data.figures.covered)}</span>
                  </button>
                ))}
              </div>
              {shown.length === 0 ? (
                <div className="crm-empty" data-testid="fl-sb-empty">
                  <span className="crm-empty-icon">
                    <Icon name="users" size={20} />
                  </span>
                  <div className="crm-empty-title">{t("fl.sb.empty")}</div>
                  <p>{data.subs.length === 0 ? (canAdd ? t("fl.sb.empty.body") : t("fl.sb.empty.ask")) : t("fl.sb.empty.filter")}</p>
                </div>
              ) : (
                <ul className="crm-fl-list">
                  {shown.map((sub) => (
                    <SubRow key={sub.id} sub={sub} chaser={sub.chased_by_id === null ? null : (data.names[sub.chased_by_id] ?? null)} onEdit={() => setEditing(sub)} onChanged={again} />
                  ))}
                </ul>
              )}
            </>
          );
        }}
      </Loaded>
      {editing !== null && <SubDialog sub={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={again} />}
    </div>
  );
}

function SubRow({ sub, chaser, onEdit, onChanged }: { sub: Sub; chaser: string | null; onEdit: () => void; onChanged: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f, today } = useFleetScreen();
  const until = dayKeyOf(sub.insurance_until);
  const ok = covered(sub, today);
  const left = until === null ? null : daysSince(f, today, until);
  const canWrite = session.can("subcontractors", "update");
  const askedToday = chasedOn(sub, f, today);
  const [busy, setBusy] = useState(false);
  const tone = !ok ? "danger" : left !== null && left < 60 ? "warn" : "pos";

  const ask = async (): Promise<void> => {
    setBusy(true);
    const saved = await chase(session, sub);
    setBusy(false);
    if (saved.state === "saved") toasts.show(t("fl.sb.chased", { name: sub.name }), "plain", true);
    else if (saved.state === "refused") toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    else toasts.show(t("ui.unknown"), "danger", true);
    onChanged();
  };

  return (
    <li className="crm-fl-card mr-card" data-sub={sub.id} data-tone={tone}>
      <div className="crm-fl-card-top">
        <span className="crm-avatar" aria-hidden="true">
          {initials(sub.name)}
        </span>
        <div className="crm-fl-card-words">
          <h2 className="crm-fl-name">{sub.name}</h2>
          <div className="crm-fl-quiet">{t("fl.sb.hands", { count: f.number(num(sub.hands)) }, num(sub.hands))}</div>
          {sub.email !== null && sub.email !== "" && (
            <div className="crm-fl-quiet" dir="ltr" data-testid="fl-sb-email">
              {sub.email}
            </div>
          )}
        </div>
        <div className="crm-fl-card-end">
          <div className="crm-mono crm-fl-rate">{f.money(sub.day_rate)}</div>
          <div className="crm-fl-quiet">{num(sub.hands) > 1 ? t("fl.sb.aDayFor", { count: f.number(num(sub.hands)) }, num(sub.hands)) : t("fl.sb.aDay")}</div>
        </div>
      </div>
      <dl className="crm-fl-cells">
        <div>
          <dt>{t("fl.sb.cell.days")}</dt>
          <dd className="crm-mono" data-cell="days">{sub.days_used === null ? "—" : f.number(num(sub.days_used))}</dd>
        </div>
        <div>
          <dt>{t("fl.sb.cell.spent")}</dt>
          <dd className="crm-mono" data-cell="spent">{sub.spent === null ? "—" : f.money(sub.spent)}</dd>
        </div>
        <div>
          <dt>{t("fl.sb.cell.insurance")}</dt>
          <dd className="crm-mono" data-cell="insurance" data-tone={tone}>
            {until === null ? t("fl.sb.noDate") : ok ? dateWords(f, until) : t("fl.sb.ranOut", { days: f.number(-left!) }, -left!)}
          </dd>
        </div>
        <div>
          <dt>{t("fl.sb.cell.certificate")}</dt>
          <dd data-cell="certificate">{sub.certificate === null || sub.certificate === "" ? "—" : sub.certificate}</dd>
        </div>
      </dl>
      {sub.chased_at !== null && sub.chased_at !== "" && (
        <p className="crm-fl-quiet" data-testid="fl-sb-asked">
          {chaser === null ? t("fl.sb.asked", { day: dateWords(f, f.dayKey(new Date(sub.chased_at))) }) : t("fl.sb.askedBy", { day: dateWords(f, f.dayKey(new Date(sub.chased_at))), name: chaser })}
        </p>
      )}
      {canWrite && (
        <div className="crm-fl-card-foot">
          {!ok &&
            (sub.email === null || sub.email === "" ? (
              <span className="crm-fl-quiet" data-testid="fl-sb-noaddress">{t("fl.sb.noAddress")}</span>
            ) : (
              <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-testid="fl-sb-chase" disabled={busy || askedToday} onClick={() => void ask()}>
                <Icon name="mail" size={14} />
                {busy ? t("ui.saving") : askedToday ? t("fl.sb.askedToday") : t("fl.sb.chase")}
              </button>
            ))}
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-testid="fl-sb-edit" onClick={onEdit}>
            <Icon name="pencil" size={14} />
            {t("fl.sb.edit")}
          </button>
        </div>
      )}
    </li>
  );
}

function SubDialog({ sub, onClose, onDone }: { sub: Sub | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useFleetScreen();
  const [name, setName] = useState(sub?.name ?? "");
  const [hands, setHands] = useState(String(sub?.hands ?? 1));
  const [rate, setRate] = useState(sub === null ? "" : String(num(sub.day_rate)));
  const [days, setDays] = useState(sub?.days_used === null || sub?.days_used === undefined ? "" : String(num(sub.days_used)));
  const [until, setUntil] = useState(dayKeyOf(sub?.insurance_until) ?? "");
  const [certificate, setCertificate] = useState(sub?.certificate ?? "");
  const [email, setEmail] = useState(sub?.email ?? "");
  const [key] = useState(() => newClientKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handsN = f.readAmount(hands);
  const rateN = f.readAmount(rate);
  const daysN = days.trim() === "" ? null : f.readAmount(days);
  const ready = name.trim() !== "" && handsN !== null && Number.isInteger(handsN) && rateN !== null && (days.trim() === "" || daysN !== null) && (email.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));

  const go = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const draft: SubDraft = { name, hands: handsN!, day_rate: rateN!, days_used: daysN, insurance_until: until, certificate, email };
    const values = subValues(draft);
    const saved =
      sub === null
        ? await session.create<Sub>("subcontractors", values, key)
        : await (async () => {
            const { values: changed, seen } = changedOf({ ...sub, day_rate: num(sub.day_rate), days_used: sub.days_used === null ? null : num(sub.days_used), hands: num(sub.hands) }, values);
            return Object.keys(changed).length === 0 ? ({ state: "saved", row: sub, replayed: false, readBack: false } as const) : session.update<Sub>("subcontractors", sub.id, changed, { seen });
          })();
    setBusy(false);
    if (saved.state === "refused") return setError(t("ui.refused", { reason: reasonOf(saved.error, t) }));
    if (saved.state === "unknown") return setError(t("ui.unknown"));
    toasts.show(t(sub === null ? "fl.sb.added" : "fl.sb.saved", { name: name.trim() }), "pos");
    onDone();
    onClose();
  };

  const field = (id: string, label: string, input: ReactNode) => (
    <div>
      <label className="crm-label" htmlFor={id}>
        {label}
      </label>
      {input}
    </div>
  );
  return (
    <Dialog
      shape="box"
      name="fl-sub"
      icon="users"
      title={sub === null ? t("fl.sb.add") : t("fl.sb.edit.title", { name: sub.name })}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("ui.cancel")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 crm-btn-wide mr-btn" data-go disabled={!ready || busy} onClick={() => void go()}>
            {busy ? t("ui.saving") : sub === null ? t("fl.sb.add.go") : t("fl.sb.save")}
          </button>
        </>
      }
    >
      <fieldset className="crm-fields" disabled={busy}>
        {field("crm-fl-sb-name", t("fl.sb.f.name"), <input id="crm-fl-sb-name" data-autofocus className="crm-input mr-fld" value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />)}
        <div className="crm-field-pair">
          {field("crm-fl-sb-hands", t("fl.sb.f.hands"), <input id="crm-fl-sb-hands" className="crm-input crm-mono mr-fld" inputMode="numeric" value={hands} onChange={(event) => setHands(event.target.value)} />)}
          {field("crm-fl-sb-rate", t("fl.sb.f.rate"), <input id="crm-fl-sb-rate" className="crm-input crm-mono mr-fld" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} />)}
        </div>
        <div className="crm-field-pair">
          {field("crm-fl-sb-days", t("fl.sb.f.days"), <input id="crm-fl-sb-days" className="crm-input crm-mono mr-fld" inputMode="decimal" value={days} onChange={(event) => setDays(event.target.value)} />)}
          {field("crm-fl-sb-until", t("fl.sb.f.until"), <input id="crm-fl-sb-until" type="date" className="crm-input mr-fld" value={until} onChange={(event) => setUntil(event.target.value)} />)}
        </div>
        {field("crm-fl-sb-cert", t("fl.sb.f.certificate"), <input id="crm-fl-sb-cert" className="crm-input mr-fld" value={certificate} maxLength={200} onChange={(event) => setCertificate(event.target.value)} />)}
        {field("crm-fl-sb-email", t("fl.sb.f.email"), <input id="crm-fl-sb-email" type="email" dir="ltr" className="crm-input mr-fld" value={email} maxLength={200} onChange={(event) => setEmail(event.target.value)} />)}
        <p className="crm-field-note">{t("fl.sb.f.email.note")}</p>
      </fieldset>
      <FormError text={error} />
    </Dialog>
  );
}
