/**
 * What the `zw-*` walk specs share: the install's owner with no page, a REAL
 * person invited on the stand (not one of the sample's), a job of a spec's own
 * made the way the product makes one (a won deal, the app's rule), and taking
 * it all away again.
 *
 * A REAL PERSON. Every sample person on the stand is made able to sign in
 * (`stand.mjs`), but the product still knows them as the sample's. A walk
 * that asks for "real people" invites one here as an owner does (Studio →
 * People → Invite: `POST /api/v1/users`, a role given), and the invite's link
 * is followed to set a first password (`POST /api/v1/auth/password/reset`,
 * the link's token, which the reply hands the inviter whether or not the mail
 * goes). The password is a test value of the stand, set here.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { request, type APIRequestContext, type Browser, type BrowserContext, type BrowserContextOptions } from "@playwright/test";

import { expect } from "./fixtures.ts";
import { csrf, removeDeals, rows, type Data } from "./helpers.ts";
import { readState, STAND_DIR } from "./stand.mjs";

/** The first password a spec sets for a person it invites: a test value of this stand only. */
export const REAL_PASSWORD = "stand-real-person-password-4";

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Asks until `check` holds, at most `ms`; answers what it last read. */
export async function until<T>(read: () => Promise<T>, check: (value: T) => boolean, ms = 30_000, every = 2000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (check(value) || Date.now() > deadline) return value;
    await sleep(every);
  }
}

/** A sign-in the server allows five of a minute from one address: on a 429, wait for its own clock and ask again. */
async function login(context: APIRequestContext, email: string, password: string): Promise<void> {
  for (let tries = 0; ; tries += 1) {
    const res = await context.post("/api/v1/auth/login", { data: { email, password } });
    if (res.status() === 429 && tries < 4) {
      const resetAt = ((await res.json().catch(() => ({}))) as { error?: { details?: { resetAt?: string } } }).error?.details?.resetAt;
      await sleep(Math.max(1000, (resetAt === undefined ? Date.now() + 60_000 : new Date(resetAt).getTime()) - Date.now() + 500));
      continue;
    }
    expect(res.status(), `${email} signs in: ${await res.text()}`).toBe(200);
    return;
  }
}

let owner: APIRequestContext | null = null;
/** The install's owner, with no page (signed in once a run; the cookies are kept beside the stand's other clean-ups'). */
export async function asOwner(): Promise<APIRequestContext> {
  if (owner !== null) return owner;
  const state = readState()!;
  const file = join(STAND_DIR, "auth", "owner-cleanup.json");
  owner = await request.newContext({ baseURL: state.url, ...(existsSync(file) ? { storageState: file } : {}) });
  // A kept cookie may be one an earlier run's server gave: ask, and sign in afresh when it no longer opens anything.
  if (!existsSync(file) || (await owner.get("/api/v1/me")).status() !== 200) {
    await login(owner, state.owner.email, state.owner.password);
    mkdirSync(join(STAND_DIR, "auth"), { recursive: true });
    await owner.storageState({ path: file });
  }
  return owner;
}

export interface RealPerson {
  id: string;
  name: string;
  email: string;
}

/** The id of one of the app's roles, by its slug's end (`crew`, `account-manager`). */
export async function appRole(slugEnd: string): Promise<string> {
  const me = await asOwner();
  const res = await me.get("/api/v1/roles");
  expect(res.status(), await res.text()).toBe(200);
  const found = ((await res.json()) as { roles: { id: string; slug: string; appKey?: string }[] }).roles.filter((role) => role.appKey === "crm" && (role.slug === slugEnd || role.slug.endsWith(`:${slugEnd}`) || role.slug.endsWith(`-${slugEnd}`) || role.slug.endsWith(`.${slugEnd}`)));
  expect(found.length, `one CRM role whose slug ends "${slugEnd}"`).toBe(1);
  return found[0]!.id;
}

