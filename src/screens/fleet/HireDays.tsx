/**
 * A HIRED VEHICLE'S DAYS on Vehicles (plan 68 S14, M3 4a–4g): "Hired {from}
 * to {to}" with "Change the hire days", and "Where it goes": each day a crew
 * has it (and a visit then), each opening that day's Route. "Add a hired
 * vehicle" takes its name, plate, model and the two days, every one of them.
 *
 * The server holds a crew's day to the hire days (a day outside them is
 * refused). Shortening the hire past a day already given to a crew is
 * refused here, naming the first such day (M3 BN-5): that day is moved first.
 */
import { useState, type ReactNode } from "react";

import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { newClientKey, type Row, type StaffSession } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { dayOfRow, readVanDays, type VanDay } from "../jobs/vandays.ts";
import { dayKeyOf, type Vehicle } from "./data.ts";
import { dayWords, FormError, useFleetScreen } from "./parts.tsx";

export interface HireFacts {
  /** The crews' days from today on, on any vehicle. */
  days: VanDay[];
  /** Whether a crew has a booked visit on a day: a day it holds a vehicle with none holds nothing. */
  busy: Set<string>;
  crews: Map<number, string>;
}

/** The crews' days from today on, and which of them have a visit booked: what "Where it goes" and the hire check read. */
export async function readHireFacts(session: StaffSession, today: string): Promise<HireFacts | null> {
  if (!session.part("fleet") || !session.can("van_days", "read") || !session.can("job_visits", "read") || !session.can("crews", "read")) return null;
  const until = `${String(Number(today.slice(0, 4)) + 1)}${today.slice(4)}`;
  const [days, visits, crews] = await Promise.all([
    readVanDays(session, today, until),
    session.list<{ crew_id: number | null; day: string | null }>("job_visits", { select: ["id", "crew_id", "day"], where: { and: [{ column: "state", op: "eq", value: "booked" }, { column: "day", op: "gte", value: today }] }, limit: 200 }),
    session.list<{ id: number; name: string }>("crews", { select: ["id", "name"], limit: 50 }),
  ]);
  const busy = new Set(visits.rows.map((visit) => `${String(visit.crew_id)}|${dayKeyOf(visit.day) ?? ""}`));
  return { days, busy, crews: new Map(crews.rows.map((crew) => [crew.id, crew.name])) };
}

/** The days a vehicle is given to a crew that has a visit then, soonest first. */
export const givenDays = (facts: HireFacts, vehicleId: number): VanDay[] =>
  facts.days.filter((row) => row.vehicle_id === vehicleId && facts.busy.has(`${String(row.crew_id)}|${dayOfRow(row) ?? ""}`)).sort((a, b) => (dayOfRow(a) ?? "").localeCompare(dayOfRow(b) ?? ""));

