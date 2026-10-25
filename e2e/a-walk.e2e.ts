/**
 * THE WALK (P18 for stage 1, P24 for stage 2): every screen of the file the stand installed walked as each role whose
 * menu holds it, on the sample. It reads the stand's stage: one file walks whatever the stand installed.
 *
 * - Each sample person of a role the stage offers (and the install's owner, and a rep who is also a sales manager; from
 *   stage 2 the field crew, Yusuf) opens every line of their own menu by pressing it, and every screen under their name.
 *   My day's "next day with a visit" is a button, not a link: it is pressed, and the day it opens walked as well. Each line must open a screen of the app
 *   with its figures loaded: never "not found", "no record", "not part of your role", a failed load or a script error.
 * - Every link those screens draw is followed as the same person (a few of each shape: every deal link is one shape),
 *   and must open what it names. A link to the console must answer; a link off the install is listed, not fetched.
 * - For every screen, one person whose menu does NOT hold it is refused BY THE SERVER: a direct read of a table the
 *   screen cannot be drawn without answers 403 for them (and the address shows the refusal; at an address two screens
 *   share, a home or Settings, it shows their own screen, never this one). A screen whose every outsider still reads
 *   its tables is listed: there the menu is the only line (the server answers what it would answer on any other
 *   screen).
 * - Every screen once more in Arabic, in the dark, 390 wide: right to left, nothing sideways.
 * - axe (WCAG 2.1 A and AA) over every screen, light and dark: no finding of any impact; each is written to
 *   `e2e/.results/walk/axe.json` and listed.
 *
 * It writes nothing of the sample. Leo is made a sales manager for one test and given back; the people walked in
 * Arabic get English back. Named `a-` to run FIRST, on the stand as it was made: Today and This week put the stand's
 * clock back to the ledger's 09:35 (`ledgerClock`), and the server's per-minute windows opened before that stay open
 * until the clock catches up (its rate store reads the clock the stand moves), so a walk after them ran out of each
 * person's requests for the forty minutes the clock was put back. It ends by letting the minute's requests run out,
 * so the files after it start with a person's whole minute.
 *
 * On an install without Invoices and Inventory (`CRM_STAND_ADD_ONS=none`, run with `--grep walks`), the same walk
 * proves the smaller app: no Quotes line anywhere, Supply's lines open the page that says what Supply waits for.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

import { expect, picture, test } from "./fixtures.ts";
import { csrf, minuteOut, STAFF, unfoldMenu } from "./helpers.ts";
import { STAND_DIR, type StandState } from "./stand.mjs";
import { ROUTES, type RouteKey } from "../src/shell/routes.ts";

const OUT = join(STAND_DIR, "..", ".results", "walk");
/** One sample person per role, and the install's owner. A role whose screens all belong to a later part is walked once the stand holds that part. */
const WALKERS: { role: string; person: string; part?: string }[] = [
  { role: "rep", person: "dana" },
  { role: "sales manager", person: "ivy" },
  { role: "CRM admin", person: "tessa" },
  { role: "account manager", person: "hugo" },
  { role: "marketer", person: "lena" },
  { role: "front desk", person: "corin" },
  { role: "operations manager", person: "ada" },
  { role: "read-only", person: "grace" },
  { role: "install owner", person: "owner" },
  // Stage 2: Yusuf Adeyemi of the Blue crew. At stage 1 the field crew has no screen at all.
  { role: "field crew", person: "f_yusuf", part: "jobs" },
];
const walkersOf = (stand: StandState): typeof WALKERS => WALKERS.filter((one) => one.part === undefined || stand.parts.includes(one.part));
/** A person's own screens: under their name, everybody's. */
const OWN = ["me", "my-details", "notifications", "digest"];
/** The pages that say why no screen is shown: a menu line or a link that lands on one of these is dead. */
const DEAD = ["refused", "not-found", "no-record", "nothing-on"];
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

