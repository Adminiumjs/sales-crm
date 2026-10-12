# Sales CRM

A sales app for [Adminium](https://adminium.dev): deals and quotes, accounts, the
sales team's own working papers, an inbox of enquiries, a showroom, jobs on site
and what comes after them, vehicles and crew.

> **This app is being rebuilt, and this branch holds its foundation: the tables,
> the roles, the rules and the sample data. It has no screens yet.** What you get
> after an install is a records page for each table, with the right rows for the
> person signed in. The screens come next.
>
> It asks for **Adminium 0.3.27, which is not released yet**, so no released
> Adminium installs it today.

## What installs

| | |
| --- | --- |
| Key | `crm` (tables are named `crm_…`) |
| Tables | 74 |
| Pages | 74, one records page per table, under ten menu headings |
| Roles | 9 |
| Shipped rules | 4, switched on at install |
| E-mails | 3, in eight languages |
| Starting rows | 1: the settings row, written by the install with its defaults. The sample fills in Meridian's depot on it, and takes it off again |
| Sample data | "Meridian", an office-furniture wholesaler: 688 rows in 69 tables, 16 people, one team |
| Languages | English, German, French, Danish, Czech, Egyptian Arabic, Simplified and Traditional Chinese |
| Databases | Postgres, MySQL, SQLite |

### It needs one add-on

**Invoices & Receipts** (1.0.12 or newer) is required: a quote is one of its
documents, so the add-on numbers it, works out its tax and prints it. The app
does not install without it.

Two more are suggested and not needed: **Inventory** (stock for a deal,
suppliers, what the showroom holds) and **Offers** (a reward for a customer who
refers another).

### The menu

| Heading | Tables |
| --- | --- |
| Selling | stages, deals and their history, follow-ups, activities, lost reasons, quotes and their lines, the price list, comments, saved views and searches, snoozed nudges, who else is on a deal, deal marks, site visits with their notes |
| Accounts | companies, contacts, territories and their places, renewals, referrals |
| The team | each rep's profile, targets, one-to-ones and their sessions, coaching plans and areas, actions, the weekly meeting, conversations, new starters, cover |
| Inbox | enquiries, shows |
| Showroom and samples | spaces, bookings, samples and their loans, display pieces |
| Jobs on site | jobs, crews, visits, sign-offs, snags, delivery notes, waste removals |
| After the job | feedback, complaints, warranty claims |
| Supply | the stock a deal waits for (of use only with Inventory) |
| Vehicles and crew | vehicles with their checks, faults and fuel, time sheets, certificates, subcontractors, insurance incidents |
| Setup | the app's settings, its outgoing e-mails |

### The nine roles

Each role is installed as `crm-<key>`. A person sees the pages of the tables
their role reads, and in each table only the rows that are theirs to see.

| Role | Key | In short |
| --- | --- | --- |
| CRM admin | `admin` | Everything except the private tables, other people's actions and other people's conversations |
| Sales manager | `sales-manager` | The deals, quotes and visits of the people they lead; approves a discount; sets targets and cover for their own people |
| Sales rep | `rep` | Their own deals and what hangs on them; companies and contacts; the job of a deal they won, to read |
| Account manager | `account-manager` | Companies and contacts; a deal only once it is won; renewals, referrals, aftercare |
| Marketer | `marketer` | Enquiries, shows, companies; contacts with address and phone masked; no deal and no amount |
| Front desk | `front-desk` | The showroom diary, samples, enquiries; makes a contact for a visitor; no deal |
| Operations manager | `ops-manager` | Jobs, crews, visits, vehicles, time sheets; no deal, company or contact |
| Field crew | `crew` | Their own crew's visits, with the site's address copied onto each; their own time sheet and certificates |
| Read-only | `read-only` | Reads and exports; nothing private, no actions, no conversations |

How a row comes to be somebody's:

- **By its own person.** A deal belongs to its owner. A sales manager also reaches
  the rows of the people in a team they lead.
- **By being listed.** Somebody added to a deal as a helper reaches it. Somebody
  listed as cover for a rep reaches that rep's deals between the cover's two
  dates, and not a day longer. The deal's owner does not change in either case,
  and neither a helper nor a cover can change it.
- **Through its parent.** Whoever reaches a deal reaches its activities, quotes
  and comments. A note or a comment is changed only by the person who wrote
  it, or by their manager. A fitter reaches the visits of their own crew.
- **Private.** Four tables (one-to-ones, their sessions, coaching plans, coaching
  areas) are read by the manager and the rep of the row and by nobody else: not
  the CRM admin, not Read-only, not a Super Admin. They are never exported.

Roles add up: a person who holds two roles reaches what either one reaches.

### What Adminium keeps for you

- **A deal's amount** is the total of its newest quote that was sent. With no
  sent quote it is the figure typed on the deal. A version that is approved and
  not yet sent counts for nothing.
- **A deal's weighted value** is its amount times the odds of its stage, and
  follows both.
- **A quote's list value and how far under list it stands.** A line's list price
  comes from the price list, which a rep reads and cannot write.
- **A discount needs approval** when the quote is further under list than the
  setting allows (5 % at install), or when a line has no list price at all. Such
  a quote cannot be sent until a sales manager approves it. The approval
  remembers what it covered: a quote made cheaper afterwards has to be asked
  again.
- **A job cannot be signed off** without a sign-off, nor while a snag that stops
  sign-off is open.
- **A closed deal is locked**, except for its closing note and its lost reason.

### The four rules

They are switched on at install. A rule set off by a person's change runs about
a minute later, after the time in which that change can still be undone.

1. A deal is made: it gets its mark (the one line colleagues may read about it)
   and the first line of its history.
2. A deal changes stage: a line in its history.
3. A deal is won: its job is made, once.
4. A discount is put to approval: everybody who holds the Sales manager role is
   told.

### The sample data

"Add sample data" brings Meridian's pipeline: 40 deals (14 open, 8 won, 18
lost), nine quotes, eight jobs, and sixteen people in the nine roles with the
team "Sales". The sample's people cannot sign in; they are there so that every
deal, target and follow-up has a name on it. "Remove sample data" takes the rows
and the people away again.

