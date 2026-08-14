# ContextShelf — Development State

> Live status file. Update after every meaningful milestone, without being asked
> (CLAUDE.md working rules). Permanent rules live in `/CLAUDE.md`; reasoning lives in
> `docs/ARCHITECTURE.md`; setup and deployment live in `docs/DEPLOYMENT.md`.

**Last updated:** 2026-08-14
**Current phase:** Phase 1 — Foundation. **COMPLETE.** All thirteen exit criteria pass, including
the cross-device acceptance test on two physical machines.

Live at **<https://contextshelf.vercel.app>**, backed by Supabase project `omhktzxwffaipmcoljic`.

**Phase 2 is unblocked.** Start it on a `phase-2-memory` branch.

One limitation is carried forward rather than closed: the OTP email templates cannot be set on the
free tier, so a sign-in link stays bound to the device that requested it. Cross-device *data*
continuity is proven and unaffected; only the sign-in link is device-bound. See "Carried into
Phase 2".

---

## Status language

These terms mean exactly this and nothing more:

| Term | Meaning |
|---|---|
| **Implemented** | The code exists and compiles |
| **Locally tested** | Verified by automated tests on this machine |
| **Locally validated** | Verified against a real ephemeral PostgreSQL executing the real migration |
| **Hosted database validated** | Verified against the actual Supabase project `omhktzxwffaipmcoljic` |
| **Authentication configured** | Redirect URLs set on the hosted project |
| **Production validated** | Verified on the deployed URL against the hosted Supabase project |
| **Cross-device validated** | The same account was verified on two physical machines |

---

## Where Phase 1 stands — CLOSED

| # | Exit criterion | Status | Evidence |
|---|---|---|---|
| A | Cloud database works | **Hosted database validated** | Migration applied to `omhktzxwffaipmcoljic`: 24 tables, 14 enums, 31 policies, 39 functions. `hosted/01_verify_schema.sql` returns 15/15 PASS |
| B | Authentication works | **Validated** | Sign-in driven through the app's own `/auth/confirm?token_hash=…` route against hosted Supabase Auth; lands on `/home` |
| C | Data persists after refresh | **Validated** | Topic created through the UI survives a hard reload, and the row is asserted present in hosted Postgres |
| D | Data persists after logout/login | **Validated** | Cookies cleared → bounced to `/login` → signed in again → data still present |
| E | Same account, another computer | **Cross-device validated** | Verified by the account holder on two physical machines: data created on the Work PC appeared on the Mac, and an update made on the Mac appeared back on the Work PC. No export, no import. Also holds for a second browser context at a different viewport |
| F | Users cannot reach each other's data | **Hosted database validated** | `hosted/02_rls_isolation.sql` returns ALL HOSTED RLS CHECKS PASSED. Separately, a second signed-in account cannot see the first's topic in a listing and is refused its direct URL |
| G | Topics work | **Validated** | Created through the real UI; row asserted in hosted Postgres |
| H | Nested subtopics work | **Validated** | Subtopic created through the UI; row asserted in hosted Postgres |
| I | Knowledge entries work | **Validated** | Two entries of different types created through the UI; both rows asserted in hosted Postgres |
| J | Source provenance works | **Validated** | Entries persist `source_type` of `claude_code` and `claude_chat` with types `decision` and `progress`; asserted non-null in the database (rule 11) |
| K | Current State separate from history | **Locally validated** | `03_history.test.sql` and `current-state.test.ts`. The supersede control is Phase 2 UI, so this is not yet exercised through the browser |
| L | Responsive desktop and mobile | **Validated** | 40 page/viewport combinations across 1440/1280/768/390/375, **0 skipped**. Two real touch-target defects were found and fixed |
| M | Production deployment | **Deployed** | <https://contextshelf.vercel.app> — HTTPS, `/login` 200, `/`, `/home`, `/topics` correctly 307 to `/login` when signed out |

**All thirteen criteria pass.** One limitation is carried forward and is not a code defect:

- **The OTP email templates are not set.** The Management API refuses with *"Email template
  modification is not available for free tier projects using the default email provider."* This is
  a plan limitation, not a configuration mistake, and it is not fixable from the dashboard either.
  Consequence: Supabase sends its default PKCE-shaped link, which binds to the device that
  requested it. `/auth/confirm` and `/auth/callback` accept both shapes, so sign-in works and
  cross-device *data* continuity is proven — but the *link* must be opened on the device that
  asked for it until a paid plan or custom SMTP is in place.

