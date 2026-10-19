/**
 * SETTINGS, the four tabs after Selling: Working time, Places, Maps, Parts.
 *
 * WORKING TIME AND PLACES are the CRM admin's to write (the server refuses
 * anybody else, the sales manager included). MAPS AND PARTS ARE READ-ONLY for
 * everybody here: maps are one switch for the whole of Adminium and a part is
 * switched on the app's page there, both by the person who runs the install.
 * No role of the app holds either right, so this page says what is on and who
 * to ask, and offers no switch.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import type { Formatters } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import type { PartId } from "../../shell/routes.ts";
import type { StaffSession } from "../../staffSession.ts";
import { KitPart } from "../../ui/kit.tsx";
import { kitCommon, type KitMissing } from "../../kitParts.ts";
import { Loaded, LoadFailed, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { DAYS, hoursBetween, isTime, placeOf, readSettings, weekFrom, workDaysOf, type Day, type SettingsRow } from "./data.ts";
import { AskLine, Card, Chips, NumField, useSaveSettings, type Rights } from "./parts.tsx";
import { ShowroomSettings } from "../showroom/SettingsCard.tsx";
import { SettingNumbers } from "./Numbers.tsx";

function useSettings(session: StaffSession): { load: ReturnType<typeof useLoad<SettingsRow | null>>["load"]; reload: () => void; soon: () => void } {
  const { load, reload } = useLoad(() => readSettings(session), [session]);
  const soon = useCoalesced(reload);
  useLive(["settings"], soon);
  return { load, reload, soon };
}

/** A day's name from the reader's language: 2024-01-01 was a Monday. */
const dayDate = (day: Day): Date => new Date(Date.UTC(2024, 0, 1 + DAYS.indexOf(day), 12));

