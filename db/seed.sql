-- Sales CRM — seed data.
--
-- Mirrors src/data/demo.ts one-for-one: the same four reps and one manager, the
-- same nine companies and thirteen people, the same fourteen open deals and
-- eight closed ones, the same seven follow-ups and thirty-two activity entries.
-- Run the workspace and the generated dashboard side by side and they show the
-- same pipeline — the same amounts, the same stages, the same overdue queue.
--
-- Dates are the app's pinned clock, not today's: "now" is Tuesday 28 July 2026,
-- 09:35, so three follow-ups are already overdue and two deals are visibly
-- stale in both places. Times are written in UTC because the demo stack runs
-- there; the workspace reads the same wall-clock values.
--
-- Prose that demo.ts stores as an i18n key — deal names, scopes, sectors, the
-- account notes, the activity bodies — is written here in English, resolved
-- from src/i18n/strings/data.ts. A database holds content, not message keys.
--
-- Primary keys are explicit integers so every foreign key below is stable and
-- readable; the sequences are reset with setval at the bottom, so the first row
-- a user creates in the dashboard lands after the seed instead of colliding
-- with it.
--
-- Everything here is demo fiction: Meridian is a made-up office-furniture
-- wholesaler, and every person, address and figure is a prop.

BEGIN;

-- The team -------------------------------------------------------------------

INSERT INTO users (id, name, email, initials, tint, role, created_at) VALUES
  (1, 'Dana Whitlock', 'dana.whitlock@meridian.example', 'DW', '#4f46e5', 'rep',     '2026-01-05 09:00+00'),
  (2, 'Priya Raman',   'priya.raman@meridian.example',   'PR', '#0d9488', 'rep',     '2026-01-05 09:00+00'),
  (3, 'Sam Okonjo',    'sam.okonjo@meridian.example',    'SO', '#e11d48', 'rep',     '2026-01-05 09:00+00'),
  (4, 'Leo Vance',     'leo.vance@meridian.example',     'LV', '#b25e09', 'rep',     '2026-02-16 09:00+00'),
  (5, 'Ivy Sandoval',  'ivy.sandoval@meridian.example',  'IS', '#7c3aed', 'manager', '2026-01-05 09:00+00');

-- Accounts -------------------------------------------------------------------

-- `created_at` is the earlier of the month named in `since_note` and the day
-- the account's oldest deal opened — an account cannot be younger than its own
-- history.
INSERT INTO companies (id, name, domain, industry, city, headcount, initials, tint, icon, since_note, note, created_at) VALUES
  (1, 'Cobalt Legal', 'cobaltlegal.example', 'law', 'Leeds', 140, 'CL', '#4f46e5', 'scale',
   'Customer since March 2026',
   'Two floors done last spring. Ines runs a tight process and expects drawings before she talks numbers.',
   '2026-03-01 09:00+00'),

  (2, 'Fernway Clinics', 'fernwayclinics.example', 'health', 'Bristol', 320, 'FC', '#0d9488', 'stethoscope',
   'Customer since February 2026',
   'Nine sites, rolling refurbishment. Everything goes through estates and everything needs a wipe-clean finish.',
   '2026-02-01 09:00+00'),

  (3, 'Juno Analytics', 'junoanalytics.example', 'data', 'Manchester', 85, 'JA', '#1c59e0', 'chart-no-axes-column',
   'In conversation since May 2026',
   'Growing fast and short on quiet space. Owen decides, Kit owns the detail.',
   '2026-05-01 09:00+00'),

  (4, 'Nordwind Logistics', 'nordwind.example', 'freight', 'Hull', 1200, 'NL', '#b25e09', 'truck',
   'Customer since January 2026',
   'Warehouse offices first, head office next. Petra buys on durability, not looks.',
   '2026-01-01 09:00+00'),

  (5, 'Veldt Studios', 'veldtstudios.example', 'film', 'Glasgow', 60, 'VS', '#7c3aed', 'clapperboard',
   'Customer since May 2026',
   'Acoustics matter more than anything else here. Marta will trade finish for silence.',
   '2026-05-01 09:00+00'),

  (6, 'Brightloom Foods', 'brightloom.example', 'grocery', 'Birmingham', 2400, 'BF', '#e11d48', 'shopping-basket',
   'In conversation since April 2026',
   'Long approval chain. Ruth is on side; the property committee meets monthly.',
   '2026-03-11 09:00+00'),

  (7, 'Harbor & Finch', 'harborfinch.example', 'accountancy', 'Edinburgh', 210, 'HF', '#2563eb', 'briefcase',
   'In conversation since June 2026',
   'Partners each want a say. Sadie keeps the list and tells us the truth.',
   '2026-06-01 09:00+00'),

  (8, 'Tandem Robotics', 'tandemrobotics.example', 'robotics', 'Cambridge', 95, 'TR', '#0891b2', 'bot',
   'Customer since April 2026',
   'Lab first, offices later. Height-adjustable everything, and it has to take a knock.',
   '2026-04-01 09:00+00'),

  (9, 'Low Orbit', 'loworbit.example', 'aerospace', 'Reading', 45, 'LO', '#a95800', 'satellite',
   'In conversation since June 2026',
   'One big room and regretting it. Bea wants pods in before the new intake starts.',
   '2026-04-27 09:00+00');

