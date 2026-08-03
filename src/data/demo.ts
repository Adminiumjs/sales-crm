/**
 * Seeded demo data — Meridian, a fictional B2B office-furniture wholesaler.
 *
 * Everything here is invention. The companies, people, deals and conversations
 * are written to look like a real mid-quarter pipeline: five stages populated,
 * two deals visibly stale, three follow-ups already overdue against the pinned
 * clock, and enough closed history that win rate and average cycle compute to
 * something honest rather than a hard-coded number.
 *
 * Translatable prose (deal names, scopes, sectors, notes, activity bodies) is
 * stored as an i18n KEY, not as English. `lib/format.ts`'s `label()` resolves
 * it. Proper nouns — company brand names, people's names, cities, e-mail
 * addresses — are never translated and are stored literally.
 *
 * The DataSource seam (`data/source.ts`) is what a real deployment replaces;
 * this module is what it replaces it *with* in demo mode.
 */

import type {
  Activity,
  ClosedDeal,
  Company,
  Contact,
  Deal,
  FollowUp,
  Rep,
  Stage,
} from "./types.ts";

/** The pinned clock: Tuesday, 28 July 2026, 09:35. Nothing reads `Date.now()`. */
export const NOW = new Date(2026, 6, 28, 9, 35, 0);

export const STAGES: Stage[] = [
  { id: "discovery", label: "data.stage.discovery", odds: 0.1 },
  { id: "qualified", label: "data.stage.qualified", odds: 0.25 },
  { id: "proposal", label: "data.stage.proposal", odds: 0.5 },
  { id: "negotiation", label: "data.stage.negotiation", odds: 0.75 },
  { id: "verbal", label: "data.stage.verbal", odds: 0.9 },
];

export const REPS: Rep[] = [
  {
    id: "dana",
    name: "Dana Whitlock",
    first: "Dana",
    ini: "DW",
    role: "data.role.ae",
    tint: "#4f46e5",
  },
  {
    id: "priya",
    name: "Priya Raman",
    first: "Priya",
    ini: "PR",
    role: "data.role.ae",
    tint: "#0d9488",
  },
  {
    id: "sam",
    name: "Sam Okonjo",
    first: "Sam",
    ini: "SO",
    role: "data.role.ae",
    tint: "#e11d48",
  },
  {
    id: "leo",
    name: "Leo Vance",
    first: "Leo",
    ini: "LV",
    role: "data.role.ae",
    tint: "#b25e09",
  },
];

export const MANAGER: Rep = {
  id: "ivy",
  name: "Ivy Sandoval",
  first: "Ivy",
  ini: "IS",
  role: "data.role.manager",
  tint: "#7c3aed",
};

