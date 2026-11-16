#!/usr/bin/env node
/**
 * Paying for an accepted quote online: on the engine words of Adminium 0.3.60.
 *
 * Changes `whole/manifest.json` only. Finds everything by key or name,
 * asserts what it needs, and is idempotent: run twice, it changes nothing
 * more.
 *
 *   node scripts/quote-payments-whole.mjs
 *   npm run stage
 *
 * What it does:
 *  - Settings gains what is asked when a customer accepts a quote: nothing
 *    (as before), a deposit of a percentage, or the whole amount. The CRM
 *    admin and the sales manager write it;
 *  - a quote takes the setting as it stands when the quote is made, so a
 *    later change of the setting never moves what a quote already asks, and
 *    works out what is asked: the deposit, rounded to the currency's minor
 *    unit by the column's own scale, or the total. What was paid, refunded,
 *    when, and what is left are the server's (a total of the quote's
 *    payments, and a formula over it). A refunded deposit is due again;
 *  - a new table of the Quotes part, `quote_payments`: one row a payment,
 *    written by Adminium alone (an online payment, or one a person records in
 *    Adminium's own payment panel), with its unique reference, the service
 *    that took it, its currency and what was refunded of it. Added only
 *    while its quote is accepted. Every role that reads quotes reads them; nobody
 *    writes them by hand on the app's screens;
 *  - the quote is payable online (`payments.payables`) while it is accepted,
 *    its deal is not lost and something is asked. Paying moves neither the
 *    quote nor the deal. The payable arrives switched off: someone who
 *    manages payments switches the app on in Payments. Adminium sends the
 *    receipt (the CRM sends none of its own);
 *  - the CRM admin and the sales manager may refund the CRM's own online
 *    payments (`payments:@:refund`);
 *  - the customer's quote link reads what is asked, paid and left, and
 *    whether it can be paid now, of its own quote only;
 *  - the "quote accepted" e-mail gains, only while the quote can be paid
 *    online now (`{{pay_url}}` is filled only then), what is to pay, the pay
 *    button and a button back to the quote. With nothing to pay online it
 *    reads exactly as before.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(APP, "whole", "manifest.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

const fail = (message) => {
  throw new Error(`quote-payments-whole: ${message}`);
};
const must = (value, what) => (value === undefined || value === null ? fail(`${what} is not there`) : value);
const tables = must(manifest.requiredSchema?.tables, "requiredSchema.tables");
const table = (ref) => must(tables.find((one) => one.ref === ref), `table ${ref}`);
const role = (key) => must(manifest.roles.find((one) => one.key === key), `role ${key}`);
/** Eight languages, in the manifest's order, from one row of words. */
const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];
const words = (...row) => {
  if (row.length !== LOCALES.length) fail(`"${row[0]}" is not in eight languages`);
  return Object.fromEntries(LOCALES.map((locale, i) => [locale, row[i]]));
};
/** Puts a column in its place (after `after`), or replaces the one of that name. */
const put = (ref, columnDef, after) => {
  const columns = table(ref).columns;
  const at = columns.findIndex((one) => one.ref === columnDef.ref);
  if (at >= 0) {
    columns[at] = columnDef;
    return;
  }
  const behind = columns.findIndex((one) => one.ref === after);
  if (behind < 0) fail(`column ${ref}.${after} is not there`);
  columns.splice(behind + 1, 0, columnDef);
};

// The payable words, the refund right and the pay-link entries are Adminium 0.3.60's.
manifest.compatibility.minAdminiumVersion = "0.3.60";

// ── What is asked: the setting ──────────────────────────────────────────────
const ASK_LABELS = {
  off: words("Off", "Aus", "Désactivé", "Fra", "Vypnuto", "إيقاف", "关闭", "關閉"),
  deposit: words("A deposit", "Eine Anzahlung", "Un acompte", "Et depositum", "Záloha", "عربون", "定金", "訂金"),
  whole: words("The whole amount", "Der ganze Betrag", "Le montant total", "Hele beløbet", "Celá částka", "المبلغ كاملًا", "全额", "全額"),
};
const DEPOSIT_PCT = words("Deposit (%)", "Anzahlung (%)", "Acompte (%)", "Depositum (%)", "Záloha (%)", "العربون (%)", "定金 (%)", "訂金 (%)");

