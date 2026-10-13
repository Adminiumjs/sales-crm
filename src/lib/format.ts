/**
 * How a figure, a day and a time are written: in the reader's language, the
 * install's currency, and the business's time zone.
 *
 * Nothing on a screen writes a currency sign, a month's name or a number by
 * hand. Money is the install's currency (the app is for any business,
 * anywhere); with none set, an amount is a plain number. A moment is shown
 * where the business is, not where the browser is: a rep abroad still reads
 * her Tuesday 16:00 call as Tuesday 16:00.
 */
export interface FormatFacts {
  /** The reader's language, as a tag: `ar-EG`. */
  locale: string;
  /** The install's currency (ISO 4217), or null when none is set. */
  currency: string | null;
  /** The business's time zone, or null for the browser's. */
  timeZone: string | null;
}

export interface Formatters {
  /** An amount: no decimals unless it has some. */
  money: (value: unknown) => string;
  number: (value: number) => string;
  /** `Tuesday, 28 July 2026`, as the reader's language writes a full date. */
  dayLong: (at: Date) => string;
  /** `Fri 24 Jul`. */
  dayShort: (at: Date) => string;
  /** `Fri`. */
  weekdayShort: (at: Date) => string;
  /** `Friday`. */
  weekdayLong: (at: Date) => string;
  /** `July`. */
  monthLong: (at: Date) => string;
  /** `16:00`, always on the 24-hour clock. */
  time: (at: Date) => string;
  /** The calendar day a moment falls on where the business is: `2026-07-28`. */
  dayKey: (at: Date) => string;
  /** Whole days from `from` to `to`, by the business's calendar: yesterday is -1. */
  dayDiff: (from: Date, to: Date) => number;
  /** The hour of the day where the business is, 0–23. */
  hour: (at: Date) => number;
  /** `12 May 2026`: a day with its year, short enough for a list. */
  date: (at: Date) => string;
  /** `38%`, from a share between 0 and 1. */
  percent: (share: number) => string;
  /**
   * What a person typed as an amount, read the way their language writes one
   * (`18,000.50` in English, `18.000,50` in German, Arabic digits too). Null
   * when it is not a number above nothing.
   */
  readAmount: (typed: string) => number | null;
  /** The moment a clock where the business is shows this day and time: `at("2026-07-30", "10:00")`. */
  at: (dayKey: string, time: string) => Date;
}