---

## What the environment can and cannot reach

The previous revision recorded all Supabase and Vercel hosts as blocked at the gateway. That is no
longer true, and the replacement constraint is narrower and worth stating precisely, because it
determines which tools work.

| Path | Result |
|---|---|
| HTTPS to `api.supabase.com`, `*.supabase.co`, `vercel.com`, `api.vercel.com` | **reachable** |
| Postgres wire protocol — pooler `:5432` and `:6543` | **blocked**, connection times out |
| Postgres wire protocol — `db.<ref>.supabase.co:5432` | **unreachable**, IPv6-only host, no IPv6 |
| Chromium to any external HTTPS host | **blocked**, tunnels reset (`curl` and Node reach the same hosts) |

Three consequences, each with the workaround actually used:

- **`supabase db push` cannot run.** The migration was applied through the Management API's
  `database/query` endpoint — the fallback `docs/DEPLOYMENT.md` §4a already blesses. Migration
  history was then recorded in `supabase_migrations.schema_migrations`, which is what
  `migration repair --status applied 0001` would have written.
- **`supabase db diff --linked` cannot run**, so schema parity is checked by
  `npm run schema:parity` instead: the real migration is applied to a throwaway cluster and the
  catalogs are compared against hosted. This is a catalog comparison, not a byte-for-byte DDL
  diff, and should never be reported as "db diff clean".
- **The browser cannot reach the deployed URL**, so the end-to-end run drives a local production
  build that talks to the *real hosted Supabase*. The database, auth, persistence and isolation
  under test are all hosted; only Vercel's edge serving is out of the browser's reach, and that
  was verified separately over HTTP.

The database password never entered into any of this. `supabase link` succeeded without one, and
`db push` failed on a TCP timeout before any password was requested.

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

### Phase 1 hardening (2026-08-13)
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

