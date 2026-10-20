/**
 * FUEL (ledger screen 65): every fill, by vehicle and by month, and the
 * distance between fills. A vehicle that starts drinking is usually telling
 * you something before it breaks.
 *
 * Every sum is the server's (`readFuelFigures`), over the reader's rows: a
 * fill's distance is the server's own formula (its reading less the vehicle's
 * reading before it), so "the distance measured" is a sum the server keeps.
 * The browser divides two of the server's figures (a cost per unit of
 * distance, litres per hundred) and divides one row's litres by its own
 * distance; it adds nothing up.
 */
import { useCallback, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { dayKeyOf, num, per, readFills, readFuelFigures, readVehicles, type Fill, type FuelTotals, type Vehicle } from "./data.ts";
import { dayWords, distanceOf, Figure, moneyRate, oneDecimal, useFleetScreen, useFleetSettings, useOpens, useUnitWords } from "./parts.tsx";

const MONTHS = 3;

export function Fuel(_props: ScreenProps) {
  const t = useT();
  const { locale } = useI18n();
  const { session, f, today, tick } = useFleetScreen();
  const opens = useOpens();
  const { load: settingsLoad } = useFleetSettings(session);
  const unit = useUnitWords(settingsLoad.state === "ready" ? settingsLoad.data.unit : "km");
  const { load, reload } = useLoad(async () => {
    const [vehicles, figures, fills, people] = await Promise.all([readVehicles(session), readFuelFigures(session, today, MONTHS), readFills(session), session.people(undefined, 200).catch(() => [])]);
    return { vehicles, figures, fills, names: Object.fromEntries(people.map((person) => [person.id, person.name])) as Record<string, string> };
  }, [session, today]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["fuel_fills", "vehicles"], again);
  const [picked, setPicked] = useState<number | "all">("all");
  const currency = session.config.currency ?? null;

  return (
    <div className="crm-screen crm-fl mr-screen" data-screen="fuel">
      <div className="crm-screen-head">
        <div>
          <h1>{t("fl.fu.title")}</h1>
          <p className="crm-screen-sub crm-fl-lead">{t("fl.fu.sub")}</p>
        </div>
      </div>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={120} />}>
        {(data) => {
          const all = data.figures.all;
          const rate = per(all.measuredCost, all.distance);
          const lineOf = (id: number): FuelTotals | undefined => data.figures.by.get(id);
          // The vehicle that uses the most for its distance, among those with a measured one: a comparison of the server's figures.
          const measured = data.vehicles.filter((vehicle) => (lineOf(vehicle.id)?.distance ?? 0) > 0);
          const worst = measured.length < 2 ? null : [...measured].sort((a, b) => per(lineOf(b.id)!.measuredLitres, lineOf(b.id)!.distance)! - per(lineOf(a.id)!.measuredLitres, lineOf(a.id)!.distance)!)[0]!;
          const worstFills = worst === null ? [] : data.fills.filter((fill) => fill.vehicle_id === worst.id && num(fill.distance) > 0).reverse();
          const shown = data.fills.filter((fill) => picked === "all" || fill.vehicle_id === picked);
          return (
            <>
              <div className="crm-kpis crm-fl-stats">
                <Figure name="distance" label={t("fl.fu.stat.distance")} value={`${distanceOf(f, all.distance)} ${unit.short}`} sub={t("fl.fu.stat.distance.sub", { vehicles: f.number(data.vehicles.length), fills: f.number(all.fills) })} />
                <Figure name="fuel" label={t("fl.fu.stat.fuel")} value={f.money(all.cost)} sub={t("fl.fu.stat.fuel.sub", { litres: oneDecimal(f, all.litres) })} />
                <Figure name="rate" label={t("fl.fu.stat.rate", { unit: unit.short })} value={rate === null ? "—" : moneyRate(f, locale, currency, rate)} sub={t("fl.fu.stat.rate.sub", { count: f.number(all.measuredFills) }, all.measuredFills)} />
              </div>
              {worst !== null && worstFills.length > 0 && (
                <div className="crm-banner" data-tone="warn" data-testid="fl-fu-worst">
                  <Icon name="fuel" size={16} />
                  <span>
                    {t("fl.fu.worst", {
                      vehicle: worst.name,
                      unit: unit.per100,
                      list: worstFills.map((fill) => t("fl.fu.worst.one", { day: dayWords(f, dayKeyOf(fill.day)!), n: oneDecimal(f, (num(fill.litres) / num(fill.distance)) * 100) })).join(", "),
                    })}
                    {worst.service_due !== null && ` ${t("fl.fu.worst.service", { day: dayWords(f, dayKeyOf(worst.service_due)!) })}`}
                  </span>
                </div>
              )}
              <ul className="crm-fl-vans">
                {data.vehicles.map((vehicle) => (
                  <VanFuel key={vehicle.id} vehicle={vehicle} line={lineOf(vehicle.id)} best={measured.length < 2 ? null : [...measured].sort((a, b) => per(lineOf(a.id)!.measuredLitres, lineOf(a.id)!.distance)! - per(lineOf(b.id)!.measuredLitres, lineOf(b.id)!.distance)!)[0]!.id} canOpen={opens("vehicles")} unit={unit} />
                ))}
              </ul>
              <section className="crm-fl-months" aria-labelledby="crm-fl-fu-months">
                <h2 id="crm-fl-fu-months" className="crm-fl-eyebrow">
                  {t("fl.fu.months")}
                </h2>
                <div className="crm-fl-table-wrap" tabIndex={0} role="region" aria-labelledby="crm-fl-fu-months">
                  <table className="crm-fl-table" data-testid="fl-fu-months">
                    <thead>
                      <tr>
                        <th scope="col">{t("fl.fu.month")}</th>
                        {data.vehicles.map((vehicle) => (
                          <th key={vehicle.id} scope="col">
                            {vehicle.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.figures.months.map((month) => (
                        <tr key={month.month} data-month={month.month}>
                          <th scope="row">{f.monthYear(noonOf(month.month))}</th>
                          {data.vehicles.map((vehicle) => {
                            const cell = month.by.get(vehicle.id);
                            return (
                              <td key={vehicle.id} className="crm-mono" data-vehicle={vehicle.id}>
                                {cell === undefined ? "—" : `${f.money(cell.cost)} · ${t("fl.fu.litres", { n: oneDecimal(f, cell.litres) })}`}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <div className="crm-chips" role="group" aria-label={t("fl.fu.filter")}>
                <button type="button" className="crm-chip-btn mr-chip" aria-pressed={picked === "all"} data-filter="all" onClick={() => setPicked("all")}>
                  {t("fl.fu.filter.all")}
                  <span className="crm-chip-count crm-mono">{f.number(all.fills)}</span>
                </button>
                {data.vehicles.map((vehicle) => (
                  <button key={vehicle.id} type="button" className="crm-chip-btn mr-chip" aria-pressed={picked === vehicle.id} data-filter={vehicle.id} onClick={() => setPicked(vehicle.id)}>
                    {vehicle.name}
                    <span className="crm-chip-count crm-mono">{f.number(lineOf(vehicle.id)?.fills ?? 0)}</span>
                  </button>
                ))}
              </div>
              {shown.length === 0 ? (
                <div className="crm-empty" data-testid="fl-fu-empty">
                  <span className="crm-empty-icon">
                    <Icon name="fuel" size={20} />
                  </span>
                  <div className="crm-empty-title">{t("fl.fu.empty")}</div>
                  <p>{t("fl.fu.empty.body")}</p>
                </div>
              ) : (
                <ul className="crm-fl-list">
                  {shown.map((fill) => (
                    <FillRow key={fill.id} fill={fill} vehicle={data.vehicles.find((one) => one.id === fill.vehicle_id) ?? null} who={data.names[fill.by_id] ?? ""} unit={unit} />
                  ))}
                </ul>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function VanFuel({ vehicle, line, best, canOpen, unit }: { vehicle: Vehicle; line: FuelTotals | undefined; best: number | null; canOpen: boolean; unit: { short: string; per100: string } }) {
  const t = useT();
  const { locale } = useI18n();
  const { session, f } = useFleetScreen();
  const per100 = line === undefined ? null : per(line.measuredLitres * 100, line.distance);
  const rate = line === undefined ? null : per(line.measuredCost, line.distance);
  const tone = per100 === null ? undefined : best !== null && best !== vehicle.id ? "warn" : "pos";
  return (
    <li className="crm-fl-card crm-fl-van mr-card" data-vehicle={vehicle.id} data-tone={tone}>
      <div className="crm-fl-card-top">
        <div className="crm-fl-card-words">
          <h2 className="crm-fl-name">{vehicle.name}</h2>
          <div className="crm-fl-quiet">{vehicle.model ?? ""}</div>
        </div>
        <div className="crm-fl-card-end">
          <div className="crm-mono crm-fl-big" data-tone={tone} data-testid="fl-fu-per100">
            {per100 === null ? "—" : oneDecimal(f, per100)}
          </div>
          <div className="crm-fl-quiet">{per100 !== null ? t("fl.fu.per100", { unit: unit.per100 }) : (line?.fills ?? 0) > 0 ? t("fl.fu.nothingToMeasure") : t("fl.fu.noFills")}</div>
        </div>
      </div>
      <dl className="crm-fl-cells">
        <div>
          <dt>{t("fl.fu.cell.distance")}</dt>
          <dd className="crm-mono" data-cell="distance">{line === undefined || line.distance <= 0 ? "—" : `${distanceOf(f, line.distance)} ${unit.short}`}</dd>
        </div>
        <div>
          <dt>{t("fl.fu.cell.litres")}</dt>
          <dd className="crm-mono" data-cell="litres">{line === undefined || line.fills === 0 ? "—" : oneDecimal(f, line.litres)}</dd>
        </div>
        <div>
          <dt>{t("fl.fu.cell.fuel")}</dt>
          <dd className="crm-mono" data-cell="fuel">{f.money(line?.cost ?? 0)}</dd>
        </div>
        <div>
          <dt>{t("fl.fu.cell.rate", { unit: unit.short })}</dt>
          <dd className="crm-mono" data-cell="rate">{rate === null ? "—" : moneyRate(f, locale, session.config.currency ?? null, rate)}</dd>
        </div>
      </dl>
      {canOpen && (
        <ScreenLink to="vehicles" className="crm-fl-link">
          <Icon name="wrench" size={14} />
          {t("fl.fu.holding")}
        </ScreenLink>
      )}
    </li>
  );
}

function FillRow({ fill, vehicle, who, unit }: { fill: Fill; vehicle: Vehicle | null; who: string; unit: { short: string; per100: string } }) {
  const t = useT();
  const { f } = useFleetScreen();
  const distance = fill.distance === null ? null : num(fill.distance);
  return (
    <li className="crm-fl-fill mr-card" data-fill={fill.id}>
      <div className="crm-fl-fill-head">
        <strong>{who === "" ? t("fl.fu.someone") : who}</strong>
        {vehicle !== null && (
          <span className="crm-pill">
            {vehicle.name}
            {vehicle.plate !== null && <span dir="ltr"> · {vehicle.plate}</span>}
          </span>
        )}
        <span className="crm-mono crm-fl-quiet">{dayWords(f, dayKeyOf(fill.day)!)}</span>
      </div>
      <dl className="crm-fl-cells">
        <div>
          <dt>{t("fl.fu.cell.litres")}</dt>
          <dd className="crm-mono">{oneDecimal(f, num(fill.litres))}</dd>
        </div>
        <div>
          <dt>{t("fl.fu.cell.cost")}</dt>
          <dd className="crm-mono">{f.money(fill.cost)}</dd>
        </div>
        <div>
          <dt>{t("fl.fu.cell.odometer")}</dt>
          <dd className="crm-mono">{distanceOf(f, num(fill.odometer))}</dd>
        </div>
        <div>
          <dt>{t("fl.fu.cell.distance")}</dt>
          <dd className="crm-mono" data-cell="distance">{distance === null || distance <= 0 ? "—" : distanceOf(f, distance)}</dd>
        </div>
        <div>
          <dt>{t("fl.fu.cell.per100", { unit: unit.short })}</dt>
          <dd className="crm-mono" data-cell="per100">{distance === null || distance <= 0 ? "—" : oneDecimal(f, (num(fill.litres) / distance) * 100)}</dd>
        </div>
      </dl>
    </li>
  );
}