export const COMPANIES: Company[] = [
  {
    id: "cobalt",
    name: "Cobalt Legal",
    ini: "CL",
    sector: "data.sector.law",
    headcount: 140,
    city: "Leeds",
    tint: "#4f46e5",
    icon: "scale",
    file: "cobalt_mark.svg",
    since: "data.since.cobalt",
    note: "data.note.cobalt",
  },
  {
    id: "fernway",
    name: "Fernway Clinics",
    ini: "FC",
    sector: "data.sector.health",
    headcount: 320,
    city: "Bristol",
    tint: "#0d9488",
    icon: "stethoscope",
    file: "fernway_mark.svg",
    since: "data.since.fernway",
    note: "data.note.fernway",
  },
  {
    id: "juno",
    name: "Juno Analytics",
    ini: "JA",
    sector: "data.sector.data",
    headcount: 85,
    city: "Manchester",
    tint: "#1c59e0",
    icon: "chart-no-axes-column",
    file: "juno_mark.svg",
    since: "data.since.juno",
    note: "data.note.juno",
  },
  {
    id: "nordwind",
    name: "Nordwind Logistics",
    ini: "NL",
    sector: "data.sector.freight",
    headcount: 1200,
    city: "Hull",
    tint: "#b25e09",
    icon: "truck",
    file: "nordwind_mark.svg",
    since: "data.since.nordwind",
    note: "data.note.nordwind",
  },
  {
    id: "veldt",
    name: "Veldt Studios",
    ini: "VS",
    sector: "data.sector.film",
    headcount: 60,
    city: "Glasgow",
    tint: "#7c3aed",
    icon: "clapperboard",
    file: "veldt_mark.svg",
    since: "data.since.veldt",
    note: "data.note.veldt",
  },
  {
    id: "brightloom",
    name: "Brightloom Foods",
    ini: "BF",
    sector: "data.sector.grocery",
    headcount: 2400,
    city: "Birmingham",
    tint: "#e11d48",
    icon: "shopping-basket",
    file: "brightloom_mark.svg",
    since: "data.since.brightloom",
    note: "data.note.brightloom",
  },
  {
    id: "harbor",
    name: "Harbor & Finch",
    ini: "HF",
    sector: "data.sector.accountancy",
    headcount: 210,
    city: "Edinburgh",
    tint: "#2563eb",
    icon: "briefcase",
    file: "harbor_mark.svg",
    since: "data.since.harbor",
    note: "data.note.harbor",
  },
  {
    id: "tandem",
    name: "Tandem Robotics",
    ini: "TR",
    sector: "data.sector.robotics",
    headcount: 95,
    city: "Cambridge",
    tint: "#0891b2",
    icon: "bot",
    file: "tandem_mark.svg",
    since: "data.since.tandem",
    note: "data.note.tandem",
  },
  {
    id: "loworbit",
    name: "Low Orbit",
    ini: "LO",
    sector: "data.sector.aerospace",
    headcount: 45,
    city: "Reading",
    tint: "#a95800",
    icon: "satellite",
    file: "loworbit_mark.svg",
    since: "data.since.loworbit",
    note: "data.note.loworbit",
  },
];

export const CONTACTS: Contact[] = [
  {
    id: "ines",
    name: "Ines Vaughan",
    ini: "IV",
    role: "data.job.opsDirector",
    co: "cobalt",
    email: "ines.vaughan@cobaltlegal.example",
    phone: "0113 496 0182",
  },
  {
    id: "tomas",
    name: "Tomas Reidy",
    ini: "TR",
    role: "data.job.facilitiesLead",
    co: "cobalt",
    email: "t.reidy@cobaltlegal.example",
    phone: "0113 496 0190",
  },
  {
    id: "ana",
    name: "Ana Belova",
    ini: "AB",
    role: "data.job.estatesManager",
    co: "fernway",
    email: "a.belova@fernwayclinics.example",
    phone: "0117 302 4418",
  },
  {
    id: "owen",
    name: "Owen Marsh",
    ini: "OM",
    role: "data.job.headOfWorkplace",
    co: "juno",
    email: "owen@junoanalytics.example",
    phone: "0161 884 7723",
  },
  {
    id: "kit",
    name: "Kit Delaney",
    ini: "KD",
    role: "data.job.officeManager",
    co: "juno",
    email: "kit@junoanalytics.example",
    phone: "0161 884 7730",
  },
  {
    id: "petra",
    name: "Petra Lindqvist",
    ini: "PL",
    role: "data.job.headOfFacilities",
    co: "nordwind",
    email: "p.lindqvist@nordwind.example",
    phone: "01482 55 0913",
  },
  {
    id: "jonas",
    name: "Jonas Reuter",
    ini: "JR",
    role: "data.job.depotManager",
    co: "nordwind",
    email: "j.reuter@nordwind.example",
    phone: "01482 55 0940",
  },
  {
    id: "marta",
    name: "Marta Kovac",
    ini: "MK",
    role: "data.job.studioManager",
    co: "veldt",
    email: "marta@veldtstudios.example",
    phone: "0141 662 8804",
  },
  {
    id: "ruth",
    name: "Ruth Adeyemi",
    ini: "RA",
    role: "data.job.retailProjects",
    co: "brightloom",
    email: "r.adeyemi@brightloom.example",
    phone: "0121 774 3355",
  },
  {
    id: "sadie",
    name: "Sadie Moore",
    ini: "SM",
    role: "data.job.practiceManager",
    co: "harbor",
    email: "s.moore@harborfinch.example",
    phone: "0131 208 6641",
  },
  {
    id: "callum",
    name: "Callum Finch",
    ini: "CF",
    role: "data.job.partner",
    co: "harbor",
    email: "c.finch@harborfinch.example",
    phone: "0131 208 6600",
  },
  {
    id: "yusuf",
    name: "Yusuf Demir",
    ini: "YD",
    role: "data.job.labOps",
    co: "tandem",
    email: "yusuf@tandemrobotics.example",
    phone: "01223 47 1108",
  },
  {
    id: "bea",
    name: "Bea Nolan",
    ini: "BN",
    role: "data.job.chiefOfStaff",
    co: "loworbit",
    email: "bea@loworbit.example",
    phone: "0118 990 2277",
  },
];

