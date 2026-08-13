# ContextShelf — Development State

> Live status file. Update after every meaningful milestone, without being asked
> (CLAUDE.md working rules). Permanent rules live in `/CLAUDE.md`; reasoning lives in
> `docs/ARCHITECTURE.md`; setup and deployment live in `docs/DEPLOYMENT.md`.

**Last updated:** 2026-08-13
**Current phase:** Phase 1 — Foundation. **Hardened and database-validated. Not production
validated, not cross-device validated.**
**Phase 2 is blocked** until the exit criteria below pass.

---

## Status language

The user asked for precision, so these terms mean exactly this and nothing more:

| Term | Meaning |
|---|---|
| **Implemented** | The code exists and compiles |
| **Locally tested** | Verified by automated tests on this machine |
| **Database validated** | Verified against a real PostgreSQL executing the real migration |
| **Production validated** | Verified on the deployed URL against the hosted Supabase project |
| **Cross-device validated** | The same account was verified on two physical machines |

---

## Where Phase 1 actually stands

| # | Exit criterion | Status | Evidence |
|---|---|---|---|
| A | Cloud database works | **Database validated** locally; **not** production validated | `npm run test:db` applies the real migration to a real Postgres 16 |
| B | Authentication works | **Implemented**; not production validated | Magic link, PKCE + OTP, middleware refresh, route guards. Cannot exercise a real email flow without the hosted project |
| C | Data persists after refresh | **Implemented**; not production validated | All reads are server-side from Postgres; there is no client store to lose |
| D | Data persists after logout/login | **Implemented**; not production validated | Same |
| E | Same account, another computer | **Not validated — blocked** | Needs the hosted project and the deployed URL |
| F | Users cannot reach each other's data | **Database validated** | `supabase/tests/02_rls.test.sql` — read/update/delete/attach denied across topics, subtopics, entries, decisions, prompts, prompt bodies, actions, transcripts, join tables, and membership |
| G | Topics work | **Implemented + locally tested** | CRUD, optimistic concurrency, soft delete + tombstone |
| H | Nested subtopics work | **Implemented + database validated** | Parent link and acyclicity asserted in `03_history.test.sql` |
| I | Knowledge entries work | **Implemented + locally tested** | Typed create, query, edit-with-version, supersede |
| J | Source provenance works | **Implemented + locally tested** | `mappers.test.ts` asserts provenance survives and is never invented |
| K | Current State separate from history | **Database validated + locally tested** | `03_history.test.sql` and `current-state.test.ts` both model the brief's blue-icon/checkmark/slash example |
| L | Responsive desktop and mobile | **Partially validated** | 15 unauthenticated page/viewport combinations pass at 1440/1280/768/390/375. Authenticated pages need a session |
| M | Production deployment | **Not started — blocked** | Needs the Vercel import |

**Phase 1 is not complete.** E and M are blocked on actions only the account holder can take;
B, C, D and L are partially blocked behind them.

---

## Completed

### Phase 0 — Architecture ✅
Problem, stack, sync model, IA, schema, ingestion, resume, layouts, roadmap, risks — all in
`docs/ARCHITECTURE.md`. Permanent rules in `CLAUDE.md`.

### Phase 1 — Foundation (implemented)
- Schema: 24 tables, 13 enums, RLS everywhere, `updated_at` triggers, subtopic-cycle guard,
  polymorphic relationship validation, `supersede_entry()` transaction, new-user bootstrap
- Append-only enforced by the absence of UPDATE/DELETE policies on the two history tables
- Port/adapter boundary; only `src/lib/adapters/**` touches the vendor SDK
- Magic-link auth, middleware session refresh, protected routes
- Topics, nested subtopics, typed knowledge entries, actions
- Home dashboard, Topic page with the Current/Timeline split, responsive shell

### Phase 1 hardening (this pass)
- **Real database test harness** — `npm run test:db` boots an ephemeral Postgres 16, applies the
  Supabase auth shim, runs the real migration, and executes three SQL suites. No Docker, no
  network, no Supabase account
- **Cross-user RLS proven**, executed as the non-superuser `authenticated` role PostgREST uses
- **Error handling** — `toUserFacingError()`, an `(app)` error boundary, a loading skeleton, a
  not-found page, and a middleware that degrades to `/login` instead of 500-ing
- **Auth robustness** — both PKCE and OTP link shapes accepted; open-redirect guard on `next`;
  Supabase errors surfaced on the login page
- **Responsive QA tooling** — `npm run test:responsive` drives real Chromium at five viewports
- 48 unit tests across domain logic, error sanitising, adapter mapping, and the environment contract
- Migrated from the legacy Supabase anon JWT to the current **publishable key**
  (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). No silent fallback to the old variable: if only the
  legacy name is set, `/setup` names it explicitly. The Postgres roles (`anon`, `authenticated`,
  `service_role`) are unchanged — only the API key naming moved

