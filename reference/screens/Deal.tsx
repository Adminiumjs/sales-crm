/**
 * DEAL ROOM — one deal, everything about it.
 *
 * Left: the merged activity timeline (calls, e-mails, meetings, notes and
 * stage changes in one stream, newest first) above a composer. Right: the
 * facts rail, the people, and the company.
 *
 * The amount is inline-editable because a rep re-quotes far more often than
 * they create a record — and the honest line under the rail says plainly where
 * record management actually lives.
 */

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Mail,
  MoveRight,
  Pencil,
  Phone,
  StickyNote,
} from "lucide-react";

import { COMPANIES, CONTACTS, NOW, REPS, STAGES } from "../data/live.ts";
import { ACTIVITY_TYPE } from "../data/demo.ts";
import type { ActivityType } from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import {
  dateLong,
  daysInStageLabel,
  label,
  money,
  percent,
  relativeAt,
} from "../lib/format.ts";
import {
  daysInStage,
  parseAt,
  stageById,
  staleness,
  timeline,
  weighted,
} from "../lib/pipeline.ts";
import { useStore } from "../state/store.ts";
import {
  Avatar,
  Button,
  Chip,
  Empty,
  Honest,
  LogoTile,
  Mono,
  Panel,
} from "../components/Primitives.tsx";

const TYPE_ICON: Record<ActivityType, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: CalendarDays,
  note: StickyNote,
  stage: MoveRight,
};

const COMPOSER_TYPES: ActivityType[] = ["call", "email", "meeting", "note"];

