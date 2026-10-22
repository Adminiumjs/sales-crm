/**
 * PASTE A LIST: companies or contacts brought in from a pasted list or a
 * file. It is Adminium's own import, drawn here (`kitParts.ts`): paste, map
 * the columns, look at what each line would do, run.
 *
 * WHAT EACH ROLE IS OFFERED, and why:
 *  - a rep and the sales manager: a line that is already here is LEFT AS IT
 *    IS. They are not offered "update". The server would let them (they may
 *    change any company one at a time), but a list that rewrites what is
 *    already here is fast damage, and is left to the CRM admin;
 *  - the CRM admin: left as it is to begin with, or updated if she chooses;
 *  - anybody else has no such line in their menu, and the server refuses them
 *    the import itself.
 *
 * WHAT "ALREADY HERE" MEANS. For the CRM admin a company is matched on its
 * name, letter for letter. Everybody else is held to some companies (plan 68
 * X3), and the server matches such a writer's list only on a column no two
 * rows share: for them a company is matched on its customer number, and a
 * line with none is a new company (the page says so). A contact is
 * matched on nothing to begin with (two people may share a name), so every
 * line of a contacts list is a new contact unless the person chooses to match
 * on the name; below the CRM admin the name is the only column offered for
 * that, never an e-mail or a phone. The page says all of this. A contact's
 * line names its company by the company's number, which the company's page
 * shows: the import brings rows into one table and cannot look a company up
 * by its name.
 */
import { useEffect, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { kitCommon, type KitMissing } from "../../kitParts.ts";
import { Icon } from "../../shell/icons.tsx";
import { useNav } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { KitPart } from "../../ui/kit.tsx";
import { LoadFailed } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";
import { COMPANY_COLUMNS, CONTACT_COLUMNS, modesFor } from "./data.ts";
import { useAccounts } from "./shared.tsx";

interface ImportTable {
  table: string;
  label: string;
  columns: { key: string; label: string; unique?: boolean }[];
  matchOn?: string;
}
interface ImportProps {
  locale: string;
  dir: "ltr" | "rtl";
  theme?: "light" | "dark";
  connectionId: string;
  csrfToken: string;
  tables: ImportTable[];
  modes: ("skip" | "update")[];
  ariaLabel: string;
  onDone: (result: { created: number; updated: number; skipped: number; failed: number }) => void;
  onClose: () => void;
}

export function PasteList(_props: ScreenProps) {
  const t = useT();
  const nav = useNav();
  const toasts = useToasts();
  const { locale } = useI18n();
  const { session, f } = useAccounts();
  const config = session.config;
  const [theme, setTheme] = useState<"light" | "dark">(() => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"));
  useEffect(() => {
    const watch = new MutationObserver(() => setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, []);

  // The side's config says who may make a row, not who may bring a list in: the tables offered are the ones the person may add to, and the server says so in the wizard when it refuses the list itself.
  const mayCompanies = session.can("companies", "create");
  const mayContacts = session.can("contacts", "create");
  // The CRM admin is whoever may also take a company away; the install's owner counts as her.
  const admin = session.can("companies", "delete");
  const modes = useMemo(() => modesFor(admin, session.can("companies", "update")), [admin, session]);

  const props = useMemo<ImportProps | null>(() => {
    if (config.connectionId === null || (!mayCompanies && !mayContacts)) return null;
    const tables: ImportTable[] = [];
    if (mayCompanies)
      tables.push({
        table: session.tableId("companies"),
        label: t("acc.im.companies"),
        columns: [...COMPANY_COLUMNS.map((key) => ({ key, label: t(`acc.rec.co.${key}` as MessageKey) })), { key: "customer_no", label: t("acc.im.co.customer_no"), ...(admin ? {} : { unique: true }) }],
        matchOn: admin ? "name" : "customer_no",
      });
    // Below the CRM admin a contact is matched on its name or on nothing, never on an e-mail or a phone (personal data): the part offers for matching only the columns marked here.
    if (mayContacts) tables.push({ table: session.tableId("contacts"), label: t("acc.im.contacts"), columns: CONTACT_COLUMNS.map((key) => ({ key, label: t(`acc.im.ct.${key}` as MessageKey), ...(!admin && key === "name" ? { unique: true } : {}) })) });
    return {
      ...kitCommon(config, locale),
      theme,
      connectionId: config.connectionId,
      csrfToken: config.csrfToken ?? "",
      tables,
      modes,
      ariaLabel: t("acc.im.title"),
      onDone: (result) =>
        toasts.show(
          t("acc.im.done", { created: f.number(result.created), updated: f.number(result.updated), skipped: f.number(result.skipped) }),
          result.failed > 0 ? "plain" : "pos",
          true,
        ),
      onClose: () => nav.go("companies"),
    };
  }, [config, locale, theme, session, mayCompanies, mayContacts, admin, modes, t, f, toasts, nav]);

  const unavailable = (why: KitMissing, retry: () => void) =>
    why === "failed" ? (
      <LoadFailed reload={retry} />
    ) : (
      <div className="crm-empty crm-board-missing" role="status">
        <span className="crm-empty-icon" data-tone="plain">
          <Icon name="clipboard-list" size={21} />
        </span>
        <div className="crm-empty-title">{t("acc.im.missing")}</div>
        <p>{t("acc.im.missing.body")}</p>
      </div>
    );

  return (
    <div className="crm-screen crm-acc crm-acc-import mr-screen" data-screen="import">
      <h1>{t("acc.im.title")}</h1>
      <p className="crm-screen-sub">{t("acc.im.sub")}</p>
      {props === null ? (
        <div className="crm-empty crm-acc-empty" role="status">
          <span className="crm-empty-icon" data-tone="plain">
            <Icon name="lock" size={21} />
          </span>
          <div className="crm-empty-title">{t("acc.im.refused")}</div>
          <p>{t("acc.im.refused.body")}</p>
        </div>
      ) : (
        <>
          <ul className="crm-acc-im-notes">
            <li data-note="modes">{t(modes.includes("update") ? "acc.im.note.update" : "acc.im.note.skip")}</li>
            {mayCompanies && <li data-note="companies">{t(admin ? "acc.im.note.companies" : "acc.im.note.companies.number")}</li>}
            {mayContacts && <li data-note="contacts">{t("acc.im.note.contacts")}</li>}
          </ul>
          <KitPart<ImportProps> part="import" className="crm-acc-im-kit mr-card" props={props} fallback={unavailable} />
        </>
      )}
    </div>
  );
}
