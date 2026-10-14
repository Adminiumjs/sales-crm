import { describe, expect, it } from "vitest";

import { areaOf, inArea, inRing, spotOf, strangersIn, strayedFrom, type AreaGeometry } from "./geometry.ts";

/** A square round Leeds and Hull: lng -2..0, lat 53..54. */
const SQUARE: AreaGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [-2, 53],
      [0, 53],
      [0, 54],
      [-2, 54],
      [-2, 53],
    ],
  ],
};
const LEEDS = { lat: 53.8008, lng: -1.5491 };
const HULL = { lat: 53.7676, lng: -0.3274 };
const GLASGOW = { lat: 55.8642, lng: -4.2518 };
const MANCHESTER = { lat: 53.4808, lng: -2.2426 };

describe("a position inside an area", () => {
  it("is inside a square that holds it and outside one that does not", () => {
    expect(inArea(LEEDS, SQUARE)).toBe(true);
    expect(inArea(HULL, SQUARE)).toBe(true);
    expect(inArea(GLASGOW, SQUARE)).toBe(false);
    expect(inArea(MANCHESTER, SQUARE)).toBe(false);
  });

  it("counts a corner and an edge as inside", () => {
    expect(inArea({ lat: 53, lng: -2 }, SQUARE)).toBe(true);
    expect(inArea({ lat: 53.5, lng: 0 }, SQUARE)).toBe(true);
    expect(inArea({ lat: 54, lng: -1 }, SQUARE)).toBe(true);
    expect(inArea({ lat: 54.0001, lng: -1 }, SQUARE)).toBe(false);
  });

  it("reads a ring that is not closed and one drawn the other way round the same", () => {
    const open = SQUARE.coordinates[0]!.slice(0, 4);
    expect(inRing(LEEDS, open)).toBe(true);
    expect(inRing(GLASGOW, open)).toBe(false);
    const backwards = [...SQUARE.coordinates[0]!].reverse();
    expect(inRing(LEEDS, backwards)).toBe(true);
    expect(inRing(MANCHESTER, backwards)).toBe(false);
  });

  it("is outside in a hole, and inside on the hole's own edge", () => {
    const holed: AreaGeometry = {
      type: "Polygon",
      coordinates: [
        SQUARE.coordinates[0]!,
        [
          [-1.8, 53.6],
          [-1.2, 53.6],
          [-1.2, 53.9],
          [-1.8, 53.9],
          [-1.8, 53.6],
        ],
      ],
    };
    expect(inArea(LEEDS, holed)).toBe(false);
    expect(inArea(HULL, holed)).toBe(true);
    expect(inArea({ lat: 53.6, lng: -1.5 }, holed)).toBe(true);
  });

  it("is inside any piece of an area of several", () => {
    const two: AreaGeometry = {
      type: "MultiPolygon",
      coordinates: [
        SQUARE.coordinates,
        [
          [
            [-5, 55],
            [-3, 55],
            [-3, 56.5],
            [-5, 56.5],
            [-5, 55],
          ],
        ],
      ],
    };
    expect(inArea(LEEDS, two)).toBe(true);
    expect(inArea(GLASGOW, two)).toBe(true);
    expect(inArea(MANCHESTER, two)).toBe(false);
  });

  it("handles a shape that bends inwards", () => {
    // An L: the notch at the top right is outside.
    const bent: AreaGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 2],
          [2, 2],
          [2, 4],
          [0, 4],
          [0, 0],
        ],
      ],
    };
    expect(inArea({ lat: 1, lng: 3 }, bent)).toBe(true);
    expect(inArea({ lat: 3, lng: 1 }, bent)).toBe(true);
    expect(inArea({ lat: 3, lng: 3 }, bent)).toBe(false);
  });
});

describe("what a column gave back", () => {
  it("takes an area as an object or as text, and nothing else", () => {
    expect(areaOf(SQUARE)).toEqual(SQUARE);
    expect(areaOf(JSON.stringify(SQUARE))).toEqual(SQUARE);
    expect(areaOf(null)).toBeNull();
    expect(areaOf("not json")).toBeNull();
    expect(areaOf({ type: "Point", coordinates: [1, 2] })).toBeNull();
    expect(areaOf({ type: "Polygon", coordinates: [[[1, 2]]] })).toBeNull();
    expect(areaOf({ type: "Polygon", coordinates: [] })).toBeNull();
  });

  it("takes a place with two numbers, by town or exact, and never reads an empty one as zero", () => {
    expect(spotOf({ lat: 53.8, lng: -1.5, by: "town", placeId: 1 })).toEqual({ lat: 53.8, lng: -1.5, by: "town" });
    expect(spotOf({ lat: 53.8, lng: -1.5 })).toEqual({ lat: 53.8, lng: -1.5, by: "exact" });
    expect(spotOf('{"lat":1,"lng":2,"by":"exact"}')).toEqual({ lat: 1, lng: 2, by: "exact" });
    expect(spotOf(null)).toBeNull();
    expect(spotOf({ lat: null, lng: null })).toBeNull();
    expect(spotOf({ lat: "", lng: "" })).toBeNull();
    expect(spotOf({ placeId: 5 })).toBeNull();
  });
});

describe("who a reshaped area would take, and who has strayed", () => {
  const companies = [
    { id: 1, territoryId: 10, spot: LEEDS },
    { id: 2, territoryId: 20, spot: HULL },
    { id: 3, territoryId: 20, spot: GLASGOW },
    { id: 4, territoryId: null, spot: { lat: 53.2, lng: -1 } },
    { id: 5, territoryId: 20, spot: null },
    { id: 6, territoryId: 10, spot: MANCHESTER },
  ];

  it("offers the companies inside that belong elsewhere or to nobody, never one with no position and never its own", () => {
    expect(strangersIn(10, SQUARE, companies).map((one) => one.id)).toEqual([2, 4]);
    expect(strangersIn(20, SQUARE, companies).map((one) => one.id)).toEqual([1, 4]);
  });

  it("names a territory's own companies that stand outside its area", () => {
    expect(strayedFrom(10, SQUARE, companies).map((one) => one.id)).toEqual([6]);
    expect(strayedFrom(20, SQUARE, companies).map((one) => one.id)).toEqual([3]);
  });

  it("says nothing for a territory with no area", () => {
    expect(strangersIn(10, null, companies)).toEqual([]);
    expect(strayedFrom(10, null, companies)).toEqual([]);
  });
});
