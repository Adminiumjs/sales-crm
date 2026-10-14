/**
 * Area bundle: **base**.
 *
 * The words every page needs before any screen is drawn: the app opened
 * outside Adminium, Adminium not answering, who is signed in.
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
    "base.outside.heading": "This is the staff side of Sales CRM",
    "base.outside.body": "It runs inside Adminium, which holds its data and signs people in. Install the app in Adminium and open it from there.",
    "base.unreachable.heading": "Adminium could not be reached",
    "base.unreachable.body": "Nothing was lost. Check the connection and try again.",
    "base.tryAgain": "Try again",
    "base.signedInAs": "Signed in as {name}",
  },
  "de-DE": {
    "base.outside.heading": "Dies ist die Mitarbeiterseite von Sales CRM",
    "base.outside.body": "Sie läuft in Adminium, das die Daten hält und die Anmeldung übernimmt. Installieren Sie die App in Adminium und öffnen Sie sie von dort.",
    "base.unreachable.heading": "Adminium ist nicht erreichbar",
    "base.unreachable.body": "Es ist nichts verloren gegangen. Prüfen Sie die Verbindung und versuchen Sie es erneut.",
    "base.tryAgain": "Erneut versuchen",
    "base.signedInAs": "Angemeldet als {name}",
  },
  "fr-FR": {
    "base.outside.heading": "Ceci est l’espace équipe de Sales CRM",
    "base.outside.body": "Il fonctionne dans Adminium, qui conserve ses données et gère la connexion. Installez l’application dans Adminium et ouvrez-la depuis celui-ci.",
    "base.unreachable.heading": "Impossible de joindre Adminium",
    "base.unreachable.body": "Rien n’a été perdu. Vérifiez la connexion, puis réessayez.",
    "base.tryAgain": "Réessayer",
    "base.signedInAs": "Connecté en tant que {name}",
  },
  "da-DK": {
    "base.outside.heading": "Dette er medarbejdersiden af Sales CRM",
    "base.outside.body": "Den kører i Adminium, som opbevarer dataene og logger folk ind. Installer appen i Adminium, og åbn den derfra.",
    "base.unreachable.heading": "Adminium kunne ikke nås",
    "base.unreachable.body": "Intet gik tabt. Tjek forbindelsen, og prøv igen.",
    "base.tryAgain": "Prøv igen",
    "base.signedInAs": "Logget ind som {name}",
  },
  "cs-CZ": {
    "base.outside.heading": "Toto je část Sales CRM pro zaměstnance",
    "base.outside.body": "Běží v Adminiu, které uchovává data a přihlašuje uživatele. Nainstalujte aplikaci v Adminiu a otevřete ji odtud.",
    "base.unreachable.heading": "Adminium není dostupné",
    "base.unreachable.body": "Nic se neztratilo. Zkontrolujte připojení a zkuste to znovu.",
    "base.tryAgain": "Zkusit znovu",
    "base.signedInAs": "Přihlášen(a) jako {name}",
  },
  "zh-CN": {
    "base.outside.heading": "这是 Sales CRM 的员工端",
    "base.outside.body": "它在 Adminium 中运行，数据和登录都由 Adminium 负责。请在 Adminium 中安装此应用，并从那里打开。",
    "base.unreachable.heading": "无法连接 Adminium",
    "base.unreachable.body": "没有丢失任何内容。请检查网络连接后重试。",
    "base.tryAgain": "重试",
    "base.signedInAs": "当前登录：{name}",
  },
  "zh-TW": {
    "base.outside.heading": "這是 Sales CRM 的員工端",
    "base.outside.body": "它在 Adminium 中執行，資料與登入都由 Adminium 負責。請在 Adminium 中安裝此應用程式，並從那裡開啟。",
    "base.unreachable.heading": "無法連線到 Adminium",
    "base.unreachable.body": "沒有遺失任何內容。請檢查網路連線後再試一次。",
    "base.tryAgain": "再試一次",
    "base.signedInAs": "目前登入：{name}",
  },
  "ar-EG": {
    "base.outside.heading": "هذه واجهة الموظفين في Sales CRM",
    "base.outside.body": "تعمل داخل Adminium الذي يحفظ بياناتها ويتولى تسجيل الدخول. ثبّت التطبيق في Adminium وافتحه من هناك.",
    "base.unreachable.heading": "تعذّر الوصول إلى Adminium",
    "base.unreachable.body": "لم يُفقد شيء. تحقق من الاتصال ثم أعد المحاولة.",
    "base.tryAgain": "أعد المحاولة",
    "base.signedInAs": "تم تسجيل الدخول باسم {name}",
  },
} satisfies Record<LocaleTag, Record<string, string>>;
