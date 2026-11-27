# ContextShelf — Concept Brief for an Artifact Rebuild

> **Purpose.** A standalone explanation of what ContextShelf is, what it is for, and which of its
> rules are load-bearing — written so it can be pasted into a brand-new Claude conversation with
> zero prior context.
>
> **Read §7 before acting on this.** ContextShelf is already a deployed, working product at Phase 6.
> An Artifact rebuild is not a rescue; it is a deliberate trade-off, and §7–8 state what it costs.

---

## 1. The problem, stated precisely

The surface complaint is "I lose track of things across Claude conversations." The actual problem
is narrower and more solvable:

**Claude conversations are an append-only, session-scoped, non-queryable log of work that is
actually organized by topic.**

Every Claude surface — Chat, Cowork, Code — organizes by *where the talking happened*. The user's
mental model organizes by *what is being worked on*. Every new conversation restarts context from
zero, and the knowledge produced in the old one becomes unreachable: not deleted, just unfindable,
because retrieving it requires remembering which of two hundred sessions contained it.

That produces four distinct failure modes. ContextShelf must solve all four or it solves none.

| Failure | What it looks like | What fixes it |
|---|---|---|
| **Retrieval** | "I know we solved this. I can't find where." | Topic-first structure + search over typed entries |
| **Continuity** | Every new session re-establishes context by hand, badly | Generated continuation prompts at three densities |
| **Amnesia** | Claude re-proposes an idea already evaluated and rejected, and nobody remembers why | Decision ledger + idea lifecycle, reasons preserved |
| **Recency-overwrite** | The newest summary silently replaces the old one; the trail is lost | Current State and History as two reads of one append-only store |

Two corollaries drive most of the design:

- **Value is proportional to capture rate.** A perfect model nobody feeds is worth nothing. Capture
  must be nearly free, and over time automatic.
- **Value is proportional to trust in the history.** If the user ever suspects the shelf quietly
  dropped or overwrote something, they stop relying on it. This is why nothing is hard-updated or
  hard-deleted.

**Non-goals.** Not a note app. Not a project manager. Not a chat client. Not a replacement for
Claude's own memory. It is a *retrieval and continuation layer over work that already happened*.

---

## 2. The core principle

**Topic-first, never session-first.**

```
Workspace → Topic → Subtopic → Knowledge → Source
```

Claude Chat, Cowork, and Claude Code are **sources**: a badge and a filter on an entry. They are
never navigation, never a top-level list, and never a card standing in for their own contents.

```
DailyRelay (Topic)
 └── Branding (Subtopic)
      └── App Icon (Subtopic)
           ├── "Blue icon concept"        idea           · Claude Chat, Aug 3  · SUPERSEDED
           ├── "Checkmark concept"        rejected idea  · Claude Chat, Aug 4  · reason kept
           ├── "Slash→arrow→X geometry"   decision       · Cowork, Aug 5       · ACTIVE
           ├── "Icon export script"       implementation · Claude Code, Aug 5
           └── "Test the relay nudge"     next step
```

**One session fans out into many entries.** A forty-message chat becomes three decisions, two
prompts, an idea and a blocker — not one card labelled "Claude Chat, Aug 3."

---

## 3. The guarantees that make this ContextShelf and not a note app

Preserve these. Everything else is negotiable.

1. **Nothing is ever destroyed.** Editing writes a new version. Replacing writes a *supersession
   link*. Deleting marks `deletedAt` and writes a restorable tombstone.
2. **Superseding requires a reason.** "Why did we change our mind" *is* the product. A blank
   reason must be refused.
3. **Current State is a read, not a store.** `status = active AND supersededBy = null` over the
   same records the Timeline reads. No second "current" table to drift.
4. **Rejected and superseded items appear in every generated resume prompt as an avoid-list, with
   reasons.** The single feature that stops a fresh Claude session re-proposing the checkmark icon
   three months later. Mandatory at *every* density, including the shortest.
5. **Two provenance layers, always linked.** Layer 1 is the verbatim source — written once, never
   edited. Layer 2 is typed, statused knowledge holding a pointer back. Every card can offer
   "view in original."
6. **Never invent provenance.** Unknown source ⇒ `manual`.
7. **Version history is append-only.** Prompt and entry versions are never overwritten.
8. **Judgements about a record are appended, never written onto it.**
9. **A provider may suggest; a person confirms.** No model output becomes project memory without
   someone agreeing to it, and a reviewer always knows what produced a suggestion.
10. **Duplicate and conflict detection proposes; the user confirms.** Never silently merge.
11. **Never label a placeholder as a finished feature**, and never fake synchronization or
    integrations.

---

## 4. The data model

Vendor-neutral. The live implementation has **29 tables, 4 views and 38 RLS policies** across
migrations `0001`–`0007`. The conceptually important part:

**Organization**
- `Workspace` — container.
- `Topic` — the primary unit: `name, description, goal, currentState, status, progress,
  resumeTriggerIf, resumeTriggerThen, lastMeaningfulUpdateAt`.
- `Subtopic` — nestable tree (Branding → App Icon), same shape, own resume trigger.

