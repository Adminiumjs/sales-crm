/**
 * The customer side, from the moment the bundle runs: one page, the quote a
 * link opens. It reads the side's config (the `quote` key Adminium serves
 * beside the bundle), takes the code from the address after `#`, and hands
 * both to the page. Nobody signs in and nothing of the staff side is loaded.
 */
import { createPublicClient } from "@adminiumjs/public-client";
import { useEffect, useState } from "react";

import { I18nProvider } from "../i18n/index.tsx";
import { resolveSurfaceConfig } from "../publicConfig.ts";
import { configBase } from "../staffConnection.ts";
import { quoteLink, type QuoteDoor, type QuoteLink } from "./data.ts";
import { QuotePage } from "./QuotePage.tsx";

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

async function openLink(): Promise<QuoteLink> {
  const config = await resolveSurfaceConfig();
  const key = config?.publicKeys?.["quote"];
  const client = config === null || key === undefined ? null : createPublicClient({ baseUrl: config.baseUrl, publishableKey: key });
  return quoteLink(client as QuoteDoor | null, codeOf(window.location.hash), config?.tables ?? {}, await serverClock());
}

/**
 * The server's clock, from the `now` its config carries: how far this
 * browser's clock is from it, kept for the life of the page. With no answer
 * the browser's own clock stands in (the server still refuses a late answer).
 */
async function serverClock(): Promise<() => Date> {
  try {
    const res = await fetch(`${configBase(import.meta.env.BASE_URL, window.location.pathname)}surface-config.json`, { cache: "no-store" });
    const now = res.ok ? ((await res.json()) as { now?: unknown }).now : undefined;
    const at = typeof now === "string" ? new Date(now).getTime() : Number.NaN;
    if (Number.isFinite(at)) {
      const ahead = at - Date.now();
      return () => new Date(Date.now() + ahead);
    }
  } catch {
    // The browser's clock, below.
  }
  return () => new Date();
}

export default function CustomerApp({ open = openLink }: { open?: () => Promise<QuoteLink> }) {
  const [link, setLink] = useState<QuoteLink | null>(null);
  useEffect(() => {
    let live = true;
    const read = (): void => {
      void open().then((next) => {
        if (live) setLink(next);
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
  return <I18nProvider>{link === null ? null : <QuotePage link={link} />}</I18nProvider>;
}
