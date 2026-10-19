/**
 * SETTINGS → CREWS (F20, stage 2): the crews, the people in each, the days
 * each works, and what a delivery's e-mail says to the customer. Set up
 * before day one: a crew with no days cannot be booked (the server's "That
 * day is closed."), and a crew member who is in no crew sees nothing on his
 * phone.
 *
 * WHO WRITES WHAT, held by the server: the operations manager and the CRM
 * admin keep the crews, their people and days; the e-mail switch and the
 * office's phone are the CRM admin's (settings); Read-only reads it all.
 * Somebody whose roles do not reach a crew's work cannot be put in a crew
 * (the engine's rule for every listing, decision 10): the server refuses, and
 * this tab says why.
 */
import { useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import { newClientKey, type Person, type StaffSession } from "../../staffSession.ts";
import { Loaded, LoadFailed, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { DAYS, type Day } from "../appsettings/data.ts";
import { Card } from "../appsettings/parts.tsx";
import { crewPeople, dayHoursOf, num, readCrewFacts, truthy, type Crew, type CrewFacts, type Member } from "./data.ts";
import { SettingNumbers } from "../appsettings/Numbers.tsx";
import { hoursOf, useJobsScreen } from "./parts.tsx";

/** A day's name from the reader's language: 2024-01-01 was a Monday. */
const dayDate = (day: Day): Date => new Date(Date.UTC(2024, 0, 1 + DAYS.indexOf(day), 12));

export function CrewsTab({ session }: { session: StaffSession }) {
  const t = useT();
  const { load, reload } = useLoad(() => Promise.all([readCrewFacts(session), session.people(undefined, 200).catch(() => [] as Person[])]), [session]);
  const again = useCoalesced(reload);
  useLive(["crews", "crew_members", "crew_days", "settings"], again);
  const canCrews = session.can("crews", "update");
  const canAdd = session.can("crews", "create");

  return (
    <div role="tabpanel" aria-label={t("jb.tab.crews")} className="crm-ast-panel crm-jb-crews-tab" data-panel="crews">
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={2} height={180} />}>
        {([facts, people]) => (
          <>
            {facts.crews.map((crew, i) => (
              <CrewCard key={crew.id} crew={crew} index={i} facts={facts} people={people} onDone={again} />
            ))}
            {facts.crews.length === 0 && (
              <div className="crm-empty">
                <span className="crm-empty-icon">
                  <Icon name="users" size={20} />
                </span>
                <div className="crm-empty-title">{t("jb.set.none")}</div>
                <p>{t(canAdd ? "jb.set.none.body" : "jb.set.none.read")}</p>
              </div>
            )}
            {canAdd && <NewCrew onDone={again} />}
            <MailsCard facts={facts} onDone={again} />
            {session.part("jobs") && <SnagDays />}
            {!canCrews && <p className="crm-jb-quiet">{t("jb.set.ask")}</p>}
          </>
        )}
      </Loaded>
    </div>
  );
}

function CrewCard({ crew, index, facts, people, onDone }: { crew: Crew; index: number; facts: CrewFacts; people: Person[]; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session, f } = useJobsScreen();
  const can = session.can("crews", "update");
  const canDays = session.can("crew_days", "create") && session.can("crew_days", "delete");
  const canPeople = session.can("crew_members", "create");
  const [name, setName] = useState(crew.name);
  const [hours, setHours] = useState(crew.day_hours === null || crew.day_hours === "" ? "" : String(num(crew.day_hours)));
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => newClientKey());
  const days = facts.days.get(crew.id) ?? new Set<Day>();
  const members = crewPeople(facts, crew.id);
  const inThis = new Set(members.map((one) => one.member.user_id));
  const choices = people.filter((person) => !inThis.has(person.id) && person.sample !== true).sort((a, b) => a.name.localeCompare(b.name));

  const run = async <R,>(save: Promise<import("../../staffSession.ts").Saved<R>>, done: string): Promise<boolean> => {
    setBusy(true);
    const saved = await toasts.say(save, () => done);
    setBusy(false);
    onDone();
    return saved !== null;
  };
  const saveName = (): void => {
    if (name.trim() === "" || name.trim() === crew.name) return setName(crew.name);
    void run(session.update("crews", crew.id, { name: name.trim() }, { seen: { name: crew.name } }), t("jb.set.renamed", { crew: name.trim() }));
  };
  const saveHours = (): void => {
    const next = hours.trim() === "" ? null : Number(hours.replace(",", "."));
    const was = crew.day_hours === null || crew.day_hours === "" ? null : num(crew.day_hours);
    if (next === was || (next !== null && (!Number.isFinite(next) || next < 1 || next > 16))) return setHours(was === null ? "" : String(was));
    void run(session.update("crews", crew.id, { day_hours: next }), t("jb.set.hours.saved", { crew: crew.name }));
  };
  const toggleDay = async (day: Day): Promise<void> => {
    const row = await session.list<{ id: number }>("crew_days", { select: ["id"], where: { and: [{ column: "crew_id", op: "eq", value: crew.id }, { column: "weekday", op: "eq", value: day }] }, limit: 1 });
    const words = f.weekdayLong(dayDate(day));
    if (row.rows[0] !== undefined) await run(session.remove("crew_days", row.rows[0].id), t("jb.set.day.off", { crew: crew.name, day: words }));
    else await run(session.create("crew_days", { crew_id: crew.id, weekday: day }, newClientKey()), t("jb.set.day.on", { crew: crew.name, day: words }));
  };
  const addPerson = async (): Promise<void> => {
    if (adding === "") return;
    const person = people.find((one) => one.id === adding);
    setBusy(true);
    const saved = await session.create("crew_members", { crew_id: crew.id, user_id: adding, lead: members.length === 0 }, key);
    setBusy(false);
    if (saved.state === "saved") {
      toasts.show(t("jb.set.person.added", { name: person?.name ?? "", crew: crew.name }), "pos");
      setAdding("");
      setKey(newClientKey());
    } else if (saved.state === "refused") toasts.show(t("ui.refused", { reason: saved.error.status === 422 || saved.error.code === "VALIDATION_FAILED" ? t("jb.set.person.cannot", { name: person?.name ?? "" }) : reasonOf(saved.error, t) }), "danger", true);
    else toasts.show(t("ui.unknown"), "danger", true);
    onDone();
  };

  return (
    <Card name={`crew-${String(crew.id)}`} title={crew.name} sub={t("jb.set.crew.sub", { hours: hoursOf(f, dayHoursOf(facts, crew.id)), count: f.number(members.length) }, members.length)}>
      <div className="crm-jb-crew" data-crew={crew.id}>
        <span className="crm-jb-dot" data-colour={index % 8} aria-hidden="true" />
        <div className="crm-jb-crew-fields">
          <div>
            <label className="crm-ast-label" htmlFor={`crm-jb-crew-name-${String(crew.id)}`}>
              {t("jb.set.name")}
            </label>
            <input id={`crm-jb-crew-name-${String(crew.id)}`} className="crm-ast-input mr-fld" value={name} maxLength={80} readOnly={!can} disabled={busy} onChange={(event) => setName(event.target.value)} onBlur={saveName} onKeyDown={(event) => event.key === "Enter" && saveName()} />
          </div>
          <div>
            <label className="crm-ast-label" htmlFor={`crm-jb-crew-hours-${String(crew.id)}`}>
              {t("jb.set.hours")}
            </label>
            <input
              id={`crm-jb-crew-hours-${String(crew.id)}`}
              className="crm-ast-input crm-mono mr-fld"
              inputMode="decimal"
              value={hours}
              placeholder={t("jb.set.hours.same", { hours: hoursOf(f, dayHoursOf({ crews: [], settings: facts.settings }, null)) })}
              readOnly={!can}
              disabled={busy}
              onChange={(event) => setHours(event.target.value)}
              onBlur={saveHours}
              onKeyDown={(event) => event.key === "Enter" && saveHours()}
            />
          </div>
        </div>
      </div>
      <div className="crm-ast-label">{t("jb.set.days")}</div>
      <div className="crm-chips" role="group" aria-label={t("jb.set.days.of", { crew: crew.name })}>
        {DAYS.map((day) => (
          <button key={day} type="button" className="crm-chip-btn mr-chip" aria-pressed={days.has(day)} title={f.weekdayLong(dayDate(day))} data-weekday={day} disabled={!canDays || busy} onClick={() => void toggleDay(day)}>
            {f.weekdayShort(dayDate(day))}
          </button>
        ))}
      </div>
      {days.size === 0 && <p className="crm-ast-range" role="status">{t("jb.set.days.none")}</p>}
      <div className="crm-ast-label">{t("jb.set.people")}</div>
      <ul className="crm-jb-people" data-testid={`jb-crew-people-${String(crew.id)}`}>
        {members.map(({ member, name: who }) => (
          <PersonRow key={member.id} member={member} name={who} crew={crew} leads={members.map((one) => one.member).filter((one) => truthy(one.lead))} onDone={onDone} />
        ))}
        {members.length === 0 && <li className="crm-jb-quiet">{t("jb.set.people.none")}</li>}
      </ul>
      {canPeople && (
        <div className="crm-jb-addperson">
          <label className="crm-sr" htmlFor={`crm-jb-add-${String(crew.id)}`}>
            {t("jb.set.person.add.label", { crew: crew.name })}
          </label>
          <select id={`crm-jb-add-${String(crew.id)}`} className="crm-ast-input mr-fld" value={adding} disabled={busy} onChange={(event) => setAdding(event.target.value)}>
            <option value="">{t("jb.set.person.pick")}</option>
            {choices.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 mr-gi" disabled={adding === "" || busy} onClick={() => void addPerson()}>
            <Icon name="user-round-plus" size={14} />
            {t("jb.set.person.add")}
          </button>
        </div>
      )}
    </Card>
  );
}

function PersonRow({ member, name, crew, leads, onDone }: { member: Member; name: string; crew: Crew; leads: Member[]; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session } = useJobsScreen();
  const can = session.can("crew_members", "update");
  const canRemove = session.can("crew_members", "delete");
  const masked = ((member as unknown as { _masked?: string[] })._masked ?? []).includes("phone");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (values: Record<string, unknown>, done: string): Promise<void> => {
    setBusy(true);
    await toasts.say(session.update("crew_members", member.id, values), () => done);
    setBusy(false);
    onDone();
  };
  // One lead a crew: the one who led it stops, then this person leads.
  const makeLead = async (): Promise<void> => {
    setBusy(true);
    for (const other of leads.filter((one) => one.id !== member.id)) await session.update("crew_members", other.id, { lead: false }, { seen: { lead: true } });
    setBusy(false);
    await save({ lead: true }, t("jb.set.lead.done", { name, crew: crew.name }));
  };
  return (
    <li className="crm-jb-person" data-member={member.id}>
      <span className="crm-avatar crm-avatar-sm" aria-hidden="true">
        {name.slice(0, 1)}
      </span>
      <span className="crm-jb-person-name">{name}</span>
      {truthy(member.lead) ? (
        <span className="crm-pill" data-tone="accent">
          {t("jb.set.lead")}
        </span>
      ) : (
        can && (
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-28 mr-gi" disabled={busy} onClick={() => void makeLead()}>
            {t("jb.set.lead.make")}
          </button>
        )
      )}
      {!masked && (
        <input
          className="crm-ast-input crm-mono crm-jb-person-phone mr-fld"
          type="tel"
          dir="ltr"
          aria-label={t("jb.set.phone", { name })}
          placeholder={t("jb.set.phone.hint")}
          value={phone}
          maxLength={40}
          readOnly={!can}
          disabled={busy}
          onChange={(event) => setPhone(event.target.value)}
          onBlur={() => phone.trim() !== (member.phone ?? "") && void save({ phone: phone.trim() === "" ? null : phone.trim() }, t("jb.set.phone.saved", { name }))}
        />
      )}
      {canRemove && (
        <button type="button" className="crm-icon-btn crm-icon-btn-sm mr-gi" aria-label={t("jb.set.person.remove", { name, crew: crew.name })} disabled={busy} onClick={() => void (async () => {
          setBusy(true);
          await toasts.say(session.remove("crew_members", member.id), () => t("jb.set.person.removed", { name, crew: crew.name }));
          setBusy(false);
          onDone();
        })()}>
          <Icon name="x" size={14} />
        </button>
      )}
    </li>
  );
}

function NewCrew({ onDone }: { onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session } = useJobsScreen();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => newClientKey());
  const go = async (): Promise<void> => {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    const saved = await toasts.say(session.create("crews", { name: name.trim() }, key), () => t("jb.set.added", { crew: name.trim() }));
    setBusy(false);
    if (saved !== null) {
      setName("");
      setKey(newClientKey());
      onDone();
    }
  };
  return (
    <Card name="new-crew" title={t("jb.set.new")} sub={t("jb.set.new.sub")}>
      <div className="crm-jb-addperson">
        <label className="crm-sr" htmlFor="crm-jb-new-crew">
          {t("jb.set.name")}
        </label>
        <input id="crm-jb-new-crew" className="crm-ast-input mr-fld" value={name} maxLength={80} placeholder={t("jb.set.new.hint")} disabled={busy} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void go()} />
        <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" disabled={name.trim() === "" || busy} onClick={() => void go()}>
          <Icon name="plus" size={14} />
          {t("jb.set.new.go")}
        </button>
      </div>
    </Card>
  );
}

