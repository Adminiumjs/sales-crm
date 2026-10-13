import { beforeEach, describe, expect, it, vi } from "vitest";

import { KitUnavailable, kitCommon, loadKit, mountPart, resetKit } from "./kitParts.ts";

const KIT = { kit: { contract: 1, entry: "/assets/kit/kit-abc.js", styles: [] } };
const why = async (promise: Promise<unknown>): Promise<string> => promise.then(() => "resolved", (error: unknown) => (error instanceof KitUnavailable ? error.why : `other: ${String(error)}`));

describe("Adminium's own parts, asked for from an app's screen", () => {
  beforeEach(() => resetKit());

  it("loads the kit from the address the config names, once per page", async () => {
    const mounted = { update: vi.fn(), unmount: vi.fn() };
    const mount = vi.fn(async (_part: string, _element: Element, _props: unknown) => mounted);
    const importer = vi.fn(async () => ({ mount }));
    const element = {} as Element;
    expect(await mountPart(KIT, "board", element, { columns: [] }, importer)).toBe(mounted);
    await mountPart(KIT, "mentions", element, { value: "" }, importer);
    expect(importer.mock.calls).toEqual([["/assets/kit/kit-abc.js"]]);
    expect(mount.mock.calls.map((call) => call[0])).toEqual(["board", "mentions"]);
  });

  it("says why a part is not there: no kit, another contract, not in this kit yet, a file that did not load", async () => {
    expect(await why(loadKit({ kit: null }))).toBe("absent");
    expect(await why(loadKit({}))).toBe("absent");
    expect(await why(loadKit({ kit: { ...KIT.kit, contract: 2 } }))).toBe("contract");
    const notYet = async () => ({ mount: async () => Promise.reject(Object.assign(new Error("later"), { code: "KIT_PART_NOT_YET" })) });
    expect(await why(mountPart(KIT, "import", {} as Element, {}, notYet))).toBe("not-yet");
    resetKit();
    expect(await why(mountPart(KIT, "board", {} as Element, {}, async () => Promise.reject(new TypeError("Failed to fetch"))))).toBe("failed");
    resetKit();
    expect(await why(mountPart(KIT, "board", {} as Element, {}, async () => ({ nothing: true })))).toBe("failed");
  });

  it("asks again after a load that failed: a dropped connection is not remembered", async () => {
    const importer = vi.fn<(address: string) => Promise<unknown>>().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({ mount: async () => ({ update() {}, unmount() {} }) });
    expect(await why(loadKit(KIT, importer))).toBe("failed");
    await loadKit(KIT, importer);
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("hands every part the person's language and direction, as the config says them", () => {
    expect(kitCommon({ locale: "ar-EG", dir: "rtl" })).toEqual({ locale: "ar-EG", dir: "rtl" });
    expect(kitCommon({ locale: null, dir: null }, "de-DE")).toEqual({ locale: "de-DE", dir: "ltr" });
  });
});
