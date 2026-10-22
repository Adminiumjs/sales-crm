/**
 * "VEHICLE FOR THE DAY" (plan 68 S14, M3 §1): the one vehicle a crew's day
 * goes on, picked from a list that says of each vehicle how it stands that
 * day (the crew's own, with another crew, hired until a day, not hired that
 * day, another crew's own not in use).
 *
 * A real listbox (M3 departure a1): a button that opens a list of options;
 * arrow keys, Home and End move, Enter or Space picks, Escape closes. A
 * vehicle that cannot be picked is listed, announced as unavailable, and not
 * picked. Each option's state line is its description.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { useT } from "../../i18n/index.tsx";
import type { Formatters } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import type { CrewFacts } from "./data.ts";
import { dayWords } from "./parts.tsx";
import { pickable, standingOf, type DayVehicle, type Facts, type Standing } from "./vandays.ts";

/** What a vehicle's state line says, for a crew's day. */
export function standingWords(t: ReturnType<typeof useT>, f: Formatters, crews: Pick<CrewFacts, "crews">, standing: Standing, crewName: string, day: string): string {
  const name = (id: number): string => crews.crews.find((crew) => crew.id === id)?.name ?? "";
  switch (standing.kind) {
    case "own":
      return t("vandays.own", { crew: crewName });
    case "with":
      return t("vandays.with", { crew: name(standing.crewId), day: dayWords(f, day) });
    case "until":
      return t("vandays.until", { day: dayWords(f, standing.to) });
    case "notHired":
      return t("vandays.notHired", { day: dayWords(f, day) });
    case "idle":
      return t("vandays.idle", { crew: name(standing.crewId), day: dayWords(f, day) });
    default:
      return "";
  }
}

export const plateOf = (vehicle: Pick<DayVehicle, "plate" | "name"> | undefined): string => vehicle?.plate ?? vehicle?.name ?? "";

export function VehiclePick({ id, facts, crews, crewId, crewName, day, value, onPick, f, open: openAtStart = false, disabled = false }: { id: string; facts: Facts; crews: Pick<CrewFacts, "crews">; crewId: number | null; crewName: string; day: string; value: number | null; onPick: (vehicleId: number) => void; f: Formatters; open?: boolean; disabled?: boolean }) {
  const t = useT();
  const listId = useId();
  const [open, setOpen] = useState(openAtStart);
  const options = facts.vehicles.map((vehicle) => ({ vehicle, standing: standingOf(facts, vehicle, crewId, day) }));
  const at = Math.max(0, options.findIndex((one) => one.vehicle.id === value));
  const [active, setActive] = useState(at);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const picked = options.find((one) => one.vehicle.id === value);

  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };
  const choose = (index: number): void => {
    const one = options[index];
    if (one === undefined || !pickable(one.standing)) return;
    onPick(one.vehicle.id);
    close();
  };
  const onListKey = (event: KeyboardEvent<HTMLUListElement>): void => {
    const last = options.length - 1;
    const move = (to: number): void => {
      event.preventDefault();
      setActive(Math.max(0, Math.min(last, to)));
    };
    if (event.key === "ArrowDown") move(active + 1);
    else if (event.key === "ArrowUp") move(active - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(last);
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape" || event.key === "Tab") {
      // Escape closes the list, not the dialog it is in.
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
      close();
    }
  };

  return (
    <div className="crm-vd-pick" data-testid="vd-pick">
      <button
        ref={button}
        id={id}
        type="button"
        className="crm-input crm-vd-value mr-fld"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-describedby={`${listId}-value`}
        aria-controls={listId}
        disabled={disabled}
        data-vehicle={value ?? ""}
        onClick={() => (open ? close() : (setActive(at), setOpen(true)))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive(at);
            setOpen(true);
          }
        }}
      >
        <Icon name="truck" size={15} />
        <span className="crm-vd-value-words" id={`${listId}-value`}>
          {picked === undefined ? (
            <span className="crm-vd-sub">{t("vandays.none")}</span>
          ) : (
            <>
              <span>
                <span className="crm-mono crm-vd-plate" dir="ltr">
                  {plateOf(picked.vehicle)}
                </span>{" "}
                {picked.vehicle.name}
              </span>
              <span className="crm-vd-sub" data-tone={picked.standing.kind === "notHired" || picked.standing.kind === "with" ? "danger" : undefined}>
                {standingWords(t, f, crews, picked.standing, crewName, day)}
              </span>
            </>
          )}
        </span>
        <Icon name="chevrons-up-down" size={15} />
      </button>
      {open && (
        <ul ref={list} id={listId} role="listbox" tabIndex={-1} {...(openAtStart ? { "data-autofocus": true } : {})} className="crm-vd-list" aria-label={t("vandays.list", { crew: crewName, day: dayWords(f, day) })} aria-activedescendant={`${listId}-${String(active)}`} onKeyDown={onListKey} onBlur={(event) => !event.currentTarget.contains(event.relatedTarget as Node | null) && setOpen(false)}>
          {options.map((one, i) => {
            const can = pickable(one.standing);
            const words = standingWords(t, f, crews, one.standing, crewName, day);
            return (
              <li
                key={one.vehicle.id}
                id={`${listId}-${String(i)}`}
                role="option"
                aria-selected={one.vehicle.id === value}
                aria-disabled={can ? undefined : true}
                aria-describedby={words === "" ? undefined : `${listId}-${String(i)}-d`}
                className="crm-vd-option"
                data-active={i === active ? "1" : undefined}
                data-vehicle={one.vehicle.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(i)}
                onMouseMove={() => i !== active && setActive(i)}
              >
                <Icon name={can ? (one.vehicle.id === value ? "check" : "truck") : "ban"} size={15} />
                <span className="crm-vd-value-words">
                  <span>
                    <span className="crm-mono crm-vd-plate" dir="ltr">
                      {plateOf(one.vehicle)}
                    </span>{" "}
                    {one.vehicle.name}
                  </span>
                  {words !== "" && (
                    <span id={`${listId}-${String(i)}-d`} className="crm-vd-sub">
                      {words}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
