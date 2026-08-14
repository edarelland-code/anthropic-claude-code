# CLAUDE.md — ContextShelf

Permanent product rules and architecture decisions. **Read this before writing any code in this
repository.** Full reasoning: `docs/ARCHITECTURE.md`. Live status: `docs/DEVELOPMENT_STATE.md`.

---

## What this product is

ContextShelf is a **permanent AI memory and continuity system**. It organizes work by *what is
being worked on*, not by *where the conversation happened*, and it generates continuation prompts
so a brand-new Claude session can resume without losing context.

It is **not** a note app, a project manager, or a chat client.

---

## Non-negotiable rules

These are permanent. Changing one requires the process at the bottom of this file.

### Organization
1. **Topic-first, never session-first.** Hierarchy is
   `Workspace → Topic → Subtopic → Knowledge → Source`.
2. **Claude Chat, Cowork, and Claude Code are SOURCES, not sections.** They may appear as filters
   and badges. They must never be primary navigation or a top-level list.
3. **Primary navigation is fixed:** Home · Topics · Inbox · Timeline · Prompts · Ideas ·
   Decisions · Files · Search · Settings.
4. **One session fans out into many knowledge entries.** Never render an entire session as one
   generic card.

### History and truth
5. **Nothing is ever destroyed.** Editing writes a new version. Replacing writes a supersession
   link. Deleting sets `deleted_at` and writes a `deletion_log` row.
6. **`prompt_versions` and `knowledge_entry_versions` are insert-only** — enforced by the absence
   of `UPDATE`/`DELETE` RLS policies, not by convention.
7. **Superseding requires a reason.** `supersedes_reason` / `supersede_reason` is mandatory at the
   supersede action. "Why did we change our mind" is the product.
8. **Current State is a read, not a store.** `status = 'active' AND superseded_by_id IS NULL` over
   the same append-only table the Timeline reads.
9. **Rejected and superseded items must appear in generated Resume prompts as an avoid-list, with
   reasons.** This is the feature that stops future Claude sessions re-proposing rejected ideas.

### Provenance
10. **Two layers, always linked.** Layer 1 `source_sessions` = verbatim, immutable evidence.
    Layer 2 `knowledge_entries` = typed, statused, queryable knowledge. Layer 2 keeps
    `source_session_id` + `source_reference`.
11. **Never invent provenance.** If a source is unknown, `source_type = 'manual'`.

### Data and sync
12. **The cloud database is the only source of truth.** `localStorage` may hold UI preferences
    only — never data.
13. **Never fake synchronization, integrations, or ingestion.** If Claude Chat auto-import does not
    exist, the UI must not imply it does.
14. **Never label a placeholder as a complete feature.** Unbuilt sections say what phase they land
    in.
15. **`updated_at` is set by a database trigger**, never by the client. Client clocks disagree
    across devices.
16. **Mutable scalar updates use optimistic concurrency** (`WHERE updated_at = <read value>`);
    zero rows affected surfaces a conflict to the user instead of clobbering.
17. **Duplicate/conflict detection proposes; the user confirms.** Never silently merge.
17a. **Never surface a raw driver error.** Everything thrown by the data layer goes through
    `toUserFacingError()`; the detail is logged server-side, the user gets an actionable
    sentence. Never fail silently either — every failure path renders something.

### Code structure
18. **All data access goes through `src/lib/ports/*` interfaces.** Only `src/lib/adapters/**` may
    import a database or auth vendor SDK. `app/` and `components/` must never import Supabase
    directly.
19. **Domain types in `src/lib/domain/*` are hand-written** and vendor-neutral. Generated DB types
    are an adapter implementation detail.
20. **Every ingestion path goes through the same funnel:** adapter → `NormalizedIngestion` →
    persist → classify. New sources are new adapters, never new write paths.
21. **No single-file HTML artifact. No monolithic JSON blob.** Normalized relational modeling.
22. **`src/lib/resume/assemble.ts` stays a pure function** so its guarantees are testable.

### UI
23. **Color signals knowledge type, not decoration.** Source badges are secondary and monochrome.
    Progress green · Implementation emerald · Decision violet · Idea/Suggestion amber · Prompt
    blue · Winning prompt cyan · Blocker red · Removed/Rejected rose · Research indigo ·
    Files/References slate.
24. **No gradients, glass, or glow.** Calm, neutral, information-dense.
25. **Mobile is designed, not shrunk:** single column, bottom nav, sticky Resume, Quick Capture,
    accordions. Essential functions are never gesture-only.
26. **Every screen is responsive as it is built** — not retrofitted later.

---

## Established architecture decisions

