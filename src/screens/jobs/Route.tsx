/**
 * THE ROUTE (ledger screen 52, P21): one day, one crew. Out of the depot,
 * round the day's stops in the order they start, and back.
 *
 * The map is Adminium's own (the kit's map part, T24.5 and T25): the depot and
 * each stop as pins, the way out drawn between them, a drive time a leg where
 * routes along roads are on. The list beside it is this screen's (`hostList`):
 * each stop with its address, who to ask for, the leg before it, when the crew
 * starts there and how long it stays. The legs are the server's answer
 * (`POST /geo/route`), straight lines unless roads are switched on, and a leg
 * between two places known only as the same town is "unknown", never 0
 * (T25's rule). The whole way is given only when every leg has a length.
 *
 * A stop sits where its JOB is (B15), not on the customer's pin; dragging it
 * puts the job's place on the street, for whoever may change a job (the
 * operations manager, the CRM admin). The depot is the CRM admin's to move,
 * in Settings → Places, and here too.
 *
 * Addresses: `route/<day>/<crew>`, as the day sheet.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { kitCommon, type KitMissing } from "../../kitParts.ts";
import { addDays, type Formatters } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink, useNav } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import type { StaffSession } from "../../staffSession.ts";
import { KitPart } from "../../ui/kit.tsx";
import { Loaded, LoadFailed, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { reasonOf } from "../../ui/toast.tsx";
import { dayKeyOf, ofDay, placeOf, readBooked, readDayHours, readJobs, startOf, weekColumns, type CrewFacts, type Job, type JobSettings, type Visit } from "./data.ts";
import { pickSheet } from "./DaySheet.tsx";
import { CrewChips, DayChips, dayLong, hoursOf, mondayOf, useCrewFacts, useJobsScreen, WeekBar } from "./parts.tsx";
import { hasVanDays, readVanDays, rowOf, truthyHired } from "./vandays.ts";

interface Stop {
  lat: number;
  lng: number;
  by?: "town" | "exact";
  placeId?: number;
}
interface Leg {
  distanceM: number | null;
  durationS: number | null;
  estimate: boolean;
  unknown?: true;
}
interface RouteAnswer {
  source: "straight" | "server";
  fellBack?: true;
  legs: Leg[];
  line?: unknown;
}
type MapStatus = "loading" | "ready" | "unreachable" | "off";
type Refused = { refused: string };
interface MapPin {
  id: string;
  label: string;
  lat: number;
  lng: number;
  by?: "town" | "exact";
  colour?: number;
  tone?: "neutral" | "accent";
}
interface MapProps {
  maps: { enabled: boolean; server: string | null; routing?: boolean };
  pins: MapPin[];
  locale: string;
  dir: "ltr" | "rtl";
  ariaLabel: string;
  listLabel: string;
  emptyLabel: string;
  hostList: string;
  units: "km" | "mi";
  route: (stops: Stop[]) => Promise<RouteAnswer>;
  onStatus: (status: MapStatus) => void;
  onMovePin: ((pinId: string, at: { lat: number; lng: number }) => Promise<void | Refused>) | undefined;
  mapsSiteLink: boolean;
  settingsHref: string | undefined;
}

const LIST_ID = "crm-jb-route-list";
const DEPOT = "depot";

/** Where a job's site is: the place kept on it, at the position the job keeps (the ledger's), by town until a pin is put on the street. */
export function stopOf(job: Pick<Job, "lat" | "lng" | "place"> | undefined): Stop | null {
  if (job === undefined) return null;
  const place = placeOf(job.place);
  const lat = job.lat === null || job.lat === "" ? null : Number(job.lat);
  const lng = job.lng === null || job.lng === "" ? null : Number(job.lng);
  if (lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng, by: place?.by ?? "town", ...(place?.by === "town" && place.placeId !== undefined ? { placeId: place.placeId } : {}) };
  return place === null ? null : { lat: place.lat, lng: place.lng, by: place.by, ...(place.placeId === undefined ? {} : { placeId: place.placeId }) };
}

