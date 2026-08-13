# ContextShelf — Architecture

> Status: **established** (v1, 2026-08-13). This document is the answer to setup steps 1–14.
> Permanent rules distilled from it live in `/CLAUDE.md`. Live project status lives in
> `docs/DEVELOPMENT_STATE.md`.

---

## 1. The problem, restated

The stated problem is "I lose track of things across conversations." The *actual* problem is
narrower and more solvable than that:

**Claude conversations are an append-only, session-scoped, non-queryable log of work that is
actually organized by topic.** Every Claude surface (Chat, Cowork, Code) organizes by *where the
talking happened*. The user's mental model organizes by *what is being worked on*. Every new
conversation restarts context from zero, and the knowledge produced in the old one becomes
unreachable — not deleted, just unfindable, because retrieving it requires remembering which of
200 sessions contained it.

That produces four distinct failure modes, and ContextShelf must solve all four or it solves
none:

| Failure | What it looks like | What fixes it |
|---|---|---|
| **Retrieval failure** | "I know we solved this. I can't find where." | Topic-first IA + universal search over structured entries |
| **Continuity failure** | Every new session re-establishes context by hand, badly | Resume: generated continuation prompts at 3 densities |
| **Amnesia failure** | Claude re-proposes an idea already evaluated and rejected, and the user can't remember *why* it was rejected | Decision Ledger + Idea lifecycle with reasons preserved |
| **Recency-overwrite failure** | The newest summary silently replaces the old one; the reasoning trail is lost | Current State vs. History as two separate reads over one append-only store |

Two corollaries drive most of the design:

- **The system's value is proportional to capture rate.** A perfect model that the user doesn't
  feed is worth nothing. Capture must be cheap (Inbox, uncategorized-first) and, over time,
  automatic (Claude Code hooks, importers). This is why ingestion is a first-class subsystem and
  not a form.
- **The system's value is proportional to trust in its history.** If the user ever suspects
  ContextShelf silently dropped or overwrote something, they stop relying on it and go back to
  scrolling conversations. This is why nothing is ever hard-updated or hard-deleted.

**Non-goals.** ContextShelf is not a note-taking app, not a project manager, not a chat client,
and not an attempt to replace Claude's own memory. It is a *retrieval and continuation layer over
work that already happened*.

---

## 2. Technology stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16 (App Router)** | See below |
| Language | **TypeScript**, `strict` | Non-negotiable for a schema this large |
| UI | **React 19** + **Tailwind CSS v4** + **lucide-react** | As requested; Tailwind v4 needs no JS config file |
| Data access | **Supabase Postgres** via a repository port layer | See §3 |
| Auth | **Supabase Auth** (email magic link + OAuth) | Same system as the DB, so RLS works |
| Hosting | **Vercel** | First-class Next.js target; preview deploys per branch |
| Validation | **Zod** | One schema definition shared by forms, API routes, and ingestion |
| Testing | **Vitest** (unit/domain) + **Playwright** (flows) | Phase-gated; see §13 |

### Next.js over Vite, and why

This was a real decision, not a default. Vite + React SPA is simpler and I'd pick it for a purely
client-side tool. It loses here on four counts specific to this product:

1. **Ingestion needs server endpoints.** Phase 5 requires Claude Code hooks POSTing session data
   to `https://.../api/ingest`. With Vite that means standing up and deploying a second service.
   With Next.js it's a Route Handler in the same repo, same deploy, same types. Since automatic
   ingestion is explicitly the long-term goal and not a nice-to-have, the backend is required, and
   splitting it into two deployments is pure overhead.
2. **Secrets.** Ingestion tokens, and later any server-side LLM calls for summarization/dedupe,
   cannot live in a browser bundle.
3. **Server rendering matches the read pattern.** The dominant interaction is "open a Topic and
   read a lot of joined data." Server Components fetch that in one round trip instead of a
   waterfall of client queries.
4. **Route-level code splitting** across ten top-level sections comes free.

The cost is that Server Components make local-first caching harder — acknowledged in §4 and
scoped accordingly.

### Modularity guardrail

The stack is a choice, not a marriage. Enforced by:

- **All data access goes through `src/lib/ports/*`** — plain TypeScript interfaces
  (`TopicRepository`, `KnowledgeRepository`, …) that mention no vendor.
