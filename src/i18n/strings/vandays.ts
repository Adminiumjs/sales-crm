/**
 * Area bundle: **A crew's vehicle for the day, a hired vehicle, and what to
 * load** (plan 68 S14): the booking dialog's "Vehicle for the day", the Day
 * sheet's vehicle and its "Change", the Route's head, Vehicles' hire days and
 * "Where it goes", the crew's vehicle on My day, and each visit's stock and
 * delivery note. A key at a time (see `table.ts`); a plural is `one|other`
 * (Czech `one|few|other`, Arabic `zero|one|two|few|many|other`, Chinese one).
 */
import { tables } from "./table.ts";

export const vandays = /*#__PURE__*/ tables({
  /* ─── The booking dialog ─── */
  "vandays.field": ["Vehicle for the day", "Fahrzeug für den Tag", "Véhicule de la journée", "Køretøj til dagen", "Vozidlo na den", "当天的车辆", "當天的車輛", "مركبة اليوم"],
  "vandays.list": ["Vehicles for {crew} on {day}", "Fahrzeuge für {crew} am {day}", "Véhicules pour {crew} le {day}", "Køretøjer til {crew} den {day}", "Vozidla pro {crew} na {day}", "{crew} 在 {day} 可用的车辆", "{crew} 在 {day} 可用的車輛", "المركبات لـ {crew} يوم {day}"],
  "vandays.own": ["{crew}’s own", "Eigenes von {crew}", "Celui de {crew}", "{crew}s eget", "Vlastní vozidlo: {crew}", "{crew} 自己的", "{crew} 自己的", "المركبة الخاصة بـ {crew}"],
  "vandays.with": ["With {crew} on {day}", "Bei {crew} am {day}", "Avec {crew} le {day}", "Hos {crew} den {day}", "U {crew} na {day}", "{day} 归 {crew} 使用", "{day} 歸 {crew} 使用", "مع {crew} يوم {day}"],
  "vandays.until": ["Hired until {day}", "Gemietet bis {day}", "Loué jusqu’au {day}", "Lejet til {day}", "Najato do {day}", "租用至 {day}", "租用至 {day}", "مستأجرة حتى {day}"],
  "vandays.notHired": ["Not hired on {day}", "Am {day} nicht gemietet", "Pas loué le {day}", "Ikke lejet den {day}", "Na {day} nenajato", "{day} 未租用", "{day} 未租用", "غير مستأجرة يوم {day}"],
  "vandays.idle": ["{crew}’s own · not in use on {day}", "Eigenes von {crew} · am {day} frei", "Celui de {crew} · libre le {day}", "{crew}s eget · ikke i brug den {day}", "Vlastní vozidlo: {crew} · na {day} volné", "{crew} 自己的 · {day} 未使用", "{crew} 自己的 · {day} 未使用", "خاصة بـ {crew} · لا تُستخدم يوم {day}"],
  "vandays.isWith": ["{plate} is with {crew} on {day}.", "{plate} ist am {day} bei {crew}.", "{plate} est avec {crew} le {day}.", "{plate} er hos {crew} den {day}.", "{plate} je na {day} u {crew}.", "{plate} 在 {day} 归 {crew} 使用。", "{plate} 在 {day} 歸 {crew} 使用。", "{plate} مع {crew} يوم {day}."],
  "vandays.isWith.other": ["{plate} is with another crew on {day}.", "{plate} ist am {day} bei einem anderen Team.", "{plate} est avec une autre équipe le {day}.", "{plate} er hos et andet hold den {day}.", "{plate} je na {day} u jiné čety.", "{plate} 在 {day} 归另一个班组使用。", "{plate} 在 {day} 歸另一個班組使用。", "{plate} مع طاقم آخر يوم {day}."],
  "vandays.hiredTo": ["{plate} is hired until {day}.", "{plate} ist bis {day} gemietet.", "{plate} est loué jusqu’au {day}.", "{plate} er lejet til {day}.", "{plate} je najato do {day}.", "{plate} 租用至 {day}。", "{plate} 租用至 {day}。", "{plate} مستأجرة حتى {day}."],
  "vandays.hiredFrom": ["{plate} is hired from {day}.", "{plate} ist ab {day} gemietet.", "{plate} est loué à partir du {day}.", "{plate} er lejet fra {day}.", "{plate} je najato od {day}.", "{plate} 从 {day} 起租用。", "{plate} 從 {day} 起租用。", "{plate} مستأجرة بدءًا من {day}."],
  "vandays.use": ["Use {plate}", "{plate} nehmen", "Prendre {plate}", "Brug {plate}", "Použít {plate}", "改用 {plate}", "改用 {plate}", "استخدم {plate}"],
  "vandays.changeHire": ["Change the hire days", "Mietzeit ändern", "Modifier les jours de location", "Ændr lejedagene", "Změnit dny pronájmu", "更改租用日期", "變更租用日期", "تغيير أيام الاستئجار"],
  "vandays.line": ["{crew} is on {plate} all day {day}.", "{crew} ist am {day} den ganzen Tag mit {plate} unterwegs.", "{crew} est sur {plate} toute la journée du {day}.", "{crew} kører i {plate} hele dagen den {day}.", "{crew} jezdí celý den {day} s {plate}.", "{crew} 在 {day} 全天使用 {plate}。", "{crew} 在 {day} 全天使用 {plate}。", "{crew} على {plate} طوال يوم {day}."],
  "vandays.line.hired": ["{crew} is on {plate} (hired) all day {day}.", "{crew} ist am {day} den ganzen Tag mit {plate} (gemietet) unterwegs.", "{crew} est sur {plate} (loué) toute la journée du {day}.", "{crew} kører i {plate} (lejet) hele dagen den {day}.", "{crew} jezdí celý den {day} s {plate} (najaté).", "{crew} 在 {day} 全天使用 {plate}（租用）。", "{crew} 在 {day} 全天使用 {plate}（租用）。", "{crew} على {plate} (مستأجرة) طوال يوم {day}."],
  "vandays.others.none": ["No other visit.", "Kein anderer Einsatz.", "Aucune autre intervention.", "Intet andet besøg.", "Žádný jiný výjezd.", "没有其他上门。", "沒有其他到訪。", "لا توجد زيارة أخرى."],
  "vandays.others": [
    "{count} other visit.|{count} other visits.",
    "{count} weiterer Einsatz.|{count} weitere Einsätze.",
    "{count} autre intervention.|{count} autres interventions.",
    "{count} andet besøg.|{count} andre besøg.",
    "{count} další výjezd.|{count} další výjezdy.|{count} dalších výjezdů.",
    "另有 {count} 次上门。",
    "另有 {count} 次到訪。",
    "لا زيارات أخرى.|زيارة أخرى واحدة.|زيارتان أخريان.|{count} زيارات أخرى.|{count} زيارة أخرى.|{count} زيارة أخرى.",
  ],
  "vandays.changeDay": ["Change for the whole day", "Für den ganzen Tag ändern", "Changer pour toute la journée", "Skift for hele dagen", "Změnit na celý den", "改为全天使用", "改為全天使用", "تغيير لليوم كله"],
  "vandays.moves": [
    "This moves the crew’s visit that day to {plate}.|This moves the crew’s {count} visits that day to {plate}.",
    "Damit fährt der Einsatz des Teams an diesem Tag mit {plate}.|Damit fahren die {count} Einsätze des Teams an diesem Tag mit {plate}.",
    "L’intervention de l’équipe ce jour-là passe sur {plate}.|Les {count} interventions de l’équipe ce jour-là passent sur {plate}.",
    "Holdets besøg den dag flyttes til {plate}.|Holdets {count} besøg den dag flyttes til {plate}.",
    "Výjezd čety ten den se přesune na {plate}.|{count} výjezdy čety ten den se přesunou na {plate}.|{count} výjezdů čety ten den se přesune na {plate}.",
    "该班组当天的 {count} 次上门都改用 {plate}。",
    "該班組當天的 {count} 次到訪都改用 {plate}。",
    "لا زيارات للطاقم في ذلك اليوم.|ينقل هذا زيارة الطاقم في ذلك اليوم إلى {plate}.|ينقل هذا زيارتي الطاقم في ذلك اليوم إلى {plate}.|ينقل هذا زيارات الطاقم في ذلك اليوم ({count}) إلى {plate}.|ينقل هذا زيارات الطاقم في ذلك اليوم ({count}) إلى {plate}.|ينقل هذا زيارات الطاقم في ذلك اليوم ({count}) إلى {plate}.",
  ],
  "vandays.service": [
    "{plate} is {count} day past its service. It can still be booked.|{plate} is {count} days past its service. It can still be booked.",
    "{plate} ist {count} Tag über dem Service. Es kann trotzdem gebucht werden.|{plate} ist {count} Tage über dem Service. Es kann trotzdem gebucht werden.",
    "{plate} a dépassé son entretien de {count} jour. Il peut quand même être réservé.|{plate} a dépassé son entretien de {count} jours. Il peut quand même être réservé.",
    "{plate} er {count} dag over sit service. Det kan stadig bookes.|{plate} er {count} dage over sit service. Det kan stadig bookes.",
    "{plate} je {count} den po termínu servisu. Rezervovat jej lze i tak.|{plate} je {count} dny po termínu servisu. Rezervovat jej lze i tak.|{plate} je {count} dní po termínu servisu. Rezervovat jej lze i tak.",
    "{plate} 已超过保养期 {count} 天。仍可预订。",
    "{plate} 已超過保養期 {count} 天。仍可預訂。",
    "{plate} لم تتجاوز موعد صيانتها. يمكن الحجز مع ذلك.|تجاوزت {plate} موعد صيانتها بيوم واحد. يمكن الحجز مع ذلك.|تجاوزت {plate} موعد صيانتها بيومين. يمكن الحجز مع ذلك.|تجاوزت {plate} موعد صيانتها بـ {count} أيام. يمكن الحجز مع ذلك.|تجاوزت {plate} موعد صيانتها بـ {count} يومًا. يمكن الحجز مع ذلك.|تجاوزت {plate} موعد صيانتها بـ {count} يوم. يمكن الحجز مع ذلك.",
  ],
  "vandays.refused.other": ["The vehicle for the day was not saved: {reason}", "Das Fahrzeug für den Tag wurde nicht gespeichert: {reason}", "Le véhicule de la journée n’a pas été enregistré : {reason}", "Køretøjet til dagen blev ikke gemt: {reason}", "Vozidlo na den se neuložilo: {reason}", "当天的车辆未保存：{reason}", "當天的車輛未儲存：{reason}", "لم تُحفظ مركبة اليوم: {reason}"],
  "vandays.none": ["No vehicle", "Kein Fahrzeug", "Aucun véhicule", "Intet køretøj", "Žádné vozidlo", "没有车辆", "沒有車輛", "لا مركبة"],

  /* ─── The Day sheet ─── */
  "vandays.ds.hired": ["Hired", "Gemietet", "En location", "Lejet", "Najaté", "租用", "租用", "مستأجرة"],
  "vandays.ds.change": ["Change", "Ändern", "Modifier", "Skift", "Změnit", "更改", "變更", "تغيير"],
  "vandays.ds.change.aria": ["Change the vehicle for {crew}, {day}", "Fahrzeug für {crew} am {day} ändern", "Modifier le véhicule de {crew}, {day}", "Skift køretøjet for {crew}, {day}", "Změnit vozidlo pro {crew}, {day}", "更改 {crew} 在 {day} 的车辆", "變更 {crew} 在 {day} 的車輛", "تغيير المركبة لـ {crew}، {day}"],
  "vandays.ds.notOwn": ["Not the crew’s own vehicle ({plate}).", "Nicht das eigene Fahrzeug des Teams ({plate}).", "Ce n’est pas le véhicule de l’équipe ({plate}).", "Ikke holdets eget køretøj ({plate}).", "Není to vlastní vozidlo čety ({plate}).", "不是该班组自己的车辆（{plate}）。", "不是該班組自己的車輛（{plate}）。", "ليست مركبة الطاقم الخاصة ({plate})."],
  "vandays.ds.noVehicle": ["No vehicle is put on this day yet.", "Für diesen Tag ist noch kein Fahrzeug eingetragen.", "Aucun véhicule n’est encore prévu ce jour-là.", "Der er endnu intet køretøj på denne dag.", "Na tento den zatím není určeno vozidlo.", "这一天还没有安排车辆。", "這一天還沒有安排車輛。", "لم تُحدَّد مركبة لهذا اليوم بعد."],
  "vandays.ds.stock": ["Stock for this job", "Material für diesen Auftrag", "Stock pour ce chantier", "Lager til denne opgave", "Materiál pro tuto zakázku", "此工单的备货", "此工單的備貨", "المخزون لهذه المهمة"],
  "vandays.ds.note": ["On the delivery note · {day}", "Auf dem Lieferschein · {day}", "Sur le bon de livraison · {day}", "På følgesedlen · {day}", "Na dodacím listu · {day}", "送货单上 · {day}", "送貨單上 · {day}", "في إشعار التسليم · {day}"],
  "vandays.ds.nothing": ["Nothing listed yet.", "Noch nichts aufgeführt.", "Rien d’indiqué pour l’instant.", "Intet opført endnu.", "Zatím nic uvedeno.", "暂未列出。", "暫未列出。", "لا شيء مُدرج بعد."],
  "vandays.ds.qty": ["{qty} {unit}", "{qty} {unit}", "{qty} {unit}", "{qty} {unit}", "{qty} {unit}", "{qty} {unit}", "{qty} {unit}", "{qty} {unit}"],
  "vandays.ds.unknownLine": ["A stock line", "Eine Materialposition", "Une ligne de stock", "En lagervare", "Skladová položka", "一项库存", "一項庫存", "صنف مخزون"],
  "vandays.print.crew": ["{crew} ({people}; {plate})", "{crew} ({people}; {plate})", "{crew} ({people} ; {plate})", "{crew} ({people}; {plate})", "{crew} ({people}; {plate})", "{crew}（{people}；{plate}）", "{crew}（{people}；{plate}）", "{crew} ({people}؛ {plate})"],
  "vandays.print.crew.hired": ["{crew} ({people}; {plate}, hired)", "{crew} ({people}; {plate}, gemietet)", "{crew} ({people} ; {plate}, en location)", "{crew} ({people}; {plate}, lejet)", "{crew} ({people}; {plate}, najaté)", "{crew}（{people}；{plate}，租用）", "{crew}（{people}；{plate}，租用）", "{crew} ({people}؛ {plate}، مستأجرة)"],
  "vandays.dlg.title": ["Vehicle for {crew}, {day}", "Fahrzeug für {crew}, {day}", "Véhicule de {crew}, {day}", "Køretøj til {crew}, {day}", "Vozidlo pro {crew}, {day}", "{crew} 在 {day} 的车辆", "{crew} 在 {day} 的車輛", "مركبة {crew}، {day}"],
  "vandays.dlg.sub": ["One vehicle for all of the crew’s visits that day.", "Ein Fahrzeug für alle Einsätze des Teams an diesem Tag.", "Un seul véhicule pour toutes les interventions de l’équipe ce jour-là.", "Ét køretøj til alle holdets besøg den dag.", "Jedno vozidlo pro všechny výjezdy čety ten den.", "该班组当天的所有上门共用一辆车。", "該班組當天的所有到訪共用一輛車。", "مركبة واحدة لكل زيارات الطاقم في ذلك اليوم."],
  "vandays.dlg.save": ["Save", "Speichern", "Enregistrer", "Gem", "Uložit", "保存", "儲存", "حفظ"],
  "vandays.dlg.saved": ["{crew} is on {plate} on {day}.", "{crew} fährt am {day} mit {plate}.", "{crew} est sur {plate} le {day}.", "{crew} kører i {plate} den {day}.", "{crew} jede {day} s {plate}.", "{crew} 在 {day} 使用 {plate}。", "{crew} 在 {day} 使用 {plate}。", "{crew} على {plate} يوم {day}."],

  /* ─── The Route ─── */
  "vandays.rt.vehicle": ["Vehicle {plate}", "Fahrzeug {plate}", "Véhicule {plate}", "Køretøj {plate}", "Vozidlo {plate}", "车辆 {plate}", "車輛 {plate}", "المركبة {plate}"],
  "vandays.rt.vehicle.hired": ["Vehicle {plate} (hired)", "Fahrzeug {plate} (gemietet)", "Véhicule {plate} (loué)", "Køretøj {plate} (lejet)", "Vozidlo {plate} (najaté)", "车辆 {plate}（租用）", "車輛 {plate}（租用）", "المركبة {plate} (مستأجرة)"],

  /* ─── Vehicles: the hire days and where a hired vehicle goes ─── */
  "vandays.vn.hire": ["Hired {from} to {to}", "Gemietet vom {from} bis {to}", "Loué du {from} au {to}", "Lejet fra {from} til {to}", "Najato od {from} do {to}", "租用期 {from} 至 {to}", "租用期 {from} 至 {to}", "مستأجرة من {from} إلى {to}"],
  "vandays.vn.where": ["Where it goes", "Wohin es fährt", "Où il va", "Hvor den kører", "Kam jede", "行驶去向", "行駛去向", "أين تذهب"],
  "vandays.vn.where.none": ["Not on any crew’s day yet.", "Noch an keinem Tag eines Teams eingeplant.", "Prévu sur aucune journée d’équipe pour l’instant.", "Endnu ikke på noget holds dag.", "Zatím není na žádném dni čety.", "还没有安排到任何班组的日程。", "還沒有安排到任何班組的日程。", "لم تُسنَد بعد إلى يوم أي طاقم."],
  "vandays.vn.route": ["Route", "Route", "Itinéraire", "Rute", "Trasa", "路线", "路線", "المسار"],
  "vandays.vn.route.aria": ["Route for {crew}, {day}", "Route für {crew}, {day}", "Itinéraire de {crew}, {day}", "Rute for {crew}, {day}", "Trasa pro {crew}, {day}", "{crew} 在 {day} 的路线", "{crew} 在 {day} 的路線", "مسار {crew}، {day}"],
  "vandays.vn.noCrew": ["No crew of its own", "Ohne eigenes Team", "Sans équipe attitrée", "Uden eget hold", "Bez vlastní čety", "没有固定班组", "沒有固定班組", "بلا طاقم خاص بها"],
  "vandays.hire.sub": [
    "{vehicle}. A day already given to a crew must stay inside From and To.",
    "{vehicle}. Ein Tag, der schon einem Team gegeben ist, muss zwischen Von und Bis bleiben.",
    "{vehicle}. Un jour déjà donné à une équipe doit rester entre Du et Au.",
    "{vehicle}. En dag, der allerede er givet til et hold, skal ligge inden for Fra og Til.",
    "{vehicle}. Den už daný četě musí zůstat mezi Od a Do.",
    "{vehicle}。已分给班组的日期必须在开始和结束之间。",
    "{vehicle}。已分給班組的日期必須在開始和結束之間。",
    "{vehicle}. يجب أن يبقى أي يوم أُعطي لطاقم بين من وإلى.",
  ],
  "vandays.hire.from": ["From", "Von", "Du", "Fra", "Od", "开始", "開始", "من"],
  "vandays.hire.to": ["To", "Bis", "Au", "Til", "Do", "结束", "結束", "إلى"],
  "vandays.hire.given": ["Given to a crew", "Einem Team gegeben", "Donné à une équipe", "Givet til et hold", "Dáno četě", "已分给班组", "已分給班組", "أُعطيت لطاقم"],
  "vandays.hire.givenRow": ["{day} · {crew}", "{day} · {crew}", "{day} · {crew}", "{day} · {crew}", "{day} · {crew}", "{day} · {crew}", "{day} · {crew}", "{day} · {crew}"],
  "vandays.hire.refused": ["{crew} has it on {day}. Move that day first.", "{crew} hat es am {day}. Verlegen Sie zuerst diesen Tag.", "{crew} l’a le {day}. Déplacez d’abord ce jour.", "{crew} har den den {day}. Flyt den dag først.", "{crew} jej má {day}. Nejdřív přesuňte ten den.", "{crew} 在 {day} 使用它。请先调整那一天。", "{crew} 在 {day} 使用它。請先調整那一天。", "{crew} لديها يوم {day}. انقل ذلك اليوم أولًا."],
  "vandays.hire.order": ["The hire ends on or after the day it starts.", "Die Miete endet am oder nach dem ersten Tag.", "La location se termine le jour où elle commence ou après.", "Lejen slutter på eller efter den dag, den begynder.", "Pronájem končí v den začátku nebo později.", "租用结束日不能早于开始日。", "租用結束日不能早於開始日。", "ينتهي الاستئجار في يوم بدئه أو بعده."],
  "vandays.hire.saved": ["{vehicle} is hired from {from} to {to}.", "{vehicle} ist vom {from} bis {to} gemietet.", "{vehicle} est loué du {from} au {to}.", "{vehicle} er lejet fra {from} til {to}.", "{vehicle} je najato od {from} do {to}.", "{vehicle} 租用期为 {from} 至 {to}。", "{vehicle} 租用期為 {from} 至 {to}。", "{vehicle} مستأجرة من {from} إلى {to}."],
  "vandays.add": ["Add a hired vehicle", "Gemietetes Fahrzeug hinzufügen", "Ajouter un véhicule loué", "Tilføj et lejet køretøj", "Přidat najaté vozidlo", "添加租用车辆", "新增租用車輛", "إضافة مركبة مستأجرة"],
  "vandays.add.sub": ["It can go on a crew’s day only from its From day to its To day.", "Es kann nur vom Von-Tag bis zum Bis-Tag an den Tag eines Teams.", "Il ne peut servir à une équipe que de son jour Du à son jour Au.", "Det kan kun bruges på et holds dag fra Fra-dagen til Til-dagen.", "Na den čety může jen od dne Od do dne Do.", "它只能在开始日到结束日之间分给班组使用。", "它只能在開始日到結束日之間分給班組使用。", "لا يمكن إسنادها إلى يوم طاقم إلا من يوم من إلى يوم إلى."],
  "vandays.add.name": ["Name", "Name", "Nom", "Navn", "Název", "名称", "名稱", "الاسم"],
  "vandays.add.plate": ["Plate", "Kennzeichen", "Immatriculation", "Nummerplade", "SPZ", "车牌", "車牌", "اللوحة"],
  "vandays.add.model": ["Model", "Modell", "Modèle", "Model", "Model", "车型", "車型", "الطراز"],
  "vandays.add.name.ph": ["Hired vehicle", "Gemietetes Fahrzeug", "Véhicule loué", "Lejet køretøj", "Najaté vozidlo", "租用车辆", "租用車輛", "مركبة مستأجرة"],
  "vandays.add.model.ph": ["High-roof panel vehicle", "Kastenwagen mit Hochdach", "Fourgon tôlé à toit surélevé", "Varebil med højt tag", "Skříňová dodávka s vysokou střechou", "高顶厢式车", "高頂廂型車", "مركبة مغلقة بسقف مرتفع"],
  "vandays.add.go": ["Add the vehicle", "Fahrzeug hinzufügen", "Ajouter le véhicule", "Tilføj køretøjet", "Přidat vozidlo", "添加车辆", "新增車輛", "إضافة المركبة"],
  "vandays.add.done": ["{vehicle} is added, hired from {from} to {to}.", "{vehicle} ist hinzugefügt, gemietet vom {from} bis {to}.", "{vehicle} est ajouté, loué du {from} au {to}.", "{vehicle} er tilføjet, lejet fra {from} til {to}.", "{vehicle} je přidáno, najato od {from} do {to}.", "{vehicle} 已添加，租用期 {from} 至 {to}。", "{vehicle} 已新增，租用期 {from} 至 {to}。", "أُضيفت {vehicle}، مستأجرة من {from} إلى {to}."],

  /* ─── My day: the crew's vehicle that day ─── */
  "vandays.my.label": ["Your vehicle today", "Ihr Fahrzeug heute", "Votre véhicule aujourd’hui", "Jeres køretøj i dag", "Vaše vozidlo dnes", "你们今天的车辆", "你們今天的車輛", "مركبتكم اليوم"],
  "vandays.my.notUsual": ["Not your usual vehicle today.", "Heute nicht Ihr übliches Fahrzeug.", "Ce n’est pas votre véhicule habituel aujourd’hui.", "Ikke jeres sædvanlige køretøj i dag.", "Dnes to není vaše obvyklé vozidlo.", "今天不是你们平常的车辆。", "今天不是你們平常的車輛。", "ليست مركبتكم المعتادة اليوم."],
});
