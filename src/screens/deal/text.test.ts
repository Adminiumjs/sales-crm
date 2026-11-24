/**
 * A text from a deal: what goes to `POST /texts/send`, what is logged on the
 * deal and when, and how each answer is worded.
 */
import { describe, expect, it } from "vitest";

import { MESSAGES } from "../../i18n/messages/index.ts";
import { LostReply, StaffError, type Row, type Saved } from "../../staffSession.ts";
import type { Contact } from "./data.ts";
import whole from "../../../whole/manifest.json";
import { BOX_VERSION, failedWords, readStanding, recordAnswer, refusedKey, sendText, textable, textActivity, textsReady, type Standing, type TextReply } from "./text.ts";

const contact = (id: number, phone: string | null): Contact => ({ id, name: `Person ${String(id)}`, job_title: null, email: null, phone });

function fakeSession(answer: () => TextReply | Promise<TextReply>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const creates: { ref: string; values: Row; key: string }[] = [];
  let saved: Saved = { state: "saved", row: { id: 7 }, replayed: false, readBack: false };
  return {
    calls,
    creates,
    failLog(next: Saved) {
      saved = next;
    },
    session: {
      connectionId: "conn-1",
      tableId: (ref: string) => `crm_${ref}`,
      call: async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
        calls.push({ method, path, body });
        return { data: await answer() } as T;
      },
      create: async <R extends Row = Row>(ref: string, values: Row, key: string): Promise<Saved<R>> => {
        creates.push({ ref, values, key });
        return saved as Saved<R>;
      },
    },
  };
}

const input = { dealId: 12, contactId: 4, body: "  Hello Petra, the samples are ready.  ", opening: (went: { opensAt: Date | null; sentTo: string | null }) => (went.opensAt === null ? `Text to Petra ${went.sentTo ?? ""}` : `Text to Petra, goes ${went.opensAt.toISOString()}`) };
const keys = { text: "T".repeat(32), activity: "A".repeat(32) };

describe("who a text can go to", () => {
  it("the people with a number on file, the deal's main contact first", () => {
    const people = [contact(1, "+44 20 7946 0001"), contact(2, null), contact(3, " "), contact(4, "+44 7700 900123")];
    expect(textable(people, 4).map((one) => one.id)).toEqual([4, 1]);
    expect(textable(people, 2).map((one) => one.id)).toEqual([1, 4]);
    expect(textable([contact(2, null)], 2)).toEqual([]);
  });
});

