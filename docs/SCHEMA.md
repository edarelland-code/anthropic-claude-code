# ContextShelf — Schema Reference

Companion to `supabase/migrations/0001_init.sql`. The migration is the authority; this file
explains **why** the shape is what it is, and how to query it correctly.

**Validated against a real PostgreSQL 16** by `npm run test:db`, which applies this exact
migration to an ephemeral cluster and runs `supabase/tests/*.test.sql`. Not yet applied to a
hosted Supabase project — see `docs/DEVELOPMENT_STATE.md`.

Design rationale: `docs/ARCHITECTURE.md` §6–8. Permanent rules: `/CLAUDE.md`.

---

## Table map

```
auth.users
 └─ profiles                      preferences, display name
 └─ workspaces ── workspace_members
      │
      ├─ topics ──────────────────────────────┐
      │    └─ subtopics (self-nesting tree)   │
      │                                       │
      ├─ source_sessions        LAYER 1 — verbatim evidence, written once
      │    └─ session_subtopics               │
      │                                       │
      ├─ knowledge_entries      LAYER 2 — typed, statused, queryable
      │    ├─ entry_subtopics                 │
      │    ├─ knowledge_entry_versions   (append-only)
      │    └─ superseded_by_id → knowledge_entries   (self-FK, the history chain)
      │                                       │
      ├─ decisions   ── superseded_by_id → decisions
      ├─ ideas       ── decision_id, implementation_entry_id
      ├─ prompts     ── current_version_id → prompt_versions  (append-only)
      ├─ file_references
      ├─ actions           next steps · blockers · questions
      ├─ milestones
      ├─ context_snapshots      derived Master Topic Memory
      │
      ├─ relationships          polymorphic graph edges
      ├─ tags ── taggables
      ├─ ingestion_records      the Inbox — every input lands here first
      ├─ ingestion_tokens       bearer tokens for /api/ingest (Phase 5)
      └─ deletion_log           tombstones for soft-deleted rows
```

---

## The three structural ideas

### 1. Layer 1 and Layer 2 are separate tables, permanently linked

`source_sessions` holds the raw transcript, the git metadata, the external URL. It is written once
and never edited — it is the receipt.

`knowledge_entries` holds the human-scale, typed, statused facts extracted from it. Each entry
keeps `source_session_id` and `source_reference` (a message index, line range, or anchor), so
every card in the UI can offer *view in original*.

One session produces **many** entries. Never store a session as a single generic entry.

### 2. Current State is a WHERE clause, not a second table

```sql
-- History: everything that ever happened on this topic
select * from knowledge_entries
where topic_id = $1 and deleted_at is null
order by occurred_at desc;

-- Current State: the head of every chain
select * from knowledge_entries
where topic_id = $1 and deleted_at is null
  and status = 'active' and superseded_by_id is null
order by occurred_at desc;
```

Replacing knowledge calls `supersede_entry()`, which in one transaction inserts the replacement,
points the old row's `superseded_by_id` at it, records `supersedes_reason`, copies subtopic links,
writes a `supersedes` relationship edge, and bumps the topic's `last_meaningful_update_at`. The
function **raises** if the reason is blank.

Walking a supersession chain:

```sql
with recursive chain as (
  select * from knowledge_entries where id = $1
  union all
  select e.* from knowledge_entries e join chain c on e.id = c.superseded_by_id
)
select * from chain;
```

### 3. Relationships are one polymorphic edge table

`(from_type, from_id) → relationship_type → (to_type, to_id)`.

No foreign key can span tables, so `relationships_validate()` checks both endpoints against the
table named by the `entity_type` enum on every insert and update. This is what makes
*Prompt → produced → Idea → resulted_in → Decision → resulted_in → Implementation → caused → Bug
→ resolves ← Fix* a single queryable graph instead of a dozen nullable columns.

```sql
-- Everything connected to a decision, in either direction
select relationship_type, to_type, to_id from relationships
where from_type = 'decision' and from_id = $1
union all
select relationship_type, from_type, from_id from relationships
where to_type = 'decision' and to_id = $1;
```

---

## Append-only tables

`prompt_versions` and `knowledge_entry_versions` have **SELECT and INSERT policies only**. There
is no `UPDATE` or `DELETE` policy, so RLS denies those operations outright — even from application
code that tries. "Never overwrite a prompt version" is a database guarantee here, not a
convention someone can forget.

