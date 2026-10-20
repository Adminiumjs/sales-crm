/**
 * MY VEHICLE, on the field crew's phone (P25): the vehicle his crew is given,
 * its walk-round before the day, a fault reported with a photo, and a fuel
 * fill. Reached from My day and from his menu while Vehicles and crew is on.
 *
 * The server holds him to his crew's vehicle: he reads that one alone, and a
 * check, a fault or a fill for any other is refused as a vehicle that is not
 * there (`proofs/crm-fleet.test.ts`). Each is ONE create with a retry key:
 * a lost reply is sent again with the same key (the line "No connection" and
 * its "Try again", as on My day), and the server answers the row the first
 * one made. Nothing is kept on the phone (ruling Q1, online only).
 *
 * A fill's distance is the server's (the fill's reading less the vehicle's
 * reading before it); the phone shows what came back.
 */
import { useCallback, useMemo, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { fileSrc } from "../crew/data.ts";
import { PhotoField } from "../crew/FileParts.tsx";
import { NoConnection, useConnection, type Connection } from "../crew/Offline.tsx";
import { addCheck, addFault, addFill, CHECK_TICKS, dayKeyOf, num, readChecksOn, readFills, readOpenFaults, readVehicles, truthy, type Check, type CheckTick, type Fault, type Fill, type Vehicle } from "./data.ts";
import { dayWords, distanceOf, oneDecimal, useFleetScreen, useFleetSettings, useUnitWords } from "./parts.tsx";

interface VanData {
  vehicles: Vehicle[];
  checks: Check[];
  faults: Fault[];
  fills: Fill[];
  names: Record<string, string>;
}

export function MyVehicle({ rest }: ScreenProps) {
  const t = useT();
  const { session, f, today, tick } = useFleetScreen();
  const conn = useConnection();
  const { load: settingsLoad } = useFleetSettings(session);
  const unit = useUnitWords(settingsLoad.state === "ready" ? settingsLoad.data.unit : "km");
  const { load, reload } = useLoad<VanData>(async () => {
    const [vehicles, checks, faults, fills, people] = await Promise.all([readVehicles(session), readChecksOn(session, today), readOpenFaults(session), readFills(session, null, 20), session.people(undefined, 200).catch(() => [])]);
    return { vehicles, checks, faults, fills, names: Object.fromEntries(people.map((person) => [person.id, person.name])) };
  }, [session, today]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["vehicles", "vehicle_checks", "vehicle_faults", "fuel_fills"], again);
  const wanted = rest[0] !== undefined && /^\d+$/.test(rest[0]) ? Number(rest[0]) : null;
  const [picked, setPicked] = useState<number | null>(wanted);
  const failed = load.state === "failed";

  return (
    <div className="crm-cw crm-fl-phone mr-screen" data-screen="myvan">
      <div className="crm-cw-head">
        <h1>{t("fl.my.title")}</h1>
      </div>
      {(conn.down || failed) && (
        <NoConnection
          tried={conn.tried}
          busy={conn.busy}
          onRetry={() => {
            if (failed) {
              reload();
              conn.back();
            } else conn.retry();
          }}
        />
      )}
      {load.state === "loading" ? (
        <Skeleton rows={3} height={160} />
      ) : load.state === "refused" ? (
        <p className="crm-cw-quiet">{t("ui.refused", { reason: reasonOf(load.error, t) })}</p>
      ) : load.state === "ready" ? (
        load.data.vehicles.length === 0 ? (
          <div className="crm-empty crm-cw-empty" data-testid="fl-my-none">
            <span className="crm-empty-icon">
              <Icon name="truck" size={20} />
            </span>
            <div className="crm-empty-title">{t("fl.my.none")}</div>
            <p>{t("fl.my.none.body")}</p>
          </div>
        ) : (
          (() => {
            const vehicle = load.data.vehicles.find((one) => one.id === picked) ?? load.data.vehicles[0]!;
            return (
              <>
                {load.data.vehicles.length > 1 && (
                  <div className="crm-chips" role="group" aria-label={t("fl.my.pick")}>
                    {load.data.vehicles.map((one) => (
                      <button key={one.id} type="button" className="crm-chip-btn mr-chip" aria-pressed={one.id === vehicle.id} onClick={() => setPicked(one.id)}>
                        {one.name}
                      </button>
                    ))}
                  </div>
                )}
                <Van
                  key={vehicle.id}
                  vehicle={vehicle}
                  checks={load.data.checks.filter((check) => check.vehicle_id === vehicle.id && dayKeyOf(check.day) === today)}
                  faults={load.data.faults.filter((fault) => fault.vehicle_id === vehicle.id)}
                  fills={load.data.fills.filter((fill) => fill.vehicle_id === vehicle.id)}
                  names={load.data.names}
                  unit={unit}
                  conn={conn}
                  onChanged={again}
                />
              </>
            );
          })()
        )
      ) : null}
      <p className="crm-cw-quiet crm-fl-my-foot">{t("fl.my.foot", { day: dayWords(f, today) })}</p>
    </div>
  );
}

function Van({ vehicle, checks, faults, fills, names, unit, conn, onChanged }: { vehicle: Vehicle; checks: Check[]; faults: Fault[]; fills: Fill[]; names: Record<string, string>; unit: { short: string; per100: string }; conn: Connection; onChanged: () => void }) {
  const t = useT();
  const { f } = useFleetScreen();
  const reading = vehicle.reading ?? vehicle.odometer;
  return (
    <>
      <div className="crm-fl-my-van mr-card" data-vehicle={vehicle.id}>
        <span className="crm-fl-tile" aria-hidden="true">
          <Icon name="truck" size={18} />
        </span>
        <div>
          <h2 className="crm-fl-name" data-testid="fl-my-name">
            {vehicle.name}
          </h2>
          <div className="crm-fl-quiet">{[vehicle.plate, vehicle.model].filter((part) => part !== null && part !== "").join(" · ")}</div>
        </div>
        <div className="crm-fl-card-end">
          <div className="crm-mono crm-fl-reading" data-testid="fl-my-reading">
            {reading === null ? "—" : `${distanceOf(f, num(reading))} ${unit.short}`}
          </div>
          <div className="crm-fl-quiet">{t("fl.my.reading")}</div>
        </div>
      </div>
      <CheckPart vehicle={vehicle} done={checks} names={names} conn={conn} onChanged={onChanged} />
      <FaultPart vehicle={vehicle} faults={faults} conn={conn} onChanged={onChanged} />
      <FillPart vehicle={vehicle} last={fills[0] ?? null} unit={unit} conn={conn} onChanged={onChanged} />
    </>
  );
}

const NO_TICKS: Record<CheckTick, boolean> = { tyres: false, fluids: false, lights: false, straps: false, tail_lift: false };

/** The walk-round before the day: the five ticks, saved as one check. Once somebody of the crew has checked the van today, the phone says who. */
function CheckPart({ vehicle, done, names, conn, onChanged }: { vehicle: Vehicle; done: Check[]; names: Record<string, string>; conn: Connection; onChanged: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f, today } = useFleetScreen();
  const [ticks, setTicks] = useState<Record<CheckTick, boolean>>(NO_TICKS);
  const [key, setKey] = useState(() => newClientKey());
  const [busy, setBusy] = useState(false);
  const [again, setAgain] = useState(false);
  const canCheck = session.can("vehicle_checks", "create");
  const last = done[0] ?? null;
  const count = CHECK_TICKS.filter((tick) => ticks[tick]).length;

  const save = async (): Promise<boolean> => {
    setBusy(true);
    const saved = await addCheck(session, vehicle.id, today, ticks, key);
    setBusy(false);
    if (saved.state === "unknown") {
      conn.lost(save);
      return false;
    }
    conn.back();
    if (saved.state === "refused") {
      toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
      return true;
    }
    const missing = CHECK_TICKS.filter((tick) => !ticks[tick]);
    toasts.show(missing.length === 0 ? t("fl.my.check.saved", { vehicle: vehicle.name }) : t("fl.my.check.savedMissing", { vehicle: vehicle.name, list: missing.map((tick) => t(`fl.tick.${tick}`)).join(", ") }), missing.length === 0 ? "pos" : "plain", missing.length > 0);
    setTicks(NO_TICKS);
    setKey(newClientKey());
    setAgain(false);
    onChanged();
    return true;
  };

  return (
    <section className="crm-fl-my-part mr-card" aria-labelledby="crm-fl-my-check" data-testid="fl-my-check">
      <h2 id="crm-fl-my-check" className="crm-fl-my-head">
        <Icon name="clipboard-check" size={16} />
        {t("fl.my.check")}
      </h2>
      {last !== null && !again ? (
        <>
          <p className="crm-fl-my-done" data-testid="fl-my-checked">
            <Icon name="check" size={14} />
            {t("fl.my.checked", { name: names[last.by_id] ?? t("fl.fu.someone"), day: dayWords(f, today) })}
          </p>
          <ul className="crm-fl-ticks">
            {CHECK_TICKS.map((tick) => (
              <li key={tick} className="crm-fl-tick" data-on={truthy(last[tick]) ? "1" : "0"} data-tick={tick}>
                <span className="crm-fl-tickbox" aria-hidden="true">
                  {truthy(last[tick]) && <Icon name="check" size={11} />}
                </span>
                <span>{t(`fl.tick.${tick}`)}</span>
                <span className="mr-sr-only">{truthy(last[tick]) ? t("fl.tick.on") : t("fl.tick.off")}</span>
              </li>
            ))}
          </ul>
          {canCheck && (
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" onClick={() => setAgain(true)}>
              <Icon name="rotate-ccw" size={14} />
              {t("fl.my.check.again")}
            </button>
          )}
        </>
      ) : canCheck ? (
        <>
          <p className="crm-cw-quiet">{t("fl.my.check.body")}</p>
          <div className="crm-fl-my-ticks" role="group" aria-label={t("fl.my.check")}>
            {CHECK_TICKS.map((tick) => (
              <button key={tick} type="button" className="crm-fl-my-tick mr-row" role="checkbox" aria-checked={ticks[tick]} data-tick={tick} disabled={busy} onClick={() => setTicks((was) => ({ ...was, [tick]: !was[tick] }))}>
                <span className="crm-cw-box" aria-hidden="true">
                  {ticks[tick] && <Icon name="check" size={14} />}
                </span>
                <span>{t(`fl.tick.${tick}`)}</span>
              </button>
            ))}
          </div>
          <div className="crm-fl-my-foot-row">
            <span className="crm-cw-quiet crm-mono" data-testid="fl-my-ticked">
              {t("fl.my.ticked", { n: f.number(count), of: f.number(CHECK_TICKS.length) })}
            </span>
            <button type="button" className="crm-btn crm-btn-primary crm-btn-44 mr-btn" data-testid="fl-my-check-go" disabled={busy} onClick={() => void save()}>
              <Icon name="check" />
              {busy ? t("ui.saving") : t("fl.my.check.go")}
            </button>
          </div>
        </>
      ) : (
        <p className="crm-cw-quiet">{t("fl.my.check.none")}</p>
      )}
    </section>
  );
}

/** A fault reported with a photo: one create with a key. The faults not yet fixed are listed under it. */
function FaultPart({ vehicle, faults, conn, onChanged }: { vehicle: Vehicle; faults: Fault[]; conn: Connection; onChanged: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useFleetScreen();
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const [key, setKey] = useState(() => newClientKey());
  const canReport = session.can("vehicle_faults", "create");
  const onPhotos = useCallback((ids: string[]) => setPhoto(ids[0] ?? null), []);

  const save = async (): Promise<boolean> => {
    if (text.trim() === "" || sending) return true;
    setBusy(true);
    const saved = await addFault(session, vehicle.id, text, photo, key);
    setBusy(false);
    if (saved.state === "unknown") {
      conn.lost(save);
      return false;
    }
    conn.back();
    if (saved.state === "refused") {
      toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
      return true;
    }
    toasts.show(t("fl.my.fault.saved", { vehicle: vehicle.name }), "pos");
    setText("");
    setPhoto(null);
    setKey(newClientKey());
    setRound((n) => n + 1);
    onChanged();
    return true;
  };

  return (
    <section className="crm-fl-my-part mr-card" aria-labelledby="crm-fl-my-fault" data-testid="fl-my-fault">
      <h2 id="crm-fl-my-fault" className="crm-fl-my-head">
        <Icon name="triangle-alert" size={16} />
        {t("fl.my.fault")}
      </h2>
      {faults.length > 0 && (
        <ul className="crm-fl-faults" data-testid="fl-my-faults">
          {faults.map((fault) => (
            <li key={fault.id} className="crm-fl-fault" data-fault={fault.id}>
              {fault.photo !== null && fault.photo !== "" && <img className="crm-fl-fault-photo" src={fileSrc(fault.photo)} alt={t("fl.vn.fault.photo", { text: fault.text })} />}
              <span className="crm-fl-fault-text">
                {fault.text}
                <span className="crm-fl-quiet"> · {dayWords(f, dayKeyOf(fault.raised_on)!)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {canReport && (
        <div className="crm-cw-add">
          <label className="crm-label" htmlFor="crm-fl-my-fault-text">
            {t("fl.my.fault.what")}
          </label>
          <textarea id="crm-fl-my-fault-text" className="crm-input crm-textarea mr-fld" rows={2} value={text} maxLength={300} disabled={busy} onChange={(event) => setText(event.target.value)} />
          <PhotoField table="vehicle_faults" column="photo" label={t("fl.my.fault.photo")} max={1} round={round} onChange={onPhotos} onBusy={setSending} disabled={busy} />
          <div className="crm-cw-add-foot">
            <button type="button" className="crm-btn crm-btn-primary crm-btn-44 mr-btn" data-testid="fl-my-fault-go" disabled={busy || sending || text.trim() === ""} onClick={() => void save()}>
              <Icon name="send" />
              {busy ? t("ui.saving") : t("fl.my.fault.go")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** A fuel fill: litres, what it cost and the reading, saved as one create with a key; the server measures the distance from the reading before it. */
function FillPart({ vehicle, last, unit, conn, onChanged }: { vehicle: Vehicle; last: Fill | null; unit: { short: string; per100: string }; conn: Connection; onChanged: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f, today } = useFleetScreen();
  const [litres, setLitres] = useState("");
  const [cost, setCost] = useState("");
  const [odometer, setOdometer] = useState("");
  const [key, setKey] = useState(() => newClientKey());
  const [busy, setBusy] = useState(false);
  const canFill = session.can("fuel_fills", "create");
  const reading = vehicle.reading ?? vehicle.odometer;
  const read = useMemo(() => ({ litres: f.readAmount(litres), cost: f.readAmount(cost), odometer: f.readAmount(odometer) }), [f, litres, cost, odometer]);
  const below = read.odometer !== null && reading !== null && read.odometer < num(reading);
  const ready = read.litres !== null && read.cost !== null && read.odometer !== null && Number.isInteger(read.odometer) && !below;
  const currency = session.config.currency;

  const save = async (): Promise<boolean> => {
    if (!ready) return true;
    setBusy(true);
    const saved = await addFill(session, { vehicleId: vehicle.id, day: today, litres: Math.round(read.litres! * 10) / 10, cost: read.cost!, odometer: read.odometer! }, key);
    setBusy(false);
    if (saved.state === "unknown") {
      conn.lost(save);
      return false;
    }
    conn.back();
    if (saved.state === "refused") {
      toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
      return true;
    }
    const distance = saved.row.distance === null ? null : num(saved.row.distance);
    toasts.show(distance === null || distance <= 0 ? t("fl.my.fill.saved", { vehicle: vehicle.name }) : t("fl.my.fill.savedDistance", { vehicle: vehicle.name, distance: `${distanceOf(f, distance)} ${unit.short}` }), "pos");
    setLitres("");
    setCost("");
    setOdometer("");
    setKey(newClientKey());
    onChanged();
    return true;
  };

  return (
    <section className="crm-fl-my-part mr-card" aria-labelledby="crm-fl-my-fill" data-testid="fl-my-fill">
      <h2 id="crm-fl-my-fill" className="crm-fl-my-head">
        <Icon name="fuel" size={16} />
        {t("fl.my.fill")}
      </h2>
      {last !== null && (
        <p className="crm-cw-quiet" data-testid="fl-my-lastfill">
          {t("fl.my.fill.last", { day: dayWords(f, dayKeyOf(last.day)!), litres: oneDecimal(f, num(last.litres)), reading: `${distanceOf(f, num(last.odometer))} ${unit.short}` })}
        </p>
      )}
      {canFill ? (
        <div className="crm-fl-my-fields">
          <div>
            <label className="crm-label" htmlFor="crm-fl-my-litres">
              {t("fl.my.fill.litres")}
            </label>
            <input id="crm-fl-my-litres" className="crm-input crm-mono mr-fld" inputMode="decimal" value={litres} disabled={busy} onChange={(event) => setLitres(event.target.value)} />
          </div>
          <div>
            <label className="crm-label" htmlFor="crm-fl-my-cost">
              {currency === null ? t("fl.my.fill.cost") : t("fl.my.fill.costIn", { currency })}
            </label>
            <input id="crm-fl-my-cost" className="crm-input crm-mono mr-fld" inputMode="decimal" value={cost} disabled={busy} onChange={(event) => setCost(event.target.value)} />
          </div>
          <div className="crm-fl-my-wide">
            <label className="crm-label" htmlFor="crm-fl-my-odo">
              {t("fl.my.fill.odometer", { unit: unit.short })}
            </label>
            <input id="crm-fl-my-odo" className="crm-input crm-mono mr-fld" inputMode="numeric" value={odometer} disabled={busy} aria-describedby={below ? "crm-fl-my-below" : undefined} onChange={(event) => setOdometer(event.target.value)} />
            {below && reading !== null && (
              <p id="crm-fl-my-below" className="crm-field-note" data-tone="danger" role="status">
                {t("fl.my.fill.below", { reading: `${distanceOf(f, num(reading))} ${unit.short}` })}
              </p>
            )}
          </div>
          <div className="crm-cw-add-foot crm-fl-my-wide">
            <button type="button" className="crm-btn crm-btn-primary crm-btn-44 mr-btn" data-testid="fl-my-fill-go" disabled={busy || !ready} onClick={() => void save()}>
              <Icon name="fuel" />
              {busy ? t("ui.saving") : t("fl.my.fill.go")}
            </button>
          </div>
        </div>
      ) : (
        <p className="crm-cw-quiet">{t("fl.my.fill.none")}</p>
      )}
    </section>
  );
}