INSERT INTO contacts (id, company_id, name, email, phone, title, initials, created_at) VALUES
  (1,  1, 'Ines Vaughan',     'ines.vaughan@cobaltlegal.example', '0113 496 0182', 'Operations Director',  'IV', '2026-03-01 09:00+00'),
  (2,  1, 'Tomas Reidy',      't.reidy@cobaltlegal.example',      '0113 496 0190', 'Facilities Lead',      'TR', '2026-03-01 09:00+00'),
  (3,  2, 'Ana Belova',       'a.belova@fernwayclinics.example',  '0117 302 4418', 'Estates Manager',      'AB', '2026-02-01 09:00+00'),
  (4,  3, 'Owen Marsh',       'owen@junoanalytics.example',       '0161 884 7723', 'Head of Workplace',    'OM', '2026-05-01 09:00+00'),
  (5,  3, 'Kit Delaney',      'kit@junoanalytics.example',        '0161 884 7730', 'Office Manager',       'KD', '2026-05-01 09:00+00'),
  (6,  4, 'Petra Lindqvist',  'p.lindqvist@nordwind.example',     '01482 55 0913', 'Head of Facilities',   'PL', '2026-01-01 09:00+00'),
  (7,  4, 'Jonas Reuter',     'j.reuter@nordwind.example',        '01482 55 0940', 'Depot Manager',        'JR', '2026-01-01 09:00+00'),
  (8,  5, 'Marta Kovac',      'marta@veldtstudios.example',       '0141 662 8804', 'Studio Manager',       'MK', '2026-05-01 09:00+00'),
  (9,  6, 'Ruth Adeyemi',     'r.adeyemi@brightloom.example',     '0121 774 3355', 'Retail Projects Lead', 'RA', '2026-03-11 09:00+00'),
  (10, 7, 'Sadie Moore',      's.moore@harborfinch.example',      '0131 208 6641', 'Practice Manager',     'SM', '2026-06-01 09:00+00'),
  (11, 7, 'Callum Finch',     'c.finch@harborfinch.example',      '0131 208 6600', 'Partner',              'CF', '2026-06-01 09:00+00'),
  (12, 8, 'Yusuf Demir',      'yusuf@tandemrobotics.example',     '01223 47 1108', 'Lab Operations',       'YD', '2026-04-01 09:00+00'),
  (13, 9, 'Bea Nolan',        'bea@loworbit.example',             '0118 990 2277', 'Chief of Staff',       'BN', '2026-04-27 09:00+00');

-- Pipeline shape -------------------------------------------------------------

INSERT INTO pipelines (id, name) VALUES
  (1, 'New business');

-- The five stages the workspace ships, in order. `probability` is the same
-- weighting the board applies, held as whole percent: 0.1 becomes 10.
INSERT INTO stages (id, pipeline_id, name, position, probability) VALUES
  (1, 1, 'Discovery',   1, 10),
  (2, 1, 'Qualified',   2, 25),
  (3, 1, 'Proposal',    3, 50),
  (4, 1, 'Negotiation', 4, 75),
  (5, 1, 'Verbal',      5, 90);

-- The open pipeline ----------------------------------------------------------

