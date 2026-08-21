# Sales CRM

A complete, production-shaped sales workspace — built with Vite + React +
TypeScript, no CSS framework, no backend required. It's an example app that
ships with [Adminium](https://adminium.dev): work a follow-up queue, drag deals
across a weighted pipeline, log a call, and watch the forecast move — all from
built-in demo data.

It is **not** an admin database UI. Full-table CRUD, imports and bulk edits
live in the dashboard Adminium generates from your schema; this is the rep's
working day and the manager's view of it. Every screen says so where it
matters, rather than offering a "New record" button that would lie.

The demo is dressed as **Meridian**, a fictional B2B office-furniture
wholesaler, so the companies, deals and conversations read like a pipeline
already mid-quarter rather than lorem ipsum.

**Live demo → [adminium.dev/demo/sales-crm](https://adminium.dev/demo/sales-crm)**

## What it does

- **Two personas in one build.** The demo dock switches between a rep's day
  and a sales manager's team view. The loop closes across the switch: move a
  deal to Verbal as the rep, switch to Manager, and the weighted forecast and
  the stale list have both already changed.

- **A real pipeline engine.** [`src/lib/pipeline.ts`](src/lib/pipeline.ts) is a
  pure module with no React in it: odds-weighting, column subtotals, staleness
  against the stage-entry date, the overdue-first follow-up queue, the
  three-month weighted forecast, win rate and average cycle. Nothing is stored
  pre-computed, because a stored total is a total that goes stale the moment a
  card moves. 37 assertions in
  [`pipeline.test.ts`](src/lib/pipeline.test.ts) run against the shipped seed.

- **A board you can use without dragging.** Cards drag between stages, and
  every card also carries a menu offering the same three moves — so the board
  works with a keyboard, a screen reader, or a touch device where HTML5 drag
  events never fire.

- **Eight languages, including a right-to-left one.** English, German, French,
  Czech, Danish, Simplified and Traditional Chinese, and Egyptian Arabic. The
  seeded fiction is translated too, not just the chrome, so a locale switch
  does not leave an English island inside a translated screen. Plurals go
  through `Intl.PluralRules` in each locale's own CLDR order — Czech gets its
  three forms, Arabic its six.

- **RTL by construction.** Every positional rule in the stylesheets is a CSS
  logical property, so stamping `dir="rtl"` on `<html>` mirrors the sidebar,
  the board's scroll direction, the timeline gutter and the demo dock with no
  second stylesheet. Amounts, dates and times are isolated so the bidi
  algorithm cannot reorder their digits.

- **Light / dark themes** via CSS custom properties. The app follows your
  operating system on first load; the dock's sun/moon toggle latches it.

- **A pinned clock.** Nothing user-visible reads `Date.now()`. "Now" is
  Tuesday 28 July 2026, 09:35, so every machine shows the same three overdue
  follow-ups and the same two stale deals on any day.

- **No bitmaps, no external requests.** Company marks and avatars are layered
  gradients derived from a per-record tint, carrying initials or a mono
  filename chip. Fonts are self-hosted woff2. The app works offline and behind
  a firewall.

## Local development

```bash
npm install
```

```bash
npm run dev
```

Then open the URL Vite prints (default http://localhost:5173).

### Driving the demo

The dock in the corner is the demo. Everything else is the product.

| Control | What it does |
| --- | --- |
| **Rep / Manager** | Switches persona. The loop closes across it — this is the thing to show. |
| **Language** | Eight locales, including Arabic, which flips the whole layout to RTL. |
| **Theme** | Latches light or dark over the OS preference. |
| **Reset** | Puts the seeded pipeline back the way it started. |

A sixty-second tour: Today → tick an overdue follow-up and push it a week →
Pipeline → drag *Analyst pods* from Negotiation to Verbal and watch the
weighted total climb → open the deal → log a call and schedule it as the next
step → switch to **Manager** → the forecast and the "going stale" list have
both moved.

## Deploy

- **Vercel** — import the repo. Build command `npm run build`, output `dist`.
- **DigitalOcean App Platform** — import the repo; it builds with the same
  command.
- **Host anywhere** — `npm run build` produces a fully static `dist/` you can
  drop on any static host (Netlify, Cloudflare Pages, S3, GitHub Pages…). Or
  build the container:

  ```bash
  docker build -t sales-crm .
  ```

### Build scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Type-check + build to `dist/` at base `/` (root deploys). |
| `npm run build:demo` | Build to `dist/` at base `/demo/sales-crm/` (Adminium demo). |
| `npm run preview` | Preview a production build locally. |
| `npm test` | Run the pipeline engine suite. |

## Full implementation (self-host)

There are two ways to run this workspace.

**One click — the frontend on its own.** The Vercel / DigitalOcean routes
above deploy the sales workspace by itself, running on the bundled demo data.
No database, no dashboard — a fully static preview.

**One command — the whole stack.**
[`docker-compose.yml`](docker-compose.yml) stands up Postgres (seeded by
default with the *same* companies, people, deals, follow-ups and activity), an
auto-generated Adminium dashboard that runs that real database, and the
workspace itself:

```bash
cp .env.example .env      # then set ADMINIUM_SECRET — e.g. openssl rand -hex 32
docker compose up
```

- **Sales workspace** → http://localhost:8080
- **Adminium dashboard** → http://localhost:4600

On first boot, `crm-db` applies [`db/schema.sql`](db/schema.sql), installs the
demo-data bookkeeping, and then loads [`db/seed.sql`](db/seed.sql) unless you
set `DEMO_DATA=0`. Adminium imports the Meridian database as its first source
connection, introspects the schema, and generates the back office. Finish the
~1-minute first-run wizard at `:4600` — it's pre-pointed at the pipeline.
The install spec Adminium reads to configure itself is
[`manifest.json`](manifest.json).

The seed is the app's own fiction, not a second one: the same nine accounts,
the same fourteen open deals, the same three overdue follow-ups, against the
same pinned clock. Drag *Analyst pods* to Verbal on `:8080` and it is the same
row a manager reads on `:4600`.

### Demo data

The Meridian pipeline is loaded for you — a database with data in it is the
default. To start empty instead, with the same full schema and no rows, set
`DEMO_DATA=0` in `.env` before the first `docker compose up`. Neither choice
is permanent: the demo rows go in and come out again at any time.

| Command | What it does |
| --- | --- |
| `npm run demo:status` | What is loaded right now, table by table |
| `npm run demo:import` | Load [`db/seed.sql`](db/seed.sql) |
| `npm run demo:wipe` | Remove the demo rows — your schema and your own rows stay |
| `npm run demo:reset` | Wipe, then import a fresh copy |

A wipe takes out only what the seed put in. Those rows are recorded in their
own `adminium_demo` schema, outside `public`. A demo row your own data depends
on is kept rather than force-deleted, and reported under `kept`; but
`ON DELETE CASCADE` still applies, so a demo company takes its contacts with
it and a demo deal its activities — including ones you added yourself —
counted separately as `cascaded`. `wipe` and `reset` ask before they do
anything; `npm run demo:wipe -- --yes` skips the question, which is what a
script needs. Set `DATABASE_URL` to run them against a Postgres somewhere
else. [`db/README.md`](db/README.md) covers the rest.

## The split: the workspace and the back office

The app you deploy is **the rep's workspace**. The dashboard Adminium
generates from your schema is **the back office**. That is the product story,
not a limitation:

| In this app | In the generated dashboard |
| --- | --- |
| The rep's day: queue, board, deal room | Every table as records, with full CRUD |
| Moving a deal and logging what happened | Creating and merging companies and contacts |
| The manager's weighted forecast | Imports, exports and bulk edits |
| Nudging what has gone quiet | Reporting across the whole history |

The manifest scaffolds 8 tables, 5 dashboard pages, 2 access presets
(`sales-rep`, `sales-manager`) and 4 settings into your connected database.

## Connecting to Adminium

All data access goes through a thin `DataSource` interface
([`src/data/source.ts`](src/data/source.ts)) with a single `demoSource`
implementation backed by the bundled pipeline. **Today the deployed demo is
demo data only — nothing is persisted and no email is sent.** Once Adminium's
browser-safe publishable key (`adm_pub_…`) ships, the frontend will read and
write live data through the Adminium records API via a second `DataSource`
implementation, without touching any of the screens or the store. The seam is
already in place; the key is the only missing piece.

### What is deliberately out of scope

- **Sending email.** The composer logs what happened; it does not send.
  Outbound mail needs a job runner this version does not have.
- **Reminder notifications.** Same reason.
- **Record administration.** Creating, merging and importing companies and
  contacts belongs in the generated dashboard, on purpose.
- **Leaderboards.** Ranking four fictional reps against each other would be
  inventing a competition the seed cannot honestly support.

## Project structure

```
src/
  app/         App shell + the exhaustive 8-view switch
  state/       Zustand store (persona, deals, follow-ups, activity, toasts)
  data/        demo.ts (the seeded pipeline), types.ts, source.ts (DataSource seam)
  i18n/        8-locale runtime, locale registry, ambient bridge,
               strings/ (chrome, screens, seeded prose)
  lib/         pipeline.ts (the engine) + tests, format.ts (locale-aware output)
  screens/     today, board, deal room, companies, company, contacts, manager, 404
  components/  shell, demo dock, overlays, primitives
  styles/      tokens.css (canonical design tokens), base.css, components.css,
               screens.css
public/fonts/  self-hosted Manrope + JetBrains Mono (woff2)
db/            schema.sql, seed.sql and the demo-data toolkit
```

## License

[AGPL-3.0](LICENSE) © 2026 Sales CRM. A demo shipped with Adminium.
