/**
 * FINDING THINGS (P08): Jump, the keyboard shortcuts and their dialog, held
 * once above every screen.
 *
 * The frame (`shell/Shell.tsx`) mounts `<FindingProvider>` with what it
 * already knows (the person's menu, their home, the screen they are on, the
 * theme and sign-out) and draws the top bar's search box and "Jump" button,
 * which open the palette through `useFinding()`. The keys are heard here, once,
 * for the whole app (`shortcuts.ts` says which and for whom). The deal room's
 * "edit the amount" key is passed to the room as an event, since the field it
 * opens is the room's own.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useT } from "../i18n/index.tsx";
import { useDealActions } from "../selling/actions.tsx";
import { useSession } from "../session/session.tsx";
import { Icon } from "../shell/icons.tsx";
import { useNav } from "../shell/nav.tsx";
import { canOpen, USER_MENU, type MenuFacts, type RouteKey, type ShownGroup } from "../shell/routes.ts";
import { Dialog } from "../ui/dialog.tsx";
import { kindsFor, screenLines } from "./jump.ts";
import { Jump, type JumpAction } from "./Jump.tsx";
import { busyTarget, DEAL_AMOUNT_EVENT, DEAL_CLOSE_EVENT, G_WAIT_MS, roomCan, shortcutFor, shortcutGroups, type ShortcutFacts } from "./shortcuts.ts";

interface Finding {
  jump: (typed?: string) => void;
  help: () => void;
  /** Whether the person has records to search (a search box is drawn for them). */
  searches: boolean;
}

const FindingContext = createContext<Finding | null>(null);

export function useFinding(): Finding {
  const finding = useContext(FindingContext);
  if (finding === null) throw new Error("useFinding is read inside <FindingProvider>");
  return finding;
}

const isMac = (): boolean => /mac|iphone|ipad/i.test(`${navigator.platform} ${navigator.userAgent}`);

/** A deal's own room (`deals/12`): not its comments or its call notes. */
const roomOf = (path: string): string | null => /^deals\/(\d{1,15})$/.exec(path)?.[1] ?? null;

export function FindingProvider({ groups, home, current, facts, onTheme, onSignOut, children }: { groups: ShownGroup[]; home: RouteKey | null; current: RouteKey | null; facts: MenuFacts; onTheme: () => void; onSignOut: () => void; children: ReactNode }) {
  const session = useSession();
  const nav = useNav();
  const deals = useDealActions();
  const [jumping, setJumping] = useState<{ typed: string } | null>(null);
  const [helping, setHelping] = useState(false);
  const afterG = useRef<ReturnType<typeof setTimeout> | null>(null);

  const keyFacts = useMemo<ShortcutFacts>(() => {
    const menu = new Map<RouteKey, string>();
    for (const group of groups) for (const item of group.items) if (!menu.has(item.route)) menu.set(item.route, item.label);
    return {
      menu,
      home,
      canStartDeal: deals.canStart,
      canEditDeal: canOpen("deal", facts) && session.can("deals", "update"),
      canReadComments: canOpen("deal", facts) && session.can("comments", "read"),
    };
  }, [groups, home, deals.canStart, facts, session]);
  // The field crew's Jump is his own screens and nothing else, with no actions (ruling 15, as drawn).
  const crewOnly = useMemo(() => facts.roles.length > 0 && facts.roles.every((slug) => slug === "crm-crew"), [facts]);
  const screens = useMemo(() => screenLines(groups, (route) => !crewOnly && USER_MENU.includes(route) && canOpen(route, facts)), [groups, facts, crewOnly]);
  const searches = useMemo(() => kindsFor(session).length > 0, [session]);

  const jump = useCallback((typed = "") => {
    setHelping(false);
    setJumping({ typed });
  }, []);
  const help = useCallback(() => {
    setJumping(null);
    setHelping(true);
  }, []);

  const room = roomOf(nav.path);
  const actions = useMemo<JumpAction[]>(() => {
    const out: JumpAction[] = [];
    if (crewOnly) return out;
    if (deals.canStart) out.push({ id: "new-deal", label: "keys.newDeal", icon: "plus", hint: "N", run: () => deals.start() });
    if (room !== null && keyFacts.canReadComments) out.push({ id: "comments", label: "keys.dealComments", icon: "message-square", hint: "C", run: () => nav.go("deal", room, "comments") });
    if (room !== null && session.can("activities", "create") && roomCan.helps !== Number(room)) out.push({ id: "call", label: "jump.call", icon: "phone", run: () => nav.go("deal", room, "call") });
    // In a deal's room, what its own buttons do, for whoever they are drawn for (plan 68 S4).
    if (room !== null && keyFacts.canEditDeal && roomCan.amount) out.push({ id: "amount", label: "keys.dealAmount", icon: "pencil", hint: "E", run: () => window.dispatchEvent(new CustomEvent(DEAL_AMOUNT_EVENT)) });
    if (room !== null && keyFacts.canEditDeal && roomCan.close) out.push({ id: "close-deal", label: "jump.closeDeal", icon: "handshake", run: () => window.dispatchEvent(new CustomEvent(DEAL_CLOSE_EVENT)) });
    out.push({ id: "theme", label: "keys.theme", icon: "sun-moon", hint: "D", run: onTheme });
    out.push({ id: "keys", label: "keys.title", icon: "keyboard", hint: "?", run: help });
    out.push({ id: "sign-out", label: "shell.signOut", icon: "log-out", run: onSignOut });
    return out;
    // `jumping`: read again each time Jump opens, so what the room allows now is what is offered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crewOnly, deals, room, keyFacts.canReadComments, keyFacts.canEditDeal, session, nav, onTheme, help, onSignOut, jumping]);

  // The keys, once for the app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || busyTarget(event.target)) return;
      const waiting = afterG.current !== null;
      if (waiting) {
        clearTimeout(afterG.current!);
        afterG.current = null;
      }
      const what = shortcutFor(event, keyFacts, { afterG: waiting, inDeal: room !== null });
      if (what === null) return;
      event.preventDefault();
      if (what === "g") {
        afterG.current = setTimeout(() => {
          afterG.current = null;
        }, G_WAIT_MS);
        return;
      }
      switch (what.kind) {
        case "go":
          nav.go(what.route);
          break;
        case "jump":
        case "search":
          jump();
          break;
        case "help":
          help();
          break;
        case "theme":
          onTheme();
          break;
        case "dealComments":
          if (room !== null) nav.go("deal", room, "comments");
          break;
        case "dealAmount":
          window.dispatchEvent(new CustomEvent(DEAL_AMOUNT_EVENT));
          break;
        case "newDeal":
          deals.start();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (afterG.current !== null) clearTimeout(afterG.current);
    };
  }, [keyFacts, room, nav, jump, help, onTheme, deals]);

  const value = useMemo<Finding>(() => ({ jump, help, searches }), [jump, help, searches]);
  return (
    <FindingContext.Provider value={value}>
      {children}
      {jumping !== null && <Jump actions={actions} screens={screens} current={current} initial={jumping.typed} onClose={() => setJumping(null)} onOpen={(route, rest) => nav.go(route, ...rest)} />}
      {helping && <ShortcutsDialog facts={keyFacts} current={current} onClose={() => setHelping(false)} />}
    </FindingContext.Provider>
  );
}