put(
  "settings",
  {
    ref: "pay_ask",
    type: "enum",
    enum: ["off", "deposit", "whole"],
    default: "off",
    label: words(
      "Ask for payment when a customer accepts a quote",
      "Bei Annahme eines Angebots um Zahlung bitten",
      "Demander un paiement quand un client accepte un devis",
      "Bed om betaling, når en kunde accepterer et tilbud",
      "Požádat o platbu, když zákazník přijme nabídku",
      "اطلب الدفع عندما يقبل العميل عرض سعر",
      "客户接受报价时请求付款",
      "客戶接受報價時請求付款",
    ),
    rules: { enumLabels: { labels: ASK_LABELS } },
  },
  "quote_warn_days",
);
put("settings", { ref: "pay_deposit_pct", type: "int", default: 20, label: DEPOSIT_PCT, rules: { validation: { min: 1, max: 99 } } }, "pay_ask");

// The sales manager writes the Selling tab's numbers; these two are on it.
{
  const manager = role("sales-manager");
  const writable = must(manager.limits?.settings?.writable, "the sales manager's writable settings");
  for (const name of ["pay_ask", "pay_deposit_pct"]) if (!writable.includes(name)) writable.push(name);
}

// ── What a quote asks, and how it stands ────────────────────────────────────
const money = (ref, label, rules) => ({ ref, type: "decimal", scale: "currency", nullable: true, label, rules, semantic: "money" });
const QUOTE_COLUMNS = [
  {
    ref: "pay_ask",
    type: "enum",
    enum: ["off", "deposit", "whole"],
    nullable: true,
    label: words("Payment asked on acceptance", "Zahlung bei Annahme", "Paiement à l’acceptation", "Betaling ved accept", "Platba při přijetí", "الدفع عند القبول", "接受时付款", "接受時付款"),
    rules: {
      default: { from: { table: "settings", column: "pay_ask" } },
      enumLabels: {
        labels: {
          off: words("None", "Keine", "Aucun", "Ingen", "Žádná", "لا شيء", "无", "無"),
          deposit: ASK_LABELS.deposit,
          whole: ASK_LABELS.whole,
        },
      },
    },
  },
  { ref: "pay_pct", type: "int", nullable: true, label: DEPOSIT_PCT, rules: { default: { from: { table: "settings", column: "pay_deposit_pct" } } } },
  // The deposit is worked out once, at the currency's own places (the column's scale): never a browser's sum.
  money("pay_amount", words("Asked on acceptance", "Bei Annahme fällig", "Dû à l’acceptation", "Forfalder ved accept", "Splatné při přijetí", "المستحق عند القبول", "接受时应付", "接受時應付"), {
    formula: {
      if: [
        { eq: ["pay_ask", "deposit"] },
        { div: [{ mul: [{ coalesce: ["total", 0] }, { coalesce: ["pay_pct", 0] }] }, 100] },
        { if: [{ eq: ["pay_ask", "whole"] }, { coalesce: ["total", 0] }, 0] },
      ],
    },
  }),
  money("pay_paid", words("Paid", "Bezahlt", "Payé", "Betalt", "Zaplaceno", "المدفوع", "已付", "已付"), { rollup: { from: "quote_payments", via: "quote_id", sum: "net_amount" } }),
  money("pay_refunded", words("Refunded", "Erstattet", "Remboursé", "Refunderet", "Vráceno", "المبلغ المسترد", "已退款", "已退款"), { rollup: { from: "quote_payments", via: "quote_id", sum: "refunded" } }),
  // A refund opens what was asked again: the deposit is due again.
  money("pay_due", words("Left to pay now", "Jetzt noch offen", "Reste à payer", "Mangler at betale", "Zbývá zaplatit", "المتبقي للدفع", "尚需支付", "尚需支付"), {
    formula: { max: [0, { sub: [{ coalesce: ["pay_amount", 0] }, { coalesce: ["pay_paid", 0] }] }] },
  }),
  {
    ref: "pay_paid_at",
    type: "timestamptz",
    nullable: true,
    label: words("Last paid at", "Zuletzt bezahlt am", "Dernier paiement le", "Sidst betalt den", "Naposledy zaplaceno", "آخر دفعة في", "最近付款时间", "最近付款時間"),
    rules: { rollup: { from: "quote_payments", via: "quote_id", latest: { of: "paid_at", by: "paid_at" } } },
  },
  // The service the latest payment was taken by, for the deal room's line ("Online · Stripe"); empty for one taken by hand.
  {
    ref: "pay_provider",
    type: "text",
    maxLength: 40,
    nullable: true,
    label: words("Last paid through", "Zuletzt bezahlt über", "Dernier paiement par", "Sidst betalt via", "Naposledy zaplaceno přes", "آخر دفعة عبر", "最近付款渠道", "最近付款管道"),
    rules: { rollup: { from: "quote_payments", via: "quote_id", latest: { of: "provider", by: "paid_at" } } },
  },
  // What the customer's page reads to offer "Pay now": accepted, on a deal that is not lost, and something asked.
  {
    ref: "pay_open",
    type: "int",
    nullable: true,
    label: words("Can be paid now", "Jetzt bezahlbar", "Payable maintenant", "Kan betales nu", "Lze nyní zaplatit", "يمكن دفعه الآن", "现在可付款", "現在可付款"),
    rules: { formula: { if: [{ and: [{ eq: ["status", "accepted"] }, { neq: ["deal_state", "lost"] }, { gt: ["pay_amount", 0] }] }, 1, 0] } },
  },
];
{
  let after = "yes_seen_at";
  for (const one of QUOTE_COLUMNS) {
    put("quotes", one, after);
    after = one.ref;
  }
}
// Payments are added only while their quote is accepted; an accepted quote is never moved on.
{
  const states = must(table("quotes").states, "quotes.states");
  states.children = { ...states.children, quote_payments: { via: "quote_id", parentIn: ["accepted"] } };
}

