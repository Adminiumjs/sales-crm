/**
 * The marketer's home, past the enquiries: a tile and a group of rows for
 * each of campaigns, forms, funnels and chats, drawn in the home's own look.
 * A group the reader does not get (its add-on is not here, or she may not
 * read its tables) is not drawn at all. Nothing here makes or changes
 * anything: there is no button but the links the home already has.
 */
import type { TFunction } from "../../i18n/index.tsx";
import type { Formatters } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { companyText } from "./parts.tsx";
import { countingStartedIn, shareOf, type CampaignLine, type FunnelCard, type Marketing } from "./marketing.ts";

/** A campaign's latest send, in words: when it went, goes or stopped, or that it never went. */
export function campaignState(line: Pick<CampaignLine, "status" | "at">, t: TFunction, f: Pick<Formatters, "date">): string {
  const day = line.at === null ? "" : f.date(new Date(line.at));
  switch (line.status) {
    case "sent":
      return t("mkhome.campaign.sent", { day });
    case "scheduled":
      return t("mkhome.campaign.scheduled", { day });
    case "running":
      return t("mkhome.campaign.running");
    case "failed":
      return t("mkhome.campaign.failed", { day });
    case "cancelled":
      return t("mkhome.campaign.cancelled");
    default:
      return t("mkhome.campaign.draft");
  }
}

/** What a funnel's card counts, in words. */
export function cardKind(card: Pick<FunnelCard, "kind">, t: TFunction): string {
  return card.kind === "page" ? t("mkhome.funnel.page") : card.kind === "form-opened" ? t("mkhome.funnel.opened") : t("mkhome.funnel.sent");
}

export function MarketingTiles({ data, month, t, f }: { data: Marketing; month: string; t: TFunction; f: Formatters }) {
  const { campaigns, forms, funnels, chats } = data;
  if (campaigns === null && forms === null && funnels === null && chats === null) return null;
  return (
    <div className="crm-leads-stats" data-group="marketing">
      {campaigns !== null && (
        <div className="crm-leads-stat mr-card" data-stat="campaigns">
          <div className="crm-kpi-label">{t("mkhome.tile.campaigns", { month })}</div>
          <div className="crm-leads-value crm-mono">{f.number(campaigns.sentInMonth)}</div>
          <div className="crm-leads-note">{t("mkhome.tile.campaigns.sub", { count: f.number(campaigns.mailsInMonth) }, campaigns.mailsInMonth)}</div>
        </div>
      )}
      {forms !== null && (
        <div className="crm-leads-stat mr-card" data-stat="answers">
          <div className="crm-kpi-label">{t("mkhome.tile.answers", { month })}</div>
          <div className="crm-leads-value crm-mono">{f.number(forms.answers)}</div>
          <div className="crm-leads-note">{t("mkhome.tile.answers.sub", { count: f.number(forms.lines.length) }, forms.lines.length)}</div>
        </div>
      )}
      {funnels !== null && (
        <div className="crm-leads-stat mr-card" data-stat="views">
          <div className="crm-kpi-label">{t("mkhome.tile.views", { month })}</div>
          <div className="crm-leads-value crm-mono">{funnels.pageViews === null ? "—" : f.number(funnels.pageViews)}</div>
          <div className="crm-leads-note">{t("mkhome.tile.views.sub", { count: f.number(funnels.livePages) }, funnels.livePages)}</div>
        </div>
      )}
      {chats !== null && (
        <div className="crm-leads-stat mr-card" data-stat="chats">
          <div className="crm-kpi-label">{t("mkhome.tile.chats", { month })}</div>
          <div className="crm-leads-value crm-mono">{f.number(chats.conversations)}</div>
          <div className="crm-leads-note">{t("mkhome.tile.chats.sub", { count: f.number(chats.outsideHours) }, chats.outsideHours)}</div>
        </div>
      )}
    </div>
  );
}