export const DEALS: Deal[] = [
  { id: "d1", name: "data.deal.d1", co: "nordwind", amount: 48000, stage: "negotiation", owner: "dana", opened: "2026-05-12", since: "2026-07-14", close: "2026-08-14", scope: "data.scope.d1", main: "petra" },
  { id: "d2", name: "data.deal.d2", co: "veldt", amount: 27500, stage: "proposal", owner: "dana", opened: "2026-06-02", since: "2026-07-08", close: "2026-08-21", scope: "data.scope.d2", main: "marta" },
  { id: "d3", name: "data.deal.d3", co: "cobalt", amount: 16800, stage: "verbal", owner: "dana", opened: "2026-06-18", since: "2026-07-24", close: "2026-07-31", scope: "data.scope.d3", main: "ines" },
  { id: "d4", name: "data.deal.d4", co: "fernway", amount: 12400, stage: "qualified", owner: "priya", opened: "2026-06-30", since: "2026-07-21", close: "2026-09-04", scope: "data.scope.d4", main: "ana" },
  { id: "d5", name: "data.deal.d5", co: "brightloom", amount: 34000, stage: "proposal", owner: "sam", opened: "2026-05-20", since: "2026-06-26", close: "2026-09-11", scope: "data.scope.d5", main: "ruth" },
  { id: "d6", name: "data.deal.d6", co: "juno", amount: 21600, stage: "negotiation", owner: "dana", opened: "2026-06-09", since: "2026-07-17", close: "2026-07-30", scope: "data.scope.d6", main: "owen" },
  { id: "d7", name: "data.deal.d7", co: "harbor", amount: 9750, stage: "discovery", owner: "leo", opened: "2026-07-20", since: "2026-07-25", close: "2026-09-30", scope: "data.scope.d7", main: "sadie" },
  { id: "d8", name: "data.deal.d8", co: "tandem", amount: 6300, stage: "qualified", owner: "priya", opened: "2026-06-24", since: "2026-07-09", close: "2026-09-04", scope: "data.scope.d8", main: "yusuf" },
  { id: "d9", name: "data.deal.d9", co: "loworbit", amount: 18900, stage: "proposal", owner: "dana", opened: "2026-06-26", since: "2026-07-22", close: "2026-08-18", scope: "data.scope.d9", main: "bea" },
  { id: "d10", name: "data.deal.d10", co: "cobalt", amount: 23400, stage: "discovery", owner: "sam", opened: "2026-07-22", since: "2026-07-27", close: "2026-10-16", scope: "data.scope.d10", main: "tomas" },
  { id: "d11", name: "data.deal.d11", co: "brightloom", amount: 7800, stage: "verbal", owner: "priya", opened: "2026-06-15", since: "2026-07-23", close: "2026-07-31", scope: "data.scope.d11", main: "ruth" },
  { id: "d12", name: "data.deal.d12", co: "nordwind", amount: 14250, stage: "qualified", owner: "leo", opened: "2026-05-28", since: "2026-06-24", close: "2026-09-25", scope: "data.scope.d12", main: "jonas" },
  { id: "d13", name: "data.deal.d13", co: "veldt", amount: 3200, stage: "discovery", owner: "dana", opened: "2026-07-16", since: "2026-07-26", close: "2026-08-20", scope: "data.scope.d13", main: "marta" },
  { id: "d14", name: "data.deal.d14", co: "harbor", amount: 31000, stage: "negotiation", owner: "sam", opened: "2026-05-06", since: "2026-07-19", close: "2026-08-12", scope: "data.scope.d14", main: "callum" },
];

