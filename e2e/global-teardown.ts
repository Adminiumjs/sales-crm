import { standDown } from "./stand.mjs";

export default async function globalTeardown(): Promise<void> {
  if (process.env.CRM_STAND_KEEP === "1") return;
  await standDown();
}
