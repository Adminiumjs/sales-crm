/**
 * The customer's quote page: what a customer with no account sees behind the
 * link in the quote's e-mail.
 *
 * One page and no menu. It shows the quote the link opens (its lines, tax and
 * total, its last day) and takes one answer: Accept, with the name of whoever
 * accepts, or Decline. Every figure is the server's; the page adds up nothing.
 * Whether an answer is still taken is the server's too: after the last day it
 * refuses, and the page says the quote ran out.
 *
 * Once accepted, a quote may ask for a deposit or the whole amount. The page
 * offers "Pay now" only while the business takes payments online, and hands
 * the customer to Adminium's pay page; they pay there, on the Stripe or PayPal
 * page, and come back here. What was paid is read again from the server, and
 * how the payment stands is Adminium's word: paid, the bank still confirming
 * it (then the page says not to pay again), didn't finish, or the time on
 * that page ran out (then "Pay now" is offered again).
 */
import { CalendarClock, CalendarX, Check, CheckCheck, CircleAlert, CircleCheck, CircleSlash, FlaskConical, Landmark, Layers, LoaderCircle, Lock, RotateCcw } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { appName } from "../i18n/ambient.ts";
import { useI18n } from "../i18n/index.tsx";
import { noonOf, type Formatters } from "../lib/format.ts";
import { afterPaying, payable, quoteFormatters, ranOut, type Answered, type CustomerLine, type CustomerQuote, type Opened, type PayOffer, type QuoteLink } from "./data.ts";

/** How the page came to be open: by its link, or back from the pay page (`leave` sends the customer there). */
export interface Paying {
  /** Back from the pay page: the payment is looked for before anything else is said. */
  returning: boolean;
  /** Go to the pay page, remembering in this tab which quote to come back to. */
  leave: (payUrl: string) => void;
}
const STAYING: Paying = { returning: false, leave: (payUrl) => window.location.assign(payUrl) };

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

export function QuotePage({ link, paying = STAYING }: { link: QuoteLink; paying?: Paying }) {
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
    return <Quote link={link} paying={paying} quote={opened.quote} lines={opened.lines} timeZone={opened.timeZone} today={opened.today} onQuote={(quote) => setOpened({ ...opened, quote })} reread={() => setTurn((n) => n + 1)} />;
  }
  if (opened.state === "gone") return <Plain heading={t("customer.gone.heading")} body={t("customer.gone.body")} />;
  if (opened.state === "closed") return <Plain heading={t("customer.closed.heading")} body={t("customer.missing.body")} />;
  if (opened.state === "off") return <Plain heading={t("customer.missing.heading")} body={t("customer.missing.body")} />;
  if (opened.state === "unreachable") return <Plain heading={t("customer.unreachable.heading")} body={t("customer.unreachable.body")} again={() => setTurn((n) => n + 1)} />;
  return <Plain heading={t("customer.missing.heading")} body={t("customer.missing.body")} />;
}

