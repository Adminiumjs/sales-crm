/**
 * Area bundle: **what was removed, and why** (plan 68 R4d, S3, S16): a removed
 * message's line and its button, a deal's "added by" and "taken off by"
 * lines, and the cancelled visits and bookings read through their deal, job
 * or space. A key at a time (see `table.ts`).
 */
import { tables } from "./table.ts";

export const removals = /*#__PURE__*/ tables({
  "rm.msg.removed": [
    "Message removed by {name}, {when}",
    "Nachricht entfernt von {name}, {when}",
    "Message retiré par {name}, {when}",
    "Besked fjernet af {name}, {when}",
    "Zprávu odstranil(a) {name}, {when}",
    "消息已由{name}删除，{when}",
    "訊息已由{name}刪除，{when}",
    "حذف {name} الرسالة، {when}",
  ],
  "rm.msg.preview": ["Message removed", "Nachricht entfernt", "Message retiré", "Besked fjernet", "Zpráva odstraněna", "消息已删除", "訊息已刪除", "رسالة محذوفة"],
  "rm.msg.remove": ["Remove", "Entfernen", "Retirer", "Fjern", "Odstranit", "删除", "刪除", "احذف"],
  "rm.msg.remove.aria": [
    "Remove the message of {when}",
    "Nachricht von {when} entfernen",
    "Retirer le message de {when}",
    "Fjern beskeden fra {when}",
    "Odstranit zprávu z {when}",
    "删除{when}的消息",
    "刪除{when}的訊息",
    "احذف رسالة {when}",
  ],
  "rm.msg.confirm.title": ["Remove this message?", "Diese Nachricht entfernen?", "Retirer ce message ?", "Fjern denne besked?", "Odstranit tuto zprávu?", "删除这条消息？", "刪除這則訊息？", "هل تحذف هذه الرسالة؟"],
  "rm.msg.confirm.body": [
    "Everyone in the conversation sees that it was removed, and by whom. Its words are gone from the conversation.",
    "Alle in der Unterhaltung sehen, dass sie entfernt wurde und von wem. Ihr Text ist aus der Unterhaltung verschwunden.",
    "Tous les participants verront qu’il a été retiré, et par qui. Son texte disparaît de la conversation.",
    "Alle i samtalen kan se, at den er fjernet, og af hvem. Dens ord er væk fra samtalen.",
    "Všichni v konverzaci uvidí, že byla odstraněna a kým. Její text z konverzace zmizí.",
    "对话中的每个人都会看到它已被删除以及删除人。它的内容将从对话中消失。",
    "對話中的每個人都會看到它已被刪除以及刪除人。它的內容將從對話中消失。",
    "سيرى كل من في المحادثة أنها حُذفت ومن حذفها. ولن يبقى نصها في المحادثة.",
  ],
  "rm.msg.confirm.go": ["Remove it", "Entfernen", "Retirer", "Fjern den", "Odstranit", "删除", "刪除", "احذفها"],
  "rm.msg.toast": ["Message removed.", "Nachricht entfernt.", "Message retiré.", "Beskeden er fjernet.", "Zpráva odstraněna.", "消息已删除。", "訊息已刪除。", "حُذفت الرسالة."],

  "rm.line.label": ["On the deal", "Am Deal beteiligt", "Sur l’affaire", "På handlen", "Na obchodu", "商机协作", "案件協作", "في الصفقة"],
  "rm.line.added": ["{name} added by {by}.", "{name} hinzugefügt von {by}.", "{name} ajouté(e) par {by}.", "{name} tilføjet af {by}.", "{by} přidal(a): {name}.", "{name}由{by}加入。", "{name}由{by}加入。", "أضاف {by} ‏{name}."],
  "rm.line.added.bare": ["{name} added.", "{name} hinzugefügt.", "{name} ajouté(e).", "{name} tilføjet.", "{name} přidán(a).", "{name}已加入。", "{name}已加入。", "أُضيف {name}."],
  "rm.line.off": ["{name} taken off by {by}.", "{name} entfernt von {by}.", "{name} retiré(e) par {by}.", "{name} taget af af {by}.", "{by} odebral(a): {name}.", "{name}由{by}移出。", "{name}由{by}移出。", "أزال {by} ‏{name}."],

  "rm.list.show": ["Show {what}", "{what} anzeigen", "Afficher : {what}", "Vis {what}", "Zobrazit: {what}", "显示{what}", "顯示{what}", "اعرض {what}"],
  "rm.list.hide": ["Hide {what}", "{what} ausblenden", "Masquer : {what}", "Skjul {what}", "Skrýt: {what}", "隐藏{what}", "隱藏{what}", "أخفِ {what}"],
  "rm.list.none": ["Nothing was cancelled.", "Nichts wurde abgesagt.", "Rien n’a été annulé.", "Intet er aflyst.", "Nic nebylo zrušeno.", "没有取消的记录。", "沒有取消的紀錄。", "لم يُلغَ شيء."],
  "rm.list.by": ["Cancelled by {name}, {when}", "Abgesagt von {name}, {when}", "Annulé par {name}, {when}", "Aflyst af {name}, {when}", "Zrušil(a) {name}, {when}", "由{name}取消，{when}", "由{name}取消，{when}", "ألغاه {name}، {when}"],
  "rm.list.why": ["Why: {reason}", "Grund: {reason}", "Pourquoi : {reason}", "Hvorfor: {reason}", "Proč: {reason}", "原因：{reason}", "原因：{reason}", "السبب: {reason}"],
  "rm.list.noWhy": ["No reason was given.", "Es wurde kein Grund genannt.", "Aucune raison n’a été donnée.", "Der blev ikke givet nogen grund.", "Důvod nebyl uveden.", "未说明原因。", "未說明原因。", "لم يُذكر سبب."],
  "rm.visits.title": ["cancelled visits", "abgesagte Besuche", "visites annulées", "aflyste besøg", "zrušené návštěvy", "已取消的拜访", "已取消的拜訪", "الزيارات الملغاة"],
  "rm.bookings.title": ["cancelled bookings", "abgesagte Buchungen", "réservations annulées", "aflyste bookinger", "zrušené rezervace", "已取消的预约", "已取消的預約", "الحجوزات الملغاة"],
  "rm.jobs.title": ["called-off visits", "abgesagte Einsätze", "interventions annulées", "aflyste besøg", "zrušené výjezdy", "已取消的上门", "已取消的到府", "الزيارات الملغاة"],
  "rm.list.for": ["{what} · was {when}", "{what} · war {when}", "{what} · prévu {when}", "{what} · var {when}", "{what} · mělo být {when}", "{what} · 原定{when}", "{what} · 原定{when}", "{what} · كان {when}"],
});
