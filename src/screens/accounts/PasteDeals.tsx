/**
 * PAST DEALS, on Paste a list: the CRM admin's (plan 68 R5).
 *
 * A business moving to this CRM brings the deals it already won and lost. It
 * is Adminium's own import again, in a wizard of its own (one table, so the
 * page knows the list is of deals and can give every line its owner). What
 * the server holds, whatever the page offers:
 *  - only the CRM admin (and the install's owner) brings deals in;
 *  - a won or lost deal needs its closed date: a line without one is named in
 *    the preview and not brought in, and no deal is dated by the import day
 *    (its closed day is worked out from its closed date);
 *  - a line names its company by the company's number, its stage and why it
 *    was lost by theirs: the numbers are listed here, as the import looks
 *    nothing up by name.
 */
import { useEffect, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { kitCommon, type KitMissing } from "../../kitParts.ts";
import type { Person, StaffSession } from "../../staffSession.ts";
import { KitPart } from "../../ui/kit.tsx";
import { LoadFailed } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";
import type { ListFetch } from "../inbox/paste.ts";
import { DEAL_COLUMNS, dealsFetch } from "./pasteDeals.ts";

interface DealsImportProps {
  locale: string;
  dir: "ltr" | "rtl";
  theme?: "light" | "dark";
  connectionId: string;
  csrfToken: string;
  tables: { table: string; label: string; columns: { key: string; label: string }[] }[];
  modes: "skip"[];
  ariaLabel: string;
  fetch: ListFetch;
  onDone: (result: { created: number; updated: number; skipped: number; failed: number }) => void;
}

interface Numbered extends Record<string, unknown> {
  id: number;
  label: string;
}

export function PasteDeals({ session, theme, number }: { session: StaffSession; theme: "light" | "dark"; number: (n: number) => string }) {
  const t = useT();
  const toasts = useToasts();
  const { locale } = useI18n();
  const config = session.config;
  const me = config.user?.id ?? null;
  const [people, setPeople] = useState<Person[]>([]);
  const [owner, setOwner] = useState<string | null>(me);
  const [stages, setStages] = useState<Numbered[]>([]);
  const [reasons, setReasons] = useState<Numbered[]>([]);

  useEffect(() => {
    let live = true;
    void Promise.all([
      session.people(undefined, 200).catch(() => [] as Person[]),
      session.list<Numbered>("stages", { select: ["id", "label"], order: ["position", "id"], limit: 200 }).then((page) => page.rows).catch(() => [] as Numbered[]),
      session.list<Numbered>("lost_reasons", { select: ["id", "label"], order: ["position", "id"], limit: 200 }).then((page) => page.rows).catch(() => [] as Numbered[]),
    ]).then(([found, stageRows, reasonRows]) => {
      if (!live) return;
      setPeople(found.filter((person) => person.sample !== true || person.id === me));
      setStages(stageRows);
      setReasons(reasonRows);
    });
    return () => {
      live = false;
    };
  }, [session, me]);

  const ownerHeader = t("guards.paste.col.owner");
  const needs = t("guards.paste.needsClosed");
  const send = useMemo(() => dealsFetch(() => (owner === null ? null : { header: ownerHeader, id: owner }), () => needs), [owner, ownerHeader, needs]);

  const props = useMemo<DealsImportProps | null>(() => {
    if (config.connectionId === null) return null;
    return {
      ...kitCommon(config, locale),
      theme,
      connectionId: config.connectionId,
      csrfToken: config.csrfToken ?? "",
      tables: [
        {
          table: session.tableId("deals"),
          label: t("guards.paste.deals.table"),
          columns: [{ key: "owner_id", label: ownerHeader }, ...DEAL_COLUMNS.map((key) => ({ key, label: t(`guards.paste.col.${key}` as MessageKey) }))],
        },
      ],
      // A list of past deals adds; changing a saved deal by a list is not offered.
      modes: ["skip"],
      ariaLabel: t("guards.paste.deals.title"),
      fetch: send,
      onDone: (result) => toasts.show(t("guards.paste.done", { created: number(result.created), skipped: number(result.skipped) }), result.failed > 0 ? "plain" : "pos", true),
    };
  }, [config, locale, theme, session, t, ownerHeader, send, toasts, number]);

  const unavailable = (why: KitMissing, retry: () => void) => (why === "failed" ? <LoadFailed reload={retry} /> : <p className="crm-acc-im-missing">{t("acc.im.missing.body")}</p>);
  const choices = people.some((person) => person.id === me) || me === null ? people : [...(me === null ? [] : [{ id: me, name: config.user?.name ?? "" }]), ...people];

  return (
    <section className="crm-acc-im-deals" data-section="deals" aria-labelledby="crm-acc-im-deals">
      <h2 id="crm-acc-im-deals">{t("guards.paste.deals.title")}</h2>
      <p className="crm-screen-sub">{t("guards.paste.deals.sub")}</p>
      <ul className="crm-acc-im-notes">
        <li data-note="closed">{t("guards.paste.deals.note.closed")}</li>
        <li data-note="numbers">{t("guards.paste.deals.note.numbers")}</li>
      </ul>
      <div className="crm-acc-im-legend">
        <div data-legend="stages">
          <span className="crm-acc-im-legend-title">{t("guards.paste.deals.stages")}</span>
          <ul>
            {stages.map((stage) => (
              <li key={stage.id}>
                <span className="crm-mono">{number(stage.id)}</span> {stage.label}
              </li>
            ))}
          </ul>
        </div>
        <div data-legend="reasons">
          <span className="crm-acc-im-legend-title">{t("guards.paste.deals.reasons")}</span>
          <ul>
            {reasons.map((reason) => (
              <li key={reason.id}>
                <span className="crm-mono">{number(reason.id)}</span> {reason.label}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="crm-acc-im-owner">
        <label className="crm-label" htmlFor="crm-acc-im-owner">
          {t("guards.paste.deals.owner")}
        </label>
        <select id="crm-acc-im-owner" className="crm-input mr-fld" value={owner ?? ""} onChange={(event) => setOwner(event.target.value === "" ? null : event.target.value)}>
          {choices.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </div>
      {props !== null && owner !== null && <KitPart<DealsImportProps> part="import" className="crm-acc-im-kit mr-card" props={props} fallback={unavailable} />}
    </section>
  );
}
