# The proofs

Six test files that install this app on a real Adminium server, with its sample, on SQLite,
Postgres and MySQL, and try it signed in as each of the sample's sixteen people.

They are not this repository's unit tests. They run **inside an Adminium checkout**, because
they start the whole server in one process and reach into its modules to do the one thing the
product does not: give a sample person a password. `npm run proofs` copies them into
`$ADMINIUM_REPO/apps/server/test/` as `zz-crm-*.test.ts`, runs them there, and removes them.

| File | What it proves |
|---|---|
| `crm-install` | every table installs and takes the writes its rules allow |
| `crm-sample` | the sample loads with the figures of the ledger |
| `crm-roles` | every table read as each person; who may write what; each refusal is the server's |
| `crm-rules` | the shipped rules run by themselves |
| `crm-inventory` | Supply on the real Inventory add-on (needs `ADD_ONS_REPO`, built) |
| `crm-g3` | the pipeline board, a pasted list, places and areas |

```bash
ADMINIUM_REPO=~/Work/lanes/p67 ADD_ONS_REPO=~/Work/lanes/p67-add-ons-read npm run proofs
```

Postgres and MySQL legs run when `TEST_POSTGRES_URL` and `TEST_MYSQL_URL` are set; without them
only SQLite runs, and the run says so.