export function HireLine({ vehicle, facts, canChange, onChange }: { vehicle: Vehicle; facts: HireFacts | null; canChange: boolean; onChange: () => void }) {
  const t = useT();
  const { f } = useFleetScreen();
  const from = dayKeyOf(vehicle.hired_from);
  const to = dayKeyOf(vehicle.hired_to);
  const given = facts === null ? [] : givenDays(facts, vehicle.id);
  return (
    <div className="crm-vd-hire" data-testid="vd-hire">
      {from !== null && to !== null && (
        <div className="crm-vd-hire-line">
          <Icon name="calendar-range" size={15} />
          <span data-testid="vd-hire-days">{t("vandays.vn.hire", { from: dayWords(f, from), to: dayWords(f, to) })}</span>
          {canChange && (
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-testid="vd-hire-change" onClick={onChange}>
              <Icon name="pencil" size={14} />
              {t("vandays.changeHire")}
            </button>
          )}
        </div>
      )}
      {facts !== null && (
        <div className="crm-vd-where" data-testid="vd-where">
          <div className="crm-fl-eyebrow">{t("vandays.vn.where")}</div>
          {given.length === 0 ? (
            <p className="crm-fl-quiet">{t("vandays.vn.where.none")}</p>
          ) : (
            <ul>
              {given.map((row) => {
                const day = dayOfRow(row)!;
                const crew = facts.crews.get(row.crew_id) ?? "";
                return (
                  <li key={row.id} data-day={day}>
                    <span>{t("vandays.hire.givenRow", { day: dayWords(f, day), crew })}</span>
                    <ScreenLink to="route" rest={[day, row.crew_id]} className="crm-btn crm-btn-ghost crm-btn-28 mr-gi" label={t("vandays.vn.route.aria", { crew, day: dayWords(f, day) })}>
                      <Icon name="route" size={14} />
                      {t("vandays.vn.route")}
                    </ScreenLink>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** "Change the hire days": From and To, the days already given to a crew, and the first of them the new days would leave out. */
export function HireDialog({ vehicle, facts, onClose, onDone }: { vehicle: Vehicle; facts: HireFacts | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useFleetScreen();
  const [from, setFrom] = useState(dayKeyOf(vehicle.hired_from) ?? "");
  const [to, setTo] = useState(dayKeyOf(vehicle.hired_to) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const given = facts === null ? [] : givenDays(facts, vehicle.id);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
  const outside = valid ? given.find((row) => (dayOfRow(row) ?? "") < from || (dayOfRow(row) ?? "") > to) : undefined;
  const order = valid && to < from;
  const changed = from !== (dayKeyOf(vehicle.hired_from) ?? "") || to !== (dayKeyOf(vehicle.hired_to) ?? "");
  const ready = valid && !order && outside === undefined && changed;
  const go = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const saved = await session.update<Vehicle>("vehicles", vehicle.id, { hired_from: from, hired_to: to }, { seen: { hired_from: dayKeyOf(vehicle.hired_from), hired_to: dayKeyOf(vehicle.hired_to) } });
    setBusy(false);
    if (saved.state === "refused") return setError(t("ui.refused", { reason: reasonOf(saved.error, t) }));
    if (saved.state === "unknown") return setError(t("ui.unknown"));
    toasts.show(t("vandays.hire.saved", { vehicle: vehicle.name, from: dayWords(f, from), to: dayWords(f, to) }), "pos");
    onDone();
    onClose();
  };
  return (
    <Dialog
      shape="box"
      name="vd-hire"
      icon="calendar-range"
      title={t("vandays.changeHire")}
      subtitle={t("vandays.hire.sub", { vehicle: [vehicle.plate, vehicle.name].filter((part) => part !== null && part !== "").join(" · ") })}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("ui.cancel")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 crm-btn-wide mr-btn" data-go disabled={!ready || busy} onClick={() => void go()}>
            {busy ? t("ui.saving") : t("fl.vn.save")}
          </button>
        </>
      }
    >
      <fieldset className="crm-fields" disabled={busy}>
        <div className="crm-field-pair">
          <div>
            <label className="crm-label" htmlFor="crm-vd-hire-from">
              {t("vandays.hire.from")}
            </label>
            <input id="crm-vd-hire-from" data-autofocus type="date" className="crm-input crm-mono mr-fld" value={from} aria-invalid={outside !== undefined && (dayOfRow(outside) ?? "") < from ? true : undefined} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div>
            <label className="crm-label" htmlFor="crm-vd-hire-to">
              {t("vandays.hire.to")}
            </label>
            <input id="crm-vd-hire-to" type="date" className="crm-input crm-mono mr-fld" value={to} aria-invalid={(outside !== undefined && (dayOfRow(outside) ?? "") > to) || order ? true : undefined} onChange={(event) => setTo(event.target.value)} />
          </div>
        </div>
        {given.length > 0 && (
          <div className="crm-vd-given" data-testid="vd-given">
            <div className="crm-fl-eyebrow">{t("vandays.hire.given")}</div>
            <ul>
              {given.map((row) => (
                <li key={row.id}>{t("vandays.hire.givenRow", { day: dayWords(f, dayOfRow(row)!), crew: facts?.crews.get(row.crew_id) ?? "" })}</li>
              ))}
            </ul>
          </div>
        )}
        {outside !== undefined && (
          <div className="crm-form-error" role="alert" data-testid="vd-hire-refused">
            <Icon name="circle-slash" size={15} />
            <span>{t("vandays.hire.refused", { crew: facts?.crews.get(outside.crew_id) ?? "", day: dayWords(f, dayOfRow(outside)!) })}</span>
          </div>
        )}
        {order && outside === undefined && (
          <div className="crm-form-error" role="alert">
            <Icon name="circle-slash" size={15} />
            <span>{t("vandays.hire.order")}</span>
          </div>
        )}
      </fieldset>
      <FormError text={error} />
    </Dialog>
  );
}

/** "Add a hired vehicle": its name, plate, model, and From and To; every field is asked for (M3 4e/4f). */
export function AddHiredDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useFleetScreen();
  const [draft, setDraft] = useState({ name: "", plate: "", model: "", from: "", to: "" });
  const [key] = useState(() => newClientKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (column: keyof typeof draft, value: string): void => setDraft((was) => ({ ...was, [column]: value }));
  const days = /^\d{4}-\d{2}-\d{2}$/.test(draft.from) && /^\d{4}-\d{2}-\d{2}$/.test(draft.to);
  const order = days && draft.to < draft.from;
  const ready = draft.name.trim() !== "" && draft.plate.trim() !== "" && draft.model.trim() !== "" && days && !order;
  const go = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const values: Row = { name: draft.name.trim(), plate: draft.plate.trim().toUpperCase(), model: draft.model.trim(), hired: true, hired_from: draft.from, hired_to: draft.to };
    const saved = await session.create<Vehicle>("vehicles", values, key);
    setBusy(false);
    if (saved.state === "refused") return setError(t("ui.refused", { reason: reasonOf(saved.error, t) }));
    if (saved.state === "unknown") return setError(t("ui.unknown"));
    toasts.show(t("vandays.add.done", { vehicle: draft.name.trim(), from: dayWords(f, draft.from), to: dayWords(f, draft.to) }), "pos");
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
      name="vd-add-hired"
      icon="truck"
      title={t("vandays.add")}
      subtitle={t("vandays.add.sub")}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("ui.cancel")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 crm-btn-wide mr-btn" data-go disabled={!ready || busy} onClick={() => void go()}>
            {busy ? t("ui.saving") : t("vandays.add.go")}
          </button>
        </>
      }
    >
      <fieldset className="crm-fields" disabled={busy}>
        {field("crm-vd-add-name", t("vandays.add.name"), <input id="crm-vd-add-name" data-autofocus className="crm-input mr-fld" value={draft.name} maxLength={80} placeholder={t("vandays.add.name.ph")} onChange={(event) => set("name", event.target.value)} />)}
        <div className="crm-field-pair">
          {field("crm-vd-add-plate", t("vandays.add.plate"), <input id="crm-vd-add-plate" className="crm-input crm-mono crm-vd-upper mr-fld" dir="ltr" value={draft.plate} maxLength={20} placeholder="AB12 CDE" onChange={(event) => set("plate", event.target.value)} />)}
          {field("crm-vd-add-model", t("vandays.add.model"), <input id="crm-vd-add-model" className="crm-input mr-fld" value={draft.model} maxLength={120} placeholder={t("vandays.add.model.ph")} onChange={(event) => set("model", event.target.value)} />)}
        </div>
        <div className="crm-field-pair">
          {field("crm-vd-add-from", t("vandays.hire.from"), <input id="crm-vd-add-from" type="date" className="crm-input crm-mono mr-fld" value={draft.from} onChange={(event) => set("from", event.target.value)} />)}
          {field("crm-vd-add-to", t("vandays.hire.to"), <input id="crm-vd-add-to" type="date" className="crm-input crm-mono mr-fld" value={draft.to} aria-invalid={order ? true : undefined} onChange={(event) => set("to", event.target.value)} />)}
        </div>
        {order && (
          <div className="crm-form-error" role="alert">
            <Icon name="circle-slash" size={15} />
            <span>{t("vandays.hire.order")}</span>
          </div>
        )}
      </fieldset>
      <FormError text={error} />
    </Dialog>
  );
}