**Provenance (Layer 1)**
- `SourceSession` — verbatim evidence: `sourceType, title, externalUrl, occurredAt, summary,
  rawContent`, plus Claude Code specifics `repoUrl, branch, commitSha, filesChanged/Added/Removed,
  buildStatus, testSummary`.

**Knowledge (Layer 2)**
- `KnowledgeEntry` — the atom: `knowledgeType, status, title, content, sourceType,
  sourceSessionId, sourceReference, occurredAt, supersededById, supersedesReason, importance`.
- `KnowledgeEntryVersion` — append-only history of edited bodies.

**First-class projections** (own lifecycle *and* a timeline presence)
- `Decision` — `decision, reason, alternatives[], approvedDirection, status, supersededById,
  supersedeReason`.
- `Idea` — `suggested → considering → approved → implemented → deferred → rejected`.
- `Prompt` + `PromptVersion` — `body, result, rating, notes`; versions insert-only, `isWinning`
  flags the keeper.
- `Action` — `kind: nextStep | blocker | question`.
- `Milestone`, `FileReference`.

**Cross-cutting**
- `Relationship` — polymorphic edge `(fromType, fromId) → relationshipType → (toType, toId)`.
  Makes *Prompt → produced → Idea → resulted_in → Decision → resulted_in → Implementation →
  caused → Bug ← resolves ← Fix* one queryable graph.
- `Tag`, `ContextSnapshot` (derived Master Topic Memory — regenerable, never authoritative),
  `IngestionRecord` (the Inbox — every input lands here first), `DeletionLog`,
  `ExtractionRun` + `ExtractionSuggestion` (Phase 6 review rows).

**Enums that carry real meaning**

- **24 knowledge types:** progress · implementation · decision · idea · suggestion · prompt ·
  winningPrompt · failedPrompt · requirement · change · added · removed · refactored · bug · fix ·
  research · file · link · blocker · question · nextStep · milestone · rejectedIdea ·
  importantContext
- **10 source types:** claudeChat · claudeCowork · claudeCode · manual · file · url ·
  importedTranscript · api · mcp · browserExtension
- **6 entry statuses:** active · superseded · rejected · replaced · deprecated · archived
- **3 densities:** compact · standard · fullAudit — **3 targets:** chat · cowork · code

`lastMeaningfulUpdateAt` is deliberately separate from `updatedAt`: renaming a topic is not
progress, and freshness must not be fooled by cosmetic edits.

---

## 5. Screens

Navigation is fixed: **Home · Topics · Inbox · Timeline · Prompts · Ideas · Decisions · Files ·
Search · Settings.** (18 routes live, plus `/api/ingest`.)

**Home** answers: what have I been working on, where did I leave off, what needs attention, what
should I resume. Continue Working · Recently Active · Waiting/Blocked · Recent Decisions · New
Ideas · Winning Prompts · Unsorted Inbox · Stale Topics.

**Topic page** answers seven questions top-to-bottom, so reading stops as soon as the user has
what they came for:

```
What is this? → Goal → Current State → What changed →
What is decided → What is unresolved → What next
```

Header (name, status, progress, freshness) → **Current** block (Goal, Current State, Next
Recommended Action, Resume Trigger) → Active Decisions and Open Issues side by side → Subtopics →
capture → **Timeline** (every entry, chronological, filterable, superseded entries visibly muted
rather than hidden).

**Timeline filters:** All · Claude Chat · Cowork · Claude Code · Decisions · Ideas · Prompts ·
Changes · Progress · Files · Problems · Date.

**Resume in Claude** — the payoff. Pick a target and a density; get a continuation prompt holding
only current, relevant context *plus the avoid-list*. The assembler is a **pure function** so its
guarantees are testable: *rejected decisions always appear in the avoid-list*, *superseded entries
never appear as current*.

**Mobile is designed, not shrunk.** Single column, bottom nav (Home · Topics · **Capture** ·
Search · More), sticky Resume bar, accordions closed by default with counts. Nothing essential is
gesture-only. Touch targets ≥ 40px; no horizontal overflow at 375px.

**Visual language.** Neutral slate foundation, one accent, information-dense, calm. **Colour
signals exactly one thing: knowledge type** — Progress green · Implementation emerald · Decision
violet · Idea/Suggestion amber · Prompt blue · Winning prompt cyan · Blocker red ·
Removed/Rejected rose · Research indigo · Files slate. Source badges are secondary and monochrome.
No gradients, glass, or glow.

---

## 6. Where the real product stands

**Live at <https://contextshelf.vercel.app>**, backed by Supabase `omhktzxwffaipmcoljic`,
migrations `0001`–`0007`, 29 tables / 4 views / 38 policies. 129 source files, 19 test suites,
25 architecture decisions on record. **Phases 1–6 are closed and merged.**

