/**
 * A JOB'S SITE: where the crew goes, who to ask for, how to get in. A job
 * made from a won deal starts with its site called what the deal is (the
 * app's rule, and "jobs still to make"); the operations manager fills in the
 * rest here.
 *
 * The town is found in Adminium's own list of places (`/geo/places/match`,
 * which asks nobody): the job is then placed "by town" until somebody drags
 * its pin onto the street on the Route. A town the list does not know leaves
 * the place empty, and the screen says so.
 */
import { useState } from "react";

import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { StaffSession } from "../../staffSession.ts";
import { Dialog } from "../../ui/dialog.tsx";
import { reasonOf, useToasts } from "../../ui/toast.tsx";
import { placeOf, type Job } from "./data.ts";

interface Matched {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

export function SiteDialog({ job, session, country, onClose, onDone }: { job: Job; session: StaffSession; country: string | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toasts = useToasts();
  const [site, setSite] = useState(job.site_name);
  const [lines, setLines] = useState(job.address_lines ?? "");
  const [town, setTown] = useState(job.town ?? "");
  const [ask, setAsk] = useState(job.ask_for ?? "");
  const [phone, setPhone] = useState(job.site_phone ?? "");
  const [access, setAccess] = useState(job.access_note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A masked column (somebody who may not read the street or the phone) is not offered: it would be written over with nothing.
  const masked = new Set(((job as unknown as { _masked?: string[] })._masked ?? []) as string[]);
  const blank = (value: string): string | null => (value.trim() === "" ? null : value.trim());
  const ready = site.trim() !== "";

  const go = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const values: Record<string, unknown> = { site_name: site.trim(), town: blank(town), ask_for: blank(ask), access_note: blank(access) };
    if (!masked.has("address_lines")) values["address_lines"] = blank(lines);
    if (!masked.has("site_phone")) values["site_phone"] = blank(phone);
    // A new town is looked up in Adminium's list: placed by town, or not placed. A pin already put on the street stays where it is.
    if ((job.town ?? "") !== town.trim() || placeOf(job.place) === null) {
      let found: Matched | null = null;
      if (town.trim() !== "") {
        try {
          found = (await session.call<{ data: (Matched | null)[] }>("POST", "/geo/places/match", { items: [{ town: town.trim(), ...(country === null ? {} : { country }) }] })).data[0] ?? null;
        } catch {
          found = null;
        }
      }
      if (found !== null) Object.assign(values, { place: { placeId: found.id }, lat: found.lat, lng: found.lng });
      else if (placeOf(job.place)?.by !== "exact") Object.assign(values, { place: null, lat: null, lng: null });
    }
    const saved = await session.update("jobs", job.id, values);
    setBusy(false);
    if (saved.state === "refused") return setError(t("ui.refused", { reason: reasonOf(saved.error, t) }));
    if (saved.state === "unknown") return setError(t("ui.unknown"));
    const placed = placeOf((saved.row as Record<string, unknown>)["place"]);
    toasts.show(placed === null && town.trim() !== "" ? t("jb.site.saved.unplaced", { town: town.trim() }) : t("jb.site.saved", { site: site.trim() }), placed === null && town.trim() !== "" ? "plain" : "pos");
    onDone();
    onClose();
  };

  return (
    <Dialog
      shape="box"
      name="jb-site"
      icon="map-pin"
      title={t("jb.site.title", { job: job.code ?? "" })}
      subtitle={t("jb.site.sub")}
      onClose={onClose}
      busy={busy}
      foot={
        <>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-44 mr-gi" disabled={busy} onClick={onClose}>
            {t("ui.close")}
          </button>
          <button type="button" className="crm-btn crm-btn-primary crm-btn-44 crm-btn-wide mr-btn" data-go disabled={!ready || busy} onClick={() => void go()}>
            {busy ? t("ui.saving") : t("jb.site.save")}
          </button>
        </>
      }
    >
      <fieldset className="crm-fields" disabled={busy}>
        <label className="crm-label" htmlFor="crm-jb-site-name">
          {t("jb.site.name")}
        </label>
        <input id="crm-jb-site-name" data-autofocus className="crm-input mr-fld" value={site} maxLength={160} onChange={(event) => setSite(event.target.value)} />
        {!masked.has("address_lines") && (
          <>
            <label className="crm-label" htmlFor="crm-jb-site-lines">
              {t("jb.site.lines")}
            </label>
            <textarea id="crm-jb-site-lines" className="crm-input crm-textarea mr-fld" rows={2} value={lines} maxLength={400} onChange={(event) => setLines(event.target.value)} />
          </>
        )}
        <label className="crm-label" htmlFor="crm-jb-site-town">
          {t("jb.site.town")}
        </label>
        <input id="crm-jb-site-town" className="crm-input mr-fld" value={town} maxLength={120} onChange={(event) => setTown(event.target.value)} />
        <div className="crm-field-pair">
          <div>
            <label className="crm-label" htmlFor="crm-jb-site-ask">
              {t("jb.site.ask")}
            </label>
            <input id="crm-jb-site-ask" className="crm-input mr-fld" value={ask} maxLength={160} onChange={(event) => setAsk(event.target.value)} />
          </div>
          {!masked.has("site_phone") && (
            <div>
              <label className="crm-label" htmlFor="crm-jb-site-phone">
                {t("jb.site.phone")}
              </label>
              <input id="crm-jb-site-phone" className="crm-input crm-mono mr-fld" type="tel" dir="ltr" value={phone} maxLength={40} onChange={(event) => setPhone(event.target.value)} />
            </div>
          )}
        </div>
        <label className="crm-label" htmlFor="crm-jb-site-access">
          {t("jb.site.access")}
        </label>
        <textarea id="crm-jb-site-access" className="crm-input crm-textarea mr-fld" rows={2} value={access} maxLength={400} placeholder={t("jb.site.access.hint")} onChange={(event) => setAccess(event.target.value)} />
        <p className="crm-field-note">{t("jb.site.place")}</p>
      </fieldset>
      {error !== null && (
        <div className="crm-form-error" role="alert">
          <Icon name="triangle-alert" size={15} />
          <span>{error}</span>
        </div>
      )}
    </Dialog>
  );
}
