/**
 * The customer's quote page: what a customer with no account sees behind the
 * link in the quote's e-mail.
 *
 * One page and no menu. It shows the quote the link opens (its lines, tax and
 * total, its last day) and takes one answer: Accept, with the name of whoever
 * accepts, or Decline. Every figure is the server's; the page adds up nothing.
 * Whether an answer is still taken is the server's too: after the last day it
 * refuses, and the page says the quote ran out.
 */
import { CalendarX, Check, CheckCheck, CircleSlash, Layers } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { appName } from "../i18n/ambient.ts";
import { useI18n } from "../i18n/index.tsx";
import { noonOf } from "../lib/format.ts";
import { quoteFormatters, ranOut, type Answered, type CustomerLine, type CustomerQuote, type Opened, type QuoteLink } from "./data.ts";

function Frame({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <main className="crm-q">
      <div className="crm-q-brand">
        <span className="crm-q-mark" aria-hidden="true">
          <Layers size={17} />
        </span>
        <span className="crm-q-name">{appName() ?? t("customer.brand")}</span>
      </div>
      {children}
    </main>
  );
}

function Plain({ heading, body, again }: { heading: string; body: string; again?: () => void }) {
  const { t } = useI18n();
  return (
    <Frame>
      <section className="crm-q-card crm-q-plain">
        <h1>{heading}</h1>
        <p>{body}</p>
        {again === undefined ? null : (
          <button type="button" className="crm-q-btn" onClick={again}>
            {t("base.tryAgain")}
          </button>
        )}
      </section>
    </Frame>
  );
}

export function QuotePage({ link }: { link: QuoteLink }) {
  const { t } = useI18n();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [turn, setTurn] = useState(0);

  useEffect(() => {
    let live = true;
    setOpened(null);
    void link.open().then((result) => {
      if (live) setOpened(result);
    });
    return () => {
      live = false;
    };
  }, [link, turn]);

  if (opened === null) {
    return (
      <Frame>
        <section className="crm-q-card crm-q-plain" aria-busy="true">
          <p role="status">{t("customer.opening")}</p>
        </section>
      </Frame>
    );
  }
  if (opened.state === "open") {
    return <Quote link={link} quote={opened.quote} lines={opened.lines} timeZone={opened.timeZone} today={opened.today} onQuote={(quote) => setOpened({ ...opened, quote })} reread={() => setTurn((n) => n + 1)} />;
  }
  if (opened.state === "gone") return <Plain heading={t("customer.gone.heading")} body={t("customer.gone.body")} />;
  if (opened.state === "closed") return <Plain heading={t("customer.closed.heading")} body={t("customer.missing.body")} />;
  if (opened.state === "off") return <Plain heading={t("customer.missing.heading")} body={t("customer.missing.body")} />;
  if (opened.state === "unreachable") return <Plain heading={t("customer.unreachable.heading")} body={t("customer.unreachable.body")} again={() => setTurn((n) => n + 1)} />;
  return <Plain heading={t("customer.missing.heading")} body={t("customer.missing.body")} />;
}

