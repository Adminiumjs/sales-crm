# Sales CRM

A sales app for [Adminium](https://adminium.dev), for a team that sells: deals on a board, quotes a
customer accepts from a link, companies and contacts, the team's targets, cover and one-to-ones,
an inbox of enquiries, and the stock a deal waits for. It is for any business, in its own currency
and its own language: the install's currency, the business's time zone and working week, and each
person's language as they chose it in Adminium.

It runs inside Adminium: its screens read and write through the signed-in person's own session,
so every figure on them is what the server answers that person. It needs Adminium 0.3.35 or newer.

## What installs

| | |
| --- | --- |
| Key | `crm` (tables are named `crm_…`) |
| Parts | 10: Selling, Accounts and The team always; Inbox on; Quotes on with Invoices & Receipts; Supply on with Inventory; Showroom and samples, Jobs on site, After the job and Vehicles and crew off until switched on |
| Tables | 75 |
| Screens | The app's own screens (below), a customer's quote page, and a "Sales CRM" section in Adminium's own console |
| Roles | 9 |
| Shipped rules | 21: ten the app works by (a deal's history, a won deal's job, the crew's day sheet, the aftercare call) and one that tells a deal's owner when a customer accepts a quote on a lost deal, switched on, and ten that tell people, switched off |
| E-mails | 18, each in eight languages |
| Sample data | "Meridian", an office-furniture wholesaler in pounds: 688 rows in 69 tables, 16 people, three teams (sales and two crews) |
| Languages | English, German, French, Danish, Czech, Egyptian Arabic (right to left), Simplified and Traditional Chinese |
| Databases | Postgres, MySQL, SQLite |

### The parts

The install asks which parts to start with; each can be switched on or off later (the app's
settings in Studio → **Parts**). A part that is off has no screens, no menu lines, no console
cards and runs none of its rules; its records stay.

| Part | Starts | What it holds |
| --- | --- | --- |
| Selling | always on | Today, This week, the board, a deal's room, site visits, saved views and searches, handing a deal over, Closed, Why we lose; the manager's Team view, Stage health, Nudges and Activity feed |
| Quotes | on, with Invoices & Receipts | Quotes and their versions, Approvals, the customer's quote page |
| Accounts | always on | Companies, contacts, a company's timeline, Territory (a map), Paste a list, Renewals, Repeat orders, Referrals |
| The team | always on | Messages, Targets, the Weekly meeting, One-to-one notes, Coaching, New starter, Cover |
| Inbox | on | The team inbox (an enquiry typed in by whoever takes the call), Trade-show leads with a pasted list |
| Supply | on, with Inventory | Stock and lead times, the Supplier scorecard |
| Showroom and samples | off | Showroom bookings and follow-ups, the Sample library and returns, Display stock; the front desk's home |
| Jobs on site | off | A won deal's job, Deliveries, the Day sheet, the Route, Sign-off, Snags, Delivery notes, Recycling; the field crew's phone (My day, ticks, signing a job off with the customer's signature and photos, snags) |
| After the job | off | Aftercare calls (one booked when a job is signed off), What customers said, Complaints, Warranty claims |
| Vehicles and crew | off | Vehicles and their checks and faults, Fuel, Time sheets, Training and certificates, Subcontractors, Insurance claims; on the crew's phone My vehicle, My hours, My certificates |

### Add-ons

The app needs none. **Invoices & Receipts** (1.0.12 or newer) is ticked at install: a quote is one
of its documents, so it numbers the quote, works out its tax and prints it. Installed without it,
the Quotes part is left out (no quote tables, screens or links) and comes in when the add-on is
connected. **Inventory** (1.0.12 or newer) keeps the stock: without it Supply's menu lines open a
page that says what Supply waits for and who connects it. **Offers** (a reward for a customer who
refers another) is suggested and not ticked.

### The roles

Each is installed as `crm-<key>`. A person's menu is their role's; what they read in it is what
the server gives them. A person with two roles gets both menus, the first role's home leading. The
install's owner, who holds none, gets the CRM admin's menu.

| Role | Key | Lands on | In short |
| --- | --- | --- | --- |
| Sales rep | `rep` | Today | Their own deals and what hangs on them (a helper or a cover reaches a colleague's); companies and contacts |
| Sales manager | `sales-manager` | Team view | The deals of the people they lead; approves a discount (not their own); targets, cover, one-to-ones, coaching |
| CRM admin | `admin` | Team view | Everything but the private one-to-ones and coaching; the app's settings |
| Account manager | `account-manager` | Home | Companies and contacts; a deal once it is won, and an open one while he is on it; renewals, repeat orders, referrals; after the job |
| Marketer | `marketer` | Home | Enquiries and trade-show leads; companies; no deal, no amount |
| Front desk | `front-desk` | Team inbox (Home with the showroom) | Types in an enquiry; the showroom's bookings and samples; no deal |
| Operations manager | `ops-manager` | Stock (Home with Jobs on site) | Supply; jobs, deliveries, crews; vehicles and time sheets; a won deal's name to make its job, no amount |
| Field crew | `crew` | My day | His crew's visits and snags, signing a job off, his vehicle, hours and certificates; no amount anywhere |
| Read-only | `read-only` | Team view | Reads everything but what is private; writes nothing, and the server refuses a write |

Every "may not" is the server's: a screen without a button is never the only thing in the way.

### What Adminium keeps for you

- **A deal's amount** is its newest sent quote's total before tax, else the figure typed on it.
  Its weighted value is that amount at its stage's odds.
- **A discount needs approval** when a quote stands further under list than the setting allows (5 %
  at install) or a line has no list price; it cannot be sent until a sales manager approves it,
  and a quote made cheaper afterwards is asked again.
- **A deal's history**: each stage move, who made it and when, the amount each quote was sent at.
- **A closed deal is locked**, but for its closing note and its lost reason.
- **The customer's link** opens one quote and nothing else: accepted once, with a name, or declined.

### The rules

Ten are switched on at install: a deal's mark and first history line; a line for each stage
move (two rules, so that a deal moved several times before the rules run keeps every move); the
amount a quote was sent at; "approval asked" to the asker's team lead (else the CRM admin); a won
deal's job (Jobs on site); three that tell a crew at once that today's or tomorrow's day sheet
changed; and an aftercare call booked 28 days after a job is signed off, for the person Settings
names, else the rep who sold it (After the job). A rule of a part that is off does not run.

Ten tell people and are switched off: a deal gone quiet, stuck in its stage, or closing soon and
not agreed (the days are the app's settings); a follow-up due; a quote running out; a deal handed
over; a discount approved or refused; and two weekly e-mails, a rep's and account manager's own
week and a manager's team's. Each person sets their quiet hours and their weekly e-mail's day and
time, or switches it off.

### The e-mails

A quote sent (with the button that opens the customer's page) and accepted; a site visit confirmed,
moved and cancelled, naming the rep who comes; an introduction thanked; the handover introduction;
approval asked; the two weekly e-mails; a showroom booking and a delivery confirmed, moved and
cancelled; the customer's signed copy of a sign-off, with what is still to put right; a
subcontractor asked for their insurance certificate. Each in eight languages, in the recipient's.

### The console

Adminium's own sidebar gets a "Sales CRM" section: an Overview of cards (open pipeline, weighted,
won this year, target cover, unclaimed enquiries, pipeline by stage, the forecast, the reps, the
deals sitting longest), the Pipeline as a board, Deals, Companies, Contacts, Quotes, Approvals and
Enquiries, and for the owner the app's Rules, E-mails and Sample data. Each card's words are in the
reader's language; a card of a part that is off is not drawn.

## The sample data

"Add sample data" brings Meridian's pipeline: 40 deals (14 open, 8 won, 18 lost), nine quotes, ten
site visits, seventeen enquiries, the team's targets, one-to-ones, coaching and a cover; the
showroom's bookings and samples; eight jobs with their visits, sign-offs and snags; aftercare calls,
complaints and claims; two vans, their fuel and checks, the crews' time sheets and certificates;
688 rows in 69 tables, and sixteen people in the nine roles, with the team "Sales" and two crews. The sample's people cannot sign in; they are there
so every deal, target and follow-up has a name on it. Dates are written as days from the day the
sample is added, so its late follow-ups are late on any day. Where Inventory is installed, the
sample also brings ten stock lines, six suppliers and four orders on their way into it, posted by
Inventory itself. "Remove sample data" takes all of it away again.

## Running it

```bash
npm install
npm test            # the manifest, the screens' logic, the sample's figures (no browser)
npm run typecheck
npm run build       # the staff side, to dist/
```

### The stand: a real Adminium with the app and its sample

The browser specs and the proofs need a **built** Adminium checkout (`ADMINIUM_REPO`) and the
add-ons' checkout with Invoices & Receipts and Inventory built (`ADD_ONS_REPO`). When the checkout's
own version is older than the app's floor (a lane ahead of a release), stand it in with
`CRM_STAND_VERSION=0.3.29`.

```bash
ADD_ONS_REPO=~/path/to/add-ons npm run stand:up   # leave one running
npm run stand:down
```

The stand starts Adminium on `CRM_STAND_PORT` (4774 unless set), connects a database
(`CRM_STAND_ENGINE`: `sqlite`, `postgres` or `mysql`, with `TEST_POSTGRES_URL` / `TEST_MYSQL_URL`),
installs the app with every part on and loads the sample at its ledger's moment, Tuesday 28 July
2026, 09:35 London. It gives each sample person a password (`<name>@crm.test`; the password is in
`e2e/.stand/state.json`), which the product never does. `CRM_STAND_ADD_ONS=none` installs it without
Invoices and Inventory; `CRM_STAND_STAGE=3` installs a later stage. `CRM_STAND_MAIL=1` keeps every
mail the stand sends in a catcher (SMTP on the stand's port + 100; the mails as JSON at port + 101,
read by `mailbox()` in `e2e/stand.mjs`). Adminium never mails a `.example` or `.test` address, so in
mail mode the people are `<name>@crm.stand` and the sample's addresses end `.stand`.

### Specs and proofs

| | |
| --- | --- |
| `npm run e2e` | The staff side in a real browser on a fresh stand, signed in as the sample's people: every screen, its figures against what the server answers that person, the server's refusals, live updates between two people, Arabic, 390 wide, dark. `e2e/x-walk.e2e.ts` walks every menu line of every role the stand's stage offers (from stage 2 the field crew too), follows every link, asks the server to refuse each screen to somebody it is not for, and runs axe. Add `-- e2e/<file>.e2e.ts` for one file. |
| `npm run proofs` | The app installed on a whole Adminium server on SQLite, Postgres and MySQL, tried as each sample person: roles, rules, e-mails, the sample, the console. They run inside the Adminium checkout; see `proofs/README.md`. |
| `node scripts/untranslated.mjs --check` | No string waits for a translation. |

The tests check the manifest against Adminium's own validator, a copy of which is in
`src/testing/manifest/`; `node scripts/sync-manifest-validator.mjs` takes a fresh copy from
`ADMINIUM_REPO`.

## The app by stage

The app was released in stages: 0.2.0 was stage 1 (the first six parts); 0.2.1 is stage 3, every
part, and updates a 0.2.0 install with its data in place (the four new parts arrive switched off). `whole/` is the app with every stage, and the only place to edit a table, a
role, a page or the sample; `stage.json` says which parts each stage brings. After a change there:

```bash
npm run stage          # writes manifest.json and seeds/ for the released stage
npm run stage:check    # fails if they are not what whole/ derives
```

The sample is generated, never edited by hand: its rows come from the plan's generator, and the
figures the specs check are that generator's ledger.

## Project structure

```
whole/            the app with every stage: manifest.json and seeds/ (edit HERE)
stage.json        which parts each stage brings, and which stage is released
manifest.json     the released stage, cut from whole/ (do not edit by hand)
seeds/            the released stage's sample, cut the same way
src/
  app/ shell/     the staff side's start, the frame, the menus and who may open what
  screens/        one folder a screen group
  selling/ ui/    shared dialogs and parts
  customer/       the customer's quote page
  staffSession.ts the one client every screen reads and writes through
  lib/format.ts   every figure, day and time, in the reader's language and the install's currency
  i18n/           the eight languages
  testing/        the manifest's tests, and the vendored validator
e2e/              the stand, and the browser specs
proofs/           the app on a whole server, on three engines
reference/        the screens of the app's earlier version, kept to read; nothing builds them
scripts/          release, staging, validator sync, the translation ledger, the proofs' runner
```

## License

[AGPL-3.0](LICENSE) © 2026 Sales CRM. A demo shipped with Adminium.

## Building on this app with a coding agent

The Adminium skills teach Claude Code, Codex and other agents to build and change an app:
`npx skills add Adminiumjs/skills` — https://github.com/Adminiumjs/skills
