/**
 * A CONTACT'S ANSWER TO TEXTS (plan 80): where they stand for THIS app's texts,
 * and the yes or no they gave a member of staff.
 *
 * Read from `GET /texts/consent` when shown (each read is audited), recorded
 * through `POST /texts/consent`. A yes keeps the words they were read (the
 * enquiry form's box, `text.box`, version `BOX_VERSION`) and how they gave it;
 * nobody is asked to reply YES. A STOP stands whatever is recorded here: the
 * page says who can lift it.
 *
 * Offered to whoever may change the contact or text from the deal; the server
 * decides again on every answer.
 */
import { useEffect, useId, useMemo, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { Dialog } from "../../ui/dialog.tsx";
import { firstName } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import type { Contact } from "./data.ts";
import { BOX_VERSION, HOWS, readStanding, recordAnswer, type How, type Read, type Standing } from "./text.ts";

/** The sentence for where they stand. */
export function standingWords(standing: Standing, t: ReturnType<typeof useT>, day: (at: Date) => string): string {
  const service = standing.service;
  if (standing.stopped !== null) return t(standing.stopped.liftBy === "start" ? "text.standing.stopStart" : standing.stopped.liftBy === "business" ? "text.standing.stopBusiness" : "text.standing.stopNever");
  const by = service.answer?.by?.label ?? "";
  const when = service.answer === null ? "" : day(new Date(service.answer.at));
  switch (service.state) {
    case "yes":
      return [t("text.standing.yes", { day: when }), by === "" ? "" : t("text.standing.by", { name: by })].filter((one) => one !== "").join(" ");
    case "no":
      return [t("text.standing.no", { day: when }), by === "" ? "" : t("text.standing.by", { name: by })].filter((one) => one !== "").join(" ");
    case "no-phone":
      return t("text.standing.noPhone");
    case "stopped":
      return t("text.standing.stopStart");
    default:
      return t("text.standing.notAsked");
  }
}

export function TextAnswer({ contact, mayAnswer, onBusy }: { contact: Contact; mayAnswer: boolean; onBusy?: (busy: boolean) => void }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const id = useId();
  const [read, setRead] = useState<Read<Standing> | null>(null);
  const [how, setHow] = useState<How | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRead(null);
    setHow(null);
    setSaid(null);
    void readStanding(session, contact.id).then((answer) => live && setRead(answer));
    return () => {
      live = false;
    };
  }, [session, contact.id]);

  const standing = read?.state === "ok" ? read.value : null;
  const answerable = mayAnswer && standing !== null && standing.stopped === null && standing.service.state !== "no-phone";

  const answer = async (state: "yes" | "no"): Promise<void> => {
    if (how === null || busy) return;
    setBusy(true);
    onBusy?.(true);
    setSaid(null);
    const done = await recordAnswer(session, contact.id, state === "yes" ? { state, how, wording: { text: t("text.box"), version: BOX_VERSION } } : { state, how });
    setBusy(false);
    onBusy?.(false);
    if (done.state === "ok") {
      setRead(done);
      setHow(null);
      toasts.show(t(state === "yes" ? "text.answer.toast.yes" : "text.answer.toast.no", { name: firstName(contact.name) }), "pos");
      return;
    }
    if (done.state === "failed") {
      setSaid(t("text.answer.failed", { reason: reasonOf(done.error, t) }));
      return;
    }
    setSaid(t("text.answer.lost"));
    setRead(await readStanding(session, contact.id));
  };

  return (
    <section className="crm-text-answer" aria-labelledby={`${id}-title`} data-testid="text-answer">
      <h3 id={`${id}-title`} className="crm-label">
        {t("text.answer.title")}
      </h3>
      <p className="crm-text-standing" aria-live="polite" data-testid="text-standing" data-state={standing === null ? "" : standing.stopped !== null ? "stopped" : standing.service.state}>
        {read === null ? t("text.standing.reading") : read.state === "ok" ? standingWords(read.value, t, f.date) : t("text.standing.failed")}
      </p>
      {answerable && (
        <>
          <p className="crm-field-note">{t("text.answer.read")}</p>
          <blockquote className="crm-text-wording" data-testid="text-wording">
            {t("text.box")}
          </blockquote>
          <div className="crm-label" id={`${id}-how`}>
            {t("text.answer.how")}
          </div>
          <div className="crm-chips" role="radiogroup" aria-labelledby={`${id}-how`}>
            {HOWS.map((one) => (
              <button key={one} type="button" role="radio" aria-checked={how === one} className="crm-chip-btn mr-chip" data-on={how === one ? "1" : "0"} disabled={busy} onClick={() => setHow(one)}>
                {t(`text.how.${one}` as MessageKey)}
              </button>
            ))}
          </div>
          <div className="crm-text-answer-acts">
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-btn" data-testid="text-answer-no" disabled={busy || how === null} onClick={() => void answer("no")}>
              {t("text.answer.no")}
            </button>
            <button type="button" className="crm-btn crm-btn-primary crm-btn-38 mr-btn" data-testid="text-answer-yes" disabled={busy || how === null} onClick={() => void answer("yes")}>
              <Icon name="check" size={15} />
              {t("text.answer.yes")}
            </button>
          </div>
        </>
      )}
      <div aria-live="polite">
        {said !== null && (
          <div className="crm-form-error crm-text-said" data-tone="warn">
            <Icon name="triangle-alert" size={16} />
            <span>{said}</span>
          </div>
        )}
      </div>
    </section>
  );
}

/** The answer on its own, from a contact on the deal room: no text is sent from here. */
export function TextAnswerDialog({ contact, deal, mayAnswer, onClose }: { contact: Contact; deal: string; mayAnswer: boolean; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      shape="box"
      name="text-answer"
      icon="smartphone"
      tone="accent"
      title={t("text.answer.open")}
      subtitle={`${contact.name} · ${deal}`}
      onClose={onClose}
      busy={busy}
      foot={
        <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
          {t("ui.close")}
        </button>
      }
    >
      {contact.phone !== null && (
        <p className="crm-field-note">
          <bdi className="crm-mono" dir="ltr">
            {contact.phone}
          </bdi>
        </p>
      )}
      <TextAnswer contact={contact} mayAnswer={mayAnswer} onBusy={setBusy} />
    </Dialog>
  );
}
