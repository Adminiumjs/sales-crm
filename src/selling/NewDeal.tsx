/**
 * START A DEAL: enough to work it, the rest can wait. A name, a company, a
 * rough amount, the stage it starts at, and (for a manager) whose it is.
 * A first step can be lined up with it, which lands on that person's Today
 * queue in two days at ten.
 *
 * WHAT IS SAVED. The deal first, then the first step as a follow-up on it.
 * Each save carries a key made when the sheet opened: a reply that never
 * arrives is sent again with the same key, and the server answers the row
 * the first try made. So a dropped connection makes one deal, not two. If
 * the deal is saved and the step is not, the sheet says exactly that.
 *
 * The amount is read the way the person's language writes a number, and
 * shown back in the install's currency before it is saved.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../i18n/index.tsx";
import { addDays, formatters } from "../lib/format.ts";
import { useSession } from "../session/session.tsx";
import { Icon } from "../shell/icons.tsx";
import { newClientKey, type StaffSession } from "../staffSession.ts";
import { Dialog } from "../ui/dialog.tsx";
import { useLoad } from "../ui/load.tsx";
import { firstName, initials } from "../ui/people.ts";
import { reasonOf, useToasts } from "../ui/toast.tsx";

/** How far ahead a new deal is expected to close until the person says otherwise, and when its first step falls due. */
const CLOSE_IN_DAYS = 60;
const FIRST_STEP_IN_DAYS = 2;
const FIRST_STEP_AT = "10:00";
/** The companies offered before the person types: the design draws them all, which holds for nine and not for nine thousand. */
const COMPANIES_SHOWN = 12;

interface Stage extends Record<string, unknown> {
  id: number;
  label: string;
  odds: number | string;
}
interface Company extends Record<string, unknown> {
  id: number;
  name: string;
}
interface Owner {
  id: string;
  name: string;
}

export interface NewDealStart {
  companyId?: number;
  name?: string;
  amount?: string;
  firstStep?: string;
  /** A company that is not on the books yet (an enquiry's, a trade-show lead's): made with the deal, with the person who asked as its first contact. */
  newCompany?: { name: string; person?: string | null; email?: string | null; phone?: string | null; town?: string | null };
  /** The enquiry the deal comes from. It is claimed first (from the state the screen saw), and told its deal and its company last. */
  enquiry?: { id: number; state: string };
}

async function readChoices(session: StaffSession): Promise<{ stages: Stage[]; owners: Owner[] }> {
  const me = session.config.user;
  const [stages, reps, people] = await Promise.all([
    session.list<Stage>("stages", { select: ["id", "label", "odds"], order: ["position"], limit: 50 }),
    // Whose a deal can be: the people with a rep's profile. Somebody who may not read the profiles makes a deal of her own.
    session.can("reps", "read") ? session.list<{ user_id: string }>("reps", { select: ["user_id"], limit: 200 }).then((page) => page.rows.map((row) => row.user_id)) : Promise.resolve([] as string[]),
    session.people(undefined, 200).catch(() => []),
  ]);
  const names = new Map(people.map((person) => [person.id, person.name]));
  const owners = reps.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! }));
  if (me !== null && !owners.some((owner) => owner.id === me.id)) owners.unshift({ id: me.id, name: me.name });
  return { stages: stages.rows, owners };
}