// ── The quote's payments ────────────────────────────────────────────────────
const METHOD_LABELS = {
  online: words("Online", "Online", "En ligne", "Online", "Online", "عبر الإنترنت", "在线", "線上"),
  "bank-transfer": words("Bank transfer", "Überweisung", "Virement", "Bankoverførsel", "Bankovní převod", "تحويل بنكي", "银行转账", "銀行轉帳"),
  cash: words("Cash", "Bar", "Espèces", "Kontant", "Hotově", "نقدًا", "现金", "現金"),
  card: words("Card on a terminal", "Karte am Terminal", "Carte sur un terminal", "Kort på en terminal", "Karta na terminálu", "بطاقة على جهاز دفع", "刷卡终端", "刷卡終端"),
  cheque: words("Cheque", "Scheck", "Chèque", "Check", "Šek", "شيك", "支票", "支票"),
  other: words("Other", "Sonstiges", "Autre", "Andet", "Jiné", "أخرى", "其他", "其他"),
};
const PAYMENTS = {
  ref: "quote_payments",
  label: words("Quote payment", "Angebotszahlung", "Paiement de devis", "Tilbudsbetaling", "Platba za nabídku", "دفعة عرض السعر", "报价付款", "報價付款"),
  labelPlural: words("Quote payments", "Angebotszahlungen", "Paiements de devis", "Tilbudsbetalinger", "Platby za nabídky", "دفعات عروض الأسعار", "报价付款", "報價付款"),
  module: "quotes",
  belongs: [{ via: "quote_id" }],
  indexes: [["paid_at"]],
  columns: [
    { ref: "id", type: "int", role: "pk" },
    { ref: "quote_id", type: "fk", references: "quotes", index: true, label: table("quote_lines").columns.find((one) => one.ref === "document_id").label },
    { ref: "amount", type: "decimal", scale: "currency", default: 0, semantic: "money", label: words("Amount", "Betrag", "Montant", "Beløb", "Částka", "المبلغ", "金额", "金額") },
    { ref: "paid_at", type: "timestamptz", nullable: true, label: words("Paid at", "Bezahlt am", "Payé le", "Betalt den", "Zaplaceno dne", "وقت الدفع", "付款时间", "付款時間") },
    {
      ref: "method",
      type: "enum",
      enum: ["online", "bank-transfer", "cash", "card", "cheque", "other"],
      default: "online",
      label: words("Way paid", "Zahlungsweg", "Moyen de paiement", "Betalingsmåde", "Způsob platby", "طريقة الدفع", "付款方式", "付款方式"),
      rules: { enumLabels: { labels: METHOD_LABELS } },
    },
    {
      ref: "payment_ref",
      type: "text",
      maxLength: 64,
      nullable: true,
      unique: true,
      label: words("Payment reference", "Zahlungsreferenz", "Référence du paiement", "Betalingsreference", "Reference platby", "مرجع الدفع", "付款参考号", "付款參考號"),
    },
    { ref: "provider", type: "text", maxLength: 40, nullable: true, label: words("Taken by", "Abgewickelt über", "Encaissé par", "Gennemført via", "Přes službu", "عبر خدمة", "收款服务", "收款服務") },
    { ref: "currency", type: "text", maxLength: 3, nullable: true, label: table("quotes").columns.find((one) => one.ref === "currency").label },
    { ref: "refunded", type: "decimal", scale: "currency", default: 0, semantic: "money", label: words("Refunded", "Erstattet", "Remboursé", "Refunderet", "Vráceno", "المبلغ المسترد", "已退款", "已退款") },
    {
      ref: "net_amount",
      type: "decimal",
      scale: "currency",
      nullable: true,
      semantic: "money",
      label: words("Kept after refunds", "Nach Erstattungen", "Après remboursements", "Efter refusioner", "Po vrácení", "بعد الاسترداد", "退款后金额", "退款後金額"),
      rules: { formula: { sub: ["amount", { coalesce: ["refunded", 0] }] } },
    },
    { ref: "note", type: "text", maxLength: 500, nullable: true, label: words("Note", "Notiz", "Note", "Note", "Poznámka", "ملاحظة", "备注", "備註") },
  ],
};
{
  const at = tables.findIndex((one) => one.ref === PAYMENTS.ref);
  if (at >= 0) tables[at] = PAYMENTS;
  else tables.splice(tables.findIndex((one) => one.ref === "quote_lines") + 1, 0, PAYMENTS);
}

