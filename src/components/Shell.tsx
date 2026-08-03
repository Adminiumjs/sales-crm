/**
 * The internal-tool chrome: a compact sidebar, a topbar with global search and
 * a user chip, and — under 900px — a hamburger plus a slide-in nav sheet.
 *
 * This is one shell for both personas; only the nav SET changes, because a
 * manager and a rep work in the same tool. The mobile sheet renders the same
 * nav list rather than a second copy of it.
 */

import { useMemo, useState } from "react";
import {
  Building2,
  CalendarCheck,
  Columns3,
  Contact,
  Menu,
  Search,
  Users,
  X,
} from "lucide-react";

import { COMPANIES, CONTACTS } from "../data/demo.ts";
import type { View } from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { label, money } from "../lib/format.ts";
import { currentUser, useStore } from "../state/store.ts";
import { Avatar } from "./Primitives.tsx";

interface NavEntry {
  view: View;
  labelKey: "chrome.nav.today" | "chrome.nav.board" | "chrome.nav.companies" | "chrome.nav.contacts" | "chrome.nav.manager";
  icon: typeof Columns3;
  badge?: number;
}

function useNav(): NavEntry[] {
  const persona = useStore((s) => s.persona);
  const followUps = useStore((s) => s.followUps);
  const done = useStore((s) => s.doneFollowUps);

  return useMemo(() => {
    const overdue = followUps.filter(
      (f) => !done.includes(f.id) && new Date(f.due.replace(" ", "T")) < new Date("2026-07-28T09:35"),
    ).length;

    const rep: NavEntry[] = [
      { view: "today", labelKey: "chrome.nav.today", icon: CalendarCheck, badge: overdue || undefined },
      { view: "board", labelKey: "chrome.nav.board", icon: Columns3 },
      { view: "companies", labelKey: "chrome.nav.companies", icon: Building2 },
      { view: "contacts", labelKey: "chrome.nav.contacts", icon: Contact },
    ];

    if (persona === "manager") {
      return [
        { view: "manager", labelKey: "chrome.nav.manager", icon: Users },
        { view: "board", labelKey: "chrome.nav.board", icon: Columns3 },
        { view: "companies", labelKey: "chrome.nav.companies", icon: Building2 },
        { view: "contacts", labelKey: "chrome.nav.contacts", icon: Contact },
      ];
    }
    return rep;
  }, [persona, followUps, done]);
}

