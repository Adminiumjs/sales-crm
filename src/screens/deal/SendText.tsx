/**
 * SEND A TEXT (plan 80, X59): a short text to one of the deal's people, from
 * the deal's room and from its call notes, beside "Log the call".
 *
 * Who it goes to: the deal's people with a number on file, its main contact
 * first. The number is shown left to right inside any language. The words take
 * their own direction (a message in Arabic reads right to left in an English
 * screen). The line that says how to stop is the server's, added after the
 * words, so the screen says so and never writes one.
 *
 * What it says back is the server's (`text.ts`): on its way, waiting for the
 * sending hours and when, or not sent and why. A refusal keeps the dialog
 * open with the reason beside the words. Only a text that went is logged on
 * the deal, as a "text" entry.
 */
import { useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { firstName } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import type { Contact } from "./data.ts";
import { TextAnswer } from "./TextAnswer.tsx";
import { failedWords, refusedKey, sendText, TEXT_MAX, textable, type TextKeys } from "./text.ts";

export interface TextingDeal {
  id: number;
  name: string;
  company: string | null;
  contactId: number | null;
}

export function SendText({ deal, people, ready, mayAnswer, onClose, onSent }: { deal: TextingDeal; people: readonly Contact[]; ready: boolean | null; mayAnswer: boolean; onClose: () => void; onSent: () => void }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const toasts = useToasts();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const choices = useMemo(() => textable(people, deal.contactId), [people, deal.contactId]);
  const [to, setTo] = useState<number | null>(choices[0]?.id ?? null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  // Their answer is being recorded below: nothing closes or sends meanwhile.
  const [answering, setAnswering] = useState(false);
  const [said, setSaid] = useState<{ text: string; tone: "danger" | "warn" } | null>(null);
  // One pair of keys for one person and one set of words: a press after a lost reply sends nothing twice.
  const keys = useRef<{ of: string } & TextKeys>({ of: "", text: "", activity: "" });

  const person = choices.find((one) => one.id === to) ?? null;
  const words = body.trim();
  const blank = words === "";
  const name = person === null ? "" : person.name;

  const send = async (): Promise<void> => {
    if (person === null || blank || busy || ready === false) return;
    const of = `${String(person.id)}:${words}`;
    if (keys.current.of !== of) keys.current = { of, text: newClientKey(), activity: newClientKey() };
    setBusy(true);
    setSaid(null);
    const sent = await sendText(
      session,
      {
        dealId: deal.id,
        contactId: person.id,
        body: words,
        opening: (went) => {
          const who = went.sentTo === null ? person.name : `${person.name} (${went.sentTo})`;
          return went.opensAt === null ? t("text.opening.queued", { name: who }) : t("text.opening.held", { name: who, day: f.dayShort(went.opensAt), time: f.time(went.opensAt) });
        },
      },
      keys.current,
    );
    setBusy(false);
    if (sent.state === "refused") {
      setSaid({ text: t(refusedKey(sent.reason), { name: firstName(name) }), tone: "danger" });
      return;
    }
    if (sent.state === "failed") {
      const why = failedWords(sent.error);
      setSaid({ text: t(why.key, { message: why.message ?? "" }), tone: "danger" });
      return;
    }
    if (sent.state === "unknown") {
      setSaid({ text: t("text.lost"), tone: "warn" });
      return;
    }
    if (sent.logged.state !== "saved") {
      // It went; the keys stay, so a second press logs it without sending it again.
      setSaid({ text: t("text.notLogged", { reason: sent.logged.state === "refused" ? reasonOf(sent.logged.error, t) : t("ui.unknown") }), tone: "warn" });
      onSent();
      return;
    }
    keys.current = { of: "", text: "", activity: "" };
    toasts.show(sent.opensAt === null ? t("text.toast.queued", { name: firstName(name) }) : t("text.toast.held", { name: firstName(name), day: f.dayShort(sent.opensAt), time: f.time(sent.opensAt) }), "pos");
    onSent();
    onClose();
  };

  return (
    <Dialog
      shape="box"
      name="send-text"
      icon="smartphone"
      tone="accent"
      title={t("text.open")}
      subtitle={deal.company === null ? deal.name : `${deal.name} · ${deal.company}`}
      onClose={onClose}
      busy={busy || answering}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("text.cancel")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 mr-btn" data-testid="text-send" disabled={busy || answering || blank || person === null || ready === false} onClick={() => void send()}>
            <Icon name="send" size={16} />
            {busy ? t("text.sending") : t("text.send")}
          </button>
        </>
      }
    >
      {ready === false && (
        <p className="crm-form-error crm-text-said" data-tone="warn" data-testid="text-not-ready">
          <Icon name="triangle-alert" size={16} />
          <span>{t("text.notReady")}</span>
        </p>
      )}
      {choices.length === 0 ? (
        <p className="crm-field-note" data-testid="text-no-phone">
          {t("text.noPhone")}
        </p>
      ) : (
        <>
          <div className="crm-label" id="crm-text-to">
            {t("text.to")}
          </div>
          <div className="crm-why-list crm-text-to" role="radiogroup" aria-labelledby="crm-text-to">
            {choices.map((one) => (
              <button key={one.id} type="button" role="radio" aria-checked={to === one.id} className="crm-why-item mr-row" disabled={busy} onClick={() => setTo(one.id)} data-testid="text-to">
                <span className="crm-why-dot" />
                <span className="crm-text-to-name">{one.name}</span>
                <bdi className="crm-mono crm-text-to-number" dir="ltr">
                  {one.phone}
                </bdi>
              </button>
            ))}
          </div>
          <label className="crm-label" htmlFor="crm-text-body">
            {t("text.message")}
          </label>
          <textarea
            id="crm-text-body"
            className="crm-input crm-textarea crm-text-body mr-fld"
            dir="auto"
            data-autofocus
            value={body}
            maxLength={TEXT_MAX}
            disabled={busy}
            placeholder={t("text.placeholder")}
            aria-describedby="crm-text-count crm-text-rules"
            onChange={(event) => {
              setBody(event.target.value);
              setSaid(null);
            }}
          />
          <div className="crm-text-foot">
            <span id="crm-text-count" className="crm-mono crm-text-count" aria-label={t("text.count", { count: f.number(body.length), max: f.number(TEXT_MAX) })}>
              <bdi dir="ltr">{`${f.number(body.length)} / ${f.number(TEXT_MAX)}`}</bdi>
            </span>
          </div>
          <div id="crm-text-rules">
            <p className="crm-field-note">{t("text.optOut")}</p>
            <p className="crm-field-note">{t("text.consent")}</p>
            <p className="crm-field-note">{t("text.logged")}</p>
          </div>
          {person !== null && <TextAnswer key={person.id} contact={person} mayAnswer={mayAnswer} onBusy={setAnswering} />}
        </>
      )}
      <div aria-live="polite" data-testid="text-said">
        {said !== null && (
          <div className="crm-form-error crm-text-said" data-tone={said.tone}>
            <Icon name={said.tone === "warn" ? "triangle-alert" : "circle-alert"} size={16} />
            <span>{said.text}</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}
