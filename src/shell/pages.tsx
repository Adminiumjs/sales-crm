/**
 * The pages that say why a screen is not shown. Each sits inside the frame
 * (menu and top bar stay), names the address that was asked, and offers one
 * way on: the person's home.
 *
 * Which of them a person meets is decided in `Shell.tsx`. A record that is
 * not theirs is drawn by the record's own screen as "no record": the server
 * answers it exactly as a record that does not exist, and so does the page.
 */
import type { ReactNode } from "react";

import { useT } from "../i18n/index.tsx";
import type { MessageKey } from "../i18n/messages/index.ts";
import { Icon } from "./icons.tsx";
import { ScreenLink, useNav } from "./nav.tsx";
import { ROUTES, type MenuItem, type RouteKey } from "./routes.ts";

/** Where the one button goes, and what it says: the person's home, by the name their menu gives it. */
export interface WayHome {
  route: RouteKey;
  item: MenuItem | null;
}

function Plain({ icon, code, heading, children, home, label }: { icon: string; code?: string; heading: string; children: ReactNode; home: WayHome | null; label: string }) {
  const t = useT();
  const nav = useNav();
  const where = home === null ? null : home.item === null || home.item.label === "home" ? t("shell.back.home") : t("shell.back.to", { page: t(`nav.item.${home.item.label}` as MessageKey) });
  return (
    <div className="crm-plain mr-screen" data-screen={label}>
      <span className="crm-plain-icon">
        <Icon name={icon} size={27} />
      </span>
      <div className="crm-plain-address">{code ?? `/${nav.path}`}</div>
      <h1>{heading}</h1>
      {children}
      {home !== null && where !== null && (
        <div className="crm-plain-actions">
          <ScreenLink to={home.route} className="crm-btn crm-btn-primary mr-btn">
            <Icon name={ROUTES[home.route].icon} />
            {where}
          </ScreenLink>
        </div>
      )}
    </div>
  );
}

export type RefusedWhy = { kind: "role" } | { kind: "private" } | { kind: "part"; part: string; owner: boolean } | { kind: "waits"; part: string; addOn: string; owner: boolean };

/** A screen the person's role does not hold, or one of a part that is switched off. */
export function Refused({ why, who, home }: { why: RefusedWhy; who: { name: string; role: string }; home: WayHome | null }) {
  const t = useT();
  const sentence = why.kind === "private" ? t("shell.refused.private") : why.kind === "part" || why.kind === "waits" ? t(why.owner ? "shell.partOff.owner" : "shell.partOff.ask", { part: why.part }) : t("shell.refused.ask");
  return (
    <Plain icon="lock" heading={t("shell.refused.heading")} home={home} label="refused">
      <p>{sentence}</p>
      <div className="crm-plain-who">{t("shell.signedInAs", who)}</div>
    </Plain>
  );
}

/** The names the add-ons a part can wait for go by, in every language: their own. */
const ADD_ON_NAMES: Record<string, string> = { inventory: "Inventory" };

/**
 * A screen of a part built on an add-on that is not connected to this app
 * (`WAITS_FOR`): what it waits for, and who connects it. The install's owner
 * is told where; everybody else whom to ask. Nothing of the part is read.
 */
export function Waits({ why, who, home }: { why: Extract<RefusedWhy, { kind: "waits" }>; who: { name: string; role: string }; home: WayHome | null }) {
  const t = useT();
  const words = { part: why.part, addOn: ADD_ON_NAMES[why.addOn] ?? why.addOn };
  return (
    <Plain icon="package" heading={t("supply.waits.heading", words)} home={home} label="waits">
      <p>{t(why.owner ? "supply.waits.owner" : "supply.waits.ask", words)}</p>
      {why.owner && (
        <p>
          <a className="crm-ast-link" href="/studio/apps/crm" data-testid="waits-open">
            {t("supply.waits.open")}
          </a>
        </p>
      )}
      <div className="crm-plain-who">{t("shell.signedInAs", who)}</div>
    </Plain>
  );
}

/** An address that names a record nobody can show this person: not there, or not theirs. The two read alike. */
export function NoRecord({ home }: { home: WayHome | null }) {
  const t = useT();
  return (
    <Plain icon="file-question" heading={t("shell.noRecord.heading")} home={home} label="no-record">
      <p>{t("shell.noRecord.body")}</p>
    </Plain>
  );
}

/** An address that names no screen at all. */
export function NotFound({ home }: { home: WayHome | null }) {
  const t = useT();
  return (
    <Plain icon="file-question" code="404" heading={t("shell.notFound.heading")} home={home} label="not-found">
      <p>{t("shell.notFound.body")}</p>
    </Plain>
  );
}

/** Somebody every one of whose screens is in a part that is off. */
export function NothingOn({ who }: { who: { name: string; role: string } }) {
  const t = useT();
  return (
    <Plain icon="lock" code="" heading={t("shell.nothingOn.heading")} home={null} label="nothing-on">
      <p>{t("shell.nothingOn.body")}</p>
      <div className="crm-plain-who">{t("shell.signedInAs", who)}</div>
    </Plain>
  );
}

