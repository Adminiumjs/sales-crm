/**
 * MY VEHICLE's saves as lines of the phone's offline queue (plan 68 S19): a
 * walk-round, a fault with its photo and a fuel fill, each ONE create with a
 * retry key, sent at once with signal and kept on the phone without.
 */
import type { NewLine } from "../../offlineQueue.ts";
import type { CheckTick, FillDraft, Vehicle } from "./data.ts";
import { CHECK_TICKS } from "./data.ts";

type VehicleFacts = Pick<Vehicle, "id" | "name" | "plate">;
const facts = (vehicle: VehicleFacts) => ({ vehicle: vehicle.id, name: vehicle.name, plate: vehicle.plate ?? "" });

export const checkLine = (vehicle: VehicleFacts, day: string, ticks: Record<CheckTick, boolean>, key: string): NewLine => ({
  kind: "check",
  meta: { ...facts(vehicle), day, ticked: CHECK_TICKS.filter((tick) => ticks[tick]).length, ticks },
  op: { type: "create", table: "vehicle_checks", values: { vehicle_id: vehicle.id, day, ...ticks }, key },
});

/** A fault: its words and its photo, as the phone holds it (`phone_…`). */
export const faultLine = (vehicle: VehicleFacts, text: string, photo: string | null, key: string): NewLine => ({
  kind: "fault",
  meta: { ...facts(vehicle), text: text.trim(), photo: photo !== null },
  op: { type: "create", table: "vehicle_faults", values: { vehicle_id: vehicle.id, text: text.trim(), ...(photo === null ? {} : { photo }) }, key },
});

export const fillLine = (vehicle: VehicleFacts, draft: FillDraft, key: string): NewLine => ({
  kind: "fill",
  meta: { ...facts(vehicle), day: draft.day, litres: draft.litres, cost: draft.cost, odometer: draft.odometer },
  op: { type: "create", table: "fuel_fills", values: { vehicle_id: draft.vehicleId, day: draft.day, litres: draft.litres, cost: draft.cost, odometer: draft.odometer }, key },
});

/** The highest reading the phone knows of a vehicle: the server's, or a fill still waiting on the phone. */
export function highestReading(server: number | null, waiting: readonly { meta: Record<string, unknown> }[]): number | null {
  const kept = waiting.map((line) => Number(line.meta["odometer"])).filter((value) => Number.isFinite(value));
  if (server === null && kept.length === 0) return null;
  return Math.max(server ?? 0, ...kept);
}