interface Finding {
  rule: string;
  impact: string;
  help: string;
  where: string;
  targets: string[];
}
interface Walked {
  person: string;
  role: string;
  lines: { name: string; path: string }[];
  screens: { path: string; screen: string; how: "menu" | "own" | "pressed" }[];
  links: { from: string; to: string; ok: boolean; landed: string }[];
  outside: string[];
  axe: Finding[];
  problems: string[];
}

const short = (path: string): string => path.slice(STAFF.length).split("?")[0]!;
const shapeOf = (path: string): string => path.replace(/\/\d+(?=\/|$|\?)/g, "/:n").replace(/\?.*$/, "");
/** The screens an address may open: two homes share `home`, the Settings screen and its Crews tab share `settings`. */
const routesAt = (path: string): RouteKey[] => {
  const first = short(path).split("/")[0];
  return (Object.keys(ROUTES) as RouteKey[]).filter((key) => ROUTES[key].path === first);
};
const routeOf = (path: string, screen?: string): RouteKey | undefined => {
  const all = routesAt(path);
  return all.find((key) => key === screen) ?? all[0];
};
const save = (name: string, value: unknown): void => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(value, null, 2));
};
const smaller = (stand: StandState): boolean => !stand.addOns.some((one) => one.key === "invoices");

/** Wait for a screen of the app to be drawn and its figures loaded: the frame's screen, and no skeleton left. */
async function settled(page: Page): Promise<string> {
  const screen = page.locator("[data-screen]").first();
  await expect(screen).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".crm-skeleton")).toHaveCount(0, { timeout: 30_000 });
  return (await screen.getAttribute("data-screen")) ?? "";
}

/** A page that counts what goes wrong on it: a script error, a server error, a request the server throttled. */
function watched(page: Page): { problems: string[]; throttled: () => boolean; reset: () => void } {
  const problems: string[] = [];
  let throttled = false;
  page.on("pageerror", (error) => problems.push(`script: ${String(error)}`));
  page.on("console", (message) => {
    // A picture off the install (the map's tiles) is not the app's to answer for.
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (response.status() === 429) throttled = true;
    else if (response.status() >= 500 && url.origin === new URL(page.url() || "http://x").origin) problems.push(`${String(response.status())} ${url.pathname}`);
  });
  return { problems, throttled: () => throttled, reset: () => (throttled = false) };
}

/** Open an address, and again after the server's minute when it throttled the person (their figures, not the screen, ran out). */
async function open(page: Page, watch: ReturnType<typeof watched>, go: () => Promise<unknown>): Promise<string> {
  for (let tries = 0; ; tries += 1) {
    watch.reset();
    await go();
    const screen = await settled(page).catch(() => "");
    if (!watch.throttled() || tries >= 2) return screen;
    await page.waitForTimeout(31_000);
  }
}

async function scan(page: Page, where: string): Promise<Finding[]> {
  // A screen fades in: read its colours once every animation that ends has ended (mid-fade, every colour is paler).
  await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().filter((one) => one.effect?.getTiming().iterations !== Infinity).map((one) => one.finished.catch(() => undefined))), new Promise((done) => setTimeout(done, 3000))]));
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  // A contrast finding names its two colours and its ratio, so the colour can be found and fixed.
  const what = (node: (typeof result.violations)[number]["nodes"][number]): string => {
    const data = node.any[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number; expectedContrastRatio?: string } | undefined;
    return data?.contrastRatio === undefined ? "" : ` [${String(data.fgColor)} on ${String(data.bgColor)} ${String(data.contrastRatio)}:1 < ${String(data.expectedContrastRatio)}]`;
  };
  return result.violations.map((one) => ({ rule: one.id, impact: one.impact ?? "unknown", help: one.help, where, targets: one.nodes.slice(0, 8).map((node) => `${node.target.join(" ")}${what(node)}`) }));
}

/** The lines of a person's menu, every group unfolded, as the menu draws them. */
async function menuLines(page: Page): Promise<{ name: string; path: string }[]> {
  await unfoldMenu(page);
  return page.getByRole("navigation", { name: "Menu" }).getByRole("link").evaluateAll((links) => links.map((link) => ({ name: (link.textContent ?? "").trim(), path: new URL((link as HTMLAnchorElement).href).pathname })));
}

