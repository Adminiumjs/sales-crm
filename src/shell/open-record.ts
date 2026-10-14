/**
 * WHERE A RECORD OPENS IN THIS APP: one function, used by every notice (the
 * bell) and by anything else that is handed a record from outside the app's
 * own screens.
 *
 * Adminium answers this itself once an app declares where its records open
 * (`frontends[].records` in the manifest): a notice, a search hit or an
 * e-mail's button then carries `opens: { appKey, path }`, worked out for the
 * person reading it. That is preferred whenever it is there.
 *
 * Until the CRM's manifest declares it, a notice says only which record it is
 * about: its table, as the server names it (`main.crm_deals`), and its key.
 * The table is matched to the app's own tables (the side's config names each
 * one) and the record goes to the screen this app shows it on. A record of a
 * table no screen shows, of another database or of another app opens nothing:
 * the notice is then words without a link, as the server sends a notice to
 * somebody who cannot open the record (no `entity` at all).
 *
 * Opening is not reading: the screen asks the server, and a record the person
 * cannot read answers "no record" there.
 */
import { ROUTES, type RouteKey } from "./routes.ts";

export interface Place {
  route: RouteKey;
  rest: string[];
}

/** What a notice (or a hit) says about its record, as the server sends it. */
export interface RecordRef {
  entity?: Record<string, unknown> | null;
  opens?: { appKey: string; path: string } | null;
}

/** The app's tables, by short name, that have a screen of their own for one record. */
const SCREEN_OF: Readonly<Record<string, RouteKey>> = { deals: "deal", companies: "companies", contacts: "contacts", quotes: "quotes" };

/** Routes two homes share an address with: never the target of a record. */
const AMBIGUOUS = new Set(Object.values(ROUTES).map((def) => def.path).filter((path, index, all) => all.indexOf(path) !== index));

/** An address under the staff side (`/deals/12`) as a screen and what follows it; null for an address this app has no screen at. */
export function placeOfPath(path: string): Place | null {
  const parts = path.split("/").filter((part) => part !== "");
  if (parts.length < 2 || AMBIGUOUS.has(parts[0]!)) return null;
  const route = (Object.keys(ROUTES) as RouteKey[]).find((key) => ROUTES[key].path === parts[0]);
  return route === undefined ? null : { route, rest: parts.slice(1).map((part) => decodeURIComponent(part)) };
}

/** The app's short name of a table the server names (`main.crm_deals`, `crm_deals`), given the side's map of short → stored names. */
export function refOfTable(table: string, tables: Readonly<Record<string, string>>): string | null {
  for (const [ref, stored] of Object.entries(tables)) {
    if (table === stored || table.endsWith(`.${stored}`)) return ref;
  }
  return null;
}

/**
 * Where a record opens for this app, or null when it opens nowhere here.
 *
 * `appKey` is this app's key; `connectionId` the database its tables are in;
 * `tables` the side's map of short → stored table names.
 */
export function openRecord(of: RecordRef, here: { appKey: string; connectionId: string; tables: Readonly<Record<string, string>> }): Place | null {
  // The server's own answer, for this reader, when it gives one.
  if (of.opens !== undefined && of.opens !== null) return of.opens.appKey === here.appKey ? placeOfPath(of.opens.path) : null;
  const entity = of.entity ?? null;
  if (entity === null) return null;
  const table = entity["table"];
  const pk = entity["pk"];
  if (typeof table !== "string" || pk === null || typeof pk !== "object") return null;
  if (typeof entity["connectionId"] === "string" && entity["connectionId"] !== here.connectionId) return null;
  const ref = refOfTable(table, here.tables);
  const route = ref === null ? undefined : SCREEN_OF[ref];
  if (route === undefined) return null;
  const keys = Object.values(pk as Record<string, unknown>);
  // A record with one key, a whole number: every table with a screen of its own here has one.
  if (keys.length !== 1 || !/^\d{1,15}$/.test(String(keys[0]))) return null;
  return { route, rest: [String(keys[0])] };
}
