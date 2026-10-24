/**
 * THE SIGNED COPY'S FILE ROW, on the office's Sign-off under "Who signed"
 * (plan 68 S13; the design's M2 note 1).
 *
 * Invoices & Receipts draws the copy from the sign-off (the app's `documents`
 * entry, kind `signed-copy`). The row asks the app's own door for it
 * (`POST /apps/crm/documents/render`), which the server judges by the
 * reader's reach on the sign-off and every table and column it prints, and
 * which hands back the copy already drawn while the sign-off is unchanged
 * (the one e-mail 17 carried). It asks only while Invoices is attached and
 * draws the kind (`drawsSignedCopy`). So the row is there only when the job is signed
 * off AND the copy is drawn: with no Invoices, or an Invoices that does not
 * draw the kind yet (the copy waits), or a reader who may not read it, the
 * door refuses and the row is left out, with no line in its place.
 *
 * Its size and name are the file's own, read from the bytes' headers (one
 * HEAD): never a guess. Where the copy's words cannot be set in a PDF
 * (Arabic), the add-on draws the print page only: the row says so and opens
 * it, to print or save as a PDF from the browser.
 */
import { useT } from "../../i18n/index.tsx";
import { Icon } from "../../shell/icons.tsx";
import type { StaffSession } from "../../staffSession.ts";
import { useLoad } from "../../ui/load.tsx";
import type { SignOff } from "./data.ts";
import { useJobsScreen } from "./parts.tsx";

/** A drawn signed copy: where its bytes are, what it is, and the file's own name and size when its headers say. */
export interface SignedCopy {
  url: string;
  format: "pdf" | "html";
  filename: string | null;
  bytes: number | null;
}

interface RenderReply {
  contentUrl: string;
  printUrl: string;
  document: { format: string; status: string; hasContent: boolean };
}

/** The file name a `Content-Disposition` gives, its UTF-8 form first; null when it gives none. */
export function filenameOf(disposition: string | null): string | null {
  if (disposition === null) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded !== null) {
    try {
      return decodeURIComponent(encoded[1]!.trim());
    } catch {
      // A broken encoding: the plain name below.
    }
  }
  const plain = /filename="([^"]*)"/i.exec(disposition);
  return plain === null || plain[1]!.trim() === "" ? null : plain[1]!.trim();
}

const drawing = new WeakMap<StaffSession, Promise<boolean>>();

/**
 * Whether Invoices & Receipts is attached to the app, on, and draws the kind: asked once a page (the kinds the
 * add-ons draw, a plain read). An Invoices that does not draw it yet leaves the copy waiting, and the screen asks
 * nothing more of it: no refused draw for every signed job.
 */
export function drawsSignedCopy(session: StaffSession): Promise<boolean> {
  const known = drawing.get(session);
  if (known !== undefined) return known;
  if (session.config.addOns?.["invoices"] === undefined) return Promise.resolve(false);
  const asked = session.call<{ kinds?: { addOnKey: string; kind: string }[] }>("GET", "/documents/kinds").then(
    (reply) => (reply.kinds ?? []).some((one) => one.addOnKey === "invoices" && one.kind === "signed-copy"),
    () => {
      drawing.delete(session);
      return false;
    },
  );
  drawing.set(session, asked);
  return asked;
}

/** The signed copy of a sign-off, drawn (or the one drawn before), or null when the reader is given none. */
export async function readSignedCopy(session: StaffSession, signOffId: number, head: (url: string) => Promise<Response | null> = headOf): Promise<SignedCopy | null> {
  if (!(await drawsSignedCopy(session))) return null;
  let reply: RenderReply;
  try {
    reply = await session.call<RenderReply>("POST", "/apps/crm/documents/render", { kind: "signed-copy", ref: "sign_offs", pk: { id: signOffId } });
  } catch {
    // Not drawn for this reader: no Invoices, a copy that waits for its update, beyond the reader's reach, or no answer.
    return null;
  }
  if (reply.document?.hasContent !== true || reply.document.status === "failed") return null;
  const format = reply.document.format === "pdf" ? "pdf" : "html";
  // A PDF downloads from its content; the print page opens where it is drawn to print.
  const url = format === "pdf" ? reply.contentUrl : reply.printUrl;
  const headers = await head(url);
  const length = Number(headers?.headers.get("content-length") ?? Number.NaN);
  return { url, format, filename: filenameOf(headers?.headers.get("content-disposition") ?? null), bytes: Number.isFinite(length) && length > 0 ? length : null };
}

async function headOf(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { method: "HEAD", credentials: "same-origin" });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/** "142 KB", "1.4 MB": a file's size as the reader's language writes it. */
export function sizeWords(bytes: number, f: { number: (n: number) => string }, t: ReturnType<typeof useT>): string {
  if (bytes < 1024 * 1024) return t("sc.size.kb", { n: f.number(Math.max(1, Math.round(bytes / 1024))) });
  return t("sc.size.mb", { n: f.number(Math.round((bytes / (1024 * 1024)) * 10) / 10) });
}

export function SignedCopyRow({ signOff, work }: { signOff: SignOff; work: string }) {
  const t = useT();
  const { session, f } = useJobsScreen();
  const { load } = useLoad(() => readSignedCopy(session, signOff.id), [session, signOff.id]);
  if (load.state !== "ready" || load.data === null) return null;
  const copy = load.data;
  const name = copy.filename ?? `${t("sc.name", { work })}.${copy.format === "pdf" ? "pdf" : "html"}`;
  const pdf = copy.format === "pdf";
  return (
    <div className="crm-sc-file" role="group" aria-label={t("sc.row")} data-testid="jb-so-copy" data-format={copy.format}>
      <span className="crm-sc-tag" data-format={copy.format}>
        {t(pdf ? "sc.tag.pdf" : "sc.tag.print")}
      </span>
      <span className="crm-sc-words">
        <span className="crm-sc-name" dir="auto" data-testid="jb-so-copy-name">
          {name}
        </span>
        {copy.bytes !== null && (
          <span className="crm-sc-size crm-mono" data-testid="jb-so-copy-size">
            {sizeWords(copy.bytes, f, t)}
          </span>
        )}
        {!pdf && <span className="crm-sc-hint">{t("sc.print.hint")}</span>}
      </span>
      {pdf ? (
        <a className="crm-btn crm-btn-ghost crm-sc-btn mr-gi" href={copy.url} download={name} aria-label={t("sc.download.aria", { name })} data-testid="jb-so-copy-download">
          <Icon name="download" size={14} />
          {t("sc.download")}
        </a>
      ) : (
        <a className="crm-btn crm-btn-ghost crm-sc-btn mr-gi" href={copy.url} target="_blank" rel="noopener" aria-label={t("sc.open.aria", { name })} data-testid="jb-so-copy-download">
          <Icon name="printer" size={14} />
          {t("sc.open")}
        </a>
      )}
    </div>
  );
}
