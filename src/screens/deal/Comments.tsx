/**
 * A DEAL'S COMMENTS (`deals/<id>/comments`): the team talking among
 * themselves. The customer never sees them, and they are not in the activity
 * log.
 *
 * A thread is a comment and the replies under it. Whoever wrote it (or leads
 * who did) settles it; a settled thread is put away until "Show settled".
 *
 * MENTIONS are Adminium's own: the box is its mention box (`kitParts.ts`),
 * the text keeps each colleague named as Adminium stores it, and it is the
 * server that tells them, after the save. It never sends them what was
 * written, and somebody who cannot open the deal gets no way in. This page
 * cannot ask the server who can open a deal, so the quiet line under the box
 * is said for anybody named who is not on it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n, useT } from "../../i18n/index.tsx";
import { kitCommon } from "../../kitParts.ts";
import { scopeOf } from "../../selling/figures.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import { ScreenLink } from "../../shell/nav.tsx";
import { newClientKey, type Saved } from "../../staffSession.ts";
import { KitPart } from "../../ui/kit.tsx";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName, initials } from "../../ui/people.ts";
import { useToasts } from "../../ui/toast.tsx";
import { readNames } from "../quotes/data.ts";
import { mentioned, mentionParts, readComments, threadsOf, type Comment } from "./data.ts";
import { NoDeal } from "./Room.tsx";

interface MentionProps {
  value: string;
  onChange: (stored: string) => void;
  locale: string;
  dir: "ltr" | "rtl";
  ariaLabel: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

/** Adminium's mention box. `round` going up empties it (after a save); typing never hands the text back. Where the kit cannot be drawn, a plain box: the text is saved all the same, and nobody is named. */
function MentionBox({ label, placeholder, rows, disabled, round, onChange, name }: { label: string; placeholder: string; rows: number; disabled: boolean; round: number; onChange: (stored: string) => void; name: string }) {
  const { locale } = useI18n();
  const session = useSession();
  const t = useT();
  const latest = useRef(onChange);
  latest.current = onChange;
  const [plain, setPlain] = useState("");
  useEffect(() => setPlain(""), [round]);
  const props = useMemo<MentionProps>(
    () => ({ ...kitCommon(session.config, locale), value: "", onChange: (stored: string) => latest.current(stored), ariaLabel: label, placeholder, rows }),
    // `round` is named so a save hands the box an empty text again. Nothing else may change these: every change hands the box its `value`, and a box emptied while its save is on the way would lose a text the server then refuses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, locale, label, placeholder, rows, round],
  );
  return (
    <div className="crm-cmt-box" data-box={name}>
      <KitPart<MentionProps>
        part="mentions"
        props={props}
        fallback={() => (
          <>
            <textarea
              className="crm-input crm-textarea mr-fld"
              aria-label={label}
              rows={rows}
              value={plain}
              maxLength={2000}
              disabled={disabled}
              placeholder={placeholder}
              onChange={(event) => {
                setPlain(event.target.value);
                latest.current(event.target.value);
              }}
            />
            <p className="crm-room-quiet">{t("cmt.noKit")}</p>
          </>
        )}
      />
    </div>
  );
}

