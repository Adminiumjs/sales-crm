/**
 * INSURANCE CLAIMS (ledger screen 67): what happened, what was claimed, the
 * excess paid and what the insurers paid out; an incident added, changed and
 * settled by its own button. For the operations manager and the CRM admin;
 * Read-only reads it with nothing to press.
 *
 * Counts and sums are the server's (`readIncidentFigures`); "26 days open"
 * takes the day from the server's own today. A company is named only to a
 * reader who may read companies (the operations manager does not).
 */
import { useCallback, useState, type ReactNode } from "react";

import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { changedOf, dayKeyOf, daysSince, incidentValues, num, readIncidentFigures, readIncidents, type Incident } from "./data.ts";
import { dayWords, Figure, FormError, useFleetScreen } from "./parts.tsx";

type Filter = "all" | "open" | "settled";

export function InsuranceClaims(_props: ScreenProps) {
  const t = useT();
  const { session, f, today, tick } = useFleetScreen();
  const withCompany = session.can("companies", "read");
  const { load, reload } = useLoad(() => Promise.all([readIncidents(session, withCompany), readIncidentFigures(session)]), [session, withCompany]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["insurance_incidents"], again);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Incident | "new" | null>(null);
  const canAdd = session.can("insurance_incidents", "create");

  return (
    <div className="crm-screen crm-fl mr-screen" data-screen="iclaims">
      <div className="crm-screen-head">
        <div>
          <h1>{t("fl.ic.title")}</h1>
          {load.state === "ready" && (
            <p className="crm-screen-sub crm-fl-lead">
              {t("fl.ic.sub", { count: f.number(load.data[1].all) }, load.data[1].all)} {load.data[1].open > 0 ? t("fl.ic.sub.open", { count: f.number(load.data[1].open) }, load.data[1].open) : t("fl.ic.sub.none")}
            </p>
          )}
        </div>
        {canAdd && (
          <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" data-testid="fl-ic-add" onClick={() => setEditing("new")}>
            <Icon name="plus" />
            {t("fl.ic.add")}
          </button>
        )}
      </div>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={110} />}>
        {([incidents, figures]) => {
          const open = incidents.filter((one) => one.state === "open");
          const oldest = open.reduce<Incident | null>((was, one) => (was === null || one.day < was.day ? one : was), null);
          const biggest = open.filter((one) => num(one.claimed) > 0).sort((a, b) => num(b.claimed) - num(a.claimed))[0] ?? null;
          const ageOf = (one: Incident): number => daysSince(f, dayKeyOf(one.day)!, today);
          const shown = incidents
            .filter((one) => filter === "all" || one.state === filter)
            .sort((a, b) => (a.state === b.state ? (a.state === "open" ? a.day.localeCompare(b.day) : b.day.localeCompare(a.day)) : a.state === "open" ? -1 : 1));
          return (
            <>
              <div className="crm-kpis crm-fl-stats">
                <Figure name="open" label={t("fl.ic.stat.open")} value={f.number(figures.open)} tone={figures.open > 0 ? "warn" : "pos"} sub={oldest === null ? t("fl.ic.stat.open.none") : t("fl.ic.stat.open.sub", { days: f.number(ageOf(oldest)) }, ageOf(oldest))} />
                <Figure name="claimed" label={t("fl.ic.stat.claimed")} value={f.money(figures.claimed)} sub={t("fl.ic.stat.claimed.sub", { count: f.number(figures.all) }, figures.all)} />
                <Figure name="excess" label={t("fl.ic.stat.excess")} value={f.money(figures.excessSettled)} sub={t("fl.ic.stat.excess.sub", { count: f.number(figures.settled) }, figures.settled)} />
                <Figure name="paid" label={t("fl.ic.stat.paid")} value={f.money(figures.paid)} tone="pos" sub={t("fl.ic.stat.paid.sub")} />
                <Figure name="still" label={t("fl.ic.stat.still")} value={f.money(figures.stillClaimed)} tone={figures.open > 0 ? "warn" : undefined} sub={t("fl.ic.stat.still.sub", { count: f.number(figures.open) }, figures.open)} />
              </div>
              {biggest !== null && (
                <div className="crm-banner" data-tone="warn" data-testid="fl-ic-big">
                  <Icon name="clock-alert" size={16} />
                  <span>{t("fl.ic.big", { money: f.money(biggest.claimed), days: f.number(ageOf(biggest)) }, ageOf(biggest))}</span>
                </div>
              )}
              <div className="crm-chips" role="group" aria-label={t("fl.ic.filter")}>
                {(["all", "open", "settled"] as const).map((one) => (
                  <button key={one} type="button" className="crm-chip-btn mr-chip" aria-pressed={filter === one} data-filter={one} onClick={() => setFilter(one)}>
                    {t(`fl.ic.filter.${one}`)}
                    <span className="crm-chip-count crm-mono">{f.number(one === "all" ? figures.all : one === "open" ? figures.open : figures.settled)}</span>
                  </button>
                ))}
              </div>
              {shown.length === 0 ? (
                <div className="crm-empty" data-testid="fl-ic-empty">
                  <span className="crm-empty-icon">
                    <Icon name="shield" size={20} />
                  </span>
                  <div className="crm-empty-title">{t("fl.ic.empty")}</div>
                  <p>{incidents.length === 0 ? t("fl.ic.empty.body") : t("fl.ic.empty.filter")}</p>
                </div>
              ) : (
                <ul className="crm-fl-list">
                  {shown.map((one) => (
                    <IncidentRow key={one.id} incident={one} age={ageOf(one)} onEdit={() => setEditing(one)} onChanged={again} />
                  ))}
                </ul>
              )}
            </>
          );
        }}
      </Loaded>
      {editing !== null && <IncidentDialog incident={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={again} />}
    </div>
  );
}