/** Closed history — five won, three lost, so win rate and cycle are computable. */
export const HISTORY: ClosedDeal[] = [
  { id: "h1", name: "data.deal.h1", co: "cobalt", amount: 19500, owner: "dana", opened: "2026-03-03", closed: "2026-04-28", won: true },
  { id: "h2", name: "data.deal.h2", co: "fernway", amount: 11200, owner: "priya", opened: "2026-02-21", closed: "2026-04-09", won: true },
  { id: "h3", name: "data.deal.h3", co: "nordwind", amount: 26400, owner: "sam", opened: "2026-01-14", closed: "2026-03-26", won: true },
  { id: "h4", name: "data.deal.h4", co: "veldt", amount: 8900, owner: "dana", opened: "2026-05-02", closed: "2026-06-12", won: true },
  { id: "h5", name: "data.deal.h5", co: "tandem", amount: 15600, owner: "leo", opened: "2026-04-08", closed: "2026-06-03", won: true },
  { id: "h6", name: "data.deal.h6", co: "brightloom", amount: 22000, owner: "sam", opened: "2026-03-11", closed: "2026-05-15", won: false, reason: "data.lost.timing" },
  { id: "h7", name: "data.deal.h7", co: "loworbit", amount: 13700, owner: "priya", opened: "2026-04-27", closed: "2026-06-30", won: false, reason: "data.lost.supplier" },
  { id: "h8", name: "data.deal.h8", co: "harbor", amount: 5400, owner: "dana", opened: "2026-06-01", closed: "2026-07-20", won: false, reason: "data.lost.budget" },
];

/** Three of these fall before the pinned clock, so the queue opens overdue-first. */
export const FOLLOWUPS: FollowUp[] = [
  { id: "f1", deal: "d1", due: "2026-07-24 16:00", text: "data.fu.f1" },
  { id: "f2", deal: "d2", due: "2026-07-27 11:00", text: "data.fu.f2" },
  { id: "f3", deal: "d13", due: "2026-07-27 15:30", text: "data.fu.f3" },
  { id: "f4", deal: "d3", due: "2026-07-28 10:00", text: "data.fu.f4" },
  { id: "f5", deal: "d6", due: "2026-07-28 14:00", text: "data.fu.f5" },
  { id: "f6", deal: "d9", due: "2026-07-29 09:30", text: "data.fu.f6" },
  { id: "f7", deal: "d1", due: "2026-07-30 11:00", text: "data.fu.f7" },
];

