/**
 * A photo of a kind its column does not take is refused on the phone as it
 * is picked (`photoKinds.ts`): never kept, never queued. The kinds are the
 * manifest's own.
 */
import { describe, expect, it, vi } from "vitest";

import manifest from "../../../whole/manifest.json";
import { columnTakes, FILE_COLUMN_ACCEPT, judgedFetch } from "./photoKinds.ts";

interface Column {
  ref: string;
  rules?: { file?: { accept: string[] } };
}

describe("what a photo column takes", () => {
  it("lists every file column of the manifest, each with the kinds its file rule accepts", () => {
    const fromManifest: Record<string, string[]> = {};
    for (const table of manifest.requiredSchema.tables as { ref: string; columns: Column[] }[]) {
      for (const column of table.columns) if (column.rules?.file !== undefined) fromManifest[`${table.ref}.${column.ref}`] = column.rules.file.accept;
    }
    expect(Object.keys(fromManifest).sort()).toEqual(Object.keys(FILE_COLUMN_ACCEPT).sort());
    for (const [column, accept] of Object.entries(fromManifest)) expect([...FILE_COLUMN_ACCEPT[column]!].sort(), column).toEqual([...accept].sort());
  });

  it("refuses a HEIC (and any kind the column does not take) by its kind, or by its name when its kind is not said", () => {
    expect(columnTakes("sign_offs.photos", "image/jpeg", "photo.jpg")).toBe(true);
    expect(columnTakes("sign_offs.photos", "image/png", "IMG_1.PNG")).toBe(true);
    expect(columnTakes("snags.photo", "image/webp", "a.webp")).toBe(true);
    expect(columnTakes("sign_offs.photos", "image/heic", "IMG_4021.HEIC")).toBe(false);
    expect(columnTakes("snags.put_right_photo", "image/heif", "IMG_4021.HEIF")).toBe(false);
    expect(columnTakes("vehicle_faults.photo", "image/gif", "a.gif")).toBe(false);
    expect(columnTakes("snags.photo", "image/svg+xml", "a.svg")).toBe(false);
    expect(columnTakes("sign_offs.signature", "image/jpeg", "photo.jpg")).toBe(false);
    expect(columnTakes("sign_offs.signature", "image/png", "signature.png")).toBe(true);
    // The kind not said: the name's ending decides; with no ending either, the server does (it judges the bytes).
    expect(columnTakes("sign_offs.photos", "application/octet-stream", "IMG_4021.HEIC")).toBe(false);
    expect(columnTakes("sign_offs.photos", "", "IMG_4020.JPG")).toBe(true);
    expect(columnTakes("sign_offs.photos", null, "photo")).toBe(true);
    expect(columnTakes("sign_offs.photos", "IMAGE/JPEG; charset=binary", "x")).toBe(true);
    // A column this file does not know is left to the server.
    expect(columnTakes("visit_notes.photos", "image/heic", "a.heic")).toBe(true);
  });

  it("answers a refused photo as the server would, keeping nothing (the queue is never asked), and lets a taken one on", async () => {
    const next = vi.fn(async () => new Response(JSON.stringify({ data: { id: "phone_1" } }), { status: 201 }));
    const refused = vi.fn();
    const taken = vi.fn();
    const send = judgedFetch("sign_offs.photos", next, refused, taken);
    const heic = await send("/api/v1/files?connectionId=c&table=crm_sign_offs&column=photos&filename=IMG_4021.HEIC", { method: "POST", headers: { "content-type": "image/heic" }, body: new Blob(["x"], { type: "image/heic" }) });
    expect(heic.status).toBe(415);
    expect([next.mock.calls.length, refused.mock.calls.length, taken.mock.calls.length]).toEqual([0, 1, 0]);
    const jpeg = await send("/api/v1/files?connectionId=c&table=crm_sign_offs&column=photos&filename=photo.jpg", { method: "POST", headers: { "content-type": "image/jpeg" }, body: new Blob(["x"], { type: "image/jpeg" }) });
    expect(jpeg.status).toBe(201);
    expect([next.mock.calls.length, refused.mock.calls.length, taken.mock.calls.length]).toEqual([1, 1, 1]);
    // Anything else the field asks (throwing a photo away) goes straight on.
    await send("/api/v1/files/phone_1", { method: "DELETE" });
    expect([next.mock.calls.length, refused.mock.calls.length, taken.mock.calls.length]).toEqual([2, 1, 1]);
  });
});
