/**
 * SETTINGS: how the business works in this app, and which of its parts are
 * in use.
 *
 * WHO OPENS IT (the design's D2, and ruling Q6):
 *  - the CRM admin, and the person who runs the install: five tabs, all of
 *    Selling, Working time and Places theirs to write;
 *  - the sales manager: Selling only, with no tabs. She writes how the team
 *    sells; the server holds her to those columns;
 *  - Read-only: every tab, with nothing to press;
 *  - nobody else: a rep, the account manager, the marketer and the front desk
 *    are told the page is not part of their role, and the server refuses
 *    their writes whatever they type into the address bar.
 *
 * A tab has an address of its own (`settings/working-time`), so Back works
 * and a tab can be linked to.
 */
import { useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { Icon } from "../../shell/icons.tsx";
import { useNav } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { useScreen } from "../team/data.ts";
import { rightsOf } from "./parts.tsx";
import { Selling } from "./Selling.tsx";
import { Maps, Parts, Places, WorkingTime } from "./Tabs.tsx";
import { CrewsTab } from "../jobs/CrewsTab.tsx";

const TABS = [
  { id: "selling", path: "", icon: "columns-3", label: "aset.tab.selling" },
  { id: "work", path: "working-time", icon: "clock", label: "aset.tab.work" },
  { id: "places", path: "places", icon: "map-pin", label: "aset.tab.places" },
  { id: "maps", path: "maps", icon: "map", label: "aset.tab.maps" },
  { id: "parts", path: "parts", icon: "blocks", label: "aset.tab.parts" },
  // The crews, their people and days (F20): with Jobs on site or Vehicles and crew, a later stage's parts.
  { id: "crews", path: "crews", icon: "users", label: "jb.tab.crews" },
] as const satisfies readonly { id: string; path: string; icon: string; label: MessageKey }[];
type TabId = (typeof TABS)[number]["id"];

export function Settings({ rest }: ScreenProps) {
  const t = useT();
  const nav = useNav();
  const { session, f } = useScreen();
  const rights = rightsOf(session);
  const crewsOn = (session.part("jobs") || session.part("fleet")) && session.can("crews", "read");
  const tabs = TABS.filter((one) => one.id !== "crews" || crewsOn);
  const asked = tabs.find((tab) => tab.path === (rest[0] ?? ""))?.id ?? "selling";
  // The sales manager has one tab, whatever address she types; the operations manager, who keeps the crews and writes no setting, the crews'.
  const tab: TabId = rights.readsAll ? asked : !session.can("settings", "update") && crewsOn ? "crews" : "selling";
  const go = (next: (typeof TABS)[number]): void => (next.path === "" ? nav.go("appsettings") : nav.go("appsettings", next.path));
  const onKey = (event: React.KeyboardEvent, at: number): void => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const rtl = document.documentElement.dir === "rtl" && (event.key === "ArrowRight" || event.key === "ArrowLeft");
    const next = tabs[(at + (rtl ? -step : step) + tabs.length) % tabs.length]!;
    go(next);
    requestAnimationFrame(() => document.getElementById(`aset-tab-${next.id}`)?.focus());
  };

  return (
    <div className="crm-screen crm-ast mr-screen" data-screen="appsettings" data-writes={rights.all ? "all" : session.can("settings", "update") ? "selling" : "none"}>
      <div className="crm-screen-head">
        <div>
          <h1>{t("aset.title")}</h1>
          <p className="crm-screen-sub crm-ast-intro">{t(rights.all ? "aset.intro.admin" : rights.readsAll ? "aset.intro.read" : tab === "crews" ? "jb.set.intro" : "aset.intro.manager")}</p>
        </div>
      </div>
      {rights.readsAll && (
        <div role="tablist" aria-label={t("aset.title")} className="crm-ast-tabs mr-scroll">
          {tabs.map((one, at) => (
            <button key={one.id} type="button" role="tab" id={`aset-tab-${one.id}`} className="crm-ast-tab mr-btn mr-gi" aria-selected={tab === one.id} tabIndex={tab === one.id ? 0 : -1} onClick={() => go(one)} onKeyDown={(event) => onKey(event, at)}>
              <Icon name={one.icon} size={14} />
              {t(one.label)}
            </button>
          ))}
        </div>
      )}
      {tab === "selling" && <Selling session={session} f={f} rights={rights} />}
      {tab === "work" && <WorkingTime session={session} f={f} rights={rights} />}
      {tab === "places" && <Places session={session} rights={rights} />}
      {tab === "maps" && <Maps session={session} />}
      {tab === "parts" && <Parts session={session} f={f} />}
      {tab === "crews" && <CrewsTab session={session} />}
    </div>
  );
}