-- Fourteen live deals. `stage_entered_at` is the date each card arrived in its
-- current column — the two that arrived in June are the ones the manager's
-- "going stale" list picks up against the pinned clock.
INSERT INTO deals
  (id, name, company_id, contact_id, stage_id, amount, currency, expected_close, status, owner_id, scope, stage_entered_at, created_at) VALUES
  (1,  'Fourth-floor desk rows',              4, 6,  4, 48000.00, 'USD', '2026-08-14', 'open', 1,
   '46 bench desks, cable trays, two supervisor stations', '2026-07-14 00:00+00', '2026-05-12 00:00+00'),
  (2,  'Acoustic booths for the studio floor', 5, 8,  3, 27500.00, 'USD', '2026-08-21', 'open', 1,
   'Six single booths, two four-person rooms',             '2026-07-08 00:00+00', '2026-06-02 00:00+00'),
  (3,  'Records-room lockers',                 1, 1,  5, 16800.00, 'USD', '2026-07-31', 'open', 1,
   'Ninety lockers, keypad locks, records-room fit',       '2026-07-24 00:00+00', '2026-06-18 00:00+00'),
  (4,  'Clinic waiting-room seating',          2, 3,  2, 12400.00, 'USD', '2026-09-04', 'open', 2,
   'Wipe-clean bench seating for four sites',              '2026-07-21 00:00+00', '2026-06-30 00:00+00'),
  (5,  'Showroom refit, phase one',            6, 9,  3, 34000.00, 'USD', '2026-09-11', 'open', 3,
   'Front-of-house refit, two showrooms',                  '2026-06-26 00:00+00', '2026-05-20 00:00+00'),
  (6,  'Analyst pods, second floor',           3, 4,  4, 21600.00, 'USD', '2026-07-30', 'open', 1,
   'Twelve two-person pods with acoustic backs',           '2026-07-17 00:00+00', '2026-06-09 00:00+00'),
  (7,  'Task seating refresh',                 7, 10, 1,  9750.00, 'USD', '2026-09-30', 'open', 4,
   'Sixty task chairs across two floors',                  '2026-07-25 00:00+00', '2026-07-20 00:00+00'),
  (8,  'Lab bench stools',                     8, 12, 2,  6300.00, 'USD', '2026-09-04', 'open', 2,
   'Height-adjustable stools for the test floor',          '2026-07-09 00:00+00', '2026-06-24 00:00+00'),
  (9,  'Quiet-room pods',                      9, 13, 3, 18900.00, 'USD', '2026-08-18', 'open', 1,
   'Four pods and a two-person meeting room',              '2026-07-22 00:00+00', '2026-06-26 00:00+00'),
  (10, 'Reception desk and lounge',            1, 2,  1, 23400.00, 'USD', '2026-10-16', 'open', 3,
   'Ground-floor reception, lounge seating',               '2026-07-27 00:00+00', '2026-07-22 00:00+00'),
  (11, 'Canteen benches and stools',           6, 9,  5,  7800.00, 'USD', '2026-07-31', 'open', 2,
   'Depot canteen, sixty covers',                          '2026-07-23 00:00+00', '2026-06-15 00:00+00'),
  (12, 'Depot supervisor stations',            4, 7,  2, 14250.00, 'USD', '2026-09-25', 'open', 4,
   'Eight standing stations, three depots',                '2026-06-24 00:00+00', '2026-05-28 00:00+00'),
  (13, 'Edit-suite chairs',                    5, 8,  1,  3200.00, 'USD', '2026-08-20', 'open', 1,
   'Eight chairs for the grading suites',                  '2026-07-26 00:00+00', '2026-07-16 00:00+00'),
  (14, 'Partner-office fit-out',               7, 11, 4, 31000.00, 'USD', '2026-08-12', 'open', 3,
   'Eleven partner offices, desks and storage',            '2026-07-19 00:00+00', '2026-05-06 00:00+00');

