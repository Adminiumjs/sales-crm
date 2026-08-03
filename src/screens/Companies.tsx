/**
 * COMPANIES, COMPANY PROFILE and CONTACTS.
 *
 * Searchable card lists, deliberately NOT data grids: creating and editing
 * records happens in the generated Adminium dashboard, and each list says so
 * in a line under it rather than offering a "New…" button that would lie.
 */

import { ArrowLeft, Building2, Search, UserRound } from "lucide-react";

import { ACTIVITY_TYPE, COMPANIES, CONTACTS, NOW, REPS, STAGES } from "../data/demo.ts";
import { useI18n } from "../i18n/index.tsx";
import { label, money, number, relativeAt } from "../lib/format.ts";
import { stageById, timelineForDeals } from "../lib/pipeline.ts";
import { useStore } from "../state/store.ts";
import {
  Avatar,
  Chip,
  Empty,
  Honest,
  LogoTile,
  Mono,
  Panel,
} from "../components/Primitives.tsx";

/* ------------------------------------------------------------- companies */

export function Companies() {
  const { t } = useI18n();
  const query = useStore((s) => s.companyQuery);
  const setQuery = useStore((s) => s.setCompanyQuery);
  const deals = useStore((s) => s.deals);
  const openCompany = useStore((s) => s.openCompany);

  const q = query.trim().toLowerCase();
  const list = COMPANIES.filter(
    (c) =>
      q.length === 0 ||
      c.name.toLowerCase().includes(q) ||
      c.city.toLowerCase().includes(q) ||
      label(c.sector).toLowerCase().includes(q),
  );

  return (
    <div className="mr-screen">
      <header className="mr-head">
        <h1 className="mr-head__title">{t("companies.title")}</h1>
        <p className="mr-head__sub">{t("companies.subtitle")}</p>
      </header>

      <SearchBox value={query} onChange={setQuery} placeholder={t("companies.search")} />

      {list.length === 0 ? (
        <Empty icon={<Building2 size={22} aria-hidden="true" />} title={t("companies.empty")} />
      ) : (
        <div className="mr-cardgrid">
          {list.map((c) => {
            const open = deals.filter((d) => d.co === c.id);
            const total = open.reduce((n, d) => n + d.amount, 0);
            return (
              <button
                key={c.id}
                type="button"
                className="mr-cotile mr-card"
                onClick={() => openCompany(c.id)}
              >
                <LogoTile tint={c.tint} ini={c.ini} file={c.file} />
                <span className="mr-cotile__name">{c.name}</span>
                <span className="mr-cotile__meta">
                  {label(c.sector)} · {c.city}
                </span>
                <span className="mr-cotile__foot">
                  {open.length > 0 ? (
                    <>
                      <Chip tone="accent">
                        {t("companies.openDeals", { count: open.length }, open.length)}
                      </Chip>
                      <Mono>{money(total)}</Mono>
                    </>
                  ) : (
                    <Chip>{t("companies.noDeals")}</Chip>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ marginBlockStart: 18 }}>
        <Honest>{t("companies.honest")}</Honest>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- company profile */

export function CompanyProfile() {
  const { t } = useI18n();
  const companyId = useStore((s) => s.companyId);
  const deals = useStore((s) => s.deals);
  const activities = useStore((s) => s.activities);
  const go = useStore((s) => s.go);
  const openDeal = useStore((s) => s.openDeal);

  const company = COMPANIES.find((c) => c.id === companyId) ?? COMPANIES[0];
  const open = deals.filter((d) => d.co === company.id);
  const people = CONTACTS.filter((p) => p.co === company.id);
  const rows = timelineForDeals(
    activities,
    // Every deal the company has ever had a conversation on, open or not.
    activities.filter((a) => deals.some((d) => d.id === a.deal && d.co === company.id)).map((a) => a.deal),
  );

  return (
    <div className="mr-screen">
      <button type="button" className="mr-backlink" onClick={() => go("companies")}>
        <ArrowLeft size={14} aria-hidden="true" />
        {t("company.back")}
      </button>

      <header className="mr-cohead">
        <LogoTile tint={company.tint} ini={company.ini} file={company.file} size={72} />
        <div style={{ minWidth: 0 }}>
          <h1 className="mr-head__title">{company.name}</h1>
          <p className="mr-head__sub">{label(company.since)}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBlockStart: 9 }}>
            <Chip>{label(company.sector)}</Chip>
            <Chip>
              {t("company.facts.people", { count: company.headcount }, company.headcount).replace(
                String(company.headcount),
                number(company.headcount),
              )}
            </Chip>
            <Chip>{company.city}</Chip>
          </div>
        </div>
      </header>

      <div className="mr-deal-grid">
        <div style={{ minWidth: 0, display: "grid", gap: 16 }}>
          <Panel title={t("company.deals.title")}>
            {open.length === 0 ? (
              <p className="mr-col__empty">{t("company.deals.empty")}</p>
            ) : (
              <div style={{ display: "grid", gap: 9 }}>
                {open.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="mr-dealrow"
                    onClick={() => openDeal(d.id)}
                  >
                    <span className="mr-dealrow__name">{label(d.name)}</span>
                    <Chip>{label(stageById(STAGES, d.stage).label)}</Chip>
                    <Mono className="mr-dealrow__amount">{money(d.amount)}</Mono>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <Panel title={t("company.timeline.title")}>
            {rows.length === 0 ? (
              <p className="mr-col__empty">{t("deal.timeline.empty")}</p>
            ) : (
              <div className="mr-timeline">
                {rows.map((a) => {
                  const who = REPS.find((r) => r.id === a.who);
                  const deal = deals.find((d) => d.id === a.deal);
                  return (
                    <article key={a.id} className="mr-tl-row">
                      <span className="mr-tl-dot" aria-hidden="true">
                        ·
                      </span>
                      <div className="mr-tl-body">
                        <div className="mr-tl-head">
                          <span className="mr-tl-type">
                            {label(ACTIVITY_TYPE[a.type].label)}
                          </span>
                          {deal !== undefined && (
                            <span className="mr-tl-when">{label(deal.name)}</span>
                          )}
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
        </div>

        <aside style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <Panel title={t("company.note.title")}>
            <p className="mr-tl-text">{label(company.note)}</p>
          </Panel>

          {people.length > 0 && (
            <Panel title={t("company.contacts.title")}>
              <div style={{ display: "grid", gap: 11 }}>
                {people.map((p) => (
                  <div key={p.id} className="mr-personrow">
                    <Avatar name={p.name} tint={company.tint} ini={p.ini} large />
                    <div style={{ minWidth: 0 }}>
                      <div className="mr-personrow__name">{p.name}</div>
                      <div className="mr-personrow__role">{label(p.role)}</div>
                      <div className="mr-personrow__contact mr-mono">{p.email}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- contacts */

export function Contacts() {
  const { t } = useI18n();
  const query = useStore((s) => s.contactQuery);
  const setQuery = useStore((s) => s.setContactQuery);
  const openCompany = useStore((s) => s.openCompany);

  const q = query.trim().toLowerCase();
  const list = CONTACTS.filter(
    (p) =>
      q.length === 0 ||
      p.name.toLowerCase().includes(q) ||
      label(p.role).toLowerCase().includes(q) ||
      (COMPANIES.find((c) => c.id === p.co)?.name.toLowerCase().includes(q) ?? false),
  );

  return (
    <div className="mr-screen">
      <header className="mr-head">
        <h1 className="mr-head__title">{t("contacts.title")}</h1>
        <p className="mr-head__sub">{t("contacts.subtitle")}</p>
      </header>

      <SearchBox value={query} onChange={setQuery} placeholder={t("contacts.search")} />

      {list.length === 0 ? (
        <Empty icon={<UserRound size={22} aria-hidden="true" />} title={t("contacts.empty")} />
      ) : (
        <div className="mr-cardgrid">
          {list.map((p) => {
            const company = COMPANIES.find((c) => c.id === p.co);
            return (
              <div key={p.id} className="mr-ctile mr-card">
                <Avatar
                  name={p.name}
                  tint={company?.tint ?? "#4f46e5"}
                  ini={p.ini}
                  large
                />
                <div className="mr-ctile__name">{p.name}</div>
                <div className="mr-ctile__role">{label(p.role)}</div>
                {company !== undefined && (
                  <button
                    type="button"
                    className="mr-ctile__co"
                    onClick={() => openCompany(company.id)}
                  >
                    {company.name}
                  </button>
                )}
                <div className="mr-ctile__contact mr-mono">{p.email}</div>
                <div className="mr-ctile__contact mr-mono">{p.phone}</div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginBlockStart: 18 }}>
        <Honest>{t("contacts.honest")}</Honest>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- shared */

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="mr-searchbox">
      <Search size={15} aria-hidden="true" />
      <input
        className="mr-input mr-fld"
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
