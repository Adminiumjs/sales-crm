/**
 * MESSAGES (ledger screen 34): the conversations the reader is in, between
 * the people who sign in here.
 *
 * WHAT THE SERVER HOLDS. A conversation and its messages are read by its
 * members and by nobody else (the CRM admin and the sales manager read the
 * ones they are in, like anybody). A message's writer and its moment are
 * stamped by the server. Each member moves only their own "read up to here".
 *
 * WHO COUNTS. "Unread" is, per conversation, the total the server answers
 * for the messages written by somebody else since the reader's own mark.
 * Picking a conversation moves the mark to the server's clock (the one shown
 * on arrival stays unread until it is pressed or answered).
 *
 * LIVE. The screen listens for new messages and marks: a colleague's message
 * appears in the open conversation without a reload.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { Formatters } from "../../lib/format.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey, type Condition, type StaffSession } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { Avatar, countOf, Empty, Head, NOBODY, readWho, useF, type Names } from "./common.tsx";

interface Thread extends Record<string, unknown> {
  id: number;
  title: string | null;
  kind: "direct" | "group";
}
interface Member extends Record<string, unknown> {
  id: number;
  thread_id: number;
  user_id: string;
  read_at: string | null;
}
interface Message extends Record<string, unknown> {
  id: number;
  thread_id: number;
  author_id: string;
  text: string;
  at: string;
}
interface Listed {
  thread: Thread;
  members: Member[];
  /** The reader's own membership: where their mark is kept. */
  mine: Member | null;
  last: Message | null;
  unread: number;
}

async function readThreads(session: StaffSession, me: string): Promise<Listed[]> {
  const threads = (await session.list<Thread>("threads", { select: ["id", "title", "kind"], order: ["id"], limit: 200 })).rows;
  if (threads.length === 0) return [];
  const ids = threads.map((thread) => thread.id);
  const within: Condition = { column: "thread_id", op: "in", value: ids };
  const [members, recent] = await Promise.all([
    session.list<Member>("thread_members", { select: ["id", "thread_id", "user_id", "read_at"], where: within, order: ["id"], limit: 200 }).then((page) => page.rows),
    // Newest first: the first row of each conversation is its last message.
    session.list<Message>("messages", { select: ["id", "thread_id", "author_id", "text", "at"], where: within, order: ["at.desc", "id.desc"], limit: 200 }).then((page) => page.rows),
  ]);
  const listed = await Promise.all(
    threads.map(async (thread): Promise<Listed> => {
      const theirs = members.filter((member) => member.thread_id === thread.id);
      const mine = theirs.find((member) => member.user_id === me) ?? null;
      const unread = await countOf(session, "messages", {
        and: [{ column: "thread_id", op: "eq", value: thread.id }, { column: "author_id", op: "neq", value: me }, ...(mine?.read_at === null || mine?.read_at === undefined ? [] : [{ column: "at", op: "gt" as const, value: mine.read_at }])],
      });
      return { thread, members: theirs, mine, last: recent.find((message) => message.thread_id === thread.id) ?? null, unread };
    }),
  );
  // The conversation somebody wrote in last comes first.
  return listed.sort((a, b) => (b.last === null ? 0 : Date.parse(b.last.at)) - (a.last === null ? 0 : Date.parse(a.last.at)));
}

const readMessages = (session: StaffSession, thread: number): Promise<Message[]> =>
  session.list<Message>("messages", { select: ["id", "thread_id", "author_id", "text", "at"], where: { column: "thread_id", op: "eq", value: thread }, order: ["at.desc", "id.desc"], limit: 200 }).then((page) => [...page.rows].reverse());

function titleOf(listed: Listed, me: string, names: Names, group: string): string {
  if (listed.thread.kind === "group") return listed.thread.title ?? group;
  const other = listed.members.find((member) => member.user_id !== me);
  return other === undefined ? (listed.thread.title ?? group) : (names[other.user_id] ?? "");
}