- **`src/lib/adapters/supabase/*` is the only code that imports the Supabase client.**
- **Domain types in `src/lib/domain/*` are hand-written**, not generated from the vendor's
  types. Generated DB types are an implementation detail of the adapter.

Swapping to Postgres+Drizzle+Auth.js, or to a self-hosted Supabase, means writing one new adapter
directory. Nothing in `app/` or `components/` changes. This rule is load-bearing and is repeated
in `CLAUDE.md`.

---

## 3. Cloud database and authentication

**Supabase** (managed Postgres) for both.

Evaluated against the alternatives that were actually plausible:

| Option | Why not chosen |
|---|---|
| **Firebase / Firestore** | Document store. The whole point of this product is a normalized relational model with heavy cross-entity querying (relationships, supersession chains, timeline unions). Firestore makes exactly those queries painful and forces denormalization — which is how history gets silently overwritten. |
| **PlanetScale / Neon + Auth.js** | Perfectly good, and Neon in particular is a fine Postgres. But auth is then a separate system, and row-level authorization becomes application code that must be correct in every query. Supabase pushes it into the database as RLS, where it can't be forgotten. |
| **Convex** | Excellent sync story, genuinely tempting for the cross-device requirement. Rejected for lock-in: the data model, the query language, and the auth are all proprietary, which directly contradicts the "keep it modular" instruction. |
| **SQLite/Turso local-first + sync** | Best possible offline UX, worst possible time-to-Phase-1, and the sync/conflict layer becomes the product instead of the feature. Revisit only if offline editing becomes a real requirement. |

Supabase wins on the specific combination this product needs:

- **Real Postgres.** Foreign keys, `check` constraints, enums, partial indexes, `tsvector`
  full-text search, recursive CTEs for supersession chains, `jsonb` for provenance metadata. The
  schema in §6 is expressible directly.
- **RLS is the authorization model.** Every table carries `user_id`; every policy is
  `user_id = auth.uid()` (extended to workspace membership). A bug in a React component cannot
  leak another user's data, because the database refuses.
- **Auth is in the same system**, so `auth.uid()` is available inside policies with no token
  plumbing.
- **Postgres full-text search is built in** — no second search service for Phase 3.
- **Storage** for the file-upload path in Phase 3.
- **Point-in-time recovery** on paid tiers backs the "reliable backups" requirement, layered under
  the app-level export/versioning in §14.
- **Exit hatch is a `pg_dump`.** It's just Postgres.

**Auth method:** email magic link as primary (no password to sync between the Mac and the Windows
PC), GitHub OAuth as a secondary. Sessions are cookie-based and refreshed in Next.js middleware so
Server Components can read them.

**Migrations** are checked-in SQL in `supabase/migrations/`, applied with the Supabase CLI. No
"push from the dashboard" — schema drift is how projects like this die.

---

## 4. Cross-device synchronization

The requirement is stated precisely: *the user's computer must not be the source of truth.* The
design takes that literally.

**Model: server-authoritative, with local caching strictly as an accelerator.**

```
Mac (browser)     ─┐
Windows PC        ─┼──►  Next.js (Vercel)  ──►  Supabase Postgres   ◄── source of truth
Future device     ─┘         ▲                        │
                             └── Realtime push ───────┘
```

1. **All writes go to Postgres.** No write is ever considered committed until the database
   acknowledges it. The UI shows pending state; it does not lie about success.
2. **`updated_at` is set by a database trigger**, not by the client. Client clocks disagree
   between machines and cannot be trusted to order events.
3. **Local caching is read-through only.** The React Query cache and Next.js server cache hold
   *copies*. They are invalidated on write and on tab focus. Nothing lives only in the cache, and
   `localStorage` holds nothing but UI preferences (sidebar state, density, theme).
4. **Conflict-safety comes from the data model, not from a merge algorithm.** This is the key
   insight and it falls out of the append-only rule:
   - Knowledge entries, decisions, and prompts are **never updated in place**. An "edit" writes a
     new row/version and marks the previous one `superseded`. Two devices editing the same entry
     produce two versions, both preserved, with the second flagged as a divergence for the user to
     resolve. Nothing is lost, so nothing needs to be merged automatically.
   - The few genuinely mutable scalar fields (topic name, status, description) use
     **optimistic concurrency**: the client sends the `updated_at` it read; the `UPDATE`'s `WHERE`
     clause includes it; zero rows affected means someone else won, and the UI surfaces a
     "changed on another device — review" prompt rather than clobbering.
