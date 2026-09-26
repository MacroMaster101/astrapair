# AstraPair

AstraPair — a couples-first astrology platform for birth charts, compatibility insights, and AI-powered relationship readings.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · Supabase (Postgres, Auth, RLS) · Zod · Vitest · Vercel

## Local development

Requirements: Node 24, pnpm 11.

```bash
pnpm install
cp .env.example .env.local   # fill in Supabase dev project values
pnpm dev
```

| Script           | Purpose              |
| ---------------- | -------------------- |
| `pnpm dev`       | Start the dev server |
| `pnpm lint`      | ESLint               |
| `pnpm typecheck` | TypeScript, no emit  |
| `pnpm test`      | Unit tests (Vitest)  |
| `pnpm build`     | Production build     |

## Branching

- `main` — protected; changes land only via pull request (no force-push, no deletion).
- `dev` — integration branch. Feature branches (`feat/...`, `fix/...`) branch from `dev` and merge back via PR; `dev` is merged to `main` for releases.
