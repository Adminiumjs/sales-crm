/**
 * The crews' vehicles for their days as the sample has them (plan 68 S14, M3 BN-18): Blue crew on its own vehicle on
 * Tue 4, Wed 5 and Thu 6 August, Red crew on the hired one on Wed 5 August. A spec that books or moves a visit makes
 * and takes away rows as the screens do; this puts the sample's back, and nothing else, afterwards. A stand of a
 * stage without Vehicles and crew has no such rows: nothing is done.
 */
import { expect, type APIRequestContext } from "@playwright/test";

import { csrf, rows, type Data } from "./helpers.ts";

export const SAMPLE_VAN_DAYS: readonly { crew_id: number; day: string; vehicle_id: number }[] = [
  { crew_id: 1, day: "2026-08-04", vehicle_id: 1 },
  { crew_id: 1, day: "2026-08-05", vehicle_id: 1 },
  { crew_id: 2, day: "2026-08-05", vehicle_id: 3 },
  { crew_id: 1, day: "2026-08-06", vehicle_id: 1 },
];

/** Whether the stand holds the crews' vehicles for their days at all. */
export function hasVanDays(data: Data): boolean {
  try {
    data("van_days");
    return true;
  } catch {
    return false;
  }
}

export async function restoreVanDays(person: APIRequestContext, data: Data): Promise<void> {
  if (!hasVanDays(data)) return;
  const headers = await csrf(person);
  const now = await rows<{ id: number; crew_id: number; day: string; vehicle_id: number }>(person, data, "van_days");
  const key = (row: { crew_id: number; day: string; vehicle_id: number }): string => `${String(row.crew_id)}|${String(row.day).slice(0, 10)}|${String(row.vehicle_id)}`;
  const wanted = new Set(SAMPLE_VAN_DAYS.map(key));
  for (const row of now) if (!wanted.has(key(row))) expect((await person.delete(data("van_days", `/${String(row.id)}?confirm=true`), { headers })).status()).toBeLessThan(300);
  const have = new Set(now.map(key));
  for (const row of SAMPLE_VAN_DAYS) {
    if (have.has(key(row))) continue;
    const made = await person.post(data("van_days"), { data: { values: row }, headers });
    expect(made.status(), await made.text()).toBe(201);
  }
}
