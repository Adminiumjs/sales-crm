/**
 * A CARD OF A LATER PART'S NUMBERS on the settings row (P24: a stage's
 * settings on the Settings screen): how long a sample is out, when a display
 * piece is tired, how long a snag has, when an aftercare call is due… Each
 * field saves as it is left, naming what the card saw. The card reads and
 * saves its own columns, as the showroom's card does: the Settings screen's
 * own read names only the columns of its first stage. The CRM admin's to
 * write (the server refuses anybody else), every other reader's to read.
 */
import { useMemo } from "react";

import { useT } from "../../i18n/index.tsx";
import type { Formatters } from "../../lib/format.ts";
import type { StaffSession } from "../../staffSession.ts";
import { useCoalesced, useLive, useLoad } from "../../ui/load.tsx";
import { useToasts } from "../../ui/toast.tsx";
import { num } from "./data.ts";
import { Card, NumField } from "./parts.tsx";

export interface NumberField {
  column: string;
  label: string;
  /** The unit after the number, for the number it holds. */
  unit: (n: number) => string;
}

export function SettingNumbers({ session, f, can, name, title, sub, fields }: { session: StaffSession; f: Formatters; can: boolean; name: string; title: string; sub?: string; fields: readonly NumberField[] }) {
  const t = useT();
  const toasts = useToasts();
  const columns = useMemo(() => fields.map((field) => field.column), [fields]);
  const { load, reload } = useLoad(() => session.list<Record<string, unknown>>("settings", { select: ["id", ...columns], limit: 1 }).then((page) => page.rows[0] ?? null), [session, columns.join(",")]);
  const again = useCoalesced(reload);
  useLive(["settings"], again);
  const row = load.state === "ready" ? load.data : null;
  const save = async (field: NumberField, next: number, fresh: boolean): Promise<boolean> => {
    if (row === null) return false;
    const saved = await toasts.say(session.update("settings", Number(row["id"]), { [field.column]: next }, fresh ? { seen: { [field.column]: row[field.column] } } : {}), () => t("aset.saved", { what: field.label }));
    again();
    return saved !== null;
  };
  return (
    <Card name={name} title={title} sub={sub}>
      <div className="crm-ast-fields">
        {fields.map((field) => (
          <NumField key={field.column} column={field.column} label={field.label} unit={field.unit(num(row?.[field.column]))} value={row?.[field.column]} canWrite={can && row !== null} f={f} onSave={(next, fresh) => save(field, next, fresh)} />
        ))}
      </div>
    </Card>
  );
}
