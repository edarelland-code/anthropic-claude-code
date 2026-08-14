# ContextShelf

Topic-first memory and continuity for work done across Claude Chat, Claude Cowork, and Claude
Code.

You create a new conversation for the same project over and over, and the useful parts — what was
decided, what was rejected and why, which prompt worked, what's left — scatter across sessions you
can no longer find. ContextShelf organizes that knowledge by **what you were working on**, keeps
the full history rather than only the latest version, and generates a continuation prompt so a
brand-new Claude session can pick up where the last one stopped.

Claude Chat, Cowork, and Claude Code are **sources**. Topics are the organization.

```
Workspace → Topic → Subtopic → Knowledge → Source
```

## Status

**Phase 1 (Foundation) — complete.** All thirteen exit criteria pass, including the cross-device
acceptance test on two physical machines. Live at **<https://contextshelf.vercel.app>**, backed by
a hosted Supabase project with the schema applied and row-level security verified against it.

One limitation is carried forward: the OTP email templates cannot be set on the free tier, so a
sign-in *link* stays bound to the device that requested it. Cross-device *data* continuity is
proven and unaffected.

Full status, evidence per criterion, and the next task:
[`docs/DEVELOPMENT_STATE.md`](docs/DEVELOPMENT_STATE.md). Setup:
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

| Phase | Scope | State |
|---|---|---|
| 0 | Architecture, schema, rules | Done |
| 1 | Auth · Topics · Subtopics · Knowledge entries · Home · Topic page · responsive shell | **Complete — deployed and cross-device validated** |
| 2 | Timeline · Decisions · Ideas · Prompts + versions · Current State · Master Memory · Relationships | Not started |
| 3 | Inbox · Quick Capture · Search · Files · JSON + transcript import | Not started |
| 4 | Resume in Claude (Compact / Standard / Full Audit × Chat / Cowork / Code) | Not started |
| 5 | Claude Code ingestion — `/api/ingest`, git metadata, hooks, MCP pathway | Not started |
| 6 | Automation — browser companion, auto-classification, duplicate & conflict detection | Not started |

Sections that are not built say so on screen and hold no data. Nothing here is mocked.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · lucide-react · Supabase (Postgres, Auth,
RLS) · Vercel.

Why each of those, and what was rejected: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §2–3.

## Getting started

```bash
npm install
cp .env.example .env.local        # fill in from Supabase → Project Settings → API

npx supabase link --project-ref <your-ref>
npm run db:push                   # creates tables, RLS policies, append-only guarantees

npm run dev
```

Without credentials the app renders a setup screen rather than falling back to local storage —
the cloud database is the only source of truth, by design.

## Commands

| | |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build — must pass before committing changes under `src/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest — domain logic, error sanitising, adapter mapping |
| `npm run test:db` | Applies the real migration to an ephemeral PostgreSQL 16 and runs the RLS and history suites. No Docker, no Supabase account |
| `npm run test:responsive -- <url>` | Real Chromium at 1440 / 1280 / 768 / 390 / 375 |
| `npm run db:push` | Apply `supabase/migrations/` to the linked project |

## Design guarantees

These are enforced, not aspirational:

- **Nothing is destroyed.** Edits write versions, replacements write supersession links with a
  required reason, deletes are soft and tombstoned.
- **Prompt versions cannot be overwritten.** `prompt_versions` has no `UPDATE`/`DELETE` RLS
  policy, so the database refuses.
- **Current State and History are the same rows, read two ways.** Superseded and rejected items
  stay visible, labelled.
- **Provenance survives.** Every knowledge entry links back to the raw source it came from.
- **The cloud is authoritative.** `localStorage` holds UI preferences only.
- **Concurrent edits conflict rather than clobber.** Optimistic concurrency on mutable fields;
  append-only everywhere else.
- **Cross-user isolation is tested, not assumed.** `npm run test:db` creates two users and asserts
  the second cannot read, update, delete, or attach to the first's data — across nine tables.

## Documentation

| File | Contents |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Permanent product rules and architecture decisions — read first |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Full reasoning: problem, stack, sync, schema, ingestion, resume, UI, roadmap, risks |
| [`docs/DEVELOPMENT_STATE.md`](docs/DEVELOPMENT_STATE.md) | Current phase, completed work, known issues, next task |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Supabase setup, Vercel deployment, and the Phase 1 verification checklist |
| [`supabase/migrations/`](supabase/migrations/) | Checked-in SQL — never change schema from the dashboard |
| [`supabase/tests/`](supabase/tests/) | SQL suites proving RLS isolation and the history guarantees |
