/**
 * THE KEYBOARD SHORTCUTS, as the design lists them, cut to the person.
 *
 * One table says which key does what; the key handler and the shortcuts
 * dialog both read it, so the dialog never lists a key that does nothing for
 * this person, and no key works that the dialog does not list.
 *
 * A "go to" key is offered only for a screen in the person's own menu (or
 * their home): a rep has no `G T` (the Team view is not hers), the marketer
 * no `2` (she has no board). "Start a deal" only for somebody who may make
 * one. The deal room's two keys only for somebody who may change a deal or
 * read its comments.
 *
 * NO KEY FIRES while the person is typing (a field, a text box, Adminium's
 * mention box, anything editable), while a dialog or a menu is open (it has
 * the keyboard, and its own Escape), or with Alt or with Ctrl/⌘ held, except
 * Ctrl/⌘ K for Jump. That one too is left alone inside a field: it is the
 * field's own key there (on a Mac it cuts to the end of the line).
 */
import type { MessageKey } from "../i18n/messages/index.ts";
import type { RouteKey } from "../shell/routes.ts";

export type Shortcut =
  | { kind: "go"; route: RouteKey }
  | { kind: "jump" }
  | { kind: "search" }
  | { kind: "newDeal" }
  | { kind: "theme" }
  | { kind: "help" }
  | { kind: "dealAmount" }
  | { kind: "dealComments" };

/** `1`–`4`: the four screens the design puts under a single key. `home` is the person's own home. */
export const SINGLE: Readonly<Record<string, RouteKey | "home">> = { "1": "home", "2": "pipeline", "3": "companies", "4": "contacts" };
/** `G` then a letter. */
export const AFTER_G: Readonly<Record<string, RouteKey>> = { w: "week", c: "archive", i: "inbox", m: "messages", f: "feed", t: "team" };
/** Told to the deal room when its "edit the amount" key is pressed: the field it opens is the room's own. */
export const DEAL_AMOUNT_EVENT = "crm:deal-amount";
/** Told to the deal room when Jump's "Close this deal…" is pressed: it opens the board's own dialog for that deal. */
export const DEAL_CLOSE_EVENT = "crm:deal-close";
/**
 * What the open deal room lets the reader do from Jump (plan 68 S4): kept by the room as it draws, read by Jump when it
 * opens, so Jump offers "Edit the amount" and "Close this deal…" only where the room's own buttons would. `helps`: the
 * deal the reader only helps on (ruling 1d), where Jump offers no "Log a call" either.
 */
export const roomCan: { amount: boolean; close: boolean; helps: number | null } = { amount: false, close: false, helps: null };
/** How long `G` waits for its letter. */
export const G_WAIT_MS = 1500;

export interface ShortcutFacts {
  /** The screens of the person's menu, with the words each goes by there. */
  menu: ReadonlyMap<RouteKey, string>;
  home: RouteKey | null;
  canStartDeal: boolean;
  /** May change a deal (the amount) / read a deal's comments: the deal room's two keys. */
  canEditDeal: boolean;
  canReadComments: boolean;
}

export interface Row {
  /** The words, a message key; `item` carries the menu's own label for a screen. */
  label: MessageKey;
  item?: string;
  /** What to press, in order; `then` between two keys pressed one after the other. `mod` is ⌘ on a Mac, Ctrl elsewhere. */
  keys: readonly string[];
  /** The screen it goes to, to light the row of the screen the person is on. */
  route?: RouteKey;
}

export interface Group {
  title: MessageKey;
  icon: string;
  rows: Row[];
  note?: MessageKey;
}

/** The dialog's three groups for this person: only what works for them. */
export function shortcutGroups(facts: ShortcutFacts): Group[] {
  const move: Row[] = [];
  for (const [key, target] of Object.entries(SINGLE)) {
    const route = target === "home" ? facts.home : target;
    if (route === null || !facts.menu.has(route)) continue;
    move.push({ label: "keys.go", item: facts.menu.get(route)!, keys: [key], route });
  }
  for (const [letter, route] of Object.entries(AFTER_G)) {
    if (!facts.menu.has(route) || move.some((row) => row.route === route)) continue;
    move.push({ label: "keys.go", item: facts.menu.get(route)!, keys: ["G", "then", letter.toUpperCase()], route });
  }
  const act: Row[] = [
    { label: "keys.jump", keys: ["mod", "K"] },
    { label: "keys.search", keys: ["/"] },
    ...(facts.canStartDeal ? [{ label: "keys.newDeal" as const, keys: ["N"] }] : []),
    { label: "keys.theme", keys: ["D"] },
    { label: "keys.help", keys: ["?"] },
    { label: "keys.close", keys: ["Esc"] },
  ];
  const deal: Row[] = [...(facts.canEditDeal ? [{ label: "keys.dealAmount" as const, keys: ["E"] }] : []), ...(facts.canReadComments ? [{ label: "keys.dealComments" as const, keys: ["C"] }] : [])];
  const groups: Group[] = [];
  if (move.length > 0) groups.push({ title: "keys.group.move", icon: "compass", rows: move });
  groups.push({ title: "keys.group.do", icon: "zap", rows: act });
  if (deal.length > 0) groups.push({ title: "keys.group.deal", icon: "panel-right-open", rows: deal, note: "keys.group.deal.note" });
  return groups;
}

/** The parts of a key press the table reads. */
export interface Press {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
}

/**
 * What a press does for this person, given the key pressed just before it
 * (`G`, waiting for its letter) and whether they are in a deal's room. Null:
 * nothing (and the press is left to the page).
 */
export function shortcutFor(press: Press, facts: ShortcutFacts, was: { afterG: boolean; inDeal: boolean }): Shortcut | "g" | null {
  const key = press.key.length === 1 ? press.key.toLowerCase() : press.key;
  if ((press.metaKey || press.ctrlKey) && !press.altKey && key === "k") return { kind: "jump" };
  if (press.metaKey || press.ctrlKey || press.altKey) return null;
  if (was.afterG) {
    const route = AFTER_G[key];
    return route !== undefined && facts.menu.has(route) ? { kind: "go", route } : null;
  }
  if (press.key === "?") return { kind: "help" };
  if (press.key === "/") return { kind: "search" };
  if (key === "g") return Object.values(AFTER_G).some((route) => facts.menu.has(route)) ? "g" : null;
  const single = SINGLE[key];
  if (single !== undefined) {
    const route = single === "home" ? facts.home : single;
    return route !== null && facts.menu.has(route) ? { kind: "go", route } : null;
  }
  if (key === "d") return { kind: "theme" };
  // `N` is the deal sheet's own (`selling/actions.tsx`): listed here, pressed there.
  if (was.inDeal && key === "e" && facts.canEditDeal) return { kind: "dealAmount" };
  if (was.inDeal && key === "c" && facts.canReadComments) return { kind: "dealComments" };
  return null;
}

/** Whether a press lands where a shortcut must not fire: a field being typed in, or a dialog or menu that has the keyboard. */
export function busyTarget(target: EventTarget | null, doc: Pick<Document, "querySelector"> | null = typeof document === "undefined" ? null : document): boolean {
  if (typeof HTMLElement !== "undefined" && target instanceof HTMLElement) {
    if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
    // Adminium's mention box and any other combobox or textbox, however it is drawn.
    const role = target.getAttribute("role");
    if (role === "textbox" || role === "combobox" || role === "searchbox") return true;
  }
  return doc !== null && doc.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null;
}
