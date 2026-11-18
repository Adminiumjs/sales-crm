/**
 * "READ THE CHAT": the website chat an enquiry came from, read only.
 *
 * An enquiry made from a chat (a question left outside hours, or one somebody
 * made of a chat in hours) is named on its conversation in the Live chat
 * add-on. This reads that conversation and its messages through the reader's
 * own session (`readChat`), as Forms' invitations are read for a job's survey:
 * the server answers what the reader's role may read, and nothing is written.
 *
 * Who wrote each line is said in the reader's language: the visitor by the
 * name on the enquiry, an automatic answer as such, a colleague by name. The
 * chat's own lines (somebody joined, the visitor left the page, an enquiry was
 * made) are worded here too, by their event; one this screen does not know is
 * shown as the add-on wrote it.
 */
import { useMemo } from "react";

import { useI18n, useT, type TFunction } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Dialog } from "../../ui/dialog.tsx";
import { Loaded, Skeleton, useLoad } from "../../ui/load.tsx";
import { CHAT_LINES, readChat, type ChatLine, type Enquiry } from "./data.ts";
import { namedOf, whenOf } from "./parts.tsx";

/** The chat's own lines this screen words, by their event. */
export const CHAT_EVENTS = ["asked", "handed-over", "taken", "closed", "reopened", "left", "enquiry"] as const;

/** A chat's own line in the reader's language, or as the add-on wrote it when its event is not one of ours. */
export const eventText = (line: Pick<ChatLine, "event" | "body">, t: TFunction): string =>
  line.event !== null && (CHAT_EVENTS as readonly string[]).includes(line.event) ? t(`inbox.chat.event.${line.event}` as MessageKey) : line.body;

/** Who wrote a line: the visitor (by the enquiry's name), an automatic answer, or a colleague by name. */
export function authorOf(line: Pick<ChatLine, "kind" | "authorId">, visitor: string | null, names: Record<string, string>, t: TFunction): string {
  if (line.kind === "visitor") return visitor ?? t("inbox.chat.visitor");
  if (line.kind === "automatic") return t("inbox.chat.automatic");
  return (line.authorId === null ? undefined : names[line.authorId]) ?? t("inbox.chat.staff");
}

export function ReadChat({ enquiry, names, onClose }: { enquiry: Enquiry; names: Record<string, string>; onClose: () => void }) {
  const t = useT();
  const { locale } = useI18n();
  const session = useSession();
  const config = session.config;
  const f = useMemo(() => formatters({ locale, currency: config.currency, timeZone: config.timezone ?? config.serverTimezone }), [locale, config]);
  const now = session.now();
  const { load, reload } = useLoad(() => readChat(session, enquiry.id), [session, enquiry.id]);

  return (
    <Dialog
      shape="sheet"
      name="read-chat"
      icon="message-square"
      title={t("inbox.chat.title")}
      subtitle={namedOf(enquiry, t)}
      onClose={onClose}
      foot={
        <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" onClick={onClose}>
          {t("ui.close")}
        </button>
      }
    >
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={4} height={48} />}>
        {(chat) =>
          chat === null ? (
            <p className="crm-chat-none" data-testid="chat-none">
              {t("inbox.chat.none")}
            </p>
          ) : (
            <>
              <p className="crm-field-note" data-testid="chat-started">
                {whenOf(chat.startedAt, now, f, t)}
                {chat.outsideHours && ` · ${t("inbox.chat.outside")}`}
              </p>
              <ol className="crm-chat-lines" aria-label={t("inbox.chat.title")}>
                {chat.lines.map((line) =>
                  line.kind === "system" ? (
                    <li key={line.id} className="crm-chat-event" data-kind="system" data-event={line.event ?? ""}>
                      <span>{eventText(line, t)}</span>
                      <span className="crm-chat-when crm-mono">{f.time(new Date(line.sentAt))}</span>
                    </li>
                  ) : (
                    <li key={line.id} className="crm-chat-line" data-kind={line.kind}>
                      <div className="crm-chat-head">
                        <span className="crm-chat-who">{authorOf(line, enquiry.person, names, t)}</span>
                        <span className="crm-chat-when crm-mono">{f.time(new Date(line.sentAt))}</span>
                      </div>
                      <p className="crm-chat-body">{line.body}</p>
                    </li>
                  ),
                )}
              </ol>
              {chat.cut && <p className="crm-field-note">{t("inbox.chat.cut", { count: f.number(CHAT_LINES) })}</p>}
            </>
          )
        }
      </Loaded>
    </Dialog>
  );
}
