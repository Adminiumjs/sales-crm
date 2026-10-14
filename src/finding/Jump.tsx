/**
 * JUMP, the palette: one box over the page, opened by Ctrl/⌘ K or `/`, by the
 * top bar's search box and by its "Jump" button.
 *
 * It lists what the person can do from here, the screens of their own menu,
 * and, once two letters are typed, the deals, companies, people and quotes
 * the server answers THEM by that name (`jump.ts`). Each line opens the
 * app's own screen for it.
 *
 * THE KEYBOARD. The box keeps the focus in its field: ↑ and ↓ pick a line
 * (the field names the picked one to a screen reader through
 * `aria-activedescendant`), Enter opens it, Escape closes, and Tab stays in
 * the box. Closing gives the focus back to whatever opened it. How many lines
 * there are is said in a polite live line at the foot, and again when the
 * records arrive.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../i18n/index.tsx";
import type { MessageKey } from "../i18n/messages/index.ts";
import { formatters } from "../lib/format.ts";
import { useSession } from "../session/session.tsx";
import { Icon } from "../shell/icons.tsx";
import { ROUTES, type RouteKey } from "../shell/routes.ts";
import { findRecords, fold, kindsFor, matchScreens, MIN_LETTERS, roundDelay, type RecordKind, type RecordLine, type ScreenLine } from "./jump.ts";

export interface JumpAction {
  id: string;
  label: MessageKey;
  icon: string;
  /** A key shown at the line's end ("N", "D", "?"). */
  hint?: string;
  run: () => void;
}

type Line = { key: string; kind: "action"; action: JumpAction } | { key: string; kind: "screen"; screen: ScreenLine } | { key: string; kind: RecordKind; record: RecordLine };

const RECORD_ICON: Record<RecordKind, string> = { deal: "handshake", company: "building-2", contact: "user-round", quote: "file-text" };
const RECORD_GROUP: Record<RecordKind, MessageKey> = { deal: "jump.group.deals", company: "jump.group.companies", contact: "jump.group.people", quote: "jump.group.quotes" };