function IncidentRow({ incident, age, onEdit, onChanged }: { incident: Incident; age: number; onEdit: () => void; onChanged: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useFleetScreen();
  const [busy, setBusy] = useState(false);
  const canWrite = session.can("insurance_incidents", "update");
  const open = incident.state === "open";
  const money = (value: unknown, none: string): string => (num(value) === 0 ? none : f.money(value));

  const settle = async (): Promise<void> => {
    setBusy(true);
    const saved = await session.act("insurance_incidents", incident.id, "settle", "open");
    setBusy(false);
    if (saved.state === "saved") toasts.show(t("fl.ic.settled", { what: incident.what }), "pos");
    else if (saved.state === "refused") toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    else toasts.show(t("ui.unknown"), "danger", true);
    onChanged();
  };

  return (
    <li className="crm-fl-card mr-card" data-incident={incident.id} data-state={incident.state} data-tone={open ? "warn" : "pos"}>
      <div className="crm-fl-card-top">
        <span className="crm-fl-tile" aria-hidden="true">
          <Icon name="shield" size={16} />
        </span>
        <div className="crm-fl-card-words">
          <div className="crm-fl-card-line">
            <h2 className="crm-fl-name">{incident.what}</h2>
            <span className="crm-pill" data-tone={open ? "warn" : "pos"} data-testid="fl-ic-state">
              {open ? t("fl.ic.daysOpen", { days: f.number(age) }, age) : t("fl.ic.settled.pill")}
            </span>
          </div>
          <div className="crm-fl-quiet">
            {[incident.kind, incident.company ?? null, dayWords(f, dayKeyOf(incident.day)!)].filter((part) => part !== null && part !== "").join(" · ")}
          </div>
          {incident.insurer_ref !== null && incident.insurer_ref !== "" && <div className="crm-fl-quiet">{t("fl.ic.ref", { ref: incident.insurer_ref })}</div>}
        </div>
      </div>
      <dl className="crm-fl-cells">
        <div>
          <dt>{t("fl.ic.cell.claimed")}</dt>
          <dd className="crm-mono" data-cell="claimed">{money(incident.claimed, t("fl.ic.notYet"))}</dd>
        </div>
        <div>
          <dt>{t("fl.ic.cell.excess")}</dt>
          <dd className="crm-mono" data-cell="excess">{money(incident.excess, t("fl.ic.noExcess"))}</dd>
        </div>
        <div>
          <dt>{t("fl.ic.cell.paid")}</dt>
          <dd className="crm-mono" data-cell="paid">{money(incident.paid, "—")}</dd>
        </div>
      </dl>
      {canWrite && (
        <div className="crm-fl-card-foot">
          {open && (
            <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-testid="fl-ic-settle" disabled={busy} onClick={() => void settle()}>
              <Icon name="check" size={14} />
              {busy ? t("ui.saving") : t("fl.ic.settle")}
            </button>
          )}
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-testid="fl-ic-edit" onClick={onEdit}>
            <Icon name="pencil" size={14} />
            {t("fl.ic.edit")}
          </button>
        </div>
      )}
    </li>
  );
}

function IncidentDialog({ incident, onClose, onDone }: { incident: Incident | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f, today } = useFleetScreen();
  const [day, setDay] = useState(dayKeyOf(incident?.day) ?? today);
  const [what, setWhat] = useState(incident?.what ?? "");
  const [kind, setKind] = useState(incident?.kind ?? "");
  const [ref, setRef] = useState(incident?.insurer_ref ?? "");
  const [claimed, setClaimed] = useState(incident === null ? "" : String(num(incident.claimed)));
  const [excess, setExcess] = useState(incident === null ? "" : String(num(incident.excess)));
  const [paid, setPaid] = useState(incident === null ? "" : String(num(incident.paid)));
  const [key] = useState(() => newClientKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = (typed: string): number | null => (typed.trim() === "" ? 0 : typed.trim() === "0" ? 0 : f.readAmount(typed));
  const ready = what.trim() !== "" && kind.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(day) && [claimed, excess, paid].every((one) => amount(one) !== null);

  const go = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const values = incidentValues({ day, what, kind, insurer_ref: ref, claimed: amount(claimed)!, excess: amount(excess)!, paid: amount(paid)! });
    const saved =
      incident === null
        ? await session.create<Incident>("insurance_incidents", values, key)
        : await (async () => {
            const { values: changed, seen } = changedOf({ ...incident, claimed: num(incident.claimed), excess: num(incident.excess), paid: num(incident.paid) }, values);
            return Object.keys(changed).length === 0 ? ({ state: "saved", row: incident, replayed: false, readBack: false } as const) : session.update<Incident>("insurance_incidents", incident.id, changed, { seen });
          })();
    setBusy(false);
    if (saved.state === "refused") return setError(t("ui.refused", { reason: reasonOf(saved.error, t) }));
    if (saved.state === "unknown") return setError(t("ui.unknown"));
    toasts.show(t(incident === null ? "fl.ic.added" : "fl.ic.saved", { what: what.trim() }), "pos");
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
      name="fl-incident"
      icon="shield"
      title={incident === null ? t("fl.ic.add") : t("fl.ic.edit.title")}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("ui.cancel")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 crm-btn-wide mr-btn" data-go disabled={!ready || busy} onClick={() => void go()}>
            {busy ? t("ui.saving") : incident === null ? t("fl.ic.add.go") : t("fl.ic.save")}
          </button>
        </>
      }
    >
      <fieldset className="crm-fields" disabled={busy}>
        {field("crm-fl-ic-what", t("fl.ic.f.what"), <input id="crm-fl-ic-what" data-autofocus className="crm-input mr-fld" value={what} maxLength={400} onChange={(event) => setWhat(event.target.value)} />)}
        <div className="crm-field-pair">
          {field("crm-fl-ic-day", t("fl.ic.f.day"), <input id="crm-fl-ic-day" type="date" className="crm-input mr-fld" value={day} onChange={(event) => setDay(event.target.value)} />)}
          {field("crm-fl-ic-kind", t("fl.ic.f.kind"), <input id="crm-fl-ic-kind" className="crm-input mr-fld" value={kind} maxLength={60} placeholder={t("fl.ic.f.kind.hint")} onChange={(event) => setKind(event.target.value)} />)}
        </div>
        {field("crm-fl-ic-ref", t("fl.ic.f.ref"), <input id="crm-fl-ic-ref" className="crm-input crm-mono mr-fld" dir="ltr" value={ref} maxLength={60} onChange={(event) => setRef(event.target.value)} />)}
        <div className="crm-fl-field-three">
          {field("crm-fl-ic-claimed", t("fl.ic.f.claimed"), <input id="crm-fl-ic-claimed" className="crm-input crm-mono mr-fld" inputMode="decimal" value={claimed} onChange={(event) => setClaimed(event.target.value)} />)}
          {field("crm-fl-ic-excess", t("fl.ic.f.excess"), <input id="crm-fl-ic-excess" className="crm-input crm-mono mr-fld" inputMode="decimal" value={excess} onChange={(event) => setExcess(event.target.value)} />)}
          {field("crm-fl-ic-paid", t("fl.ic.f.paid"), <input id="crm-fl-ic-paid" className="crm-input crm-mono mr-fld" inputMode="decimal" value={paid} onChange={(event) => setPaid(event.target.value)} />)}
        </div>
      </fieldset>
      <FormError text={error} />
    </Dialog>
  );
}
