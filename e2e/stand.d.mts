export interface StandPerson {
  id: string;
  email: string;
  name: string;
  role: string;
  /** Left a sample person (`CRM_STAND_SAMPLE_PERSON`): not active, no password, never signed in as (its email is empty). */
  sample?: true;
}
export interface StandState {
  pid: number;
  url: string;
  port: number;
  engine: "sqlite" | "postgres" | "mysql";
  work: string;
  dataDir: string;
  /** The engine checkout the stand runs (`ADMINIUM_REPO`). */
  adminiumRepo: string;
  connectionId: string;
  owner: { email: string; name: string; password: string };
  staffPassword: string;
  /** The server's time zone, and the moment its clock was started at (null on the real clock). */
  timeZone: string;
  startedAt: string | null;
  people: Record<string, StandPerson>;
  tables: Record<string, string>;
  addOns: { key: string; version: string }[];
  sampleRows: number;
  skippedRules: unknown[];
  version: { server: string; standIn: string | null; manifestAsks: string };
  /** The stage of the app the stand installed, and the parts that stage holds. */
  stage: number;
  parts: string[];
  /** The one sample person left as the product leaves them (`CRM_STAND_SAMPLE_PERSON`), or null. */
  samplePerson?: string | null;
  /** False on a stand started with `CRM_STAND_INSTALL=0` until a spec installs the app and calls `admitSamplePeople`. */
  installed?: boolean;
  /** With `CRM_STAND_MAIL=1`: the catcher's process and where its kept mails are read. */
  mail?: { pid: number; smtpPort: number; url: string };
  ready?: boolean;
}
export const STAND_DIR: string;
export const STATE_FILE: string;
export const STAFF_PASSWORD: string;
export const LEDGER_NOW: string;
export const LEDGER_TZ: string;
export function readState(): StandState | null;
export function standUp(): Promise<StandState>;
export function standDown(): Promise<void>;
/** The code of a quote's own link, read from the stand's database: the customer's inbox, stood in for. */
export function linkCodeOf(quoteId: number): Promise<string>;
/** A mail the stand's catcher kept (`CRM_STAND_MAIL=1`). */
export interface KeptMail {
  receivedAt: number;
  envelope: { from: string; to: string[] };
  subject: string;
  from: string;
  to: string[];
  replyTo: string;
  html: string;
  text: string;
  attachments: { filename: string; contentType: string; cid: string | null; size: number; related: boolean; content: string }[];
}
/** The mails the stand has sent, oldest first. */
export function mailbox(): Promise<KeptMail[]>;
/** Forget every mail kept so far. */
export function clearMailbox(): Promise<void>;
/** On a stand started with `CRM_STAND_INSTALL=0`, after a spec installed the app and its sample: the sample's people sign in from now on. */
export function admitSamplePeople(tables: Record<string, string>): Promise<StandState>;
