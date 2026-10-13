/**
 * ADMINIUM'S OWN LARGER PARTS on an app's screen: the board, the map, the
 * import, the text box that mentions people.
 *
 * They are too large to write again in every app and should behave the same
 * everywhere, so Adminium serves them itself and a screen asks for one: "draw
 * it in this element". The part is drawn by Adminium's own React; the app's
 * never meets it. The staff config says where the kit is (`kit.entry`, a file
 * whose name changes with every version of Adminium, so it is read each time
 * the page loads and never kept).
 *
 * This file is the asking, with no framework in it: load the kit once, mount
 * a part, change its props, take it away. A React app wraps it in an effect.
 *
 * A PART MAY NOT BE THERE, and that is an answer, not a fault:
 *  - `absent`: this Adminium has no kit (it is older, or runs with no dashboard);
 *  - `contract`: its kit speaks another contract than this file was written for;
 *  - `not-yet`: the kit is there and this part is not in it yet;
 *  - `failed`: the kit's file did not load (the connection, most likely).
 * A screen says so in the part's place and stays usable around it.
 */

import type { StaffConfig } from "./staffConnection.ts";

/** The contract this file was written for. */
export const KIT_CONTRACT = 1;

export type KitPartName = "mentions" | "board" | "map" | "import";

export interface KitMounted<Props> {
  /** Changes the props named; the others stay as they were. */
  update(props: Partial<Props>): void;
  unmount(): void;
}

/** The kit's entry, as much of it as a screen calls. */
export interface Kit {
  mount<Props>(part: KitPartName, element: Element, props: Props): Promise<KitMounted<Props>>;
}

export type KitMissing = "absent" | "contract" | "not-yet" | "failed";

export class KitUnavailable extends Error {
  readonly why: KitMissing;
  constructor(why: KitMissing, cause?: unknown) {
    super(`The kit part cannot be drawn here (${why}).`);
    this.name = "KitUnavailable";
    this.why = why;
    this.cause = cause;
  }
}

/** What every part takes from the config: the person's language, its direction. */
export function kitCommon(config: Pick<StaffConfig, "locale" | "dir">, fallbackLocale = "en-US"): { locale: string; dir: "ltr" | "rtl" } {
  return { locale: config.locale ?? fallbackLocale, dir: config.dir ?? "ltr" };
}

type Importer = (address: string) => Promise<unknown>;
const byAddress: Importer = (address) => import(/* @vite-ignore */ address);

const loaded = new Map<string, Promise<Kit>>();

/**
 * The kit this Adminium serves, loaded once per page. Throws `KitUnavailable`
 * with the reason. A load that failed is tried again the next time it is
 * asked for: a dropped connection is not remembered.
 */
export function loadKit(config: Pick<StaffConfig, "kit">, importer: Importer = byAddress): Promise<Kit> {
  const kit = config.kit ?? null;
  if (kit === null) return Promise.reject(new KitUnavailable("absent"));
  if (kit.contract !== KIT_CONTRACT) return Promise.reject(new KitUnavailable("contract"));
  const kept = loaded.get(kit.entry);
  if (kept !== undefined) return kept;
  const asked = importer(kit.entry).then(
    (module) => {
      const mount = (module as { mount?: unknown } | null)?.mount;
      if (typeof mount !== "function") throw new KitUnavailable("failed");
      return module as Kit;
    },
    (cause: unknown) => {
      throw new KitUnavailable("failed", cause);
    },
  );
  loaded.set(kit.entry, asked);
  asked.catch(() => loaded.delete(kit.entry));
  return asked;
}

/** Draw a part in an element. Throws `KitUnavailable` when it cannot be: the caller says so in its place. */
export async function mountPart<Props>(config: Pick<StaffConfig, "kit">, part: KitPartName, element: Element, props: Props, importer: Importer = byAddress): Promise<KitMounted<Props>> {
  const kit = await loadKit(config, importer);
  try {
    return await kit.mount<Props>(part, element, props);
  } catch (cause) {
    const code = (cause as { code?: unknown } | null)?.code;
    throw new KitUnavailable(code === "KIT_PART_NOT_YET" || code === "KIT_PART_UNKNOWN" ? "not-yet" : "failed", cause);
  }
}

/** Forget what was loaded. For tests. */
export function resetKit(): void {
  loaded.clear();
}
