export interface StandPerson {
  id: string;
  email: string;
  name: string;
  role: string;
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
  people: Record<string, StandPerson>;
  tables: Record<string, string>;
  addOns: { key: string; version: string }[];
  sampleRows: number;
  skippedRules: unknown[];
  version: { server: string; standIn: string | null; manifestAsks: string };
  ready?: boolean;
}
export const STAND_DIR: string;
export const STATE_FILE: string;
export const STAFF_PASSWORD: string;
export function readState(): StandState | null;
export function standUp(): Promise<StandState>;
export function standDown(): Promise<void>;