/** Where the depot is: the settings' place, at the position they keep. */
export function depotOf(settings: JobSettings | null): Stop | null {
  if (settings === null) return null;
  return stopOf({ lat: settings.depot_lat, lng: settings.depot_lng, place: settings.depot_place });
}

/** The legs between stops, as the server answers them (straight unless routes along roads are on). */
async function askRoute(session: StaffSession, stops: Stop[]): Promise<RouteAnswer> {
  const answer = await session.call<{ data: RouteAnswer }>("POST", "/geo/route", { stops: stops.map((stop) => ({ lat: stop.lat, lng: stop.lng, ...(stop.by === undefined ? {} : { by: stop.by }), ...(stop.placeId === undefined ? {} : { placeId: stop.placeId }) })) });
  return answer.data;
}

/** A distance in the unit the business chose (Settings), one decimal place. */
export function distanceOf(t: ReturnType<typeof useT>, f: Formatters, metres: number, unit: "km" | "mi"): string {
  const value = unit === "mi" ? metres / 1609.344 : metres / 1000;
  return t(unit === "mi" ? "jb.rt.mi" : "jb.rt.km", { n: f.number(Math.round(value * 10) / 10) });
}

/** A drive time: `1 h 12 min`. */
function driveOf(t: ReturnType<typeof useT>, f: Formatters, seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? t("jb.rt.drive.hm", { h: f.number(Math.floor(minutes / 60)), m: f.number(minutes % 60) }) : t("jb.rt.drive.m", { m: f.number(minutes) });
}

export function RouteScreen({ rest }: ScreenProps) {
  const t = useT();
  const nav = useNav();
  const { session, f, today, tick } = useJobsScreen();
  const { load: facts, reload: reloadFacts } = useCrewFacts(session);
  const from = mondayOf(rest[0] !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(rest[0]) ? rest[0] : today);
  const { load, reload } = useLoad(() => Promise.all([readBooked(session, addDays(from, -7), addDays(from, 27)), readJobs(session)]), [session, from]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["job_visits", "jobs"], again);
  useLive(["crews", "crew_members", "crew_days", "settings"], useCoalesced(reloadFacts));

  return (
    <div className="crm-screen crm-jb mr-screen" data-screen="route">
      <div className="crm-screen-head">
        <div>
          <h1>{t("jb.rt.title")}</h1>
          <p className="crm-screen-sub crm-jb-lead">{t("jb.rt.sub")}</p>
        </div>
      </div>
      <Loaded load={facts} reload={reloadFacts} skeleton={<Skeleton rows={2} height={140} />}>
        {(crews) => (
          <Loaded load={load} reload={reload} skeleton={<Skeleton rows={2} height={200} />}>
            {([booked, jobs]) => {
              const { day, crewId } = pickSheet(rest, booked, crews, today);
              const monday = mondayOf(day);
              const busy = new Set(booked.map((visit) => dayKeyOf(visit.day)).filter((one): one is string => one !== null));
              const go = (nextDay: string, nextCrew: number | null): void => nav.replace("route", nextDay, ...(nextCrew === null ? [] : [nextCrew]));
              return (
                <>
                  <WeekBar monday={monday} today={today} f={f} onWeek={(next) => go(weekColumns(next, crews.workDays)[0] ?? next, crewId)} />
                  <DayChips days={weekColumns(monday, crews.workDays)} picked={day} busy={busy} f={f} label={t("jb.ds.days")} onPick={(next) => go(next, crewId)} />
                  <CrewChips facts={crews} picked={crewId} label={t("jb.ds.crews")} onPick={(next) => go(day, next)} />
                  <Way key={`${day}-${String(crewId)}`} day={day} crewId={crewId} visits={ofDay(booked, day, crewId)} jobs={jobs} crews={crews} onSaved={again} />
                </>
              );
            }}
          </Loaded>
        )}
      </Loaded>
    </div>
  );
}

