/**
 * WHICH PINS FALL INSIDE AN AREA. Plain geometry over what is already on the
 * page: a territory's drawn outline and the companies' positions. No row is
 * added up here and nothing is read; the answer is only ever used to OFFER a
 * move (the company's own `territory_id` decides whose it is, and each move
 * is a save the server may refuse).
 *
 * An area is GeoJSON as Adminium keeps it: a `Polygon` (an outer ring, then
 * holes) or a `MultiPolygon` (several of those), positions as `[lng, lat]`.
 * A point on an edge counts as inside. The test is the even-odd rule on the
 * plane of longitude and latitude, which is what the map draws; an area that
 * crosses the date line is not handled (a sales territory does not).
 */
export type Ring = readonly (readonly number[])[];
export type AreaGeometry = { type: "Polygon"; coordinates: readonly Ring[] } | { type: "MultiPolygon"; coordinates: readonly (readonly Ring[])[] };

export interface Spot {
  lat: number;
  lng: number;
}

/** What a json column gave back, when it is an area the map can draw; else null. */
export function areaOf(value: unknown): AreaGeometry | null {
  let doc: unknown = value;
  if (typeof doc === "string") {
    try {
      doc = JSON.parse(doc);
    } catch {
      return null;
    }
  }
  if (doc === null || typeof doc !== "object") return null;
  const { type, coordinates } = doc as { type?: unknown; coordinates?: unknown };
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
  const ring = (one: unknown): boolean => Array.isArray(one) && one.length >= 4 && one.every((at) => Array.isArray(at) && at.length >= 2 && Number.isFinite(at[0]) && Number.isFinite(at[1]));
  const polygon = (one: unknown): boolean => Array.isArray(one) && one.length > 0 && one.every(ring);
  if (type === "Polygon" && polygon(coordinates)) return { type, coordinates: coordinates as Ring[] };
  if (type === "MultiPolygon" && coordinates.every(polygon)) return { type, coordinates: coordinates as Ring[][] };
  return null;
}

/** Where a place column says a company is, or null when it has no position yet. */
export function spotOf(value: unknown): (Spot & { by: "town" | "exact" }) | null {
  let doc: unknown = value;
  if (typeof doc === "string") {
    try {
      doc = JSON.parse(doc);
    } catch {
      return null;
    }
  }
  if (doc === null || typeof doc !== "object") return null;
  const { lat, lng, by } = doc as { lat?: unknown; lng?: unknown; by?: unknown };
  // A position is two numbers: "" and null are not zero.
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, by: by === "town" ? "town" : "exact" };
}

function onEdge(at: Spot, a: readonly number[], b: readonly number[]): boolean {
  const [ax, ay, bx, by] = [a[0]!, a[1]!, b[0]!, b[1]!];
  const cross = (bx - ax) * (at.lat - ay) - (by - ay) * (at.lng - ax);
  if (Math.abs(cross) > 1e-12) return false;
  return at.lng >= Math.min(ax, bx) - 1e-12 && at.lng <= Math.max(ax, bx) + 1e-12 && at.lat >= Math.min(ay, by) - 1e-12 && at.lat <= Math.max(ay, by) + 1e-12;
}

/** Inside one ring (its edge included), by the even-odd rule. */
export function inRing(at: Spot, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (onEdge(at, a, b)) return true;
    const [ax, ay, bx, by] = [a[0]!, a[1]!, b[0]!, b[1]!];
    if (ay > at.lat !== by > at.lat && at.lng < ((bx - ax) * (at.lat - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

const inPolygon = (at: Spot, rings: readonly Ring[]): boolean => rings.length > 0 && inRing(at, rings[0]!) && !rings.slice(1).some((hole) => inRing(at, hole) && !hole.some((corner, i) => onEdge(at, corner, hole[(i + 1) % hole.length]!)));

/** Whether a position is inside an area: in one of its pieces and in none of that piece's holes. */
export function inArea(at: Spot, area: AreaGeometry): boolean {
  return area.type === "Polygon" ? inPolygon(at, area.coordinates) : area.coordinates.some((rings) => inPolygon(at, rings));
}

export interface PlacedCompany {
  id: number;
  territoryId: number | null;
  spot: Spot | null;
}

/**
 * The companies that sit inside an area and belong to another territory (or
 * to none): the ones a reshaped area offers to take. A company with no
 * position is never among them: where it is, is not known.
 */
export function strangersIn<C extends PlacedCompany>(territoryId: number, area: AreaGeometry | null, companies: readonly C[]): C[] {
  if (area === null) return [];
  return companies.filter((company) => company.territoryId !== territoryId && company.spot !== null && inArea(company.spot, area));
}

/** The companies of a territory whose pin stands outside its own drawn area. A territory with no area has none: nothing says where its edge is. */
export function strayedFrom<C extends PlacedCompany>(territoryId: number, area: AreaGeometry | null, companies: readonly C[]): C[] {
  if (area === null) return [];
  return companies.filter((company) => company.territoryId === territoryId && company.spot !== null && !inArea(company.spot, area));
}
