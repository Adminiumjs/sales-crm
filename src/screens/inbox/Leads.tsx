/**
 * TRADE-SHOW LEADS (ledger screen 58): everybody scanned on a stand, in the
 * order to ring them.
 *
 * A lead is an enquiry that names its show and how keen the person was. What
 * it has come to is read from its own columns: still to ring, spoken to (it
 * has a "rung at"), became a deal (it names one), not for us (dropped). The
 * five counts are the server's; days are counted from the server's clock, and
 * a lead goes cold after the install's own number of days.
 *
 * `trade-show-leads/paste` brings a show's list in (`PasteLeads.tsx`), for
 * the marketer and the CRM admin.
 */
import { useCallback, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { addDays, formatters, noonOf } from "../../lib/format.ts";
import { useDealActions } from "../../selling/actions.tsx";
import { DealLink } from "../../selling/DealLink.tsx";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import type { Saved } from "../../staffSession.ts";
import { readNames } from "../visits/data.ts";
import { byWorkOrder, canClaim, leadAge, leadState, LEAD_STATES, markRung, notForUs, readColdDays, readLeads, readShows, type Enquiry, type LeadState, type Show } from "./data.ts";
import { dealFrom } from "./Inbox.tsx";
import { PasteLeads } from "./PasteLeads.tsx";
import { tileOf, warmLabel, WARM_TONE } from "./parts.tsx";

const PILL: Record<LeadState, "warn" | "info" | "pos" | "plain"> = { new: "warn", called: "info", deal: "pos", no: "plain" };

/** Who may bring a list in: the server holds it to the marketer and the CRM admin (and whoever runs the install). */
export const mayPaste = (roles: readonly { slug: string }[]): boolean => roles.length === 0 || roles.some((role) => role.slug === "crm-marketer" || role.slug === "crm-admin");

export function showDates(show: Show, f: ReturnType<typeof formatters>): string {
  const from = f.dayShort(noonOf(show.starts_on));
  return show.ends_on === null || show.ends_on === show.starts_on ? from : `${from} – ${f.dayShort(noonOf(show.ends_on))}`;
}

export function Leads({ rest }: ScreenProps) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const deals = useDealActions();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const [now, setNow] = useState(() => session.now());
  const [showId, setShowId] = useState<number | null>(null);
  // The shows and the setting: read once per page.
  const { load: fixed, reload: reloadFixed } = useLoad(() => Promise.all([readShows(session), readColdDays(session)]), [session]);
  const { load, reload } = useLoad(() => (fixed.state === "ready" ? readLeads(session, fixed.data[0], showId, fixed.data[1]) : new Promise<never>(() => undefined)), [session, fixed.state, showId, deals.changed]);
  const { load: people } = useLoad(() => readNames(session), [session]);
  const names = people.state === "ready" ? people.data : {};
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      reload();
    }, [session, reload]),
  );
  useLive(["enquiries"], again);
  useLive(["shows"], reloadFixed);

  const canChange = session.can("enquiries", "update");
  const claims = canClaim(session);
  const pastes = mayPaste(config.access?.roles ?? []);
  const [filter, setFilter] = useState<LeadState | "all">("all");
  const [busy, setBusy] = useState<number | null>(null);

  if (rest[0] === "paste") {
    if (fixed.state !== "ready") return <Skeleton rows={3} height={96} />;
    return <PasteLeads shows={fixed.data[0]} onShows={reloadFixed} />;
  }
  if (fixed.state === "failed" || fixed.state === "refused") return <Loaded load={fixed} reload={reloadFixed}>{() => null}</Loaded>;

  const act = async (row: Enquiry, save: Promise<Saved<Enquiry>>, done: string): Promise<void> => {
    setBusy(row.id);
    await toasts.say(save, () => done);
    setBusy(null);
    again();
  };

  return (
    <div className="crm-screen crm-leads mr-screen" data-screen="leads">
      <div className="crm-screen-head">
        <div>
          <h1>{t("leads.title")}</h1>
          <Loaded load={load} reload={reload} skeleton={<p className="crm-screen-sub">{t("leads.sub.plain")}</p>}>
            {(data) => (
              <>
                <p className="crm-screen-sub">{t("leads.sub", { days: f.number(data.coldDays) }, data.coldDays)}</p>
                {data.show !== null &&
                  (data.shows.length > 1 ? (
                    <label className="crm-leads-show">
                      <span className="crm-sr">{t("leads.show")}</span>
                      <select className="crm-input crm-input-sm mr-fld" value={data.show.id} onChange={(event) => setShowId(Number(event.target.value))}>
                        {data.shows.map((show) => (
                          <option key={show.id} value={show.id}>
                            {show.name} · {showDates(show, f)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div className="crm-leads-show crm-mono" data-testid="leads-show">
                      {data.show.name} · {showDates(data.show, f)}
                    </div>
                  ))}
              </>
            )}
          </Loaded>
        </div>
        {pastes && (
          <div className="crm-screen-actions">
            <ScreenLink to="leads" rest={["paste"]} className="crm-btn crm-btn-ghost crm-btn-40 mr-gi">
              <Icon name="clipboard-list" />
              {t("leads.paste")}
            </ScreenLink>
          </div>
        )}
      </div>

      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={4} height={118} />}>
        {(data) => {
          if (data.show === null) {
            return (
              <div className="crm-empty" data-testid="leads-none">
                <span className="crm-empty-icon">
                  <Icon name="tent" size={21} />
                </span>
                <div className="crm-empty-title">{t("leads.empty.noShow")}</div>
                <p>{t(pastes ? "leads.empty.noShow.paste" : "leads.empty.noShow.read")}</p>
              </div>
            );
          }
          const hot = data.rows.find((row) => leadState(row) === "new" && row.warmth === "hot") ?? null;
          const coldOn = f.dayShort(noonOf(addDays(data.show.starts_on, data.coldDays)));
          const shown = data.rows.filter((row) => filter === "all" || leadState(row) === filter).sort(byWorkOrder);
          return (
            <>
              <div className="crm-leads-stats">
                <div className="crm-leads-stat mr-card" data-stat="scanned">
                  <div className="crm-kpi-label">{t("leads.stat.scanned")}</div>
                  <div className="crm-leads-value crm-mono">{f.number(data.counts.all)}</div>
                  <div className="crm-leads-note">{showDates(data.show, f)}</div>
                </div>
                <div className="crm-leads-stat mr-card" data-stat="new" data-tone={data.counts.new > 0 ? "warn" : "pos"}>
                  <div className="crm-kpi-label">{t("leads.stat.new")}</div>
                  <div className="crm-leads-value crm-mono">{f.number(data.counts.new)}</div>
                  <div className="crm-leads-note">{data.counts.new === 0 ? t("leads.stat.new.none") : data.counts.hotNew > 0 ? t("leads.stat.new.hot", { count: f.number(data.counts.hotNew) }, data.counts.hotNew) : t("leads.stat.new.noHot")}</div>
                </div>
                <div className="crm-leads-stat mr-card" data-stat="deal" data-tone="pos">
                  <div className="crm-kpi-label">{t("leads.stat.deal")}</div>
                  <div className="crm-leads-value crm-mono">{f.number(data.counts.deal)}</div>
                  <div className="crm-leads-note">{data.counts.deal > 0 ? t("leads.stat.deal.some") : t("leads.stat.deal.none", { count: f.number(data.counts.called) }, data.counts.called)}</div>
                </div>
              </div>

              {data.counts.hotNew > 0 && (
                <div className="crm-banner" data-tone="danger" data-testid="leads-hot">
                  <Icon name="flame" size={15} />
                  <span>
                    {data.counts.hotNew === 1 && hot !== null
                      ? t("leads.hot.one", { person: hot.person ?? hot.company_name, company: hot.company_name, count: f.number(leadAge(hot, now, f, data.coldDays).days) }, leadAge(hot, now, f, data.coldDays).days)
                      : t("leads.hot.many", { count: f.number(data.counts.hotNew) }, data.counts.hotNew)}{" "}
                    {t("leads.cold", { days: f.number(data.coldDays), day: coldOn }, data.coldDays)}
                  </span>
                </div>
              )}

              <div className="crm-chips" role="group" aria-label={t("leads.filter")}>
                {(["all", ...LEAD_STATES] as const).map((one) => (
                  <button key={one} type="button" className="crm-chip-btn mr-chip" aria-pressed={filter === one} data-filter={one} onClick={() => setFilter(one)}>
                    {t(`leads.filter.${one}`)}
                    <span className="crm-chip-count crm-mono">{f.number(data.counts[one])}</span>
                  </button>
                ))}
              </div>
              {data.cut && <p className="crm-inbox-cut">{t("inbox.cut", { count: f.number(data.rows.length) })}</p>}

              <ul className="crm-enq-list">
                {shown.map((row) => {
                  const state = leadState(row);
                  const rep = names[row.claimed_by_id ?? row.passed_to_id ?? ""] ?? "";
                  const subject = row.wants ?? row.company_name;
                  const age = leadAge(row, now, f, data.coldDays);
                  return (
                    <li key={row.id} className="crm-enq crm-lead mr-card" data-lead-state={state} data-warmth={row.warmth ?? ""} data-enquiry={row.id}>
                      <div className="crm-enq-top">
                        <span className="crm-lead-tile" aria-hidden="true">
                          {tileOf(row.company_name)}
                        </span>
                        <div className="crm-enq-main">
                          <div className="crm-enq-line">
                            <span className="crm-enq-subject">{row.company_name}</span>
                            <span className="crm-pill" data-tone={PILL[state]} data-lead-pill>
                              {t(`leads.state.${state}`)}
                            </span>
                            {row.warmth !== null && (
                              <span className="crm-lead-warm" data-tone={WARM_TONE[row.warmth]}>
                                {warmLabel(row.warmth, t)}
                              </span>
                            )}
                          </div>
                          <div className="crm-enq-from">{[row.person, row.town].filter((part) => part !== null && part !== "").join(" · ")}</div>
                          {row.wants !== null && <div className="crm-lead-want">{row.wants}</div>}
                          {row.text !== null && row.text !== "" && <p className="crm-enq-body">{row.text}</p>}
                        </div>
                        <div className="crm-enq-end">
                          <span className="crm-enq-when crm-mono">{f.dayShort(new Date(row.received_at))}</span>
                          {state === "new" && (
                            <span className="crm-lead-age" data-late={age.left <= 2 ? "1" : "0"}>
                              {age.left > 0 ? t("leads.coldIn", { count: f.number(age.left) }, age.left) : t("leads.coldNow")}
                            </span>
                          )}
                          {rep !== "" && (
                            <span className="crm-lead-rep">
                              <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                                {initials(rep)}
                              </span>
                              {firstName(rep)}
                            </span>
                          )}
                        </div>
                      </div>
                      {(state === "deal" || ((state === "new" || state === "called") && (canChange || claims))) && (
                        <div className="crm-enq-foot">
                          {state === "deal" && session.can("deals", "read") && (
                            <DealLink id={row.deal_id} className="crm-enq-deal">
                              {t("inbox.settled.deal")}
                            </DealLink>
                          )}
                          {state === "new" && canChange && (
                            <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-act="rung" aria-label={t("leads.rung.aria", { person: row.person ?? row.company_name })} disabled={busy === row.id} onClick={() => void act(row, markRung(session, row), t("leads.toast.rung", { person: row.person ?? row.company_name }))}>
                              <Icon name="phone" size={14} />
                              {t("leads.rung")}
                            </button>
                          )}
                          {(state === "new" || state === "called") && claims && (
                            <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" data-act="deal" aria-label={t("leads.deal.aria", { company: row.company_name })} disabled={busy === row.id} onClick={() => deals.start(dealFrom(row, row.person === null ? t("inbox.firstStep.nobody", { subject }) : t("inbox.firstStep", { person: row.person, subject })))}>
                              <Icon name="plus" size={14} />
                              {t("leads.deal")}
                            </button>
                          )}
                          {(state === "new" || state === "called") && canChange && (
                            <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 crm-btn-quiet crm-lead-drop mr-gi" data-act="drop" aria-label={t("inbox.drop.aria", { subject: row.company_name })} disabled={busy === row.id} onClick={() => void act(row, notForUs(session, row), t("leads.toast.dropped"))}>
                              {t("inbox.drop")}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {shown.length === 0 && (
                <div className="crm-empty" data-testid="leads-empty">
                  <span className="crm-empty-icon">
                    <Icon name="tent" size={21} />
                  </span>
                  <div className="crm-empty-title">{t(data.counts.all === 0 ? "leads.empty" : "inbox.empty.filter")}</div>
                  <p>{t(data.counts.all === 0 ? (pastes ? "leads.empty.paste" : "leads.empty.read") : "leads.empty.filter")}</p>
                </div>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