export function WorkingTime({ session, f, rights }: { session: StaffSession; f: Formatters; rights: Rights }) {
  const t = useT();
  const { load, reload, soon } = useSettings(session);
  const row = load.state === "ready" ? load.data : null;
  const { save, busy } = useSaveSettings(session, row, soon);
  const [times, setTimes] = useState<{ from: string; to: string } | null>(null);
  const sentTimes = useRef<string | null>(null);
  useEffect(() => {
    setTimes(null);
    sentTimes.current = null;
  }, [row?.work_from, row?.work_to]);
  const can = rights.all && row !== null;

  return (
    <div role="tabpanel" aria-label={t("aset.tab.work")} className="crm-ast-panel crm-ast-narrow" data-panel="work">
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={2} height={160} />}>
        {(settings) => {
          if (settings === null) return <LoadFailed reload={reload} />;
          const days = workDaysOf(settings);
          const order = weekFrom(settings.week_starts);
          const from = times?.from ?? settings.work_from;
          const to = times?.to ?? settings.work_to;
          const hours = hoursBetween(from, to);
          const kept = hoursBetween(settings.work_from, settings.work_to);
          const toggle = (day: Day): void => {
            // The last working day stays: a week with none counts nothing.
            if (days.has(day) && days.size === 1) return;
            void save({ [`work_${day}`]: !days.has(day) }, t(days.has(day) ? "aset.work.day.off" : "aset.work.day.on", { day: f.weekdayLong(dayDate(day)) }));
          };
          const commit = (next: { from: string; to: string }): void => {
            setTimes(next);
            if (!isTime(next.from) || !isTime(next.to) || hoursBetween(next.from, next.to) === null) return;
            if (next.from === settings.work_from && next.to === settings.work_to) return;
            if (sentTimes.current === `${next.from}-${next.to}`) return;
            sentTimes.current = `${next.from}-${next.to}`;
            void save({ work_from: next.from, work_to: next.to }, t("aset.work.hours.saved", { from: next.from, to: next.to }));
          };
          return (
            <>
              <Card name="week" title={t("aset.work.title")} sub={t("aset.work.sub")}>
                <div className="crm-ast-label" id="aset-days">
                  {t("aset.work.days")}
                </div>
                <Chips<Day>
                  label={t("aset.work.days")}
                  options={order.map((day) => ({ key: day, label: f.weekdayShort(dayDate(day)), title: f.weekdayLong(dayDate(day)), locked: days.has(day) && days.size === 1 }))}
                  pressed={(day) => days.has(day)}
                  onPress={can ? toggle : null}
                  disabled={busy}
                />
                <div className="crm-ast-label">{t("aset.work.day")}</div>
                <div className="crm-ast-times">
                  {can ? (
                    <>
                      <input type="time" className="crm-ast-input crm-ast-input-time crm-mono mr-fld" value={from} aria-label={t("aset.work.from")} aria-invalid={hours === null} onChange={(event) => setTimes({ from: event.target.value, to })} onBlur={() => commit({ from, to })} />
                      <span>{t("aset.work.to")}</span>
                      <input type="time" className="crm-ast-input crm-ast-input-time crm-mono mr-fld" value={to} aria-label={t("aset.work.until")} aria-invalid={hours === null} onChange={(event) => setTimes({ from, to: event.target.value })} onBlur={() => commit({ from, to })} />
                    </>
                  ) : (
                    <span className="crm-mono" data-figure="hours">
                      {t("aset.work.span", { from: settings.work_from, to: settings.work_to })}
                    </span>
                  )}
                </div>
                {hours === null && (
                  <div role="alert" className="crm-ast-range">
                    {t("aset.work.order")}
                  </div>
                )}
                <div className="crm-ast-label">{t("aset.work.starts")}</div>
                <Chips<Day>
                  label={t("aset.work.starts")}
                  options={(["mon", "sun", "sat"] as const).map((day) => ({ key: day, label: f.weekdayLong(dayDate(day)) }))}
                  pressed={(day) => settings.week_starts === day}
                  onPress={can ? (day) => (day === settings.week_starts ? undefined : void save({ week_starts: day }, t("aset.work.starts.saved", { day: f.weekdayLong(dayDate(day)) }))) : null}
                  disabled={busy}
                />
                <div className="crm-ast-sum crm-mono" data-figure="week">
                  {kept === null
                    ? t("aset.work.sum.days", { count: f.number(days.size) }, days.size)
                    : `${t("aset.work.sum.days", { count: f.number(days.size) }, days.size)} · ${t("aset.work.span", { from: settings.work_from, to: settings.work_to })} · ${t("aset.work.sum.hours", { count: f.number(kept * days.size) })}`}
                </div>
              </Card>
              {/* A crew's day is for Jobs on site and Vehicles and crew, parts a later stage brings: an install that does not have them shows no card. */}
              {(session.config.modules?.["jobs"] === true || session.config.modules?.["fleet"] === true) && (
                <Card name="crew" title={t("aset.crew.title")} sub={t("aset.crew.sub")}>
                  <div className="crm-ast-fields">
                    <NumField column="working_day_hours" label={t("aset.crew.day")} unit={t("aset.unit.hours")} value={settings["working_day_hours"]} canWrite={can} f={f} whole={false} onSave={(next, fresh) => save({ working_day_hours: next }, t("aset.saved", { what: t("aset.crew.day") }), fresh)} />
                  </div>
                </Card>
              )}
              {/* The showroom's spaces, hours, address and e-mails: once Showroom and samples is on (P19). */}
              {session.config.modules?.["showroom"] === true && <ShowroomSettings session={session} can={can} />}
              {session.config.modules?.["showroom"] === true && (
                <SettingNumbers
                  session={session}
                  f={f}
                  can={rights.all}
                  name="showroom-numbers"
                  title={t("sh.set.numbers")}
                  sub={t("sh.set.numbers.sub")}
                  fields={[
                    { column: "loan_days", label: t("sh.set.loan"), unit: (n) => t("aset.unit.days", undefined, n) },
                    { column: "display_tired_months", label: t("sh.set.tired"), unit: (n) => t("aset.unit.months", undefined, n) },
                  ]}
                />
              )}
              {!rights.all && <AskLine>{t("aset.ask.admin")}</AskLine>}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

interface MapProps {
  maps: unknown;
  pins: { id: string; label: string; lat: number; lng: number; by?: "town" }[];
  locale: string;
  dir: "ltr" | "rtl";
  ariaLabel: string;
  listLabel: string;
  emptyLabel: string;
  zoom?: number;
  mapsSiteLink?: boolean;
  placing?: { id: string; label: string } | null;
  onMovePin?: (pinId: string, at: { lat: number; lng: number }) => Promise<void | { refused: string }>;
  onPlacePin?: (pinId: string, at: { lat: number; lng: number }) => Promise<void | { refused: string }>;
  onPlacingStop?: () => void;
  onStatus?: (status: "loading" | "ready" | "unreachable" | "off") => void;
}

const ADDRESS = [
  ["depot_name", "aset.depot.name", 120],
  ["depot_address", "aset.depot.lines", 400],
  ["depot_town", "aset.depot.town", 120],
  ["depot_region", "aset.depot.region", 120],
  ["depot_postal_code", "aset.depot.postal", 20],
  ["depot_country", "aset.depot.country", 2],
] as const;

export function Places({ session, rights }: { session: StaffSession; rights: Rights }) {
  const t = useT();
  const { load, reload, soon } = useSettings(session);
  const row = load.state === "ready" ? load.data : null;
  const { save, busy } = useSaveSettings(session, row, soon);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // What was last sent for a field, until the row is read again: Enter saves, and leaving the field must not send it twice.
  const sent = useRef<Record<string, string>>({});
  useEffect(() => {
    setDrafts({});
    sent.current = {};
  }, [row]);
  const [placing, setPlacing] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "unreachable" | "off">("loading");
  const can = rights.all && row !== null;
  const place = placeOf(row?.depot_place);
  const label = row?.depot_name ?? t("aset.depot.title");
  const common = kitCommon(session.config);

  /** A pin put down or dragged: the depot's exact place, kept by the server, which answers a refusal in its own words. */
  const moved = useCallback(
    async (_pin: string, at: { lat: number; lng: number }): Promise<void | { refused: string }> => {
      if (row === null) return { refused: "" };
      const saved = await session.update("settings", row.id, { depot_place: { lat: at.lat, lng: at.lng }, depot_lat: at.lat, depot_lng: at.lng });
      if (saved.state === "refused") return { refused: saved.error.message };
      if (saved.state === "unknown") return { refused: t("ui.unknown") };
      setPlacing(false);
      soon();
    },
    [row, session, soon, t],
  );
  const props = useMemo<MapProps>(
    () => ({
      maps: session.config.maps ?? { enabled: false, server: null, routing: false },
      pins: place === null ? [] : [{ id: "depot", label, lat: place.lat, lng: place.lng, ...(place.by === "town" ? { by: "town" as const } : {}) }],
      locale: common.locale,
      dir: common.dir,
      ariaLabel: t("aset.depot.map"),
      listLabel: t("aset.depot.title"),
      emptyLabel: t("aset.depot.nowhere"),
      zoom: 11,
      placing: placing ? { id: "depot", label } : null,
      onStatus: setStatus,
      onPlacingStop: () => setPlacing(false),
      ...(can ? { onMovePin: moved, onPlacePin: moved } : {}),
    }),
    [session, place?.lat, place?.lng, place?.by, label, common.locale, common.dir, t, placing, can, moved],
  );
  const missing = (why: KitMissing, retry: () => void) => (why === "failed" ? <LoadFailed reload={retry} /> : <p className="crm-ast-none">{t("aset.depot.nomap")}</p>);

  return (
    <div role="tabpanel" aria-label={t("aset.tab.places")} className="crm-ast-panel" data-panel="places">
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={2} height={200} />}>
        {(settings) => {
          if (settings === null) return <LoadFailed reload={reload} />;
          const commit = (column: string, was: string | null): void => {
            const typed = drafts[column];
            if (typed === undefined) return;
            const next = column === "depot_country" ? typed.trim().toUpperCase() : typed.trim();
            if (next === (was ?? "")) return;
            if (column === "depot_country" && next !== "" && !/^[A-Z]{2}$/.test(next)) return;
            if (sent.current[column] === next) return;
            sent.current[column] = next;
            void save({ [column]: next === "" ? null : next }, t("aset.saved", { what: t(ADDRESS.find(([ref]) => ref === column)![1] as MessageKey) }));
          };
          const line = [settings.depot_address?.split("\n")[0], settings.depot_town].filter((part) => part !== null && part !== undefined && part !== "").join(", ");
          return (
            <>
              <Card name="depot" title={t("aset.depot.title")} sub={t("aset.depot.sub")}>
                <div className="crm-ast-depot">
                  <div className="crm-ast-address">
                    {ADDRESS.map(([column, key, max]) => {
                      const was = settings[column] as string | null;
                      const value = drafts[column] ?? was ?? "";
                      const badCountry = column === "depot_country" && value.trim() !== "" && !/^[A-Za-z]{2}$/.test(value.trim());
                      return (
                        <div key={column} className="crm-ast-addr-field" data-setting={column}>
                          <label htmlFor={`aset-${column}`} className="crm-ast-label">
                            {t(key)}
                          </label>
                          {!can ? (
                            <output id={`aset-${column}`} className="crm-ast-read">
                              {was ?? "—"}
                            </output>
                          ) : column === "depot_address" ? (
                            <textarea id={`aset-${column}`} className="crm-ast-input crm-ast-textarea mr-fld" rows={2} maxLength={max} value={value} disabled={busy} onChange={(event) => setDrafts((d) => ({ ...d, [column]: event.target.value }))} onBlur={() => commit(column, was)} />
                          ) : (
                            <input id={`aset-${column}`} className="crm-ast-input mr-fld" maxLength={max} value={value} aria-invalid={badCountry} aria-describedby={column === "depot_country" ? "aset-country-hint" : undefined} onChange={(event) => setDrafts((d) => ({ ...d, [column]: event.target.value }))} onBlur={() => commit(column, was)} onKeyDown={(event) => (event.key === "Enter" ? commit(column, was) : undefined)} />
                          )}
                          {column === "depot_country" && can && (
                            <span id="aset-country-hint" className="crm-ast-hint">
                              {t("aset.depot.country.hint")}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="crm-ast-map">
                    <KitPart<MapProps> part="map" className="crm-ast-map-kit" props={props} fallback={missing} />
                    <div className="crm-ast-map-foot">
                      <strong data-figure="depot">{line === "" ? t("aset.depot.noaddress") : line}</strong>
                      <span data-figure="pin">{place === null ? t("aset.depot.pin.none") : t(place.by === "town" ? (can ? "aset.depot.pin.town" : "aset.depot.pin.town.read") : "aset.depot.pin.exact")}</span>
                      {can && place === null && status === "ready" && !placing && (
                        <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" onClick={() => setPlacing(true)}>
                          <Icon name="map-pin" size={14} />
                          {t("aset.depot.place")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
              <Card name="distances" title={t("aset.dist.title")} sub={t("aset.dist.sub")}>
                <Chips<"km" | "miles">
                  label={t("aset.dist.unit")}
                  options={[
                    { key: "km", label: t("aset.dist.km") },
                    { key: "miles", label: t("aset.dist.miles") },
                  ]}
                  pressed={(unit) => settings.distance_unit === unit}
                  onPress={can ? (unit) => (unit === settings.distance_unit ? undefined : void save({ distance_unit: unit }, t("aset.dist.saved", { unit: t(unit === "km" ? "aset.dist.km" : "aset.dist.miles") }))) : null}
                  disabled={busy}
                />
              </Card>
              {!rights.all && <AskLine>{t("aset.ask.admin")}</AskLine>}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

/** Whether the reader is the person who runs the install: somebody with none of the app's roles, who opens the app as its owner. */
const runsInstall = (session: StaffSession): boolean => !(session.config.access?.roles ?? []).some((role) => role.slug.startsWith("crm-"));

export function Maps({ session }: { session: StaffSession }) {
  const t = useT();
  const maps = session.config.maps ?? null;
  const owner = runsInstall(session);
  let host: string | null = null;
  try {
    host = maps?.server === null || maps?.server === undefined ? null : new URL(maps.server).host;
  } catch {
    host = maps?.server ?? null;
  }
  const state = (on: boolean) => (
    <span className="crm-pill" data-tone={on ? "pos" : undefined} data-state={on ? "on" : "off"}>
      {t(on ? "aset.on" : "aset.off")}
    </span>
  );
  return (
    <div role="tabpanel" aria-label={t("aset.tab.maps")} className="crm-ast-panel crm-ast-narrow" data-panel="maps">
      {maps === null ? (
        <Card name="maps" title={t("aset.maps.title")} sub={t("aset.maps.unknown")}>
          <></>
        </Card>
      ) : (
        <>
          <Card name="maps" title={t("aset.maps.title")} sub={t("aset.maps.sub")} aside={state(maps.enabled)}>
            <dl className="crm-ast-dl">
              <dt>{t("aset.maps.server")}</dt>
              <dd className="crm-mono" data-figure="server">
                {host ?? t("aset.maps.server.none")}
              </dd>
              <dt>{t("aset.maps.sees")}</dt>
              <dd>{t("aset.maps.sees.what")}</dd>
            </dl>
          </Card>
          <Card name="roads" title={t("aset.roads.title")} sub={t("aset.roads.sub")} aside={state(maps.enabled && maps.routing)}>
            {!maps.enabled && <p className="crm-ast-quiet">{t("aset.roads.needsMaps")}</p>}
          </Card>
        </>
      )}
      <AskLine icon={<Icon name="lock" size={15} />}>
        {t(owner ? "aset.maps.owner" : "aset.maps.ask")}{" "}
        {owner && (
          <a className="crm-ast-link" href="/settings/maps">
            {t("aset.maps.open")}
          </a>
        )}
      </AskLine>
    </div>
  );
}

/** The parts in the order the app lists them, each with the menu name it already goes by and the roles it brings. */
export const PARTS: readonly { id: PartId; name: MessageKey; line: MessageKey; roles: readonly string[]; needs?: MessageKey }[] = [
  { id: "selling", name: "nav.group.selling", line: "aset.part.selling", roles: ["admin", "sales-manager", "rep", "read-only"] },
  { id: "quotes", name: "nav.item.quotes", line: "aset.part.quotes", roles: ["admin", "sales-manager", "rep", "read-only"], needs: "aset.part.quotes.needs" },
  { id: "accounts", name: "nav.group.accounts", line: "aset.part.accounts", roles: ["admin", "sales-manager", "rep", "account-manager", "marketer", "read-only"] },
  { id: "team", name: "nav.group.team", line: "aset.part.team", roles: ["admin", "sales-manager", "rep", "read-only"] },
  { id: "inbox", name: "nav.group.inbox", line: "aset.part.inbox", roles: ["admin", "sales-manager", "rep", "marketer", "front-desk", "read-only"] },
  // Stage 2's three are listed once the install has them (the manifest's order: Supply comes after them).
  { id: "showroom", name: "nav.group.showroom", line: "aset.part.showroom", roles: ["admin", "front-desk", "read-only"] },
  { id: "jobs", name: "nav.group.jobs", line: "aset.part.jobs", roles: ["admin", "ops-manager", "crew", "read-only"] },
  { id: "aftercare", name: "nav.group.aftercare", line: "aset.part.aftercare", roles: ["admin", "account-manager", "read-only"] },
  { id: "supply", name: "nav.group.supply", line: "aset.part.supply", roles: ["admin", "ops-manager", "read-only"], needs: "aset.part.supply.needs" },
];
const ALWAYS: readonly PartId[] = ["selling", "accounts", "team"];
const PART_ICON: Record<string, string> = { selling: "columns-3", quotes: "file-text", accounts: "building-2", team: "users", inbox: "inbox", supply: "package", showroom: "store", jobs: "truck", aftercare: "heart-handshake" };

export function Parts({ session, f }: { session: StaffSession; f: Formatters }) {
  const t = useT();
  const owner = runsInstall(session);
  const known = session.config.modules ?? null;
  // The parts this install has: the ones its config names. A later stage's parts arrive with that stage, and are not listed before.
  const shown = PARTS.filter((part) => known === null || known[part.id] !== undefined);
  const on = shown.filter((part) => session.part(part.id)).length;
  return (
    <div role="tabpanel" aria-label={t("aset.tab.parts")} className="crm-ast-panel" data-panel="parts">
      <Card name="parts" flush title={t("aset.parts.title")} sub={t("aset.parts.sub")} aside={<span className="crm-mono" data-figure="parts">{t("aset.parts.count", { on: f.number(on), all: f.number(shown.length) })}</span>}>
        <div role="list" aria-label={t("aset.parts.title")}>
          {shown.map((part) => {
            const isOn = session.part(part.id);
            return (
              <div key={part.id} role="listitem" className="crm-ast-part" data-part={part.id} data-on={isOn ? "1" : "0"}>
                <span className="crm-ast-part-icon">
                  <Icon name={PART_ICON[part.id] ?? "layers"} size={17} />
                </span>
                <div className="crm-ast-part-words">
                  <div className="crm-ast-part-head">
                    <strong>{t(part.name)}</strong>
                    {ALWAYS.includes(part.id) ? (
                      <span className="crm-pill">
                        <Icon name="lock" size={11} />
                        {t("aset.parts.always")}
                      </span>
                    ) : (
                      <span className="crm-pill" data-tone={isOn ? "pos" : undefined} data-state={isOn ? "on" : "off"}>
                        {t(isOn ? "aset.on" : "aset.off")}
                      </span>
                    )}
                  </div>
                  <p>{t(part.line)}</p>
                  <div className="crm-ast-roles">
                    <span>{t("aset.parts.roles")}</span>
                    {part.roles.map((role) => (
                      <span key={role} className="crm-ast-role">
                        {t(`aset.role.${role}` as MessageKey)}
                      </span>
                    ))}
                  </div>
                  {!isOn && part.needs !== undefined && <p className="crm-ast-needs">{t(part.needs)}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <AskLine icon={<Icon name="lock" size={15} />}>{t(owner ? "aset.parts.owner" : "aset.parts.ask")}</AskLine>
    </div>
  );
}