5. **Live updates** via Supabase Realtime on the tables a device is currently viewing. Nice, not
   required for correctness — a refresh gets the same result.
6. **Offline** is explicitly *degraded, not supported*, in v1: reads work from cache, writes are
   disabled with a clear banner. Queueing offline writes is a Phase 6+ decision and is recorded as
   such rather than half-built. Faking it would violate the "no fake sync" rule.

---

## 5. Core information architecture

```
User
 └── Workspace                     (a life-area container; most users need one)
      └── Topic                    (the primary organizational unit — e.g. "DailyRelay")
           ├── Subtopic            (e.g. "Branding" → "App Icon"; nestable)
           │    └── …
           ├── KnowledgeEntry      (the atom: typed, statused, provenanced)
           ├── Decision  ─┐
           ├── Idea       │         first-class projections of knowledge, with
           ├── Prompt     ├── their own lifecycle fields and their own pages
           ├── Action     │
           ├── Milestone ─┘
           ├── FileReference
           ├── SourceSession       (evidence: the Chat/Cowork/Code session that produced entries)
           └── ContextSnapshot     (the derived Master Topic Memory)
```

**The load-bearing rules:**

- **A Topic is the unit of thought. A SourceSession is a citation.** Sessions are never primary
  navigation, never a top-level list on the Home screen, and never rendered as one generic card
  standing in for their contents. They appear as the *provenance line* on entries, and as a
  filter.
- **Every knowledge-bearing record has a `topic_id`.** Subtopic is optional and refinement-only,
  so a Topic view always shows everything beneath it without gaps.
- **One session fans out into many entries.** The importer's job is to split, not to store a blob.
- **Decision / Idea / Prompt are not folders of notes.** They are entities with their own
  lifecycles (approved/rejected, suggested→implemented, worked/failed) *plus* a
  `KnowledgeEntry` shadow so they participate in the unified timeline and search.

**Navigation** (fixed, per spec): Home · Topics · Inbox · Timeline · Prompts · Ideas · Decisions ·
Files · Search · Settings. Claude Chat / Cowork / Code appear **only** as source filters and
badges.

---

## 6. Normalized database schema

Full DDL: `supabase/migrations/0001_init.sql`. Reference notes: `docs/SCHEMA.md`.
Shape and reasoning:

### Enums

```
source_type       : claude_chat | claude_cowork | claude_code | manual | file | url |
                    imported_transcript | api | mcp | browser_extension
knowledge_type    : progress | implementation | decision | idea | suggestion | prompt |
                    winning_prompt | failed_prompt | requirement | change | added | removed |
                    refactored | bug | fix | research | file | link | blocker | question |
                    next_step | milestone | rejected_idea | important_context
entry_status      : active | superseded | rejected | replaced | deprecated | archived
topic_status      : active | paused | blocked | completed | archived
idea_status       : suggested | considering | approved | implemented | deferred | rejected
decision_status   : active | superseded | reversed | deprecated
prompt_result     : untested | worked | partially_worked | failed | superseded
action_status     : open | in_progress | blocked | done | dropped
ingestion_status  : unsorted | classified | processed | discarded
relationship_type : produced | resulted_in | supersedes | resolves | caused | belongs_to |
                    relates_to | duplicates | contradicts | implements | derived_from
```

### Tables

**Identity & container**
- `profiles` — mirrors `auth.users`, holds display prefs.
- `workspaces` — `id, owner_id, name, slug, timestamps`.
- `workspace_members` — `workspace_id, user_id, role`. Present from day one so sharing later is
  not a migration of every RLS policy.

**Organization**
- `topics` — `id, workspace_id, user_id, name, slug, description, goal, current_state, status,
  progress (0–100), color, pinned, resume_trigger_if, resume_trigger_then, last_meaningful_update_at,
  archived_at, timestamps`.
  `last_meaningful_update_at` is deliberately distinct from `updated_at`: renaming a topic is not
  progress, and freshness indicators must not be fooled by cosmetic edits.