const amount = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export function formatters(facts: FormatFacts): Formatters {
  const zone = facts.timeZone === null ? {} : { timeZone: facts.timeZone };
  const make = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat => {
    try {
      return new Intl.DateTimeFormat(facts.locale, { ...options, ...zone });
    } catch {
      // A zone this browser does not know: the browser's own, rather than no date at all.
      return new Intl.DateTimeFormat(facts.locale, options);
    }
  };
  const dayLong = make({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const dayShort = make({ weekday: "short", day: "numeric", month: "short" });
  const weekdayShort = make({ weekday: "short" });
  const weekdayLong = make({ weekday: "long" });
  const monthLong = make({ month: "long" });
  const time = make({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  // Latin digits, year first: a key to compare days by, never shown.
  const key = (() => {
    try {
      return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...zone });
    } catch {
      return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
    }
  })();
  const hour = (() => {
    try {
      return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", ...zone });
    } catch {
      return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23" });
    }
  })();
  const plain = new Intl.NumberFormat(facts.locale);
  const date = make({ day: "numeric", month: "short", year: "numeric" });
  const share = new Intl.NumberFormat(facts.locale, { style: "percent", maximumFractionDigits: 0 });
  // How this language writes a number: its decimal mark, and its ten digits.
  const parts = new Intl.NumberFormat(facts.locale).formatToParts(1234567.5);
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  const digits = [...new Intl.NumberFormat(facts.locale, { useGrouping: false }).format(9876543210)].reverse();
  const readAmount = (typed: string): number | null => {
    let text = "";
    for (const letter of typed.trim()) {
      const digit = digits.indexOf(letter);
      if (digit !== -1) text += String(digit);
      else if (letter >= "0" && letter <= "9") text += letter;
      else if (letter === decimal || (letter === "." && !typed.includes(decimal))) text += ".";
      // Anything else (a grouping mark, a space, a currency sign) is how the number was dressed, not the number.
    }
    if (text === "" || text.split(".").length > 2) return null;
    const value = Math.round(Number(text) * 100) / 100;
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  // The minutes this zone is ahead of UTC at a moment (a clock change moves it).
  const wall = (() => {
    try {
      return new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...zone });
    } catch {
      return new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    }
  })();
  const ahead = (moment: Date): number => {
    const got = Object.fromEntries(wall.formatToParts(moment).map((part) => [part.type, part.value]));
    const shown = Date.UTC(Number(got["year"]), Number(got["month"]) - 1, Number(got["day"]), Number(got["hour"]), Number(got["minute"]));
    return Math.round((shown - moment.getTime()) / 60_000);
  };
  const at = (day: string, clock: string): Date => {
    const naive = Date.parse(`${day}T${clock}:00Z`);
    // Twice: the first guess may fall on the other side of a clock change.
    const first = new Date(naive - ahead(new Date(naive)) * 60_000);
    return new Date(naive - ahead(first) * 60_000);
  };
  const dayKey = (at: Date): string => key.format(at);
  const money = (value: unknown): string => {
    const v = amount(value);
    const whole = Math.round(v * 100) % 100 === 0;
    const digits = { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 };
    if (facts.currency !== null) {
      try {
        return new Intl.NumberFormat(facts.locale, { style: "currency", currency: facts.currency, ...digits }).format(v);
      } catch {
        // A code this browser does not know: the number with the code beside it.
        return `${new Intl.NumberFormat(facts.locale, digits).format(v)} ${facts.currency}`;
      }
    }
    return new Intl.NumberFormat(facts.locale, digits).format(v);
  };
  return {
    money,
    number: (value) => plain.format(value),
    dayLong: (at) => dayLong.format(at),
    dayShort: (at) => dayShort.format(at),
    weekdayShort: (at) => weekdayShort.format(at),
    weekdayLong: (at) => weekdayLong.format(at),
    monthLong: (at) => monthLong.format(at),
    time: (at) => time.format(at),
    dayKey,
    dayDiff: (from, to) => Math.round((Date.parse(`${dayKey(to)}T00:00:00Z`) - Date.parse(`${dayKey(from)}T00:00:00Z`)) / 86_400_000),
    hour: (at) => Number(hour.format(at)),
    date: (moment) => date.format(moment),
    percent: (value) => share.format(value),
    readAmount,
    at,
  };
}

/** The first and last day of the month a moment falls in, where the business is: `["2026-07-01", "2026-07-31"]`. */
export function monthOf(dayKey: string): [string, string] {
  const [year, month] = dayKey.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return [`${String(year)}-${mm}-01`, `${String(year)}-${mm}-${String(last).padStart(2, "0")}`];
}

/** The Monday that starts the week a day falls in, and the Monday after: day keys. */
export function weekOf(dayKey: string): [string, string] {
  const at = new Date(`${dayKey}T00:00:00Z`);
  const back = (at.getUTCDay() + 6) % 7;
  const monday = new Date(at.getTime() - back * 86_400_000);
  const next = new Date(monday.getTime() + 7 * 86_400_000);
  return [monday.toISOString().slice(0, 10), next.toISOString().slice(0, 10)];
}

/** A day key some days on (or back): `addDays("2026-07-27", 6)` is `2026-08-02`. */
export function addDays(dayKey: string, days: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The middle of a calendar day, as a moment: for writing a day's name or date from its key in any time zone near the business's. */
export function noonOf(dayKey: string): Date {
  return new Date(`${dayKey}T12:00:00Z`);
}
