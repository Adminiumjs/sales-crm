/**
 * WHAT THE TERRITORY SCREEN READS, as the signed-in person.
 *
 * WHOSE A COMPANY IS. Its own `territory_id` decides (ruling Q8): the drawn
 * area is a picture of the territory, and a company with no pin, or a pin by
 * town, still has a territory. The geometry in `geometry.ts` only says which
 * pins an outline takes in, so a move can be offered.
 *
 * WHO ADDS UP. Nobody here. Each territory's figures are asked of the server
 * for the companies its rows name: how many open deals there are (from the
 * marks every reader of Accounts may count), how many of them this reader
 * can open and what those come to, and how many of those belong to somebody
 * other than the territory's owner. A rep's value is therefore her own
 * deals' value, and the screen says so where the two counts differ.
 */
import type { Condition, Grouped, StaffSession } from "../../staffSession.ts";
import { areaOf, spotOf, type AreaGeometry, type Spot } from "./geometry.ts";

/** A list takes 200 rows at most; a business with more companies than that sees the first 200 by name, and is told. */
export const LISTED = 200;

export interface Territory {
  id: number;
  name: string;
  ownerId: string | null;
  area: AreaGeometry | null;
  /** Its place among the map's eight colours: the territory's order by id, so a colour stays a territory's while others come and go. */
  colour: number;
}

export interface Company {
  id: number;
  name: string;
  town: string | null;
  /** The street and the rest of the address, for the list of companies not on the map (a company's street is not personal). */
  addressLines: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  territoryId: number | null;
  spot: (Spot & { by: "town" | "exact" }) | null;
  /** The open deals of this company the reader can open, and what they come to; null when the reader reads no deals. */
  open: number | null;
  openValue: number | null;
}

export interface Figures {
  /** Every open deal at the territory's companies, whoever owns it; null when the reader may not count them. */
  marked: number | null;
  /** The open deals the reader can open, and their value. */
  open: number;
  value: number;
  /** Of those, the ones whose owner is not the territory's owner; null when the territory has no owner. */
  others: number | null;
}

export interface TerritoryData {
  territories: Territory[];
  companies: Company[];
  /** More companies exist than are listed. */
  cut: boolean;
  names: Record<string, string>;
  figures: Record<number, Figures>;
  /** Companies with a position, and the open deals at them: the line under the map. */
  placed: { companies: number; open: number; value: number };
  /** Who can own a territory: the people with a rep's profile. */
  owners: string[];
}

interface TerritoryRow extends Record<string, unknown> {
  id: number;
  name: string;
  owner_id: string | null;
  area: unknown;
}
interface CompanyRow extends Record<string, unknown> {
  id: number;
  name: string;
  address_lines: string | null;
  town: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  territory_id: number | null;
  place: unknown;
  open?: number | string | null;
  open_value?: number | string | null;
}

/** A measure folds an expression: the one column, as the server wants it written. (The session client types `of` as text; the server takes this.) */
const AMOUNT = { terms: [{ sign: "plus", factors: ["amount"] }] } as unknown as string;

const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const OPEN: Condition = { column: "state", op: "eq", value: "open" };

/** One group of open deals: how many, and their amounts summed, by the server. */
async function openDeals(session: StaffSession, more: Condition[]): Promise<{ count: number; value: number }> {
  const grouped = await session.figure<Grouped>({
    table: "deals",
    shape: "categorical",
    filters: [OPEN, ...more],
    groupBy: ["state"],
    aggregations: [
      { fn: "count", alias: "n" },
      { fn: "sum", column: "amount", alias: "amount" },
    ],
  });
  const values = grouped.items.find((item) => String(item.key) === "open")?.values;
  return { count: num(values?.["n"]), value: num(values?.["amount"]) };
}

const count = async (session: StaffSession, table: string, filters: Condition[]): Promise<number> => num((await session.figure<{ value: number | null }>({ table, shape: "single-metric", filters, aggregations: [{ fn: "count", alias: "n" }] })).value);