function Way({ day, crewId, visits, jobs, crews, onSaved }: { day: string; crewId: number | null; visits: Visit[]; jobs: Job[]; crews: CrewFacts; onSaved: () => void }) {
  const t = useT();
  const { locale, dir } = useI18n();
  const { session, f } = useJobsScreen();
  const config = session.config;
  const [reversed, setReversed] = useState(false);
  const [status, setStatus] = useState<MapStatus>(config.maps?.enabled === false ? "off" : "loading");
  const unit: "km" | "mi" = crews.settings?.distance_unit === "miles" ? "mi" : "km";
  const crew = crews.crews.find((one) => one.id === crewId);
  const crewIndex = crews.crews.findIndex((one) => one.id === crewId);
  const ordered = reversed ? [...visits].reverse() : visits;
  const byJob = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const depot = depotOf(crews.settings);
  const placed = ordered.map((visit) => ({ visit, stop: stopOf(byJob.get(visit.job_id)) }));
  // The whole day as the server answers it: out of the depot, round the stops that have a place, and back.
  const way: Stop[] = depot === null ? [] : [depot, ...placed.flatMap((one) => (one.stop === null ? [] : [one.stop])), depot];
  const wayKey = JSON.stringify(way);
  const { load: legs, reload: askAgain } = useLoad(() => (way.length < 3 ? Promise.resolve(null) : askRoute(session, way)), [session, wayKey]);
  const answer = legs.state === "ready" ? legs.data : null;
  const { load: figures } = useLoad(
    () => (crewId === null ? Promise.resolve({ hours: 0 }) : readDayHours(session, day, crewId).then((hours) => ({ hours }))),
    [session, day, crewId, visits.map((visit) => `${visit.id}:${String(visit.hours)}`).join(",")],
  );
  const onSite = figures.state === "ready" ? figures.data.hours : null;
  // The crew's vehicle that day (plan 68 S14): the head names it, from the day's own row.
  const { load: vanLoad, reload: reloadVan } = useLoad(() => (hasVanDays(session) ? readVanDays(session, day, day) : Promise.resolve([])), [session, day]);
  useLive(hasVanDays(session) ? ["van_days"] : [], reloadVan);
  const vanDay = vanLoad.state === "ready" ? rowOf(vanLoad.data, crewId, day) : undefined;

  // The legs of the placed stops, in order: [depot→1, 1→2, …, last→depot].
  const legOf = (index: number): Leg | null => answer?.legs[index] ?? null;
  const allKnown = answer !== null && answer.legs.length > 0 && answer.legs.every((leg) => leg.distanceM !== null);
  // The whole way is the legs as each is shown, to the 100 m, added up: the figures on the screen add up (80.3 + 80.3 = 160.6).
  const whole = allKnown ? answer.legs.reduce((sum, leg) => sum + Math.round((leg.distanceM ?? 0) / 100) * 100, 0) : null;
  const driveKnown = allKnown && answer.legs.every((leg) => leg.durationS !== null);
  const drive = driveKnown ? answer.legs.reduce((sum, leg) => sum + (leg.durationS ?? 0), 0) : null;
  const unknownLegs = answer?.legs.filter((leg) => leg.unknown === true).length ?? 0;
  const estimate = answer !== null && answer.legs.some((leg) => leg.estimate);
  const note =
    ordered.length === 0
      ? null
      : answer === null
        ? legs.state === "loading"
          ? t("jb.rt.note.asking")
          : depot === null
            ? t("jb.rt.note.noDepot")
            : t("jb.rt.note.unplaced")
        : unknownLegs > 0
          ? t("jb.rt.note.unknown", { count: f.number(unknownLegs) }, unknownLegs)
          : answer.fellBack === true
            ? t("jb.rt.note.fellBack")
            : answer.source === "server"
              ? t("jb.rt.note.roads")
              : t("jb.rt.note.straight");

  const depotTown = crews.settings?.depot_town ?? placeOf(crews.settings?.depot_place)?.name ?? t("jb.rt.depot");
  const sequence = ordered.length === 0 ? "" : [depotTown, ...ordered.map((visit) => visit.site_town ?? visit.site_name), depotTown].join(" → ");
  const canMoveStop = session.can("jobs", "update");
  const canMoveDepot = session.can("settings", "update") && (config.access?.roles ?? []).every((role) => !role.slug.startsWith("crm-") || role.slug === "crm-admin");
  // Nobody with one of the app's roles switches maps on: that is the install's owner, who holds none.
  const runsInstall = (config.access?.roles ?? []).every((role) => !role.slug.startsWith("crm-"));

  const onMovePin = useCallback(
    async (pinId: string, at: { lat: number; lng: number }): Promise<void | Refused> => {
      const saved =
        pinId === DEPOT
          ? crews.settings === null
            ? null
            : await session.update("settings", crews.settings.id, { depot_place: { lat: at.lat, lng: at.lng }, depot_lat: at.lat, depot_lng: at.lng })
          : await session.update("jobs", Number(pinId.split("-")[1]), { place: { lat: at.lat, lng: at.lng }, lat: at.lat, lng: at.lng });
      if (saved === null || saved.state === "unknown") return { refused: t("ui.unknown") };
      if (saved.state === "refused") return { refused: reasonOf(saved.error, t) };
      onSaved();
    },
    [session, crews.settings, t, onSaved],
  );

  const mapProps = useMemo<MapProps | null>(() => {
    if (depot === null && placed.every((one) => one.stop === null)) return null;
    const common = kitCommon(config, locale);
    const pins: MapPin[] = [
      ...(depot === null ? [] : [{ id: DEPOT, label: crews.settings?.depot_name ?? t("jb.rt.depot"), lat: depot.lat, lng: depot.lng, by: depot.by, tone: "neutral" as const }]),
      ...placed.flatMap((one, i) => (one.stop === null ? [] : [{ id: `job-${String(one.visit.job_id)}-${String(i)}`, label: one.visit.site_name, lat: one.stop.lat, lng: one.stop.lng, by: one.stop.by, ...(crewIndex < 0 ? {} : { colour: crewIndex % 8 }) }])),
    ];
    return {
      maps: config.maps ?? { enabled: false, server: null, routing: false },
      pins,
      locale: config.locale ?? common.locale,
      dir: config.dir ?? dir,
      ariaLabel: t("jb.rt.map", { crew: crew?.name ?? "", day: dayLong(f, day) }),
      listLabel: t("jb.rt.stops"),
      emptyLabel: t("jb.rt.empty"),
      hostList: LIST_ID,
      units: unit,
      // The map draws the way out of the depot and round the stops; the list below has the way back too.
      route: (stops: Stop[]) => askRoute(session, stops),
      onStatus: setStatus,
      onMovePin: canMoveStop || canMoveDepot ? (pinId, at) => (pinId === DEPOT ? (canMoveDepot ? onMovePin(pinId, at) : Promise.resolve({ refused: t("jb.rt.depot.notYours") })) : canMoveStop ? onMovePin(pinId, at) : Promise.resolve({ refused: t("ui.refused.notYours") })) : undefined,
      mapsSiteLink: true,
      settingsHref: runsInstall ? "/settings/maps" : undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the pins are named by `wayKey`
  }, [wayKey, config, locale, dir, t, crew?.name, day, unit, canMoveStop, canMoveDepot, onMovePin, runsInstall, crewIndex]);

  useEffect(() => setReversed(false), [day, crewId]);

  const noKit = (why: KitMissing, retry: () => void) =>
    why === "failed" ? (
      <LoadFailed reload={retry} />
    ) : (
      <div className="crm-empty crm-jb-nokit" role="status">
        <span className="crm-empty-icon">
          <Icon name="map" size={21} />
        </span>
        <div className="crm-empty-title">{t("jb.rt.nokit")}</div>
        <p>{t("jb.rt.nokit.body")}</p>
      </div>
    );

  let leg = 0;
  return (
    <div className="crm-jb-route" data-testid="jb-route" data-day={day} data-crew={crewId}>
      <section className="crm-jb-route-map" aria-label={t("jb.rt.mapRegion")}>
        {mapProps !== null && <KitPart<MapProps> part="map" className="crm-jb-route-kit" props={mapProps} fallback={noKit} />}
        {status === "off" && !runsInstall && <p className="crm-jb-quiet">{t("jb.rt.off.ask")}</p>}
      </section>
      <section className="crm-jb-route-side" aria-labelledby="crm-jb-route-h">
        <div className="crm-jb-route-head">
          <span className="crm-jb-dot" data-colour={crewIndex < 0 ? undefined : crewIndex % 8} aria-hidden="true" />
          <h2 id="crm-jb-route-h">{crew?.name ?? ""}</h2>
          {vanDay !== undefined && (
            <>
              <span className="crm-jb-route-dot" aria-hidden="true">
                ·
              </span>
              <span className="crm-jb-route-vehicle" data-testid="jb-route-vehicle">
                {t(truthyHired(vanDay) ? "vandays.rt.vehicle.hired" : "vandays.rt.vehicle", { plate: vanDay.plate ?? vanDay.vehicle_name ?? "" })}
              </span>
              <span className="crm-jb-route-dot" aria-hidden="true">
                ·
              </span>
            </>
          )}
          <span className="crm-jb-quiet">{dayLong(f, day)}</span>
        </div>
        <div className="crm-jb-route-stats">
          <div className="crm-jb-mini" data-figure="distance">
            <div className="crm-jb-mini-label">
              {t("jb.rt.distance")}
              {estimate && whole !== null && <span className="crm-pill" data-tone="warn">{t("jb.rt.estimate")}</span>}
            </div>
            <div className="crm-jb-mini-value crm-mono" data-value>
              {ordered.length === 0 ? "—" : whole === null ? t("jb.rt.unknown") : distanceOf(t, f, whole, unit)}
            </div>
            {drive !== null && <div className="crm-jb-quiet">{driveOf(t, f, drive)}</div>}
          </div>
          <div className="crm-jb-mini" data-figure="stops">
            <div className="crm-jb-mini-label">{t("jb.rt.stops")}</div>
            <div className="crm-jb-mini-value crm-mono" data-value>
              {f.number(ordered.length)}
            </div>
          </div>
          <div className="crm-jb-mini" data-figure="onsite">
            <div className="crm-jb-mini-label">{t("jb.rt.onSite")}</div>
            <div className="crm-jb-mini-value crm-mono" data-value>
              {onSite === null ? "…" : t("jb.hours", { n: hoursOf(f, onSite) })}
            </div>
          </div>
        </div>
        {note !== null && (
          <p className="crm-jb-route-note" data-testid="jb-route-note">
            {note}
            {answer === null && legs.state === "failed" && (
              <button type="button" className="crm-btn crm-btn-ghost crm-btn-28 mr-gi" onClick={askAgain}>
                {t("ui.tryAgain")}
              </button>
            )}
          </p>
        )}
        {ordered.length > 0 && (
          <div className="crm-jb-route-start">
            <div>
              <div className="crm-jb-fact-head">{t("jb.rt.starts")}</div>
              <div className="crm-mono" dir="ltr">
                {startOf(ordered[0]!.start_time) ?? "—"}
              </div>
            </div>
            <span className="crm-jb-quiet" data-testid="jb-route-seq">
              {sequence}
            </span>
          </div>
        )}
        <ol id={LIST_ID} className="crm-jb-route-list" aria-label={t("jb.rt.stops")}>
          {ordered.length > 0 && (
            <li className="crm-jb-route-depot" data-stop="depot">
              {/* The map numbers every pin of a route, the depot first (the kit's way): the list says the same numbers. */}
              {depot === null ? <span className="crm-jb-depot-mark" aria-hidden="true" /> : <span className="crm-jb-num crm-jb-num-depot crm-mono">{f.number(1)}</span>}
              <div>
                <div className="crm-jb-fact-head">{t("jb.rt.depot")}</div>
                <div>{[crews.settings?.depot_name, crews.settings?.depot_address, crews.settings?.depot_town].filter((part) => part !== null && part !== undefined && part !== "").join(", ") || t("jb.rt.depot.none")}</div>
              </div>
            </li>
          )}
          {placed.map(({ visit, stop }, i) => {
            const before = stop === null ? null : legOf(leg);
            if (stop !== null) leg += 1;
            return (
              <li key={`${visit.id}`} className="crm-jb-route-stop" data-stop={visit.id}>
                <span className="crm-jb-num crm-mono" data-by={stop?.by ?? "none"}>
                  {f.number(i + (depot === null ? 1 : 2))}
                </span>
                <div className="crm-jb-route-words">
                  <strong>{visit.site_name}</strong>
                  <div>{[visit.site_address, visit.site_town].filter((part) => part !== null && part !== "").join(", ")}</div>
                  <div className="crm-jb-card-what">{[visit.code, visit.title, visit.what].filter((part) => part !== null && part !== "").join(" · ")}</div>
                  {visit.ask_for !== null && (
                    <div>
                      {t("jb.rt.askFor", { who: visit.ask_for })}
                      {visit.site_phone !== null && visit.site_phone !== "" && (
                        <>
                          {" · "}
                          <a className="crm-mono" href={`tel:${visit.site_phone.replace(/[^\d+]/g, "")}`} dir="ltr">
                            {visit.site_phone}
                          </a>
                        </>
                      )}
                    </div>
                  )}
                  <div className="crm-jb-leg" data-testid="jb-leg">
                    {stop === null ? t("jb.rt.leg.unplaced") : legWords(t, f, before, i === 0, unit)}
                  </div>
                </div>
                <div className="crm-jb-route-end">
                  <div className="crm-mono" dir="ltr">
                    {startOf(visit.start_time) ?? ""}
                  </div>
                  <div className="crm-jb-quiet">{t("jb.rt.hoursOnSite", { n: hoursOf(f, visit.hours) })}</div>
                </div>
              </li>
            );
          })}
          {ordered.length === 0 && (
            <li className="crm-jb-route-none" data-testid="jb-route-empty">
              {t("jb.rt.empty")}
            </li>
          )}
          {ordered.length > 0 && (
            <li className="crm-jb-route-home" data-stop="home">
              {t("jb.rt.back", { leg: legWords(t, f, legOf(leg), false, unit, true) })}
            </li>
          )}
        </ol>
        <div className="crm-jb-route-acts">
          {ordered.length > 1 && (
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" aria-pressed={reversed} onClick={() => setReversed((was) => !was)}>
              <Icon name="arrow-left-right" size={14} />
              {t(reversed ? "jb.rt.usual" : "jb.rt.reverse")}
            </button>
          )}
          {crewId !== null && (
            <ScreenLink to="daysheet" rest={[day, crewId]} className="crm-btn crm-btn-ghost crm-btn-32 mr-gi">
              <Icon name="notebook-tabs" size={14} />
              {t("nav.item.daysheet")}
            </ScreenLink>
          )}
        </div>
      </section>
    </div>
  );
}

function legWords(t: ReturnType<typeof useT>, f: Formatters, leg: Leg | null, fromDepot: boolean, unit: "km" | "mi", home = false): string {
  if (leg === null) return t("jb.rt.leg.asking");
  if (leg.distanceM === null) return t(home ? "jb.rt.leg.unknown.home" : "jb.rt.leg.unknown");
  const distance = distanceOf(t, f, leg.distanceM, unit);
  const drive = leg.durationS === null ? null : driveOf(t, f, leg.durationS);
  const words = home ? distance : t(fromDepot ? "jb.rt.leg.fromDepot" : "jb.rt.leg.fromStop", { d: distance });
  return [words, drive, leg.estimate ? t("jb.rt.estimate") : null].filter((part) => part !== null).join(" · ");
}