export const ACTIVITIES: Activity[] = [
  { id: "a1", deal: "d3", type: "call", at: "2026-07-28 09:05", who: "dana", text: "data.act.a1" },
  { id: "a2", deal: "d6", type: "email", at: "2026-07-27 17:40", who: "dana", text: "data.act.a2" },
  { id: "a3", deal: "d1", type: "stage", at: "2026-07-14 11:20", who: "dana", text: "data.act.a3" },
  { id: "a4", deal: "d1", type: "meeting", at: "2026-07-23 14:00", who: "dana", text: "data.act.a4" },
  { id: "a5", deal: "d1", type: "note", at: "2026-07-24 09:15", who: "dana", text: "data.act.a5" },
  { id: "a6", deal: "d2", type: "call", at: "2026-07-21 10:30", who: "dana", text: "data.act.a6" },
  { id: "a7", deal: "d2", type: "email", at: "2026-07-08 16:05", who: "dana", text: "data.act.a7" },
  { id: "a8", deal: "d9", type: "email", at: "2026-07-22 09:50", who: "dana", text: "data.act.a8" },
  { id: "a9", deal: "d9", type: "call", at: "2026-07-26 13:10", who: "dana", text: "data.act.a9" },
  { id: "a10", deal: "d13", type: "note", at: "2026-07-26 08:40", who: "dana", text: "data.act.a10" },
  { id: "a11", deal: "d13", type: "stage", at: "2026-07-26 08:35", who: "dana", text: "data.act.a11" },
  { id: "a12", deal: "d5", type: "email", at: "2026-06-26 15:30", who: "sam", text: "data.act.a12" },
  { id: "a13", deal: "d5", type: "note", at: "2026-07-17 11:00", who: "sam", text: "data.act.a13" },
  { id: "a14", deal: "d12", type: "call", at: "2026-06-24 14:20", who: "leo", text: "data.act.a14" },
  { id: "a15", deal: "d12", type: "note", at: "2026-07-15 10:05", who: "leo", text: "data.act.a15" },
  { id: "a16", deal: "d14", type: "meeting", at: "2026-07-19 09:30", who: "sam", text: "data.act.a16" },
  { id: "a17", deal: "d14", type: "stage", at: "2026-07-19 11:45", who: "sam", text: "data.act.a17" },
  { id: "a18", deal: "d14", type: "email", at: "2026-07-27 08:20", who: "sam", text: "data.act.a18" },
  { id: "a19", deal: "d4", type: "call", at: "2026-07-21 15:00", who: "priya", text: "data.act.a19" },
  { id: "a20", deal: "d4", type: "note", at: "2026-07-24 12:30", who: "priya", text: "data.act.a20" },
  { id: "a21", deal: "d8", type: "email", at: "2026-07-09 11:15", who: "priya", text: "data.act.a21" },
  { id: "a22", deal: "d11", type: "call", at: "2026-07-23 16:40", who: "priya", text: "data.act.a22" },
  { id: "a23", deal: "d10", type: "meeting", at: "2026-07-27 10:00", who: "sam", text: "data.act.a23" },
  { id: "a24", deal: "d7", type: "call", at: "2026-07-25 09:45", who: "leo", text: "data.act.a24" },
  { id: "a25", deal: "d3", type: "meeting", at: "2026-07-24 11:00", who: "dana", text: "data.act.a25" },
  { id: "a26", deal: "d6", type: "stage", at: "2026-07-17 09:00", who: "dana", text: "data.act.a26" },
  { id: "a27", deal: "d2", type: "note", at: "2026-07-25 16:20", who: "dana", text: "data.act.a27" },
  { id: "a28", deal: "d11", type: "stage", at: "2026-07-23 16:55", who: "priya", text: "data.act.a28" },
  { id: "a29", deal: "d5", type: "call", at: "2026-07-24 10:15", who: "sam", text: "data.act.a29" },
  { id: "a30", deal: "d1", type: "email", at: "2026-07-27 15:10", who: "dana", text: "data.act.a30" },
  { id: "a31", deal: "d8", type: "note", at: "2026-07-20 13:40", who: "priya", text: "data.act.a31" },
  { id: "a32", deal: "d9", type: "stage", at: "2026-07-22 09:45", who: "dana", text: "data.act.a32" },
];

/** Reasons offered when a deal is closed as lost. Values are i18n keys. */
export const LOST_REASONS = [
  "data.lost.supplier",
  "data.lost.budget",
  "data.lost.timing",
  "data.lost.nodecision",
  "data.lost.fit",
] as const;

/** Lucide icon + label key per activity type. */
export const ACTIVITY_TYPE: Record<
  string,
  { icon: string; label: string }
> = {
  call: { icon: "phone", label: "data.actType.call" },
  email: { icon: "mail", label: "data.actType.email" },
  meeting: { icon: "calendar-days", label: "data.actType.meeting" },
  note: { icon: "sticky-note", label: "data.actType.note" },
  stage: { icon: "move-right", label: "data.actType.stage" },
};
