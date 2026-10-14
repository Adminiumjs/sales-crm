/**
 * A COMPANY'S TIMELINE: every call, e-mail, meeting, note and stage move on
 * the open deals there that the reader may open, newest first, a day at a
 * time. It is the Activity feed's rows narrowed to one company, so a rep sees
 * what was logged on her own deals and the manager the team's.
 *
 * WHO ADDS UP. Each kind's count is the server's. "Everything" carries no
 * count: it would be two tables' counts added here.
 */
import { useMemo, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { DealLink } from "../../selling/DealLink.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { NoRecord } from "../../shell/pages.tsx";
import { Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { KINDS, PAGE, readTimeline, type Entry, type Kind } from "./data.ts";
import { Tile, useAccounts } from "./shared.tsx";

const TYPES = ["all", ...KINDS, "stage"] as const;
type Type = (typeof TYPES)[number];
const ICONS: Record<Kind, string> = { call: "contact", email: "mail", meeting: "calendar-days", note: "notebook-pen", stage: "arrow-right-left" };

export function CompanyTimeline({ id }: { id: number }) {
  const t = useT();
  const { session, f } = useAccounts();
  const [type, setType] = useState<Type>("all");
  const [now, setNow] = useState(() => session.now());
  const { load, reload } = useLoad(() => readTimeline(session, id), [session, id]);
  const again = useMemo(
    () => () => {
      setNow(session.now());
      reload();
    },
    [session, reload],
  );
  useLive(session.can("activities", "read") ? ["activities", "deal_stage_changes", "deals"] : [], again);

  return (
    <div className="crm-screen crm-acc crm-acc-timeline mr-screen" data-screen="company-timeline">
      <Loaded load={load} reload={again} skeleton={<Skeleton rows={6} height={72} />}>
        {(data) => {
          if (data.company === null) return <NoRecord home={{ route: "companies", item: { route: "companies", label: "companies" } }} />;
          const shown = type === "all" ? data.entries : data.entries.filter((entry) => entry.type === type);
          const groups: { day: string; items: Entry[] }[] = [];
          for (const entry of shown) {
            const day = f.dayKey(new Date(entry.at));
            const last = groups.at(-1);
            if (last !== undefined && last.day === day) last.items.push(entry);
            else groups.push({ day, items: [entry] });
          }
          const heading = (at: Date): string => {
            const ago = f.dayDiff(at, now);
            return ago === 0 ? t("feed.today", { day: f.dayShort(at) }) : ago === 1 ? t("feed.yesterday", { day: f.dayShort(at) }) : f.dayLong(at);
          };
          return (
            <>
              <ScreenLink to="companies" rest={[data.company.id]} className="crm-btn crm-btn-ghost crm-btn-32 crm-acc-back mr-gi">
                <Icon name="chevron-left" size={14} className="crm-flip" />
                {data.company.name}
              </ScreenLink>
              <div className="crm-acc-tl-head">
                <Tile id={data.company.id} size="small" />
                <div>
                  <h1>{data.company.name}</h1>
                  <p className="crm-screen-sub">{t("acc.tl.sub")}</p>
                </div>
              </div>

              <div className="crm-chips" role="group" aria-label={t("feed.types")}>
                {TYPES.map((one) => (
                  <button key={one} type="button" className="crm-chip-btn mr-chip" aria-pressed={type === one} data-type={one} onClick={() => setType(one)}>
                    {one !== "all" && <Icon name={ICONS[one]} size={13} />}
                    {t(`feed.kind.${one}` as MessageKey)}
                    {one !== "all" && <span className="crm-chip-count crm-mono">{f.number(data.counts[one])}</span>}
                  </button>
                ))}
              </div>
              {data.cut && <p className="crm-acc-more">{t("acc.tl.cut", { count: f.number(PAGE) })}</p>}

              <div className="crm-feed-days" aria-busy={load.state === "ready" && load.again}>
                {groups.map((group) => (
                  <section key={group.day} className="crm-feed-day" aria-label={heading(new Date(group.items[0]!.at))}>
                    <div className="crm-feed-day-head">
                      <span className="crm-tm-label">{heading(new Date(group.items[0]!.at))}</span>
                      <span className="crm-feed-rule" />
                      <span className="crm-mono crm-acc-tl-count">{t("acc.tl.entries", { count: f.number(group.items.length) }, group.items.length)}</span>
                    </div>
                    <ul className="crm-feed-list mr-card">
                      {group.items.map((entry) => {
                        const person = entry.who === null ? null : (data.names[entry.who] ?? t("closed.someone"));
                        return (
                          <li key={entry.key} className="crm-feed-entry" data-type={entry.type}>
                            <span className="crm-feed-icon" data-type={entry.type}>
                              <Icon name={ICONS[entry.type]} size={15} />
                            </span>
                            <div className="crm-tm-grow">
                              <div className="crm-feed-top">
                                <DealLink id={entry.dealId} className="crm-tm-name">
                                  {entry.deal ?? ""}
                                </DealLink>
                                <span className="crm-pill">{t(`feed.label.${entry.type}` as MessageKey)}</span>
                                <span className="crm-feed-who">
                                  {person !== null && (
                                    <>
                                      <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
                                        {initials(person)}
                                      </span>
                                      {firstName(person)}
                                    </>
                                  )}
                                  <span className="crm-mono">{f.time(new Date(entry.at))}</span>
                                </span>
                              </div>
                              <p>{entry.type === "stage" ? (entry.from === null || entry.from === undefined ? t("feed.opened", { to: entry.to ?? "" }) : t("feed.moved", { from: entry.from, to: entry.to ?? "" })) : (entry.text ?? "")}</p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
              {shown.length === 0 && (
                <div className="crm-empty crm-acc-empty">
                  <span className="crm-empty-icon" data-tone="plain">
                    <Icon name="history" size={21} />
                  </span>
                  <div className="crm-empty-title">{t(data.entries.length === 0 ? "acc.tl.none" : "acc.tl.empty")}</div>
                  <p>{t(data.entries.length === 0 ? "acc.tl.none.body" : "acc.tl.empty.body")}</p>
                </div>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
