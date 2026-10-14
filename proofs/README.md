# The proofs

The test files below install this app on a real Adminium server, with its sample, on SQLite,
Postgres and MySQL, and try it signed in as each of the sample's sixteen people.

They are not this repository's unit tests. They run **inside an Adminium checkout**, because
they start the whole server in one process and reach into its modules to do the one thing the
product does not: give a sample person a password. `npm run proofs` copies them into
`$ADMINIUM_REPO/apps/server/test/` as `zz-crm-*.test.ts`, runs them there, and removes them.

| File | What it proves |
|---|---|
| `crm-install` | every table installs and takes the writes its rules allow |
| `crm-sample` | the sample loads with the figures of the ledger; every sample deal keeps the stage it was last written at, so its first move names the stage it left |
| `crm-roles` | every table read as each person; who may write what; each refusal is the server's |
| `crm-rules` | the shipped rules run by themselves |
| `crm-f21` | the rules and e-mails of stage 1: a deal's stage history line by line, also when it moves three and five times before the rules run (the deal as it was, decision 131); where a notice opens; a visit booked, moved and cancelled mailed to its contact on all three engines, each naming the rep who comes and never their address; a referral thanked; a rep's week and a manager's team's, with sums and target cover; a mention that names the deal only to somebody who can open it |
| `crm-inventory` | Supply on the real Inventory add-on (needs `ADD_ONS_REPO`, built) |
| `crm-g3` | the pipeline board, a pasted list, places and areas |
| `crm-visits` | site visits and cover: who books for whom, a move read from the history, a cancel that removes the row, one cover of a person at a time |
| `crm-console` | the console's Sales CRM section (P17): the twelve entries on the rail and each person's own; the Overview's cards as the installed page asks them, the ledger's whole-team figures to the owner, the CRM admin and Read-only, each other reader's own, the two whole-team cards whole or refused; the Unclaimed enquiries and Jobs cards drawn only while their part is on; Approvals, its toolbar opening the app's own Approvals screen; the two pages refused to the roles they are not for |
| `crm-manager` | the figures the manager's screens ask, at the ledger's moment; whose rows each reader's are; who is refused |
| `crm-supply` | Supply on the real Inventory add-on (needs `ADD_ONS_REPO`, built): the three roles it is for read six of Inventory's tables, read only and a few columns each, nobody else any; a need carries its deal's state; the grants go and Supply waits while Inventory is switched off for the app, and come back with it; installed without Inventory, Supply is off and waits for it, with no grant |
| `crm-settings` | who writes which setting and the server's refusal for the rest; each number's bounds; the working week; the depot as a place; the column no two companies or contacts share, and a pasted list matched on it; who writes the price list and a rep's own row |
| `crm-aftercare` | After the job (stage 2): a complaint answered by its move with what we told them, once, and settled; a warranty claim along its moves only, put right saying who paid; an answer added by hand, one a job, by the account manager and the admin only; a call made once with the server's stamps; the part switched off takes its own roles' grants and every write |
| `crm-showroom` | the showroom (stage 2, P19): the front desk books, moves and cancels; no two live bookings of a space overlap; a booking starts to be confirmed and a keyed create is one booking; a cancel removes the row with the why in its audit entry, a booking somebody came in for stays, a promised piece holds it; who reads and who is refused; the showroom's settings the CRM admin's; a sample's pieces out and on the shelf kept by the server and a loan past the shelf refused; the visitor's e-mails confirmed, moved, cancelled, and none with the switch off or before a confirmation |

```bash
ADMINIUM_REPO=~/Work/lanes/p67 ADD_ONS_REPO=~/Work/lanes/p67-add-ons-read npm run proofs
```

Postgres and MySQL legs run when `TEST_POSTGRES_URL` and `TEST_MYSQL_URL` are set; without them
only SQLite runs, and the run says so.
