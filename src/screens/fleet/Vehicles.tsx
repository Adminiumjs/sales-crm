/**
 * VEHICLES (ledger screen 57): each vehicle, its service, inspection and tax,
 * its reading, its newest walk-round and the faults not yet fixed; a vehicle
 * added and changed. For the operations manager and the CRM admin; Read-only
 * reads it with nothing to press.
 *
 * The three counts are the server's (`readVehicleFigures`); "8 days over" and
 * "in 11 days" take a day from the server's own today. A walk-round is the
 * crew's, made on the phone before a day ("My vehicle"): the office reads its
 * newest one and does not tick it.
 */
import { useCallback, useState, type ReactNode } from "react";

import { useT } from "../../i18n/index.tsx";
import { addDays } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { fileSrc } from "../crew/data.ts";
import { CHECK_TICKS, changedOf, daysSince, dayKeyOf, fixFault, missingTicks, num, readLastChecks, readOpenFaults, readVehicleFigures, readVehicles, truthy, vehicleValues, type Check, type Fault, type Vehicle, type VehicleDraft } from "./data.ts";
import { dateWords, dayWords, distanceOf, Figure, FormError, useFleetScreen, useFleetSettings, useOpens, useUnitWords, type FleetSettings } from "./parts.tsx";

interface Crewed extends Record<string, unknown> {
  id: number;
  name: string;
  vehicle_id: number | null;
}

