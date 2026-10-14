/**
 * PASTE A SHOW'S LEADS (`trade-show-leads/paste`): the list scanned on a
 * stand, brought in as enquiries of one show. For the marketer and the CRM
 * admin; the server refuses anybody else when the lines are checked.
 *
 * The wizard is Adminium's own import part. This wrapper adds two things: the
 * show the list belongs to (picked here, or made here), and the two cells
 * that say so on every line (`paste.ts`).
 *
 * Every line is a new enquiry: the list is matched on nothing, so a personal
 * column (an e-mail address, a phone number) is never used to find a row.
 */
import { useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters } from "../../lib/format.ts";
import { kitCommon } from "../../kitParts.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink, useNav } from "../../shell/nav.tsx";
import { newClientKey } from "../../staffSession.ts";
import { KitPart } from "../../ui/kit.tsx";
import { LoadFailed } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import type { Show } from "./data.ts";
import { showDates } from "./Leads.tsx";
import { stampingFetch, type ListFetch } from "./paste.ts";

interface ImportProps {
  connectionId: string;
  csrfToken: string;
  tables: { table: string; label: string; columns: { key: string; label: string; unique?: boolean }[]; matchOn?: string }[];
  modes: ("skip" | "update")[];
  title: string;
  locale: string;
  dir: "ltr" | "rtl";
  theme: "light" | "dark";
  fetch: ListFetch;
  onDone: (done: { created: number; updated: number; skipped: number; failed: number }) => void;
  onClose: () => void;
}

