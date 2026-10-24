/**
 * TARGETS (ledger screen 14).
 *
 * A REP sees her own year: her target, what is booked, what is open at its
 * odds, how much is still to find, where an even pace would put her today,
 * and her biggest open deal. She is shown no team target and nobody else's
 * (ruling F5): the server answers her one target row, her own.
 *
 * WHOEVER READS THE TEAM (the sales manager, the CRM admin, Read-only) sees
 * the whole team's year and a row a rep. Whoever may change a target (the
 * manager for the people she leads, the admin) presses the figure, types a
 * new one and sets it; the server stamps who and when.
 *
 * Every figure is the server's (`targets.ts`). The screen divides two of
 * them (covered), takes one from another (still to find) and reads the day
 * of the year off the server's clock (even pace).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "../../i18n/index.tsx";
import type { Formatters } from "../../lib/format.ts";
import { scopeOf } from "../../selling/figures.ts";
import { heldFromOwn } from "../../selling/whose.ts";
import { useSession } from "../../session/session.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { ScreenProps } from "../../shell/screens.tsx";
import { newClientKey } from "../../staffSession.ts";
import { Loaded, Skeleton, useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { firstName } from "../../ui/people.ts";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { Avatar, Empty, Head, NOBODY, num, readWho, useF, type Who } from "./common.tsx";
import { coverOf, leftOf, readTargets, sumsOf, yearDay, type Biggest, type Sums, type Target, type TargetsData } from "./targets.ts";

const toneOf = (cover: number | null): "pos" | "warn" | "danger" => (cover === null ? "danger" : cover >= 1 ? "pos" : cover >= 0.8 ? "warn" : "danger");

export function Targets(_: ScreenProps) {
  const t = useT();
  const f = useF();
  const session = useSession();
  const team = scopeOf(session) === "team";
  const me = session.config.user?.id ?? "";
  const [now, setNow] = useState(() => session.now());
  const today = f.dayKey(now);
  const { load: whoLoad } = useLoad(() => readWho(session), [session]);
  const who = whoLoad.state === "ready" ? whoLoad.data : NOBODY;
  const { load, reload } = useLoad(() => readTargets(session, today, team), [session, today, team]);
  const again = useCoalesced(
    useCallback(() => {
      setNow(session.now());
      reload();
    }, [session, reload]),
  );
  useLive(["targets", "deals"], again);
  const month = Number(today.slice(5, 7));
  const monthsLeft = 12 - month + 1;
  const canSet = session.can("targets", "update");

  return (
    <div className="crm-screen crm-targets mr-screen" data-screen="targets">
      <Head title={t(team ? "targets.h1.team" : "targets.h1.mine")} sub={t(team ? (canSet ? "targets.note.set" : "targets.note.read") : "targets.note.mine")}>
        <span className="crm-tg-period" data-testid="tg-period">
          <Icon name="target" size={14} />
          {t("targets.period", { year: today.slice(0, 4) })}
          <span className="crm-tg-period-left">
            {t("targets.left")} <strong className="crm-mono">{t("targets.months", { count: f.number(monthsLeft) }, monthsLeft)}</strong>
          </span>
        </span>
      </Head>

      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={3} height={130} />}>
        {(data) => {
          const mine = data.targets.find((target) => target.rep_id === me) ?? null;
          return (
            <>
              {!team && mine === null && <Empty icon="target" title={t("targets.none.mine")} body={t("targets.none.mine.body")} />}
              {!team && mine !== null && <Mine target={mine} sums={sumsOf(data, me)} biggest={data.biggest[me] ?? null} who={who} f={f} today={today} monthsLeft={monthsLeft} />}
              {team && <Team data={data} who={who} f={f} monthsLeft={monthsLeft} canSet={canSet} onSaved={again} />}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

function Bar({ booked, weighted, target }: { booked: number; weighted: number; target: number }) {
  const rest = Math.max(0, target - booked - weighted);
  return (
    <div className="crm-tw-bar" aria-hidden="true">
      {booked > 0 && <span data-part="booked" style={{ flex: `${String(booked)} 0 0` }} />}
      {weighted > 0 && <span data-part="weighted" style={{ flex: `${String(weighted)} 0 0` }} />}
      {rest > 0 && <span style={{ flex: `${String(rest)} 0 0` }} />}
    </div>
  );
}

function Figure({ label, value, sub, tone, testid }: { label: string; value: string; sub: string; tone?: "pos" | "accent" | "muted"; testid: string }) {
  return (
    <div className="crm-tg-fig" data-testid={testid}>
      <div className="crm-stat-label">{label}</div>
      <div className="crm-stat-value crm-mono" data-tone={tone}>
        {value}
      </div>
      <div className="crm-stat-sub">{sub}</div>
    </div>
  );
}

const setLine = (target: Target, who: Who, f: Formatters, t: ReturnType<typeof useT>): string => {
  const at = target.set_at === null ? null : new Date(target.set_at);
  const by = target.set_by_id === null ? "" : (who.names[target.set_by_id] ?? "");
  if (at === null) return "";
  return by === "" ? t("targets.set.at", { when: f.date(at) }) : t("targets.set.by", { who: by, when: f.date(at) });
};

function Mine({ target, sums, biggest, who, f, today, monthsLeft }: { target: Target; sums: Sums; biggest: Biggest | null; who: Who; f: Formatters; today: string; monthsLeft: number }) {
  const t = useT();
  const amount = num(target.amount);
  const cover = coverOf(sums.toward, amount);
  const { day, of } = yearDay(today);
  const pace = Math.round((amount * day) / of);
  const ahead = sums.booked - pace;
  return (
    <section className="crm-tw-card crm-tg-card" data-testid="tg-mine">
      <div className="crm-tw-card-head">
        <h2>
          <Icon name="user-round" size={13} /> {t("targets.mine")}
        </h2>
        <span className="crm-pill crm-mono crm-tg-cover" data-tone={toneOf(cover)} data-testid="tg-mine-cover">
          {t("targets.covered", { share: cover === null ? "—" : f.percent(cover) })}
        </span>
      </div>
      <div className="crm-tg-figs">
        <Figure label={t("targets.fig.mine")} value={f.money(amount)} sub={setLine(target, who, f, t)} testid="tg-target" />
        <Figure label={t("targets.fig.booked")} value={f.money(sums.booked)} sub={t("targets.fig.booked.sub")} tone="pos" testid="tg-booked" />
        <Figure label={t("targets.fig.weighted")} value={f.money(sums.weighted)} sub={t("targets.fig.deals", { count: f.number(sums.deals) }, sums.deals)} tone="accent" testid="tg-weighted" />
        <Figure label={t("targets.fig.left")} value={f.money(leftOf(sums.toward, amount))} sub={t("targets.fig.left.sub", { count: f.number(monthsLeft) }, monthsLeft)} tone="muted" testid="tg-left" />
      </div>
      <Bar booked={sums.booked} weighted={sums.weighted} target={amount} />
      <div className="crm-tg-pace" data-testid="tg-pace" data-ahead={ahead >= 0 ? "1" : "0"}>
        <span className="crm-tg-pace-icon">
          <Icon name={ahead >= 0 ? "trending-up" : "gauge"} size={15} />
        </span>
        <p>{ahead >= 0 ? t("targets.pace.ahead", { pace: f.money(pace), by: f.money(ahead) }) : t("targets.pace.short", { pace: f.money(pace), by: f.money(-ahead) })}</p>
        {biggest !== null && (
          <span className="crm-tg-biggest" data-testid="tg-biggest">
            {t("targets.biggest")} <strong>{biggest.name}</strong> <span className="crm-mono">{f.money(biggest.amount)}</span>
          </span>
        )}
      </div>
    </section>
  );
}

function Team({ data, who, f, monthsLeft, canSet, onSaved }: { data: TargetsData; who: Who; f: Formatters; monthsLeft: number; canSet: boolean; onSaved: () => void }) {
  const t = useT();
  const session = useSession();
  const total = data.teamTarget ?? 0;
  const team = data.team ?? { booked: 0, weighted: 0, toward: 0, deals: 0 };
  const cover = coverOf(team.toward, total);
  // A row a rep: the people with a rep's profile, then anybody else who has a target.
  const people = [...who.reps, ...data.targets.map((target) => target.rep_id).filter((id) => !who.reps.includes(id))].filter((id, at, list) => list.indexOf(id) === at);
  // Her own target is never hers to set (plan 68 X2): the server answers it as a row out of reach.
  const me = session.config.user?.id ?? "";
  const ownShown = canSet && people.includes(me) && heldFromOwn(session);
  return (
    <>
      <section className="crm-tw-card crm-tg-card" data-testid="tg-team">
        <div className="crm-tw-card-head">
          <h2>{t("targets.team")}</h2>
          <span className="crm-pill crm-mono crm-tg-cover" data-tone={toneOf(cover)} data-testid="tg-team-cover">
            {t("targets.covered", { share: cover === null ? "—" : f.percent(cover) })}
          </span>
        </div>
        <div className="crm-tg-figs">
          <Figure label={t("targets.fig.target")} value={f.money(total)} sub={t("targets.fig.reps", { count: f.number(data.targets.length) }, data.targets.length)} testid="tg-target" />
          <Figure label={t("targets.fig.booked")} value={f.money(team.booked)} sub={t("targets.fig.booked.sub")} tone="pos" testid="tg-booked" />
          <Figure label={t("targets.fig.weighted")} value={f.money(team.weighted)} sub={t("targets.fig.weighted.sub")} tone="accent" testid="tg-weighted" />
          <Figure label={t("targets.fig.left")} value={f.money(leftOf(team.toward, total))} sub={t("targets.fig.left.sub", { count: f.number(monthsLeft) }, monthsLeft)} tone="muted" testid="tg-left" />
        </div>
        <Bar booked={team.booked} weighted={team.weighted} target={total} />
        <div className="crm-tg-legend">
          <span>
            <i data-part="booked" /> {t("targets.fig.booked")} <strong className="crm-mono">{f.money(team.booked)}</strong>
          </span>
          <span>
            <i data-part="weighted" /> {t("targets.legend.weighted")} <strong className="crm-mono">{f.money(team.weighted)}</strong>
          </span>
          <span>
            <i /> {t("targets.fig.left")} <strong className="crm-mono">{f.money(leftOf(team.toward, total))}</strong>
          </span>
        </div>
      </section>

      <section className="crm-tw-card crm-tg-rows" aria-labelledby="crm-tg-everyone">
        <div className="crm-tw-card-head">
          <h2 id="crm-tg-everyone">{t("targets.everyone")}</h2>
          <span className="crm-tw-quiet">{t(canSet ? "targets.everyone.set" : "targets.everyone.read")}</span>
        </div>
        <ul className="crm-tg-list">
          {people.map((id) => (
            <Row key={id} rep={id} name={who.names[id] ?? ""} target={data.targets.find((one) => one.rep_id === id) ?? null} sums={sumsOf(data, id)} biggest={data.biggest[id] ?? null} who={who} f={f} year={data.year} canSet={canSet && !(ownShown && id === me) && (data.targets.some((one) => one.rep_id === id) || session.can("targets", "create"))} onSaved={onSaved} />
          ))}
        </ul>
        {ownShown && (
          <p className="crm-tw-quiet" data-testid="tg-own">
            {t("dealrules.target.own")}
          </p>
        )}
        {people.length === 0 && <Empty icon="target" title={t("targets.none.team")} />}
      </section>
    </>
  );
}

function Row({ rep, name, target, sums, biggest, who, f, year, canSet, onSaved }: { rep: string; name: string; target: Target | null; sums: Sums; biggest: Biggest | null; who: Who; f: Formatters; year: number; canSet: boolean; onSaved: () => void }) {
  const t = useT();
  const session = useSession();
  const toasts = useToasts();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newClientKey());
  const opener = useRef<HTMLButtonElement>(null);
  const amount = target === null ? 0 : num(target.amount);
  const cover = coverOf(sums.toward, amount);
  const left = leftOf(sums.toward, amount);

  // Closing the box gives the focus back to the figure that opened it, once that figure is drawn again.
  const giveBack = useRef(false);
  useEffect(() => {
    if (draft !== null || !giveBack.current) return;
    giveBack.current = false;
    opener.current?.focus();
  }, [draft]);
  const stop = (): void => {
    giveBack.current = true;
    setDraft(null);
  };
  const save = async (): Promise<void> => {
    if (draft === null || busy) return;
    const typed = f.readAmount(draft);
    if (typed === null || typed === amount) return stop();
    setBusy(true);
    const saved = target === null ? await session.create<Target>("targets", { rep_id: rep, year, amount: typed }, key.current) : await session.update<Target>("targets", target.id, { amount: typed }, { seen: { amount: target.amount } });
    setBusy(false);
    if (saved.state === "refused") return toasts.show(t("ui.refused", { reason: reasonOf(saved.error, t) }), "danger", true);
    if (saved.state === "unknown") return toasts.show(t("ui.unknown"), "danger", true);
    toasts.show(t("targets.toast", { name: firstName(name), amount: f.money(typed) }), "pos");
    stop();
    onSaved();
  };

  return (
    <li className="crm-tg-row" data-rep={rep}>
      <div className="crm-tg-row-top">
        <Avatar name={name} />
        <div className="crm-tg-row-who">
          <strong>{name}</strong>
          <span>{t("targets.row.deals", { count: f.number(sums.deals) }, sums.deals)}</span>
        </div>
        <div className="crm-tg-cell">
          <span>{t("targets.fig.booked")}</span>
          <strong className="crm-mono" data-tone="pos" data-cell="booked">
            {f.money(sums.booked)}
          </strong>
        </div>
        <div className="crm-tg-cell">
          <span>{t("targets.legend.weighted")}</span>
          <strong className="crm-mono" data-tone="accent" data-cell="weighted">
            {f.money(sums.weighted)}
          </strong>
        </div>
        <div className="crm-tg-cell">
          <span>{t("targets.fig.target")}</span>
          {draft !== null ? (
            <span className="crm-tg-edit">
              <input
                className="crm-input crm-input-sm crm-mono mr-fld"
                inputMode="decimal"
                autoFocus
                aria-label={t("targets.edit.aria", { name: firstName(name) })}
                value={draft}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void save();
                  if (event.key === "Escape") stop();
                }}
              />
              <button type="button" className="crm-btn crm-btn-primary crm-btn-32 mr-btn" disabled={busy} onClick={() => void save()}>
                {busy ? t("ui.saving") : t("targets.edit.set")}
              </button>
            </span>
          ) : canSet ? (
            <button ref={opener} type="button" className="crm-tg-figure mr-gi" data-cell="target" aria-label={t("targets.edit.open", { name: firstName(name), amount: target === null ? t("targets.row.notSet") : f.money(amount) })} onClick={() => setDraft(target === null ? "" : String(amount))}>
              <strong className="crm-mono">{target === null ? t("targets.row.notSet") : f.money(amount)}</strong>
              <Icon name="pencil" size={12} />
            </button>
          ) : (
            <strong className="crm-mono" data-cell="target">
              {target === null ? t("targets.row.notSet") : f.money(amount)}
            </strong>
          )}
        </div>
        <span className="crm-pill crm-mono" data-tone={toneOf(cover)} data-cell="cover">
          {cover === null ? "—" : f.percent(cover)}
        </span>
      </div>
      {target !== null && <Bar booked={sums.booked} weighted={sums.weighted} target={amount} />}
      <div className="crm-tg-row-foot">
        {target !== null && (
          <span className="crm-tg-gap" data-cell="gap" data-tone={left === 0 ? "pos" : undefined}>
            {left === 0 ? t("targets.row.covered") : t("targets.row.left", { amount: f.money(left) })}
          </span>
        )}
        {biggest !== null && (
          <span className="crm-tg-big" data-cell="biggest">
            {t("targets.biggest")} <strong>{biggest.name}</strong> <span className="crm-mono">{f.money(biggest.amount)}</span>
          </span>
        )}
        {target !== null && <span className="crm-tg-setline">{setLine(target, who, f, t)}</span>}
      </div>
    </li>
  );
}