/** Records found by what is typed, asked as `jump.ts` says: after a pause, a round at most every so often, a word once. */
function useRecords(typed: string): { lines: RecordLine[]; looking: boolean } {
  const session = useSession();
  const t = useT();
  const kinds = useMemo(() => kindsFor(session), [session]);
  const known = useRef(new Map<string, RecordLine[]>());
  const last = useRef<number | null>(null);
  const [answer, setAnswer] = useState<{ word: string; lines: RecordLine[] }>({ word: "", lines: [] });
  const word = fold(typed);
  const wanted = kinds.length > 0 && word.length >= MIN_LETTERS;
  useEffect(() => {
    if (!wanted) return;
    const kept = known.current.get(word);
    if (kept !== undefined) {
      setAnswer({ word, lines: kept });
      return;
    }
    let gone = false;
    const timer = setTimeout(
      () => {
        last.current = Date.now();
        void findRecords(session, typed, { version: (n) => t("jump.version", { n }) }).then((lines) => {
          known.current.set(word, lines);
          // Typed on meanwhile: this answer is for a word no longer in the box.
          if (!gone) setAnswer({ word, lines });
        });
      },
      roundDelay(last.current, Date.now()),
    );
    return () => {
      gone = true;
      clearTimeout(timer);
    };
    // `typed` is read once the pause is over; the word it folds to is what is asked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word, wanted, session, t]);
  if (!wanted) return { lines: [], looking: false };
  return answer.word === word ? { lines: answer.lines, looking: false } : { lines: [], looking: true };
}

export function Jump({ actions, screens, current, onClose, onOpen, initial = "" }: { actions: JumpAction[]; screens: ScreenLine[]; current: RouteKey | null; onClose: () => void; onOpen: (route: RouteKey, rest: (string | number)[]) => void; initial?: string }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState(initial);
  const [picked, setPicked] = useState(0);
  const records = useRecords(typed);
  const close = useRef(onClose);
  close.current = onClose;

  // The focus goes into the field, and back to whatever opened the box when it closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    field.current?.focus();
    const scroll = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = scroll;
      opener?.focus();
    };
  }, []);

  const q = fold(typed);
  const groups = useMemo(() => {
    const out: { title: MessageKey; lines: Line[] }[] = [];
    const acts = actions.filter((action) => q === "" || fold(t(action.label)).includes(q));
    if (acts.length > 0) out.push({ title: "jump.group.actions", lines: acts.map((action) => ({ key: `a-${action.id}`, kind: "action", action })) });
    const found = matchScreens(screens, typed, (line) => t(line.label));
    if (found.length > 0) out.push({ title: "jump.group.screens", lines: found.map((screen) => ({ key: `s-${screen.route}`, kind: "screen", screen })) });
    for (const kind of ["deal", "company", "contact", "quote"] as const) {
      const lines = records.lines.filter((line) => line.kind === kind);
      if (lines.length > 0) out.push({ title: RECORD_GROUP[kind], lines: lines.map((record) => ({ key: `${kind}-${String(record.id)}`, kind, record })) });
    }
    return out;
  }, [actions, screens, records.lines, typed, q, t]);
  const flat = groups.flatMap((group) => group.lines);
  const at = flat.length === 0 ? -1 : Math.min(picked, flat.length - 1);
  useEffect(() => setPicked(0), [q]);

  // The picked line stays in view as the arrows move it.
  useEffect(() => {
    if (at < 0) return;
    box.current?.querySelector(`[data-index="${String(at)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const run = useCallback(
    (line: Line) => {
      close.current();
      if (line.kind === "action") line.action.run();
      else if (line.kind === "screen") onOpen(line.screen.route, []);
      else onOpen(line.record.route, [line.record.id]);
    },
    [onOpen],
  );

  const onKey = (event: React.KeyboardEvent): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (flat.length === 0) return;
      setPicked((was) => (Math.min(was, flat.length - 1) + (event.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (at >= 0) run(flat[at]!);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close.current();
    } else if (event.key === "Tab") {
      // The box has one stop: its field. The lines are picked with the arrows.
      event.preventDefault();
    }
  };

  const optionId = (index: number): string => `${id}-o${String(index)}`;
  const count = flat.length;
  let index = -1;
  return (
    <div className="crm-jump-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={box} className="crm-jump" role="dialog" aria-modal="true" aria-label={t("jump.title")} data-dialog="jump">
        <div className="crm-jump-head">
          <Icon name="search" size={17} className="crm-jump-glass" />
          <input
            ref={field}
            className="crm-jump-field"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={at >= 0 ? optionId(at) : undefined}
            aria-label={t("jump.field")}
            placeholder={t("jump.placeholder")}
            value={typed}
            maxLength={120}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={onKey}
          />
          <kbd className="crm-kbd crm-jump-esc">{t("keys.esc")}</kbd>
        </div>
        <div className="crm-jump-list mr-scroll" id={`${id}-list`} role="listbox" aria-label={t("jump.title")}>
          {groups.map((group) => (
            <div key={group.title} role="group" aria-labelledby={`${id}-${group.title}`}>
              <div className="crm-jump-group" id={`${id}-${group.title}`} role="presentation">
                {t(group.title)}
              </div>
              {group.lines.map((line) => {
                index += 1;
                const mine = index;
                const on = mine === at;
                const words = lineWords(line);
                return (
                  <div
                    key={line.key}
                    id={optionId(mine)}
                    role="option"
                    aria-selected={on}
                    data-index={mine}
                    data-kind={line.kind}
                    className="crm-jump-line"
                    data-on={on ? "1" : "0"}
                    onMouseMove={() => mine !== at && setPicked(mine)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => run(line)}
                  >
                    <span className="crm-jump-tile" data-tone={line.kind === "screen" || line.kind === "contact" ? "plain" : "accent"} aria-hidden="true">
                      <Icon name={words.icon} size={15} />
                    </span>
                    <span className="crm-jump-words">
                      <span className="crm-jump-title">{words.title}</span>
                      {words.sub !== null && <span className="crm-jump-sub">{words.sub}</span>}
                    </span>
                    {words.right !== null && (
                      <span className="crm-jump-right" data-mono={words.mono ? "1" : "0"}>
                        {words.right}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {count === 0 && !records.looking && (
            <div className="crm-jump-empty" data-testid="jump-empty">
              <Icon name="search-x" size={20} />
              <strong>{t("jump.none")}</strong>
              <span>{t(kindsFor(session).length > 0 ? "jump.none.body" : "jump.none.screens")}</span>
            </div>
          )}
        </div>
        <div className="crm-jump-foot">
          <span className="crm-jump-hint">
            <kbd className="crm-kbd">↑</kbd>
            <kbd className="crm-kbd">↓</kbd>
            {t("jump.move")}
          </span>
          <span className="crm-jump-hint">
            <kbd className="crm-kbd">↵</kbd>
            {t("jump.open")}
          </span>
          <span className="crm-jump-count crm-mono" role="status" aria-live="polite" data-testid="jump-count">
            {records.looking ? t("jump.looking") : count === 0 ? "" : t("jump.count", undefined, count)}
          </span>
        </div>
      </div>
    </div>
  );

  function lineWords(line: Line): { icon: string; title: string; sub: string | null; right: string | null; mono: boolean } {
    if (line.kind === "action") return { icon: line.action.icon, title: t(line.action.label), sub: null, right: line.action.hint ?? null, mono: false };
    if (line.kind === "screen") return { icon: ROUTES[line.screen.route].icon, title: t(line.screen.label), sub: null, right: line.screen.route === current ? t("jump.here") : null, mono: false };
    const record = line.record;
    const closed = record.kind === "deal" && record.state !== null && record.state !== "open" ? t(record.state === "won" ? "jump.deal.won" : "jump.deal.lost") : null;
    const sub = [record.sub, closed].filter((part) => part !== null && part !== "").join(" · ");
    return { icon: RECORD_ICON[record.kind], title: record.title, sub: sub === "" ? null : sub, right: record.amount === null ? null : f.money(record.amount), mono: true };
  }
}
