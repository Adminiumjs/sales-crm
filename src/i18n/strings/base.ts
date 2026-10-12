/**
 * Area bundle: **base**.
 *
 * The words of the one page the app has while it is rebuilt (`app/App.tsx`).
 * Each later area gets a module of its own beside this one.
 *
 * Add keys to all eight locales at once. `en-US` is the source of truth: every
 * key it carries becomes part of `MessageKey`, and `messages/index.ts` makes a
 * missing translation a COMPILE error rather than a silent fallback.
 *
 * fr-FR uses typographic apostrophes and a NO-BREAK SPACE before `? ! : ;`.
 * zh-TW is translated independently of zh-CN — never character-converted.
 */
import type { LocaleTag } from "../locales.ts";

export const base = {
  "en-US": {
    "base.rebuilding.heading": "Sales CRM is being rebuilt",
    "base.rebuilding.body":
      "There are no screens here yet. The tables, the roles and the sample data come first; the screens follow.",
  },
  "de-DE": {
    "base.rebuilding.heading": "Sales CRM wird neu aufgebaut",
    "base.rebuilding.body":
      "Hier gibt es noch keine Ansichten. Zuerst kommen die Tabellen, die Rollen und die Beispieldaten, danach die Ansichten.",
  },
  "fr-FR": {
    "base.rebuilding.heading": "Sales CRM est en cours de reconstruction",
    "base.rebuilding.body":
      "Il n’y a pas encore d’écran ici. Les tables, les rôles et les données d’exemple viennent d’abord ; les écrans suivront.",
  },
  "da-DK": {
    "base.rebuilding.heading": "Sales CRM bliver bygget om",
    "base.rebuilding.body":
      "Der er ingen skærmbilleder her endnu. Tabellerne, rollerne og eksempeldataene kommer først; skærmbillederne følger.",
  },
  "cs-CZ": {
    "base.rebuilding.heading": "Sales CRM se přestavuje",
    "base.rebuilding.body":
      "Zatím tu nejsou žádné obrazovky. Nejdřív přijdou tabulky, role a ukázková data, obrazovky až potom.",
  },
  "zh-CN": {
    "base.rebuilding.heading": "Sales CRM 正在重建",
    "base.rebuilding.body": "这里还没有任何界面。先完成数据表、角色和示例数据，界面随后推出。",
  },
  "zh-TW": {
    "base.rebuilding.heading": "Sales CRM 正在重建",
    "base.rebuilding.body": "這裡還沒有任何畫面。會先完成資料表、角色和範例資料，畫面隨後推出。",
  },
  "ar-EG": {
    "base.rebuilding.heading": "يُعاد بناء Sales CRM",
    "base.rebuilding.body": "لا توجد شاشات هنا بعد. تأتي الجداول والأدوار والبيانات التجريبية أولاً، ثم الشاشات.",
  },
} satisfies Record<LocaleTag, Record<string, string>>;