/** Invite a person as the owner does, with one of the app's roles, and follow the invite's link to set their first password. */
export async function invite(name: string, email: string, roleSlug: string): Promise<RealPerson> {
  const me = await asOwner();
  const headers = await csrf(me).catch(async () => ({ "x-adminium-csrf": ((await (await me.get("/api/v1/auth/session")).json()) as { csrfToken?: string }).csrfToken ?? "" }));
  await removePerson(email);
  const made = await me.post("/api/v1/users", { data: { email, name, roleIds: [await appRole(roleSlug)] }, headers });
  expect(made.status(), await made.text()).toBe(201);
  const reply = (await made.json()) as { user: { id: string; status: string }; invite: { token: string } };
  expect(reply.user.status).toBe("invited");
  const state = readState()!;
  const door = await request.newContext({ baseURL: state.url });
  try {
    const set = await door.post("/api/v1/auth/password/reset", { data: { token: reply.invite.token, newPassword: REAL_PASSWORD }, headers: { origin: state.url } });
    expect(set.status(), await set.text()).toBeLessThan(300);
  } finally {
    await door.dispose();
  }
  const person = (await (await me.get(`/api/v1/users/${reply.user.id}`)).json()) as { status: string };
  expect(person.status, "the invite's link makes them active").toBe("active");
  return { id: reply.user.id, name, email };
}

/** A browser context signed in as a real person a spec invited. */
export async function asReal(browser: Browser, person: RealPerson, options: BrowserContextOptions = {}): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: readState()!.url, ...options });
  await login(context.request, person.email, REAL_PASSWORD);
  return context;
}

/** Take a person a spec invited away for good, by their address (nothing if there is none). Rows still theirs are said, not failed. */
export async function removePerson(email: string): Promise<void> {
  const me = await asOwner();
  const res = await me.get(`/api/v1/users?q=${encodeURIComponent(email)}&limit=50`);
  if (res.status() !== 200) return;
  const headers = await csrf(me);
  for (const user of ((await res.json()) as { users: { id: string; email: string }[] }).users.filter((one) => one.email.toLowerCase() === email.toLowerCase())) {
    const gone = await me.delete(`/api/v1/users/${user.id}?permanent=true`, { headers });
    if (gone.status() >= 300) {
      console.info(`[zw] ${email} is not removed for good (${String(gone.status())}): ${(await gone.text()).slice(0, 400)}; suspended instead.`);
      await me.delete(`/api/v1/users/${user.id}`, { headers });
    }
  }
}

/** The moment the stand's server reads as now (its clock is the ledger's, running on), as epoch ms. */
export async function standNow(person: APIRequestContext): Promise<number> {
  const config = (await (await person.get("/apps/crm/staff/surface-config.json")).json()) as { now?: string | number };
  return config.now === undefined ? Date.now() : new Date(config.now).getTime();
}

/** Move the stand's clock to a moment, running on from there (`e2e/clock.mjs`'s signal). A stand on the real clock is left alone: answers false. */
export async function setStandClock(at: number): Promise<boolean> {
  const state = readState() as { pid: number; work: string; startedAt: string | null } | null;
  if (state === null || state.startedAt === null) return false;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(state.work, "clock"), String(at));
  process.kill(state.pid, "SIGUSR2");
  return true;
}

/**
 * Deals of a spec's own, each won, and each one's job as the app's rule makes it once the win can no longer be undone
 * (a minute). The jobs are given a site; answers each job's id with its deal's, in the order of the names.
 */
export async function wonJobs(tessa: APIRequestContext, ada: APIRequestContext, data: Data, names: readonly string[], ownerId: string, contactId: number | null = null): Promise<{ deal: number; job: number }[]> {
  const headers = await csrf(tessa);
  const stage = (await rows<{ id: number }>(tessa, data, "stages", undefined, "&order=position"))[0]!.id;
  const deals: number[] = [];
  for (const name of names) {
    const deal = await tessa.post(data("deals"), { data: { values: { name, company_id: 1, owner_id: ownerId, stage_id: stage, typed_amount: 3100, ...(contactId === null ? {} : { contact_id: contactId }) } }, headers });
    expect(deal.status(), await deal.text()).toBe(201);
    const id = ((await deal.json()) as { data: { id: number } }).data.id;
    expect((await tessa.post(data("deals", `/${String(id)}/actions/mark-won`), { data: { from: "open" }, headers })).status()).toBe(200);
    deals.push(id);
  }
  const made: { deal: number; job: number }[] = [];
  const adaHeaders = await csrf(ada);
  for (const [i, deal] of deals.entries()) {
    let jobs: { id: number }[] = [];
    await expect.poll(async () => (jobs = await rows<{ id: number }>(tessa, data, "jobs", { column: "deal_id", op: "eq", value: deal })).length, { timeout: 180_000, intervals: [3000] }).toBe(1);
    const job = jobs[0]!.id;
    const site = await ada.patch(data("jobs", `/${String(job)}`), { data: { values: { site_name: `${names[i]!} site`, address_lines: "4 Mill Lane", town: "Leeds", ask_for: "Petra Holm", site_phone: "0113 496 0222" } }, headers: adaHeaders });
    expect(site.status(), await site.text()).toBe(200);
    made.push({ deal, job });
  }
  return made;
}