---

## Issues found and fixed this pass

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | **High — privilege escalation** | The `members_write` RLS policy allowed `user_id = auth.uid()`, letting **any** authenticated user insert themselves into **any** workspace and read everything in it | Policy now requires workspace ownership. The bootstrap never needed the clause — `handle_new_user()` is security definer. Caught by `02_rls.test.sql`, which now regression-tests it |
| 2 | **High — cross-workspace writes** | Child rows carried their own `workspace_id`, so a member of workspace B could insert a row with `workspace_id = B` pointing at a topic in workspace A; the RLS with-check passed | Composite `(topic_id, workspace_id)` and `(subtopic_id, workspace_id)` foreign keys on all nine topic-scoped tables, plus a same-workspace trigger on the two join tables (AD-11) |
| 3 | Medium | `is_workspace_member()` was defined before `workspace_members` existed — the migration **could not run at all** | Moved after the table. This is exactly what "the SQL looks correct" misses |
| 4 | Medium | The migration relied on Supabase's implicit default privileges | Explicit `GRANT`s; `anon` revoked |
| 5 | Medium | Magic links were PKCE-only, so a link requested on one machine failed on another — directly against the cross-device requirement | `/auth/confirm` + `/auth/callback` both accept `code` and `token_hash` (AD-13) |
| 6 | Medium | `next` redirect parameter was unvalidated (open redirect) | Same-origin paths only |
| 7 | Medium | Raw Postgres errors reached the UI, potentially naming tables and connection details | `toUserFacingError()`, with a test asserting a connection string never escapes |
| 8 | Medium | A network failure in middleware 500-ed every route | Caught; degrades to signed-out |
| 9 | Low | Docs claimed Next.js 15; Next.js **16.3.0** is installed | Docs corrected across four files. 16 is correct and deliberate — 15.0.3 carries CVE-2025-66478 |
| 10 | Low | `@supabase/ssr` was 0.5.2 | Upgraded to 0.12.4 |
| 11 | Low | Vitest could not resolve the `@/` alias | `vitest.config.ts` |
| 12 | Low | Long unbroken strings could overflow at 375px; the Open Issues row was cramped | `break-words`; the input wraps to its own line on narrow screens |
| 13 | Low | The `/setup` step list overflowed 14–29px at 390/375 once it named `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — a 36-character unbreakable token in a flex child | `min-w-0` + `break-words`. Caught by `npm run test:responsive`, which is the first regression that harness has paid for |

---

## Not validated

- Hosted Supabase project — does not exist yet
- Real magic-link email delivery and redirect handling
- Session persistence across a real browser restart
- The same account on two physical machines
- Production deployment, HTTPS, production environment variables
- Authenticated-page responsive QA (25 page/viewport combinations skipped)
- Expired/invalid session behaviour against real Supabase

---

## External dependencies (blocked on the account holder)

1. **Supabase project** — `docs/DEPLOYMENT.md` §1–3
2. **Vercel deployment** — §4
3. **Supabase redirect allow-list** — §5
4. **Email template change** — §6, recommended for cross-device sign-in

Nothing else is blocked. Everything achievable without those accounts is done.

---

## Known issues / open items

1. Realtime is not wired; cross-device updates need a refresh. Correctness is unaffected — the
   database is authoritative. Phase 2.
2. The supersede control is Phase 2 UI. The SQL function works and is tested; there is no button
   yet. `docs/DEPLOYMENT.md` gives the SQL to verify criterion K in the meantime.
3. No end-to-end browser test of an authenticated flow. Needs the hosted project.
4. Export/import and the version-recovery UI are Phase 3.
5. `entry_subtopics` / `session_subtopics` are guarded by a trigger rather than a composite FK,
   because they carry no `workspace_id` of their own. Equivalent protection, slightly weaker
   constraint story.

---

## Test results (last run, 2026-08-13)

| Suite | Result |
|---|---|
| `npm run build` | pass — 16 routes |
| `npm run typecheck` | pass |
| `npm run lint` | pass, 0 warnings |
| `npm run test` | **48 passed** / 5 files |
| `npm run test:db` | **3 suites passed** against PostgreSQL 16.13 |
| `npm run test:responsive` | 15 combinations pass, 25 skipped (need a session) |

---

## Next task

**Stand up the hosted project and run the cross-device acceptance test.**
Follow `docs/DEPLOYMENT.md` §1–6, then the verification table in that document. When step 7 and
step 9 of the cross-device test pass, mark criteria B–E, L, and M validated here — and only then
start Phase 2 on a `phase-2-memory` branch.

---

## Resume trigger

**IF** returning to ContextShelf development
**THEN** check whether the hosted Supabase project and Vercel deployment exist. If not, that is
the only work item — everything else in Phase 1 is done and tested. If they do exist, run the
`docs/DEPLOYMENT.md` verification table, update the status table above, then begin Phase 2.
