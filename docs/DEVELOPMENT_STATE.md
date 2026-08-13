# ContextShelf — Development State

> Live status file. Update after every meaningful milestone, without being asked
> (CLAUDE.md working rules). Permanent rules live in `/CLAUDE.md`; reasoning lives in
> `docs/ARCHITECTURE.md`.

**Last updated:** 2026-08-13
**Current phase:** Phase 1 — Foundation (code complete, awaiting a live Supabase project)

---

## Completed

### Phase 0 — Architecture ✅
- Problem restated, four failure modes named (`docs/ARCHITECTURE.md` §1)
- Stack chosen with alternatives rejected on the record: Next.js 15 · TypeScript · Tailwind v4 ·
  lucide · Supabase · Vercel (§2–3)
- Cross-device sync model defined: server-authoritative, append-only, optimistic concurrency (§4)
- Information architecture, normalized schema, Layer 1/Layer 2 split, Current-vs-History,
  ingestion funnel, Resume assembler, desktop + mobile layouts, roadmap, risk register (§5–14)
- `CLAUDE.md` written with 26 permanent rules and 10 recorded architecture decisions
- Repository initialized; this file created

### Phase 1 — Foundation (code complete)
- **Schema** — `supabase/migrations/0001_init.sql`: 24 tables, 13 enums, RLS on every table,
  `updated_at` triggers, subtopic-cycle guard, polymorphic relationship validation,
  `supersede_entry()` transaction function, new-user bootstrap trigger, FTS + trigram indexes
- **Append-only guarantees enforced in the database** — `prompt_versions` and
  `knowledge_entry_versions` have SELECT + INSERT policies only, so an overwrite is impossible
  rather than merely discouraged
- **Port/adapter boundary** — `src/lib/ports/repositories.ts` (vendor-neutral) implemented by
  `src/lib/adapters/supabase/`. No file under `app/` or `components/` imports the vendor SDK
- **Auth** — magic-link sign-in, session refresh in middleware, route protection, sign-out
- **Topics** — list, create, read, optimistic-concurrency update, soft delete + tombstone
- **Subtopics** — nestable, create/rename/move/archive/restore
- **Knowledge entries** — typed create, query with Current-only filter, edit that snapshots the
  prior version, supersede via the SQL transaction, version listing, soft delete
- **Actions** — next steps / blockers / questions with resolve
- **Home** — Continue working · Blocked · Recently active · Stale topics
- **Topic page** — Current (goal / state / progress / next action / resume trigger) · Active
  decisions · Open issues · Subtopics · Add knowledge · Timeline grouped by day · right context
  panel
- **Responsive shell** — desktop sidebar; mobile bottom nav with centre Capture and a More sheet
- **Honest placeholders** — Inbox, Timeline, Prompts, Ideas, Decisions, Files, Search each state
  their phase and hold no mock data
- **Verification** — `npm run build` passes, `npm run typecheck` clean, `npm run test` 5/5 green

---

## Active work

Nothing in progress. Phase 1 is code-complete but **not yet verified against a live database** —
see Known issues.

---

## Important decisions made during setup

| ID | Decision | Where |
|---|---|---|
| AD-1 | Next.js App Router over a Vite SPA — ingestion needs server endpoints and secrets | ARCH §2 |
| AD-2 | Supabase Postgres over Firestore / Convex / Neon+Auth.js — relational modeling + RLS + FTS + exit hatch | ARCH §3 |
| AD-3 | Magic-link auth — no password to sync between the Mac and the Windows PC | ARCH §3 |
| AD-4 | Server-authoritative sync; local cache is read-through only | ARCH §4 |
| AD-5 | Append-only + supersession instead of a merge algorithm — conflicts are safe by construction | ARCH §4, §8 |
| AD-6 | Port/adapter boundary for all persistence | CLAUDE.md rule 18 |
| AD-7 | Polymorphic `relationships` table with a validating trigger | ARCH §6 |
| AD-8 | `ContextSnapshot` (Master Memory) is derived and disposable | ARCH §8 |
| AD-10 | `last_meaningful_update_at` kept separate from `updated_at` | ARCH §6 |
| — | Placeholder screens name their phase and render no data | CLAUDE.md rule 14 |
| — | Unbuilt repository writes throw `NotYetImplemented` rather than silently no-op | `adapters/supabase/repositories.ts` |

---

## Known issues / open items

1. **No live Supabase project yet.** The migration has not been applied to a real database, so
   the Phase 1 exit criteria are unmet. Blocks: create project → fill `.env.local` → `npm run
   db:push` → sign in on two devices → confirm a topic created on one appears on the other.
   *This is the single thing standing between Phase 1 code-complete and Phase 1 done.*
2. **RLS cross-user test not yet run.** Risk R6. Needs a second account asserting zero rows from
   the first. Must pass before Phase 2 starts.
3. **`supersede_entry()` untested against a live database.** The transaction is written but has
   not executed. Also unreachable from the UI until Phase 2 adds the supersede control.
4. **Realtime not wired.** Cross-device updates currently require a refresh. Correctness is
   unaffected (the database is authoritative); this is a latency improvement for Phase 2.
5. **No Playwright suite yet.** Unit tests cover pure helpers only. Flow tests land with Phase 2.
6. **Export/import not built** (Phase 3). Soft delete and tombstones exist; the recovery UI does
   not.
7. **`profiles` row depends on the `on_auth_user_created` trigger.** If a user existed before the
   migration ran, they will have no workspace. Not a concern for a fresh project; worth a
   backfill query if it ever happens.

---

## Next task

**Stand up the Supabase project and verify Phase 1 end to end.**

1. Create the project; copy `.env.example` → `.env.local` with real values
2. `supabase link --project-ref <ref> && npm run db:push`
3. Sign in; confirm the bootstrap trigger created a profile, workspace, and membership
4. Create a topic, a subtopic, and three knowledge entries of different types
5. Sign in from a second machine and confirm identical data (the cross-device exit criterion)
6. Sign in as a second account and confirm zero visibility into the first account's rows (R6)
7. Mark Phase 1 done here, then begin Phase 2 with the Decision Ledger and prompt versioning

---

## Resume trigger

**IF** returning to ContextShelf development
**THEN** verify Phase 1 against a live Supabase project using the checklist above before writing
any Phase 2 code — CLAUDE.md forbids advancing a phase while foundation issues are open.
