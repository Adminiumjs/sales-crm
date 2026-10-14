/**
 * DELIVERY NOTES (ledger screen 63): what went out on a visit and what came
 * back signed. When a customer says it never arrived, this is the answer.
 *
 * A note's totals are the server's (it keeps what its lines add up to, and
 * how many short); whether it needs sorting too (short, damaged or never
 * signed for, until the office marks it sorted). Every count is the server's.
 * "Sorted it" is the office's mark on the note, kept with the day it was made.
 */
import { useCallback, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { initials } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { dayKeyOf, noteState, num, readNoteFigures, readNotes, type CrewFacts, type Note, type NoteFigures, type NoteLine, type NoteState } from "./data.ts";
import { Stat, useCrewFacts, useJobsScreen } from "./parts.tsx";

type Filter = "all" | "short" | "damaged" | "unsigned" | "clean";
const FILTERS: readonly Filter[] = ["all", "short", "damaged", "unsigned", "clean"];
const countOf = (figures: NoteFigures, filter: Filter): number => (filter === "all" ? figures.all : filter === "clean" ? figures.clean : figures[filter]);
const TONE: Record<NoteState, "pos" | "warn" | "danger"> = { clean: "pos", sorted: "pos", short: "warn", damaged: "warn", unsigned: "danger" };

export function DeliveryNotes(_props: ScreenProps) {
  const t = useT();
  const { session, f, tick } = useJobsScreen();
  const { load: facts, reload: reloadFacts } = useCrewFacts(session);
  const { load, reload } = useLoad(() => Promise.all([readNotes(session), readNoteFigures(session)]), [session]);
  const again = useCoalesced(
    useCallback(() => {
      tick();
      reload();
    }, [tick, reload]),
  );
  useLive(["delivery_notes", "delivery_note_lines"], again);
  const [filter, setFilter] = useState<Filter>("all");

  return (
    <div className="crm-screen crm-jb mr-screen" data-screen="dnotes">
      <div className="crm-screen-head">
        <div>
          <h1>{t("jb.dn.title")}</h1>
          <p className="crm-screen-sub crm-jb-lead">{t("jb.dn.sub")}</p>
        </div>
      </div>
      <Loaded load={facts} reload={reloadFacts} skeleton={<Skeleton rows={3} height={120} />}>
        {(crews) => (
          <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={120} />}>
            {([{ notes, lines }, figures]) => {
              const unsigned = notes.filter((note) => noteState(note) === "unsigned");
              const shown = notes.filter((note) => filter === "all" || noteState(note) === filter);
              return (
                <>
                  <div className="crm-kpis crm-jb-stats">
                    <Stat name="notes" label={t("jb.dn.stat.notes")} value={f.number(figures.all)} sub={t("jb.dn.stat.notes.sub", { lines: f.number(figures.lines), count: f.number(figures.all) }, figures.all)} />
                    <Stat name="clean" label={t("jb.dn.stat.clean")} value={f.number(figures.clean)} tone="pos" sub={t("jb.dn.stat.clean.sub")} />
                    <Stat name="sorting" label={t("jb.dn.stat.sorting")} value={f.number(figures.sorting)} tone={figures.sorting > 0 ? "warn" : "pos"} sub={t(figures.sorting > 0 ? "jb.dn.stat.sorting.sub" : "jb.dn.stat.sorting.none")} />
                  </div>
                  {figures.unsigned > 0 && (
                    <div className="crm-banner" data-tone="danger" data-testid="jb-dn-unsigned">
                      <Icon name="file-warning" size={16} />
                      <span>{figures.unsigned === 1 && unsigned[0] !== undefined ? t("jb.dn.unsigned.one", { site: unsigned[0].site ?? "" }) : t("jb.dn.unsigned", { count: f.number(figures.unsigned) }, figures.unsigned)}</span>
                    </div>
                  )}
                  <div className="crm-chips" role="group" aria-label={t("jb.dn.filter")}>
                    {FILTERS.map((one) => (
                      <button key={one} type="button" className="crm-chip-btn mr-chip" aria-pressed={filter === one} data-filter={one} onClick={() => setFilter(one)}>
                        {t(`jb.dn.filter.${one}`)}
                        <span className="crm-chip-count crm-mono">{f.number(countOf(figures, one))}</span>
                      </button>
                    ))}
                  </div>
                  <ul className="crm-jb-list">
                    {shown.map((note) => (
                      <NoteRow key={note.id} note={note} lines={lines.filter((line) => line.note_id === note.id)} crews={crews} onDone={again} />
                    ))}
                  </ul>
                  {shown.length === 0 && (
                    <div className="crm-empty">
                      <span className="crm-empty-icon">
                        <Icon name="file-check" size={20} />
                      </span>
                      <div className="crm-empty-title">{t("jb.dn.empty")}</div>
                      <p>{t("jb.dn.empty.body")}</p>
                    </div>
                  )}
                </>
              );
            }}
          </Loaded>
        )}
      </Loaded>
    </div>
  );
}