export function Messages(_: ScreenProps) {
  const t = useT();
  const f = useF();
  const session = useSession();
  const toasts = useToasts();
  const me = session.config.user?.id ?? "";
  const { load: whoLoad } = useLoad(() => readWho(session), [session]);
  const who = whoLoad.state === "ready" ? whoLoad.data : NOBODY;
  const { load, reload } = useLoad(() => readThreads(session, me), [session, me]);
  const [picked, setPicked] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const again = useCoalesced(
    useCallback(() => {
      setRound((n) => n + 1);
      reload();
    }, [reload]),
  );
  useLive(["messages", "thread_members"], again);
  const [marking, setMarking] = useState(false);

  /** Move the reader's own mark on these conversations to the server's clock, one row at a time. */
  const markRead = async (rows: Listed[], say: boolean): Promise<void> => {
    const todo = rows.filter((row) => row.mine !== null && row.unread > 0 && session.can("thread_members", "update"));
    if (todo.length === 0) return;
    setMarking(true);
    const at = session.now().toISOString();
    let refused = false;
    for (const row of todo) {
      const saved = await session.update("thread_members", row.mine!.id, { read_at: at });
      if (saved.state !== "saved") refused = true;
    }
    setMarking(false);
    if (say) toasts.show(refused ? t("ui.unknown") : t("msgs.toast.allRead"), refused ? "danger" : "plain");
    again();
  };

  return (
    <div className="crm-screen crm-msgs mr-screen" data-screen="messages">
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={4} height={64} />}>
        {(threads) => {
          const shown = threads.find((row) => row.thread.id === picked) ?? threads[0] ?? null;
          const unread = threads.some((row) => row.unread > 0);
          return (
            <>
              <Head title={t("msgs.h1")} sub={t("msgs.sub")}>
                {unread && session.can("thread_members", "update") && (
                  <button type="button" className="crm-btn crm-btn-ghost crm-btn-38 mr-gi" data-testid="msgs-read-all" disabled={marking} onClick={() => void markRead(threads, true)}>
                    {t("msgs.readAll")}
                  </button>
                )}
              </Head>
              {shown === null ? (
                <Empty icon="send" title={t("msgs.none")} body={t("msgs.none.body")} />
              ) : (
                <div className="crm-ms-grid">
                  <nav className="crm-ms-list" aria-label={t("msgs.list")}>
                    {threads.map((row) => {
                      const title = titleOf(row, me, who.names, t("msgs.group"));
                      const on = row.thread.id === shown.thread.id;
                      return (
                        <button key={row.thread.id} type="button" className="crm-ms-thread mr-gi" aria-current={on ? "true" : undefined} data-thread={row.thread.id} data-unread={row.unread > 0 ? "1" : "0"} onClick={() => setPicked(row.thread.id)}>
                          {row.thread.kind === "group" ? (
                            <span className="crm-avatar" data-tone="accent" aria-hidden="true">
                              {f.number(row.members.length)}
                            </span>
                          ) : (
                            <Avatar name={title} />
                          )}
                          <span className="crm-ms-thread-main">
                            <span className="crm-ms-thread-top">
                              <strong>{title}</strong>
                              {row.last !== null && <span className="crm-mono">{whenOf(new Date(row.last.at), session.now(), f, t("visits.day.yesterday"))}</span>}
                            </span>
                            <span className="crm-ms-preview">
                              {row.last === null ? t("msgs.empty") : `${row.last.author_id === me ? `${t("msgs.you")} ` : ""}${row.last.text}`}
                            </span>
                          </span>
                          {row.unread > 0 && (
                            <span className="crm-ms-badge crm-mono" aria-label={t("msgs.unread", { count: f.number(row.unread) }, row.unread)}>
                              {f.number(row.unread)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </nav>
                  <Conversation key={shown.thread.id} row={shown} title={titleOf(shown, me, who.names, t("msgs.group"))} names={who.names} f={f} me={me} round={round} opened={picked === shown.thread.id} onOpen={() => void markRead([shown], false)} onSent={again} />
                </div>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

/** `08:31` for today, `Yesterday`, else the day. */
function whenOf(at: Date, now: Date, f: Formatters, yesterday: string): string {
  const days = f.dayDiff(at, now);
  return days <= 0 ? f.time(at) : days === 1 ? yesterday : f.dayShort(at);
}

function Conversation({ row, title, names, f, me, round, opened, onOpen, onSent }: { row: Listed; title: string; names: Names; f: Formatters; me: string; round: number; /** The reader picked this conversation (the one shown on arrival is not yet "read"). */ opened: boolean; onOpen: () => void; onSent: () => void }) {
  const t = useT();
  const session = useSession();
  const toasts = useToasts();
  const { load, reload } = useLoad(() => readMessages(session, row.thread.id), [session, row.thread.id, round]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(newClientKey());
  const end = useRef<HTMLDivElement>(null);
  const count = load.state === "ready" ? load.data.length : 0;
  // Picked, or a new message arrived while it is open: it has been read. The conversation shown on arrival waits for a press.
  useEffect(() => {
    if (opened && row.unread > 0) onOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per pick and per new unread message
  }, [opened, row.thread.id, row.unread]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [count]);
  const canSend = session.can("messages", "create") && row.mine !== null;
  const others = row.members.filter((member) => member.user_id !== me);

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (text === "" || busy) return;
    setBusy(true);
    const saved = await session.create("messages", { thread_id: row.thread.id, text }, key.current);
    setBusy(false);
    if (saved.state === "refused") return toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    if (saved.state === "unknown") return toasts.show(t("ui.unknown"), "danger", true);
    key.current = newClientKey();
    setDraft("");
    if (row.unread > 0) onOpen();
    onSent();
  };

  return (
    <section className="crm-ms-talk" aria-label={title} data-testid="msgs-talk">
      <div className="crm-ms-talk-head">
        {row.thread.kind === "group" ? (
          <span className="crm-avatar" data-tone="accent" aria-hidden="true">
            {f.number(row.members.length)}
          </span>
        ) : (
          <Avatar name={title} />
        )}
        <div>
          <strong>{title}</strong>
          {row.thread.kind === "group" && (
            <span>
              {row.members
                .map((member) => firstName(names[member.user_id] ?? ""))
                .filter((name) => name !== "")
                .join(", ")}
            </span>
          )}
        </div>
      </div>
      <div className="crm-ms-scroll mr-scroll" role="log" aria-live="polite" tabIndex={0} aria-label={t("msgs.log", { name: title })}>
        <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={44} />}>
          {(messages) => (
            <>
              {messages.length === 0 && <p className="crm-tw-quiet crm-ms-nothing">{t("msgs.empty")}</p>}
              {messages.map((message, at) => {
                const mine = message.author_id === me;
                const before = messages[at - 1];
                const when = new Date(message.at);
                return (
                  <div key={message.id} className="crm-ms-msg" data-mine={mine ? "1" : "0"} data-message={message.id}>
                    {!mine && (before === undefined || before.author_id !== message.author_id) && (
                      <div className="crm-ms-who">
                        <Avatar name={names[message.author_id] ?? ""} size="sm" />
                        <span>{names[message.author_id] ?? ""}</span>
                      </div>
                    )}
                    <div className="crm-ms-bubble">{message.text}</div>
                    <div className="crm-ms-when crm-mono">{f.dayDiff(when, session.now()) <= 0 ? f.time(when) : `${f.dayShort(when)} · ${f.time(when)}`}</div>
                  </div>
                );
              })}
              <div ref={end} />
            </>
          )}
        </Loaded>
      </div>
      {canSend ? (
        <div className="crm-tw-add crm-ms-send">
          <input
            className="crm-input mr-fld"
            aria-label={t("msgs.write.label", { name: title })}
            value={draft}
            maxLength={4000}
            disabled={busy}
            placeholder={row.thread.kind === "group" || others.length !== 1 ? t("msgs.write.team") : t("msgs.write", { name: firstName(title) })}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void send();
            }}
          />
          <button type="button" className="crm-btn crm-btn-primary crm-btn-38 mr-btn" data-go disabled={draft.trim() === "" || busy} onClick={() => void send()}>
            <Icon name="send" size={14} />
            {t("msgs.send")}
          </button>
        </div>
      ) : (
        <p className="crm-tw-quiet crm-ms-nothing">{t("msgs.readOnly")}</p>
      )}
    </section>
  );
}