describe("sending a text from a deal", () => {
  it("asks the server to text the contact's number, as the person, with the draft's key", async () => {
    const fake = fakeSession(() => ({ threadId: "tth_1", sentTo: "+44 ••• 123", result: { outcome: "queued", deliveryId: "d1", opensAt: null, reason: null } }));
    await sendText(fake.session, input, keys);
    expect(fake.calls).toEqual([{ method: "POST", path: "/texts/send", body: { connection: "conn-1", table: "crm_contacts", row: "4", column: "phone", body: "Hello Petra, the samples are ready.", clientKey: keys.text } }]);
  });

  it("logs a queued text on the deal as a text, with its own retry key", async () => {
    const fake = fakeSession(() => ({ threadId: "tth_1", sentTo: "+44 ••• 123", result: { outcome: "queued", deliveryId: "d1", opensAt: null, reason: null } }));
    const sent = await sendText(fake.session, input, keys);
    expect(sent).toMatchObject({ state: "went", outcome: "queued", opensAt: null, sentTo: "+44 ••• 123", logged: { state: "saved" } });
    expect(fake.creates).toEqual([{ ref: "activities", values: { deal_id: 12, kind: "text", text: "Text to Petra +44 ••• 123\nHello Petra, the samples are ready." }, key: keys.activity }]);
  });

  it("logs a held text too, saying when it goes", async () => {
    const at = Date.UTC(2026, 10, 25, 8, 0);
    const fake = fakeSession(() => ({ threadId: "tth_1", sentTo: null, result: { outcome: "held", deliveryId: "d1", opensAt: at, reason: null } }));
    const sent = await sendText(fake.session, input, keys);
    expect(sent).toMatchObject({ state: "went", outcome: "held", sentTo: null });
    expect(sent.state === "went" ? sent.opensAt?.getTime() : null).toBe(at);
    expect(fake.creates[0]!.values["text"]).toBe(`Text to Petra, goes ${new Date(at).toISOString()}\nHello Petra, the samples are ready.`);
  });

  it("logs nothing when the server refuses it, and says why", async () => {
    for (const reason of ["no-consent", "stopped", "country-blocked", "not-connected", "earlier-send-open"]) {
      const fake = fakeSession(() => ({ threadId: null, sentTo: null, result: { outcome: "refused", deliveryId: null, opensAt: null, reason } }));
      expect(await sendText(fake.session, input, keys)).toEqual({ state: "refused", reason });
      expect(fake.creates, reason).toEqual([]);
    }
  });

  it("logs nothing when the door says no (403, 404, 422), and keeps the status", async () => {
    for (const status of [403, 404, 422]) {
      const fake = fakeSession(() => {
        throw new StaffError(status, "X", "no", status === 422 ? { reason: "not-a-phone-column" } : {});
      });
      const sent = await sendText(fake.session, input, keys);
      expect(sent.state).toBe("failed");
      expect(sent.state === "failed" ? sent.error.status : 0).toBe(status);
      expect(fake.creates).toEqual([]);
    }
  });

  it("a lost reply is unknown, never 'not sent', and logs nothing until the same keys are sent again", async () => {
    let lost = true;
    const fake = fakeSession(() => {
      if (lost) throw new LostReply();
      return { threadId: "tth_1", sentTo: null, result: { outcome: "queued", deliveryId: "d1", opensAt: null, reason: null } };
    });
    expect(await sendText(fake.session, input, keys)).toEqual({ state: "unknown" });
    expect(fake.creates).toEqual([]);
    lost = false;
    await sendText(fake.session, input, keys);
    // The same client key both times: the server answers the delivery the first press made.
    expect(fake.calls.map((one) => (one.body as { clientKey: string }).clientKey)).toEqual([keys.text, keys.text]);
    expect(fake.creates.map((one) => one.key)).toEqual([keys.activity]);
  });

  it("says when the text went and its log did not", async () => {
    const fake = fakeSession(() => ({ threadId: "tth_1", sentTo: null, result: { outcome: "queued", deliveryId: "d1", opensAt: null, reason: null } }));
    fake.failLog({ state: "unknown" });
    expect(await sendText(fake.session, input, keys)).toMatchObject({ state: "went", logged: { state: "unknown" } });
  });

  it("keeps the activity within its column", () => {
    expect(textActivity("Text to Petra", "x".repeat(5000)).length).toBe(4000);
  });
});

describe("the words for each answer", () => {
  it("gives every refusal the send path can answer a sentence of its own in all eight languages", () => {
    const reasons = [
      "no-consent", "unconfirmed-consent", "stopped", "country-blocked", "unreadable-phone", "cannot-receive-text", "not-connected", "no-sender", "off-by-operator", "daily-limit",
      "past-its-moment", "no-send-window", "too-long", "asks-for-yes", "credential-in-template", "value-has-link", "no-opt-out-contact", "opt-out-changed", "promises-reply",
      "template-empty", "unfilled-placeholder", "value-too-long", "not-allowed", "could-not-check", "could-not-queue", "earlier-send-open",
    ];
    for (const reason of reasons) {
      const key = refusedKey(reason);
      expect(key, reason).not.toBe("text.r.other");
      for (const [locale, table] of Object.entries(MESSAGES)) expect(table[key], `${locale} ${key}`).toBeTruthy();
    }
    expect(refusedKey("something-new")).toBe("text.r.other");
  });

  it("words no-consent as a yes to this app, and the answer window", () => {
    expect(MESSAGES["en-US"][refusedKey("no-consent")]).toBe("Not sent. {name} has not agreed to texts from this app, and has not texted you in the last 7 days.");
  });

  it("words 403, 404 and a column that holds no phone, and passes any other refusal's own message", () => {
    expect(failedWords(new StaffError(403, "FORBIDDEN", "You do not have the required permission.", { permission: "texts:crm:reply" }))).toEqual({ key: "text.fail.forbidden" });
    expect(failedWords(new StaffError(404, "NOT_FOUND", "No such record."))).toEqual({ key: "text.fail.gone" });
    expect(failedWords(new StaffError(422, "VALIDATION_FAILED", "That column does not hold a phone number.", { field: "column", reason: "not-a-phone-column" }))).toEqual({ key: "text.fail.notPhone" });
    expect(failedWords(new StaffError(422, "VALIDATION_FAILED", "Body is too long."))).toEqual({ key: "text.fail.refused", message: "Body is too long." });
  });

  it("never calls a queued text delivered", () => {
    for (const table of Object.values(MESSAGES)) expect(table["text.toast.queued"]).not.toMatch(/deliver|zugestellt|livré|leveret|doručen|送达|送達|تسليم/i);
  });
});