-- Closed history — five won, three lost, so win rate and average cycle compute
-- from real rows rather than a hard-coded number. A closed deal keeps the stage
-- it died in; the three losses did not all get the same distance, and the
-- funnel is more honest for saying so.
INSERT INTO deals
  (id, name, company_id, contact_id, stage_id, amount, currency, expected_close, status, lost_reason, owner_id, stage_entered_at, closed_on, created_at) VALUES
  (15, 'Legal library shelving',  1, NULL, 5, 19500.00, 'USD', '2026-04-28', 'won',  '',                            1, '2026-04-28 00:00+00', '2026-04-28', '2026-03-03 00:00+00'),
  (16, 'Ward corridor seating',   2, NULL, 5, 11200.00, 'USD', '2026-04-09', 'won',  '',                            2, '2026-04-09 00:00+00', '2026-04-09', '2026-02-21 00:00+00'),
  (17, 'Warehouse office desks',  4, NULL, 5, 26400.00, 'USD', '2026-03-26', 'won',  '',                            3, '2026-03-26 00:00+00', '2026-03-26', '2026-01-14 00:00+00'),
  (18, 'Studio meeting tables',   5, NULL, 5,  8900.00, 'USD', '2026-06-12', 'won',  '',                            1, '2026-06-12 00:00+00', '2026-06-12', '2026-05-02 00:00+00'),
  (19, 'Test-floor workbenches',  8, NULL, 5, 15600.00, 'USD', '2026-06-03', 'won',  '',                            4, '2026-06-03 00:00+00', '2026-06-03', '2026-04-08 00:00+00'),
  (20, 'Head-office chairs',      6, NULL, 3, 22000.00, 'USD', '2026-05-15', 'lost', 'Lost on timing',              3, '2026-05-15 00:00+00', '2026-05-15', '2026-03-11 00:00+00'),
  (21, 'Mezzanine hot desks',     9, NULL, 4, 13700.00, 'USD', '2026-06-30', 'lost', 'Went with another supplier',  2, '2026-06-30 00:00+00', '2026-06-30', '2026-04-27 00:00+00'),
  (22, 'Archive shelving',        7, NULL, 2,  5400.00, 'USD', '2026-07-20', 'lost', 'Budget pulled',               1, '2026-07-20 00:00+00', '2026-07-20', '2026-06-01 00:00+00');

-- What happened --------------------------------------------------------------

-- Thirty-two entries, exactly the set the deal rooms render. Logged history is
-- `done = true` with no `due_at` — what is still to come lives in `tasks`.
INSERT INTO activities (id, deal_id, type, summary, created_by, created_at) VALUES
  (1,  3,  'call',         'Ines said the verbal is firm. Order goes to their finance today, signed copy back this week.',      1, '2026-07-28 09:05+00'),
  (2,  6,  'email',        'Sent revised terms with the two-year care package folded in. Owen wants a walkthrough before he signs.', 1, '2026-07-27 17:40+00'),
  (3,  1,  'stage_change', 'Moved to Negotiation. Petra has the layout and one open question on delivery windows.',              1, '2026-07-14 11:20+00'),
  (4,  1,  'meeting',      'Site walk with Petra and Jonas. Standing desks for the two supervisor stations, rest stays as drawn.', 1, '2026-07-23 14:00+00'),
  (5,  1,  'note',         'Petra is away Friday. Layout goes out today so she has it when she is back.',                        1, '2026-07-24 09:15+00'),
  (6,  2,  'call',         'Marta is torn between six singles and four singles plus a bigger room. Costed both.',                1, '2026-07-21 10:30+00'),
  (7,  2,  'email',        'Proposal sent. Two options, acoustic ratings on both, install over a weekend.',                      1, '2026-07-08 16:05+00'),
  (8,  9,  'email',        'Proposal to Bea. Four pods, one meeting room, in before the September intake.',                      1, '2026-07-22 09:50+00'),
  (9,  9,  'call',         'Bea has read it. Wants to know about the ventilation before she takes it to her CEO.',               1, '2026-07-26 13:10+00'),
  (10, 13, 'note',         'Sample chair went out Thursday. Chase the studio to confirm it arrived.',                            1, '2026-07-26 08:40+00'),
  (11, 13, 'stage_change', 'Opened as Discovery off the back of the booths conversation.',                                       1, '2026-07-26 08:35+00'),
  (12, 5,  'email',        'Proposal in with Ruth. She is taking it to the property committee.',                                 3, '2026-06-26 15:30+00'),
  (13, 5,  'note',         'Committee slipped to August. Nothing wrong with the numbers, just the calendar.',                    3, '2026-07-17 11:00+00'),
  (14, 12, 'call',         'Jonas confirmed eight stations across three depots. Waiting on his capital sign-off.',               4, '2026-06-24 14:20+00'),
  (15, 12, 'note',         'No word since. Chased twice by email.',                                                             4, '2026-07-15 10:05+00'),
  (16, 14, 'meeting',      'Partner meeting. Eleven offices agreed, two want a different desk finish.',                          3, '2026-07-19 09:30+00'),
  (17, 14, 'stage_change', 'Moved to Negotiation. Sadie is collecting the finish choices.',                                      3, '2026-07-19 11:45+00'),
  (18, 14, 'email',        'Finish samples posted to Edinburgh. Callum wants the order placed before the August break.',         3, '2026-07-27 08:20+00'),
  (19, 4,  'call',         'Ana walked me through the four sites. Wipe-clean is non-negotiable, budget is per site.',            2, '2026-07-21 15:00+00'),
  (20, 4,  'note',         'Sending the healthcare range only. Anything with fabric arms is a waste of her time.',               2, '2026-07-24 12:30+00'),
  (21, 8,  'email',        'Yusuf has the quote. Stools need to take a knock and go up to 850mm.',                               2, '2026-07-09 11:15+00'),
  (22, 11, 'call',         'Ruth said yes on the canteen. Paperwork follows the showroom decision.',                             2, '2026-07-23 16:40+00'),
  (23, 10, 'meeting',      'First look at the reception space with Tomas. Wants a desk that hides the cabling.',                 3, '2026-07-27 10:00+00'),
  (24, 7,  'call',         'Sadie counted sixty chairs past their best. Trial set of three agreed.',                             4, '2026-07-25 09:45+00'),
  (25, 3,  'meeting',      'Records-room measure-up. Ninety lockers fit with room for the trolley.',                             1, '2026-07-24 11:00+00'),
  (26, 6,  'stage_change', 'Moved to Negotiation after Owen asked for terms.',                                                   1, '2026-07-17 09:00+00'),
  (27, 2,  'note',         'Marta is off site until Monday. Call her first thing.',                                              1, '2026-07-25 16:20+00'),
  (28, 11, 'stage_change', 'Moved to Verbal. Ruth confirmed on the call.',                                                       2, '2026-07-23 16:55+00'),
  (29, 5,  'call',         'Ruth is still keen. Asked me to hold the numbers until the committee sits.',                         3, '2026-07-24 10:15+00'),
  (30, 1,  'email',        'Nudged Petra on the layout. Out of office until Tuesday.',                                           1, '2026-07-27 15:10+00'),
  (31, 8,  'note',         'Yusuf is comparing us against one other supplier. Price is close.',                                  2, '2026-07-20 13:40+00'),
  (32, 9,  'stage_change', 'Moved to Proposal.',                                                                                 1, '2026-07-22 09:45+00');