function Quote({ link, paying, quote, lines, timeZone, today, onQuote, reread }: { link: QuoteLink; paying: Paying; quote: CustomerQuote; lines: CustomerLine[]; timeZone: string | null; today: string; onQuote: (quote: CustomerQuote) => void; reread: () => void }) {
  const { t, locale } = useI18n();
  const f = useMemo(() => quoteFormatters(locale, quote, timeZone), [locale, quote, timeZone]);
  const day = (key: string | null): string => (key === null ? "" : f.date(noonOf(key)));
  const late = ranOut(quote, today);
  const hasTax = quote.tax > 0 || quote.taxRate > 0;
  // Accepted on this page, a moment ago: the thanks and what to pay take the place of the accepted line.
  const [justAccepted, setJustAccepted] = useState(false);
  // Whether the business takes payments online right now: asked once the quote is accepted, and never assumed.
  const [offer, setOffer] = useState<PayOffer | null>(null);
  const accepted = quote.status === "accepted";
  useEffect(() => {
    if (!accepted) return;
    let live = true;
    void link.offer().then((said) => {
      if (live) setOffer(said);
    });
    return () => {
      live = false;
    };
  }, [link, accepted]);

  return (
    <Frame>
      {offer?.test === true && accepted ? (
        <p className="crm-q-test" role="note" data-testid="pay-test">
          <FlaskConical size={16} aria-hidden="true" />
          <span>{t("customer.pay.test")}</span>
        </p>
      ) : null}
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
            <Accepted link={link} paying={paying} quote={quote} offer={offer} f={f} today={today} justAccepted={justAccepted} onQuote={onQuote} />
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
            <Answer
              link={link}
              quote={quote}
              until={day(quote.validUntil)}
              onQuote={(next) => {
                if (next.status === "accepted") setJustAccepted(true);
                onQuote(next);
              }}
              reread={reread}
            />
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

/** The line a quote accepted says, as it always has. */
function AcceptedLine({ quote, f }: { quote: CustomerQuote; f: Formatters }) {
  const { t } = useI18n();
  return (
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
  );
}

/** How long the page looks for a payment after the customer comes back from the pay page, and how often. */
export const LOOK_FOR_PAYMENT_MS = 12_000;
const LOOK_EVERY_MS = 2_000;

/** What the page says of a payment that is not paid yet, as Adminium has it: nothing, the bank confirming it, didn't finish, or ran out. */
type Said = "nothing" | "confirming" | "failed" | "expired";

/**
 * An accepted quote's foot: the accepted line, and, while the business takes
 * payments online and the quote asks for some, what to pay and "Pay now".
 * With payments off it is the accepted line alone, as it always was.
 */
function Accepted({ link, paying, quote, offer, f, today, justAccepted, onQuote }: { link: QuoteLink; paying: Paying; quote: CustomerQuote; offer: PayOffer | null; f: Formatters; today: string; justAccepted: boolean; onQuote: (quote: CustomerQuote) => void }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<"idle" | "taking" | "checking" | "failed">(paying.returning ? "checking" : "idle");
  // Back from the pay page and found paid on this visit: the paid line alone, as the moment it happened.
  const [paidNow, setPaidNow] = useState(false);
  // Adminium said the money arrived, and the quote did not say so yet when the page stopped looking.
  const [paidSaid, setPaidSaid] = useState(false);
  const [said, setSaid] = useState<Said>("nothing");
  const pay = useRef<HTMLButtonElement>(null);
  const settled = quote.payAsk !== "off" && quote.payPaid > 0 && quote.payDue <= 0;
  const offered = payable(quote, offer);

  // Back from the pay page: ask how the payment stands, and look again while the service has not said, or the quote does not say it yet.
  useEffect(() => {
    if (phase !== "checking") return;
    let live = true;
    const started = Date.now();
    let arrived = false;
    const look = (): void => {
      void Promise.all([link.payState(quote), link.refresh()]).then(([state, now]) => {
        if (!live) return;
        if (now.state === "open") onQuote(now.quote);
        if (now.state !== "open") {
          setPhase("idle");
          return;
        }
        const next = afterPaying(state, now.quote);
        if (state === "paid") arrived = true;
        if (next === "paid") {
          setPaidNow(true);
          setPhase("idle");
          return;
        }
        if (next === "confirming" || next === "failed" || next === "expired") {
          setSaid(next);
          setPhase("idle");
          return;
        }
        if (next === "ask" || Date.now() - started >= LOOK_FOR_PAYMENT_MS) {
          // The money arrived and is not on the quote yet: say it is paid, and offer nothing to pay.
          if (arrived) setPaidSaid(true);
          setPhase("idle");
          return;
        }
        timer = window.setTimeout(look, LOOK_EVERY_MS);
      });
    };
    let timer = window.setTimeout(look, 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // Looked for once per return; the quote's own updates come through `onQuote`.
  }, [phase]);

  // Opened again while something is still to pay: a payment the bank is still confirming must not be paid twice.
  useEffect(() => {
    if (paying.returning || !offered) return;
    let live = true;
    void link.payState(quote).then((state) => {
      if (live && state === "confirming") setSaid("confirming");
    });
    return () => {
      live = false;
    };
    // Asked once the page knows payments are offered.
  }, [offered]);

  const start = (): void => {
    if (phase === "taking") return;
    setPhase("taking");
    setSaid("nothing");
    void link.pay(quote).then((started) => {
      if (started.state === "go") {
        paying.leave(started.payUrl);
        return;
      }
      if (started.state === "unreachable") {
        setPhase("failed");
        pay.current?.focus();
        return;
      }
      // Paid meanwhile, or no longer payable: the quote as the server has it now.
      void link.refresh().then((now) => {
        if (now.state === "open") onQuote(now.quote);
        setPhase("idle");
      });
    });
  };

  const resting = phase === "idle" || phase === "failed";
  const confirming = offered && said === "confirming" && resting && !settled;
  const showPaidSaid = paidSaid && !settled && resting;
  const asking = offered && resting && !confirming && !showPaidSaid;
  const deposit = quote.payAsk === "deposit";
  const paidLine = (amount: number, at: Date | null): string =>
    deposit ? t("customer.pay.paid.deposit", { amount: f.money(amount), day: at === null ? "" : f.date(at) }) : t("customer.pay.paid.whole", { amount: f.money(amount), day: at === null ? "" : f.date(at) });
  return (
    <div className="crm-q-paying">
      {justAccepted && offered && phase !== "checking" && !confirming ? (
        <p role="status" className="crm-q-thanks" data-testid="pay-thanks">
          <CheckCheck size={18} aria-hidden="true" />
          <span>
            {deposit
              ? t("customer.pay.thanks.deposit", { deposit: f.money(quote.payDue), pct: f.percent((quote.payPct ?? 0) / 100), total: f.money(quote.total) })
              : t("customer.pay.thanks.whole")}
          </span>
        </p>
      ) : (
        <AcceptedLine quote={quote} f={f} />
      )}
      {phase === "checking" ? (
        <p role="status" className="crm-q-wait" data-testid="pay-checking">
          <LoaderCircle size={18} aria-hidden="true" className="crm-q-spin" />
          <span>{t("customer.pay.checking")}</span>
        </p>
      ) : null}
      {settled && phase !== "checking" ? (
        <p role="status" className="crm-q-paid" data-testid="pay-paid">
          <CircleCheck size={18} aria-hidden="true" />
          <span>{paidLine(quote.payAmount, quote.payPaidAt)}</span>
        </p>
      ) : null}
      {showPaidSaid ? (
        <p role="status" className="crm-q-paid" data-testid="pay-paid">
          <CircleCheck size={18} aria-hidden="true" />
          <span>{paidLine(quote.payDue, noonOf(today))}</span>
        </p>
      ) : null}
      {settled && deposit && !paidNow && phase !== "checking" && quote.total > quote.payAmount ? (
        <p className="crm-q-rest" data-testid="pay-rest">
          <CalendarClock size={17} aria-hidden="true" />
          <span>{t("customer.pay.rest", { amount: f.money(quote.total - quote.payAmount) })}</span>
        </p>
      ) : null}
      {offered && quote.payRefunded > 0 && phase !== "checking" ? (
        <p className="crm-q-rest" data-testid="pay-refunded">
          <RotateCcw size={17} aria-hidden="true" />
          <span>{t("customer.pay.refunded", { amount: f.money(quote.payRefunded) })}</span>
        </p>
      ) : null}
      {phase === "taking" ? (
        <p role="status" className="crm-q-wait" data-testid="pay-taking">
          <LoaderCircle size={18} aria-hidden="true" className="crm-q-spin" />
          <span>{t("customer.pay.taking")}</span>
        </p>
      ) : null}
      {confirming ? (
        <div role="status" className="crm-q-said" data-tone="info" data-testid="pay-confirming">
          <p className="crm-q-said-head">
            <Landmark size={17} aria-hidden="true" />
            <span>{t("customer.pay.bank")}</span>
          </p>
          <p className="crm-q-said-body">{t("customer.pay.bank.body")}</p>
        </div>
      ) : null}
      {asking ? (
        <div className="crm-q-pay">
          {said === "failed" || said === "expired" ? (
            <p role="status" className="crm-q-said" data-tone={said === "failed" ? "warn" : "plain"} data-testid={said === "failed" ? "pay-unfinished" : "pay-ran-out"}>
              <span className="crm-q-said-head">
                {said === "failed" ? <CircleAlert size={16} aria-hidden="true" /> : <CalendarX size={16} aria-hidden="true" />}
                <span>{said === "failed" ? t("customer.pay.unfinished") : t("customer.pay.ranOut")}</span>
              </span>
            </p>
          ) : null}
          {phase === "failed" ? (
            <p role="alert" className="crm-q-problem">
              {t("customer.pay.startFailed")}
            </p>
          ) : null}
          <button ref={pay} type="button" className="crm-q-btn crm-q-paybtn" data-tone="accent" onClick={start} data-testid="pay-now">
            <Lock size={16} aria-hidden="true" />
            <span>{t("customer.pay.now", { amount: f.money(quote.payDue) })}</span>
          </button>
          <p className="crm-q-service">{t("customer.pay.service")}</p>
          <p className="crm-q-orwait">{t("customer.pay.orWait")}</p>
        </div>
      ) : null}
    </div>
  );
}