- `subtopics` — `id, topic_id, parent_subtopic_id (nullable, self-FK for nesting), name, slug,
  description, goal, current_state, status, resume_trigger_*, position, archived_at, timestamps`.
  Nesting supports "Branding → App Icon". Cycles are blocked by a trigger.

**Provenance**
- `source_sessions` — `id, workspace_id, topic_id?, source_type, title, external_url,
  occurred_at, summary, raw_content (text), repo_url, branch, commit_sha, files_changed (jsonb),
  files_added, files_removed, build_status, test_summary, artifacts (jsonb), metadata (jsonb)`.
  This is **Layer 1**: the raw record, stored verbatim, never edited.

**The knowledge atom**
- `knowledge_entries` — `id, workspace_id, topic_id, user_id, knowledge_type, status, title,
  content, source_type, source_session_id?, source_reference, occurred_at, superseded_by_id (self-FK),
  supersedes_reason, importance, confidence, metadata (jsonb), search_vector (generated tsvector),
  created_at, updated_at, deleted_at`.
  This is **Layer 2**. `entry_subtopics` is a join table (an entry can span subtopics).
- `knowledge_entry_versions` — every prior body of an edited entry. Append-only.

**First-class projections**
- `decisions` — `id, topic_id, subtopic_id?, knowledge_entry_id?, title, decision, reason,
  alternatives (jsonb[]), approved_direction, status, decided_at, superseded_by_id,
  supersede_reason, source_session_id, metadata`.
- `ideas` — `id, topic_id, subtopic_id?, knowledge_entry_id?, title, idea, rationale, status,
  decision_id?, implementation_entry_id?, source_session_id, metadata`.
- `prompts` — `id, topic_id, subtopic_id?, title, purpose, source_type, current_version_id,
  is_winning, tags, metadata`.
- `prompt_versions` — `id, prompt_id, version (int), body, result (prompt_result), rating (1–5),
  notes, output_summary, related_entry_id, created_at`. **Insert-only. No `UPDATE` grant.** This
  is how "never overwrite a prompt" is enforced at the database level rather than by convention.
- `file_references` — `id, topic_id, subtopic_id?, path, display_name, kind (repo_file | upload |
  url), url, storage_path, repo_url, branch, commit_sha, last_seen_at, metadata`.
- `actions` — next steps / blockers / open questions: `id, topic_id, subtopic_id?, title, detail,
  kind (next_step | blocker | question), status, due_at, resolved_at, resolution_entry_id`.
- `milestones` — `id, topic_id, title, detail, achieved_at, status`.

**Cross-cutting**
- `relationships` — `id, workspace_id, from_type, from_id, relationship_type, to_type, to_id,
  note, created_at`. A polymorphic edge table so "Prompt → produced → Idea → resulted_in →
  Decision → resulted_in → Implementation" is one queryable graph instead of a dozen nullable FKs.
  Integrity is enforced by a trigger that validates `(type, id)` against the named table.
- `tags` + `taggables` — polymorphic tagging, same pattern.
- `context_snapshots` — `id, topic_id, subtopic_id?, density (compact|standard|full_audit),
  body (text), inputs (jsonb: the IDs that fed it), generated_at, is_current`. The Master Topic
  Memory. Derived, regenerable, versioned — never the source of truth.
- `ingestion_records` — the Inbox: `id, workspace_id, user_id, raw_content, content_type,
  source_type, source_hint, suggested_topic_id, topic_id?, subtopic_id?, status, error, payload
  (jsonb), created_source_session_id, created_entry_ids (uuid[]), created_at, processed_at`.
  Every path into the system — paste, upload, URL, JSON, Claude Code hook, future MCP — writes
  here first. One funnel, one normalizer, one audit trail.
- `deletion_log` — soft-delete tombstones with the full serialized row, for undo and recovery.

### Indexing

- `search_vector` GIN on `knowledge_entries`, plus GIN on `prompt_versions.body` and
  `source_sessions.raw_content` for transcript search.
- `(topic_id, occurred_at DESC)` on entries — the timeline query.
- Partial indexes on `status = 'active'` for Current State reads.
- `(from_type, from_id)` and `(to_type, to_id)` on relationships.

