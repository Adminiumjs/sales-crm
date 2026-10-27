/**
 * ADD AN ENQUIRY: somebody rang, walked in or wrote, and nothing brought the
 * enquiry here by itself. Typed in by whoever took it: the front desk, a rep,
 * a manager, the CRM admin.
 *
 * Only the company's name is needed. A company on the books with that name is
 * offered as the enquiry's match, so whoever claims it starts the deal there
 * and not on a second copy.
 *
 * The save carries one key for as long as the dialog is open: a reply that
 * never arrives is sent again with the same key, and the server answers the
 * enquiry the first try made.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { saidNo } from "../../lib/consent.ts";
import { newClientKey, StaffError } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { useLoad } from "../../ui/load.tsx";
import { OptOutLine } from "../../ui/optOut.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { addEnquiry, findCompanies, SOURCES, type Source } from "./data.ts";
import { SOURCE_ICON, sourceLabel } from "./parts.tsx";

export function AddEnquiry({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);

  const [source, setSource] = useState<Source>("phone");
  const [company, setCompany] = useState("");
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [person, setPerson] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [wants, setWants] = useState("");
  const [text, setText] = useState("");
  const [size, setSize] = useState("");
  const [town, setTown] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newClientKey());
  // The line under the address, once one is typed; "They said no" is kept until the save (see `ui/optOut.tsx`).
  const [refused, setRefused] = useState(false);
  const offering = email.trim() !== "";
  const mayStop = session.can("enquiries", "update");

  const [asked, setAsked] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setAsked(company.trim()), 300);
    return () => clearTimeout(timer);
  }, [company]);
  const { load: found } = useLoad(() => findCompanies(session, asked), [session, asked]);
  const matches = found.state === "ready" ? found.data : [];
  const read = size.trim() === "" ? null : f.readAmount(size);

  const save = async (): Promise<void> => {
    if (company.trim() === "") return setError(t("enquiry.error.company"));
    if (size.trim() !== "" && read === null) return setError(t("enquiry.error.size"));
    setError(null);
    setBusy(true);
    const saved = await addEnquiry(session, { source, company_name: company, person, email, phone, wants, text, est_value: read, town, company_id: companyId }, key.current, offering && !refused);
    if (saved.state === "refused") return (setBusy(false), setError(t("ui.refused", { reason: reasonOf(saved.error, t) })));
    if (saved.state === "unknown") return (setBusy(false), setError(t("ui.unknown")));
    toasts.show(t("enquiry.toast", { company: company.trim() }), "pos");
    if (offering && refused && mayStop) {
      const name = person.trim() === "" ? company.trim() : person.trim();
      try {
        await saidNo(session, "enquiries", saved.row.id);
        toasts.show(t("enquiry.optOut.done", { name }), "pos");
      } catch (failed) {
        toasts.show(t("enquiry.optOut.failed", { name, reason: failed instanceof StaffError ? reasonOf(failed, t) : t("ui.unknown") }), "danger", true);
      }
    }
    setBusy(false);
    onSaved();
    onClose();
  };

  return (
    <Dialog
      shape="sheet"
      name="add-enquiry"
      icon="inbox"
      tone="accent"
      title={t("enquiry.title")}
      subtitle={t("enquiry.sub")}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("ui.cancel")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 crm-btn-wide mr-btn" disabled={busy} onClick={() => void save()}>
            <Icon name="check" />
            {busy ? t("ui.saving") : t("enquiry.save")}
          </button>
        </>
      }
    >
      <fieldset className="crm-fields" disabled={busy}>
        <div className="crm-label" id="crm-enq-source">
          {t("enquiry.source")}
        </div>
        <div className="crm-choice-row" role="radiogroup" aria-labelledby="crm-enq-source">
          {SOURCES.map((one) => (
            <button key={one} type="button" role="radio" aria-checked={source === one} className="crm-choice crm-choice-solid mr-chip" data-source={one} onClick={() => setSource(one)}>
              <Icon name={SOURCE_ICON[one]} size={14} />
              {sourceLabel(one, t)}
            </button>
          ))}
        </div>

        <label className="crm-label" htmlFor="crm-enq-company">
          {t("enquiry.company")}
        </label>
        <input id="crm-enq-company" data-autofocus className="crm-input mr-fld" value={company} maxLength={160} onChange={(event) => (setCompany(event.target.value), setCompanyId(null), setError(null))} />
        {matches.length > 0 && (
          <div className="crm-enq-matches" role="group" aria-label={t("enquiry.match")}>
            <span className="crm-field-note">{t("enquiry.match")}</span>
            {matches.map((one) => (
              <button key={one.id} type="button" className="crm-chip-btn mr-chip" aria-pressed={companyId === one.id} data-match={one.id} onClick={() => setCompanyId(companyId === one.id ? null : one.id)}>
                <Icon name="link" size={13} />
                {one.name}
              </button>
            ))}
          </div>
        )}

        <label className="crm-label" htmlFor="crm-enq-wants">
          {t("enquiry.wants")}
        </label>
        <input id="crm-enq-wants" className="crm-input mr-fld" value={wants} maxLength={300} placeholder={t("enquiry.wants.hint")} onChange={(event) => setWants(event.target.value)} />

        <label className="crm-label" htmlFor="crm-enq-text">
          {t("enquiry.text")}
        </label>
        <textarea id="crm-enq-text" className="crm-input crm-textarea mr-fld" rows={4} value={text} maxLength={2000} onChange={(event) => setText(event.target.value)} />

        <div className="crm-field-pair">
          <div>
            <label className="crm-label" htmlFor="crm-enq-person">
              {t("enquiry.person")}
            </label>
            <input id="crm-enq-person" className="crm-input mr-fld" value={person} maxLength={120} autoComplete="off" onChange={(event) => setPerson(event.target.value)} />
          </div>
          <div>
            <label className="crm-label" htmlFor="crm-enq-town">
              {t("enquiry.town")}
            </label>
            <input id="crm-enq-town" className="crm-input mr-fld" value={town} maxLength={120} onChange={(event) => setTown(event.target.value)} />
          </div>
        </div>
        <div className="crm-field-pair">
          <div>
            <label className="crm-label" htmlFor="crm-enq-phone">
              {t("enquiry.phone")}
            </label>
            <input id="crm-enq-phone" className="crm-input crm-mono mr-fld" type="tel" value={phone} maxLength={40} autoComplete="off" onChange={(event) => setPhone(event.target.value)} />
          </div>
          <div>
            <label className="crm-label" htmlFor="crm-enq-email">
              {t("enquiry.email")}
            </label>
            <input id="crm-enq-email" className="crm-input mr-fld" type="email" value={email} maxLength={200} autoComplete="off" onChange={(event) => setEmail(event.target.value)} />
          </div>
        </div>
        {offering && (
          <OptOutLine
            words={{ line: t("enquiry.optOut.line"), no: t("enquiry.optOut.no"), noted: t(mayStop ? "enquiry.optOut.noted" : "enquiry.optOut.noted.keep") }}
            saidNo={refused}
            onSaidNo={setRefused}
          />
        )}

        <label className="crm-label" htmlFor="crm-enq-size">
          {t("enquiry.size")}
        </label>
        <input id="crm-enq-size" className="crm-input crm-mono mr-fld" inputMode="decimal" aria-describedby="crm-enq-size-read" value={size} onChange={(event) => (setSize(event.target.value), setError(null))} />
        <div id="crm-enq-size-read" className="crm-field-note crm-mono">
          {read !== null ? t("deal.new.amount.read", { amount: f.money(read) }) : t("enquiry.size.hint")}
        </div>
      </fieldset>

      {error !== null && (
        <div className="crm-form-error" role="alert">
          <Icon name="triangle-alert" size={15} />
          <span>{error}</span>
        </div>
      )}
    </Dialog>
  );
}
