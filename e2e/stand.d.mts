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
  ready?: boolean;
  /** The mail catcher, on a stand started with CRM_STAND_MAIL=1. */
  mail?: { pid: number; smtpPort: number; url: string };
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
/** The mails the stand has sent, oldest first (a stand started with CRM_STAND_MAIL=1). */
export function mailbox(): Promise<unknown[]>;
/** Forget every mail kept so far. */
export function clearMailbox(): Promise<void>;