export function MarketingGroups({ data, month, monthDays, t, f }: { data: Marketing; month: string; monthDays: [string, string]; t: TFunction; f: Formatters }) {
  const { campaigns, forms, funnels, chats } = data;
  return (
    <>
      {campaigns !== null && (
        <section className="crm-mk-queue mr-card" aria-labelledby="crm-mk-campaigns" data-group="campaigns">
          <h2 id="crm-mk-campaigns">
            {t("mkhome.campaigns")}
            <span className="crm-chip-count crm-mono">{f.number(campaigns.lines.length)}</span>
          </h2>
          {campaigns.lines.length === 0 ? (
            <p className="crm-mk-none">{t("mkhome.campaigns.none")}</p>
          ) : (
            <ul className="crm-mk-rows">
              {campaigns.lines.map((line) => (
                <li key={line.key} data-campaign={line.key}>
                  <div className="crm-mk-row">
                    <span className="crm-enq-icon" aria-hidden="true">
                      <Icon name="send" size={15} />
                    </span>
                    <span className="crm-mk-main">
                      <span className="crm-mk-title">{line.name}</span>
                      <span className="crm-mk-sub">{[campaignState(line, t, f), line.failed > 0 ? t("mkhome.campaign.failedCount", { count: f.number(line.failed) }, line.failed) : null].filter((part) => part !== null).join(" · ")}</span>
                    </span>
                    {line.status !== "draft" && <span className="crm-mk-figure crm-mono">{t("mkhome.campaign.figure", { sent: f.number(line.sent), total: f.number(line.total) })}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {forms !== null && (
        <section className="crm-mk-queue mr-card" aria-labelledby="crm-mk-forms" data-group="forms">
          <h2 id="crm-mk-forms">
            {t("mkhome.forms", { month })}
            <span className="crm-chip-count crm-mono">{f.number(forms.answers)}</span>
          </h2>
          {forms.lines.length === 0 ? (
            <p className="crm-mk-none">{t("mkhome.forms.none")}</p>
          ) : (
            <ul className="crm-mk-rows">
              {forms.lines.map((line) => (
                <li key={line.id} data-form={line.id}>
                  <div className="crm-mk-row">
                    <span className="crm-enq-icon" aria-hidden="true">
                      <Icon name={line.kind === "survey" ? "star" : "file-text"} size={15} />
                    </span>
                    <span className="crm-mk-main">
                      <span className="crm-mk-title">{line.name}</span>
                      <span className="crm-mk-sub">{[line.kind === null ? null : t(line.kind === "survey" ? "mkhome.form.survey" : "mkhome.form.form"), line.state === null ? null : t(line.state === "live" ? "mkhome.form.live" : line.state === "closed" ? "mkhome.form.closed" : "mkhome.form.draft")].filter((part) => part !== null).join(" · ")}</span>
                    </span>
                    <span className="crm-mk-figure crm-mono">{t("mkhome.form.answers", { count: f.number(line.answers) }, line.answers)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {funnels !== null && (
        <section className="crm-mk-queue mr-card" aria-labelledby="crm-mk-funnels" data-group="funnels">
          <h2 id="crm-mk-funnels">
            {t("mkhome.funnels", { month })}
            <span className="crm-chip-count crm-mono">{f.number(funnels.lines.length)}</span>
          </h2>
          {funnels.level === "off" ? (
            <p className="crm-mk-none" data-counting="off">
              {t("mkhome.funnels.off")}
            </p>
          ) : (
            countingStartedIn(funnels.countingSince, monthDays, f) && (
              <p className="crm-mk-none" data-counting="since">
                {t("mkhome.funnels.since", { day: f.date(new Date(funnels.countingSince!)) })}
              </p>
            )
          )}
          {funnels.lines.length === 0 ? (
            <p className="crm-mk-none">{t("mkhome.funnels.none")}</p>
          ) : (
            <ul className="crm-mk-rows">
              {funnels.lines.map((line) => (
                <li key={line.id} data-funnel={line.id}>
                  <div className="crm-mk-funnel">
                    <span className="crm-mk-title">{line.name}</span>
                    <ol className="crm-mk-steps">
                      {line.cards.map((card, i) => {
                        const share = i === 0 ? null : shareOf(card.count, line.cards[i - 1]!.count);
                        return (
                          <li key={i} className="crm-mk-step" data-kind={card.kind} data-gone={card.ask === null ? "1" : "0"}>
                            <span className="crm-mk-main">
                              <span className="crm-mk-sub">{cardKind(card, t)}</span>
                              <span className="crm-mk-step-title">{card.title ?? t("mkhome.funnel.gone")}</span>
                            </span>
                            <span className="crm-mk-figure crm-mono">
                              {card.count === null ? "—" : card.kind === "form-sent" ? t("mkhome.form.answers", { count: f.number(card.count) }, card.count) : t("mkhome.funnel.views", { count: f.number(card.count) }, card.count)}
                            </span>
                            {share !== null && <span className="crm-mk-share crm-mono">{t("mkhome.funnel.wentOn", { share: f.percent(share) })}</span>}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {chats !== null && (
        <section className="crm-mk-queue mr-card" aria-labelledby="crm-mk-chats" data-group="chats">
          <h2 id="crm-mk-chats">
            {t("mkhome.chats", { month })}
            <span className="crm-chip-count crm-mono">{f.number(chats.outsideHours)}</span>
          </h2>
          {chats.questions.length === 0 ? (
            <p className="crm-mk-none">{t("mkhome.chats.none")}</p>
          ) : (
            <ul className="crm-mk-rows">
              {chats.questions.map((question) => (
                <li key={question.id} data-conversation={question.id}>
                  <div className="crm-mk-row">
                    <span className="crm-enq-icon" aria-hidden="true">
                      <Icon name="message-square" size={15} />
                    </span>
                    <span className="crm-mk-main">
                      <span className="crm-mk-title">{question.enquiry === null ? t("mkhome.chat.noEnquiry") : question.enquiry.person === null ? companyText(question.enquiry, t) : question.enquiry.person}</span>
                      <span className="crm-mk-sub">{question.enquiry === null ? t("mkhome.chat.left") : t("mkhome.chat.became")}</span>
                    </span>
                    <span className="crm-mk-figure crm-mono">{f.dayShort(new Date(question.startedAt))}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
