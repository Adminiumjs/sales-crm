#!/usr/bin/env node
/**
 * THE APP BY STAGE: the manifest and the sample a release ships, cut from the
 * whole app.
 *
 * `whole/` holds the app as it will be when every stage is out: every part,
 * every table, the whole sample. A release ships the parts that have screens
 * and no others (ruling R5): a part with no screen yet is not "switched off",
 * it is NOT IN THE FILE, so an owner cannot tick it, its roles are not
 * offered, and its rules do not run. It arrives later as an update.
 *
 * `stage.json` says which parts each stage brings and which stage is
 * released. This script cuts the whole down to a stage:
 *
 *  - the parts of later stages, their tables, pages and rules go;
 *  - a column of a kept table that points into a table that went, goes
 *    (a follow-up's link to a job), and with it every mention of that column:
 *    an index, a role's column lists;
 *  - a role keeps the parts it still has; a role left with none goes, and the
 *    sample's people who held it with it;
 *  - the sample loses the rows of tables that went, the columns that went,
 *    the rows `stage.json` names as belonging to a later part, and any file
 *    no row still uses.
 *
 * Nothing is added and nothing is reworded: every stage is a subset of the
 * whole, and the last stage IS the whole (a test holds both).
 *
 *   node scripts/stage-manifest.mjs            write the released stage to manifest.json and seeds/
 *   node scripts/stage-manifest.mjs --check    fail if those are not what the whole derives today
 *   node scripts/stage-manifest.mjs --stage 2 --out <dir>   write another stage somewhere else
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WHOLE = join(APP, "whole");

export const readStages = () => JSON.parse(readFileSync(join(APP, "stage.json"), "utf8"));
export const readWhole = () => JSON.parse(readFileSync(join(WHOLE, "manifest.json"), "utf8"));

/** The parts an install of this stage holds: its own and every earlier stage's. */
export function partsOf(stages, stage) {
  const parts = [];
  for (const [number, own] of Object.entries(stages.stages)) if (Number(number) <= stage) parts.push(...own);
  return parts;
}

/**
 * The manifest of a stage. Pure: the whole in, the stage out.
 * Answers the manifest and what was cut from it, for the sample and for a test.
 */