### Invariants enforced *in the database*, not in the UI

- `updated_at` maintained by trigger.
- `prompt_versions` and `knowledge_entry_versions` have no `UPDATE`/`DELETE` policy.
- Superseding an entry writes the new row and sets the old one's `superseded_by_id` in one
  transaction (a `supersede_entry()` SQL function), so a partial failure can't orphan history.
- Deletes are `UPDATE … SET deleted_at = now()` plus a `deletion_log` row. Hard delete is an
  explicit admin path, not a button.

---

## 7. Raw sources ↔ structured knowledge

Two layers, one link, never collapsed:

```
   Layer 1: EVIDENCE                        Layer 2: KNOWLEDGE
   ─────────────────                        ──────────────────
   SourceSession                            KnowledgeEntry ── projections ──► Decision
   • verbatim transcript      1 ────► N     • typed                           Idea
   • immutable                              • statused                        Prompt
   • git metadata                           • summarized                      Action
   • external URL                           • topic/subtopic assigned         FileReference
        ▲                                        │
        └──────── source_session_id ─────────────┘
```

- **Layer 1 is written once and never edited.** It is the receipt. If a summary is wrong, the
  transcript proves what was actually said.
- **Layer 2 is the queryable, human-scale product.** Entries carry
  `source_session_id` + `source_reference` (a line range, message index, or anchor), so every
  card in the UI can offer *"view in original."*
- **Fan-out is mandatory.** A 40-message Claude Chat becomes N entries — three decisions, two
  prompts, an idea, a blocker — not one card labeled "Claude Chat, Aug 3."
- **Provenance survives editing.** Editing an entry writes a version and keeps the original
  `source_session_id`.
- **Manual entries are legitimate.** `source_type = 'manual'` with a null session. Provenance is
  "the user said so," which is honest and preserved.
- **Un-sourced knowledge is never invented.** If an importer cannot attribute a claim, it does not
  create an entry.

---

## 8. Current State vs. History

The distinction is a **read**, not a **store**. There is exactly one append-only store; Current
State is a filtered projection of it.

```
History  = SELECT * FROM knowledge_entries WHERE topic_id = ? ORDER BY occurred_at   -- everything
Current  = the same rows WHERE status = 'active' AND superseded_by_id IS NULL        -- the head
```

Worked example from the brief:

| | Entry | Status | Superseded by |
|---|---|---|---|
| v1 | Blue icon concept proposed | `superseded` | v3 |
| v2 | Checkmark concept rejected | `rejected` | — |
| v3 | Slash → arrow → X geometry approved | `active` | — |

- **Current State** renders v3.
- **Timeline** renders v1, v2, v3 in order, each labeled with its status.
- **Resume prompts** include v3 as the direction, and v1/v2 in the *"previously rejected — do not
  re-propose"* section. This is the mechanism that stops a fresh Claude session from re-suggesting
  the checkmark.

Statuses (`active`, `superseded`, `rejected`, `replaced`, `deprecated`, `archived`) are per the
spec; `deleted_at` is separate and orthogonal.

Rules:
1. **Nothing is deleted to make room for something newer.** Superseding writes a link, not a
   `DELETE`.
2. **Superseding requires a reason.** `supersedes_reason` is required by the supersede action —
   it's the field that answers "why did we change our mind?", which is the whole point.
3. **`ContextSnapshot` (Master Topic Memory) is derived and disposable.** It is regenerated from
   active entries; it is stored so Resume is fast and so you can see how your understanding
   evolved, but deleting all snapshots loses nothing recoverable.
4. **Current Memory is curated, not concatenated.** Composition rules — active decisions, open
   actions, current state fields, winning prompts, recent meaningful changes, explicitly-flagged
   permanent rules — with rejected directions summarized as a *guardrail list*, not replayed in
   full.

---

## 9. Ingestion architecture

Everything enters through one funnel. Manual paste is an *adapter*, not the design.

```
 Claude Chat paste ─┐
 Cowork transcript ─┤
 Claude Code hook  ─┤    ┌───────────┐   ┌────────────┐   ┌───────────┐   ┌──────────┐
 Structured JSON   ─┼──► │  Adapter  │──►│ Normalizer │──►│ Persister │──►│ Classify │
 File upload       ─┤    │ (per src) │   │ (canonical │   │ (raw +    │   │ (topic/  │
 URL               ─┤    └───────────┘   │  payload)  │   │  entries) │   │  type)   │
 Manual note       ─┤                    └────────────┘   └───────────┘   └──────────┘
 Future MCP / API  ─┘           all write an `ingestion_records` row first
```