export default function DealRoom() {
  const { t } = useI18n();
  const dealId = useStore((s) => s.dealId);
  const deals = useStore((s) => s.deals);
  const activities = useStore((s) => s.activities);
  const go = useStore((s) => s.go);
  const openCompany = useStore((s) => s.openCompany);
  const moveStage = useStore((s) => s.moveStage);
  const setAmount = useStore((s) => s.setAmount);
  const openCloseDialog = useStore((s) => s.openCloseDialog);
  const logActivity = useStore((s) => s.logActivity);

  const deal = deals.find((d) => d.id === dealId);

  const [editing, setEditing] = useState(false);
  const [draftAmount, setDraftAmount] = useState("");
  const [type, setType] = useState<ActivityType>("call");
  const [text, setText] = useState("");
  const [nextStep, setNextStep] = useState(false);

  useEffect(() => {
    setEditing(false);
    setText("");
    setNextStep(false);
  }, [dealId]);

  if (!deal) {
    return (
      <div className="mr-screen">
        <Empty title={t("deal.missing")} action={<Button onClick={() => go("board")}>{t("deal.back")}</Button>} />
      </div>
    );
  }

  const company = COMPANIES.find((c) => c.id === deal.co);
  const owner = REPS.find((r) => r.id === deal.owner) ?? REPS[0];
  const stage = stageById(STAGES, deal.stage);
  const people = CONTACTS.filter((p) => p.co === deal.co);
  const rows = timeline(activities, deal.id);
  const age = daysInStage(deal, NOW);
  const stale = staleness(deal, NOW);

  return (
    <div className="mr-screen">
      <button type="button" className="mr-backlink" onClick={() => go("board")}>
        <ArrowLeft size={14} aria-hidden="true" />
        {t("deal.back")}
      </button>

      <header className="mr-dealhead">
        <div className="mr-dealhead__top">
          <div style={{ minWidth: 0 }}>
            <h1 className="mr-head__title">{label(deal.name)}</h1>
            {company !== undefined && (
              <button
                type="button"
                className="mr-dealhead__co"
                onClick={() => openCompany(company.id)}
              >
                <Avatar name={company.name} tint={company.tint} ini={company.ini} />
                {company.name}
              </button>
            )}
          </div>

          <div className="mr-dealhead__amount">
            {editing ? (
              <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                <input
                  className="mr-input mr-fld mr-mono"
                  style={{ width: 128 }}
                  inputMode="numeric"
                  value={draftAmount}
                  autoFocus
                  aria-label={t("deal.amount.edit")}
                  onChange={(e) => setDraftAmount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setAmount(deal.id, Number(draftAmount.replace(/[^\d.]/g, "")));
                      setEditing(false);
                    }
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    setAmount(deal.id, Number(draftAmount.replace(/[^\d.]/g, "")));
                    setEditing(false);
                  }}
                >
                  <Check size={14} aria-hidden="true" />
                  {t("deal.amount.save")}
                </Button>
              </div>
            ) : (
              <button
                type="button"
                className="mr-dealhead__amountbtn"
                onClick={() => {
                  setDraftAmount(String(deal.amount));
                  setEditing(true);
                }}
                aria-label={t("deal.amount.edit")}
              >
                <Mono>{money(deal.amount)}</Mono>
                <Pencil size={14} aria-hidden="true" />
              </button>
            )}
            <Button tone="ghost" size="sm" onClick={() => openCloseDialog(deal.id)}>
              {t("board.card.close")}
            </Button>
          </div>
        </div>

        <ol className="mr-stepper" aria-label={t("deal.stepper.label")}>
          {STAGES.map((s, i) => {
            const current = s.id === deal.stage;
            const past = i < STAGES.findIndex((x) => x.id === deal.stage);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="mr-stepper__step"
                  data-state={current ? "current" : past ? "past" : "future"}
                  onClick={() => moveStage(deal.id, s.id)}
                >
                  <span className="mr-stepper__label">{label(s.label)}</span>
                  <Mono className="mr-stepper__odds">{percent(s.odds)}</Mono>
                </button>
              </li>
            );
          })}
        </ol>
      </header>

      <div className="mr-deal-grid">
        <div style={{ minWidth: 0, display: "grid", gap: 16 }}>
          <Panel title={t("deal.timeline.title")}>
            {rows.length === 0 ? (
              <p className="mr-col__empty">{t("deal.timeline.empty")}</p>
            ) : (
              <div className="mr-timeline">
                {rows.map((a) => {
                  const Icon = TYPE_ICON[a.type];
                  const who = REPS.find((r) => r.id === a.who);
                  return (
                    <article key={a.id} className="mr-tl-row">
                      <span className="mr-tl-dot">
                        <Icon size={14} aria-hidden="true" />
                      </span>
                      <div className="mr-tl-body">
                        <div className="mr-tl-head">
                          <span className="mr-tl-type">{label(ACTIVITY_TYPE[a.type].label)}</span>
                          <span className="mr-tl-when mr-mono">{relativeAt(a.at, NOW)}</span>
                          {who !== undefined && <span className="mr-tl-when">· {who.first}</span>}
                        </div>
                        <p className="mr-tl-text">{label(a.text)}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBlockEnd: 11 }}>
              {COMPOSER_TYPES.map((tp) => (
                <Chip key={tp} onClick={() => setType(tp)} pressed={type === tp}>
                  {label(ACTIVITY_TYPE[tp].label)}
                </Chip>
              ))}
            </div>
            <textarea
              className="mr-textarea mr-fld"
              value={text}
              placeholder={t("deal.composer.placeholder")}
              aria-label={t("deal.composer.placeholder")}
              onChange={(e) => setText(e.target.value)}
            />
            <label className="mr-checkline">
              <input
                type="checkbox"
                checked={nextStep}
                onChange={(e) => setNextStep(e.target.checked)}
              />
              <span>
                {t("deal.composer.nextStep")}
                <span className="mr-checkline__hint">{t("deal.composer.nextStepHint")}</span>
              </span>
            </label>
            <div style={{ marginBlockStart: 12 }}>
              <Button
                disabled={text.trim().length === 0}
                onClick={() => {
                  logActivity(deal.id, type, text, nextStep);
                  setText("");
                  setNextStep(false);
                }}
              >
                {t("deal.composer.log")}
              </Button>
            </div>
          </Panel>
        </div>

        <aside style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <Panel title={t("deal.facts.title")}>
            <dl className="mr-facts">
              <Fact label={t("deal.facts.amount")} value={<Mono>{money(deal.amount)}</Mono>} />
              <Fact
                label={t("deal.facts.weighted")}
                value={<Mono>{money(weighted(deal, STAGES))}</Mono>}
              />
              <Fact label={t("deal.facts.odds")} value={<Mono>{percent(stage.odds)}</Mono>} />
              <Fact
                label={t("deal.facts.age")}
                value={
                  <Chip tone={stale === "stale" ? "danger" : stale === "warn" ? "warn" : undefined}>
                    {daysInStageLabel(age)}
                  </Chip>
                }
              />
              <Fact
                label={t("deal.facts.opened")}
                value={<Mono>{dateLong(parseAt(deal.opened))}</Mono>}
              />
              <Fact
                label={t("deal.facts.close")}
                value={<Mono>{dateLong(parseAt(deal.close))}</Mono>}
              />
              <Fact
                label={t("deal.facts.owner")}
                value={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <Avatar name={owner.name} tint={owner.tint} ini={owner.ini} />
                    {owner.name}
                  </span>
                }
              />
              <Fact label={t("deal.facts.scope")} value={label(deal.scope)} />
            </dl>
          </Panel>

          {people.length > 0 && (
            <Panel title={t("deal.contacts.title")}>
              <div style={{ display: "grid", gap: 11 }}>
                {people.map((p) => (
                  <div key={p.id} className="mr-personrow">
                    <Avatar name={p.name} tint={company?.tint ?? "#4f46e5"} ini={p.ini} large />
                    <div style={{ minWidth: 0 }}>
                      <div className="mr-personrow__name">
                        {p.name}
                        {p.id === deal.main && <Chip tone="accent">★</Chip>}
                      </div>
                      <div className="mr-personrow__role">{label(p.role)}</div>
                      <div className="mr-personrow__contact mr-mono">{p.email}</div>
                      <div className="mr-personrow__contact mr-mono">{p.phone}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {company !== undefined && (
            <Panel title={t("deal.company.title")}>
              <button
                type="button"
                className="mr-cocard"
                onClick={() => openCompany(company.id)}
              >
                <LogoTile tint={company.tint} ini={company.ini} file={company.file} />
                <span style={{ minWidth: 0, textAlign: "start" }}>
                  <span className="mr-personrow__name">{company.name}</span>
                  <span className="mr-personrow__role">{label(company.sector)}</span>
                  <span className="mr-personrow__role">{label(company.since)}</span>
                </span>
              </button>
            </Panel>
          )}

          <Honest>{t("deal.honest")}</Honest>
        </aside>
      </div>
    </div>
  );
}

function Fact({ label: name, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </>
  );
}
