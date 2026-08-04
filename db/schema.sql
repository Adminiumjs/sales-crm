-- Sales CRM — PostgreSQL schema (manifest §requiredSchema contract).
--
-- This is the real database behind the full self-host stack: the sales
-- workspace reads it (through Adminium's records API) and the auto-generated
-- Adminium dashboard is the back office that runs it. Applied automatically on
-- first boot of the `crm-db` container via
-- /docker-entrypoint-initdb.d/01-schema.sql, then seeded by 02-seed.sql. The
-- seed mirrors src/data/demo.ts one-for-one — the same nine companies, the same
-- fourteen open deals, the same eight closed ones, the same thirty-two activity
-- entries — so the workspace and the dashboard show the same pipeline.
--
-- Eight tables. The split is deliberate: the workspace owns the rep's day, the
-- generated dashboard owns the records.
--
-- Nothing is stored pre-computed. There is no weighted-total column and no
-- "is stale" flag, because a stored total is a total that goes stale the moment
-- a card moves; both are derived from `stages.probability` and
-- `deals.stage_entered_at` on read, exactly as src/lib/pipeline.ts derives them.
--
-- Money is numeric(12, 2) — never a float, because a float is a rounding error
-- with a deal name attached. Calendar days (`expected_close`, `closed_on`) are
-- `date`; anything that happened at a moment is `timestamptz`.

DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS activities CASCADE;
DROP TABLE IF EXISTS deals CASCADE;
DROP TABLE IF EXISTS stages CASCADE;
DROP TABLE IF EXISTS pipelines CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS companies CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- People ---------------------------------------------------------------------

-- The sales team. `initials` and `tint` drive the avatar the workspace renders
-- when `avatar` is empty, so both are required — the app ships no bitmaps.
-- `role` is the persona split: a rep sees their own deals, a manager sees the
-- team's. It is not an Adminium access preset; those live in the manifest.
CREATE TABLE users (
  id         serial PRIMARY KEY,
  name       text        NOT NULL,
  email      text        NOT NULL UNIQUE,
  initials   text        NOT NULL,
  avatar     text        NOT NULL DEFAULT '',
  tint       text        NOT NULL DEFAULT '#4f46e5',
  role       text        NOT NULL DEFAULT 'rep' CHECK (role IN ('rep', 'manager')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Accounts -------------------------------------------------------------------

-- `industry` is a closed list rather than open text so the dashboard can filter
-- and group on it without a lookup table nobody would ever maintain.
-- `since_note` and `note` are the two lines a rep actually reads before a call:
-- how long we have known them, and what it is like to sell to them.
CREATE TABLE companies (
  id         serial PRIMARY KEY,
  name       text        NOT NULL,
  domain     text        NOT NULL DEFAULT '',
  industry   text        NOT NULL
                         CHECK (industry IN ('law', 'health', 'data', 'freight', 'film',
                                             'grocery', 'accountancy', 'robotics', 'aerospace')),
  city       text        NOT NULL DEFAULT '',
  headcount  integer     NOT NULL DEFAULT 0 CHECK (headcount >= 0),
  initials   text        NOT NULL,
  tint       text        NOT NULL DEFAULT '#4f46e5',
  icon       text        NOT NULL DEFAULT 'building-2',
  since_note text        NOT NULL DEFAULT '',
  note       text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX companies_industry_idx ON companies (industry);
CREATE INDEX companies_name_idx     ON companies (name);

-- A person always belongs to a company — a contact with no account is a lead,
-- and leads are not in this version. Deleting the company takes its people.
CREATE TABLE contacts (
  id         serial PRIMARY KEY,
  company_id integer     NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name       text        NOT NULL,
  email      text        NOT NULL UNIQUE,
  phone      text        NOT NULL DEFAULT '',
  title      text        NOT NULL DEFAULT '',
  initials   text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contacts_company_idx ON contacts (company_id);
CREATE INDEX contacts_name_idx    ON contacts (name);

-- Pipeline shape -------------------------------------------------------------

-- One pipeline ships. The table exists because the second one always arrives,
-- and adding it later without this table means rewriting every deal query.
CREATE TABLE pipelines (
  id   serial PRIMARY KEY,
  name text   NOT NULL
);

-- `probability` is the weighting factor, held as whole percent so a human can
-- edit it without thinking about decimals. The workspace divides by 100.
-- `position` is unique inside a pipeline: two stages cannot both be third, or
-- the board columns would render in an order the database cannot defend.
CREATE TABLE stages (
  id          serial PRIMARY KEY,
  pipeline_id integer NOT NULL REFERENCES pipelines (id) ON DELETE CASCADE,
  name        text    NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  probability integer NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  UNIQUE (pipeline_id, position)
);

CREATE INDEX stages_pipeline_idx ON stages (pipeline_id);

-- The pipeline ---------------------------------------------------------------

-- A deal keeps its stage even after it closes: "won from Negotiation" is worth
-- knowing, and blanking the stage on close would throw the funnel away.
--
-- The ON DELETE choices are all deliberate:
--   company  RESTRICT — you cannot delete an account that still owes you money
--   contact  SET NULL — people leave; the deal carries on without them
--   stage    RESTRICT — deleting a stage with deals in it would orphan a column
--   owner    RESTRICT — reassign the deals first, then remove the rep
--
-- `stage_entered_at` is the staleness clock. It is NOT `updated_at`: a deal can
-- be edited every day and still be rotting in the same stage, which is exactly
-- the thing a manager needs to see.
CREATE TABLE deals (
  id               serial PRIMARY KEY,
  name             text        NOT NULL,
  company_id       integer     NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  contact_id       integer              REFERENCES contacts  (id) ON DELETE SET NULL,
  stage_id         integer     NOT NULL REFERENCES stages    (id) ON DELETE RESTRICT,
  amount           numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency         text        NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  expected_close   date,
  status           text        NOT NULL DEFAULT 'open'
                               CHECK (status IN ('open', 'won', 'lost')),
  lost_reason      text        NOT NULL DEFAULT '',
  owner_id         integer     NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  scope            text        NOT NULL DEFAULT '',
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  closed_on        date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- A reason belongs to a loss. An open deal carrying "Budget pulled" is a
  -- data-entry accident, and the funnel would quietly believe it.
  CONSTRAINT deals_lost_reason_only_when_lost
    CHECK (lost_reason = '' OR status = 'lost'),

  -- Closed means closed on a day. Open means no close date yet. Both halves
  -- matter: without the second, a reopened deal keeps a stale closing date and
  -- the won-per-month chart counts it twice.
  CONSTRAINT deals_closed_on_matches_status
    CHECK ((status = 'open' AND closed_on IS NULL)
        OR (status <> 'open' AND closed_on IS NOT NULL))
);

CREATE INDEX deals_company_idx        ON deals (company_id);
CREATE INDEX deals_contact_idx        ON deals (contact_id);
CREATE INDEX deals_owner_idx          ON deals (owner_id);
CREATE INDEX deals_stage_idx          ON deals (stage_id);
CREATE INDEX deals_status_idx         ON deals (status);
CREATE INDEX deals_expected_close_idx ON deals (expected_close);
CREATE INDEX deals_closed_on_idx      ON deals (closed_on);
-- The board's own query: open deals, grouped by column, oldest arrival first.
CREATE INDEX deals_open_stage_idx     ON deals (stage_id, stage_entered_at) WHERE status = 'open';

-- What happened, and what happens next ---------------------------------------

-- One timeline per deal, merged from calls, e-mails, meetings, notes and stage
-- changes — the workspace does not keep a separate notes table, because a note
-- and a call are the same shape and reading them apart is the reader's job, not
-- the schema's.
--
-- `due_at` and `done` are here for an activity scheduled ahead of time; the
-- standing follow-up queue lives in `tasks`. Logged history is `done = true`
-- with a null `due_at`.
CREATE TABLE activities (
  id         serial PRIMARY KEY,
  deal_id    integer     NOT NULL REFERENCES deals (id) ON DELETE CASCADE,
  type       text        NOT NULL
                         CHECK (type IN ('call', 'email', 'meeting', 'note', 'stage_change')),
  summary    text        NOT NULL,
  due_at     timestamptz,
  done       boolean     NOT NULL DEFAULT true,
  created_by integer              REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activities_deal_idx    ON activities (deal_id, created_at DESC);
CREATE INDEX activities_type_idx    ON activities (type);
CREATE INDEX activities_created_idx ON activities (created_at DESC);

-- The follow-up queue. `deal_id` is nullable on purpose: "call the trade show
-- back" is a real task with no deal behind it yet, and a deal that gets deleted
-- should leave the reminder standing rather than take it down silently.
CREATE TABLE tasks (
  id       serial PRIMARY KEY,
  deal_id  integer          REFERENCES deals (id) ON DELETE SET NULL,
  title    text    NOT NULL,
  due_at   timestamptz,
  done     boolean NOT NULL DEFAULT false,
  owner_id integer NOT NULL REFERENCES users (id) ON DELETE RESTRICT
);

CREATE INDEX tasks_deal_idx  ON tasks (deal_id);
CREATE INDEX tasks_owner_idx ON tasks (owner_id);
-- The queue opens overdue-first, so the index it wants is the open ones by date.
CREATE INDEX tasks_open_due_idx ON tasks (due_at) WHERE done = false;