// Every table has its records page in the console, under its part's heading.
{
  const lines = must(manifest.pages.find((one) => one.ref === "crm-quote-lines"), "the page crm-quote-lines");
  const page = {
    ref: "crm-quote-payments",
    template: "page-crud",
    title: { key: "mft.crm.page.quote_payments", fallback: PAYMENTS.labelPlural["en-US"] },
    titles: Object.fromEntries(Object.entries(PAYMENTS.labelPlural).filter(([locale]) => locale !== "en-US")),
    nav: { group: lines.nav.group, icon: "banknote", order: 21, offRail: true },
    bindings: { rows: "quote_payments" },
    module: "quotes",
  };
  const at = manifest.pages.findIndex((one) => one.ref === page.ref);
  if (at >= 0) manifest.pages[at] = page;
  else manifest.pages.splice(manifest.pages.indexOf(lines) + 1, 0, page);
}

// ── Who reads them, and who refunds ─────────────────────────────────────────
const NEW_QUOTE_READS = QUOTE_COLUMNS.map((one) => one.ref);
const READS = {
  admin: null,
  "sales-manager": { rows: { read: { reach: "team", via: "quote_id", by: "deal_owner_id" } } },
  rep: { rows: { read: { reach: "own" } } },
  "account-manager": { rows: { read: { reach: "own" } } },
  "read-only": null,
};
for (const [key, limit] of Object.entries(READS)) {
  const held = role(key);
  for (const [grant, beside] of [
    ["table:@quote_payments:read", "table:@quote_lines:read"],
    ["page:@crm-quote-payments:view", "page:@crm-quote-lines:view"],
  ]) {
    if (!held.permissions.includes(beside)) fail(`role ${key} holds no ${beside}`);
    if (!held.permissions.includes(grant)) held.permissions.splice(held.permissions.indexOf(beside) + 1, 0, grant);
  }
  if (limit !== null) held.limits = { ...held.limits, quote_payments: limit };
  // A role told which quote columns it reads is told the new ones.
  const readable = held.limits?.quotes?.readable;
  if (readable !== undefined) for (const name of NEW_QUOTE_READS) if (!readable.includes(name)) readable.push(name);
}
for (const key of ["admin", "sales-manager"]) {
  const held = role(key);
  if (!held.permissions.includes("payments:@:refund")) held.permissions.push("payments:@:refund");
}