export function Vehicles(_props: ScreenProps) {
  const t = useT();
  const { session, f, today, tick } = useFleetScreen();
  const opens = useOpens();
  const { load: settingsLoad } = useFleetSettings(session);
  const settings: FleetSettings = settingsLoad.state === "ready" ? settingsLoad.data : { unit: "km", inspectionWarnDays: 30 };
  const crews = session.part("jobs") && session.can("crews", "read");
  const settled = settingsLoad.state !== "loading";
  const { load, reload } = useLoad(async () => {
    // The window of "inspection due" is a setting: read once it is known, not twice.
    if (!settled) return new Promise<never>(() => undefined);
    const [vehicles, figures, faults, crewRows] = await Promise.all([
      readVehicles(session),
      readVehicleFigures(session, today, addDays(today, settings.inspectionWarnDays)),
      readOpenFaults(session),
      crews ? session.list<Crewed>("crews", { select: ["id", "name", "vehicle_id"], limit: 50 }).then((page) => page.rows) : Promise.resolve([] as Crewed[]),
    ]);
    const checks = await readLastChecks(session, vehicles);
    return { vehicles, figures, faults, crews: crewRows, checks };
  }, [session, today, settings.inspectionWarnDays, crews, settled]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  // A fill moves a vehicle's reading (the server's total of its fills), so the fills are heard too.
  useLive(["vehicles", "vehicle_checks", "vehicle_faults", "fuel_fills", ...(crews ? ["crews"] : [])], again);
  const [editing, setEditing] = useState<{ vehicle: Vehicle | null; focus: "name" | "service" } | null>(null);
  const canAdd = session.can("vehicles", "create");

  return (
    <div className="crm-screen crm-fl mr-screen" data-screen="vehicles">
      <div className="crm-screen-head">
        <div>
          <h1>{t("fl.vn.title")}</h1>
          {load.state === "ready" && <p className="crm-screen-sub crm-fl-lead">{t("fl.vn.sub", { ours: f.number(load.data.figures.ours), hired: f.number(load.data.figures.hired) })}</p>}
        </div>
        {canAdd && (
          <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" data-testid="fl-vn-add" onClick={() => setEditing({ vehicle: null, focus: "name" })}>
            <Icon name="plus" />
            {t("fl.vn.add")}
          </button>
        )}
      </div>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={150} />}>
        {(data) => {
          const over = data.vehicles.filter((vehicle) => vehicle.service_due !== null && (dayKeyOf(vehicle.service_due) ?? "9999") < today);
          const soon = data.vehicles.filter((vehicle) => {
            const day = dayKeyOf(vehicle.inspection_due);
            return day !== null && day >= today && daysSince(f, today, day) <= settings.inspectionWarnDays;
          });
          return (
            <>
              <div className="crm-kpis crm-fl-stats">
                <Figure name="service-over" label={t("fl.vn.stat.over")} value={f.number(data.figures.serviceOver)} tone={data.figures.serviceOver > 0 ? "danger" : "pos"} sub={data.figures.serviceOver > 0 ? t("fl.vn.stat.over.sub") : t("fl.vn.stat.over.none")} />
                <Figure
                  name="inspection-soon"
                  label={t("fl.vn.stat.soon", { days: f.number(settings.inspectionWarnDays) })}
                  value={f.number(data.figures.inspectionSoon)}
                  tone={data.figures.inspectionSoon > 0 ? "warn" : "pos"}
                  sub={data.figures.inspectionSoon > 0 ? soon.map((vehicle) => t("fl.vn.stat.soon.one", { plate: vehicle.plate ?? vehicle.name, days: f.number(daysSince(f, today, dayKeyOf(vehicle.inspection_due)!)) })).join(", ") : t("fl.vn.stat.soon.none")}
                />
                <Figure name="vehicles" label={t("fl.vn.stat.all")} value={f.number(data.figures.vehicles)} sub={t("fl.vn.stat.all.sub", { ours: f.number(data.figures.ours), hired: f.number(data.figures.hired) })} />
              </div>
              {data.figures.serviceOver > 0 && (
                <div className="crm-banner" data-tone="danger" data-testid="fl-vn-over">
                  <Icon name="wrench" size={16} />
                  <span>
                    {data.figures.serviceOver === 1 && over[0] !== undefined
                      ? t("fl.vn.over.one", { plate: over[0].plate ?? over[0].name, day: dayWords(f, dayKeyOf(over[0].service_due)!) })
                      : t("fl.vn.over.many", { count: f.number(data.figures.serviceOver) }, data.figures.serviceOver)}
                  </span>
                </div>
              )}
              {data.vehicles.length === 0 ? (
                <div className="crm-empty" data-testid="fl-vn-empty">
                  <span className="crm-empty-icon">
                    <Icon name="truck" size={20} />
                  </span>
                  <div className="crm-empty-title">{t("fl.vn.empty")}</div>
                  <p>{canAdd ? t("fl.vn.empty.body") : t("fl.vn.empty.ask")}</p>
                </div>
              ) : (
                <ul className="crm-fl-list">
                  {data.vehicles.map((vehicle) => (
                    <VehicleCard
                      key={vehicle.id}
                      vehicle={vehicle}
                      crew={data.crews.find((crew) => crew.vehicle_id === vehicle.id) ?? null}
                      crewsKnown={crews}
                      check={data.checks.get(vehicle.id) ?? null}
                      faults={data.faults.filter((fault) => fault.vehicle_id === vehicle.id)}
                      faultCount={data.figures.faultsBy.get(vehicle.id) ?? 0}
                      settings={settings}
                      onEdit={(focus) => setEditing({ vehicle, focus })}
                      onRoute={opens("route")}
                      onChanged={again}
                    />
                  ))}
                </ul>
              )}
            </>
          );
        }}
      </Loaded>
      {editing !== null && <VehicleDialog vehicle={editing.vehicle} focus={editing.focus} unit={settings.unit} onClose={() => setEditing(null)} onDone={again} />}
    </div>
  );
}

