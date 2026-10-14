/**
 * CONTACTS: the people at the companies, and how to reach them.
 * `contacts/<id>` opens the list with that person's sheet at the side, so a
 * person named on another screen (a deal's room) has an address.
 *
 * WHAT A CARD SAYS ABOUT DEALS. "Main contact on <a deal's name>" only when
 * there is one open deal and the reader may open it. Otherwise a count
 * ("main contact on 2 open deals"): a colleague's deal is never named here.
 * The count is the server's, over the deals' marks, for the roles that read
 * deals. The marketer's card says nothing of deals: her count is a company's.
 *
 * A contact's e-mail and phone are personal. A role the server keeps them
 * from (the marketer, Read-only) sees the card without them, and is told so.
 */
import { useCallback, useEffect, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { AccountLink } from "../../selling/AccountLink.tsx";
import { DealLink } from "../../selling/DealLink.tsx";
import { Icon } from "../../shell/icons.tsx";
import { useNav } from "../../shell/nav.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { Loaded, Skeleton, useLive, useLoad } from "../../ui/load.tsx";
import { initials } from "../../ui/people.ts";
import { mainLine, readContacts, toneOf, type ContactCard } from "./data.ts";
import { RecordSheet, type Rec } from "./RecordSheet.tsx";
import { useAccounts } from "./shared.tsx";

const matches = (person: ContactCard, q: string): boolean => `${person.name} ${person.job_title ?? ""} ${person.company ?? ""}`.toLowerCase().includes(q.trim().toLowerCase());

export function ContactsScreen({ rest }: ScreenProps) {
  const t = useT();
  const nav = useNav();
  const { session, f, reach } = useAccounts();
  const [typedNow, setTypedNow] = useState("");
  const [asked, setAsked] = useState("");
  const addressed = rest.length === 1 && /^\d{1,15}$/.test(rest[0]!) ? Number(rest[0]) : null;
  const [rec, setRec] = useState<Rec | null>(addressed === null ? null : { kind: "contact", mode: "view", id: addressed });
  // A person's own address opens their sheet; another address closes it.
  useEffect(() => setRec(addressed === null ? null : { kind: "contact", mode: "view", id: addressed }), [addressed]);

  const { load, reload } = useLoad(() => readContacts(session, reach, asked), [session, reach, asked]);
  useLive(reach === "none" || reach === "count" ? ["contacts"] : ["contacts", "deals", "deal_marks"], reload);
  const overflow = load.state === "ready" && (load.data.total > load.data.rows.length || asked !== "");
  useEffect(() => {
    if (!overflow) return;
    const timer = setTimeout(() => setAsked(typedNow.trim()), 350);
    return () => clearTimeout(timer);
  }, [overflow, typedNow]);

  const canAdd = session.can("contacts", "create");
  const canEdit = session.can("contacts", "update");
  const close = useCallback(() => {
    setRec(null);
    if (addressed !== null) nav.replace("contacts");
  }, [addressed, nav]);

  return (
    <div className="crm-screen crm-acc mr-screen" data-screen="contacts">
      <div className="crm-acc-head">
        <h1>{t("acc.ct.title")}</h1>
        <div className="crm-acc-head-tools">
          <div className="crm-acc-search">
            <Icon name="search" size={15} />
            <input className="crm-input mr-fld" type="search" value={typedNow} aria-label={t("acc.ct.filter")} placeholder={t("acc.ct.filter")} onChange={(event) => setTypedNow(event.target.value)} />
          </div>
          {canAdd && (
            <button type="button" className="crm-btn crm-btn-primary crm-btn-40 mr-btn" onClick={() => setRec({ kind: "contact", mode: "add" })}>
              <Icon name="plus" />
              {t("acc.ct.new")}
            </button>
          )}
        </div>
      </div>
      <p className="crm-screen-sub">{t("acc.ct.sub")}</p>

      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={170} />}>
        {(data) => {
          const rows = overflow ? data.rows : data.rows.filter((person) => matches(person, typedNow));
          return (
            <>
              {!data.details && data.rows.length > 0 && <p className="crm-acc-kept">{t("acc.ct.hidden")}</p>}
              <ul className="crm-acc-grid crm-acc-grid-people" aria-busy={load.state === "ready" && load.again}>
                {rows.map((person) => {
                  const line = mainLine(data.main === null ? null : (data.main[String(person.id)] ?? 0), data.mine[String(person.id)] ?? []);
                  return (
                    <li key={person.id} className="crm-acc-contact mr-card" data-contact={person.id}>
                      <div className="crm-acc-contact-top">
                        <span className="crm-avatar crm-acc-avatar" data-tone={toneOf(person.company_id)} aria-hidden="true">
                          {initials(person.name)}
                        </span>
                        <button type="button" className="crm-acc-contact-who mr-btn" onClick={() => setRec({ kind: "contact", mode: "view", id: person.id })}>
                          <span className="crm-acc-contact-name">{person.name}</span>
                          {person.job_title !== null && <span className="crm-acc-contact-role">{person.job_title}</span>}
                        </button>
                        {canEdit && (
                          <button type="button" className="crm-icon-btn mr-gi" aria-label={t("acc.ct.edit", { name: person.name })} onClick={() => setRec({ kind: "contact", mode: "edit", id: person.id })}>
                            <Icon name="pencil" size={14} />
                          </button>
                        )}
                      </div>
                      {person.company !== null && (
                        <AccountLink to="companies" id={person.company_id} className="crm-chip crm-acc-contact-co">
                          <span className="crm-dot" data-tone="accent" />
                          {person.company}
                        </AccountLink>
                      )}
                      {data.details && (
                        <div className="crm-acc-contact-ways crm-mono">
                          <span>
                            <Icon name="mail" size={12} />
                            {person.email === null || person.email === undefined || person.email === "" ? t("acc.ct.noEmail") : <bdi>{person.email}</bdi>}
                          </span>
                          <span>
                            <Icon name="phone" size={12} />
                            {person.phone === null || person.phone === undefined || person.phone === "" ? t("acc.ct.noPhone") : <bdi>{person.phone}</bdi>}
                          </span>
                        </div>
                      )}
                      {line !== null && (
                        <div className="crm-acc-contact-deals">
                          {line.kind === "deal" ? (
                            // One sentence in the reader's language, with the deal's name as a link where the sentence puts it.
                            (() => {
                              const [lead, tail] = t("acc.ct.main.one", { deal: "\u0000" }).split("\u0000");
                              return (
                                <>
                                  {lead}
                                  <DealLink id={line.id} className="crm-acc-contact-deal">
                                    {line.name}
                                  </DealLink>
                                  {tail}
                                </>
                              );
                            })()
                          ) : (
                            t("acc.ct.main.count", { count: f.number(line.count) }, line.count)
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {rows.length === 0 && (
                <div className="crm-empty crm-acc-empty">
                  <span className="crm-empty-icon" data-tone="plain">
                    <Icon name="contact" size={22} />
                  </span>
                  <div className="crm-empty-title">{t(data.total === 0 && asked === "" ? "acc.ct.none" : "acc.ct.empty")}</div>
                  <p>{t(data.total === 0 && asked === "" ? (canAdd ? "acc.ct.none.body" : "acc.ct.none.read") : "acc.ct.empty.body")}</p>
                </div>
              )}
              {data.total > data.rows.length && <p className="crm-acc-more">{t("acc.list.more", { shown: f.number(data.rows.length), all: f.number(data.total) })}</p>}
            </>
          );
        }}
      </Loaded>
      {rec !== null && (
        <RecordSheet
          rec={rec}
          onClose={close}
          onSaved={reload}
          {...(canEdit ? { onEdit: (person: number) => setRec({ kind: "contact", mode: "edit", id: person }) } : {})}
          onBack={(person) => setRec({ kind: "contact", mode: "view", id: person })}
        />
      )}
    </div>
  );
}