describe("where a contact stands, and the answer staff record", () => {
  const standing: Standing = { ready: true, masked: "+44 ••• 182", service: { state: "yes", answer: { at: 1, source: "staff", how: "phone", by: { id: "u1", label: "Dana" }, wordingVersion: "1" } }, marketing: { state: "not-asked", answer: null }, stopped: null };
  function fake(answer: () => unknown) {
    const calls: { method: string; path: string; body: unknown }[] = [];
    return {
      calls,
      session: {
        connectionId: "conn-1",
        tableId: (ref: string) => `crm_${ref}`,
        call: async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
          calls.push({ method, path, body });
          return answer() as T;
        },
      },
    };
  }

  it("asks whether texts are set up, and says 'not known' when it cannot ask", async () => {
    expect(await textsReady(fake(() => ({ data: { ready: false } })).session)).toBe(false);
    expect(await textsReady(fake(() => ({ data: { ready: true } })).session)).toBe(true);
    expect(
      await textsReady(
        fake(() => {
          throw new LostReply();
        }).session,
      ),
    ).toBeNull();
  });

  it("reads the contact's standing by its row and phone column", async () => {
    const one = fake(() => ({ data: standing }));
    expect(await readStanding(one.session, 4)).toEqual({ state: "ok", value: standing });
    expect(one.calls).toEqual([{ method: "GET", path: "/texts/consent?connection=conn-1&table=crm_contacts&row=4&column=phone", body: undefined }]);
  });

  it("records a yes with the words they were read and how, and a no with how alone", async () => {
    const one = fake(() => ({ data: standing }));
    await recordAnswer(one.session, 4, { state: "yes", how: "phone", wording: { text: "Text me about my enquiry", version: BOX_VERSION } });
    await recordAnswer(one.session, 4, { state: "no", how: "in-person" });
    expect(one.calls).toEqual([
      { method: "POST", path: "/texts/consent", body: { connection: "conn-1", table: "crm_contacts", row: "4", column: "phone", state: "yes", how: "phone", wording: { text: "Text me about my enquiry", version: "1" } } },
      { method: "POST", path: "/texts/consent", body: { connection: "conn-1", table: "crm_contacts", row: "4", column: "phone", state: "no", how: "in-person" } },
    ]);
    const refused = fake(() => {
      throw new StaffError(403, "FORBIDDEN", "no");
    });
    expect((await recordAnswer(refused.session, 4, { state: "no", how: "phone" })).state).toBe("failed");
  });

  it("reads staff the same words, and version, as the enquiry form's box, in every language", () => {
    const box = (whole as unknown as { publicAccess: { table: string; key?: string; textConsent?: { wording: { version: number; text: Record<string, string> } } }[] }).publicAccess.find((entry) => entry.table === "enquiries" && entry.key === "forms")!.textConsent!;
    expect(String(box.wording.version)).toBe(BOX_VERSION);
    for (const [locale, words] of Object.entries(box.wording.text)) expect(MESSAGES[locale as keyof typeof MESSAGES]["text.box"], locale).toBe(words);
  });
});
