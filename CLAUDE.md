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
6. **History tables are insert-only** — `prompt_versions`, `knowledge_entry_versions`,
   `prompt_version_outcomes`, and `prompt_winning_selections`. Enforced by the absence of
   `UPDATE`/`DELETE` RLS policies, not by convention, and asserted by
   `hosted/01_verify_schema.sql`. A judgement that changes later (a rating, a winning version) is
   a new row, never an edit.
7. **Superseding requires a reason.** `supersedes_reason` / `supersede_reason` is mandatory at the
   supersede action. "Why did we change our mind" is the product.
8. **Current State is a read, not a store.** `status = 'active' AND superseded_by_id IS NULL` over
   the same append-only table the Timeline reads.
9. **Rejected and superseded items must appear in generated Resume prompts as an avoid-list, with
   reasons.** This is the feature that stops future Claude sessions re-proposing rejected ideas.
9a. **"Winning" identifies a prompt VERSION, not a prompt.** Once a prompt has several versions,
   "which text produced the best result" cannot be answered at prompt level, and the latest
   version is often a later experiment that did worse. `prompts.is_winning` is derived from the
   selection history by trigger and must never be written directly.

### Automated delivery
9b. **Delivery is not authority.** A machine may record what it observed — repository, branch,
   commit, files touched, build and test results, an implementation, a bug, a fix, an action it
   NAMES as completed, the next action it started. It may never replace Current State, supersede
   or reject a decision, reject an idea, choose a winning prompt version, delete a record or
   resolve a conflict. A decision it proposes is written `proposed` and stays out of the active
   list, out of history and off the avoid list until a person approves it. An operation outside
   the allowlist is refused **by name**, in the payload validator and again in the database —
   never silently ignored, because a caller that gets a 200 for an operation that never happened
   is worse off than one that gets an error.
9c. **An action closes only when a delivery names it.** Its absence from a later payload is
   evidence of nothing. Closing on omission would silently discard work the user still intends
   to do.
9d. **A secret is shown once and stored only as a hash.** Ingestion tokens are minted in one
   place, returned to the caller for display exactly once, and persisted as SHA-256 plus an
   eight-character prefix for recognition. No screen, action, log line or error may render a
   token; the domain type has no field for one. Revoking stamps `revoked_at` — it never deletes
   the row, because "when was that machine cut off" is the audit question.

### Provenance
10. **Two layers, always linked.** Layer 1 `source_sessions` = verbatim, immutable evidence.
    Layer 2 `knowledge_entries` = typed, statused, queryable knowledge. Layer 2 keeps
    `source_session_id` + `source_reference`.
11. **Never invent provenance.** If a source is unknown, `source_type = 'manual'`.
11a. **Stored text is the text that was typed.** HTML form submission rewrites line breaks to CRLF,
    so every textarea in the product was storing bytes nobody entered — which quietly falsifies both
    "Layer 1 is verbatim evidence" and "a prompt body survives byte-for-byte", the second of them
    only discovered when someone pastes that prompt into a terminal. `normaliseNewlines()` runs
    first in every form action. Undoing a transport artefact is not editing content; a lone `\r` is
    content and is left alone.

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
17b. **Suggested is not Confirmed.** Deterministic keyword and recency matching may propose a
    topic, a knowledge type, a duplicate or a conflict. It must never be presented as
    understanding. A suggestion carries the literal evidence that produced it, is typed as a
    `Suggestion<T>` rather than a `T` so a caller has to reach through it, and never becomes
    authoritative without a person confirming it. In a list of proposals, what the source *stated*
    is pre-selected; what was *guessed* is not.
17c. **A provider may suggest; a person confirms.** Model or matcher, the output is a
    `SuggestedRecord` that lands in `extraction_suggestions` and becomes a record only when someone
    confirms it. Confirmation writes a decision `proposed`, an idea `suggested` and a prompt
    version `untested` and never winning; Current State is refused by the batch path by name and
    has its own compare-and-accept flow. Nothing about a suggestion's confidence may pre-select an
    authority-changing kind, and a suggestion that duplicates or conflicts with an existing record
    is never pre-selected either.
