/**
 * THE STAND'S MAIL CATCHER: an SMTP server on loopback that keeps every mail
 * the stand's Adminium sends, and hands them to a spec as JSON. Copied from
 * the engine's own e2e server (`apps/e2e/scripts/e2e-server.mjs`, its "SMTP
 * sink"), and run as its own process beside the stand's server, so it lives
 * exactly as long as the stand does.
 *
 * Plain SMTP (no STARTTLS, no AUTH: the server's transport drops TLS for a
 * loopback host and sends no AUTH for an empty user). `smtp-server` and
 * `mailparser` come from the engine checkout's `apps/e2e`, so this app takes
 * no new dependency.
 *
 *   GET    /messages   every mail kept, oldest first
 *   DELETE /messages   forget them all
 *
 * Started by `stand.mjs` when `CRM_STAND_MAIL=1`:
 *   node e2e/mail-catcher.mjs <ADMINIUM_REPO> <smtpPort> <httpPort>
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";

const [adminiumRepo, smtpArg, httpArg] = process.argv.slice(2);
const HOST = "127.0.0.1";
const SMTP_PORT = Number(smtpArg);
const HTTP_PORT = Number(httpArg);
if (!adminiumRepo || !Number.isInteger(SMTP_PORT) || !Number.isInteger(HTTP_PORT)) {
  console.error("[mail] say: node e2e/mail-catcher.mjs <ADMINIUM_REPO> <smtpPort> <httpPort>");
  process.exit(2);
}
const e2eRequire = createRequire(join(adminiumRepo, "apps", "e2e", "package.json"));
const { SMTPServer } = e2eRequire("smtp-server");
const { simpleParser } = e2eRequire("mailparser");

const kept = [];
const list = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ["AUTH", "STARTTLS"],
  disableReverseLookup: true,
  logger: false,
  onData(stream, session, callback) {
    simpleParser(stream).then(
      (parsed) => {
        kept.push({
          receivedAt: Date.now(),
          envelope: {
            from: session.envelope.mailFrom === false ? "" : session.envelope.mailFrom.address,
            to: session.envelope.rcptTo.map((entry) => entry.address),
          },
          subject: parsed.subject ?? "",
          from: parsed.from?.text ?? "",
          to: list(parsed.to).flatMap((entry) => entry.value.map((address) => address.address ?? "")),
          replyTo: parsed.replyTo?.text ?? "",
          html: typeof parsed.html === "string" ? parsed.html : "",
          text: parsed.text ?? "",
          // The bytes too (base64), so a spec can open an attached PDF.
          attachments: parsed.attachments.map((attachment) => ({
            filename: attachment.filename ?? "",
            contentType: attachment.contentType,
            cid: attachment.cid ?? null,
            size: attachment.size,
            related: attachment.related === true,
            content: Buffer.from(attachment.content).toString("base64"),
          })),
        });
        callback();
      },
      (error) => callback(error instanceof Error ? error : new Error(String(error))),
    );
  },
});
await new Promise((resolve, reject) => {
  smtp.once("error", reject);
  smtp.listen(SMTP_PORT, HOST, () => resolve());
});

const http = createServer((req, res) => {
  if (req.url === "/messages" && req.method === "GET") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(kept));
    return;
  }
  if (req.url === "/messages" && req.method === "DELETE") {
    kept.length = 0;
    res.statusCode = 204;
    res.end();
    return;
  }
  res.statusCode = 404;
  res.end();
});
await new Promise((resolve) => http.listen(HTTP_PORT, HOST, resolve));
console.log(`[mail] SMTP on ${HOST}:${String(SMTP_PORT)}; mails at http://${HOST}:${String(HTTP_PORT)}/messages`);

const stop = () => {
  smtp.close();
  http.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
