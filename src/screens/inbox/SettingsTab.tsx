/**
 * THE INBOX, SET UP IN SETTINGS: the brochure an enquirer asks for on a
 * website form, and who rings them two days on while nobody has claimed the
 * enquiry. Both are read by the rule "An enquiry asks for the brochure",
 * which ships switched off: nothing here sends anything until the owner
 * switches it on in Rules. The CRM admin's to write (the server refuses
 * anybody else), every other reader's to read.
 *
 * No link set is a choice, not a gap: the rule then sends no brochure and
 * still books the follow-up. Nobody named means a follow-up only for an
 * enquiry somebody has claimed. A sample person is offered only while the
 * row names them (the sample's own): a sample person cannot sign in, and the
 * rule passes over them.
 */
import { useId, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { Person, StaffSession } from "../../staffSession.ts";
import { Loaded, LoadFailed, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";
import { Card, type Rights } from "../appsettings/parts.tsx";

const NOBODY = "";

/** A brochure's address: a whole https address, nothing else (the e-mail's button opens it). */
export const brochureLinkOk = (text: string): boolean => {
  if (!/^https:\/\/\S+$/i.test(text) || text.length > 500) return false;
  try {
    return new URL(text).hostname.includes(".");
  } catch {
    return false;
  }
};

interface Row extends Record<string, unknown> {
  id: number;
  brochure_link: string | null;
  brochure_follow_up_owner_id: string | null;
}

export function InboxSettings({ session, rights }: { session: StaffSession; rights: Rights }) {
  const t = useT();
  const toasts = useToasts();
  const linkId = useId();
  const { load, reload } = useLoad(
    () =>
      Promise.all([
        session.list<Row>("settings", { select: ["id", "brochure_link", "brochure_follow_up_owner_id"], limit: 1 }).then((page) => page.rows[0] ?? null),
        session.people(undefined, 200).catch(() => [] as Person[]),
      ]),
    [session],
  );
  const again = useCoalesced(reload);
  useLive(["settings"], again);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);

  return (
    <div role="tabpanel" aria-label={t("nav.group.inbox")} className="crm-ast-panel crm-ast-narrow" data-panel="inbox">
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={2} height={140} />}>
        {([row, people]) => {
          if (row === null) return <LoadFailed reload={reload} />;
          const can = rights.all;
          const held = row.brochure_follow_up_owner_id ?? NOBODY;
          const offered = people.filter((person) => person.sample !== true || person.id === held);
          const missing = held !== NOBODY && !offered.some((person) => person.id === held);
          const link = draft ?? row.brochure_link ?? "";
          const save = async (values: Partial<Row>, seen: Partial<Row>, done: string): Promise<void> => {
            setBusy(true);
            await toasts.say(session.update("settings", row.id, values, { seen }), () => done);
            setBusy(false);
            again();
          };
          const commit = (): void => {
            if (draft === null) return;
            const next = draft.trim();
            if (next === (row.brochure_link ?? "")) {
              setDraft(null);
              return;
            }
            if (next !== "" && !brochureLinkOk(next)) {
              setBad(true);
              return;
            }
            setBad(false);
            setDraft(null);
            void save({ brochure_link: next === "" ? null : next }, { brochure_link: row.brochure_link }, t("inset.brochure.link.saved"));
          };
          const choose = (next: string): void => {
            if (next === held) return;
            void save({ brochure_follow_up_owner_id: next === NOBODY ? null : next }, { brochure_follow_up_owner_id: row.brochure_follow_up_owner_id }, t("inset.brochure.owner.saved"));
          };
          return (
            <Card name="brochure" title={t("inset.brochure")} sub={t("inset.brochure.sub")}>
              <label className="crm-ast-label" htmlFor={linkId}>
                {t("inset.brochure.link")}
              </label>
              <input
                id={linkId}
                type="url"
                inputMode="url"
                dir="ltr"
                className="crm-ast-input mr-fld"
                value={link}
                placeholder="https://"
                maxLength={500}
                disabled={!can || busy}
                aria-invalid={bad}
                aria-describedby={`${linkId}-hint`}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setBad(false);
                }}
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commit();
                }}
                data-testid="inset-brochure-link"
              />
              <p id={`${linkId}-hint`} className="crm-ast-hint" role={bad ? "alert" : undefined}>
                {t(bad ? "inset.brochure.link.bad" : "inset.brochure.link.hint")}
              </p>
              <label className="crm-ast-label" htmlFor={`${linkId}-owner`}>
                {t("inset.brochure.owner")}
              </label>
              <select id={`${linkId}-owner`} className="crm-ast-input mr-fld" value={held} disabled={!can || busy} onChange={(event) => choose(event.target.value)} aria-describedby={`${linkId}-owner-hint`} data-testid="inset-brochure-owner">
                <option value={NOBODY}>{t("inset.brochure.owner.none")}</option>
                {missing && <option value={held}>{t("closed.someone")}</option>}
                {offered.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
              <p id={`${linkId}-owner-hint`} className="crm-ast-hint">
                {t("inset.brochure.owner.sub")}
              </p>
            </Card>
          );
        }}
      </Loaded>
    </div>
  );
}