| Phase | Delivered |
|---|---|
| 1 Foundation | Auth, topics, nested subtopics, typed entries, Home, Topic page, responsive shell |
| 2 Memory | Timeline, Decisions, Ideas, Prompts + versions, supersession, Current State, Master Memory, Relationships |
| 3 Capture & retrieval | Inbox, Quick Capture, search + filters, file/URL references, transcript and JSON import |
| 4 Continuation | Resume in Claude — 3 densities × 3 targets, resume triggers, snapshots |
| 5 Claude Code | `/api/ingest` with bearer-token auth, git metadata, hook pathway |
| 6 Assisted ingestion | Extraction provider behind a port (`claude-sonnet-5`), strict validation, suggestions as reviewable rows, deterministic fallback when no key is set |

---

## 7. What an Artifact rebuild actually costs

The original brief rejected Artifacts for one reason: *"the user's computer must not be the source
of truth."* **That specific objection no longer holds** — a published Artifact can be granted a
shared, durable database, so every device opening the URL sees the same data and Claude can read
and write it. One URL, cross-device, no provisioning. The cross-device requirement is satisfiable.

But the project is no longer at Phase 1, so the comparison is not "Artifact versus nothing." It is
"Artifact versus a working Phase 6 product." Rebuilding means giving up, concretely:

1. **`/api/ingest` (Phase 5).** An Artifact has no server route, so nothing can POST to it. Claude
   Code hooks have no target.
2. **38 RLS policies.** Isolation becomes "who can open the artifact," not a database that
   refuses. Fine for a private single-user shelf; not multi-tenant.
3. **Database-enforced append-only.** Version immutability currently holds because the policies
   grant no UPDATE or DELETE. In an Artifact it becomes a convention in page code — materially
   weaker. Mitigate with a single write path that exposes no update on a version record.
4. **Database triggers**, so `updatedAt` must be set client-side. The original design avoided this
   precisely because client clocks disagree across machines.
5. **4 views + the ranking function** (AD-17, AD-19) — derived read models computed by the
   database with `security_invoker`.
6. **Postgres full-text search.** Becomes client-side over loaded documents: fine at a few
   thousand entries, not beyond.
7. **Relational integrity** — composite foreign keys, the workspace-consistency constraints, the
   relationship-validating trigger. Collections of documents cannot express them.
8. **The Phase 6 server-side pipeline.** An Artifact can ask Claude a question, which recovers
   part of it, but not the credential scanning, chunking, and server-held API key.

**Decisions it would supersede:** AD-1 (Next.js), AD-2 (Supabase Postgres), AD-3 (Supabase Auth),
AD-4 (server-authoritative sync), AD-15/16/17/19/20/21 (hosted verification, views, mutation
allowlists, the ingestion boundary), and rule 21 (normalized relational modeling → collections
with explicit id references; the *spirit* survives, the letter does not).

**AD-6 is the one that helps.** The repository interfaces in `src/lib/ports/` were written
vendor-neutral specifically so persistence could be swapped. An artifact-database adapter
implementing the same ports is the clean path — not a rewrite from scratch.

---

## 8. Recommended scope if you build it anyway

Do not attempt to reproduce Phases 1–6. Two sane options:

**Option A — the memory core as a standalone Artifact (recommended).**
Scope to what an Artifact does well and what carries the concept: Topics, nested Subtopics, typed
Knowledge Entries, Current-State-vs-History with supersession and reasons, Timeline with filters,
Decisions and Ideas, and **Resume generation with the avoid-list**. That is Phases 1, 2 and 4 —
the conceptual heart. Skip the Inbox pipeline, `/api/ingest`, and the extraction provider.

**Option B — an Artifact companion over the existing data.**
A reader/capture surface rather than a second system. Viable but fiddly: it needs the publishable
key plus a real session for RLS to admit it, and it duplicates UI already built. Only worth it if
the goal is a lightweight mobile capture surface.

**Carry over from this repository** — all vendor-neutral, all reusable as-is:
- `src/lib/domain/types.ts` — entities and enums
- `src/lib/domain/knowledge.ts` — knowledge-type colour/label mapping, timeline filter groups
- `src/lib/domain/current-state.ts` — `currentEntries`, `history`, `avoidList`,
  `resolveCurrentVersion`, with their unit tests
- `src/lib/ports/repositories.ts` — the interfaces to re-implement over the artifact database
- `src/lib/resume/` — the pure context assembler
- `src/lib/utils.ts` — freshness wording, day grouping

**Do not carry over:** the Supabase adapter, the SQL migrations, the RLS policies, the auth routes,
the middleware, `/api/ingest`, the extraction pipeline, the provisioning scripts.

---

## 9. One-paragraph version

ContextShelf is external memory for work done with Claude. It organizes everything by **topic and
subtopic**, treating Claude Chat, Cowork, and Claude Code as mere **sources** of knowledge rather
than as places where knowledge lives. Every piece of knowledge is **typed** (decision, idea,
prompt, blocker, implementation…), **statused** (active, superseded, rejected…), and **linked back
to its original source**. Replacing a decision never deletes the old one — it writes a supersession
link *with a reason*, so "Current State" and "full history" are two different reads of the same
append-only record. The payoff is a **generated continuation prompt**: open a topic months later,
pick Chat, Cowork, or Code, pick a density, and get a paste-ready brief with the current goal,
state, decisions, files and next step — plus an **avoid-list of everything already rejected, with
reasons**, so a brand-new Claude session cannot talk you back into an idea you already killed.
