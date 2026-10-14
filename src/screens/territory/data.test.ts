import { describe, expect, it } from "vitest";

import { boxRound, sameJson, sameSpot } from "./data.ts";
import { inArea } from "./geometry.ts";

describe("what a read-back is compared by", () => {
  it("compares an area by what it says, as an object or as text", () => {
    const area = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    expect(sameJson(area, JSON.parse(JSON.stringify(area)))).toBe(true);
    expect(sameJson(JSON.stringify(area), area)).toBe(true);
    expect(sameJson({ ...area, coordinates: [[[0, 0], [2, 0], [1, 1], [0, 0]]] }, area)).toBe(false);
    expect(sameJson(null, area)).toBe(false);
  });

  it("compares a position by its two numbers, whatever else the place holds", () => {
    expect(sameSpot({ lat: 53.8, lng: -1.55, by: "exact" }, { lat: 53.8, lng: -1.55 })).toBe(true);
    expect(sameSpot('{"lat":53.8,"lng":-1.55}', { lat: 53.8, lng: -1.55 })).toBe(true);
    expect(sameSpot({ lat: 53.8, lng: -1.56 }, { lat: 53.8, lng: -1.55 })).toBe(false);
    expect(sameSpot(null, { lat: 53.8, lng: -1.55 })).toBe(false);
  });
});

describe("a box round a territory's companies", () => {
  it("holds every position it was given, with room to spare, as a closed ring of four corners", () => {
    const spots = [
      { lat: 53.8008, lng: -1.5491 },
      { lat: 53.7676, lng: -0.3274 },
      { lat: 53.4808, lng: -2.2426 },
    ];
    const box = boxRound(spots)!;
    expect(box.type).toBe("Polygon");
    const ring = box.coordinates[0] as number[][];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    for (const spot of spots) expect(inArea(spot, box)).toBe(true);
    // Not on its edge: a company at the box's rim would fall out at the first nudge.
    expect(inArea({ lat: 53.8008 + 0.2, lng: -1.5491 }, box)).toBe(true);
    // And not the whole country.
    expect(inArea({ lat: 55.8642, lng: -4.2518 }, box)).toBe(false);
  });

  it("gives one company alone a box, and nothing for no company", () => {
    const box = boxRound([{ lat: 55.8642, lng: -4.2518 }])!;
    expect(inArea({ lat: 55.8642, lng: -4.2518 }, box)).toBe(true);
    expect(inArea({ lat: 55.9533, lng: -3.1883 }, box)).toBe(false);
    expect(boxRound([])).toBeNull();
  });
});
