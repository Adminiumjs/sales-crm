/**
 * ONE VISIT on the crew's day (the design's visit card): when, where, who to
 * ask for, how to get in, the office's note, what is on the vehicle, the four
 * ticks, the job's snags, and the sign-off: "Sign off the job" on the visit
 * that finishes the work, or, on a return to a job already signed, that
 * sign-off read-only and "Add a snag" (B19).
 *
 * Nothing here is an amount: the crew reads none.
 */
import { useT } from "../../i18n/index.tsx";
import type { Formatters } from "../../lib/format.ts";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { AddSnag } from "./AddSnag.tsx";
import { addressLines, dayKeyOf, hoursText, isLive, mapsHref, num, offersSignOff, telHref, TICKS, ticksOpen, timeSpan, truthy, type CrewSnag, type CrewVisit, type Moved, type NoteLine, type SignOff, type Tick } from "./data.ts";
import type { Connection } from "./Offline.tsx";

export interface VisitFacts {
  visit: CrewVisit;
  signed: SignOff | undefined;
  snags: CrewSnag[];
  load: NoteLine[] | undefined;
  moved: Moved | undefined;
}

export function VisitCard({ facts, today, f, crewName, busyTick, onTick, conn, onChanged, agent, touch }: { facts: VisitFacts; today: string; f: Formatters; crewName: string | null; busyTick: string | null; onTick: (visit: CrewVisit, tick: Tick, on: boolean) => void; conn: Connection; onChanged: () => void; agent: string; touch: boolean }) {
  const t = useT();
  const { visit, signed, snags, load, moved } = facts;
  const span = timeSpan(visit.start_time, visit.hours);
  const lines = addressLines(visit);
  const maps = lines.length === 0 ? null : mapsHref(lines, agent, touch);
  const tel = telHref(visit.site_phone);
  const ticked = TICKS.filter((tick) => truthy(visit[tick])).length;
  const open = ticksOpen(visit, today);
  const live = snags.filter(isLive);
  const day = dayKeyOf(visit.day);
  return (
    <article className="crm-cw-visit mr-card" data-visit={visit.id} data-testid="cw-visit">
      <div className="crm-cw-visit-top">
        <div className="crm-cw-visit-words">
          <div className="crm-cw-visit-when">
            {span !== null && (
              <>
                <span className="crm-cw-visit-time crm-mono">{span.from}</span>
                <span className="crm-cw-visit-span crm-mono">{t("cw.visit.span", { from: span.from, to: span.to })}</span>
              </>
            )}
            {num(visit.hours) > 0 && <span className="crm-cw-visit-hours crm-mono">{t("cw.hours", { n: hoursText(f, visit.hours) })}</span>}
          </div>
          <h2>{visit.site_name}</h2>
          <div className="crm-cw-visit-what" dir="auto">
            {t(`cw.kind.${visit.kind}`)} · {visit.what}
          </div>
          {crewName !== null && <div className="crm-cw-quiet">{crewName}</div>}
        </div>
        <span className="crm-pill" data-tone={ticked === 4 ? "pos" : "plain"} data-testid="cw-ticked">
          {ticked === 4 ? t("cw.ticks.done") : t("cw.ticks.count", { n: f.number(ticked), all: f.number(TICKS.length) })}
        </span>
      </div>

      {moved !== undefined && (
        <div className="crm-cw-changed" role="status" data-testid="cw-changed">
          <Icon name="pen-line" size={16} />
          <span>
            {t(moved.day !== null && moved.day !== day ? "cw.changed.day" : moved.start !== null && moved.start !== visit.start_time ? "cw.changed.start" : "cw.changed.other", {
              at: f.time(moved.at),
              on: f.dayShort(moved.at),
              by: moved.by ?? t("cw.changed.office"),
              was: moved.day !== null ? f.dayShort(noonOf(moved.day)) : (moved.start ?? ""),
              now: moved.day !== null && day !== null ? f.dayShort(noonOf(day)) : (visit.start_time ?? ""),
            })}
          </span>
        </div>
      )}

      {visit.note !== null && visit.note.trim() !== "" && (
        <section className="crm-cw-sec" aria-label={t("cw.visit.note")}>
          <h3>{t("cw.visit.note")}</h3>
          <p dir="auto">{visit.note}</p>
        </section>
      )}

      <section className="crm-cw-sec">
        <h3>{t("cw.visit.address")}</h3>
        <address className="crm-cw-address">
          {lines.map((line, i) => (
            <span key={i} dir="auto">
              {line}
            </span>
          ))}
          {lines.length === 0 && <span>{t("cw.visit.noAddress")}</span>}
        </address>
        {maps !== null && (
          <a className="crm-cw-bigbtn mr-gi" href={maps.href} aria-label={t("cw.visit.maps.aria", { site: visit.site_name })} data-testid="cw-maps" {...(maps.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            <Icon name="navigation" />
            {t("cw.visit.maps")}
          </a>
        )}
      </section>

      <section className="crm-cw-sec">
        <h3>{t("cw.visit.ask")}</h3>
        <div className="crm-cw-ask">
          <div className="crm-cw-ask-who">{visit.ask_for !== null && visit.ask_for.trim() !== "" ? visit.ask_for : t("cw.visit.ask.none")}</div>
          {tel !== null && (
            <a className="crm-cw-call crm-mono mr-gi" href={tel} aria-label={t("cw.visit.call", { who: visit.ask_for ?? visit.site_name, phone: visit.site_phone ?? "" })} data-testid="cw-call">
              <Icon name="phone" />
              {visit.site_phone}
            </a>
          )}
        </div>
      </section>

      <section className="crm-cw-sec">
        <h3>{t("cw.visit.access")}</h3>
        <p dir="auto">{visit.access_note !== null && visit.access_note.trim() !== "" ? visit.access_note : t("cw.visit.access.none")}</p>
      </section>

      <section className="crm-cw-sec" data-testid="cw-load">
        <h3>{t("cw.visit.load")}</h3>
        {load === undefined || load.length === 0 ? (
          <p className="crm-cw-quiet">{t("cw.visit.load.none")}</p>
        ) : (
          <ul className="crm-cw-load">
            {load.map((line) => (
              <li key={line.id}>
                <span className="crm-mono">{f.number(num(line.ordered))}</span>
                <span>{line.what}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="crm-cw-sec" data-testid="cw-ticks">
        <div className="crm-cw-sec-head">
          <h3>{t("cw.ticks")}</h3>
          <span className="crm-cw-quiet crm-mono">{t("cw.ticks.of", { n: f.number(ticked), all: f.number(TICKS.length) })}</span>
        </div>
        <div className="crm-cw-ticks">
          {TICKS.map((tick) => {
            const on = truthy(visit[tick]);
            const label = t(`jb.tick.${tick}`);
            return (
              <button key={tick} type="button" className="crm-cw-tick mr-btn" data-tick={tick} aria-pressed={on} disabled={!open || busyTick !== null} onClick={() => onTick(visit, tick, !on)}>
                <span className="crm-cw-box" aria-hidden="true">
                  {on && <Icon name="check" size={14} />}
                </span>
                <span className="crm-cw-tick-words">
                  {label}
                  {busyTick === `${String(visit.id)}:${tick}` && <span className="crm-cw-quiet">{t("ui.saving")}</span>}
                </span>
              </button>
            );
          })}
        </div>
        {!open && <p className="crm-cw-quiet">{t(visit.state === "done" ? "cw.ticks.made" : "cw.ticks.past")}</p>}
      </section>

      <section className="crm-cw-sec" data-testid="cw-visit-snags">
        <div className="crm-cw-sec-head">
          <h3>{t("cw.visit.snags")}</h3>
          <span className="crm-cw-quiet crm-mono">{t("cw.visit.snags.live", { n: f.number(live.length) }, live.length)}</span>
        </div>
        {live.length === 0 ? (
          <p className="crm-cw-quiet">{t("cw.visit.snags.none")}</p>
        ) : (
          <ul className="crm-cw-snaglist">
            {live.map((snag) => (
              <li key={snag.id} data-snag={snag.id}>
                <span>{snag.text}</span>
                <span className="crm-cw-quiet">
                  {t(`jb.sg.state.${snag.state}`)}
                  {truthy(snag.stops_sign_off) && ` · ${t("cw.snag.stopsShort")}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {signed !== undefined ? (
        <div className="crm-cw-signed" data-testid="cw-signed">
          <div className="crm-cw-signed-line">
            <Icon name="check-check" size={16} />
            <span>{t("cw.signed.line", { day: f.date(new Date(signed.signed_at)), name: signed.signer_name })}</span>
          </div>
          <ScreenLink to="crewsign" rest={[visit.id]} className="crm-cw-bigbtn mr-gi">
            <Icon name="file-check" />
            {t("cw.signed.see")}
          </ScreenLink>
          <AddSnag id={`crm-cw-add-${String(visit.id)}`} visitId={visit.id} site={visit.site_name} withStops={false} conn={conn} onDone={onChanged} />
        </div>
      ) : (
        offersSignOff(visit, false, today) && (
          <ScreenLink to="crewsign" rest={[visit.id]} className="crm-cw-signbtn mr-btn">
            <Icon name="clipboard-check" />
            {t("cw.sign.open")}
          </ScreenLink>
        )
      )}
    </article>
  );
}