function Words({ text }: { text: string }) {
  return (
    <p className="crm-cmt-text">
      {mentionParts(text).map((part, index) =>
        "mention" in part ? (
          <span key={index} className="crm-cmt-mention" data-mention={part.id}>
            @{part.mention}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

export function Comments({ id }: { id: string }) {
  const t = useT();
  const session = useSession();
  const toasts = useToasts();
  const key = Number(id);
  const me = session.config.user?.id ?? null;
  const team = useMemo(() => scopeOf(session) === "team", [session]);
  const { load, reload } = useLoad(() => (Number.isInteger(key) && session.can("comments", "read") ? readComments(session, key) : Promise.resolve(null)), [session, key]);
  const again = useCoalesced(reload);
  useLive(useMemo(() => ["comments", "deal_members"].filter((table) => session.can(table, "read")), [session]), again);

  const authors = load.state === "ready" && load.data !== null ? [...new Set([load.data.deal.owner_id, ...load.data.comments.flatMap((comment) => [comment.author_id, comment.settled_at === null ? null : comment.settled_by_id])].filter((one): one is string => one !== null))].sort().join(",") : "";
  const names = useLoad(() => readNames(session, authors === "" ? [] : authors.split(",")), [session, authors]);
  const nameOf = useCallback((userId: string | null): string => (userId === null ? "" : ((names.load.state === "ready" ? names.load.data[userId] : undefined) ?? t("closed.someone"))), [names.load, t]);

  const [showSettled, setShowSettled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [round, setRound] = useState(0);
  const [replies, setReplies] = useState<Record<number, string>>({});
  const [rounds, setRounds] = useState<Record<number, number>>({});
  // One key per text sent: a reply lost on the way is sent again and makes one comment, not two.
  const keys = useRef<Record<string, { of: string; key: string }>>({});
  const keyFor = (slot: string, of: string): string => {
    const kept = keys.current[slot];
    if (kept !== undefined && kept.of === of) return kept.key;
    const made = newClientKey();
    keys.current[slot] = { of, key: made };
    return made;
  };

  // Who may change the deal comments on any deal they read; somebody who reads it only as a won deal (the account
  // manager) comments only while he is on it: the server refuses him the rest (parent-not-theirs).
  const onDeal = load.state === "ready" && load.data !== null && (load.data.deal.owner_id === me || load.data.members.some((member) => member.user_id === me));
  // Who works the deal reads what is said on it as it is; somebody who only reads it (the account manager on a won deal he
  // is not on) is told it is not his, never "no comments yet".
  const works = session.can("deals", "update") || onDeal;
  const canWrite = session.can("comments", "create") && works;
  const said = (saved: Saved<Comment>): Promise<Comment | null> => {
    // A name Adminium does not know as somebody who signs in: said in those words.
    if (saved.state === "refused" && saved.error.fields["text"] === "mention-unknown") {
      toasts.show(t("cmt.refused.unknown"), "danger", true);
      return Promise.resolve(null);
    }
    return toasts.say(Promise.resolve(saved), () => t("cmt.toast.posted"));
  };
  const post = async (): Promise<void> => {
    const words = draft.trim();
    if (words === "") return;
    setBusy(true);
    const made = await said(await session.create<Comment>("comments", { deal_id: key, text: words }, keyFor("new", words)));
    setBusy(false);
    if (made !== null) {
      setDraft("");
      setRound((n) => n + 1);
    }
    again();
  };
  const reply = async (thread: Comment): Promise<void> => {
    const words = (replies[thread.id] ?? "").trim();
    if (words === "") return;
    setBusy(true);
    const made = await said(await session.create<Comment>("comments", { deal_id: key, parent_id: thread.id, text: words }, keyFor(`r${String(thread.id)}`, words)));
    setBusy(false);
    if (made !== null) {
      setReplies((was) => ({ ...was, [thread.id]: "" }));
      setRounds((was) => ({ ...was, [thread.id]: (was[thread.id] ?? 0) + 1 }));
    }
    again();
  };
  // Settled is "has a moment it was settled at". Who settled it is the server's: it stamps whoever changes that moment, so the screen sends the moment alone (plan 68 R1b).
  const settle = async (thread: Comment): Promise<void> => {
    setBusy(true);
    const settled = thread.settled_at !== null;
    await toasts.say(
      session.update("comments", thread.id, { settled_at: settled ? null : session.now().toISOString() }, { seen: { settled_at: thread.settled_at } }),
      () => t(settled ? "cmt.toast.reopened" : "cmt.toast.settled"),
    );
    setBusy(false);
    again();
  };

  return (
    <div className="crm-screen crm-cmt mr-screen" data-screen="deal-comments">
      <Loaded load={load} reload={again} skeleton={<Skeleton rows={3} height={110} />}>
        {(data) => {
          if (data === null) return <NoDeal />;
          const threads = threadsOf(data.comments);
          const shown = threads.filter((thread) => showSettled || thread.first.settled_at === null);
          const settledN = threads.length - threads.filter((thread) => thread.first.settled_at === null).length;
          const onDeal = new Set([data.deal.owner_id, ...data.members.map((member) => member.user_id), me]);
          const outside = mentioned(draft).filter((person) => !onDeal.has(person.id));
          return (
            <>
              <div className="crm-screen-head crm-screen-head-top">
                <div>
                  <h1>{data.deal.name}</h1>
                  <div className="crm-screen-sub">{data.deal.company === null ? t("cmt.sub.bare") : t("cmt.sub", { company: data.deal.company })}</div>
                </div>
                <div className="crm-screen-actions">
                  <ScreenLink to="deal" rest={[data.deal.id]} className="crm-btn crm-btn-ghost crm-btn-38 mr-gi">
                    <Icon name="panel-right-open" size={15} />
                    {t("cmt.toRoom")}
                  </ScreenLink>
                  {settledN > 0 && (
                    <button type="button" className="crm-chip-btn crm-cmt-settled-toggle mr-chip" aria-pressed={showSettled} onClick={() => setShowSettled((was) => !was)}>
                      <Icon name="check-check" size={14} />
                      {t("cmt.showSettled")}
                    </button>
                  )}
                </div>
              </div>
              <p className="crm-cmt-intro">{t("cmt.intro")}</p>

              <ul className="crm-cmt-threads">
                {shown.map((thread) => {
                  const author = nameOf(thread.first.author_id);
                  const settled = thread.first.settled_at !== null;
                  const maySettle = session.can("comments", "update") && (thread.first.author_id === me || team);
                  return (
                    <li key={thread.first.id} className="crm-cmt-thread" data-settled={settled ? "1" : "0"} data-thread={thread.first.id}>
                      <div className="crm-cmt-first">
                        <span className="crm-avatar" aria-hidden="true">
                          {initials(author)}
                        </span>
                        <div className="crm-cmt-body">
                          <div className="crm-cmt-head">
                            <span className="crm-cmt-who">{author}</span>
                            {settled && (
                              <span className="crm-pill" data-tone="pos" data-testid="cmt-settled">
                                {thread.first.settled_by_id === null ? t("cmt.settled") : t("cmt.settledBy", { name: nameOf(thread.first.settled_by_id) })}
                              </span>
                            )}
                            {maySettle && (
                              <button type="button" className="crm-btn crm-btn-ghost crm-btn-32 crm-cmt-settle mr-gi" disabled={busy} onClick={() => void settle(thread.first)}>
                                <Icon name={settled ? "rotate-ccw" : "check"} size={13} />
                                {t(settled ? "cmt.reopen" : "cmt.settle")}
                              </button>
                            )}
                          </div>
                          <Words text={thread.first.text} />
                        </div>
                      </div>
                      {thread.replies.length > 0 && (
                        <ul className="crm-cmt-replies">
                          {thread.replies.map((one) => (
                            <li key={one.id} className="crm-cmt-reply" data-comment={one.id}>
                              <span className="crm-avatar crm-avatar-26" aria-hidden="true">
                                {initials(nameOf(one.author_id))}
                              </span>
                              <div className="crm-cmt-body">
                                <div className="crm-cmt-head">
                                  <span className="crm-cmt-who">{nameOf(one.author_id)}</span>
                                </div>
                                <Words text={one.text} />
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                      {canWrite && (
                        <div className="crm-cmt-answer">
                          <MentionBox name={`reply-${String(thread.first.id)}`} label={t("cmt.reply.to", { name: firstName(author) })} placeholder={t("cmt.reply.to", { name: firstName(author) })} rows={1} disabled={busy} round={rounds[thread.first.id] ?? 0} onChange={(stored) => setReplies((was) => ({ ...was, [thread.first.id]: stored }))} />
                          <button type="button" className="crm-btn crm-btn-primary crm-btn-38 mr-btn" disabled={busy || (replies[thread.first.id] ?? "").trim() === ""} onClick={() => void reply(thread.first)}>
                            {t("cmt.reply")}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
                {shown.length === 0 && (
                  <li className="crm-empty">
                    <span className="crm-empty-icon">
                      <Icon name="message-square" size={21} />
                    </span>
                    <div className="crm-empty-title">{t(!works ? "cmt.notYours" : threads.length === 0 ? "cmt.empty" : "cmt.empty.settled")}</div>
                    {works && <p>{t(canWrite ? "cmt.empty.body" : "cmt.empty.body.read")}</p>}
                  </li>
                )}
              </ul>

              {canWrite && (
                <section className="crm-cmt-new" aria-label={t("cmt.new")}>
                  <h2 className="crm-label">{t("cmt.new")}</h2>
                  <MentionBox name="new" label={t("cmt.new")} placeholder={t("cmt.new.hint", { deal: data.deal.name })} rows={3} disabled={busy} round={round} onChange={setDraft} />
                  {outside.length > 0 && (
                    <div className="crm-cmt-quiet" role="status" data-testid="cmt-quiet">
                      {outside.map((person) => (
                        <p key={person.id}>
                          <Icon name="eye-off" size={13} />
                          {t("cmt.quiet", { name: firstName(person.name) })}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="crm-cmt-new-foot">
                    <span className="crm-room-quiet">{t("cmt.new.at")}</span>
                    <button type="button" className="crm-btn crm-btn-primary crm-btn-38 mr-btn" disabled={busy || draft.trim() === ""} onClick={() => void post()}>
                      <Icon name="message-square-plus" size={15} />
                      {t("cmt.post")}
                    </button>
                  </div>
                </section>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