function NoteRow({ note, lines, crews, onDone }: { note: Note; lines: NoteLine[]; crews: CrewFacts; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useJobsScreen();
  const [busy, setBusy] = useState(false);
  const state = noteState(note);
  const day = dayKeyOf(note.day);
  const crew = crews.crews.find((one) => one.id === note.crew_id);
  const taker = note.taken_by_id === null ? null : (crews.names[note.taken_by_id] ?? null);
  const canSort = session.can("delivery_notes", "update") && state !== "clean" && state !== "sorted";
  const sort = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const saved = await toasts.say(session.update("delivery_notes", note.id, { sorted: true }, { seen: { sorted: false } }), () => t("jb.dn.sorted.done", { job: note.code ?? "" }));
    setBusy(false);
    if (saved !== null) onDone();
  };
  return (
    <li className="crm-jb-row mr-card" data-note={note.id} data-state={state} data-tone={TONE[state]}>
      <div className="crm-jb-row-top">
        <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
          {initials(note.site ?? "?")}
        </span>
        <div className="crm-jb-row-words">
          <div className="crm-jb-row-line">
            <strong>{[note.code, note.title].filter((part) => part !== null).join(" · ")}</strong>
            <span className="crm-pill" data-tone={TONE[state]} data-testid="jb-dn-state">
              {state === "short" ? t("jb.dn.state.short", { count: f.number(num(note.short)) }) : t(`jb.dn.state.${state}`)}
            </span>
          </div>
          <div className="crm-jb-quiet">{[note.site, crew?.name, day === null ? null : f.dayShort(noonOf(day))].filter((part) => part !== null && part !== undefined).join(" · ")}</div>
        </div>
        <div className="crm-jb-row-end">
          <div className="crm-mono" data-figure="items" data-tone={num(note.short) > 0 ? "warn" : undefined}>
            {t("jb.dn.items", { got: f.number(num(note.delivered)), of: f.number(num(note.ordered)) })}
          </div>
          <div className="crm-jb-quiet">{t("jb.dn.itemsWord")}</div>
        </div>
      </div>
      <ul className="crm-jb-lines">
        {lines.map((line) => (
          <li key={line.id}>
            <span>{line.what}</span>
            <span className="crm-mono" data-tone={line.delivered < line.ordered ? "warn" : undefined}>
              {t("jb.dn.items", { got: f.number(line.delivered), of: f.number(line.ordered) })}
            </span>
          </li>
        ))}
      </ul>
      <div className="crm-jb-row-foot">
        <span className="crm-jb-quiet">
          <Icon name="pen-line" size={13} />
          {[taker === null ? null : t("jb.dn.taken", { name: taker }), note.signed_name === null || note.signed_name === "" ? t("jb.dn.nobody") : t("jb.dn.signed", { name: note.signed_name })].filter((part) => part !== null).join(", ")}
        </span>
        {canSort && (
          <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" data-act="sort" disabled={busy} onClick={() => void sort()}>
            <Icon name="check" size={13} />
            {t("jb.dn.sort")}
          </button>
        )}
        {state === "sorted" && note.sorted_on !== null && <span className="crm-jb-quiet">{t("jb.dn.sortedOn", { day: f.date(noonOf(dayKeyOf(note.sorted_on)!)) })}</span>}
      </div>
      {note.note !== null && note.note !== "" && (
        <div className="crm-jb-note">
          <Icon name="sticky-note" size={13} />
          <span>{note.note}</span>
        </div>
      )}
    </li>
  );
}
