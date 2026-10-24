/**
 * THE SHOWROOM, SET UP IN SETTINGS (F20 for stage 2, F17's hours): its
 * spaces, the hours it opens on the business's working days, its address for
 * the visitor's e-mail, and the switch for those e-mails. On the Working time
 * tab, once the Showroom and samples part is on; the CRM admin's to write
 * (the server refuses anybody else), every other reader's to read.
 */
import { useEffect, useRef, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import { newClientKey, type StaffSession } from "../../staffSession.ts";
import { useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { Card } from "../appsettings/parts.tsx";
import { clockMinutes, isClock, readSpaces, type Space } from "./data.ts";

const yes = (value: unknown): boolean => value === true || value === 1 || value === "1" || value === "true";

const COLUMNS = ["id", "showroom_opens", "showroom_closes", "showroom_address", "showroom_emails"];

/**
 * The card reads and saves its own four columns of the settings row (the
 * Settings screen's read names the columns it shows, and this part's are not
 * among them): each save names what the card saw.
 */
export function ShowroomSettings({ session, can }: { session: StaffSession; can: boolean }) {
  const t = useT();
  const toasts = useToasts();
  const { load: rowLoad, reload: reloadRow } = useLoad(() => session.list<Record<string, unknown>>("settings", { select: COLUMNS, limit: 1 }).then((page) => page.rows[0] ?? null), [session]);
  const again = useCoalesced(reloadRow);
  useLive(["settings"], again);
  const settings = rowLoad.state === "ready" && rowLoad.data !== null ? rowLoad.data : {};
  const [saving, setBusy] = useState(false);
  // Until the row is read the fields show defaults, and a change made then has nothing to be saved on: they wait.
  const busy = saving || rowLoad.state !== "ready" || rowLoad.data === null;
  const save = async (values: Record<string, unknown>, done: string): Promise<boolean> => {
    if (rowLoad.state !== "ready" || rowLoad.data === null) return false;
    const row = rowLoad.data;
    setBusy(true);
    const saved = await toasts.say(session.update("settings", Number(row["id"]), values, { seen: Object.fromEntries(Object.keys(values).map((column) => [column, row[column]])) }), () => done);
    setBusy(false);
    again();
    return saved !== null;
  };
  const opens = String(settings["showroom_opens"] ?? "09:00");
  const closes = String(settings["showroom_closes"] ?? "17:30");
  const address = typeof settings["showroom_address"] === "string" ? settings["showroom_address"] : "";
  const mails = yes(settings["showroom_emails"]);
  const [times, setTimes] = useState<{ opens: string; closes: string } | null>(null);
  const [where, setWhere] = useState<string | null>(null);
  useEffect(() => setTimes(null), [opens, closes]);
  useEffect(() => setWhere(null), [address]);
  const from = times?.opens ?? opens;
  const to = times?.closes ?? closes;
  const order = isClock(from) && isClock(to) && clockMinutes(from) < clockMinutes(to);

  const { load, reload } = useLoad(() => readSpaces(session), [session]);
  const soon = useCoalesced(reload);
  useLive(["showroom_spaces"], soon);
  const spaces = load.state === "ready" ? load.data : [];
  const canSpaces = session.can("showroom_spaces", "update");
  const [adding, setAdding] = useState("");
  const [names, setNames] = useState<Record<number, string>>({});
  const [working, setWorking] = useState(false);
  const key = useRef(newClientKey());

  const commitTimes = (): void => {
    if (!order || (from === opens && to === closes)) return;
    void save({ showroom_opens: from, showroom_closes: to }, t("sh.set.hours.saved", { opens: from, closes: to }));
  };
  const commitAddress = (): void => {
    if (where === null || where.trim() === address) return;
    void save({ showroom_address: where.trim() === "" ? null : where.trim() }, t("sh.set.address.saved"));
  };
  const run = async (write: () => ReturnType<StaffSession["update"]>, done: string): Promise<boolean> => {
    setWorking(true);
    const saved = await write();
    setWorking(false);
    if (saved.state === "refused") toasts.show(t("ui.refused", { reason: saved.error.code === "FK_VIOLATION" || saved.error.status === 409 ? t("sh.set.space.inUse") : reasonOf(saved.error, t) }), "danger", true);
    else if (saved.state === "unknown") toasts.show(t("ui.unknown"), "danger", true);
    else toasts.show(done, "pos");
    soon();
    return saved.state === "saved";
  };
  const add = async (): Promise<void> => {
    const name = adding.trim();
    if (name === "") return;
    if (await run(() => session.create<Space>("showroom_spaces", { name }, key.current), t("sh.set.space.added", { name }))) {
      setAdding("");
      key.current = newClientKey();
    }
  };
  const rename = (space: Space): void => {
    const name = (names[space.id] ?? space.name).trim();
    if (name === "" || name === space.name) return;
    void run(() => session.update<Space>("showroom_spaces", space.id, { name }, { seen: { name: space.name } }), t("sh.set.space.renamed", { name }));
  };

  return (
    <Card name="showroom" title={t("sh.set.title")} sub={t("sh.set.sub")}>
      <div className="crm-ast-label">{t("sh.set.hours")}</div>
      <div className="crm-ast-times">
        {can ? (
          <>
            <input type="time" className="crm-ast-input crm-ast-input-time crm-mono mr-fld" value={from} aria-label={t("sh.set.opens")} aria-invalid={!order} disabled={busy} onChange={(event) => setTimes({ opens: event.target.value, closes: to })} onBlur={commitTimes} />
            <span>{t("aset.work.to")}</span>
            <input type="time" className="crm-ast-input crm-ast-input-time crm-mono mr-fld" value={to} aria-label={t("sh.set.closes")} aria-invalid={!order} disabled={busy} onChange={(event) => setTimes({ opens: from, closes: event.target.value })} onBlur={commitTimes} />
          </>
        ) : (
          <span className="crm-mono" data-figure="showroom-hours">
            {t("sh.bookings.open", { opens, closes })}
          </span>
        )}
      </div>
      {!order && (
        <div role="alert" className="crm-ast-range">
          {t("aset.work.order")}
        </div>
      )}
      <p className="crm-sh-set-note">{t("sh.set.days")}</p>

      <div className="crm-ast-label">{t("sh.set.spaces")}</div>
      <ul className="crm-sh-set-spaces" data-testid="sh-set-spaces">
        {spaces.map((space) => (
          <li key={space.id} data-space={space.id}>
            {canSpaces ? (
              <input
                className="crm-ast-input mr-fld"
                aria-label={t("sh.set.space.name", { name: space.name })}
                value={names[space.id] ?? space.name}
                maxLength={80}
                disabled={working}
                onChange={(event) => setNames({ ...names, [space.id]: event.target.value })}
                onBlur={() => rename(space)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") rename(space);
                }}
              />
            ) : (
              <span>{space.name}</span>
            )}
            {session.can("showroom_spaces", "delete") && (
              <button type="button" className="crm-icon-btn mr-gi" aria-label={t("sh.set.space.remove", { name: space.name })} disabled={working} onClick={() => void run(() => session.remove("showroom_spaces", space.id), t("sh.set.space.removed", { name: space.name }))}>
                <Icon name="trash-2" size={15} />
              </button>
            )}
          </li>
        ))}
        {load.state === "ready" && spaces.length === 0 && <li className="crm-sh-none">{t("sh.set.spaces.none")}</li>}
      </ul>
      {session.can("showroom_spaces", "create") && (
        <form
          className="crm-sh-set-add"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <input className="crm-ast-input mr-fld" aria-label={t("sh.set.space.new")} placeholder={t("sh.set.space.new")} value={adding} maxLength={80} disabled={working} onChange={(event) => setAdding(event.target.value)} />
          <button type="submit" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" disabled={working || adding.trim() === ""}>
            <Icon name="plus" size={14} />
            {t("sh.set.space.add")}
          </button>
        </form>
      )}

      <div className="crm-ast-label">{t("sh.set.address")}</div>
      {can ? (
        <textarea className="crm-ast-input crm-textarea mr-fld" rows={2} maxLength={400} aria-label={t("sh.set.address")} placeholder={t("sh.set.address.hint")} value={where ?? address} disabled={busy} onChange={(event) => setWhere(event.target.value)} onBlur={commitAddress} />
      ) : (
        <p className="crm-sh-set-note">{address === "" ? t("sh.set.address.none") : address}</p>
      )}

      <div className="crm-sh-set-mails">
        <button type="button" role="switch" className="crm-ast-switch mr-gi" aria-checked={mails} aria-label={t("sh.set.mails")} disabled={!can || busy} onClick={() => void save({ showroom_emails: !mails }, t(mails ? "sh.set.mails.off" : "sh.set.mails.on"))} />
        <span>{t("sh.set.mails")}</span>
      </div>
      <p className="crm-sh-set-note">{t(mails ? "sh.set.mails.note.on" : "sh.set.mails.note.off")}</p>
    </Card>
  );
}
