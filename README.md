# AstraPair

AstraPair — a couples-first astrology platform for birth charts, compatibility insights, and AI-powered relationship readings.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Supabase (Postgres, Auth, RLS) · Zod · Vitest · Vercel

## Local development

Requirements: Node 24, pnpm 11, Supabase CLI.

```bash
pnpm install
cp .env.example .env   # fill in Supabase dev project values
pnpm dev
```

| Script           | Purpose                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| `pnpm dev`       | Start the dev server                                                     |
| `pnpm lint`      | ESLint                                                                   |
| `pnpm typecheck` | TypeScript, no emit                                                      |
| `pnpm test`      | Unit tests (Vitest)                                                      |
| `pnpm build`     | Production build                                                         |
| `pnpm db:types`  | Regenerate `src/lib/supabase/database.types.ts` from the linked database |

## Database

Schema lives in `supabase/migrations`. Every table has Row Level Security enabled and is deny-by-default; privileged writes go through `SECURITY DEFINER` functions. After adding a migration:

```bash
supabase db push     # apply to the linked dev project
pnpm db:types        # refresh generated TypeScript types
```

Data access uses `supabase-js` with the signed-in user's session rather than an ORM on a privileged connection, so RLS is always enforced.

## Branching

- `main` — protected; changes land only via pull request (no force-push, no deletion).
- `dev` — integration branch. Feature branches (`feat/...`, `fix/...`) branch from `dev` and merge back via PR; `dev` is merged to `main` for releases.