export function NewDeal({ start, onClose, onSaved }: { start: NewDealStart; onClose: () => void; onSaved: (dealId: number) => void }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const today = useMemo(() => f.dayKey(session.now()), [f, session]);
  const me = config.user;

  const [name, setName] = useState(start.name ?? "");
  const [companyId, setCompanyId] = useState<number | null>(start.companyId ?? null);
  // "A new company from here": offered when the sheet was opened with one and the person may make companies; chosen to begin with when nothing on the books matched.
  const offersNew = start.newCompany !== undefined && session.can("companies", "create");
  const [makeNew, setMakeNew] = useState(offersNew && start.companyId === undefined);
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState(start.amount ?? "");
  const [close, setClose] = useState(() => addDays(today, CLOSE_IN_DAYS));
  const [stageId, setStageId] = useState<number | null>(null);
  const [ownerId, setOwnerId] = useState<string>(me?.id ?? "");
  const [next, setNext] = useState(true);
  const [nextText, setNextText] = useState(start.firstStep ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per save, kept for as long as the sheet is open: a second press sends the same save again.
  const keys = useRef({ deal: newClientKey(), step: newClientKey() });
  // The deal, once it is in: a press after "the step was not saved" saves the step only.
  const saved = useRef<number | null>(null);
  // What is already in of the saves around the deal, so a second press goes on from where the first stopped.
  const around = useRef<{ claimed: boolean; companyId: number | null; contactId: number | null; told: boolean; keys: { company: string; contact: string } }>({ claimed: false, companyId: null, contactId: null, told: false, keys: { company: newClientKey(), contact: newClientKey() } });

  const { load: choices } = useLoad(() => readChoices(session), [session]);
  const stages = choices.state === "ready" ? choices.data.stages : [];
  const owners = choices.state === "ready" ? choices.data.owners : [];
  const stage = stages.find((one) => one.id === stageId) ?? stages[0] ?? null;
  // A manager says whose it is; a rep's deal is her own (the server holds her to that either way).
  const picksOwner = owners.length > 1 && session.can("reps", "read") && ((config.access?.roles ?? []).length === 0 || (config.access?.roles ?? []).some((role) => role.slug !== "crm-rep"));

  const [asked, setAsked] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setAsked(search.trim()), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const { load: found } = useLoad(
    async () => {
      const page = await session.list<Company>("companies", { select: ["id", "name"], order: ["name"], limit: COMPANIES_SHOWN, count: "exact", ...(asked === "" ? {} : { q: asked }) });
      // The company the sheet was opened for is offered whatever the list holds.
      if (companyId !== null && !page.rows.some((row) => row.id === companyId)) {
        const picked = await session.get<Company>("companies", companyId);
        if (picked !== null) page.rows.unshift(picked);
      }
      return page;
    },
    [session, asked],
  );
  const companies = found.state === "ready" ? found.data.rows : [];
  const more = found.state === "ready" && (found.data.total ?? 0) > COMPANIES_SHOWN;

  const read = f.readAmount(amount);
  const stepAt = f.at(addDays(today, FIRST_STEP_IN_DAYS), FIRST_STEP_AT);

  const save = async (): Promise<void> => {
    const title = name.trim();
    if (title === "") return setError(t("deal.new.error.name"));
    if (companyId === null && !makeNew) return setError(t("deal.new.error.company"));
    if (read === null) return setError(t("deal.new.error.amount"));
    if (stage === null) return setError(t("deal.new.error.stage"));
    setError(null);
    setBusy(true);
    const step = next ? nextText.trim() : "";
    let dealId = saved.current;
    const owner = picksOwner ? ownerId : (me?.id ?? ownerId);
    const stop = (text: string): void => {
      setBusy(false);
      setError(text);
    };
    // The enquiry first: if a colleague claimed it a moment ago the server says so here, before anything is made.
    if (start.enquiry !== undefined && start.enquiry.state !== "claimed" && !around.current.claimed) {
      const claimed = await session.act("enquiries", start.enquiry.id, "claim", start.enquiry.state);
      if (claimed.state !== "saved") return stop(claimed.state === "refused" ? t("deal.new.error.claim", { reason: reasonOf(claimed.error, t) }) : t("ui.unknown"));
      around.current.claimed = true;
    }
    let company = companyId;
    let contact: number | null = null;
    if (makeNew && start.newCompany !== undefined) {
      if (around.current.companyId === null) {
        const made = await session.create<{ id: number }>("companies", { name: start.newCompany.name.trim(), town: start.newCompany.town ?? null, account_owner_id: owner }, around.current.keys.company);
        if (made.state !== "saved") return stop(made.state === "refused" ? t("deal.new.error.newCompany", { reason: reasonOf(made.error, t) }) : t("ui.unknown"));
        around.current.companyId = made.row.id;
      }
      company = around.current.companyId;
      const person = (start.newCompany.person ?? "").trim();
      if (person !== "" && around.current.contactId === null && session.can("contacts", "create")) {
        // Whether she may be sent marketing mail was never asked: it stays "no" until somebody asks her.
        const made = await session.create<{ id: number }>("contacts", { company_id: company, name: person, email: start.newCompany.email ?? null, phone: start.newCompany.phone ?? null, may_email: false }, around.current.keys.contact);
        if (made.state !== "saved") return stop(made.state === "refused" ? t("deal.new.error.newContact", { reason: reasonOf(made.error, t) }) : t("ui.unknown"));
        around.current.contactId = made.row.id;
      }
      contact = around.current.contactId;
    }
    if (dealId === null) {
      const made = await session.create<{ id: number }>("deals", { name: title, company_id: company, ...(contact === null ? {} : { contact_id: contact }), owner_id: picksOwner ? ownerId : (me?.id ?? ownerId), stage_id: stage.id, expected_close: close === "" ? null : close, typed_amount: read }, keys.current.deal);
      if (made.state !== "saved") {
        setBusy(false);
        setError(made.state === "refused" ? t("ui.refused", { reason: reasonOf(made.error, t) }) : t("ui.unknown"));
        return;
      }
      dealId = made.row.id;
      saved.current = dealId;
    }
    if (step !== "") {
      const lined = await session.create("follow_ups", { deal_id: dealId, owner_id: picksOwner ? ownerId : (me?.id ?? ownerId), due_at: stepAt.toISOString(), text: step, kind: "step" }, keys.current.step);
      if (lined.state !== "saved") {
        setBusy(false);
        // The deal is in. Say so, and what is not: pressing again saves the step alone.
        setError(t("deal.new.error.step", { reason: lined.state === "refused" ? reasonOf(lined.error, t) : t("deal.new.error.step.unknown") }));
        onSaved(dealId);
        return;
      }
    }
    if (start.enquiry !== undefined && !around.current.told) {
      // The enquiry is told its deal and its company. If this one save fails the deal is still there, and the enquiry is hers: say so.
      const told = await session.update("enquiries", start.enquiry.id, { deal_id: dealId, company_id: company });
      if (told.state !== "saved") {
        onSaved(dealId);
        // Only whoever claimed an enquiry ties it to a deal, while it is claimed (plan 68 X6): the server's refusal names the column.
        const unclaimed = told.state === "refused" && told.error.status === 403 && (told.error.details["column"] === "deal_id" || told.error.fields["deal_id"] !== undefined);
        return stop(t("deal.new.error.tell", { reason: told.state === "refused" ? (unclaimed ? t("guards.enquiry.claimFirst") : reasonOf(told.error, t)) : t("deal.new.error.step.unknown") }));
      }
      around.current.told = true;
    }
    setBusy(false);
    toasts.show(t("deal.new.toast", { deal: title, stage: stage.label, amount: f.money(read) }), "pos");
    onSaved(dealId);
    onClose();
  };

  const stepOnly = saved.current !== null;
  return (
    <Dialog
      shape="sheet"
      name="new-deal"
      icon="plus"
      tone="accent"
      title={t("deal.new.title")}
      subtitle={t("deal.new.sub")}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t(stepOnly ? "ui.close" : "ui.cancel")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 crm-btn-wide mr-btn" disabled={busy || choices.state !== "ready"} onClick={() => void save()}>
            <Icon name="check" />
            {busy ? t("ui.saving") : t(stepOnly ? "deal.new.saveStep" : "deal.new.save")}
          </button>
        </>
      }
    >
      <fieldset className="crm-fields" disabled={busy || stepOnly}>
        <label className="crm-label" htmlFor="crm-nd-name">
          {t("deal.new.name")}
        </label>
        <input id="crm-nd-name" data-autofocus className="crm-input mr-fld" value={name} maxLength={120} placeholder={t("deal.new.name.hint")} onChange={(event) => (setName(event.target.value), setError(null))} />

        <div className="crm-label" id="crm-nd-co">
          {t("deal.new.company")}
        </div>
        {(more || search !== "") && <input className="crm-input crm-input-sm mr-fld" type="search" value={search} aria-label={t("deal.new.company.search")} placeholder={t("deal.new.company.search")} onChange={(event) => setSearch(event.target.value)} />}
        <div className="crm-choice-grid" role="radiogroup" aria-labelledby="crm-nd-co">
          {offersNew && (
            <button type="button" role="radio" aria-checked={makeNew} className="crm-choice mr-chip" data-new-company onClick={() => (setMakeNew(true), setCompanyId(null), setError(null))}>
              <Icon name="plus" size={14} />
              <span className="crm-choice-text">{t("deal.new.company.new", { company: start.newCompany!.name })}</span>
            </button>
          )}
          {companies.map((company) => (
            <button key={company.id} type="button" role="radio" aria-checked={!makeNew && companyId === company.id} className="crm-choice mr-chip" onClick={() => (setCompanyId(company.id), setMakeNew(false), setError(null))}>
              <span className="crm-dot" data-tone="accent" />
              <span className="crm-choice-text">{company.name}</span>
            </button>
          ))}
        </div>
        {found.state === "ready" && companies.length === 0 && !offersNew && <p className="crm-field-note">{t("deal.new.company.none")}</p>}
        {makeNew && start.newCompany !== undefined && (
          <p className="crm-field-note" data-testid="new-company-note">
            {(start.newCompany.person ?? "").trim() !== "" && session.can("contacts", "create") ? t("deal.new.company.new.note", { company: start.newCompany.name, person: (start.newCompany.person ?? "").trim() }) : t("deal.new.company.new.noteAlone", { company: start.newCompany.name })}
          </p>
        )}
        {more && <p className="crm-field-note">{t("deal.new.company.more")}</p>}

        <div className="crm-field-pair">
          <div>
            <label className="crm-label" htmlFor="crm-nd-amount">
              {t("deal.new.amount")}
            </label>
            <input id="crm-nd-amount" className="crm-input crm-mono mr-fld" inputMode="decimal" aria-describedby="crm-nd-amount-read" value={amount} placeholder={new Intl.NumberFormat(locale).format(18000)} onChange={(event) => (setAmount(event.target.value), setError(null))} />
            <div id="crm-nd-amount-read" className="crm-field-note crm-mono">
              {read !== null ? t("deal.new.amount.read", { amount: f.money(read) }) : config.currency === null ? t("deal.new.amount.plain") : t("deal.new.amount.example", { currency: config.currency, amount: f.money(18000) })}
            </div>
          </div>
          <div>
            <label className="crm-label" htmlFor="crm-nd-close">
              {t("deal.new.close")}
            </label>
            <input id="crm-nd-close" className="crm-input crm-mono mr-fld" type="date" value={close} onChange={(event) => setClose(event.target.value)} />
          </div>
        </div>

        <div className="crm-label" id="crm-nd-stage">
          {t("deal.new.stage")}
        </div>
        <div className="crm-choice-row" role="radiogroup" aria-labelledby="crm-nd-stage">
          {stages.map((one) => (
            <button key={one.id} type="button" role="radio" aria-checked={stage?.id === one.id} className="crm-choice crm-choice-solid mr-chip" onClick={() => setStageId(one.id)}>
              {one.label}
              <span className="crm-choice-odds crm-mono">{f.percent(Number(one.odds))}</span>
            </button>
          ))}
        </div>
        <p className="crm-field-note">{read !== null && stage !== null ? t("deal.new.weighted", { amount: f.money(read * Number(stage.odds)) }) : t("deal.new.weighted.none")}</p>

        {picksOwner && (
          <>
            <div className="crm-label" id="crm-nd-owner">
              {t("deal.new.owner")}
            </div>
            <div className="crm-choice-row" role="radiogroup" aria-labelledby="crm-nd-owner">
              {owners.map((owner) => (
                <button key={owner.id} type="button" role="radio" aria-checked={ownerId === owner.id} className="crm-choice mr-chip" onClick={() => setOwnerId(owner.id)}>
                  <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                    {initials(owner.name)}
                  </span>
                  {firstName(owner.name)}
                </button>
              ))}
            </div>
          </>
        )}
      </fieldset>

      <div className="crm-next">
        <button type="button" role="switch" aria-checked={next} className="crm-switch mr-gi" disabled={busy} onClick={() => setNext((was) => !was)}>
          <span className="crm-switch-track">
            <span className="crm-switch-knob" />
          </span>
          {t("deal.new.next")}
        </button>
        {next && (
          <>
            <input className="crm-input crm-input-plain mr-fld" value={nextText} maxLength={400} disabled={busy} aria-label={t("deal.new.next")} placeholder={t("deal.new.next.hint")} onChange={(event) => setNextText(event.target.value)} />
            <div className="crm-next-when">
              <Icon name="clock" size={14} />
              <span>{t("deal.new.next.when")}</span>
              <span className="crm-mono">
                {f.dayShort(stepAt)}, {f.time(stepAt)}
              </span>
            </div>
          </>
        )}
      </div>

      {error !== null && (
        <div className="crm-form-error" role="alert">
          <Icon name="triangle-alert" size={15} />
          <span>{error}</span>
        </div>
      )}
    </Dialog>
  );
}
