/**
 * Area bundle: **The signed copy** (plan 68 S13): the office Sign-off's file
 * row under "Who signed": the signed copy Invoices & Receipts draws from the
 * sign-off, as a PDF, or as the print page where its words cannot be set in a
 * PDF (Arabic). A key at a time (see `table.ts`).
 */
import { tables } from "./table.ts";

export const signedcopy = /*#__PURE__*/ tables({
  "sc.row": ["The signed copy", "Die unterschriebene Kopie", "La copie signée", "Den underskrevne kopi", "Podepsaná kopie", "签字副本", "簽名副本", "النسخة الموقّعة"],
  "sc.tag.pdf": ["PDF", "PDF", "PDF", "PDF", "PDF", "PDF", "PDF", "PDF"],
  "sc.tag.print": ["Print page", "Druckseite", "Page à imprimer", "Udskriftsside", "Tisková stránka", "打印页", "列印頁", "صفحة للطباعة"],
  "sc.name": ["Signed copy, {work}", "Unterschriebene Kopie, {work}", "Copie signée, {work}", "Underskrevet kopi, {work}", "Podepsaná kopie, {work}", "签字副本，{work}", "簽名副本，{work}", "نسخة موقّعة، {work}"],
  "sc.size.kb": ["{n} KB", "{n} KB", "{n} Ko", "{n} KB", "{n} kB", "{n} KB", "{n} KB", "{n} ك.ب"],
  "sc.size.mb": ["{n} MB", "{n} MB", "{n} Mo", "{n} MB", "{n} MB", "{n} MB", "{n} MB", "{n} م.ب"],
  "sc.download": ["Download", "Herunterladen", "Télécharger", "Hent", "Stáhnout", "下载", "下載", "تنزيل"],
  "sc.download.aria": ["Download the signed copy, {name}", "Die unterschriebene Kopie herunterladen, {name}", "Télécharger la copie signée, {name}", "Hent den underskrevne kopi, {name}", "Stáhnout podepsanou kopii, {name}", "下载签字副本：{name}", "下載簽名副本：{name}", "تنزيل النسخة الموقّعة، {name}"],
  "sc.open": ["Open", "Öffnen", "Ouvrir", "Åbn", "Otevřít", "打开", "開啟", "فتح"],
  "sc.open.aria": ["Open the signed copy’s print page, {name}", "Die Druckseite der unterschriebenen Kopie öffnen, {name}", "Ouvrir la page à imprimer de la copie signée, {name}", "Åbn udskriftssiden for den underskrevne kopi, {name}", "Otevřít tiskovou stránku podepsané kopie, {name}", "打开签字副本的打印页：{name}", "開啟簽名副本的列印頁：{name}", "فتح صفحة الطباعة للنسخة الموقّعة، {name}"],
  "sc.print.hint": [
    "Its words cannot be set in a PDF: print it, or save it as a PDF from the print dialog.",
    "Ihr Text lässt sich nicht als PDF setzen: Drucken Sie sie oder speichern Sie sie im Druckdialog als PDF.",
    "Son texte ne peut pas être composé en PDF : imprimez-la, ou enregistrez-la en PDF depuis la boîte d’impression.",
    "Teksten kan ikke sættes som PDF: Udskriv den, eller gem den som PDF fra udskriftsvinduet.",
    "Její text nejde vysázet do PDF: vytiskněte ji, nebo ji v tiskovém dialogu uložte jako PDF.",
    "其文字无法排成 PDF：请打印，或在打印对话框中另存为 PDF。",
    "其文字無法排成 PDF：請列印，或在列印對話框中另存為 PDF。",
    "لا يمكن إخراج نصها في ملف PDF: اطبعها، أو احفظها بصيغة PDF من نافذة الطباعة.",
  ],
});