function Quote({ link, quote, lines, timeZone, today, onQuote, reread }: { link: QuoteLink; quote: CustomerQuote; lines: CustomerLine[]; timeZone: string | null; today: string; onQuote: (quote: CustomerQuote) => void; reread: () => void }) {
  const { t, locale } = useI18n();
  const f = useMemo(() => quoteFormatters(locale, quote, timeZone), [locale, quote, timeZone]);
  const day = (key: string | null): string => (key === null ? "" : f.date(noonOf(key)));
  const late = ranOut(quote, today);
  const hasTax = quote.tax > 0 || quote.taxRate > 0;

  return (
    <Frame>
      <article className="crm-q-card" aria-labelledby="crm-q-number">
        <header className="crm-q-head">
          <div>
            <div className="crm-q-eyebrow">{t("customer.quotation")}</div>
            <h1 id="crm-q-number" className="crm-q-number">
              {quote.number}
            </h1>
            {quote.sentAt === null ? null : <div className="crm-q-sent">{t("customer.sent", { day: f.date(quote.sentAt) })}</div>}
          </div>
          {quote.validUntil === null ? null : (
            <div className="crm-q-end">
              <div className="crm-q-eyebrow">{t("customer.validUntil")}</div>
              <div className="crm-q-valid">{day(quote.validUntil)}</div>
            </div>
          )}
        </header>

        <div className="crm-q-lines">
          <table>
            <thead>
              <tr>
                <th scope="col">{t("customer.col.item")}</th>
                <th scope="col" className="crm-q-numcol crm-q-wide">
                  {t("customer.col.qty")}
                </th>
                <th scope="col" className="crm-q-numcol crm-q-wide">
                  {t("customer.col.unit")}
                </th>
                <th scope="col" className="crm-q-numcol">
                  {t("customer.col.total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <th scope="row">
                    <span className="crm-q-desc">{line.description}</span>
                    <span className="crm-q-sub">
                      <bdi>{f.number(line.qty)}</bdi> × <bdi>{f.money(line.rate)}</bdi>
                    </span>
                  </th>
                  <td className="crm-q-numcol crm-q-wide">{f.number(line.qty)}</td>
                  <td className="crm-q-numcol crm-q-wide">{f.money(line.rate)}</td>
                  <td className="crm-q-numcol crm-q-amount">{f.money(line.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="crm-q-sums">
            {hasTax ? (
              <>
                <div>
                  <dt>{t("customer.subtotal")}</dt>
                  <dd>{f.money(quote.subtotal)}</dd>
                </div>
                <div>
                  <dt>{quote.taxName === null ? t("customer.tax", { rate: f.number(quote.taxRate) }) : t("customer.tax.named", { name: quote.taxName, rate: f.number(quote.taxRate) })}</dt>
                  <dd>{f.money(quote.tax)}</dd>
                </div>
              </>
            ) : null}
            <div className="crm-q-total">
              <dt>{t("customer.total")}</dt>
              <dd data-testid="quote-total">{f.money(quote.total)}</dd>
            </div>
          </dl>
          {quote.notes.trim() === "" ? null : <p className="crm-q-notes">{quote.notes}</p>}
        </div>

        <footer className="crm-q-foot">
          {quote.status === "accepted" ? (
            <p role="status" className="crm-q-state" data-tone="pos">
              <CheckCheck size={18} aria-hidden="true" />
              <span>
                {quote.decidedAt === null
                  ? t("customer.accepted.plain")
                  : quote.acceptedName === null
                    ? t("customer.accepted.staff", { day: f.date(quote.decidedAt), time: f.time(quote.decidedAt) })
                    : t("customer.accepted", { day: f.date(quote.decidedAt), time: f.time(quote.decidedAt), name: quote.acceptedName })}
              </span>
            </p>
          ) : quote.status === "declined" ? (
            <p role="status" className="crm-q-state" data-tone="plain">
              <CircleSlash size={18} aria-hidden="true" />
              <span>{quote.decidedAt === null ? t("customer.declined.plain") : t("customer.declined", { day: f.date(quote.decidedAt) })}</span>
            </p>
          ) : late ? (
            <p role="status" className="crm-q-state" data-tone="warn">
              <CalendarX size={18} aria-hidden="true" />
              <span>{t("customer.ranOut", { day: day(quote.validUntil) })}</span>
            </p>
          ) : (
            <Answer link={link} quote={quote} until={day(quote.validUntil)} onQuote={onQuote} reread={reread} />
          )}
        </footer>
      </article>
    </Frame>
  );
}

function Answer({ link, quote, until, onQuote, reread }: { link: QuoteLink; quote: CustomerQuote; until: string; onQuote: (quote: CustomerQuote) => void; reread: () => void }) {
  const { t } = useI18n();
  const nameId = useId();
  const errorId = useId();
  const [step, setStep] = useState<"ask" | "accept" | "decline">("ask");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (step === "accept") field.current?.focus();
    if (step === "decline") confirm.current?.focus();
  }, [step]);

  const said = (result: Answered): void => {
    setBusy(false);
    if (result.ok) {
      onQuote(result.quote);
      return;
    }
    if (result.why === "name") {
      setProblem(t("customer.name.refused"));
      field.current?.focus();
      return;
    }
    if (result.why === "unreachable") {
      setProblem(t("customer.answer.unreachable"));
      return;
    }
    // Its last day passed, or it was answered or replaced meanwhile: the page as the server now has it says which.
    reread();
  };

  const accept = (event: FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    if (name.trim() === "") {
      setProblem(t("customer.name.needed"));
      field.current?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    void link.answer(quote, "accepted", name).then(said);
  };
  const decline = (): void => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    void link.answer(quote, "declined").then(said);
  };
  const back = (): void => {
    setStep("ask");
    setProblem(null);
  };

  if (step === "accept") {
    return (
      <form className="crm-q-answer" onSubmit={accept} noValidate>
        <label className="crm-q-label" htmlFor={nameId}>
          {t("customer.name.label")}
        </label>
        <input
          ref={field}
          id={nameId}
          className="crm-q-input"
          value={name}
          maxLength={120}
          autoComplete="name"
          aria-invalid={problem !== null}
          aria-describedby={problem === null ? undefined : errorId}
          onChange={(event) => {
            setName(event.currentTarget.value);
            setProblem(null);
          }}
        />
        <p className="crm-q-hint">{t("customer.name.hint", { number: quote.number })}</p>
        {problem === null ? null : (
          <p id={errorId} role="alert" className="crm-q-problem">
            {problem}
          </p>
        )}
        <div className="crm-q-actions">
          <button type="button" className="crm-q-btn" onClick={back} disabled={busy}>
            {t("customer.back")}
          </button>
          <button type="submit" className="crm-q-btn" data-tone="accent" disabled={busy} aria-busy={busy}>
            <Check size={15} aria-hidden="true" />
            {busy ? t("customer.sending") : t("customer.accept.confirm")}
          </button>
        </div>
      </form>
    );
  }
  if (step === "decline") {
    return (
      <div className="crm-q-answer" role="group" aria-label={t("customer.decline")}>
        <p className="crm-q-ask">{t("customer.decline.ask", { number: quote.number })}</p>
        {problem === null ? null : (
          <p role="alert" className="crm-q-problem">
            {problem}
          </p>
        )}
        <div className="crm-q-actions">
          <button type="button" className="crm-q-btn" onClick={back} disabled={busy}>
            {t("customer.back")}
          </button>
          <button ref={confirm} type="button" className="crm-q-btn" data-tone="danger" onClick={decline} disabled={busy} aria-busy={busy}>
            {busy ? t("customer.sending") : t("customer.decline.confirm")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="crm-q-open">
      <p className="crm-q-left">{until === "" ? t("customer.open.noDay") : t("customer.open", { day: until })}</p>
      <div className="crm-q-actions">
        <button type="button" className="crm-q-btn" onClick={() => setStep("decline")}>
          {t("customer.decline")}
        </button>
        <button type="button" className="crm-q-btn" data-tone="accent" onClick={() => setStep("accept")}>
          <Check size={15} aria-hidden="true" />
          {t("customer.accept")}
        </button>
      </div>
    </div>
  );
}
