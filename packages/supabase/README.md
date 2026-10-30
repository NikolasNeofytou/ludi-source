# @ludi/supabase

Database schema, migrations, RLS policies, and Edge Functions for Ludi.

## Layout

Follows the Supabase CLI convention — `supabase/` holds everything the CLI reads:

```
packages/supabase/
  package.json
  README.md
  supabase/
    config.toml     ← CLI reads this
    migrations/     ← ordered SQL, applied in filename order
    seed.sql        ← dev fixtures (cities, pitches)
    functions/      ← Deno Edge Functions
```

See [`docs/data-model.md`](../../docs/data-model.md) for the schema rationale and [`supabase/functions/README.md`](./supabase/functions/README.md) for the function inventory.

## Setup (Stage 2)

1. `brew install supabase/tap/supabase deno`
2. `cd packages/supabase` — all CLI commands below run from here
3. `supabase start` — boots local Postgres + Studio at http://localhost:54323 (first run pulls Docker images, ~5 min)
4. `supabase db reset` — applies every migration in order, then runs `seed.sql`
5. `supabase functions serve create-booking --env-file supabase/functions/.env.local` — serves a single function with file watching

Local connection strings (anon / service keys are printed by `supabase start`):

| Service | URL |
|---|---|
| API | http://127.0.0.1:54321 |
| DB | postgresql://postgres:postgres@127.0.0.1:54322/postgres |
| Studio | http://127.0.0.1:54323 |
| Inbucket (email) | http://127.0.0.1:54324 |

## Running tests

```bash
cd packages/supabase/supabase/functions
deno test --allow-env --allow-net=deno.land,esm.sh _tests/
```

## Secrets

Never commit `.env*` or service-role keys. Only the anon key ships to the client. The local dev keys printed by `supabase start` are shared defaults — safe for local, never for production.
