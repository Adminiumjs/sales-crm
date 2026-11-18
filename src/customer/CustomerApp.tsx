/**
 * The customer side, from the moment the bundle runs: one page, the quote a
 * link opens. It reads the side's config (the `quote` key Adminium serves
 * beside the bundle), takes the code from the address after `#`, and hands
 * both to the page. Nobody signs in and nothing of the staff side is loaded.
 *
 * BACK FROM PAYING. The pay page sends the customer back to this side's own
 * address, with nothing after it: a pay link is forwarded, and must never hand
 * over the quote. So before leaving, this tab keeps which quote it was (the
 * code the customer already holds, in this tab's own storage, gone with the
 * tab), and on the way back it opens that quote and looks for the payment.
 */
import { createPublicClient } from "@adminiumjs/public-client";
import { useEffect, useState } from "react";

import { I18nProvider } from "../i18n/index.tsx";
import { resolveSurfaceConfig } from "../publicConfig.ts";
import { configBase } from "../staffConnection.ts";
import { quoteLink, type QuoteDoor, type QuoteLink } from "./data.ts";
import { QuotePage, type Paying } from "./QuotePage.tsx";

/** Where this tab keeps the quote it went to pay for, and how long that holds. */
const PAYING_KEY = "crm-quote-paying";
const PAYING_HOLDS_MS = 3 * 3_600_000;

/** The quote this tab went to pay for, when it did so lately; null otherwise. Never throws: storage may be refused. */
export function wentToPay(storage: Pick<Storage, "getItem"> | null, now = Date.now()): string | null {
  try {
    const raw = storage?.getItem(PAYING_KEY) ?? null;
    if (raw === null) return null;
    const kept = JSON.parse(raw) as { code?: unknown; at?: unknown };
    if (typeof kept.code !== "string" || typeof kept.at !== "number" || now - kept.at > PAYING_HOLDS_MS) return null;
    return codeOf(kept.code) === "" ? null : kept.code;
  } catch {
    return null;
  }
}

function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The code a link carries: what follows `#`, and nothing that is not a code's letter. */
export function codeOf(hash: string): string {
  let raw = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Not an encoded fragment: read it as it is.
  }
  const code = raw.trim();
  return /^[A-Za-z0-9-]{4,64}$/.test(code) ? code : "";
}

/** The client's calls the page makes, payments among them: a client that lacked one would not build. */
const doorOf = (client: ReturnType<typeof createPublicClient> | null): QuoteDoor | null => client;

/** The link this page opens, and how it came to be open. */
export interface Opening {
  link: QuoteLink;
  paying: Paying;
}

async function openLink(): Promise<Opening> {
  const config = await resolveSurfaceConfig();
  const key = config?.publicKeys?.["quote"];
  const side = await sideFacts();
  /*
   * Somebody who manages payments, rehearsing on this address, writes with
   * their own sign-in: the token their writes carry comes with the side's
   * config, to them alone. Anybody else's client carries none.
   */
  const options = { baseUrl: config?.baseUrl ?? "", publishableKey: key ?? "", ...(side.csrfToken === null ? {} : { csrfToken: side.csrfToken }) } as Parameters<typeof createPublicClient>[0];
  const client = config === null || key === undefined ? null : createPublicClient(options);
  const storage = tabStorage();
  const typed = codeOf(window.location.hash);
  const kept = wentToPay(storage);
  // Back from the pay page (no code in the address), or the same quote's link opened again in this tab.
  const returning = kept !== null && (typed === "" || typed === kept);
  try {
    storage?.removeItem(PAYING_KEY);
  } catch {
    // Kept a while longer; it ends with the tab.
  }
  const code = typed !== "" ? typed : (kept ?? "");
  return {
    link: quoteLink(doorOf(client), code, config?.tables ?? {}, side.clock),
    paying: {
      returning,
      leave: (payUrl) => {
        try {
          storage?.setItem(PAYING_KEY, JSON.stringify({ code, at: Date.now() }));
        } catch {
          // Without it the customer comes back to the address the e-mail gave them, which still opens the quote.
        }
        window.location.assign(payUrl);
      },
    },
  };
}

/**
 * What the side's config says beyond the key: the server's clock, from the
 * `now` it carries (how far this browser's clock is from it, kept for the
 * life of the page; with no answer the browser's own clock stands in, and the
 * server still refuses a late answer), and a rehearsing person's write token.
 */
async function sideFacts(): Promise<{ clock: () => Date; csrfToken: string | null }> {
  try {
    const res = await fetch(`${configBase(import.meta.env.BASE_URL, window.location.pathname)}surface-config.json`, { cache: "no-store" });
    const doc = res.ok ? ((await res.json()) as { now?: unknown; rehearsal?: { csrfToken?: unknown } | null }) : {};
    const at = typeof doc.now === "string" ? new Date(doc.now).getTime() : Number.NaN;
    const token = typeof doc.rehearsal?.csrfToken === "string" && doc.rehearsal.csrfToken !== "" ? doc.rehearsal.csrfToken : null;
    if (Number.isFinite(at)) {
      const ahead = at - Date.now();
      return { clock: () => new Date(Date.now() + ahead), csrfToken: token };
    }
    return { clock: () => new Date(), csrfToken: token };
  } catch {
    // The browser's clock, and no token.
  }
  return { clock: () => new Date(), csrfToken: null };
}

export default function CustomerApp({ open = openLink }: { open?: () => Promise<Opening> }) {
  const [opening, setOpening] = useState<Opening | null>(null);
  useEffect(() => {
    let live = true;
    const read = (): void => {
      void open().then((next) => {
        if (live) setOpening(next);
      });
    };
    read();
    // Another link pasted over this one in the same tab is another quote.
    window.addEventListener("hashchange", read);
    return () => {
      live = false;
      window.removeEventListener("hashchange", read);
    };
  }, [open]);
  return <I18nProvider>{opening === null ? null : <QuotePage link={opening.link} paying={opening.paying} />}</I18nProvider>;
}