// ── The customer's link ─────────────────────────────────────────────────────
{
  const entry = must(manifest.publicAccess.find((one) => one.table === "quotes" && one.key === "quote"), "the quote link's entry");
  for (const name of ["pay_ask", "pay_pct", "pay_amount", "pay_paid", "pay_refunded", "pay_due", "pay_paid_at", "pay_open"]) if (!entry.select.includes(name)) entry.select.push(name);
}

// ── The payable ─────────────────────────────────────────────────────────────
manifest.payments = {
  payables: [
    {
      table: "quotes",
      label: "number",
      amount: { column: "pay_amount" },
      currency: { column: "currency" },
      due: { column: "pay_due" },
      payments: {
        kind: "table",
        table: "quote_payments",
        link: "quote_id",
        amount: "amount",
        paidAt: "paid_at",
        method: { column: "method", values: { "*": "online" } },
        note: "note",
        reference: "payment_ref",
        refunded: "refunded",
        provider: "provider",
        currency: "currency",
      },
      customerEmail: "sent_to_email",
      payableWhen: [
        { column: "status", eq: "accepted" },
        { column: "deal_state", in: ["open", "won"] },
        { column: "pay_amount", gt: 0 },
      ],
      returnTo: "/",
      receipt: "engine",
    },
  ],
};
// The key order of the file: the payments sit after the documents, as the last of the app's own blocks.
{
  const { payments, ...rest } = manifest;
  for (const key of Object.keys(manifest)) delete manifest[key];
  Object.assign(manifest, rest, { payments });
}