export function stageManifest(whole, stages, stage) {
  const keep = new Set(partsOf(stages, stage));
  const doc = structuredClone(whole);
  const partOf = (item) => item.module === undefined || keep.has(item.module);

  const goneTables = new Set(doc.requiredSchema.tables.filter((table) => !partOf(table)).map((table) => table.ref));
  doc.requiredSchema.tables = doc.requiredSchema.tables.filter((table) => partOf(table));

  // Columns that point into a table that went, then columns worked out through one of those, until nothing more goes.
  const goneColumns = {};
  for (const table of doc.requiredSchema.tables) {
    const gone = new Set();
    for (let more = true; more; ) {
      more = false;
      for (const column of table.columns) {
        if (gone.has(column.ref)) continue;
        const rules = column.rules ?? {};
        const intoGone = goneTables.has(column.references) || [...goneTables].some((ref) => ["from", "table"].some((key) => JSON.stringify(rules).includes(`"${key}":"${ref}"`)));
        const throughGone = [...gone].some((ref) => JSON.stringify(rules).includes(`"via":"${ref}"`));
        if (intoGone || throughGone) {
          gone.add(column.ref);
          more = true;
        }
      }
    }
    if (gone.size === 0) continue;
    goneColumns[table.ref] = [...gone];
    table.columns = table.columns.filter((column) => !gone.has(column.ref));
    if (table.indexes !== undefined) table.indexes = table.indexes.filter((index) => !index.some((ref) => gone.has(ref)));
  }
  // A way a row is somebody's that runs through a table that went.
  for (const table of doc.requiredSchema.tables) {
    if (table.belongs === undefined) continue;
    table.belongs = table.belongs.filter((way) => !goneTables.has(way.through?.table) && !(goneColumns[table.ref] ?? []).includes(way.column ?? way.via));
    if (table.belongs.length === 0) delete table.belongs;
  }

  doc.modules = doc.modules.filter((part) => keep.has(part.id));
  const goneRules = new Set((doc.automations ?? []).filter((rule) => !partOf(rule) || [...goneTables].some((ref) => JSON.stringify(rule).includes(`"table":"${ref}"`))).map((rule) => rule.key));
  doc.automations = (doc.automations ?? []).filter((rule) => !goneRules.has(rule.key));

  const tableOfPage = (page) => Object.values(page.bindings ?? {}).filter((value) => typeof value === "string");
  const gonePages = new Set(doc.pages.filter((page) => !partOf(page) || tableOfPage(page).some((ref) => goneTables.has(ref))).map((page) => page.ref));
  doc.pages = doc.pages.filter((page) => !gonePages.has(page.ref));
  // A card of an overview that reads a table that went (a job visit's on the Overview) goes; the page stays.
  const tablesOfCard = (item) => {
    const binding = item.config?.binding ?? {};
    return [binding.source?.name, binding.team?.target?.table, binding.counts?.table].filter((ref) => typeof ref === "string");
  };
  for (const page of doc.pages) {
    const items = page.config?.layout?.items;
    if (Array.isArray(items)) page.config.layout.items = items.filter((item) => !tablesOfCard(item).some((ref) => goneTables.has(ref)));
  }
  // An entry of the app's section that belongs to a part of a later stage goes with it.
  if (doc.navLinks !== undefined) {
    doc.navLinks = doc.navLinks.filter((link) => partOf(link));
    if (doc.navLinks.length === 0) delete doc.navLinks;
  }
  const groups = new Set([...doc.pages, ...(doc.navLinks ?? [])].map((entry) => entry.nav?.group));
  doc.navGroups = (doc.navGroups ?? []).filter((group) => groups.has(group.key));

  if (doc.addOns?.features !== undefined) doc.addOns.features = doc.addOns.features.filter((feature) => keep.has(feature.id));
  if (doc.outbox?.producers !== undefined) doc.outbox.producers = doc.outbox.producers.filter((producer) => partOf(producer) && !goneTables.has(producer.onChange?.table));

  // Roles: what each still holds. One left with no part is not offered.
  const goneRoles = new Set();
  doc.roles = doc.roles.filter((role) => {
    role.modules = (role.modules ?? []).filter((part) => keep.has(part));
    if (role.modules.length === 0) {
      goneRoles.add(role.key);
      return false;
    }
    role.permissions = role.permissions.filter((permission) => {
      const [kind, target] = permission.split(":");
      if (kind === "table") return !goneTables.has(target.replace(/^@/, ""));
      if (kind === "page") return !gonePages.has(target.replace(/^@/, ""));
      return true;
    });
    for (const [ref, limit] of Object.entries(role.limits ?? {})) {
      if (goneTables.has(ref)) {
        delete role.limits[ref];
        continue;
      }
      for (const list of ["readable", "writable", "creatable"]) if (Array.isArray(limit[list])) limit[list] = limit[list].filter((column) => !(goneColumns[ref] ?? []).includes(column));
    }
    return true;
  });

  if (doc.sampleData !== undefined) {
    doc.sampleData.people = (doc.sampleData.people ?? []).filter((person) => !goneRoles.has(person.role));
    const people = new Set(doc.sampleData.people.map((person) => person.key));
    for (const team of doc.sampleData.teams ?? []) {
      for (const list of ["members", "leads"]) if (Array.isArray(team[list])) team[list] = team[list].filter((key) => people.has(key));
    }
  }

  return { manifest: doc, cut: { parts: whole.modules.map((part) => part.id).filter((id) => !keep.has(id)), tables: [...goneTables], columns: goneColumns, pages: [...gonePages], rules: [...goneRules], roles: [...goneRoles] } };
}

const walk = (value, visit) => {
  if (Array.isArray(value)) for (const one of value) walk(one, visit);
  else if (value !== null && typeof value === "object") {
    visit(value);
    for (const one of Object.values(value)) walk(one, visit);
  }
};

