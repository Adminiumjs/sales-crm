/**
 * MY DETAILS (ledger screen 23): how this person appears to the team, and how
 * the workspace behaves for her.
 *
 * Only what something reads is here, each cut to who she is (finding P26):
 *  - her name, and the language she reads the app in: Adminium's own settings
 *    for her, for everybody;
 *  - her working hours: only for somebody with a rep's profile, where My
 *    profile shows them.
 * Her e-mail address and her password are changed in Adminium's own account
 * page, which asks for the password; the time zone is the install's.
 *
 * A change of name or language is in force from the next page load, so the
 * page is loaded again once it is saved.
 */
import { useMemo, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { LOCALES, LOCALE_TAGS, isLocaleTag } from "../../i18n/locales.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useLoad } from "../../ui/load.tsx";
import { initials } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { fromServerLocale, readDetails, saveDetails, toServerLocale, type Details } from "./data.ts";

export function MyDetails(_props: ScreenProps) {
  const session = useSession();
  const { load, reload } = useLoad(() => readDetails(session), [session]);
  return (
    <Loaded load={load} reload={reload} skeleton={<div className="crm-screen crm-details mr-screen"><Skeleton rows={3} height={96} /></div>}>
      {(details) => <Form details={details} reload={reload} />}
    </Loaded>
  );
}

function Form({ details, reload }: { details: Details; reload: () => void }) {
  const t = useT();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const [name, setName] = useState(details.name);
  const [locale, setLocale] = useState<string | null>(details.locale);
  const [from, setFrom] = useState(details.rep?.hours_from ?? "");
  const [to, setTo] = useState(details.rep?.hours_to ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = name.trim() !== details.name || locale !== details.locale || (details.rep !== null && (from !== (details.rep.hours_from ?? "") || to !== (details.rep.hours_to ?? "")));
  const resolved = useMemo(() => fromServerLocale(details.resolved), [details]);

  const save = async (): Promise<void> => {
    if (name.trim() === "") return setError(t("details.error.name"));
    if ((from === "") !== (to === "")) return setError(t("details.error.hours"));
    setError(null);
    setBusy(true);
    const again = name.trim() !== details.name || locale !== details.locale;
    const saved = await saveDetails(session, details, { name, locale, hours: details.rep === null ? null : { from, to } });
    setBusy(false);
    if (saved.state === "refused") return setError(t("ui.refused", { reason: reasonOf(saved.error, t) }));
    if (saved.state === "unknown") return setError(t("ui.unknown"));
    toasts.show(t("details.saved"), "pos");
    // Her name and her language come with the page: read it again so every screen has them.
    if (again) setTimeout(() => window.location.reload(), 700);
    else reload();
  };

  return (
    <div className="crm-screen crm-details mr-screen" data-screen="mydetails">
      <div className="crm-screen-head">
        <div>
          <h1>{t("details.title")}</h1>
          <p className="crm-screen-sub">{t("details.sub")}</p>
        </div>
      </div>

      <fieldset className="crm-details-card mr-card crm-fields" disabled={busy}>
        <div className="crm-details-tile">
          <span className="crm-avatar crm-avatar-lg" aria-hidden="true">
            {initials(name.trim() === "" ? details.name : name)}
          </span>
          <div>
            <div className="crm-details-tile-title">{t("details.tile")}</div>
            <div className="crm-field-note">{t("details.tile.body")}</div>
          </div>
        </div>
        <div className="crm-field-pair">
          <div>
            <label className="crm-label" htmlFor="crm-my-name">
              {t("details.name")}
            </label>
            <input id="crm-my-name" className="crm-input mr-fld" value={name} maxLength={120} autoComplete="name" onChange={(event) => (setName(event.target.value), setError(null))} />
          </div>
          <div>
            <div className="crm-label">{t("details.email")}</div>
            <div className="crm-details-fixed crm-mono" data-testid="my-email">
              {details.email}
            </div>
            <div className="crm-field-note">{t("details.email.note")}</div>
          </div>
        </div>
        {details.rep !== null && (
          <div data-testid="my-hours">
            <div className="crm-label" id="crm-my-hours">
              {t("details.hours")}
            </div>
            <div className="crm-told-times" role="group" aria-labelledby="crm-my-hours">
              <label className="crm-sr" htmlFor="crm-my-from">
                {t("details.hours.from")}
              </label>
              <input id="crm-my-from" className="crm-input crm-mono mr-fld" type="time" value={from} onChange={(event) => (setFrom(event.target.value), setError(null))} />
              <span>{t("told.to")}</span>
              <label className="crm-sr" htmlFor="crm-my-to">
                {t("details.hours.until")}
              </label>
              <input id="crm-my-to" className="crm-input crm-mono mr-fld" type="time" value={to} onChange={(event) => (setTo(event.target.value), setError(null))} />
              <span className="crm-field-note">{t("details.hours.note", { zone: config.timezone ?? config.serverTimezone ?? "UTC" })}</span>
            </div>
          </div>
        )}
      </fieldset>

      <section className="crm-details-card mr-card" aria-labelledby="crm-my-behaves">
        <h2 id="crm-my-behaves">{t("details.behaves")}</h2>
        <div className="crm-details-pref">
          <div className="crm-details-pref-label" id="crm-my-language">
            {t("details.language")}
          </div>
          <div className="crm-field-note">{t("details.language.body")}</div>
          <div className="crm-chips" role="radiogroup" aria-labelledby="crm-my-language">
            <button type="button" role="radio" aria-checked={locale === null} className="crm-chip-btn mr-chip" data-locale="" disabled={busy} onClick={() => setLocale(null)}>
              {t("details.language.install", { language: isLocaleTag(resolved) && details.locale === null ? LOCALES[resolved].native : t("details.language.installPlain") })}
            </button>
            {LOCALE_TAGS.map((tag) => (
              <button key={tag} type="button" role="radio" aria-checked={locale === toServerLocale(tag)} className="crm-chip-btn mr-chip" data-locale={tag} lang={tag} disabled={busy} onClick={() => setLocale(toServerLocale(tag))}>
                {LOCALES[tag].native}
              </button>
            ))}
          </div>
        </div>
        <div className="crm-details-pref">
          <div className="crm-details-pref-label">{t("details.zone")}</div>
          <div className="crm-field-note" data-testid="my-zone">
            {t("details.zone.body", { zone: config.timezone ?? config.serverTimezone ?? "UTC" })}
          </div>
        </div>
      </section>

      {error !== null && (
        <div className="crm-form-error" role="alert">
          <Icon name="triangle-alert" size={15} />
          <span>{error}</span>
        </div>
      )}
      <div className="crm-told-foot">
        <button type="button" className="crm-btn crm-btn-primary crm-btn-44 mr-btn" data-testid="details-save" disabled={busy || !changed} onClick={() => void save()}>
          <Icon name="check" />
          {busy ? t("ui.saving") : t("details.save")}
        </button>
        <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy || !changed} onClick={() => (setName(details.name), setLocale(details.locale), setFrom(details.rep?.hours_from ?? ""), setTo(details.rep?.hours_to ?? ""), setError(null))}>
          {t("details.revert")}
        </button>
      </div>
    </div>
  );
}