function VehicleCard({ vehicle, crew, crewsKnown, check, faults, faultCount, settings, onEdit, onRoute, onChanged }: { vehicle: Vehicle; crew: Crewed | null; crewsKnown: boolean; check: Check | null; faults: Fault[]; faultCount: number; settings: FleetSettings; onEdit: (focus: "name" | "service") => void; onRoute: boolean; onChanged: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f, today } = useFleetScreen();
  const unit = useUnitWords(settings.unit);
  const service = dayKeyOf(vehicle.service_due);
  const inspection = dayKeyOf(vehicle.inspection_due);
  const tax = dayKeyOf(vehicle.tax_to);
  const overBy = service === null ? 0 : daysSince(f, service, today);
  const inspectionIn = inspection === null ? null : daysSince(f, today, inspection);
  const inspectionSoon = inspectionIn !== null && inspectionIn >= 0 && inspectionIn <= settings.inspectionWarnDays;
  const bad = overBy > 0 || inspectionSoon || (inspectionIn !== null && inspectionIn < 0);
  const missing = check === null ? [...CHECK_TICKS] : missingTicks(check);
  const canEdit = session.can("vehicles", "update");
  const canFix = session.can("vehicle_faults", "update");
  const [fixing, setFixing] = useState<number | null>(null);
  const reading = vehicle.reading ?? vehicle.odometer;

  const fix = async (fault: Fault): Promise<void> => {
    setFixing(fault.id);
    const saved = await fixFault(session, fault, today);
    setFixing(null);
    if (saved.state === "saved") toasts.show(t("fl.vn.fault.fixed", { vehicle: vehicle.name }), "pos");
    else if (saved.state === "refused") toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    else toasts.show(t("ui.unknown"), "danger", true);
    onChanged();
  };

  return (
    <li className="crm-fl-card mr-card" data-vehicle={vehicle.id} data-tone={bad ? "danger" : undefined}>
      <div className="crm-fl-card-top">
        <span className="crm-fl-tile" data-hired={truthy(vehicle.hired) ? "1" : undefined} aria-hidden="true">
          <Icon name="truck" size={18} />
        </span>
        <div className="crm-fl-card-words">
          <div className="crm-fl-card-line">
            <h2 className="crm-fl-name">{vehicle.name}</h2>
            {vehicle.plate !== null && <span className="crm-fl-plate crm-mono" dir="ltr">{vehicle.plate}</span>}
            {truthy(vehicle.hired) && <span className="crm-pill">{t("fl.vn.hired")}</span>}
          </div>
          <div className="crm-fl-quiet" data-testid="fl-vn-model">
            {[vehicle.model, crewsKnown ? (crew === null ? t("fl.vn.noCrew") : crew.name) : null].filter((part) => part !== null && part !== "").join(" · ")}
          </div>
        </div>
        <div className="crm-fl-card-end">
          <div className="crm-mono crm-fl-reading" data-testid="fl-vn-reading">
            {reading === null ? "—" : `${distanceOf(f, num(reading))} ${unit.short}`}
          </div>
          <div className="crm-mono crm-fl-quiet" data-tone={check === null ? "warn" : undefined} data-testid="fl-vn-last">
            {check === null ? t("fl.vn.never") : t("fl.vn.walked", { day: dayWords(f, dayKeyOf(check.day)!), done: f.number(CHECK_TICKS.length - missing.length), of: f.number(CHECK_TICKS.length) })}
          </div>
        </div>
      </div>
      <div className="crm-fl-facts">
        <span className="crm-fl-fact" data-fact="service">
          {t("fl.vn.service")}
          <span className="crm-pill" data-tone={overBy > 0 ? "danger" : undefined} data-testid="fl-vn-service">
            {service === null ? t("fl.vn.none") : overBy > 0 ? t("fl.vn.service.over", { days: f.number(overBy) }, overBy) : t("fl.vn.service.due", { day: dateWords(f, service) })}
          </span>
        </span>
        <span className="crm-fl-fact" data-fact="inspection">
          {t("fl.vn.inspection")}
          <span className="crm-pill" data-tone={inspectionSoon || (inspectionIn !== null && inspectionIn < 0) ? "warn" : undefined} data-testid="fl-vn-inspection">
            {inspection === null ? t("fl.vn.none") : inspectionSoon ? t("fl.vn.inspection.soon", { day: dateWords(f, inspection), days: f.number(inspectionIn!) }, inspectionIn!) : dateWords(f, inspection)}
          </span>
        </span>
        <span className="crm-fl-fact" data-fact="tax">
          {t("fl.vn.tax")}
          <span className="crm-pill">{tax === null ? t("fl.vn.none") : dateWords(f, tax)}</span>
        </span>
      </div>
      {faults.length > 0 && (
        <ul className="crm-fl-faults" aria-label={t("fl.vn.faults", { count: f.number(faultCount) }, faultCount)} data-testid="fl-vn-faults">
          {faults.map((fault) => (
            <li key={fault.id} className="crm-fl-fault" data-fault={fault.id}>
              <Icon name="triangle-alert" size={13} />
              {fault.photo !== null && fault.photo !== "" && <img className="crm-fl-fault-photo" src={fileSrc(fault.photo)} alt={t("fl.vn.fault.photo", { text: fault.text })} />}
              <span className="crm-fl-fault-text">
                {fault.text}
                <span className="crm-fl-quiet"> · {dayWords(f, dayKeyOf(fault.raised_on)!)}</span>
              </span>
              {canFix && (
                <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" disabled={fixing === fault.id} onClick={() => void fix(fault)}>
                  <Icon name="check" size={14} />
                  {t("fl.vn.fault.fix")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="crm-fl-walk">
        <div className="crm-fl-walk-head">
          <span className="crm-fl-eyebrow">{t("fl.vn.walk")}</span>
          <span className="crm-fl-walk-line" data-tone={check === null ? "warn" : missing.length === 0 ? "pos" : "warn"} data-testid="fl-vn-walk">
            {check === null ? t("fl.vn.walk.none") : missing.length === 0 ? t("fl.vn.walk.all") : missing.length === 1 ? t("fl.vn.walk.one", { tick: t(`fl.tick.${missing[0]!}`) }) : t("fl.vn.walk.left", { count: f.number(missing.length) }, missing.length)}
          </span>
        </div>
        {check !== null && (
          <ul className="crm-fl-ticks" aria-label={t("fl.vn.walk")}>
            {CHECK_TICKS.map((tick) => (
              <li key={tick} className="crm-fl-tick" data-on={truthy(check[tick]) ? "1" : "0"} data-tick={tick}>
                <span className="crm-fl-tickbox" aria-hidden="true">
                  {truthy(check[tick]) && <Icon name="check" size={11} />}
                </span>
                <span>{t(`fl.tick.${tick}`)}</span>
                <span className="mr-sr-only">{truthy(check[tick]) ? t("fl.tick.on") : t("fl.tick.off")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {(canEdit || (onRoute && crew !== null)) && (
        <div className="crm-fl-card-foot">
          {canEdit && overBy > 0 && (
            <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-testid="fl-vn-book" onClick={() => onEdit("service")}>
              <Icon name="wrench" size={14} />
              {t("fl.vn.book")}
            </button>
          )}
          {canEdit && (
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-testid="fl-vn-edit" onClick={() => onEdit("name")}>
              <Icon name="pencil" size={14} />
              {t("fl.vn.edit")}
            </button>
          )}
          {onRoute && crew !== null && (
            <ScreenLink to="route" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
              <Icon name="route" size={14} />
              {t("fl.vn.route")}
            </ScreenLink>
          )}
        </div>
      )}
    </li>
  );
}

/** Add a vehicle, or change one: what the office knows of it. "Book it in" opens this on the service day. */
function VehicleDialog({ vehicle, focus, unit, onClose, onDone }: { vehicle: Vehicle | null; focus: "name" | "service"; unit: "km" | "miles"; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useFleetScreen();
  const words = useUnitWords(unit);
  const [draft, setDraft] = useState<VehicleDraft>(() => ({
    name: vehicle?.name ?? "",
    plate: vehicle?.plate ?? "",
    model: vehicle?.model ?? "",
    odometer: vehicle?.odometer ?? null,
    inspection_due: dayKeyOf(vehicle?.inspection_due) ?? "",
    service_due: dayKeyOf(vehicle?.service_due) ?? "",
    tax_to: dayKeyOf(vehicle?.tax_to) ?? "",
    hired: vehicle === null ? false : truthy(vehicle.hired),
  }));
  const [odometer, setOdometer] = useState(vehicle?.odometer === null || vehicle?.odometer === undefined ? "" : String(vehicle.odometer));
  const [key] = useState(() => newClientKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reading = odometer.trim() === "" ? null : f.readAmount(odometer);
  const ready = draft.name.trim() !== "" && (odometer.trim() === "" || (reading !== null && Number.isInteger(reading)));
  const set = <K extends keyof VehicleDraft>(column: K, value: VehicleDraft[K]): void => setDraft((was) => ({ ...was, [column]: value }));

  const go = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const values = vehicleValues({ ...draft, odometer: reading });
    const saved = vehicle === null ? await session.create<Vehicle>("vehicles", values, key) : await (async () => {
      const { values: changed, seen } = changedOf(vehicle, values);
      return Object.keys(changed).length === 0 ? ({ state: "saved", row: vehicle, replayed: false, readBack: false } as const) : session.update<Vehicle>("vehicles", vehicle.id, changed, { seen });
    })();
    setBusy(false);
    if (saved.state === "refused") return setError(t("ui.refused", { reason: reasonOf(saved.error, t) }));
    if (saved.state === "unknown") return setError(t("ui.unknown"));
    toasts.show(t(vehicle === null ? "fl.vn.added" : "fl.vn.saved", { vehicle: draft.name.trim() }), "pos");
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
      name="fl-vehicle"
      icon="truck"
      title={vehicle === null ? t("fl.vn.add") : focus === "service" ? t("fl.vn.book.title", { vehicle: vehicle.name }) : t("fl.vn.edit.title", { vehicle: vehicle.name })}
      subtitle={focus === "service" ? t("fl.vn.book.sub") : undefined}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("ui.cancel")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 crm-btn-wide mr-btn" data-go disabled={!ready || busy} onClick={() => void go()}>
            {busy ? t("ui.saving") : vehicle === null ? t("fl.vn.add.go") : t("fl.vn.save")}
          </button>
        </>
      }
    >
      <fieldset className="crm-fields" disabled={busy}>
        {field("crm-fl-vn-name", t("fl.vn.f.name"), <input id="crm-fl-vn-name" {...(focus === "name" ? { "data-autofocus": true } : {})} className="crm-input mr-fld" value={draft.name} maxLength={80} onChange={(event) => set("name", event.target.value)} />)}
        <div className="crm-field-pair">
          {field("crm-fl-vn-plate", t("fl.vn.f.plate"), <input id="crm-fl-vn-plate" className="crm-input crm-mono mr-fld" dir="ltr" value={draft.plate} maxLength={20} onChange={(event) => set("plate", event.target.value)} />)}
          {field("crm-fl-vn-odo", t("fl.vn.f.odometer", { unit: words.short }), <input id="crm-fl-vn-odo" className="crm-input crm-mono mr-fld" inputMode="numeric" value={odometer} onChange={(event) => setOdometer(event.target.value)} />)}
        </div>
        {field("crm-fl-vn-model", t("fl.vn.f.model"), <input id="crm-fl-vn-model" className="crm-input mr-fld" value={draft.model} maxLength={120} onChange={(event) => set("model", event.target.value)} />)}
        <div className="crm-field-pair">
          {field("crm-fl-vn-service", t("fl.vn.f.service"), <input id="crm-fl-vn-service" {...(focus === "service" ? { "data-autofocus": true } : {})} type="date" className="crm-input mr-fld" value={draft.service_due} onChange={(event) => set("service_due", event.target.value)} />)}
          {field("crm-fl-vn-inspection", t("fl.vn.f.inspection"), <input id="crm-fl-vn-inspection" type="date" className="crm-input mr-fld" value={draft.inspection_due} onChange={(event) => set("inspection_due", event.target.value)} />)}
        </div>
        <div className="crm-field-pair">
          {field("crm-fl-vn-tax", t("fl.vn.f.tax"), <input id="crm-fl-vn-tax" type="date" className="crm-input mr-fld" value={draft.tax_to} onChange={(event) => set("tax_to", event.target.value)} />)}
          <label className="crm-fl-checkline">
            <input type="checkbox" checked={draft.hired} onChange={(event) => set("hired", event.target.checked)} />
            <span>{t("fl.vn.f.hired")}</span>
          </label>
        </div>
        {vehicle !== null && vehicle.reading !== null && vehicle.reading !== vehicle.odometer && <p className="crm-field-note">{t("fl.vn.f.reading", { reading: `${distanceOf(f, num(vehicle.reading))} ${words.short}` })}</p>}
      </fieldset>
      <FormError text={error} />
    </Dialog>
  );
}