/** The links a screen draws (its own, not the menu's), same-origin ones by path, others whole. */
async function linksOn(page: Page): Promise<{ inside: string[]; outside: string[] }> {
  const all = await page.locator("main a[href], [data-screen] a[href], [role=dialog] a[href]").evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));
  const origin = new URL(page.url()).origin;
  const inside = new Set<string>();
  const outside = new Set<string>();
  for (const href of all) {
    const url = new URL(href);
    if (url.protocol === "mailto:" || url.protocol === "tel:") continue;
    if (url.origin === origin) inside.add(`${url.pathname}${url.search}`);
    else outside.add(href);
  }
  return { inside: [...inside], outside: [...outside] };
}

/** Walk one person's menu and the screens under their name; follow what the screens link to. */
async function walk(context: BrowserContext, person: string, role: string, stand: StandState): Promise<Walked> {
  const page = await context.newPage();
  const watch = watched(page);
  const out: Walked = { person, role, lines: [], screens: [], links: [], outside: [], axe: [], problems: [] };
  try {
    await open(page, watch, () => page.goto(STAFF));
    out.lines = await menuLines(page);
    expect(out.lines.length, `${person} has a menu`).toBeGreaterThan(0);
    const seen = new Map<string, string[]>();
    const visit = async (asked: string, how: "menu" | "own" | "pressed"): Promise<void> => {
      const screen = await open(page, watch, async () => {
        if (how === "menu") {
          await unfoldMenu(page);
          await page.getByRole("navigation", { name: "Menu" }).locator(`a[href="${asked}"]`).first().click();
          await expect(page).toHaveURL(new RegExp(`${asked.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
        } else if (how === "own") await page.goto(asked);
        else {
          // A button that opens another address of the same screen: pressed, and the address it opens is what is walked.
          const from = page.url();
          await page.getByTestId(asked).click();
          await expect(page).not.toHaveURL(from);
        }
      });
      const path = how === "pressed" ? new URL(page.url()).pathname : asked;
      out.screens.push({ path, screen, how });
      // A Supply line on an install without Inventory opens the page that says what it waits for.
      const allowed = smaller(stand) && routeOf(path, screen) !== undefined && ROUTES[routeOf(path, screen)!].part === "supply" ? ["waits"] : [];
      if (screen === "" || (DEAD.includes(screen) && !allowed.includes(screen))) out.problems.push(`${path}: opened "${screen || "nothing"}"`);
      if ((await page.locator(".crm-load-failed").count()) > 0) out.problems.push(`${path}: a load failed`);
      const links = await linksOn(page);
      for (const link of links.inside) if (link.startsWith(STAFF) || link.startsWith("/p/") || link.startsWith("/studio")) (seen.get(shapeOf(link)) ?? seen.set(shapeOf(link), []).get(shapeOf(link))!).push(link);
      out.outside.push(...links.outside.filter((one) => !out.outside.includes(one)));
      out.axe.push(...(await scan(page, `${person} ${short(path) || "home"}`)));
      await picture(page, `walk-s${String(stand.stage)}-${person}-${short(path).replace(/\//g, "-") || "home"}`);
      // My day opens on today; a day with a visit is one press away ("next day with a visit"), and that day's visit holds the links to its sign-off.
      if (how === "menu" && screen === "myday" && (await page.getByTestId("cw-next").count()) > 0) await visit("cw-next", "pressed");
    };
    for (const line of out.lines) await visit(line.path, "menu");
    for (const own of OWN) await visit(`${STAFF}${own}`, "own");
    // What the screens link to, a few of each shape: every deal's link is one shape.
    const walkedPaths = new Set(out.screens.map((one) => one.path));
    for (const [, links] of seen) {
      for (const link of [...new Set(links)].filter((one) => !walkedPaths.has(one)).slice(0, 2)) {
        if (link.startsWith(STAFF)) {
          const landed = await open(page, watch, () => page.goto(link));
          const allowed = smaller(stand) ? ["waits"] : [];
          const ok = landed !== "" && (!DEAD.includes(landed) || allowed.includes(landed)) && (await page.locator(".crm-load-failed").count()) === 0;
          out.links.push({ from: "screen", to: link, ok, landed });
        } else {
          const status = (await context.request.get(link)).status();
          out.links.push({ from: "screen", to: link, ok: status < 400, landed: String(status) });
        }
      }
    }
    out.problems.push(...watch.problems);
    return out;
  } finally {
    save(`walk-${person}`, out);
    await page.close();
  }
}

for (const { role, person, part } of WALKERS) {
  test(`walks the ${role}'s menu (${person}): every line opens a screen, every link it draws opens what it names`, async ({ as, stand }) => {
    test.skip(part !== undefined && !stand.parts.includes(part), `the ${role} has no screen before the stage that brings ${String(part)}`);
    test.setTimeout(900_000);
    // Without Inventory, at stage 1, the operations manager's only part waits: the server refuses her the app's screens and
    // Adminium shows its own "nothing is switched on for you" (decision 147). No menu, so no line to walk. From stage 2 she has Jobs.
    if (smaller(stand) && person === "ada" && !stand.parts.includes("jobs")) {
      const refused = await (await as(person)).request.get(`${STAFF}surface-config.json`);
      expect(refused.status()).toBe(403);
      expect(((await refused.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("NO_STAFF_ACCESS");
      return;
    }
    const walked = await walk(await as(person), person, role, stand);
    console.log(`[walk s${String(stand.stage)}] ${person}: ${String(walked.lines.length)} menu lines, ${String(walked.screens.length)} screens opened, ${String(walked.links.length)} links followed, ${String(walked.outside.length)} off the install`);
    // On the smaller install, nothing of Quotes is offered: no line, no link.
    if (smaller(stand)) {
      expect(walked.lines.filter((line) => ["quotes", "approvals"].includes(routeOf(line.path) ?? "")), `${person}: no Quotes line`).toEqual([]);
      expect(walked.links.filter((link) => /\/quotes(\/|$)/.test(link.to)), `${person}: no link to a quote`).toEqual([]);
    }
    expect(walked.problems, `${person}'s walk`).toEqual([]);
    expect(walked.links.filter((link) => !link.ok), `${person}'s links`).toEqual([]);
  });
}

test("walks a rep who is also a sales manager: both menus, both homes, every line opens a screen", async ({ api, as, stand }) => {
  test.setTimeout(900_000);
  const owner = await api("owner");
  const headers = await csrf(owner);
  const roles = ((await (await owner.get("/api/v1/roles")).json()) as { roles: { id: string; slug: string }[] }).roles;
  const manager = roles.find((one) => one.slug === "crm-sales-manager")!;
  const leo = stand.people["leo"]!.id;
  expect((await owner.post(`/api/v1/users/${leo}/roles`, { data: { roleId: manager.id }, headers })).status()).toBe(200);
  try {
    const walked = await walk(await as("leo"), "leo", "rep + sales manager", stand);
    const paths = walked.lines.map((line) => short(line.path));
    // The manager's lines lead (her home is his), the rep's own follow, nothing twice.
    expect(paths[0]).toBe("team");
    for (const his of ["today", "week", "targets"]) expect(paths, his).toContain(his);
    expect(new Set(paths).size).toBe(paths.length);
    expect(walked.problems).toEqual([]);
    expect(walked.links.filter((link) => !link.ok)).toEqual([]);
  } finally {
    expect((await owner.delete(`/api/v1/users/${leo}/roles/${manager.id}`, { headers })).status()).toBe(200);
  }
});

const walks = (): Walked[] => (existsSync(OUT) ? readdirSync(OUT).filter((name) => name.startsWith("walk-")).map((name) => JSON.parse(readFileSync(join(OUT, name), "utf8")) as Walked) : []);
const tableUrl = (stand: StandState, ref: string): string | null => {
  const real = ref.startsWith("inventory:") ? stand.tables[`inventory_${ref.slice("inventory:".length)}`] : stand.tables[`crm_${ref}`];
  return real === undefined ? null : `/api/v1/data/${stand.connectionId}/${encodeURIComponent(real)}?limit=1`;
};

/** The screens a walk opened, each once: the address and the screen it drew there (two homes share one address). */
const screenKey = (path: string, screen: string): string => `${short(path)}|${screen}`;

test("refuses every screen, by the server, to a person whose menu does not hold it", async ({ api, as, stand }) => {
  test.setTimeout(900_000);
  const done = walks().filter((one) => one.person !== "leo");
  expect(done.length, "the walks ran first").toBe(walkersOf(stand).length);
  // Each screen a menu line opened, by its address and the screen drawn there.
  const screens = new Map<string, { path: string; route: RouteKey; holders: Set<string> }>();
  for (const one of done) {
    for (const seen of one.screens.filter((each) => each.how === "menu")) {
      const route = routeOf(seen.path, seen.screen);
      if (route === undefined || OWN.includes(short(seen.path))) continue;
      const key = screenKey(seen.path, seen.screen);
      (screens.get(key) ?? screens.set(key, { path: seen.path, route, holders: new Set() }).get(key)!).holders.add(one.person);
    }
    // …and each screen a link opened (a record, the crew's sign-off), one of each shape.
    for (const link of one.links.filter((each) => each.ok && each.to.startsWith(STAFF))) {
      const path = link.to.split("?")[0]!;
      const route = routeOf(path, link.landed);
      if (route === undefined || OWN.includes(short(path))) continue;
      const key = screenKey(shapeOf(path), link.landed);
      (screens.get(key) ?? screens.set(key, { path, route, holders: new Set() }).get(key)!).holders.add(one.person);
    }
  }
  const refused: { path: string; screen: string; person: string; table: string; status: number; page: string }[] = [];
  const menuOnly: { path: string; screen: string; outsiders: string[] }[] = [];
  for (const [key, { path, route, holders }] of screens) {
    const outsiders = done.filter((one) => !holders.has(one.person));
    const shared = routesAt(path).length > 1;
    let found = false;
    for (const outsider of outsiders) {
      const person = await api(outsider.person);
      for (const ref of ROUTES[route].reads) {
        const url = tableUrl(stand, ref);
        if (url === null) continue;
        const status = (await person.get(url)).status();
        if (status === 403) {
          // …and the address, opened as them, shows the refusal (or the page a part off shows), never the screen. An address two
          // screens share (a home, Settings) shows them their own screen there, never this one.
          const page = await (await as(outsider.person)).newPage();
          await page.goto(path);
          const shown = await settled(page).catch(() => "");
          await page.close();
          refused.push({ path: short(path), screen: key.split("|")[1]!, person: outsider.person, table: ref, status, page: shown });
          if (shared && shown !== "" && !DEAD.includes(shown)) expect(shown, `${path} as ${outsider.person}`).not.toBe(key.split("|")[1]);
          else expect(["refused", "not-found", "no-record", "nothing-on", "waits"], `${path} as ${outsider.person}`).toContain(shown);
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) menuOnly.push({ path: short(path), screen: key.split("|")[1]!, outsiders: outsiders.map((one) => one.person) });
  }
  save("refusals", { stage: stand.stage, refused, menuOnly });
  console.log(`[walk s${String(stand.stage)}] ${String(screens.size)} screens on a menu or behind a link; refused by the server: ${String(refused.length)}; by the menu only: ${menuOnly.map((one) => `${one.path} (${one.screen})`).join(", ") || "none"}`);
  // Settings is the one screen every outsider reads the table of (every screen reads the settings row, decision 206).
  expect(menuOnly.filter((one) => one.path !== "settings")).toEqual([]);
  expect(refused.length).toBe(screens.size - menuOnly.length);
});

test("every screen in Arabic, in the dark, 390 wide: right to left, nothing sideways", async ({ api, as, stand }) => {
  test.setTimeout(1_200_000);
  const done = walks().filter((one) => one.person !== "leo");
  expect(done.length, "the walks ran first").toBe(walkersOf(stand).length);
  // Each screen once, as the first person whose walk opened it (two homes share one address: each is taken as its own).
  const byPerson = new Map<string, string[]>();
  const taken = new Set<string>();
  for (const one of done) {
    for (const seen of one.screens) {
      const key = screenKey(seen.path, seen.screen);
      if (taken.has(key)) continue;
      taken.add(key);
      (byPerson.get(one.person) ?? byPerson.set(one.person, []).get(one.person)!).push(seen.path);
    }
  }
  const results: { person: string; path: string; screen: string; dir: string; sideways: number }[] = [];
  const axe: Finding[] = [];
  const problems: string[] = [];
  for (const [person, paths] of byPerson) {
    const request: APIRequestContext = await api(person);
    const headers = await csrf(request);
    expect((await request.patch("/api/v1/me/prefs", { data: { locale: "ar_EG" }, headers })).status()).toBe(200);
    try {
      const page = await (await as(person, { viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
      const watch = watched(page);
      for (const path of paths) {
        const screen = await open(page, watch, () => page.goto(path));
        const dir = (await page.locator("html").getAttribute("dir")) ?? "";
        const lang = (await page.locator("html").getAttribute("lang")) ?? "";
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        results.push({ person, path: short(path), screen, dir, sideways });
        if (dir !== "rtl" || lang !== "ar-EG") problems.push(`${path} as ${person}: dir ${dir}, lang ${lang}`);
        if (sideways > 1) problems.push(`${path} as ${person}: ${String(sideways)} px sideways at 390`);
        if (screen === "" || DEAD.includes(screen)) problems.push(`${path} as ${person}: opened "${screen || "nothing"}"`);
        axe.push(...(await scan(page, `${person} ${short(path) || "home"} ar dark 390`)));
        await picture(page, `walk-s${String(stand.stage)}-${person}-${short(path).replace(/\//g, "-") || "home"}-ar-dark-390`);
      }
      problems.push(...watch.problems.map((one) => `${person}: ${one}`));
    } finally {
      await request.patch("/api/v1/me/prefs", { data: { locale: "en_US" }, headers });
    }
  }
  save("arabic-dark-390", { stage: stand.stage, results, axe, problems });
  console.log(`[walk s${String(stand.stage)}] Arabic, dark, 390: ${String(results.length)} screens`);
  expect(problems).toEqual([]);
});

test("axe over every screen walked, light and dark: no finding of any impact", async ({ stand }) => {
  await minuteOut();
  const all: Finding[] = [...walks().flatMap((one) => one.axe), ...(existsSync(join(OUT, "arabic-dark-390.json")) ? (JSON.parse(readFileSync(join(OUT, "arabic-dark-390.json"), "utf8")) as { axe: Finding[] }).axe : [])];
  // One line per rule and element, with every screen it was met on.
  const byRule = new Map<string, { rule: string; impact: string; help: string; targets: Set<string>; where: Set<string> }>();
  for (const one of all) {
    const key = `${one.impact} ${one.rule}`;
    const entry = byRule.get(key) ?? byRule.set(key, { rule: one.rule, impact: one.impact, help: one.help, targets: new Set(), where: new Set() }).get(key)!;
    for (const target of one.targets) entry.targets.add(target);
    entry.where.add(one.where);
  }
  const listed = [...byRule.values()].map((one) => ({ ...one, targets: [...one.targets].slice(0, 12), where: [...one.where] }));
  save("axe", listed);
  for (const one of listed) console.log(`[walk s${String(stand.stage)} axe] ${one.impact} ${one.rule} (${String(one.where.length)} screens): ${one.help}; ${one.targets.slice(0, 3).join(" | ")}`);
  expect(listed.map((one) => `${one.impact} ${one.rule}: ${one.targets.slice(0, 3).join(" | ")} (${one.where.slice(0, 3).join("; ")})`)).toEqual([]);
});