17d. **Every user-facing string names whichever provider actually ran.** Deterministic extraction is
    never called AI — "Extract suggestions", "deterministic extraction", "it does not understand the
    conversation" — and a model is never described as deterministic. A reviewer who believes a model
    read their conversation reviews far less carefully than one who knows a matcher scanned it, and
    the review is the only thing between a suggestion and the project's memory. The rule cuts both
    ways, and the second direction is the one that rots: Settings once reported a configured
    variable as unset and called the built-in provider Active while every run went to the model, so
    "which provider is active" is derived from `defaultProvider()` in one place rather than
    re-decided per screen. A provider credential lives in the server environment and never in a
    table, a client bundle, git, this file, or a log.
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
22a. **Capture is one step.** Quick Capture requires content and nothing else — no topic,
    subtopic, knowledge type, source, tag or classification before saving. The Inbox exists so
    capture never interrupts the work it is capturing; anything that made the user stop and decide
    would defeat it. Those all remain optional, during triage.

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
| AD-17 | **Derived read models are database VIEWS with `security_invoker = true`, never materialised tables** | The Timeline and the prompt outcome/winner projections hold nothing of their own, so they cannot drift from the rows they summarise. `security_invoker` is load-bearing rather than decorative: a view runs as its OWNER by default and would read straight past RLS on every underlying table, serving one workspace's history to another while appearing to work. Asserted, not assumed — removing it makes `04_timeline.test.sql` fail with a real leak |
| AD-19 | **Retrieval is one `security_invoker` projection plus a deterministic ranking function, and never a stored copy of a derived read** | Search has to reach Current State and Master Topic Memory, both of which are computed on read (rule 8, AD-8). Indexing them would mean storing them, which is the one thing AD-8 forbids — so the *authoritative columns they are assembled from* carry the search vectors instead, `topics.current_state` and `topics.goal` among them. `context_snapshots` participate as history, and every hit reports whether it is `current`, `historical` or a `snapshot`, so a saved rendering is never mistaken for the live answer. Ranking is `ts_rank_cd` with fixed state multipliers and a total-order tiebreak, so paging cannot drop or repeat a row and the same query always ranks the same |
| AD-20 | **A function that MUTATES rows dispatches on an explicit allowlist of statically compiled statements, never on an interpolated table name** | `entity_exists()` interpolates through `format(%I)` safely only because the enum constrains its input — a guarantee that lives in the type, not the function. For a function that writes, that is too much trust to place in an argument: adding an enum value later, or any future overload taking `text`, would silently widen what a caller can write to. `soft_delete_record()` therefore has one `UPDATE` per supported type and no code path that builds a name. Append-only history, Layer 1 evidence, inbox captures and derived snapshots are each refused explicitly, with their own message |
| AD-21 | **The ingestion endpoint's workspace comes from the token row, and its boundary is an explicit check rather than RLS** | A delivery carries no Supabase session, so there is nothing for a policy to read — the endpoint runs as `service_role`, which bypasses RLS by design. The first design dropped to `authenticated` inside a `SECURITY DEFINER` function so the ordinary policies would apply; PostgreSQL forbids `SET ROLE` there, and a version that silently failed to switch would have looked identical while enforcing nothing. So `ingest_from_token()` is `SECURITY INVOKER`, `EXECUTE` is granted to `service_role` alone, every topic and subtopic lookup is scoped to the token's workspace, and a topic in another workspace is answered exactly as one that does not exist. Because the boundary is code rather than policy, it is asserted in `supabase/tests/08_ingest.test.sql` rather than assumed |
| AD-22 | **Idempotency and duplicate detection are different mechanisms and must never be merged** | Idempotency compares a key the CLIENT chose: the same token and key replay the original receipt and write nothing, and the same key with different content is refused rather than answered with the wrong receipt — enforced by a unique index on `(token_id, idempotency_key)`, not by the endpoint remembering to check. Duplicate detection compares CONTENT and proposes a merge to a person (rule 17). Collapsing them would either make a retry create a duplicate, or make the system silently decide that two genuinely separate deliveries were one |
| AD-23 | **Model assistance is a provider behind a port, and the review is rows** | `ExtractionProvider` names no vendor and omits — rather than merely discourages — every power a provider must not have: it cannot decide duplicates, resolve conflicts, write records or choose what is authoritative. Duplicate and conflict findings come from the Phase 3 fingerprint, because a provider's opinion about whether it has seen a decision before is a guess about a database it cannot see. Suggestions persist in `extraction_suggestions` rather than in component state, because half an hour of review must survive a closed tab, and the row keeps both the current value and the provider's `original` so an edit stays legible as an edit. The deterministic provider needs no credential and sends nothing anywhere, which is what makes every one of these guarantees true whether or not a model is ever configured |
| AD-24 | **A provider contract is verified by making the request, never by reading the client** | Connecting Anthropic found six defects in code that had been reviewed repeatedly and looked correct: `temperature` refused outright, reasoning and answer sharing one `max_tokens` so truncated JSON surfaced as a parse error, a 401 reported as a bare status code, Settings claiming a configured variable was unset, an extraction instruction that never listed the knowledge types it wanted back, and — found only by comparing stored bytes against typed bytes — every textarea in the product storing CRLF. None was visible from the source. So the gate for a provider is `npm run validate:provider`: one real request through the deployed application per run, asserted in the database. It is deliberately a separate script from `validate:hosted`, which must keep passing with no key configured at all — the deterministic floor is the product's honest baseline, and putting live-provider checks there would make a paid dependency mandatory for validation |
| AD-25 | **A validator that cannot fail for the right reason is worse than no validator** | Four checks in this phase reported product problems that did not exist: a wait predicate matching "failed" anywhere on the page, where the triage form offers a *Failed Prompt* type, so it returned before the request ran; a conflict fixture restating the decision under test, so the provider correctly declined to propose a duplicate and the check for that decision failed; a query selecting `supersedes_reason`, a column that does not exist, so three checks read an empty list as an empty database; and a 20-second `networkidle` navigation reporting a layout failure for a page it never loaded. Hence: assertions name exact markers rather than substrings that appear elsewhere, fixtures must not overlap what they sit beside, a failing detail string is computed rather than asserted in prose, and a section that cannot run reports SKIP with its reason and is counted apart from passes |
| AD-18 | **Judgements about a record are appended, never written onto it** | Prompt outcomes and winning-version selections each live in their own append-only table, ordered by an identity sequence — not by `created_at`, which is fixed for a whole transaction and silently degrades to comparing random uuids. Re-rating appends, so a changed judgement is history rather than an overwrite, exactly as superseding is for decisions. The seeding rule keeps this from becoming two sources of truth: a row is written whenever the parent is created, so the newest row is always the answer with no fallback |

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
npm run db:push:hosted             # same, over the Management API when :5432 is unreachable (AD-15)
npm run db:types     # regenerate adapter-internal DB types