function ShortcutsDialog({ facts: shown, current: here, onClose }: { facts: ShortcutFacts; current: RouteKey | null; onClose: () => void }) {
  const t = useT();
  const mod = isMac() ? "⌘" : t("keys.ctrl");
  const word = (key: string): string => (key === "mod" ? mod : key === "Esc" ? t("keys.esc") : key);
  return (
    <Dialog
      shape="box"
      icon="keyboard"
      tone="accent"
      name="shortcuts"
      title={t("keys.title")}
      subtitle={t("keys.subtitle")}
      onClose={onClose}
      foot={
        <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi" onClick={onClose}>
          {t("ui.close")}
        </button>
      }
    >
      <div className="crm-keys">
        {shortcutGroups(shown).map((group) => (
          <section key={group.title} className="crm-keys-group" aria-labelledby={`crm-keys-${group.title}`}>
            <h3 id={`crm-keys-${group.title}`}>
              <Icon name={group.icon} size={13} />
              {t(group.title)}
            </h3>
            <dl>
              {group.rows.map((row) => (
                <div key={row.keys.join("+") + row.label} className="crm-keys-row" data-here={row.route !== undefined && row.route === here ? "1" : "0"}>
                  <dt>{row.item === undefined ? t(row.label) : t(`nav.item.${row.item}` as Parameters<typeof t>[0])}</dt>
                  <dd>
                    {row.keys.map((key, at) =>
                      key === "then" ? (
                        <span key={at} className="crm-keys-then">
                          {t("keys.then")}
                        </span>
                      ) : (
                        <kbd key={at} className="crm-kbd">
                          {word(key)}
                        </kbd>
                      ),
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {group.note !== undefined && <p className="crm-keys-note">{t(group.note)}</p>}
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** The top bar's search box: it opens Jump with what is typed (one search, not two). */
export function SearchBox({ narrow }: { narrow: boolean }) {
  const t = useT();
  const finding = useFinding();
  if (!finding.searches) return <div className="crm-top-grow" />;
  return (
    <div className="crm-search">
      <Icon name="search" size={15} className="crm-search-glass" />
      <input
        className="crm-search-field mr-fld"
        aria-label={t("jump.search")}
        aria-haspopup="dialog"
        placeholder={t(narrow ? "jump.search.short" : "jump.search")}
        value=""
        onChange={(event) => finding.jump(event.target.value)}
        onClick={() => finding.jump()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "ArrowDown") {
            event.preventDefault();
            finding.jump();
          }
        }}
      />
      {!narrow && (
        <kbd className="crm-kbd crm-search-chip" aria-hidden="true">
          /
        </kbd>
      )}
    </div>
  );
}

/** "Jump ⌘K" at the end of the top bar. */
export function JumpButton() {
  const t = useT();
  const finding = useFinding();
  return (
    <button type="button" className="crm-jump-btn mr-gi" aria-keyshortcuts={isMac() ? "Meta+K" : "Control+K"} onClick={() => finding.jump()}>
      <Icon name="command" size={14} />
      {t("jump.button")}
      <kbd className="crm-kbd" aria-hidden="true">
        {isMac() ? "⌘K" : `${t("keys.ctrl")} K`}
      </kbd>
    </button>
  );
}

/** "Keyboard shortcuts ?" in the menu under the person's name. */
export function ShortcutsItem({ onGo }: { onGo: () => void }) {
  const t = useT();
  const finding = useFinding();
  return (
    <button
      type="button"
      role="menuitem"
      className="crm-user-item mr-row"
      onClick={() => {
        onGo();
        finding.help();
      }}
    >
      <Icon name="keyboard" size={15} />
      <span>{t("keys.title")}</span>
      <kbd className="crm-kbd" aria-hidden="true">
        ?
      </kbd>
    </button>
  );
}
