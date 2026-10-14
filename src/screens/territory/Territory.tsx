/**
 * TERRITORY: every territory as an area on the map in a colour of its own,
 * every company as a pin in its territory's colour, and beside the map the
 * same thing as a list: whose each territory is, its companies, its open
 * deals and what they come to.
 *
 * THE MAP IS ADMINIUM'S OWN (`mount('map', …)`, see `kitParts.ts`). This
 * screen owns the rows and the list: it hands the pins and areas over as
 * plain data, draws the list itself (`hostList`), and saves what the map
 * tells it: a pin dragged or placed (the company's `place`), an area drawn
 * or reshaped (the territory's `area`). Each save is the server's to refuse,
 * and the map says the reason above itself.
 *
 * THREE STATES, none a blank frame: the map; "could not be reached" with
 * "Try again"; maps switched off for this install, when nothing is asked of
 * the map server. The list is whole in all three.
 *
 * WHOSE A COMPANY IS: its `territory_id`, not where its pin stands (ruling
 * Q8). So when an area is reshaped and now takes in companies of another
 * territory, whoever reshaped it is ASKED whether to move them, and only if
 * they may change companies. Yes: each is saved, one by one, and a refused
 * one is named. No: the area stays as drawn, the companies stay where they
 * were, and the row says which now sit inside another's area.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import type { KitMissing } from "../../kitParts.ts";
import { newClientKey } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { KitPart } from "../../ui/kit.tsx";
import { LoadFailed, Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { boxRound, readTerritory, sameJson, sameSpot, type Company, type Territory as TerritoryRow } from "./data.ts";
import { strangersIn, strayedFrom, type AreaGeometry } from "./geometry.ts";
import { RecordName } from "./Name.tsx";

type MapStatus = "loading" | "ready" | "unreachable" | "off";
type Refused = { refused: string };

interface MapPin {
  id: string;
  label: string;
  lat: number;
  lng: number;
  by?: "town" | "exact";
  colour?: number;
  group?: string;
  tone?: "neutral";
}
interface MapProps {
  maps: { enabled: boolean; server: string | null; routing?: boolean };
  pins: MapPin[];
  areas: { id: string; name: string; geometry: AreaGeometry; colour: number }[];
  locale: string;
  dir: "ltr" | "rtl";
  ariaLabel: string;
  listLabel: string;
  emptyLabel: string;
  hostList: string;
  selected: string | null;
  selectedArea: string | null;
  onSelect: (pinId: string) => void;
  onSelectArea: (areaId: string) => void;
  onStatus: (status: MapStatus) => void;
  onMovePin: ((pinId: string, at: { lat: number; lng: number }) => Promise<void | Refused>) | undefined;
  placing: { id: string; label: string } | null;
  onPlacePin: ((pinId: string, at: { lat: number; lng: number }) => Promise<void | Refused>) | undefined;
  onPlacingStop: () => void;
  onAreaChange: ((areaId: string | null, geometry: AreaGeometry) => Promise<void | Refused>) | undefined;
  settingsHref: string | undefined;
}

const LIST_ID = "crm-terr-list";

type Pick = { kind: "territory" | "company"; id: number } | null;

export function Territory(_props: ScreenProps) {
  const t = useT();
  const { locale, dir } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const canPlace = session.can("companies", "update");
  const canEdit = session.can("territories", "update");
  const canAdd = session.can("territories", "create");
  // Nobody with one of the app's roles switches maps on: that is the install's owner, who holds none.
  const runsInstall = (config.access?.roles ?? []).every((role) => !role.slug.startsWith("crm-"));

  const { load, reload } = useLoad(() => readTerritory(session), [session]);
  const again = useCoalesced(reload);
  useLive(["territories", "companies", "deals"], again);

  const [status, setStatus] = useState<MapStatus>(config.maps?.enabled === false ? "off" : "loading");
  const [pick, setPick] = useState<Pick>(null);
  const [editing, setEditing] = useState(false);
  const [placing, setPlacing] = useState<number | null>(null);
  /** The territory whose reshaped area now takes in companies of another: the question on screen. */
  const [asking, setAsking] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  /** What a "no" was said to, while the page is open: the same companies are not asked about after every corner. */
  const declined = useRef(new Map<number, Set<number>>());

  const data = load.state === "ready" ? load.data : null;
  const live = useRef({ data, pick, editing, t });
  live.current = { data, pick, editing, t };

  const territoryOf = useCallback((id: number | null): TerritoryRow | null => (id === null ? null : (live.current.data?.territories.find((one) => one.id === id) ?? null)), []);
  const target = editing && pick?.kind === "territory" ? pick.id : null;

  /** Keep a company's position. Answers the reason when the server said no, as the map wants it. */
  const savePlace = useCallback(
    async (pinId: string, at: { lat: number; lng: number }, placed: boolean): Promise<void | Refused> => {
      const say = live.current.t;
      const id = Number(pinId);
      const company = live.current.data?.companies.find((one) => one.id === id);
      const sent = { lat: at.lat, lng: at.lng };
      let saved = await session.update("companies", id, { place: sent });
      // A lost reply is read back by the client, which cannot tell one position from another: look for ourselves, and send once more if it is not there.
      if (saved.state === "saved" && saved.readBack && !sameSpot(saved.row["place"], sent)) saved = await session.update("companies", id, { place: sent });
      if (saved.state === "refused") return { refused: reasonOf(saved.error, say) };
      if (saved.state === "unknown" || (saved.readBack && !sameSpot(saved.row["place"], sent))) return { refused: say("ui.unknown") };
      setPlacing(null);
      toasts.show(say(placed ? "terr.placed" : "terr.moved", { name: company?.name ?? "" }), "pos");
      again();
    },
    [session, toasts, again],
  );

  /** Keep a territory's area, then see whether it now takes in companies of another territory. */
  const saveArea = useCallback(
    async (territoryId: number, geometry: AreaGeometry): Promise<void | Refused> => {
      const say = live.current.t;
      let saved = await session.update("territories", territoryId, { area: geometry });
      if (saved.state === "saved" && saved.readBack && !sameJson(saved.row["area"], geometry)) saved = await session.update("territories", territoryId, { area: geometry });
      if (saved.state === "refused") return { refused: reasonOf(saved.error, say) };
      if (saved.state === "unknown" || (saved.readBack && !sameJson(saved.row["area"], geometry))) return { refused: say("ui.unknown") };
      const inside = strangersIn(territoryId, geometry, (live.current.data?.companies ?? []).map(placedOf));
      const no = declined.current.get(territoryId) ?? new Set<number>();
      // Only somebody who may change companies is asked, and only about companies they have not already said no to.
      if (canPlace && inside.some((company) => !no.has(company.id))) setAsking(territoryId);
      again();
    },
    [session, canPlace, again],
  );

  const onAreaChange = useCallback(
    async (areaId: string | null, geometry: AreaGeometry): Promise<void | Refused> => {
      const now = live.current;
      // A shape drawn new is the picked territory's; a changed one is the territory it was read from.
      const id = areaId !== null ? Number(areaId) : now.editing && now.pick?.kind === "territory" ? now.pick.id : null;
      if (id === null || !Number.isFinite(id)) return { refused: now.t("terr.edit.pickFirst") };
      return saveArea(id, geometry);
    },
    [saveArea],
  );

  const onSelect = useCallback((pinId: string) => setPick({ kind: "company", id: Number(pinId) }), []);
  const onSelectArea = useCallback((areaId: string) => setPick({ kind: "territory", id: Number(areaId) }), []);
  const onMovePin = useCallback((pinId: string, at: { lat: number; lng: number }) => savePlace(pinId, at, false), [savePlace]);
  const onPlacePin = useCallback((pinId: string, at: { lat: number; lng: number }) => savePlace(pinId, at, true), [savePlace]);
  const onPlacingStop = useCallback(() => setPlacing(null), []);

  // Placing is done on the map: bring it into view when a row far down the list asks for it.
  const mapBox = useRef<HTMLElement>(null);
  useEffect(() => {
    if (placing !== null) mapBox.current?.scrollIntoView({ block: "nearest" });
  }, [placing]);

  // Placing and reshaping need a map that is there.
  useEffect(() => {
    if (status === "ready") return;
    setPlacing(null);
    setEditing(false);
  }, [status]);

  const mapProps = useMemo<MapProps | null>(() => {
    if (data === null) return null;
    const byId = new Map(data.territories.map((one) => [one.id, one]));
    const ownerName = (territory: TerritoryRow | undefined): string | undefined => (territory === undefined ? undefined : territory.ownerId !== null && data.names[territory.ownerId] !== undefined ? `${territory.name} · ${data.names[territory.ownerId]!}` : territory.name);
    const pins: MapPin[] = data.companies.flatMap((company) => {
      if (company.spot === null) return [];
      const territory = company.territoryId === null ? undefined : byId.get(company.territoryId);
      const group = ownerName(territory);
      return [{ id: String(company.id), label: company.name, lat: company.spot.lat, lng: company.spot.lng, by: company.spot.by, ...(territory === undefined ? { tone: "neutral" as const } : { colour: territory.colour }), ...(group === undefined ? {} : { group }) }];
    });
    const placingCompany = placing === null ? undefined : data.companies.find((one) => one.id === placing);
    const picked = pick?.kind === "territory" ? byId.get(pick.id) : undefined;
    return {
      maps: config.maps ?? { enabled: false, server: null, routing: false },
      pins,
      areas: data.territories.flatMap((one) => (one.area === null ? [] : [{ id: String(one.id), name: one.name, geometry: one.area, colour: one.colour }])),
      locale: config.locale ?? locale,
      dir: config.dir ?? dir,
      ariaLabel: t("terr.map.label"),
      listLabel: t("terr.list.title"),
      emptyLabel: t("terr.map.empty"),
      hostList: LIST_ID,
      selected: pick?.kind === "company" && data.companies.some((one) => one.id === pick.id && one.spot !== null) ? String(pick.id) : null,
      selectedArea: picked !== undefined && picked.area !== null ? String(picked.id) : null,
      onSelect,
      onSelectArea,
      onStatus: setStatus,
      onMovePin: canPlace && !editing ? onMovePin : undefined,
      placing: placingCompany === undefined ? null : { id: String(placingCompany.id), label: placingCompany.name },
      onPlacePin: canPlace ? onPlacePin : undefined,
      onPlacingStop,
      // Reshaping is on only while a territory is picked in "Edit areas": every shape the map hands back then has a territory to be saved to.
      onAreaChange: canEdit && target !== null ? onAreaChange : undefined,
      settingsHref: runsInstall ? "/settings/maps" : undefined,
    };
  }, [data, config, locale, dir, t, pick, placing, editing, target, canPlace, canEdit, runsInstall, onSelect, onSelectArea, onMovePin, onPlacePin, onPlacingStop, onAreaChange]);

  const noKit = (why: KitMissing, retry: () => void) =>
    why === "failed" ? (
      <LoadFailed reload={retry} />
    ) : (
      <div className="crm-empty crm-terr-nokit" role="status">
        <span className="crm-empty-icon">
          <Icon name="map" size={21} />
        </span>
        <div className="crm-empty-title">{t("terr.nokit")}</div>
        <p>{t("terr.nokit.body")}</p>
      </div>
    );

  const startEditing = (): void => {
    setPlacing(null);
    // Nothing picked: the person says which territory by picking its row.
    setPick(null);
    setEditing(true);
  };

  const startArea = async (territory: TerritoryRow, companies: Company[]): Promise<void> => {
    const box = boxRound(companies.flatMap((company) => (company.territoryId === territory.id && company.spot !== null ? [company.spot] : [])));
    if (box === null) return;
    const refused = await saveArea(territory.id, box);
    if (refused !== undefined) toasts.show(t("ui.refused", { reason: refused.refused }), "danger", true);
    else toasts.show(t("terr.edit.started", { name: territory.name }), "pos");
  };

  const setOwner = async (territory: TerritoryRow, ownerId: string): Promise<void> => {
    await toasts.say(session.update("territories", territory.id, { owner_id: ownerId === "" ? null : ownerId }, { seen: { owner_id: territory.ownerId } }), () => t("terr.edit.ownerSaved", { name: territory.name }));
    again();
  };
  const rename = async (territory: TerritoryRow, name: string): Promise<void> => {
    const next = name.trim();
    if (next === "" || next === territory.name) return;
    await toasts.say(session.update("territories", territory.id, { name: next }, { seen: { name: territory.name } }), () => t("terr.edit.renamed", { name: next }));
    again();
  };
  const newKey = useRef<string | null>(null);
  const addTerritory = async (): Promise<void> => {
    // One key for this press and its retries: a reply that is lost makes one territory, not two.
    newKey.current ??= newClientKey();
    const made = await toasts.say(session.create<{ id: number }>("territories", { name: t("terr.edit.newName") }, newKey.current), () => t("terr.edit.added"));
    if (made === null) return;
    newKey.current = null;
    setPick({ kind: "territory", id: made.id });
    again();
  };

  const moveIn = async (territory: TerritoryRow, companies: Company[]): Promise<void> => {
    setMoving(true);
    const failed: string[] = [];
    let moved = 0;
    // One company at a time: each is its own save, and one refusal does not stop the rest.
    for (const company of companies) {
      const saved = await session.update("companies", company.id, { territory_id: territory.id }, { seen: { territory_id: company.territoryId } });
      if (saved.state === "saved") moved += 1;
      else failed.push(saved.state === "refused" ? `${company.name}: ${reasonOf(saved.error, t)}` : `${company.name}: ${t("ui.unknown")}`);
    }
    setMoving(false);
    setAsking(null);
    if (failed.length === 0) toasts.show(t("terr.offer.moved", { name: territory.name, count: f.number(moved) }, moved), "pos");
    else toasts.show(`${t("terr.offer.moved", { name: territory.name, count: f.number(moved) }, moved)} ${t("terr.offer.failed", { list: failed.join("; ") })}`, "danger", true);
    again();
  };

  return (
    <div className="crm-screen crm-terr mr-screen" data-screen="territory" data-map={status}>
      <h1>{t("terr.title")}</h1>
      <p className="crm-screen-sub">{t("terr.sub")}</p>

      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={2} height={220} />}>
        {(loaded) => {
          const byId = new Map(loaded.territories.map((one) => [one.id, one]));
          const placed = loaded.companies.map(placedOf);
          const unplaced = loaded.companies.filter((company) => company.spot === null);
          const noTerritory = loaded.companies.filter((company) => company.territoryId === null || !byId.has(company.territoryId));
          const targetRow = territoryOf(target);
          const askingRow = territoryOf(asking);
          const askingAbout = askingRow === null ? [] : strangersIn(askingRow.id, askingRow.area, placed).map((one) => one.company);
          const whereNow = (company: Company): string => (company.territoryId !== null && byId.has(company.territoryId) ? byId.get(company.territoryId)!.name : t("terr.none"));
          const editLine =
            !editing || status !== "ready"
              ? null
              : targetRow === null
                ? t("terr.edit.pick")
                : targetRow.area === null
                  ? t(loaded.companies.some((company) => company.territoryId === targetRow.id && company.spot !== null) ? "terr.edit.draw" : "terr.edit.drawOnly", { name: targetRow.name })
                  : t("terr.edit.reshape", { name: targetRow.name });
          return (
            <div className="crm-terr-grid">
              <section ref={mapBox} className="crm-terr-map" aria-label={t("terr.map.label")}>
                {editLine !== null && (
                  <div className="crm-terr-bar" role="status">
                    <span>{editLine}</span>
                    {targetRow !== null && targetRow.area === null && loaded.companies.some((company) => company.territoryId === targetRow.id && company.spot !== null) && (
                      <button type="button" className="crm-btn crm-btn-ghost mr-gi" data-testid="terr-start-area" onClick={() => void startArea(targetRow, loaded.companies)}>
                        <Icon name="map" size={14} />
                        {t("terr.edit.start")}
                      </button>
                    )}
                  </div>
                )}
                {mapProps !== null && <KitPart<MapProps> part="map" className="crm-terr-kit" props={mapProps} fallback={noKit} />}
                {status === "off" && !runsInstall && <p className="crm-terr-ask">{t("terr.off.ask")}</p>}
                <div className="crm-terr-foot">
                  <span className="crm-fact">
                    {t("terr.foot.placed")}
                    <span className="crm-mono crm-fact-value" data-testid="terr-placed">
                      {f.number(loaded.placed.companies)}
                    </span>
                  </span>
                  {session.can("deals", "read") && (
                    <span className="crm-fact">
                      {t("terr.foot.open")}
                      <span className="crm-mono crm-fact-value" data-testid="terr-placed-open">
                        {f.money(loaded.placed.value)}
                      </span>
                    </span>
                  )}
                </div>
              </section>

              <div className="crm-terr-side">
                <section className="crm-terr-card mr-card" aria-labelledby="crm-terr-list-title">
                  <div className="crm-terr-head">
                    <h2 id="crm-terr-list-title">{t("terr.list.title")}</h2>
                    {canEdit && !editing && status === "ready" && (
                      <button type="button" className="crm-btn crm-btn-ghost mr-gi" data-testid="terr-edit" onClick={startEditing}>
                        <Icon name="pencil" size={14} />
                        {t("terr.edit")}
                      </button>
                    )}
                    {editing && (
                      <span className="crm-terr-head-btns">
                        {canAdd && (
                          <button type="button" className="crm-btn crm-btn-ghost mr-gi" data-testid="terr-new" onClick={() => void addTerritory()}>
                            <Icon name="plus" size={14} />
                            {t("terr.edit.new")}
                          </button>
                        )}
                        <button type="button" className="crm-btn crm-btn-primary mr-btn" data-testid="terr-done" onClick={() => setEditing(false)}>
                          <Icon name="check" size={14} />
                          {t("terr.edit.done")}
                        </button>
                      </span>
                    )}
                  </div>
                  {canEdit && status !== "ready" && status !== "loading" && <p className="crm-terr-note">{t("terr.edit.needsMap")}</p>}
                  <ul id={LIST_ID} className="crm-terr-list" aria-busy={load.state === "ready" && load.again}>
                    {loaded.territories.map((territory) => {
                      const figures = loaded.figures[territory.id];
                      const companies = loaded.companies.filter((company) => company.territoryId === territory.id);
                      const owner = territory.ownerId === null ? t("terr.row.noOwner") : (loaded.names[territory.ownerId] ?? t("terr.row.someone"));
                      const inside = strangersIn(territory.id, territory.area, placed).map((one) => one.company);
                      const strayed = strayedFrom(territory.id, territory.area, placed).map((one) => one.company);
                      const opens = figures?.marked ?? figures?.open ?? 0;
                      const whole = figures === undefined || figures.marked === null || figures.marked === figures.open;
                      const isTarget = target === territory.id;
                      return (
                        <li key={territory.id} className="crm-terr-row" data-territory={territory.id} data-picked={pick?.kind === "territory" && pick.id === territory.id}>
                          <button type="button" className="crm-terr-pick mr-row" aria-pressed={pick?.kind === "territory" && pick.id === territory.id} onClick={() => setPick({ kind: "territory", id: territory.id })}>
                            <span className="crm-terr-swatch" data-colour={territory.colour % 8} aria-hidden="true" />
                            <span className="crm-terr-name">
                              <span className="crm-terr-name-main">{territory.name}</span>
                              <span className="crm-terr-owner">
                                {owner} · {t("terr.row.companies", { count: f.number(companies.length) }, companies.length)}
                                {territory.area === null ? ` · ${t("terr.row.noArea")}` : ""}
                              </span>
                            </span>
                            <span className="crm-terr-figures">
                              {session.can("deals", "read") && (
                                <span className="crm-mono crm-terr-value" data-testid="terr-value">
                                  {f.money(figures?.value ?? 0)}
                                </span>
                              )}
                              <span className="crm-mono crm-terr-open" data-testid="terr-open">
                                {t("terr.row.open", { count: f.number(opens) }, opens)}
                              </span>
                            </span>
                          </button>
                          {companies.length > 0 && (
                            <ul className="crm-terr-companies">
                              {companies.map((company) => (
                                <li key={company.id}>
                                  {company.spot === null ? (
                                    <span className="crm-terr-company" data-placed="false">
                                      <RecordName kind="company" id={company.id}>
                                        {company.name}
                                      </RecordName>
                                      <span className="crm-terr-company-note">{t("terr.company.noPlace")}</span>
                                    </span>
                                  ) : (
                                    <button type="button" className="crm-terr-company mr-lnk" aria-pressed={pick?.kind === "company" && pick.id === company.id} onClick={() => setPick({ kind: "company", id: company.id })}>
                                      <RecordName kind="company" id={company.id}>
                                        {company.name}
                                      </RecordName>
                                      {company.spot.by === "town" && <span className="crm-terr-company-note">{t("terr.company.byTown")}</span>}
                                    </button>
                                  )}
                                  {company.open !== null && company.open > 0 && <span className="crm-mono crm-terr-company-value">{f.money(company.openValue ?? 0)}</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="crm-mono crm-terr-other" data-testid="terr-other">
                            {opens === 0
                              ? t("terr.row.noOpen")
                              : !whole
                                ? t("terr.row.yours", { mine: f.number(figures?.open ?? 0), all: f.number(opens) })
                                : figures?.others === null || figures === undefined
                                  ? ""
                                  : t("terr.row.others", { others: f.number(figures.others), all: f.number(opens) })}
                          </div>
                          {inside.length > 0 && (
                            <div className="crm-terr-inside" data-testid="terr-inside">
                              <Icon name="triangle-alert" size={14} />
                              <span>{t("terr.row.inside", { list: inside.map((company) => t("terr.row.insideOne", { company: company.name, territory: whereNow(company) })).join(", ") })}</span>
                              {editing && canPlace && (
                                <button type="button" className="crm-terr-inside-btn mr-lnk" onClick={() => setAsking(territory.id)}>
                                  {t("terr.row.insideMove")}
                                </button>
                              )}
                            </div>
                          )}
                          {strayed.length > 0 && (
                            <div className="crm-terr-strayed" data-testid="terr-strayed">
                              {t("terr.row.strayed", { list: strayed.map((company) => company.name).join(", ") })}
                            </div>
                          )}
                          {editing && isTarget && (
                            <div className="crm-terr-fields">
                              <label>
                                {t("terr.edit.name")}
                                <input
                                  className="crm-input mr-fld"
                                  defaultValue={territory.name}
                                  key={territory.name}
                                  maxLength={80}
                                  onBlur={(event) => void rename(territory, event.currentTarget.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") event.currentTarget.blur();
                                  }}
                                />
                              </label>
                              <label>
                                {t("terr.edit.owner")}
                                <select className="crm-input mr-fld" value={territory.ownerId ?? ""} onChange={(event) => void setOwner(territory, event.currentTarget.value)}>
                                  <option value="">{t("terr.row.noOwner")}</option>
                                  {[...new Set([...loaded.owners, ...(territory.ownerId === null ? [] : [territory.ownerId])])].map((id) => (
                                    <option key={id} value={id}>
                                      {loaded.names[id] ?? t("terr.row.someone")}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          )}
                        </li>
                      );
                    })}
                    {loaded.territories.length === 0 && <li className="crm-terr-empty">{t(canAdd ? "terr.list.empty.add" : "terr.list.empty")}</li>}
                  </ul>
                  {noTerritory.length > 0 && (
                    <p className="crm-terr-note" data-testid="terr-no-territory">
                      {t("terr.list.noTerritory", { list: noTerritory.map((company) => company.name).join(", ") })}
                    </p>
                  )}
                  {loaded.cut && <p className="crm-terr-note">{t("terr.list.cut", { count: f.number(loaded.companies.length) })}</p>}
                </section>

                <section className="crm-terr-card mr-card" aria-labelledby="crm-terr-unplaced-title">
                  <div className="crm-terr-head crm-terr-head-stack">
                    <h2 id="crm-terr-unplaced-title">{t("terr.unplaced.title")}</h2>
                    <p>{t("terr.unplaced.sub")}</p>
                  </div>
                  <ul className="crm-terr-unplaced">
                    {unplaced.map((company) => (
                      <li key={company.id} data-company={company.id}>
                        <span className="crm-terr-unplaced-main">
                          <RecordName kind="company" id={company.id} className="crm-terr-unplaced-name">
                            {company.name}
                          </RecordName>
                          <span className="crm-terr-unplaced-addr">{company.town ?? ""}</span>
                        </span>
                        {canPlace && status === "ready" && !editing && (
                          <button type="button" className="crm-btn crm-btn-ghost mr-gi" aria-pressed={placing === company.id} onClick={() => setPlacing((now) => (now === company.id ? null : company.id))}>
                            <Icon name="map-pin" size={14} />
                            {t(placing === company.id ? "terr.unplaced.placing" : "terr.unplaced.place")}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {unplaced.length === 0 && <p className="crm-terr-note">{t("terr.unplaced.none")}</p>}
                  {unplaced.length > 0 && canPlace && status !== "ready" && status !== "loading" && <p className="crm-terr-note">{t("terr.unplaced.needsMap")}</p>}
                </section>
              </div>

              {askingRow !== null && askingAbout.length > 0 && (
                <Dialog
                  shape="box"
                  icon="map"
                  name="terr-offer"
                  title={t("terr.offer.title", { name: askingRow.name, count: f.number(askingAbout.length) }, askingAbout.length)}
                  subtitle={t("terr.offer.sub")}
                  busy={moving}
                  onClose={() => {
                    declined.current.set(askingRow.id, new Set(askingAbout.map((company) => company.id)));
                    setAsking(null);
                  }}
                  foot={
                    <>
                      <button
                        type="button"
                        className="crm-btn crm-btn-ghost mr-gi"
                        disabled={moving}
                        data-testid="terr-offer-no"
                        onClick={() => {
                          declined.current.set(askingRow.id, new Set(askingAbout.map((company) => company.id)));
                          setAsking(null);
                        }}
                      >
                        {t("terr.offer.no")}
                      </button>
                      <button type="button" className="crm-btn crm-btn-primary mr-btn" disabled={moving} data-testid="terr-offer-yes" onClick={() => void moveIn(askingRow, askingAbout)}>
                        {t(moving ? "ui.saving" : "terr.offer.yes", { name: askingRow.name })}
                      </button>
                    </>
                  }
                >
                  <ul className="crm-terr-offer-list">
                    {askingAbout.map((company) => (
                      <li key={company.id}>
                        <RecordName kind="company" id={company.id}>
                          {company.name}
                        </RecordName>
                        <span>{t("terr.offer.now", { territory: whereNow(company) })}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="crm-terr-offer-note">{t("terr.offer.note", { name: askingRow.name })}</p>
                </Dialog>
              )}
            </div>
          );
        }}
      </Loaded>
    </div>
  );
}

/** A company as the geometry reads it, with the row kept beside it. */
function placedOf(company: Company): { id: number; territoryId: number | null; spot: Company["spot"]; company: Company } {
  return { id: company.id, territoryId: company.territoryId, spot: company.spot, company };
}