/** A visit of a job, booked for a crew on a day at a time, as the operations manager books one. Answers its id. */
export async function bookedVisit(ada: APIRequestContext, data: Data, job: number, crew: number, day: string, start: string, what: string): Promise<number> {
  const headers = await csrf(ada);
  const made = await ada.post(data("job_visits"), { data: { values: { job_id: job, kind: "install", what, hours: 2, crew_size: 2 } }, headers });
  expect(made.status(), await made.text()).toBe(201);
  const id = ((await made.json()) as { data: { id: number } }).data.id;
  expect((await ada.patch(data("job_visits", `/${String(id)}`), { data: { values: { day, start_time: start, crew_id: crew } }, headers })).status()).toBe(200);
  expect((await ada.post(data("job_visits", `/${String(id)}/actions/book`), { data: { from: "waiting" }, headers })).status()).toBe(200);
  return id;
}

/**
 * Everything a spec hung on the jobs of its deals (named by their first words), then the jobs, then the deals: as the
 * install's owner, since no role removes a sign-off. The pattern of `crew-signoff.e2e.ts`: a sign-off's mails (e-mail 17)
 * hold it, so they go first; the aftercare call its sign-off books comes a minute later, so the sweep is made again
 * until the job goes.
 */
export async function takeAwayJobs(data: Data, tessa: APIRequestContext, startsWith: string): Promise<void> {
  const me = await asOwner();
  const headers = await csrf(me);
  const drop = async (ref: string, column: string, value: number): Promise<void> => {
    let held: { id: number }[] = [];
    try {
      held = await rows<{ id: number }>(me, data, ref, { column, op: "eq", value });
    } catch {
      return; // a table this stage does not have
    }
    for (const row of held) expect((await me.delete(data(ref, `/${String(row.id)}?confirm=true`), { headers })).status(), ref).toBeLessThan(300);
  };
  for (const deal of await rows<{ id: number }>(me, data, "deals", { column: "name", op: "like", value: `${startsWith}%` })) {
    for (const job of await rows<{ id: number }>(me, data, "jobs", { column: "deal_id", op: "eq", value: deal.id })) {
      for (const ref of ["outbox", "sign_offs", "refused_sign_offs", "snags", "delivery_notes", "follow_ups", "time_sheet_lines"]) await drop(ref, "job_id", job.id);
      for (const visit of await rows<{ id: number; state: string }>(me, data, "job_visits", { column: "job_id", op: "eq", value: job.id })) {
        if (visit.state === "done") await me.patch(data("job_visits", `/${String(visit.id)}`), { data: { values: { state: "booked" } }, headers });
        const gone = await me.delete(data("job_visits", `/${String(visit.id)}?confirm=true`), { headers });
        expect(gone.status(), await gone.text()).toBeLessThan(300);
      }
      let removed = 0;
      for (let attempt = 0; attempt < 20 && removed === 0; attempt += 1) {
        await drop("outbox", "job_id", job.id);
        await drop("follow_ups", "job_id", job.id);
        const res = await me.delete(data("jobs", `/${String(job.id)}?confirm=true`), { headers });
        if (res.status() < 300) removed = res.status();
        else if (res.status() !== 409 || attempt === 19) expect(res.status(), await res.text()).toBeLessThan(300);
        else await sleep(1000);
      }
    }
    // Its outbox rows that name the deal and no job (none expected), then its follow-ups.
    await drop("outbox", "deal_id", deal.id);
  }
  await removeDeals(tessa, data, startsWith);
}
