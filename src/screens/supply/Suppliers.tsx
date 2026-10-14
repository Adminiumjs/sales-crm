/**
 * SUPPLIER SCORECARD (ledger screen 60), as the Inventory add-on can answer it.
 *
 * Each supplier as Inventory keeps it: the lead time it promises, the stock
 * lines it supplies, its orders on their way (the soonest one's landing day)
 * and those received. The counts are the server's.
 *
 * What the design scores a supplier on is NOT drawn, and the page says so:
 * whether an order came on the day it was due (Inventory keeps both days and
 * counts neither the late ones nor the days it ran over), and its warranty
 * claims (a later part of this app). With neither there is no score, band or
 * "worth a conversation".
 */
import { useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { noonOf, type Formatters } from "../../lib/format.ts";
import { Icon } from "../../shell/icons.tsx";
import { Loaded, Skeleton, useLoad } from "../../ui/load.tsx";
import { readSuppliers, type SuppliersData } from "./data.ts";
import { Tile, useLeadWords, useSupply, useSupplyLive } from "./Stock.tsx";

export function Suppliers() {
  const t = useT();
  const { session, f } = useSupply();
  const { load, reload } = useLoad(() => readSuppliers(session), [session]);
  useSupplyLive(session, reload);
  return (
    <div className="crm-screen crm-sup mr-screen" data-screen="suppliers">
      <div className="crm-screen-head">
        <div>
          <h1>{t("nav.item.suppliers")}</h1>
          <p className="crm-screen-sub">{load.state === "ready" ? t("supply.sup.sub", { count: f.number(load.data.counts.inUse) }, load.data.counts.inUse) : t("supply.sup.sub.plain")}</p>
        </div>
      </div>
      <Loaded load={load} reload={reload} skeleton={<Skeleton rows={6} height={120} />}>
        {(data) => <SuppliersBody data={data} f={f} busy={load.state === "ready" && load.again} />}
      </Loaded>
    </div>
  );
}

function SuppliersBody({ data, f, busy }: { data: SuppliersData; f: Formatters; busy: boolean }) {
  const t = useT();
  const lead = useLeadWords();
  const [open, setOpen] = useState<Record<number, boolean>>({});
  return (
    <>
      <div className="crm-sup-tiles">
        <Tile figure="in-use" label={t("supply.sup.inUse")} value={f.number(data.counts.inUse)} sub={t("supply.sup.inUse.sub")} tone="plain" />
        <Tile figure="coming" label={t("supply.sup.coming")} value={f.number(data.counts.coming)} sub={t("supply.sup.coming.sub")} tone={data.counts.coming > 0 ? "warn" : "plain"} />
        <Tile figure="received" label={t("supply.sup.received")} value={f.number(data.counts.received)} sub={t("supply.sup.received.sub")} tone="plain" />
        <Tile figure="lead" label={t("supply.sup.lead")} value={data.longest === null ? "–" : lead(data.longest.lead_days, "–")} sub={data.longest?.name ?? t("supply.stock.lead.none")} tone="plain" />
      </div>
      <div className="crm-sup-banner" data-tone="plain" data-figure="not-scored">
        <Icon name="circle-alert" size={16} />
        <span>{t("supply.sup.notScored")}</span>
      </div>

      {data.suppliers.length === 0 ? (
        <p className="crm-sup-none">{t("supply.sup.none")}</p>
      ) : (
        <ul className="crm-sup-lines" aria-busy={busy} aria-label={t("nav.item.suppliers")}>
          {data.suppliers.map((supplier) => {
            const key = String(supplier.id);
            const supplies = data.supplies[key] ?? [];
            const coming = data.coming[key] ?? 0;
            const received = data.received[key] ?? 0;
            const next = data.next[key];
            const active = Boolean(supplier.active);
            const many = supplies.length > 3 && open[supplier.id] !== true;
            return (
              <li key={supplier.id} className="crm-sup-line crm-sup-supplier mr-card" data-supplier={supplier.name} data-active={active ? "1" : "0"}>
                <div className="crm-sup-line-top">
                  <span className="crm-sup-tile-icon" aria-hidden="true">
                    <Icon name="factory" size={17} />
                  </span>
                  <div className="crm-sup-line-words">
                    <div className="crm-sup-line-head">
                      <h2>{supplier.name}</h2>
                      {!active && <span className="crm-pill">{t("supply.sup.inactive")}</span>}
                    </div>
                    <p className="crm-sup-quiet" data-figure="supplies">
                      {supplies.length === 0 ? t("supply.sup.supplies.none") : `${t("supply.sup.supplies")} ${(many ? supplies.slice(0, 3) : supplies).join(t("supply.list.sep"))}`}
                      {many && (
                        <>
                          {" "}
                          <button type="button" className="crm-sup-more mr-gi" onClick={() => setOpen((was) => ({ ...was, [supplier.id]: true }))}>
                            {t("supply.sup.more", { count: f.number(supplies.length - 3) }, supplies.length - 3)}
                          </button>
                        </>
                      )}
                    </p>
                    {supplier.note !== null && supplier.note !== "" && <p className="crm-sup-note">{supplier.note}</p>}
                  </div>
                </div>
                <dl className="crm-sup-facts crm-sup-facts-row">
                  <div>
                    <dt>{t("supply.sup.fact.lead")}</dt>
                    <dd className="crm-mono" data-figure="lead">
                      {lead(supplier.lead_days, t("supply.stock.noLead"))}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("supply.sup.fact.lines")}</dt>
                    <dd className="crm-mono" data-figure="lines">
                      {f.number(supplies.length)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("supply.sup.fact.coming")}</dt>
                    <dd className="crm-mono" data-figure="coming">
                      {f.number(coming)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("supply.sup.fact.received")}</dt>
                    <dd className="crm-mono" data-figure="received">
                      {f.number(received)}
                    </dd>
                  </div>
                </dl>
                <p className="crm-sup-next" data-figure="next">
                  {next === undefined ? t("supply.sup.next.none") : next.expected !== null ? t("supply.sup.next", { number: next.number ?? "", day: f.dayShort(noonOf(next.expected)) }) : t("supply.sup.next.unknown", { number: next.number ?? "" })}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {data.cut && <p className="crm-sup-quiet">{t("supply.sup.cut", { count: f.number(data.suppliers.length) })}</p>}
      <p className="crm-sup-where">
        <Icon name="package" size={14} />
        {t("supply.where")}
      </p>
    </>
  );
}