/** How long a snag has to be put right (P24): the CRM admin's to set, read by the snag list's due days. */
function SnagDays() {
  const t = useT();
  const { session, f } = useJobsScreen();
  const slugs = (session.config.access?.roles ?? []).map((role) => role.slug).filter((slug) => slug.startsWith("crm-"));
  const can = session.can("settings", "update") && (slugs.length === 0 || slugs.includes("crm-admin"));
  return <SettingNumbers session={session} f={f} can={can} name="snag-days" title={t("jb.set.snags")} sub={t("jb.set.snags.sub")} fields={[{ column: "snag_days", label: t("jb.set.snag.days"), unit: (n) => t("aset.unit.days", undefined, n) }]} />;
}

/** What a delivery's e-mail says, and whether it goes: the CRM admin's two settings. */
function MailsCard({ facts, onDone }: { facts: CrewFacts; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const { session } = useJobsScreen();
  const settings = facts.settings;
  const slugs = (session.config.access?.roles ?? []).map((role) => role.slug).filter((slug) => slug.startsWith("crm-"));
  const can = session.can("settings", "update") && (slugs.length === 0 || slugs.includes("crm-admin"));
  const [phone, setPhone] = useState(settings?.office_phone ?? "");
  const [busy, setBusy] = useState(false);
  if (settings === null) return <LoadFailed reload={onDone} />;
  const on = truthy(settings.delivery_emails);
  const save = async (values: Record<string, unknown>, done: string): Promise<void> => {
    setBusy(true);
    await toasts.say(session.update("settings", settings.id, values, { seen: Object.fromEntries(Object.keys(values).map((column) => [column, settings[column]])) }), () => done);
    setBusy(false);
    onDone();
  };
  return (
    <Card name="delivery-mails" title={t("jb.set.mails")} sub={t("jb.set.mails.sub")}>
      <div className="crm-chips" role="group" aria-label={t("jb.set.mails")}>
        <button type="button" className="crm-chip-btn mr-chip" aria-pressed={on} disabled={!can || busy} data-testid="jb-mails-on" onClick={() => !on && void save({ delivery_emails: true }, t("jb.set.mails.on"))}>
          {t("jb.set.mails.yes")}
        </button>
        <button type="button" className="crm-chip-btn mr-chip" aria-pressed={!on} disabled={!can || busy} data-testid="jb-mails-off" onClick={() => on && void save({ delivery_emails: false }, t("jb.set.mails.off"))}>
          {t("jb.set.mails.no")}
        </button>
      </div>
      <label className="crm-ast-label" htmlFor="crm-jb-office-phone">
        {t("jb.set.office")}
      </label>
      <input
        id="crm-jb-office-phone"
        className="crm-ast-input crm-mono mr-fld"
        type="tel"
        dir="ltr"
        value={phone}
        maxLength={40}
        readOnly={!can}
        disabled={busy}
        placeholder={t("jb.set.office.hint")}
        onChange={(event) => setPhone(event.target.value)}
        onBlur={() => phone.trim() !== (settings.office_phone ?? "") && void save({ office_phone: phone.trim() === "" ? null : phone.trim() }, t("jb.set.office.saved"))}
      />
      <p className="crm-jb-quiet">{t(phone.trim() === "" ? "jb.set.office.none" : "jb.set.office.said")}</p>
      {!can && <p className="crm-jb-quiet">{t("jb.set.mails.ask")}</p>}
    </Card>
  );
}