To revise a prompt: insert `version = max(version) + 1` and point `prompts.current_version_id` at
it. v1 remains readable forever.

---

## Deletion

Nothing is hard-deleted from application code.

1. `update … set deleted_at = now()`
2. insert the full serialized row into `deletion_log`
3. every list query filters `deleted_at is null`

Restore flips `deleted_at` back to null and stamps `deletion_log.restored_at`.

---

## Freshness: two timestamps, on purpose

| Column | Moves when |
|---|---|
| `updated_at` | **any** column changes — maintained by trigger, never by the client |
| `last_meaningful_update_at` | real progress: a new entry, a supersession, an edited goal or current state |

Renaming a topic must not make it look freshly worked on. Freshness indicators and the "stale
topics" list read `last_meaningful_update_at`; optimistic concurrency reads `updated_at`.

---

## Concurrency

Mutable scalar updates carry the `updated_at` the client read:

```sql
update topics set goal = $1 where id = $2 and updated_at = $3 returning *;
```

Zero rows returned means another device wrote first. The adapter raises `ConflictError` and the UI
tells the user to reload — it never clobbers. Everything append-only needs no such check, because
concurrent writes there produce two preserved versions rather than a lost one.

---

## Workspace consistency

Every RLS policy authorises on the row's *own* `workspace_id`. That alone is not enough: a member
of workspace B could insert a child row carrying `workspace_id = B` while pointing `topic_id` at a
topic in workspace A, and the with-check would pass.

Composite foreign keys close it. `topics`, `subtopics`, and `prompts` each carry a
`unique (id, workspace_id)`, and every topic-scoped child declares:

```sql
foreign key (topic_id, workspace_id) references topics(id, workspace_id) on delete cascade
```

A child's workspace is now physically unable to disagree with its parent's, so authorisation and
ownership cannot drift apart. The two join tables (`entry_subtopics`, `session_subtopics`) carry
no `workspace_id`, so a `join_same_workspace()` trigger enforces the same rule for them.

## Row Level Security

Every table has RLS enabled and is scoped through `is_workspace_member(workspace_id)`, a
`security definer` function so the policy on `workspace_members` does not recurse into itself.
Join tables (`entry_subtopics`, `session_subtopics`, `taggables`) inherit access from their parent
row via an `exists` subquery.

Deny by default: a table with RLS enabled and no matching policy returns zero rows. Any new table
must ship its policies in the same migration that creates it — `01_schema.test.sql` fails the
build if one does not.

**A policy that grants on `user_id = auth.uid()` for INSERT is almost always wrong** on a
workspace-scoped table. An early draft of `members_write` did exactly that, which let any
authenticated user join any workspace; `02_rls.test.sql` now regression-tests it. Authorise on
membership, not on the row naming you.

The migration also grants explicitly to `authenticated` and `service_role` and revokes from
`anon`, rather than relying on Supabase's project-level default privileges — the schema has to be
correct on its own.

---

## Search

- `knowledge_entries.search_vector` — generated `tsvector`, title weighted `A`, content `B`, GIN
  indexed.
- `source_sessions.raw_content` and `prompt_versions.body` — `gin_trgm_ops`, so search reaches
  inside raw transcripts and prompt bodies rather than only summaries.

```sql
select * from knowledge_entries
where workspace_id = $1
  and search_vector @@ websearch_to_tsquery('english', $2)
order by ts_rank(search_vector, websearch_to_tsquery('english', $2)) desc;
```

If semantic search is ever needed, `pgvector` is available in the same database. Deliberately not
built now (risk R9).

---

## New-user bootstrap

`on_auth_user_created` fires after an `auth.users` insert and creates the profile, a default
workspace named *My Shelf*, and the owner membership row. A user who somehow predates the
migration will have no workspace and needs a manual backfill.

---

## Adding a table — checklist

1. `workspace_id` and `user_id` columns
2. `created_at` / `updated_at`, plus an `updated_at` trigger
3. `deleted_at` if the row is user-deletable, and a `deletion_log` write on delete
4. `enable row level security` **and** a membership policy in the same migration
5. Add to `entity_type` only if it participates in relationships or tagging
6. If it is a history table, give it SELECT + INSERT policies only
7. Extend the hand-written domain types and the mapper — never generate app-facing types from the
   vendor
