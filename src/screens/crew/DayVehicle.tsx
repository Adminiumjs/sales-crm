/**
 * HIS CREW'S VEHICLE THAT DAY, on My day (plan 68 S14, M3 5a–5e): "{plate} ·
 * {name}", and "Not your usual vehicle today." when the office put the crew's
 * day on another vehicle than its own (a hired one, say). He reads his crew's
 * own days only, and of the vehicle what the day's row keeps of it.
 */
import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { CrewFacts } from "../jobs/data.ts";
import { truthyHired, type VanDay } from "../jobs/vandays.ts";

export function DayVehicle({ vans, facts, mine }: { vans: readonly VanDay[]; facts: CrewFacts; mine: readonly number[] }) {
  const t = useT();
  const row = vans.find((one) => mine.includes(one.crew_id));
  if (row === undefined) return null;
  // His crew's own vehicle, as his crew row keeps it.
  const own = facts.members.find((member) => member.crew_id === row.crew_id && (member as { vehicle_id?: number | null }).vehicle_id !== undefined) as { vehicle_id?: number | null } | undefined;
  const usual = own?.vehicle_id === null || own?.vehicle_id === undefined ? null : Number(own.vehicle_id);
  const other = usual !== null && usual !== row.vehicle_id;
  return (
    <div className="crm-vd-my mr-card" data-testid="cw-vehicle" data-vehicle={row.vehicle_id}>
      <span className="crm-vd-my-tile" data-hired={truthyHired(row) ? "1" : undefined} aria-hidden="true">
        <Icon name="truck" size={18} />
      </span>
      <div className="crm-vd-my-words">
        <div className="crm-vd-my-name">
          <span className="crm-sr">{`${t("vandays.my.label")}: `}</span>
          <span className="crm-mono" dir="ltr">
            {row.plate ?? ""}
          </span>
          {row.vehicle_name !== null && row.vehicle_name !== "" && ` · ${row.vehicle_name}`}
        </div>
        {other && (
          <p className="crm-vd-my-note" data-testid="cw-vehicle-other">
            <Icon name="info" size={14} />
            {t("vandays.my.notUsual")}
          </p>
        )}
      </div>
    </div>
  );
}