npm run provision            # the whole hosted sequence: link, migrate, verify, deploy
npm run schema:parity        # hosted vs repository catalogs, without a Postgres connection
npm run verify:hosted        # the two hosted SQL suites over the Management API (AD-15)
npm run validate:hosted -- <url>   # auth, persistence, isolation, provenance, ingestion, authenticated QA
npm run validate:provider -- <url> # ONE live model request end to end, asserted in the database (AD-24)

npm run contextshelf:sync          # send this Claude Code session to ContextShelf
npm run contextshelf:sync -- --check   # verify the token and what it points at
```

All five of `build`, `typecheck`, `lint`, `test`, and `test:db` must pass before merging to
`main`.

**Query plans are read as the `authenticated` role, never as the table owner.** The owner bypasses
row-level security, so it gets plans no real user will ever get — an index can be perfectly built,
perfectly used by the owner, and unreachable for everyone else. `supabase/tests/07_performance.test.sql`
exists because that had been true of the full-text index since Phase 0 without anyone noticing.

## Layout

```
src/app/            routes — (auth) and (app) groups
src/components/     ui/ primitives · layout/ shell · topics/ · knowledge/
src/lib/domain/     hand-written vendor-neutral types + enums  ← start here
src/lib/ports/      repository interfaces (no vendor names)
src/lib/adapters/   supabase/ — the ONLY place the vendor SDK appears
src/lib/ingestion/  adapters → extract (deterministic) → classify (suggests only) → persist
src/lib/resume/     pure context assembler
src/lib/extraction/ provider port · deterministic provider · validation · chunking · review
src/app/api/ingest/ the authenticated Claude Code endpoint — transport only
supabase/migrations/  checked-in SQL — never change schema from the dashboard
supabase/tests/     SQL suites run by npm run test:db against a real cluster
scripts/            db-test.sh · responsive-qa.mjs
docs/               ARCHITECTURE.md · SCHEMA.md · DEPLOYMENT.md · DEVELOPMENT_STATE.md
```
