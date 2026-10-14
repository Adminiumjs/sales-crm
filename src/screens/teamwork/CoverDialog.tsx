/**
 * NEW COVER, and CHANGE ITS DATES: the booking dialog's pattern.
 *
 * WHAT THE SERVER HOLDS: who may make a cover and for whom, that the person
 * who covers reads deals, and that the person away has one cover at a time.
 * This dialog says the same things early where it can see them (it has the
 * covers the reader reaches), and puts the server's refusal in the reader's
 * words where it cannot.
 *
 * WHAT IS SAVED. A new cover is made once: a reply lost on the way back is
 * read back before anything is sent again (`makeCover`). A change of dates
 * names the dates the dialog read.
 */
import { useMemo, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { addDays, noonOf } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { Dialog } from "../../ui/dialog.tsx";
import { firstName } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { useF, type Who } from "./common.tsx";
import { coverState, makeCover, type Cover } from "./cover.ts";

export type CoverEdit = { mode: "new" } | { mode: "dates"; cover: Cover };

export function CoverDialog({ edit, who, covers, wide, onClose, onDone }: { edit: CoverEdit; who: Who; covers: Cover[]; /** Offered everybody who signs in, not only the reps (the CRM admin). */ wide: boolean; onClose: () => void; onDone: (id: number | null) => void }) {
  const t = useT();
  const f = useF();
  const session = useSession();
  const toasts = useToasts();
  const [today] = useState(() => f.dayKey(session.now()));
  const was = edit.mode === "dates" ? edit.cover : null;
  const isNew = was === null;
  const [away, setAway] = useState<string>(was?.owner_id ?? who.reps[0] ?? "");
  const [by, setBy] = useState<string>(was?.cover_id ?? "");
  const [from, setFrom] = useState<string>(was?.starts_on ?? "");
  const [to, setTo] = useState<string>(was?.ends_on ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  const name = (id: string): string => who.names[id] ?? "";
  // Who may be away: the people with a rep's profile. Who may cover: the same, and for the CRM admin everybody else after them.
  const pool = useMemo(() => {
    const reps = who.reps.filter((id) => who.names[id] !== undefined);
    const rest = wide ? who.everyone.map((person) => person.id).filter((id) => !reps.includes(id)) : [];
    return { reps, rest };
  }, [who, wide]);

  const day = /^\d{4}-\d{2}-\d{2}$/;
  const problem = ((): string | null => {
    if (by === "" || by === away) return t("cover.dlg.err.who");
    if (!day.test(from)) return t("cover.dlg.err.first");
    if (from < today && (isNew || from !== was.starts_on)) return t("cover.dlg.err.past");
    if (to !== "" && (!day.test(to) || to < from)) return t("cover.dlg.err.order");
    const clash = covers.find((one) => one.id !== was?.id && one.owner_id === away && coverState(one, today) !== "over" && from <= (one.ends_on ?? "9999-12-31") && one.starts_on <= (to === "" ? "9999-12-31" : to));
    return clash === undefined ? null : t("cover.dlg.err.taken", { away: firstName(name(away)) });
  })();
  const changed = isNew || from !== was.starts_on || to !== (was.ends_on ?? "");
  const ready = problem === null && changed;
  const when = (first: string, last: string): string => (last === "" ? t("cover.when.open", { from: f.dayShort(noonOf(first)) }) : t("cover.when", { from: f.dayShort(noonOf(first)), to: f.dayShort(noonOf(last)) }));

  const go = async (): Promise<void> => {
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    const slow = setTimeout(() => setChecking(true), 1200);
    const saved = isNew
      ? await makeCover(session, { owner_id: away, cover_id: by, starts_on: from, ends_on: to === "" ? null : to })
      : await session.update<Cover>("covers", was.id, { starts_on: from, ends_on: to === "" ? null : to }, { seen: { starts_on: was.starts_on, ends_on: was.ends_on } });
    clearTimeout(slow);
    setChecking(false);
    setBusy(false);
    if (saved.state === "refused") {
      const fields = saved.error.fields;
      const reason =
        saved.error.code === "BOOKING_TAKEN"
          ? t("cover.dlg.err.taken", { away: firstName(name(away)) })
          : fields["cover_id"] === "cannot-open"
            ? t("cover.dlg.err.cannotOpen", { by: firstName(name(by)) })
            : fields["cover_id"] !== undefined || fields["owner_id"] !== undefined || saved.error.status === 403
              ? t("cover.dlg.err.notYours")
              : reasonOf(saved.error, t);
      return setError(t("ui.refused", { reason }));
    }
    if (saved.state === "unknown") return setError(t("ui.unknown"));
    toasts.show(isNew ? t("cover.toast.set", { by: firstName(name(by)), away: firstName(name(away)), when: when(from, to) }) : t("cover.toast.dates"), "pos");
    onDone(typeof saved.row.id === "number" ? saved.row.id : (was?.id ?? null));
    onClose();
  };

  return (
    <Dialog
      shape="box"
      name={isNew ? "cover-new" : "cover-dates"}
      icon="plane"
      title={t(isNew ? "cover.dlg.new" : "cover.dlg.dates")}
      subtitle={isNew ? t("cover.dlg.new.sub") : t("cover.dlg.dates.sub", { by: firstName(name(by)), away: firstName(name(away)) })}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("ui.close")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 crm-btn-wide mr-btn" data-go disabled={!ready || busy} onClick={() => void go()}>
            {busy ? t("ui.saving") : t(isNew ? "cover.dlg.go.new" : "cover.dlg.go.dates")}
          </button>
        </>
      }
    >
      <fieldset className="crm-fields crm-cvd" disabled={busy}>
        <div className="crm-bk-head">{t("cover.dlg.who")}</div>
        {isNew ? (
          <div className="crm-field-pair">
            <div>
              <label className="crm-label" htmlFor="crm-cvd-away">
                {t("cover.dlg.away")}
              </label>
              <select id="crm-cvd-away" data-autofocus className="crm-input mr-fld" value={away} onChange={(event) => (setAway(event.target.value), setError(null))}>
                {pool.reps.map((id) => (
                  <option key={id} value={id}>
                    {name(id)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="crm-label" htmlFor="crm-cvd-by">
                {t("cover.dlg.by")}
              </label>
              <select id="crm-cvd-by" className="crm-input mr-fld" value={by === away ? "" : by} onChange={(event) => (setBy(event.target.value), setError(null))}>
                <option value="">{t("cover.dlg.by.pick")}</option>
                {pool.reps
                  .filter((id) => id !== away)
                  .map((id) => (
                    <option key={id} value={id}>
                      {name(id)}
                    </option>
                  ))}
                {pool.rest.length > 0 && (
                  <optgroup label={t("cover.dlg.by.others")}>
                    {pool.rest
                      .filter((id) => id !== away)
                      .map((id) => (
                        <option key={id} value={id}>
                          {name(id)}
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
            </div>
          </div>
        ) : (
          <div className="crm-bk-fixed" data-testid="cvd-fixed">
            {t("cover.title", { by: name(by), away: name(away) })}
          </div>
        )}

        <div className="crm-bk-head">{t("cover.dlg.when")}</div>
        <div className="crm-field-pair">
          <div>
            <label className="crm-label" htmlFor="crm-cvd-from">
              {t("cover.dlg.from")}
            </label>
            <input id="crm-cvd-from" {...(isNew ? {} : { "data-autofocus": true })} className="crm-input crm-mono mr-fld" type="date" min={today} value={from} onChange={(event) => (setFrom(event.target.value), setError(null))} />
          </div>
          <div>
            <label className="crm-label" htmlFor="crm-cvd-to">
              {t("cover.dlg.to")}
            </label>
            <input id="crm-cvd-to" className="crm-input crm-mono mr-fld" type="date" min={from === "" ? today : from} value={to} aria-describedby="crm-cvd-to-note" onChange={(event) => (setTo(event.target.value), setError(null))} />
            <p id="crm-cvd-to-note" className="crm-field-note">
              {day.test(to) ? t("cover.dlg.to.back", { day: f.dayShort(noonOf(addDays(to, 1))) }) : t("cover.dlg.to.open")}
            </p>
          </div>
        </div>
        {problem !== null && from !== "" && (
          <div className="crm-form-error" role="alert">
            <Icon name="circle-slash" size={15} />
            <span>{problem}</span>
          </div>
        )}
      </fieldset>
      {checking && (
        <p className="crm-field-note" role="status">
          {t("ui.checking")}
        </p>
      )}
      {error !== null && (
        <div className="crm-form-error" role="alert">
          <Icon name="triangle-alert" size={15} />
          <span>{error}</span>
        </div>
      )}
    </Dialog>
  );
}