/** The sample of a stage: the whole sample less what the manifest lost, and the rows `stage.json` gives to a later part. */
export function stageSample(sample, stages, stage, cut) {
  const keep = new Set(partsOf(stages, stage));
  const out = structuredClone(sample);
  const laterRows = (stages.rows ?? []).filter((rule) => !keep.has(rule.part));
  out.tables = out.tables
    .filter((table) => !cut.tables.includes(table.ref))
    .map((table) => {
      const gone = cut.columns[table.ref] ?? [];
      const rules = laterRows.filter((rule) => rule.table === table.ref);
      const rows = table.rows
        .filter((row) => !rules.some((rule) => Object.entries(rule.where).every(([column, values]) => values.includes(row[column]))))
        .map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => !gone.includes(column))));
      return { ...table, rows };
    });
  if (out.assets !== undefined) {
    const used = new Set();
    walk(out.tables, (node) => {
      if (typeof node["@asset"] === "string") used.add(node["@asset"]);
    });
    out.assets = Object.fromEntries(Object.entries(out.assets).filter(([name]) => used.has(name)));
    if (Object.keys(out.assets).length === 0) delete out.assets;
  }
  return out;
}

/** Every file of a stage, by its path in the package: the manifest, the sample, the add-ons' sample files, the files the sample uses. */
export function stageFiles(stage, stages = readStages(), whole = readWhole()) {
  const { manifest, cut } = stageManifest(whole, stages, stage);
  const files = { "manifest.json": `${JSON.stringify(manifest, null, 2)}\n` };
  const sampleFile = manifest.sampleData?.file;
  if (sampleFile !== undefined) {
    const sample = stageSample(JSON.parse(readFileSync(join(WHOLE, sampleFile), "utf8")), stages, stage, cut);
    files[sampleFile] = `${JSON.stringify(sample, null, 1)}\n`;
    for (const asset of Object.values(sample.assets ?? {})) files[asset.file] = readFileSync(join(WHOLE, asset.file));
    for (const [key, addOn] of Object.entries(manifest.sampleData.addOns ?? {})) {
      // An add-on's sample file goes with the part that needs the add-on.
      const feature = (whole.addOns?.features ?? []).find((one) => (one.requires ?? []).includes(key));
      if (feature !== undefined && !partsOf(stages, stage).includes(feature.id)) {
        delete manifest.sampleData.addOns[key];
        continue;
      }
      files[addOn.file] = readFileSync(join(WHOLE, addOn.file), "utf8");
    }
    files["manifest.json"] = `${JSON.stringify(manifest, null, 2)}\n`;
  }
  return { files, cut, manifest };
}

const listed = (dir, under = "") => (existsSync(dir) ? readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? listed(join(dir, name), `${under}${name}/`) : [`${under}${name}`])) : []);

function main() {
  const args = process.argv.slice(2);
  const stages = readStages();
  const at = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const stage = Number(at("--stage") ?? stages.released);
  const out = at("--out") === undefined ? APP : resolve(at("--out"));
  const { files, cut } = stageFiles(stage, stages);
  // What the released stage owns at the root: the manifest and everything under seeds/.
  const stale = out === APP ? listed(join(APP, "seeds"), "seeds/").filter((path) => files[path] === undefined) : [];
  if (args.includes("--check")) {
    const wrong = Object.entries(files)
      .filter(([path, content]) => !existsSync(join(out, path)) || !readFileSync(join(out, path)).equals(Buffer.from(content)))
      .map(([path]) => path);
    if (wrong.length + stale.length > 0) {
      console.error(`stage ${String(stage)} is not what whole/ derives: ${[...wrong, ...stale.map((path) => `${path} (should not be there)`)].join(", ")}. Run \`npm run stage\`.`);
      process.exit(1);
    }
    console.log(`stage ${String(stage)}: ${String(Object.keys(files).length)} files, as derived`);
    return;
  }
  for (const path of stale) rmSync(join(out, path));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), content);
  }
  console.log(`stage ${String(stage)} written to ${out}: parts ${partsOf(stages, stage).join(", ")}; left out ${String(cut.tables.length)} tables, ${String(cut.pages.length)} pages, ${String(cut.rules.length)} rules, roles ${cut.roles.join(", ") || "none"}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