export function PasteLeads({ shows, onShows }: { shows: Show[]; onShows: () => void }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const nav = useNav();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const [showId, setShowId] = useState<number | null>(shows[0]?.id ?? null);
  const show = shows.find((one) => one.id === showId) ?? shows[0] ?? null;

  // A show that is not here yet: its name and its days, made by whoever may make one.
  const canMakeShow = session.can("shows", "create");
  const [making, setMaking] = useState(shows.length === 0);
  const [name, setName] = useState("");
  const [from, setFrom] = useState(() => f.dayKey(session.now()));
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newClientKey());
  const makeShow = async (): Promise<void> => {
    if (name.trim() === "" || from === "") return setError(t("paste.show.error"));
    setError(null);
    setBusy(true);
    const made = await session.create<Show>("shows", { name: name.trim(), starts_on: from, ends_on: to === "" ? null : to }, key.current);
    setBusy(false);
    if (made.state !== "saved") return setError(made.state === "refused" ? t("ui.refused", { reason: reasonOf(made.error, t) }) : t("ui.unknown"));
    key.current = newClientKey();
    setShowId(made.row.id);
    setMaking(false);
    setName("");
    onShows();
  };

  // The show as it is when the list goes up, not as it was when the wizard was drawn.
  const picked = useRef(show);
  picked.current = show;
  const labels = useMemo(() => ({ source: t("paste.col.source"), show: t("paste.col.show"), received: t("paste.col.received") }), [t]);
  /*
   * WHEN A LEAD WAS SCANNED. An enquiry typed in is stamped "received now" by
   * the server; a row brought in by a list is not (the import runs none of a
   * table's stamps), and the database refuses a row without it. So the list
   * also says when: the show's first day, at noon where the business is.
   * Only somebody who may write that column can say it: the CRM admin and
   * whoever runs the install. The marketer may not, and her list is refused
   * until Adminium stamps an imported row itself (the report's engine gaps).
   */
  const roles = config.access?.roles ?? [];
  const datesRows = roles.length === 0 || roles.some((role) => role.slug === "crm-admin");
  const send = useMemo(
    () =>
      stampingFetch(() => {
        const show = picked.current;
        if (show === null) return null;
        return datesRows ? { header: [labels.source, labels.show, labels.received], values: ["show", String(show.id), f.at(show.starts_on, "12:00").toISOString()] } : { header: [labels.source, labels.show], values: ["show", String(show.id)] };
      }),
    [labels, datesRows, f],
  );
  const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const props = useMemo<ImportProps>(
    () => ({
      connectionId: session.connectionId,
      csrfToken: config.csrfToken ?? "",
      tables: [
        {
          table: session.tableId("enquiries"),
          label: t("paste.table"),
          columns: [
            { key: "company_name", label: t("enquiry.company") },
            { key: "person", label: t("enquiry.person") },
            { key: "town", label: t("enquiry.town") },
            { key: "wants", label: t("enquiry.wants") },
            { key: "warmth", label: t("paste.col.warmth") },
            { key: "text", label: t("paste.col.note") },
            { key: "email", label: t("enquiry.email") },
            { key: "phone", label: t("enquiry.phone") },
            { key: "est_value", label: t("enquiry.size") },
            { key: "source", label: labels.source },
            { key: "show_id", label: labels.show },
            ...(datesRows ? [{ key: "received_at", label: labels.received }] : []),
          ],
        },
      ],
      modes: ["skip"],
      title: t("paste.wizard"),
      ...kitCommon(config, locale),
      theme,
      fetch: send,
      // What came of it, said plainly: a list the server refused is not "brought in".
      onDone: (done) => (done.failed > 0 ? toasts.show(t("paste.toast.refused", { count: f.number(done.failed), made: f.number(done.created) }, done.failed), "danger", true) : toasts.show(t("paste.toast", { count: f.number(done.created) }, done.created), "pos")),
      onClose: () => nav.go("leads"),
    }),
    [session, config, t, labels, locale, theme, send, toasts, f, nav, datesRows],
  );

  return (
    <div className="crm-screen crm-paste mr-screen" data-screen="paste-leads">
      <div className="crm-screen-head">
        <div>
          <h1>{t("paste.title")}</h1>
          <p className="crm-screen-sub">{t("paste.sub")}</p>
        </div>
        <div className="crm-screen-actions">
          <ScreenLink to="leads" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi">
            <Icon name="chevron-left" />
            {t("paste.back")}
          </ScreenLink>
        </div>
      </div>

      <section className="crm-paste-show mr-card" aria-labelledby="crm-paste-show">
        <h2 id="crm-paste-show">{t("paste.show")}</h2>
        {shows.length > 0 && !making && (
          <div className="crm-paste-pick">
            <label className="crm-sr" htmlFor="crm-paste-which">
              {t("paste.show")}
            </label>
            <select id="crm-paste-which" className="crm-input mr-fld" value={show?.id ?? ""} onChange={(event) => setShowId(Number(event.target.value))}>
              {shows.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name} · {showDates(one, f)}
                </option>
              ))}
            </select>
            {canMakeShow && (
              <button type="button" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi" data-testid="show-new" onClick={() => setMaking(true)}>
                <Icon name="plus" />
                {t("paste.show.new")}
              </button>
            )}
          </div>
        )}
        {making &&
          (canMakeShow ? (
            <fieldset className="crm-fields crm-paste-new" disabled={busy}>
              <label className="crm-label" htmlFor="crm-show-name">
                {t("paste.show.name")}
              </label>
              <input id="crm-show-name" className="crm-input mr-fld" value={name} maxLength={160} onChange={(event) => (setName(event.target.value), setError(null))} />
              <div className="crm-field-pair">
                <div>
                  <label className="crm-label" htmlFor="crm-show-from">
                    {t("paste.show.from")}
                  </label>
                  <input id="crm-show-from" className="crm-input crm-mono mr-fld" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                </div>
                <div>
                  <label className="crm-label" htmlFor="crm-show-to">
                    {t("paste.show.to")}
                  </label>
                  <input id="crm-show-to" className="crm-input crm-mono mr-fld" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
                </div>
              </div>
              {error !== null && (
                <div className="crm-form-error" role="alert">
                  <Icon name="triangle-alert" size={15} />
                  <span>{error}</span>
                </div>
              )}
              <div className="crm-paste-new-foot">
                {shows.length > 0 && (
                  <button type="button" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi" onClick={() => (setMaking(false), setError(null))}>
                    {t("ui.cancel")}
                  </button>
                )}
                <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" data-testid="show-save" onClick={() => void makeShow()}>
                  <Icon name="check" />
                  {busy ? t("ui.saving") : t("paste.show.save")}
                </button>
              </div>
            </fieldset>
          ) : (
            <p className="crm-field-note">{t("paste.show.none")}</p>
          ))}
        <p className="crm-field-note">{t("paste.how")}</p>
      </section>

      {show !== null && !making && (
        <KitPart<ImportProps>
          part="import"
          className="crm-paste-wizard"
          props={props}
          fallback={(why, again) => (
            <div className="crm-paste-missing">
              <p>{t(why === "failed" ? "paste.missing.failed" : "paste.missing")}</p>
              {why === "failed" && <LoadFailed reload={again} />}
            </div>
          )}
        />
      )}
    </div>
  );
}
