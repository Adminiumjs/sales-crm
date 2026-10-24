/**
 * WHAT TO LOAD for one visit (plan 68 S14, M3 §1 2.8–2.10, 5.3): "Stock for
 * this job" (the deal's needs that go on the visit: Inventory's line, the
 * count and its unit, never what it costs) and "On the delivery note" (its
 * lines, as ordered: what goes on the vehicle before the visit, CD-10). Each
 * says "Nothing listed yet." when it holds nothing. The office's Day sheet,
 * its print and the crew's My day show the same two lists.
 */
import { useT } from "../../i18n/index.tsx";
import type { Formatters } from "../../lib/format.ts";
import { dayWords } from "./parts.tsx";
import type { Loads } from "./vandays.ts";

export function LoadLists({ loads, visitId, day, f, print = false }: { loads: Loads; visitId: number; day: string | null; f: Formatters; print?: boolean }) {
  const t = useT();
  const stock = loads.stock.get(visitId) ?? [];
  const note = loads.note.get(visitId) ?? [];
  const head = print ? "crm-vd-load-head crm-vd-print-head" : "crm-vd-load-head";
  return (
    <div className="crm-vd-loads" data-testid="vd-loads" data-load-visit={visitId}>
      {loads.readsStock && (
        <div className="crm-vd-load" data-testid="vd-stock">
          <div className={head}>{t("vandays.ds.stock")}</div>
          {stock.length === 0 ? (
            <p className="crm-vd-none">{t("vandays.ds.nothing")}</p>
          ) : (
            <ul>
              {stock.map((line) => (
                <li key={line.id}>
                  <span dir="auto">{line.name ?? t("vandays.ds.unknownLine")}</span>
                  {line.qty !== null && <span className="crm-mono">{line.unit === null || line.unit === "" ? f.number(line.qty) : t("vandays.ds.qty", { qty: f.number(line.qty), unit: line.unit })}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="crm-vd-load" data-testid="vd-note">
        <div className={head}>{day === null ? t("vandays.ds.note", { day: "" }).replace(/\s*·\s*$/, "") : t("vandays.ds.note", { day: dayWords(f, day) })}</div>
        {note.length === 0 ? (
          <p className="crm-vd-none">{t("vandays.ds.nothing")}</p>
        ) : (
          <ul>
            {note.map((line) => (
              <li key={line.id}>
                <span dir="auto">{line.what}</span>
                <span className="crm-mono">{f.number(line.ordered)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
