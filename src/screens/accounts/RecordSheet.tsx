/**
 * THE RECORD SHEET: a company or a contact, at the far side of the page.
 * A contact is looked at first (who they are, where they come up) and
 * changed from there; a company is changed straight away, its profile being
 * the place to look at it.
 *
 * WHAT IS SAVED. A new record carries a key made when the sheet opened: a
 * reply that never arrives is sent again with the same key and the server
 * answers the row the first try made, so a dropped connection makes one
 * company, not two. A change sends only what was changed and, after a lost
 * reply, is read back before the sheet says "saved".
 *
 * WHO MAY. The buttons follow what the server said the person may do when the
 * page opened; the server decides each save, and its refusal is said here.
 * A column the server keeps from the reader (a company's street and postal
 * code, a contact's e-mail and phone, for a role without that right) is
 * neither shown nor offered: a field she cannot read back is not hers to fill.
 */
import { useMemo, useRef, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { DealLink } from "../../selling/DealLink.tsx";
import { Icon } from "../../shell/icons.tsx";
import { useNav } from "../../shell/nav.tsx";
import { newClientKey, type Row, type StaffSession } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { Loaded, Skeleton, useLoad } from "../../ui/load.tsx";
import { initials } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { addressOf, PAGE, type Company, type Person, type Reach } from "./data.ts";
import { useAccounts } from "./shared.tsx";

export type Rec =
  | { kind: "company"; mode: "add" }
  | { kind: "company"; mode: "edit"; id: number }
  | { kind: "contact"; mode: "add"; companyId?: number }
  | { kind: "contact"; mode: "view" | "edit"; id: number };

const COMPANY_TEXTS = ["name", "sector", "headcount", "address_lines", "town", "region", "postal_code", "country", "website"] as const;
const CONTACT_TEXTS = ["name", "job_title", "email", "phone"] as const;
const LENGTHS: Record<string, number> = { name: 160, sector: 80, headcount: 9, address_lines: 400, town: 120, region: 120, postal_code: 20, country: 2, website: 200, job_title: 120, email: 200, phone: 40 };
const MONO = new Set(["postal_code", "country", "email", "phone", "headcount", "website"]);
/** The most companies offered as chips for a contact; past that they are a list to pick from. */
const CHIPS = 12;

interface Loaded_ {
  /** The record as the server holds it; null for a new one. */
  row: Row | null;
  /** The columns the server keeps from this reader. */
  kept: string[];
  companies: { id: number; name: string }[];
  company: Company | null;
  /** The open deals the reader may open on which this contact is the main contact. */
  deals: { id: number; name: string; amount: number | string; stage: string | null }[];
}

const keptOf = (row: Row | null | undefined): string[] => (Array.isArray(row?.["_masked"]) ? (row["_masked"] as string[]) : []);

async function read(session: StaffSession, rec: Rec, reach: Reach): Promise<Loaded_ | null> {
  if (rec.kind === "company") {
    if (rec.mode === "edit") {
      const row = await session.get<Row>("companies", rec.id);
      return row === null ? null : { row, kept: keptOf(row), companies: [], company: null, deals: [] };
    }
    // What the server keeps from this reader is said on a row: any one will do.
    const any = (await session.list<Row>("companies", { limit: 1 })).rows[0];
    return { row: null, kept: keptOf(any), companies: [], company: null, deals: [] };
  }
  const companies = rec.mode === "view" ? Promise.resolve([]) : session.list<{ id: number; name: string }>("companies", { select: ["id", "name"], order: ["name", "id"], limit: PAGE }).then((page) => page.rows);
  if (rec.mode === "add") {
    const any = (await session.list<Row>("contacts", { limit: 1 })).rows[0];
    return { row: null, kept: keptOf(any), companies: await companies, company: null, deals: [] };
  }
  const row = await session.get<Row>("contacts", rec.id);
  if (row === null) return null;
  const [company, deals] = await Promise.all([
    session.get<Company>("companies", Number(row["company_id"])),
    rec.mode === "view" && (reach === "team" || reach === "mine")
      ? session
          .list<{ id: number; name: string; amount: number | string; stage: string | null }>("deals", {
            select: ["id", "name", "amount"],
            where: { and: [{ column: "contact_id", op: "eq", value: rec.id }, { column: "state", op: "eq", value: "open" }] },
            order: ["expected_close", "id"],
            lookup: ["stage:stage_id.label"],
            limit: 50,
          })
          .then((page) => page.rows)
      : Promise.resolve([]),
  ]);
  return { row, kept: keptOf(row), companies: await companies, company, deals };
}

const shown = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

export function RecordSheet({ rec, onClose, onSaved, onEdit, onBack }: { rec: Rec; onClose: () => void; onSaved: (row: Row) => void; onEdit?: (id: number) => void; onBack?: (id: number) => void }) {
  const { session, reach } = useAccounts();
  const { load, reload } = useLoad(() => read(session, rec, reach), [session, rec, reach]);
  if (load.state === "ready" && load.data !== null) return <Sheet key={`${rec.kind}-${rec.mode}`} rec={rec} data={load.data} onClose={onClose} onSaved={onSaved} {...(onEdit === undefined ? {} : { onEdit })} {...(onBack === undefined ? {} : { onBack })} />;
  return <Waiting rec={rec} gone={load.state === "ready"} failed={load.state === "failed" || load.state === "refused"} reload={reload} onClose={onClose} />;
}

function Waiting({ rec, gone, failed, reload, onClose }: { rec: Rec; gone: boolean; failed: boolean; reload: () => void; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog
      shape="sheet"
      name="record"
      icon={rec.kind === "company" ? "building-2" : "user-round"}
      title={t(rec.kind === "company" ? "acc.rec.company" : "acc.rec.contact")}
      onClose={onClose}
      foot={
        <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 crm-btn-wide mr-gi" onClick={onClose}>
          {t("ui.close")}
        </button>
      }
    >
      {gone ? (
        <p className="crm-acc-rec-gone" role="alert">
          {t("acc.rec.gone")}
        </p>
      ) : failed ? (
        <Loaded load={{ state: "failed" }} reload={reload}>
          {() => null}
        </Loaded>
      ) : (
        <Skeleton rows={5} height={44} />
      )}
    </Dialog>
  );
}

function Sheet({ rec, data, onClose, onSaved, onEdit, onBack }: { rec: Rec; data: Loaded_; onClose: () => void; onSaved: (row: Row) => void; onEdit?: (id: number) => void; onBack?: (id: number) => void }) {
  const t = useT();
  const nav = useNav();
  const toasts = useToasts();
  const { session, f, locale } = useAccounts();
  const isCompany = rec.kind === "company";
  const ref = isCompany ? "companies" : "contacts";
  const row = data.row;
  const texts = useMemo(() => (isCompany ? COMPANY_TEXTS : CONTACT_TEXTS).filter((column) => !data.kept.includes(column)), [isCompany, data.kept]);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(texts.map((column) => [column, shown(row?.[column])])));
  const [companyId, setCompanyId] = useState<number | null>(() => (rec.kind !== "contact" ? null : row !== null ? Number(row["company_id"]) : (rec.mode === "add" ? rec.companyId : undefined) ?? null));
  const [mayEmail, setMayEmail] = useState<boolean>(() => (row === null ? true : row["may_email"] !== false));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key for as long as the sheet is open: a save sent twice makes one record.
  const key = useRef(newClientKey());
  const set = (column: string, value: string): void => (setDraft((was) => ({ ...was, [column]: value })), setError(null));

  if (rec.kind === "contact" && rec.mode === "view" && row !== null) {
    const person = row as unknown as Person;
    const company = data.company;
    const hidden = data.kept.includes("email");
    const facts: { label: MessageKey; value: string; mono?: boolean }[] = [
      { label: "acc.rec.fact.role", value: shown(person.job_title) },
      { label: "acc.rec.fact.company", value: company?.name ?? "" },
      ...(hidden ? [] : [{ label: "acc.rec.fact.email" as const, value: shown(person.email), mono: true }, { label: "acc.rec.fact.phone" as const, value: shown(person.phone), mono: true }]),
      { label: "acc.rec.fact.where", value: company === null ? "" : addressOf(company, locale) },
    ];
    const canEdit = session.can("contacts", "update") && onEdit !== undefined;
    return (
      <Dialog
        shape="sheet"
        name="record"
        icon="user-round"
        title={person.name}
        {...(person.job_title !== null && company !== null ? { subtitle: `${person.job_title} · ${company.name}` } : company !== null ? { subtitle: company.name } : {})}
        onClose={onClose}
        foot={
          <>
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" onClick={onClose}>
              {t("ui.close")}
            </button>
            {canEdit && (
              <button type="button" className="crm-btn crm-btn-primary crm-btn-44 crm-btn-wide mr-btn" onClick={() => onEdit(person.id)}>
                <Icon name="pencil" />
                {t("acc.rec.edit")}
              </button>
            )}
          </>
        }
      >
        <dl className="crm-acc-rec-facts">
          {facts
            .filter((fact) => fact.value !== "")
            .map((fact) => (
              <div key={fact.label}>
                <dt>{t(fact.label)}</dt>
                <dd className={fact.mono === true ? "crm-mono" : undefined}>{fact.mono === true ? <bdi>{fact.value}</bdi> : fact.value}</dd>
              </div>
            ))}
        </dl>
        {hidden && <p className="crm-field-note">{t("acc.ct.hidden")}</p>}
        <div className="crm-acc-rec-links">
          <h3 className="crm-acc-label">{t("acc.rec.links")}</h3>
          <ul>
            {data.deals.map((deal) => (
              <li key={deal.id} className="crm-acc-rec-link mr-row">
                <span className="crm-acc-rec-link-icon" data-tone="accent">
                  <Icon name="handshake" size={14} />
                </span>
                <span className="crm-acc-rec-link-words">
                  <DealLink id={deal.id} className="crm-acc-rec-link-title">
                    {deal.name}
                  </DealLink>
                  <span className="crm-acc-rec-link-sub">{deal.stage === null ? t("acc.rec.links.main.plain") : t("acc.rec.links.main", { stage: deal.stage })}</span>
                </span>
                <span className="crm-mono crm-acc-rec-link-value">{f.money(deal.amount)}</span>
              </li>
            ))}
            {company !== null && (
              <li className="crm-acc-rec-link mr-row">
                <span className="crm-acc-rec-link-icon">
                  <Icon name="building-2" size={14} />
                </span>
                <span className="crm-acc-rec-link-words">
                  <a
                    className="crm-acc-rec-link-title crm-deal-link"
                    href={nav.href("companies", company.id)}
                    onClick={(event) => {
                      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      onClose();
                      nav.go("companies", company.id);
                    }}
                  >
                    {company.name}
                  </a>
                  <span className="crm-acc-rec-link-sub">{[company.sector, company.town].filter((part) => part !== null && part !== "").join(" · ")}</span>
                </span>
              </li>
            )}
          </ul>
        </div>
      </Dialog>
    );
  }

  const adding = rec.mode === "add";
  const save = async (): Promise<void> => {
    const name = (draft["name"] ?? "").trim();
    if (name === "") return setError(t(isCompany ? "acc.rec.error.name" : "acc.rec.error.person"));
    const values: Row = {};
    for (const column of texts) {
      const typed = (draft[column] ?? "").trim();
      if (column === "headcount") {
        if (typed !== "" && !/^\d{1,9}$/.test(typed)) return setError(t("acc.rec.error.headcount"));
        values[column] = typed === "" ? null : Number(typed);
      } else if (column === "country") {
        if (typed !== "" && !/^[A-Za-z]{2}$/.test(typed)) return setError(t("acc.rec.error.country"));
        values[column] = typed === "" ? null : typed.toUpperCase();
      } else values[column] = typed === "" && column !== "name" ? null : typed;
    }
    if (!isCompany) {
      if (companyId === null) return setError(t("acc.rec.error.company"));
      values["company_id"] = companyId;
      values["may_email"] = mayEmail;
    }
    // A change sends what changed and nothing else.
    const same = (column: string, value: unknown): boolean => (typeof value === "boolean" ? value === (row?.[column] !== false) : shown(value) === shown(row?.[column]));
    const changed: Row = adding ? values : Object.fromEntries(Object.entries(values).filter(([column, value]) => !same(column, value)));
    if (!adding && Object.keys(changed).length === 0) return onClose();
    setBusy(true);
    const saved = await toasts.say(adding ? session.create<Row>(ref, changed, key.current) : session.update<Row>(ref, Number(row?.["id"]), changed), () =>
      t(adding ? "acc.rec.toast.added" : "acc.rec.toast.saved", { name }),
    );
    setBusy(false);
    if (saved === null) return;
    onSaved(saved);
    onClose();
  };
  const label = (column: string): string => t(`acc.rec.${isCompany ? "co" : "ct"}.${column}` as MessageKey);
  const picked = companyId === null ? null : (data.companies.find((company) => company.id === companyId) ?? null);
  return (
    <Dialog
      shape="sheet"
      name="record"
      icon={isCompany ? "building-2" : "user-round"}
      tone="accent"
      title={adding ? t(isCompany ? "acc.rec.co.new" : "acc.rec.ct.new") : shown(row?.["name"])}
      subtitle={t(adding ? (isCompany ? "acc.rec.co.new.sub" : "acc.rec.ct.new.sub") : isCompany ? "acc.rec.co.edit.sub" : "acc.rec.ct.edit.sub")}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={() => (rec.kind === "contact" && rec.mode === "edit" && onBack !== undefined ? onBack(rec.id) : onClose())}>
            {t(rec.kind === "contact" && rec.mode === "edit" && onBack !== undefined ? "acc.rec.back" : "ui.cancel")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 crm-btn-wide mr-btn" disabled={busy} onClick={() => void save()}>
            <Icon name="check" />
            {busy ? t("ui.saving") : t(adding ? (isCompany ? "acc.rec.co.add" : "acc.rec.ct.add") : "acc.rec.save")}
          </button>
        </>
      }
    >
      <fieldset className="crm-fields" disabled={busy}>
        {texts.map((column, index) => (
          <div key={column} className="crm-acc-rec-field">
            <label className="crm-label" htmlFor={`crm-rec-${column}`}>
              {label(column)}
            </label>
            <input
              id={`crm-rec-${column}`}
              {...(index === 0 ? { "data-autofocus": true } : {})}
              className={`crm-input mr-fld${MONO.has(column) ? " crm-mono" : ""}`}
              value={draft[column] ?? ""}
              maxLength={LENGTHS[column]}
              inputMode={column === "headcount" ? "numeric" : column === "email" ? "email" : column === "phone" ? "tel" : undefined}
              type={column === "email" ? "email" : "text"}
              autoComplete="off"
              {...(column === "country" || column === "region" || column === "postal_code" || column === "website" ? { placeholder: t(column === "country" ? "acc.rec.co.country.hint" : "acc.rec.optional") } : {})}
              onChange={(event) => set(column, event.target.value)}
            />
          </div>
        ))}

        {!isCompany && (
          <>
            <div className="crm-label" id="crm-rec-co">
              {t("acc.rec.ct.company")}
            </div>
            {data.companies.length > CHIPS ? (
              <select className="crm-input mr-fld" aria-labelledby="crm-rec-co" value={companyId ?? ""} onChange={(event) => (setCompanyId(event.target.value === "" ? null : Number(event.target.value)), setError(null))}>
                <option value="">{t("acc.rec.ct.company.pick")}</option>
                {data.companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="crm-choice-grid" role="radiogroup" aria-labelledby="crm-rec-co">
                {data.companies.map((company) => (
                  <button key={company.id} type="button" role="radio" aria-checked={companyId === company.id} className="crm-choice mr-chip" onClick={() => (setCompanyId(company.id), setError(null))}>
                    <span className="crm-dot" data-tone="accent" />
                    <span className="crm-choice-text">{company.name}</span>
                  </button>
                ))}
              </div>
            )}
            {picked !== null && data.companies.length > CHIPS && (
              <p className="crm-field-note">
                <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                  {initials(picked.name)}
                </span>{" "}
                {picked.name}
              </p>
            )}
            <div className="crm-next">
              <button type="button" role="switch" aria-checked={mayEmail} className="crm-switch mr-gi" onClick={() => setMayEmail((was) => !was)}>
                <span className="crm-switch-track">
                  <span className="crm-switch-knob" />
                </span>
                {t("acc.rec.ct.mayEmail")}
              </button>
            </div>
          </>
        )}
      </fieldset>
      {isCompany && (data.kept.includes("address_lines") || data.kept.includes("postal_code")) && <p className="crm-field-note">{t("acc.rec.co.kept")}</p>}
      {error !== null && (
        <div className="crm-form-error" role="alert">
          <Icon name="triangle-alert" size={15} />
          <span>{error}</span>
        </div>
      )}
    </Dialog>
  );
}