## Issues found and fixed — Phase 1 hardening pass (2026-08-13)

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
| 14 | **Medium** | `/` and `/setup` were statically prerendered, so `isConfigured()` and the configuration diagnostic were frozen at build time — the diagnostic could never report the running server's environment, and a deployment whose variables changed after build would keep redirecting on stale state | `export const dynamic = 'force-dynamic'` on both. Found by pointing the app at the real project and watching `/setup` insist it was unconfigured |
| 13 | Low | The `/setup` step list overflowed 14–29px at 390/375 once it named `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — a 36-character unbreakable token in a flex child | `min-w-0` + `break-words`. Caught by `npm run test:responsive`, which is the first regression that harness has paid for |

---

## This pass — hosted provisioning

### What was done
- Applied the migration to `omhktzxwffaipmcoljic` and recorded migration history
- Closed criterion E: the account holder ran the cross-device acceptance test on two physical
  machines, both directions
- Verified the hosted schema (15/15) and hosted RLS isolation (all checks passed, rolled back)
- Confirmed catalog parity between the repository migrations and hosted
- Created the Vercel project, set six environment variables across three targets, deployed
- Set the hosted site URL and the five redirect URLs
- Ran end-to-end validation: 16 checks, all passing
- Ran the authenticated responsive audit for the first time: 40 combinations, 0 skipped

### Issues found and fixed

| # | Severity | Issue | Fix |
|---|---|---|---|
| 15 | **Medium — false pass** | The validator asserted a knowledge entry existed by finding its title in the page text. Three forms on the topic page carry a hidden `topicId` and two have an input named `title`, so the submit hit the Open Issues form and created an *action*. Its title rendered, the check passed, and `knowledge_entries` stayed empty | Select the entry form by its `knowledgeType` dropdown, which no other form has. Added database-level assertions so "the page says so" can never again stand in for "the row exists" |
| 16 | Medium | Form controls were `px-3 py-2` — 38px against a 40px minimum touch target — in twelve places across five files. Only `/topics/new` is audited, so fixing just that page would have left the defect on the topic detail screen | All twelve raised to `py-2.5` |
| 17 | Low | The "Topics" back link was a 20px-tall hit area on mobile, in two places | 44px minimum height, visual position unchanged |
| 18 | Medium | The authenticated viewports had never actually run. The first fix exported a session, but the validator deletes its throwaway accounts in cleanup, so the session was invalid by the time a later process used it | The audit now runs inside the validator, before cleanup |
| 19 | Low | Playwright pins an exact browser build and refuses to start without it, which breaks any image shipping its own Chromium once the pinned version moves ahead | `scripts/chromium-path.mjs` falls back to the image's Chromium |

### New tooling

| Command | What it does |
|---|---|
| `npm run provision` | The full hosted sequence. Now runs unattended when `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` and `VERCEL_TOKEN` are set, and bootstraps `.env.local` from the Management API |
| `npm run schema:parity` | Catalog parity between the repository migrations and hosted, without needing a Postgres connection |
| `npm run validate:hosted -- <url>` | End-to-end: auth, persistence, isolation, provenance, and the authenticated responsive audit |

---

## Not validated

Phase 1's criteria all pass. These are honest gaps in *coverage*, not open criteria:

- **Real magic-link email delivery.** Sign-in was exercised through the app's own verification
  route using a link generated by the admin API, and separately by the account holder on two
  physical machines. No automated test sends or clicks an email.
- **Session persistence across a browser restart** is untested by automation.
- **Vercel's edge serving the authenticated pages.** The browser in the build environment cannot
  reach external HTTPS, so the automated end-to-end run drove a local production build against
  hosted Supabase. The deployment itself was verified over HTTP, and the account holder exercised
  the real URL on two machines.
- **Criterion K through the UI.** The supersede control is Phase 2; the SQL function is tested.

---

## Carried into Phase 2

1. **OTP email templates.** Blocked by the free tier: *"Email template modification is not
   available for free tier projects using the default email provider."* Needs a paid plan or
   custom SMTP. Until then, open a sign-in link on the device that requested it. Data continuity
   across devices is unaffected and proven.
2. **Realtime is not wired**; cross-device updates need a refresh. Correctness is unaffected — the
   database is authoritative.
3. **The supersede control is Phase 2 UI.** The SQL function works and is tested.
4. **Export/import and the version-recovery UI are Phase 3.**
5. `entry_subtopics` / `session_subtopics` are guarded by a trigger rather than a composite FK,
   because they carry no `workspace_id` of their own.
6. **Migration history was written directly** rather than by `db push`. A future `db push` from an
   environment with Postgres access should be preceded by `supabase migration list` to confirm the
   CLI agrees `0001` is applied.

---

## Test results (last run, 2026-08-14)

| Suite | Result |
|---|---|
| `npm run build` | pass — 18 routes |
| `npm run typecheck` | pass |
| `npm run lint` | pass, 0 warnings |
| `npm run test` | **48 passed** / 5 files |
| `npm run test:db` | **3 suites passed** against PostgreSQL 16.13, plus both hosted-script smoke tests |
| `npm run schema:parity` | columns 291, enums 14, RLS 24, policies 31, indexes 60, constraints 139, triggers 17, functions 8 — all matching |
| `hosted/01_verify_schema.sql` | **15/15 PASS** against `omhktzxwffaipmcoljic` |
| `hosted/02_rls_isolation.sql` | **ALL HOSTED RLS CHECKS PASSED**, rolled back |
| `npm run validate:hosted` | **16/16 checks pass** |
| Authenticated responsive QA | **40 combinations, 0 skipped, no layout failures** |
| Cross-device acceptance test | **PASS** — Work PC ↔ Mac, both directions, by the account holder |

---

## Next task

**Phase 2 — Memory.** Start on a `phase-2-memory` branch. Phase 1 is closed and merged to `main`;
`main` builds, typechecks, lints, and passes both test suites.

Exit criteria for Phase 2 are in `docs/ARCHITECTURE.md` §13. Do not modify a Phase 1 guarantee
without recording the supersession here, per the process at the bottom of `CLAUDE.md`.

---

## Resume trigger

**IF** returning to ContextShelf development
**THEN** Phase 1 is complete, validated, and merged. The hosted project and the deployment both
exist and are proven, including cross-device continuity on two physical machines. Begin Phase 2 on
a `phase-2-memory` branch, and read "Carried into Phase 2" above before planning — the email
template limitation and the unwired realtime layer are both live constraints.
