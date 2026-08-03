/**
 * Presentation helpers.
 *
 * Everything here reads the ambient locale (`i18n/ambient.ts`) rather than a
 * hook, so the store and the pure engine can format without being inside the
 * React tree. Callers that ARE in the tree get the same output, because the
 * provider pushes its own `t` / `money` / `number` into the ambient module on
 * every render.
 *
 * Nothing in this file reads the real clock — `now` is always passed in.
 */

import { locale, money as ambientMoney, number as ambientNumber, t, tOr } from "../i18n/ambient.ts";
import type { MessageKey } from "../i18n/messages/index.ts";
import { dayDiff, parseAt } from "./pipeline.ts";

/** Resolve a seed field that stores an i18n key. */
export function label(key: string): string {
  return tOr(key, key);
}

/** Amounts are always whole dollars in this app — cents would be noise. */
export function money(value: number): string {
  return ambientMoney(Math.round(value));
}

/**
 * A compact amount for column headers and KPI chips, where the full figure
 * would wrap. Values under 1,000 are shown in full.
 */
export function moneyShort(value: number): string {
  const v = Math.round(value);
  if (Math.abs(v) < 1000) return ambientMoney(v);
  const thousands = v / 1000;
  const digits = Math.abs(thousands) < 10 ? 1 : 0;
  return t("chrome.money.thousands", {
    value: ambientNumber(thousands, {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }),
  });
}

export function number(value: number, opts?: Intl.NumberFormatOptions): string {
  return ambientNumber(value, opts);
}

/** Odds render as a whole percentage — "50%", never "0.5". */
export function percent(fraction: number, digits = 0): string {
  return ambientNumber(fraction, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/* --------------------------------------------------------------------- dates */

function fmt(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale(), opts).format(d);
}

/** "28 Jul" — the short form used on chips and card footers. */
export function dateShort(d: Date): string {
  return fmt(d, { day: "numeric", month: "short" });
}

/** "28 July 2026" — the long form used in headers and fact rails. */
export function dateLong(d: Date): string {
  return fmt(d, { day: "numeric", month: "long", year: "numeric" });
}

/** "Jul 2026" — forecast column headings. */
export function monthShort(d: Date): string {
  return fmt(d, { month: "short", year: "numeric" });
}

/** 24-hour clock, zero-padded, so times line up in the mono column. */
export function time(d: Date): string {
  return fmt(d, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "Tuesday, 28 July 2026 · 09:35" — the Today greeting's date line. */
export function nowLabel(now: Date): string {
  return t("chrome.now.label", {
    date: fmt(now, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    time: time(now),
  });
}

/**
 * A relative date for timelines: today and yesterday get their own words, the
 * rest of the week counts back in days, and anything older falls back to a
 * plain short date. Future dates count forward.
 */
export function relative(d: Date, now: Date): string {
  const diff = dayDiff(now, d);
  if (diff === 0) return t("chrome.rel.today", { time: time(d) });
  if (diff === 1) return t("chrome.rel.yesterday", { time: time(d) });
  if (diff > 1 && diff < 7) return t("chrome.rel.daysAgo", { count: diff }, diff);
  if (diff < 0) return t("chrome.rel.inDays", { count: -diff }, -diff);
  return dateShort(d);
}

/** Parse a seed timestamp and render it relatively in one step. */
export function relativeAt(at: string, now: Date): string {
  return relative(parseAt(at), now);
}

/** "4 days in stage" / "1 day in stage". */
export function daysInStageLabel(days: number): string {
  return t("chrome.stage.days", { count: days }, days);
}

/** Two-letter initials for an avatar tile, from a display name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* --------------------------------------------------------------------- tints */

function toRgb(hex: string): [number, number, number] {
  let h = (hex || "#4f46e5").replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Pull a hex toward white — how a seed tint stays legible on a dark surface. */
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = toRgb(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/**
 * The layered gradient every avatar and logo tile uses in place of photography:
 * a highlight sweep, a corner glow, and the seed tint underneath.
 */
export function tileBackground(hex: string, dark: boolean, angle = "150deg"): string {
  const highlight = dark
    ? "radial-gradient(120% 84% at 50% 0%, rgba(255,255,255,.07), transparent 56%)"
    : "radial-gradient(120% 84% at 50% 0%, rgba(255,255,255,.6), transparent 58%)";
  const glow = `radial-gradient(58% 46% at 72% 88%, ${rgba(hex, dark ? 0.3 : 0.2)}, transparent 72%)`;
  const base = `linear-gradient(${angle}, ${rgba(hex, dark ? 0.34 : 0.22)}, ${rgba(hex, dark ? 0.12 : 0.07)})`;
  return `${highlight}, ${glow}, ${base}`;
}

/** Re-export so screens can pull one translation helper from one place. */
export { t };
export type { MessageKey };