**Stage 1 — Adapter** (`src/lib/ingestion/adapters/*`). One per source shape. Its only job:
turn input into the canonical payload. Signature:

```ts
interface IngestionAdapter<TInput = unknown> {
  id: string;                                   // 'claude-code-hook', 'transcript-paste', …
  sourceType: SourceType;
  detect(input: unknown): boolean;              // for the "paste anything" Inbox
  parse(input: TInput): Promise<NormalizedIngestion>;
}
```

**Stage 2 — Canonical payload.** Every adapter emits the same shape, so nothing downstream knows
where data came from:

```ts
interface NormalizedIngestion {
  sourceType: SourceType;
  title?: string;
  occurredAt?: string;
  externalUrl?: string;
  raw: string;                       // verbatim Layer 1
  segments: NormalizedSegment[];     // candidate Layer 2 entries
  code?: ClaudeCodeMetadata;         // repo/branch/commit/files/build/tests
  hints?: { topic?: string; subtopic?: string; tags?: string[] };
}
interface NormalizedSegment {
  knowledgeType: KnowledgeType;
  title: string;
  content: string;
  sourceReference?: string;          // anchor back into `raw`
  confidence: number;                // 0–1; low confidence → needs review, never auto-filed
  occurredAt?: string;
}
```

**Stage 3 — Persist.** One transaction: `ingestion_records` (audit) → `source_sessions` (Layer 1)
→ `knowledge_entries` + projections (Layer 2), all linked.

**Stage 4 — Classify.** Suggests topic/subtopic/type. **Suggestions are never auto-applied above
the confidence threshold without a review step in v1** — misfiling silently is worse than an
inbox item. Phases: Phase 3 = deterministic (keyword/slug/recency); Phase 6 = model-assisted, with
the same confirm gate.

**Stage 5 — Dedupe/conflict** (Phase 6) runs *before* commit and can only *propose*: similar
topic, duplicate entry, duplicate prompt body, conflicting decision, newer-decision-supersedes.
Per the working rules, it never merges silently.

**Transport surfaces:**
- `POST /api/ingest` — JSON, bearer token from `ingestion_tokens`, scoped to a workspace. The
  target for Claude Code hooks, scripts, and future MCP.
- Inbox UI — paste / upload / URL, runs the same pipeline in-process.
- Both converge before anything is written, so there is one code path to test and trust.

---

## 10. Resume architecture

Resume is the product's payoff, so it's a real subsystem, not a template string.

```
  Topic (+ optional Subtopic)
        │
        ▼
  Context Assembler  ── pulls: topic fields · active decisions · rejected directions ·
        │                     winning prompts · open actions/blockers/questions ·
        │                     recent meaningful entries · file references ·
        │                     milestones · resume trigger
        ▼
  Density Filter  ──  compact │ standard │ full_audit
        │
        ▼
  Target Formatter  ──  claude_chat │ claude_cowork │ claude_code
        │
        ▼
  Generated prompt  ──►  copy · download · save as ContextSnapshot
```

**Assembly** (`src/lib/resume/assemble.ts`) is pure: `(TopicContext, Options) => ResumePrompt`.
Pure means testable, and the tests assert the properties that matter — *rejected decisions always
appear in the avoid-list*, *superseded entries never appear as current*.

**Densities**
- **Compact** — goal, current state, active decisions, recent changes, immediate next step. Sized
  to paste at the top of a new chat.
- **Standard** — Compact + requirements, important prompts, implementation detail, open tasks,
  files, recent history.
- **Full Audit** — complete record: all decisions with reasons, all prompt versions, rejected
  ideas, added/removed, implementations, milestones, source references, chronological progression.

**Target shaping** — same facts, different framing:
- *Claude Chat* — prose-first, conversational, light on paths.
- *Cowork* — document/deliverable framing, artifacts and file references foregrounded.
- *Claude Code* — repo, branch, last commit, files changed, build/test status, `CLAUDE.md`-style
  constraint list, and a single concrete next task.

