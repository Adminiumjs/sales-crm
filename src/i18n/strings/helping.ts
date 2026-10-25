/**
 * Area bundle: **helping** on a colleague's deal (ruling 1d): a rep listed on
 * a deal she does not own reads it and comments, and its owner makes the
 * changes. Written a key at a time: see `table.ts`.
 *
 * A plural is written `one|other` (Czech `one|few|other`, Arabic
 * `zero|one|two|few|many|other`, Chinese one form): see `PLURAL_ORDER`.
 */
import { tables } from "./table.ts";

export const helping = tables({
  "help.room": [
    "You’re helping on this deal: {owner} makes the changes. You can read all of it and comment.",
    "Sie unterstützen bei diesem Deal: Änderungen macht {owner}. Sie können alles lesen und kommentieren.",
    "Vous êtes en renfort sur cette affaire : c’est {owner} qui fait les changements. Vous pouvez tout lire et commenter.",
    "Du hjælper på denne deal: {owner} laver ændringerne. Du kan læse det hele og kommentere.",
    "Na tomto obchodu vypomáháte: změny dělá {owner}. Můžete si vše přečíst a komentovat.",
    "你在协助这个商机：更改由 {owner} 来做。你可以阅读全部内容并发表评论。",
    "你在協助這個案件：變更由 {owner} 來做。你可以閱讀全部內容並留言。",
    "أنت تساعد في هذه الصفقة: التغييرات يجريها {owner}. يمكنك قراءة كل شيء فيها والتعليق.",
  ],
  "help.quote": [
    "You’re helping on this deal: {owner} changes and sends its quotes. You can read every version.",
    "Sie unterstützen bei diesem Deal: Angebote ändert und sendet {owner}. Sie können jede Version lesen.",
    "Vous êtes en renfort sur cette affaire : c’est {owner} qui modifie et envoie ses devis. Vous pouvez lire chaque version.",
    "Du hjælper på denne deal: {owner} ændrer og sender dens tilbud. Du kan læse hver version.",
    "Na tomto obchodu vypomáháte: nabídky mění a odesílá {owner}. Můžete si přečíst každou verzi.",
    "你在协助这个商机：报价由 {owner} 修改和发送。你可以阅读每个版本。",
    "你在協助這個案件：報價由 {owner} 修改和寄出。你可以閱讀每個版本。",
    "أنت تساعد في هذه الصفقة: {owner} يعدّل عروض أسعارها ويرسلها. يمكنك قراءة كل إصدار.",
  ],
  "help.call": [
    "You’re helping on this deal: {owner} logs its calls. Say what you know in its comments.",
    "Sie unterstützen bei diesem Deal: Gespräche hält {owner} fest. Was Sie wissen, schreiben Sie in die Kommentare.",
    "Vous êtes en renfort sur cette affaire : c’est {owner} qui consigne ses appels. Dites ce que vous savez dans ses commentaires.",
    "Du hjælper på denne deal: {owner} noterer dens opkald. Skriv det, du ved, i dens kommentarer.",
    "Na tomto obchodu vypomáháte: hovory zapisuje {owner}. Co víte, napište do komentářů.",
    "你在协助这个商机：通话由 {owner} 记录。你知道的情况请写在评论里。",
    "你在協助這個案件：通話由 {owner} 記錄。你知道的情況請寫在留言裡。",
    "أنت تساعد في هذه الصفقة: {owner} يسجّل مكالماتها. اكتب ما تعرفه في تعليقاتها.",
  ],
  "help.board": [
    "A deal you’re helping on stays where its owner puts it: open it to read it and comment.",
    "Ein Deal, bei dem Sie unterstützen, bleibt, wo die zuständige Person ihn hinlegt: Öffnen Sie ihn, um ihn zu lesen und zu kommentieren.",
    "Une affaire où vous êtes en renfort reste là où son responsable la met : ouvrez-la pour la lire et la commenter.",
    "En deal, du hjælper på, bliver, hvor den ansvarlige sætter den: åbn den for at læse og kommentere.",
    "Obchod, na kterém vypomáháte, zůstává tam, kam ho dá jeho vlastník: otevřete ho, chcete-li ho číst a komentovat.",
    "你协助的商机由负责人移动：打开它即可阅读和评论。",
    "你協助的案件由負責人移動：開啟它即可閱讀和留言。",
    "الصفقة التي تساعد فيها يحرّكها المسؤول عنها: افتحها لتقرأها وتعلّق عليها.",
  ],
  "help.bare": [
    "{owner} starts its quote",
    "Das Angebot erstellt {owner}",
    "C’est {owner} qui lance son devis",
    "{owner} laver tilbuddet",
    "Nabídku založí {owner}",
    "报价由 {owner} 发起",
    "報價由 {owner} 建立",
    "{owner} يبدأ عرض السعر",
  ],
  "help.booking": [
    "{count} deal you’re helping on is not listed: its owner books its visits.|{count} deals you’re helping on are not listed: their owners book their visits.",
    "{count} Deal, bei dem Sie unterstützen, steht nicht in der Liste: Besuche bucht die zuständige Person.|{count} Deals, bei denen Sie unterstützen, stehen nicht in der Liste: Besuche bucht jeweils die zuständige Person.",
    "{count} affaire où vous êtes en renfort n’est pas listée : son responsable réserve ses visites.|{count} affaires où vous êtes en renfort ne sont pas listées : leurs responsables réservent leurs visites.",
    "{count} deal, du hjælper på, er ikke på listen: den ansvarlige booker besøgene.|{count} deals, du hjælper på, er ikke på listen: de ansvarlige booker besøgene.",
    "{count} obchod, na kterém vypomáháte, tu není: návštěvy objednává jeho vlastník.|{count} obchody, na kterých vypomáháte, tu nejsou: návštěvy objednávají jejich vlastníci.|{count} obchodů, na kterých vypomáháte, tu není: návštěvy objednávají jejich vlastníci.",
    "未列出你协助的 {count} 个商机：拜访由各自的负责人预约。",
    "未列出你協助的 {count} 件案件：拜訪由各自的負責人預約。",
    "لا صفقات تساعد فيها هنا.|صفقة واحدة تساعد فيها غير مدرجة: المسؤول عنها يحجز زياراتها.|صفقتان تساعد فيهما غير مدرجتين: المسؤول عن كل منهما يحجز زياراتها.|{count} صفقات تساعد فيها غير مدرجة: المسؤول عن كل منها يحجز زياراتها.|{count} صفقة تساعد فيها غير مدرجة: المسؤول عن كل منها يحجز زياراتها.|{count} صفقة تساعد فيها غير مدرجة: المسؤول عن كل منها يحجز زياراتها.",
  ],
  "help.visit": [
    "This visit is {name}’s to write up: you’re helping on this deal.",
    "Diesen Besuch schreibt {name} auf: Sie unterstützen bei diesem Deal.",
    "C’est à {name} de rédiger le compte rendu de cette visite : vous êtes en renfort sur cette affaire.",
    "Det er {name}, der skriver dette besøg op: du hjælper på denne deal.",
    "Zápis z této návštěvy píše {name}: na tomto obchodu vypomáháte.",
    "这次拜访由 {name} 记录：你在协助这个商机。",
    "這次拜訪由 {name} 記錄：你在協助這個案件。",
    "تدوين هذه الزيارة من شأن {name}: أنت تساعد في هذه الصفقة.",
  ],
});