function NavList({ onPick }: { onPick?: () => void }) {
  const { t } = useI18n();
  const view = useStore((s) => s.view);
  const go = useStore((s) => s.go);
  const nav = useNav();

  return (
    <nav className="mr-sidebar__nav" aria-label={t("chrome.brand.sub")}>
      {nav.map((entry) => {
        const Icon = entry.icon;
        const current = view === entry.view;
        return (
          <button
            key={entry.view}
            type="button"
            className="mr-navitem"
            aria-current={current ? "page" : undefined}
            onClick={() => {
              go(entry.view);
              onPick?.();
            }}
          >
            <Icon size={16} aria-hidden="true" />
            {t(entry.labelKey)}
            {entry.badge !== undefined && (
              <span className="mr-navitem__badge mr-mono">{entry.badge}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

function Brand() {
  const { t } = useI18n();
  return (
    <div className="mr-sidebar__brand">
      <span className="mr-sidebar__mark" aria-hidden="true">
        <Columns3 size={18} />
      </span>
      <span>
        <span className="mr-sidebar__name">{t("chrome.brand")}</span>
        <span className="mr-sidebar__sub" style={{ display: "block" }}>
          {t("chrome.brand.sub")}
        </span>
      </span>
    </div>
  );
}

function Footer() {
  const { t } = useI18n();
  return (
    <div className="mr-sidebar__foot">
      {t("chrome.footer.copy")}
      <span className="mr-sidebar__chip mr-mono">{t("chrome.footer.chip")}</span>
    </div>
  );
}

/**
 * Global search across the three things a rep looks for by name. It is a
 * filter over what is already in memory rather than a query — there is no
 * server in a demo — and it closes on pick so the reader lands on the record.
 */
function GlobalSearch() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const deals = useStore((s) => s.deals);
  const openDeal = useStore((s) => s.openDeal);
  const openCompany = useStore((s) => s.openCompany);
  const go = useStore((s) => s.go);

  const q = query.trim().toLowerCase();
  const hits = useMemo(() => {
    if (q.length < 2) return null;
    return {
      deals: deals.filter((d) => label(d.name).toLowerCase().includes(q)).slice(0, 5),
      companies: COMPANIES.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 4),
      contacts: CONTACTS.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 4),
    };
  }, [q, deals]);

  const empty =
    hits !== null &&
    hits.deals.length === 0 &&
    hits.companies.length === 0 &&
    hits.contacts.length === 0;

  return (
    <div className="mr-topbar__search">
      <Search size={15} aria-hidden="true" />
      <input
        className="mr-topbar__input mr-fld"
        type="search"
        value={query}
        placeholder={t("chrome.search.placeholder")}
        aria-label={t("chrome.search.label")}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
      />

      {open && hits !== null && (
        <div className="mr-searchpop mr-scroll">
          {empty && <p className="mr-searchpop__empty">{t("chrome.search.empty", { query })}</p>}

          {hits.deals.length > 0 && (
            <>
              <div className="mr-searchpop__group">{t("chrome.search.deals")}</div>
              {hits.deals.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="mr-searchpop__row"
                  onMouseDown={() => {
                    openDeal(d.id);
                    setQuery("");
                  }}
                >
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {label(d.name)}
                  </span>
                  <span className="mr-searchpop__meta mr-mono">{money(d.amount)}</span>
                </button>
              ))}
            </>
          )}

          {hits.companies.length > 0 && (
            <>
              <div className="mr-searchpop__group">{t("chrome.search.companies")}</div>
              {hits.companies.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="mr-searchpop__row"
                  onMouseDown={() => {
                    openCompany(c.id);
                    setQuery("");
                  }}
                >
                  <Avatar name={c.name} tint={c.tint} ini={c.ini} />
                  {c.name}
                  <span className="mr-searchpop__meta">{c.city}</span>
                </button>
              ))}
            </>
          )}

          {hits.contacts.length > 0 && (
            <>
              <div className="mr-searchpop__group">{t("chrome.search.contacts")}</div>
              {hits.contacts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="mr-searchpop__row"
                  onMouseDown={() => {
                    go("contacts");
                    setQuery("");
                  }}
                >
                  <Avatar name={p.name} tint="#7c3aed" ini={p.ini} />
                  {p.name}
                  <span className="mr-searchpop__meta">{label(p.role)}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const persona = useStore((s) => s.persona);
  const navOpen = useStore((s) => s.navOpen);
  const setNavOpen = useStore((s) => s.setNavOpen);
  const me = currentUser(persona);

  return (
    <div className="mr-app">
      <aside className="mr-sidebar">
        <Brand />
        <NavList />
        <Footer />
      </aside>

      {navOpen && (
        <>
          <button
            type="button"
            className="mr-scrim"
            aria-label={t("chrome.menu.close")}
            onClick={() => setNavOpen(false)}
          />
          <div className="mr-sheet" role="dialog" aria-modal="true" aria-label={t("chrome.brand")}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <Brand />
              <button
                type="button"
                className="mr-iconbtn mr-btn"
                style={{ marginInlineStart: "auto", marginInlineEnd: 12 }}
                onClick={() => setNavOpen(false)}
                aria-label={t("chrome.menu.close")}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <NavList onPick={() => setNavOpen(false)} />
            <Footer />
          </div>
        </>
      )}

      <div className="mr-main">
        <header className="mr-topbar">
          <button
            type="button"
            className="mr-iconbtn mr-btn mr-narrow-only"
            onClick={() => setNavOpen(true)}
            aria-label={t("chrome.menu.open")}
          >
            <Menu size={18} aria-hidden="true" />
          </button>

          <GlobalSearch />
          <div className="mr-topbar__spacer" />

          <span className="mr-userchip">
            <Avatar name={me.name} tint={me.tint} ini={me.ini} />
            <span className="mr-wide-only">{me.name}</span>
          </span>
        </header>

        <main className="mr-content" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}