**The avoid-list is mandatory in every density,** including Compact. It carries rejected ideas and
superseded decisions *with their reasons*. This is the single feature that answers "stop future
Claude sessions from re-recommending things we already rejected," and it is why the reason field
is required at supersede time.

**Implementation Intentions** are used narrowly, as instructed: one `IF … THEN …` Resume Trigger
per Topic and optionally per Subtopic, rendered at the top of the Topic page and injected at the
top of the generated prompt. Historical entries are *not* forced into If-Then shape.

---

## 11. Desktop navigation and Topic page

```
┌────────────┬─────────────────────────────────────────────┬──────────────────┐
│ SIDEBAR    │  WORKSPACE                                  │ CONTEXT PANEL    │
│ 240px      │  fluid, max 1100px content column           │ 320px, optional  │
├────────────┼─────────────────────────────────────────────┼──────────────────┤
│ Workspace  │  Topic header                               │ Resume in Claude │
│ switcher   │   name · status · progress · freshness      │  ▸ Chat          │
│            │                                             │  ▸ Cowork        │
│ ▸ Home     │  ┌── CURRENT ─────────────────────────────┐ │  ▸ Code          │
│ ▸ Inbox 3  │  │ Goal                                   │ │  density: ○ ○ ○  │
│ ▸ Topics   │  │ Current State                          │ │                  │
│ ▸ Timeline │  │ Next Recommended Action                │ │ Resume Trigger   │
│ ▸ Prompts  │  │ Resume Trigger (IF → THEN)             │ │  IF … THEN …     │
│ ▸ Ideas    │  └────────────────────────────────────────┘ │                  │
│ ▸ Decisions│  ┌─ Active Decisions ─┬─ Open Issues ─────┐ │ Related          │
│ ▸ Files    │  │ violet cards       │ blockers/questions│ │  subtopics       │
│ ▸ Search   │  └────────────────────┴───────────────────┘ │  files           │
│ ▸ Settings │                                             │  sessions        │
│            │  Subtopics ▸ grid                           │                  │
│ ── Pinned  │                                             │ Quick actions    │
│  DailyRelay│  [ Timeline │ Knowledge │ Decisions │ Ideas  │  add entry       │
│            │    Prompts │ Files │ Sessions │ Memory ]     │  export          │
│  ⌘K search │  ── tab body, filterable by source/type ──   │                  │
└────────────┴─────────────────────────────────────────────┴──────────────────┘
```

The vertical order answers the seven questions in the brief top-to-bottom: *What is this →
What are we trying to accomplish → Where are we now → What changed → What's decided → What's
unresolved → What next.* Reading stops as soon as the user has what they came for.

**Visual language.** Neutral slate/zinc foundation, one accent, and **color carries exactly one
meaning: knowledge type** (progress green, implementation emerald, decision violet, idea amber,
prompt blue, winning prompt cyan, blocker red, removed/rejected rose, research indigo, files
slate). Source is a small monochrome badge with an icon. No gradients, no glass, no glow. Density
over decoration.

---

## 12. Mobile architecture

Designed, not shrunk.

- **Single column**, one purpose per screen.
- **Bottom tab bar**: Home · Topics · Capture (center, prominent) · Search · More. The remaining
  sections live behind *More* — chosen because capture and retrieval are the mobile jobs; curation
  is a desktop job.
- **Quick Capture** is the center action: full-screen sheet, paste/type, optional topic, save to
  Inbox in one tap. Everything else about capture is deferred to desktop.
- **Topic page becomes a stack**: Current State is always visible; Decisions / Timeline / Prompts
  / Files collapse into accordions, closed by default, count shown on the header.
- **Sticky Resume bar** pinned above the tab bar on any Topic screen — one tap to generate, one
  tap to copy. Compact density is the mobile default.
- **Sheets/drawers, not gestures, for essential functions.** Every action reachable by tapping a
  visible control. Swipe is an accelerator only.
- **Large search field** at the top of Home and Topics, not an icon.
- Implementation: one component tree, responsive via Tailwind breakpoints, with a
  `useMediaQuery`-driven swap only where the interaction genuinely differs (right panel → bottom
  sheet). No separate mobile app tree to keep in sync.

