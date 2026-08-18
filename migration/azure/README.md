# Database — Azure PostgreSQL 15

`01-schema.sql` is the canonical schema and `02-seed.sql` the seed data. Both are plain
SQL, PG15-compatible, no `psql` meta-commands, each wrapped in a single `BEGIN/COMMIT`
so a failure rolls the whole file back. There is no migration tool.

Only `pgcrypto` is created — required for `gen_random_bytes()` (the `invitations.token` /
`link_id` defaults) and `sha256()` (the `hash_invitation_token` trigger). It is on the
Azure Flexible Server allow-list. `gen_random_uuid()` needs no extension on PG15.

There is no row-level security anywhere in this schema: authorization is enforced in the
Azure Functions by hand. `supabase/migrations/` is kept only as provenance for the RLS
policies those checks replaced.

## Additive migrations

Everything alongside `01`/`02` is an additive, idempotent migration applied to production
after the fact — numbered `0N-*.sql` originally, dated `YYYY-MM-DD-<issue>-<slug>.sql` more
recently. `ls` this folder for the list; each one names its issue in a header comment.

**Standing rule:** once an additive migration is applied to production, fold it into
`01-schema.sql`, so a fresh database stood up from `01`+`02` is always complete. The file
stays here as the applied-migration record.

`functions/schema-fold.test.ts` enforces this: CI fails if a table, column or index a
migration creates is absent from `01-schema.sql`. It is a test rather than a line of prose
because the prose did not work — migration `08` went unfolded for months while its own
header claimed otherwise, leaving a fresh database with no `orphan_sweep_runs` table.

**Apply an additive migration to production before the deploy that needs it.** Merging to
`main` is the deploy, so "after the merge" is already too late.

## Applying it

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migration/azure/01-schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migration/azure/02-seed.sql
```

`DATABASE_URL` is the same Azure connection string the functions use —
`postgres://USER:PASSWORD@SERVER.postgres.database.azure.com:5432/DBNAME?sslmode=require`.

Re-running `01`/`02` against a populated database fails on duplicate keys; drop and
recreate for a clean re-apply. The additive migrations are idempotent and safe to re-run.

## Elevate yourself to platform admin

The seeded admin and learner have `entra_oid = NULL`. Your first Entra login makes a
*new* profile row with `is_platform_admin = false`, so promote it by hand:

```sql
UPDATE public.profiles
SET is_platform_admin = true
WHERE email = 'you@yourcompany.com';
```

To also become an org admin of the seeded Test Org:

```sql
INSERT INTO public.org_memberships (org_id, user_id, role, status)
SELECT '11111111-1111-1111-1111-111111111111', id, 'org_admin', 'active'
FROM public.profiles WHERE email = 'you@yourcompany.com'
ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'org_admin', status = 'active';
```

Seed UUIDs are fixed and readable in `02-seed.sql` — the Test Org is the all-`1`s UUID above.