export async function readTerritory(session: StaffSession): Promise<TerritoryData> {
  const readsDeals = session.can("deals", "read");
  const readsMarks = session.can("deal_marks", "read");
  const open = [{ column: "state", in: ["open"] }];
  const [territoryPage, companyPage, people, reps] = await Promise.all([
    session.list<TerritoryRow>("territories", { select: ["id", "name", "owner_id", "area"], order: ["id"], limit: LISTED }),
    session.list<CompanyRow>("companies", {
      select: ["id", "name", "address_lines", "town", "region", "postal_code", "country", "territory_id", "place"],
      order: ["name", "id"],
      limit: LISTED,
      count: "exact",
      ...(readsDeals
        ? {
            measures: [
              { id: "open", table: "deals", fkColumn: "company_id", fn: "count" as const, where: open },
              { id: "open_value", table: "deals", fkColumn: "company_id", fn: "sum" as const, of: AMOUNT, emptyAs: "zero" as unknown as number, where: open },
            ],
          }
        : {}),
    }),
    session.people(undefined, 200).catch(() => []),
    session.can("reps", "read") ? session.list<{ user_id: string }>("reps", { select: ["user_id"], order: ["id"], limit: LISTED }).catch(() => null) : Promise.resolve(null),
  ]);

  const territories: Territory[] = territoryPage.rows.map((row, index) => ({ id: row.id, name: row.name, ownerId: row.owner_id, area: areaOf(row.area), colour: index }));
  const companies: Company[] = companyPage.rows.map((row) => ({
    id: row.id,
    name: row.name,
    town: row.town,
    addressLines: row.address_lines ?? null,
    region: row.region ?? null,
    postalCode: row.postal_code ?? null,
    country: row.country ?? null,
    territoryId: row.territory_id,
    spot: spotOf(row.place),
    open: readsDeals ? num(row.open) : null,
    openValue: readsDeals ? num(row.open_value) : null,
  }));
  const names: Record<string, string> = {};
  for (const person of people) names[person.id] = person.name;
  const me = session.config.user;
  if (me !== null && me !== undefined) names[me.id] = me.name;

  const figures: Record<number, Figures> = {};
  const none = { count: 0, value: 0 };
  const placedIds = companies.filter((company) => company.spot !== null).map((company) => company.id);
  const at = (ids: number[]): Condition => ({ column: "company_id", op: "in", value: ids });
  // Every figure of the page leaves in one request (the session client sends what is asked together as a batch).
  const [placedOpen] = await Promise.all([
    placedIds.length === 0 || !readsDeals ? Promise.resolve(none) : openDeals(session, [at(placedIds)]),
    ...territories.map(async (territory) => {
      const ids = companies.filter((company) => company.territoryId === territory.id).map((company) => company.id);
      if (ids.length === 0) {
        figures[territory.id] = { marked: readsMarks ? 0 : null, open: 0, value: 0, others: territory.ownerId === null ? null : 0 };
        return;
      }
      const [marked, mine, others] = await Promise.all([
        readsMarks ? count(session, "deal_marks", [OPEN, at(ids)]) : Promise.resolve(null),
        readsDeals ? openDeals(session, [at(ids)]) : Promise.resolve(none),
        readsDeals && territory.ownerId !== null ? count(session, "deals", [OPEN, at(ids), { column: "owner_id", op: "neq", value: territory.ownerId }]) : Promise.resolve(null),
      ]);
      figures[territory.id] = { marked, open: mine.count, value: mine.value, others };
    }),
  ]);

  return {
    territories,
    companies,
    cut: (companyPage.total ?? companies.length) > companies.length,
    names,
    figures,
    placed: { companies: placedIds.length, open: placedOpen.count, value: placedOpen.value },
    owners: reps === null ? [] : reps.rows.map((row) => row.user_id),
  };
}

/** Whether two json values say the same thing: what a read-back of a place or an area is compared by (text of an object says nothing). */
export function sameJson(a: unknown, b: unknown): boolean {
  const parsed = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };
  return JSON.stringify(parsed(a)) === JSON.stringify(parsed(b));
}

/** Whether a position read back is the one that was sent, to about a centimetre. */
export function sameSpot(read: unknown, sent: Spot): boolean {
  const spot = spotOf(read);
  return spot !== null && Math.abs(spot.lat - sent.lat) < 1e-7 && Math.abs(spot.lng - sent.lng) < 1e-7;
}

/**
 * A box round some positions, with room at its edges: where a territory's
 * area starts when it has none and the person asks for one "round its
 * companies". A closed ring of four corners, east first as GeoJSON has it.
 */
export function boxRound(spots: readonly Spot[]): AreaGeometry | null {
  if (spots.length === 0) return null;
  const lats = spots.map((spot) => spot.lat);
  const lngs = spots.map((spot) => spot.lng);
  const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  // A quarter of a degree at least, or a fifth of the span: one company alone still gets a box about 50 km across.
  const padLat = Math.max(0.25, (north - south) * 0.2);
  const narrow = Math.max(0.2, Math.cos((((south + north) / 2) * Math.PI) / 180));
  const padLng = Math.max(0.25 / narrow, (east - west) * 0.2);
  const round = (value: number): number => Math.round(value * 1e5) / 1e5;
  const [s, n, w, e] = [round(Math.max(-85, south - padLat)), round(Math.min(85, north + padLat)), round(Math.max(-179.9, west - padLng)), round(Math.min(179.9, east + padLng))];
  return {
    type: "Polygon",
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}