-- What happens next ----------------------------------------------------------

-- Seven follow-ups. The first three fall before the pinned clock, which is why
-- the queue opens overdue-first in both the workspace and the dashboard.
INSERT INTO tasks (id, deal_id, title, due_at, done, owner_id) VALUES
  (1, 1,  'Send the revised layout with the standing-desk swap', '2026-07-24 16:00+00', false, 1),
  (2, 2,  'Call Marta about the booth count',                    '2026-07-27 11:00+00', false, 1),
  (3, 13, 'Confirm the sample chair landed',                     '2026-07-27 15:30+00', false, 1),
  (4, 3,  'Verbal is in. Chase the signed order',                '2026-07-28 10:00+00', false, 1),
  (5, 6,  'Walk Owen through the revised terms',                 '2026-07-28 14:00+00', false, 1),
  (6, 9,  'Proposal follow-up call',                             '2026-07-29 09:30+00', false, 1),
  (7, 1,  'Agree the delivery window with facilities',           '2026-07-30 11:00+00', false, 1);

-- Derived, not typed in: a deal was last touched when its newest activity
-- landed, or when it entered its stage if nothing has been logged since.
UPDATE deals d
   SET updated_at = GREATEST(
         d.stage_entered_at,
         COALESCE((SELECT max(a.created_at) FROM activities a WHERE a.deal_id = d.id),
                  d.stage_entered_at));

-- Hand-written ids stop here; the sequences pick up from the next unused id
-- so a row created in the dashboard cannot collide with the seed.
SELECT setval(pg_get_serial_sequence('users',      'id'), (SELECT max(id) FROM users));
SELECT setval(pg_get_serial_sequence('companies',  'id'), (SELECT max(id) FROM companies));
SELECT setval(pg_get_serial_sequence('contacts',   'id'), (SELECT max(id) FROM contacts));
SELECT setval(pg_get_serial_sequence('pipelines',  'id'), (SELECT max(id) FROM pipelines));
SELECT setval(pg_get_serial_sequence('stages',     'id'), (SELECT max(id) FROM stages));
SELECT setval(pg_get_serial_sequence('deals',      'id'), (SELECT max(id) FROM deals));
SELECT setval(pg_get_serial_sequence('activities', 'id'), (SELECT max(id) FROM activities));
SELECT setval(pg_get_serial_sequence('tasks',      'id'), (SELECT max(id) FROM tasks));

COMMIT;
