/**
 * THE SAMPLE LIBRARY (ledger screen 45): what is in the cupboard, what is
 * out and with whom, and booking a piece out or back in.
 *
 * WHAT IS OUT IS THE SERVER'S. A sample keeps how many of its pieces are out
 * (its open loans, summed) and how many are on the shelf; a loan that would
 * take a piece the shelf does not have is refused by the server, whoever
 * sends it. The tiles are the server's figures: pieces held, pieces out
 * (the loans' own sum), and the shelf as the one less the other.
 */
import { useCallback, useMemo, useRef, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { initials } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { useScreen } from "../team/data.ts";
import { cameBack, daysLate, lend, readLibrary, type Loan, type Sample } from "./data.ts";

type SampleFilter = "all" | "in" | "out" | "late";
const FILTERS: readonly SampleFilter[] = ["all", "in", "out", "late"];

interface ContactChoice extends Record<string, unknown> {
  id: number;
  name: string;
  company_id: number | null;
  company: string | null;
}

export function Samples(_props: ScreenProps) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useScreen();
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const { load, reload } = useLoad(() => readLibrary(session, now, f), [session, today, f]);
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      reload();
    }, [session, reload]),
  );
  useLive(["samples", "sample_loans"], again);
  const canLend = session.can("sample_loans", "create");
  const canReturn = session.can("sample_loans", "update");
  const [filter, setFilter] = useState<SampleFilter>("all");
  const [lending, setLending] = useState<Sample | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const back = async (loan: Loan): Promise<void> => {
    setBusy(loan.id);
    await toasts.say(cameBack(session, loan, today), () => t("sh.lib.toast.back", { sample: loan.sample ?? "" }));
    setBusy(null);
    again();
  };

  return (
    <div className="crm-screen crm-sh mr-screen" data-screen="samples">
      <div className="crm-screen-head">
        <div>
          <h1>{t("sh.lib.title")}</h1>
          <p className="crm-screen-sub">{t("sh.lib.sub")}</p>
        </div>
        <div className="crm-screen-actions">
          <ScreenLink to="returns" className="crm-btn crm-btn-ghost crm-btn-40 mr-gi">
            <Icon name="phone" />
            {t("nav.item.returns")}
          </ScreenLink>
        </div>
      </div>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={2} height={180} />}>
        {(data) => {
          const loansOf = (sample: Sample): Loan[] => data.loans.filter((loan) => loan.sample_id === sample.id);
          const lateOf = (sample: Sample): boolean => loansOf(sample).some((loan) => daysLate(loan, now, f) > 0);
          const counts: Record<SampleFilter, number> = { all: data.samples.length, in: data.figures.samplesIn, out: data.figures.samplesOut, late: data.figures.late };
          const shown = data.samples.filter((sample) => filter === "all" || (filter === "in" ? Number(sample.out) === 0 : filter === "out" ? Number(sample.out) > 0 : lateOf(sample)));
          return (
            <>
              <div className={`crm-banner crm-sh-banner`} data-tone={data.figures.late > 0 ? "danger" : "plain"} data-testid="sh-lib-line">
                <Icon name={data.figures.late > 0 ? "clock-alert" : "package"} size={16} />
                <span>
                  {t("sh.lib.line", { held: f.number(data.figures.held), out: f.number(data.figures.out), shelf: f.number(data.figures.shelf) })}
                  {data.figures.late > 0 && ` ${t("sh.lib.line.late", { count: f.number(data.figures.late) }, data.figures.late)}`}
                </span>
              </div>

              <div className="crm-chips" role="group" aria-label={t("sh.filter")}>
                {FILTERS.map((one) => (
                  <button key={one} type="button" className="crm-chip-btn mr-chip" aria-pressed={filter === one} data-filter={one} onClick={() => setFilter(one)}>
                    {t(`sh.lib.filter.${one}`)}
                    <span className="crm-chip-count crm-mono">{f.number(counts[one])}</span>
                  </button>
                ))}
              </div>

              <div className="crm-sh-grid">
                {shown.map((sample, i) => {
                  const loans = loansOf(sample);
                  const late = lateOf(sample);
                  const state = loans.length === 0 ? "in" : late ? "late" : "out";
                  return (
                    <article key={sample.id} className="crm-sh-sample mr-card" data-sample={sample.id} data-state={state}>
                      <div className="crm-sh-sample-tile" data-tint={i % 5}>
                        <Icon name="layers" size={26} />
                        <span className="crm-pill" data-tone={state === "in" ? "pos" : state === "late" ? "danger" : "info"}>
                          {t(`sh.lib.state.${state}`)}
                        </span>
                        {sample.kind !== null && <span className="crm-sh-kind crm-mono">{sample.kind}</span>}
                      </div>
                      <h2 className="crm-sh-sample-name">{sample.name}</h2>
                      {loans.map((loan) => {
                        const lateBy = daysLate(loan, now, f);
                        return (
                          <div key={loan.id} className="crm-sh-loan" data-loan={loan.id}>
                            <div className="crm-sh-loan-who">
                              <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                                {initials(loan.contact ?? loan.company ?? "?")}
                              </span>
                              <span>{[loan.company, loan.contact].filter((part) => part !== null).join(" · ")}</span>
                            </div>
                            <div className="crm-sh-loan-due crm-mono" data-late={lateBy > 0 ? "1" : "0"}>
                              {lateBy > 0 ? t("sh.lib.late", { count: f.number(lateBy) }, lateBy) : lateBy === 0 ? t("sh.lib.dueToday") : t("sh.lib.back", { day: f.dayShort(new Date(`${loan.due_back}T12:00:00Z`)) })}
                            </div>
                            {canReturn && (
                              <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="back" disabled={busy === loan.id} onClick={() => void back(loan)}>
                                <Icon name="rotate-ccw" size={13} />
                                {t("sh.lib.act.back")}
                              </button>
                            )}
                          </div>
                        );
                      })}
                      <div className="crm-sh-held crm-mono">{t("sh.lib.held", { held: f.number(Number(sample.held)), shelf: f.number(Number(sample.on_shelf)) })}</div>
                      {canLend && (
                        <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-act="lend" disabled={Number(sample.on_shelf) <= 0} aria-label={t("sh.lib.act.lend.aria", { sample: sample.name })} onClick={() => setLending(sample)}>
                          <Icon name="hand" size={13} />
                          {Number(sample.on_shelf) <= 0 ? t("sh.lib.allOut") : t("sh.lib.act.lend")}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>

              {shown.length === 0 && (
                <div className="crm-empty">
                  <span className="crm-empty-icon">
                    <Icon name="layers" size={21} />
                  </span>
                  <div className="crm-empty-title">{t(data.samples.length === 0 ? "sh.lib.empty.none" : "sh.lib.empty")}</div>
                </div>
              )}

              {lending !== null && <LendPanel sample={lending} loanDays={data.loanDays} today={today} onClose={() => setLending(null)} onDone={() => (setLending(null), again())} />}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

/** "Book it out": who it goes to (a contact, and so their company), back after the settings' loan days. */
function LendPanel({ sample, loanDays, today, onClose, onDone }: { sample: Sample; loanDays: number; today: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useScreen();
  const [find, setFind] = useState("");
  const [contactId, setContactId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newClientKey());
  const typed = find.trim();
  const { load } = useLoad(
    () => session.list<ContactChoice>("contacts", { select: ["id", "name", "company_id"], ...(typed.length >= 2 ? { q: typed } : {}), order: ["name"], lookup: ["company:company_id.name"], limit: 50 }).then((page) => page.rows),
    [session, typed.length >= 2 ? typed : ""],
  );
  const contacts = load.state === "ready" ? load.data : [];
  const chosen = useMemo(() => contacts.find((one) => one.id === contactId) ?? null, [contacts, contactId]);
  const backOn = new Date(`${today}T12:00:00Z`);
  backOn.setUTCDate(backOn.getUTCDate() + loanDays);
  const go = async (): Promise<void> => {
    if (chosen === null || busy) return;
    setBusy(true);
    setError(null);
    const saved = await lend(session, sample, { company_id: chosen.company_id, contact_id: chosen.id }, today, loanDays, key.current);
    setBusy(false);
    if (saved.state === "refused") return setError(t("ui.refused", { reason: saved.error.code === "BALANCE_EXCEEDED" ? t("sh.lib.refused.none") : reasonOf(saved.error, t) }));
    if (saved.state === "unknown") return setError(t("ui.unknown"));
    toasts.show(t("sh.lib.toast.out", { sample: sample.name, to: chosen.company ?? chosen.name, day: f.dayShort(backOn) }), "pos");
    onDone();
  };
  return (
    <section className="crm-sh-lend mr-card" aria-labelledby="crm-sh-lend-title" data-testid="sh-lend">
      <div className="crm-sh-lend-head">
        <h2 id="crm-sh-lend-title">{t("sh.lib.lend.title", { sample: sample.name })}</h2>
        <button type="button" className="crm-icon-btn mr-gi" aria-label={t("ui.close")} disabled={busy} onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <p>{t("sh.lib.lend.sub", { count: f.number(loanDays) }, loanDays)}</p>
      <div className="crm-field-pair">
        <div>
          <label className="crm-label" htmlFor="crm-sh-lend-find">
            {t("sh.book.find")}
          </label>
          <input id="crm-sh-lend-find" autoFocus className="crm-input mr-fld" value={find} placeholder={t("sh.book.find.hint")} onChange={(event) => setFind(event.target.value)} />
        </div>
        <div>
          <label className="crm-label" htmlFor="crm-sh-lend-to">
            {t("sh.lib.lend.to")}
          </label>
          <select id="crm-sh-lend-to" className="crm-input mr-fld" value={contactId ?? ""} onChange={(event) => (setContactId(event.target.value === "" ? null : Number(event.target.value)), setError(null))}>
            <option value="">{t("sh.book.visitor.pick")}</option>
            {contacts.map((one) => (
              <option key={one.id} value={one.id}>
                {one.company === null ? one.name : `${one.name} · ${one.company}`}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error !== null && (
        <div className="crm-form-error" role="alert">
          <Icon name="triangle-alert" size={15} />
          <span>{error}</span>
        </div>
      )}
      <div className="crm-sh-actions">
        <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" data-go disabled={chosen === null || busy} onClick={() => void go()}>
          <Icon name="hand" size={14} />
          {busy ? t("ui.saving") : t("sh.lib.lend.go")}
        </button>
      </div>
    </section>
  );
}