---

## 13. Phased roadmap

Per the spec, with explicit exit criteria — a phase is done when its criteria pass, not when its
files exist.

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 · Architecture** | This document, CLAUDE.md, dev-state file, repo skeleton, schema DDL | ✅ Committed |
| **1 · Foundation** | Next.js app, Supabase project, auth, migrations applied, RLS verified, Topics + Subtopics + Knowledge Entries CRUD, Home, Topic page, responsive shell | Sign in on two devices, create a topic on one, see it on the other. RLS denies cross-user reads (tested). |
| **2 · Memory** | Timeline, Decisions, Ideas, Prompts + versions, supersession UI, Current State, Master Topic Memory, Relationships | Supersede a decision; Current shows new, Timeline shows both, reason recorded. Prompt v2 never destroys v1. |
| **3 · Capture & retrieval** | Inbox, Quick Capture, full-text search + filters, file/URL references, JSON + transcript import | Paste a transcript → N entries with provenance. Search finds content inside transcripts. |
| **4 · Continuation** | Resume in Claude, 3 densities, 3 targets, Resume Triggers, snapshots | Generated prompt starts a fresh session with no manual context, and contains the avoid-list. |
| **5 · Claude Code integration** | `/api/ingest`, tokens, git metadata model, hook scripts, MCP pathway | A real `git commit` in a real repo produces a real ContextShelf entry with no manual step. |
| **6 · Automation** | Browser companion architecture, Chat/Cowork ingestion, auto-classification, duplicate & conflict detection, suggested summaries | Duplicate detection proposes (never applies) merges; user confirms. |

Cross-cutting from Phase 1 onward: export/import, soft-delete + recovery, mobile parity, tests.

---

## 14. Technical risks and external dependencies

Ordered by how much they threaten the product.

**R1 — Capture rate (highest risk, and it is not technical).**
If manual entry is the only path, the shelf goes stale in a month and the product fails.
*Mitigation:* Inbox accepts unstructured paste with zero required fields; Phase 5 automates the
one source that *can* be automated today (Claude Code); Home surfaces stale topics so decay is
visible rather than silent.

**R2 — No supported export/API for Claude Chat and Cowork.**
There is no documented programmatic transcript feed. This is a hard external dependency and it is
**not** solvable by wishing.
*Mitigation:* transcript paste and structured JSON import in Phase 3 are real, working paths;
the adapter interface means a future export/API/extension is a new adapter, not a rewrite. **The
UI must never present automatic Chat/Cowork ingestion as existing before it does.**

**R3 — Claude Code hook stability.**
Phase 5 depends on hook/settings surfaces that can change between versions.
*Mitigation:* the hook script is a thin POST to a versioned `/api/ingest`. If hooks change, one
small script changes. Keep a manual `contextshelf log` CLI fallback.

**R4 — Summarization quality.**
Auto-splitting a transcript into typed entries is genuinely hard, and wrong entries poison the
memory that Resume depends on.
*Mitigation:* confidence scores, human review gate before filing, raw transcript always retained
so any bad extraction is correctable rather than lossy.

**R5 — Context snapshot drift.**
A stale Master Memory is worse than none, because it is trusted.
*Mitigation:* snapshots are timestamped, marked stale when newer entries exist, and regenerable on
demand.

**R6 — RLS misconfiguration.** A missing policy is a data leak.
*Mitigation:* deny-by-default; every table gets policies in the same migration that creates it; a
Phase 1 test signs in as user B and asserts zero rows from user A.

**R7 — Polymorphic `relationships` integrity.** No FK can span tables.
*Mitigation:* a validating trigger, a bounded `entity_type` enum, and a nightly orphan check.

**R8 — Supabase vendor risk.** Managed service, pricing/policy changes possible.
*Mitigation:* the port/adapter boundary in §2, plain Postgres, `pg_dump` + JSON export always
available.

**R9 — Search cost at scale.** Postgres FTS is right for one user with thousands of entries. If
this ever needs semantic search, `pgvector` is available in the same database — deliberately not
built now.

**R10 — Solo-user scope creep.** The spec is large. Building it all at once produces a demo, not a
system.
*Mitigation:* the phase gates above, and the rule that placeholders are never labeled as features.