// ── The "quote accepted" e-mail ─────────────────────────────────────────────
const MAIL = {
  "en-US": {
    quote: "Quote",
    total: "Total",
    now: "To pay now",
    text: "To book the work, pay {{quote.pay_due.money}} online. You’ll pay on the Stripe or PayPal page. Or wait for us to call you.",
    pay: "Pay {{quote.pay_due.money}} online",
    open: "Open your quote",
  },
  "de-DE": {
    quote: "Angebot",
    total: "Summe",
    now: "Jetzt zu zahlen",
    text: "Um den Auftrag zu buchen, zahlen Sie {{quote.pay_due.money}} online. Sie zahlen auf der Seite von Stripe oder PayPal. Oder warten Sie, bis wir Sie anrufen.",
    pay: "{{quote.pay_due.money}} online zahlen",
    open: "Ihr Angebot öffnen",
  },
  "fr-FR": {
    quote: "Devis",
    total: "Total",
    now: "À payer maintenant",
    text: "Pour réserver les travaux, payez {{quote.pay_due.money}} en ligne. Vous paierez sur la page Stripe ou PayPal. Ou attendez notre appel.",
    pay: "Payer {{quote.pay_due.money}} en ligne",
    open: "Ouvrir votre devis",
  },
  "da-DK": {
    quote: "Tilbud",
    total: "I alt",
    now: "Betales nu",
    text: "Betal {{quote.pay_due.money}} online for at booke opgaven. Du betaler på siden hos Stripe eller PayPal. Eller vent, til vi ringer til dig.",
    pay: "Betal {{quote.pay_due.money}} online",
    open: "Åbn dit tilbud",
  },
  "cs-CZ": {
    quote: "Nabídka",
    total: "Celkem",
    now: "K zaplacení teď",
    text: "Chcete-li si práci zarezervovat, zaplaťte {{quote.pay_due.money}} online. Zaplatíte na stránce Stripe nebo PayPal. Nebo počkejte, až vám zavoláme.",
    pay: "Zaplatit {{quote.pay_due.money}} online",
    open: "Otevřít nabídku",
  },
  "ar-EG": {
    quote: "عرض السعر",
    total: "الإجمالي",
    now: "المطلوب دفعه الآن",
    text: "لحجز العمل، ادفع {{quote.pay_due.money}} عبر الإنترنت. ستدفع على صفحة Stripe أو PayPal. أو انتظر اتصالنا بك.",
    pay: "ادفع {{quote.pay_due.money}} عبر الإنترنت",
    open: "افتح عرض السعر",
  },
  "zh-CN": {
    quote: "报价单",
    total: "合计",
    now: "现在应付",
    text: "如需预订这项工作，请在线支付 {{quote.pay_due.money}}。您将在 Stripe 或 PayPal 的页面上付款。也可以等我们给您打电话。",
    pay: "在线支付 {{quote.pay_due.money}}",
    open: "打开您的报价单",
  },
  "zh-TW": {
    quote: "報價單",
    total: "合計",
    now: "現在應付",
    text: "如需預訂這項工作，請線上支付 {{quote.pay_due.money}}。您將在 Stripe 或 PayPal 的頁面上付款。也可以等我們打電話給您。",
    pay: "線上支付 {{quote.pay_due.money}}",
    open: "開啟您的報價單",
  },
};
{
  const template = must(manifest.emailTemplates.find((one) => one.key === "crm-quote-accepted"), "the template crm-quote-accepted");
  for (const name of ["quote.total", "quote.pay_due", "quote.share_code", "pay_url", "manage_url"]) if (!template.vars.includes(name)) template.vars.push(name);
  for (const locale of LOCALES) {
    const said = must(MAIL[locale], `the e-mail's words in ${locale}`);
    const content = must(template.locales[locale], `crm-quote-accepted in ${locale}`);
    // Today's blocks, whatever ran before: the heading and the two lines the mail has always had.
    const today = content.blocks.filter((block) => block.showWhen === undefined);
    if (today.length !== 3) fail(`crm-quote-accepted (${locale}) has ${String(today.length)} blocks of its own, not 3`);
    const paying = [
      {
        block: "email.tax-breakdown",
        showWhen: { var: "pay_url" },
        data: {
          lines: [
            { label: said.quote, amount: "{{quote.number}}" },
            { label: said.total, amount: "{{quote.total.money}}" },
            { label: said.now, amount: "{{quote.pay_due.money}}" },
          ],
        },
      },
      { block: "email.text", showWhen: { var: "pay_url" }, data: { text: said.text } },
      { block: "email.button", showWhen: { var: "pay_url" }, data: { label: said.pay, url: "{{pay_url}}" } },
      { block: "email.button", showWhen: { var: "pay_url" }, data: { label: said.open, url: "{{manage_url}}#{{quote.share_code}}" } },
    ];
    // After the line that says it was accepted, before the one that says what to do if it was not you.
    content.blocks = [today[0], today[1], ...paying, today[2]];
  }
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("quote-payments-whole: whole/manifest.json written");
