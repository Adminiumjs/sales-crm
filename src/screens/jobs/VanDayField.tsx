/**
 * The booking dialog's "Vehicle for the day" (plan 68 S14, M3 §7 BN-10, CD-9),
 * in "Who", after the crew:
 *
 *  - the crew already has its day's vehicle: a line says so, with "Change for
 *    the whole day", which opens the list and says how many of the crew's
 *    visits that day the change moves;
 *  - else the list, on the crew's own vehicle (or the one picked);
 *  - a vehicle another crew has that day, or one not hired that day, is a
 *    refusal in the dialog's refusal row, with its fix: "Use" the crew's own,
 *    or "Change the hire days" (Vehicles);
 *  - a vehicle past its service is flagged and may still be booked (CD-11).
 */
import { useT } from "../../i18n/index.tsx";
import type { Formatters } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { CrewFacts } from "./data.ts";
import { dayWords } from "./parts.tsx";
import { plateOf, VehiclePick } from "./VehiclePick.tsx";
import { holderOf, rowOf, serviceOver, truthyHired, type DayFacts, type DayRefusal } from "./vandays.ts";

export function VanDayField({ facts, crews, crewId, day, today, here, value, changing, onPick, onChange, refusal, f, disabled }: {
  facts: DayFacts;
  crews: CrewFacts;
  crewId: number | null;
  day: string;
  today: string;
  /** 1 when the visit is itself booked on this crew's day (a move inside the day): it is no "other" visit. */
  here: number;
  value: number | null;
  /** "Change for the whole day" was pressed. */
  changing: boolean;
  onPick: (vehicleId: number) => void;
  onChange: () => void;
  refusal: DayRefusal | null;
  f: Formatters;
  disabled: boolean;
}) {
  const t = useT();
  const crewName = crews.crews.find((crew) => crew.id === crewId)?.name ?? "";
  const row = rowOf(facts.days, crewId, day);
  const vehicle = (id: number | null) => facts.vehicles.find((one) => one.id === id);
  // The crew's visits that day (the server's count), this one among them when it is booked there.
  const onDay = crewId === null ? 0 : (facts.counts.get(crewId) ?? 0);
  const others = Math.max(0, onDay - here);
  const picked = vehicle(value);
  const own = crewId === null ? undefined : facts.own.get(crewId);
  const ownFree = own !== undefined && crewId !== null && holderOf(facts, own, day, crewId) === null && own !== value;
  const name = (id: number | null) => crews.crews.find((crew) => crew.id === id)?.name ?? "";
  const over = picked === undefined ? 0 : serviceOver(picked, today);

  const refusalWords = (one: DayRefusal): string => {
    const plate = plateOf(vehicle(one.kind === "other" ? null : one.vehicleId));
    if (one.kind === "with") return one.crewId === null ? t("vandays.isWith.other", { plate, day: dayWords(f, day) }) : t("vandays.isWith", { plate, crew: name(one.crewId), day: dayWords(f, day) });
    if (one.kind === "hiredTo") return t("vandays.hiredTo", { plate, day: dayWords(f, one.to) });
    if (one.kind === "hiredFrom") return t("vandays.hiredFrom", { plate, day: dayWords(f, one.from) });
    return "";
  };

  return (
    <div className="crm-vd-field">
      <label className="crm-label" htmlFor="crm-jb-vehicle">
        {t("vandays.field")}
      </label>
      {row !== undefined && !changing ? (
        <div className="crm-vd-line" data-testid="vd-line">
          <Icon name="truck" size={15} />
          <span>
            {t(truthyHired(row) ? "vandays.line.hired" : "vandays.line", { crew: crewName, plate: row.plate ?? row.vehicle_name ?? "", day: dayWords(f, day) })} {others === 0 ? t("vandays.others.none") : t("vandays.others", { count: f.number(others) }, others)}
          </span>
          <button id="crm-jb-vehicle" type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-testid="vd-change-day" disabled={disabled} onClick={onChange}>
            <Icon name="pencil" size={14} />
            {t("vandays.changeDay")}
          </button>
        </div>
      ) : (
        <VehiclePick id="crm-jb-vehicle" facts={facts} crews={crews} crewId={crewId} crewName={crewName} day={day} value={value} onPick={onPick} f={f} open={changing} disabled={disabled} />
      )}
      {row !== undefined && changing && value !== null && value !== row.vehicle_id && onDay > 0 && (
        <p className="crm-field-note" data-testid="vd-moves">
          {t("vandays.moves", { count: f.number(onDay), plate: plateOf(picked) }, onDay)}
        </p>
      )}
      {refusal !== null && refusal.kind !== "other" && (
        <div className="crm-form-error" role="alert" data-testid="vd-refusal" data-kind={refusal.kind}>
          <Icon name="circle-slash" size={15} />
          <span>{refusalWords(refusal)}</span>
          {refusal.kind === "with" && ownFree && (
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-testid="vd-use-own" onClick={() => onPick(own!)}>
              {t("vandays.use", { plate: plateOf(vehicle(own!)) })}
            </button>
          )}
          {(refusal.kind === "hiredTo" || refusal.kind === "hiredFrom") && (
            <span data-testid="vd-change-hire">
              <ScreenLink to="vehicles" rest={["hire", refusal.vehicleId]} className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
                {t("vandays.changeHire")}
              </ScreenLink>
            </span>
          )}
        </div>
      )}
      {over > 0 && picked !== undefined && (
        <div className="crm-bk-flag" role="status" data-testid="vd-service">
          <Icon name="wrench" size={15} />
          <span>{t("vandays.service", { plate: plateOf(picked), count: f.number(over) }, over)}</span>
        </div>
      )}
    </div>
  );
}