Dates are written as days from the day the sample is added, so the three late
follow-ups are late on any day.

Where Inventory is installed, the sample also brings Meridian's goods into it:
ten stock lines, six suppliers and the depot, and which open deal waits for which
line. Nothing of the stock is typed. The sample asks Inventory to post an
opening receipt and to send four orders, so what is on hand, what it cost and
what is on order are Inventory's own figures, and "Remove sample data" takes
them out again.

## What cannot be taken twice

A showroom space is booked once for a time: a second tentative or confirmed
booking that overlaps the first is refused, and a cancelled one frees its time.
A job visit is not booked on a weekday its crew does not work (the days are a
short list per crew, Monday to Friday in the sample). A crew may do several
visits on a day it works, and a crew with no days written down is held to none.

## What does not work yet

- **No screens.** The staff side shows one "being rebuilt" page. `reference/`
  holds the screens the app had before the rebuild; nothing builds, tests or
  ships that folder.
- **Every part is always on.** Showroom, jobs, aftercare, supply and vehicles
  are meant to be parts an owner can leave out at install.
- **The role names are English** in every language.
- **A new quote is numbered `QUO-0001`** until the owner changes the series in
  Invoices & Receipts.
- **Most reminders and digests are not shipped**: the three nudges on a quiet
  deal, the weekly digests, a follow-up falling due, a quote about to run out,
  a mention, the aftercare call after a sign-off, the survey after a job.
- **A limited list is slower than an unlimited one on MySQL**: about a tenth of
  a second for a page of 50 among 50,000 deals.

### If you remove the app and keep its tables

The four private tables stay private. An owner who uninstalls the CRM and keeps
its data does not open the one-to-ones to everybody by doing so.

## Local development

```bash
npm install
```

```bash
npm test
```

```bash
npm run build
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server (the staff side's one page). |
| `npm run build` | Type-check and build to `dist/`. |
| `npm run build:surface` | Build the staff side as Adminium serves it, to `dist-surface/crm/staff/`. |
| `npm test` | The manifest's own tests: tables, roles, states, rules, quotes, the sample's figures. |
| `npm run typecheck` | Type-check only. |

The tests check the manifest against Adminium's own validator, a copy of which
is in `src/testing/manifest/`. `node scripts/sync-manifest-validator.mjs --check`
says whether that copy is current; it needs `ADMINIUM_REPO` to point at an
Adminium checkout.

## Project structure

```
manifest.json     the app: tables, roles, pages, rules, e-mails, the sample's people
seeds/            the sample data (generated; do not edit by hand)
src/
  app/            the staff side's one page
  i18n/           the eight languages
  testing/        the manifest's tests, and the vendored validator
reference/        the screens from before the rebuild (not built)
scripts/          release, validator sync, the translation ledger
```

## License

[AGPL-3.0](LICENSE) © 2026 Sales CRM. A demo shipped with Adminium.

## Building on this app with a coding agent

The Adminium skills teach Claude Code, Codex and other agents to build and change an app:
`npx skills add Adminiumjs/skills` — https://github.com/Adminiumjs/skills