| # | Decision | Reason |
|---|---|---|
| AD-1 | **Next.js 16 App Router** over Vite SPA | Ingestion needs server endpoints (`/api/ingest`) and secrets; Topic pages are read-heavy joins that suit Server Components |
| AD-2 | **Supabase Postgres** as database | Real relational modeling, RLS as the authorization model, built-in FTS, `pg_dump` exit hatch |
| AD-3 | **Supabase Auth**, magic-link primary | Same system as DB so `auth.uid()` works inside RLS policies; no password to sync between machines |
| AD-4 | **Server-authoritative sync**, cache is read-through only | The brief: "the user's computer must not be the source of truth" |
| AD-5 | **Append-only + supersession** instead of a merge algorithm | Makes concurrent edits conflict-*safe* by construction — two versions both survive |
| AD-6 | **Port/adapter boundary** for all persistence | Prevents permanent coupling to Supabase |
| AD-7 | **Polymorphic `relationships` table** + validating trigger | A queryable graph instead of a dozen nullable FKs |
| AD-8 | **`ContextSnapshot` is derived and disposable** | Master Memory must be regenerable; it is never the source of truth |
| AD-9 | **Tailwind v4** (CSS-first config) | No `tailwind.config.js` to drift |
| AD-10 | **`last_meaningful_update_at` is separate from `updated_at`** | Renaming a topic is not progress; freshness must not be fooled by cosmetic edits |
| AD-11 | **Composite `(id, workspace_id)` foreign keys on every topic-scoped child table** | RLS authorises on the row's own `workspace_id`; without this a member of workspace B can attach rows to a topic in workspace A and the with-check still passes |
| AD-12 | **The schema is tested against a real ephemeral Postgres** (`npm run test:db`) | "The SQL looks correct" is not validation. This harness caught a privilege-escalation bug in the `workspace_members` insert policy |
| AD-13 | **Both PKCE (`code`) and OTP (`token_hash`) sign-in links are accepted** | PKCE binds a link to the device that requested it, which breaks the Mac/Windows workflow this product exists to serve |
| AD-14 | **`main` is the stable branch; work happens on feature branches** | See the Git workflow below |
| AD-15 | **Hosted verification runs over the Management API when the Postgres wire protocol is unreachable** | Some environments permit HTTPS but not `:5432`/`:6543`. `db push` and `db diff --linked` then cannot run at all. The migration, the two hosted suites, and schema parity all work over HTTPS instead, so "the hosted database is correct" stays checkable rather than assumed. The CLI path remains preferred wherever it works |
| AD-16 | **Hosted validation asserts rows in the database, never only rendered text** | A page-content check reported two knowledge entries created while `knowledge_entries` was empty — the submit had hit a different form on the same page and created an action. Text on a page is evidence the app rendered something; only the row is evidence of persistence |

---

## Git workflow

- **`main` is the stable, validated branch.** It must always build, typecheck, lint, and pass both
  test suites.
- **Work happens on a feature branch**, named for the phase or change (`phase-2-memory`,
  `fix/rls-membership`).
- **Merge into `main` only after validation passes** — the full command list below, plus any
  phase exit criteria in `docs/ARCHITECTURE.md` §13.
- **Never open a pull request whose head and base are the same branch.** If `main` does not yet
  differ from the working branch, there is nothing to review.
- Schema changes are new files in `supabase/migrations/`. Never edit an applied migration, and
  never change schema from the Supabase dashboard — the next `db push` reverts it.

## Working rules for any session in this repo

- Do not start a later phase while a foundation issue is open. Phases and exit criteria:
  `docs/ARCHITECTURE.md` §13.
- Prefer working functionality over mocked functionality.
- Update `docs/DEVELOPMENT_STATE.md` after every meaningful milestone, without being asked.
- Update this file when a permanent architectural rule changes, without being asked.
- **Before modifying an established decision above:** name the decision (AD-n or rule number),
  state why it no longer holds, and record the supersession in `docs/DEVELOPMENT_STATE.md`. Do not
  quietly edit a rule.

## Commands

```bash
npm run dev          # local dev server
npm run build        # production build (must pass before any commit that touches src/)
npm run typecheck    # tsc --noEmit
npm run lint
npm run test         # vitest — domain logic, error sanitising, adapter mapping
npm run test:db      # real ephemeral Postgres: migration + RLS + history guarantees
npm run test:responsive -- <url>   # real Chromium at 1440/1280/768/390/375
npm run db:push      # apply supabase/migrations to the linked project
npm run db:types     # regenerate adapter-internal DB types

npm run provision            # the whole hosted sequence: link, migrate, verify, deploy
npm run schema:parity        # hosted vs repository catalogs, without a Postgres connection
npm run validate:hosted -- <url>   # auth, persistence, isolation, provenance, authenticated QA
```

All five of `build`, `typecheck`, `lint`, `test`, and `test:db` must pass before merging to
`main`.

## Layout

```
src/app/            routes — (auth) and (app) groups
src/components/     ui/ primitives · layout/ shell · topics/ · knowledge/
src/lib/domain/     hand-written vendor-neutral types + enums  ← start here
src/lib/ports/      repository interfaces (no vendor names)
src/lib/adapters/   supabase/ — the ONLY place the vendor SDK appears
src/lib/ingestion/  adapters → normalizer → persister
src/lib/resume/     pure context assembler
supabase/migrations/  checked-in SQL — never change schema from the dashboard
supabase/tests/     SQL suites run by npm run test:db against a real cluster
scripts/            db-test.sh · responsive-qa.mjs
docs/               ARCHITECTURE.md · SCHEMA.md · DEPLOYMENT.md · DEVELOPMENT_STATE.md
```
