# ContextShelf — Schema Reference

Companion to `supabase/migrations/0001_init.sql`. The migration is the authority; this file
explains **why** the shape is what it is, and how to query it correctly.

Now four migrations: `0001_init`, `0002_memory`, `0003_capture_enums`, `0004_capture`. `0003`
carries only enum values, because PostgreSQL refuses to USE a value in the transaction that added
it and `0004`'s view casts two of them.

**Validated against a real PostgreSQL 16** by `npm run test:db`, which applies these exact
migrations to an ephemeral cluster and runs `supabase/tests/*.test.sql`. Applied to the hosted
Supabase project and verified there — see `docs/DEVELOPMENT_STATE.md`.

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
      ├─ ingestion_tokens       bearer credentials for /api/ingest — hash only
      ├─ ingestion_deliveries   the Idempotency-Key ledger for /api/ingest
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

Those are Postgres **role** names and are unaffected by Supabase's publishable/secret API key
naming: the publishable key resolves to `anon` before sign-in and `authenticated` after it, and
the secret key resolves to `service_role`. Only the environment variable names changed.

---

## Search

Thirteen tables carry a generated `search_vector`, each GIN indexed, with one weighting
convention: `A` = the name you would recognise the record by, `B` = its substance, `C` =
supporting detail, `D` = bulk verbatim text. `source_sessions.raw_content` is capped at 200k
characters before tokenising, because `to_tsvector` rejects input over 1 MB.

`search_documents` unions all of them, `with (security_invoker = true)`, and exposes a
`record_state` of `current`, `historical` or `snapshot` on every row.

Do not query the view directly from the app. `search_records()` adds the ranking, and one
definition of "best match" is the point:

```sql
select * from search_records(
  p_workspace_id => $1,
  p_query        => $2,          -- websearch syntax: quotes, or, -excluded
  p_entity_types => array['decision','knowledge_entry'],
  p_record_states=> array['current'],
  p_limit        => 30
);
```

Ranking is `ts_rank_cd` multiplied by a fixed state constant (current 1.0, historical 0.6,
snapshot 0.4), then ordered by recency and finally by id — a **total** order, so paging cannot
drop or repeat a row between pages.

### Current State and Master Topic Memory are searchable without being stored

Both are derived reads (rule 8, AD-8), so neither can be indexed and neither has a copy made of
it. Instead the authoritative columns they are assembled from carry the vectors —
`topics.current_state` and `topics.goal` among them — so a phrase remembered from the memory panel
resolves to the record that produced it. Saved `context_snapshots` participate as history, labelled
`snapshot`.

### The leakproof limit

**`@@` cannot use a GIN index under row-level security.** A policy is a security-barrier
qualifier, and PostgreSQL will not evaluate a non-leakproof operator before one; `ts_match_vq` is
marked not leakproof. So full-text reads scan the rows the policy admits, while equality
predicates (`content_hash`, foreign keys) and ordering keep their indexes.

Asserted in `supabase/tests/07_performance.test.sql`, and measured: 35 ms across 4,000 entries,
growing linearly. Read plans as `authenticated`, never as the owner — the owner bypasses RLS and
gets a plan no real user will see. Full reasoning and the options in
`docs/DEVELOPMENT_STATE.md`.

If semantic search is ever needed, `pgvector` is available in the same database. Deliberately not
built now (risk R9).

---

## Duplicate and conflict proposals

`content_fingerprint(text)` — trimmed, whitespace-collapsed, case-folded, SHA-256 — is generated
onto `knowledge_entries.content_hash`, `prompt_versions.body_hash`, `source_sessions.raw_hash` and
`ingestion_records.raw_hash`. `src/lib/ingestion/fingerprint.ts` computes the identical value for
text that has not been inserted yet, which is what lets triage propose a duplicate *before*
writing.

Every one of those is a plain index, never a unique constraint. A unique constraint would refuse
the second copy at the database level — deciding on the user's behalf and losing the content —
where rule 17 says detection proposes and the user confirms.

---

## Importing

`persist_ingestion()` writes the Inbox record, the Layer 1 session and every Layer 2 entry in one
transaction, because PostgREST cannot span calls transactionally and a half-written import would
otherwise be reachable. It is `security invoker`: `p_workspace_id` can only ever be a workspace the
caller belongs to, because every insert is checked by the same policy an ordinary client insert
would hit.

It never classifies. Segments arrive already extracted deterministically or already confirmed by a
person.

---

## Deleting

`soft_delete_record(entity_type, id, reason)` stamps `deleted_at` and writes the `deletion_log`
tombstone in one transaction; `restore_record(deletion_log_id)` reverses it and refuses a second
restore.

Both dispatch on an **explicit allowlist** of statically compiled statements — one `UPDATE` per
supported type, no interpolated table name anywhere (AD-20). Four types are refused with their own
messages:

| Refused | Because |
|---|---|
| `prompt_version` | Append-only history; rule 6 depends on it having no UPDATE path |
| `source_session` | Layer 1 evidence is written once; deleting it breaks provenance |
| `ingestion_record` | An inbox item is archived, so the raw capture survives |
| `context_snapshot` | Derived and regenerable (AD-8) |

Both are `security invoker`, so a row in another workspace is invisible rather than merely
unauthorised: the `UPDATE` matches nothing and the function raises.

---

## New-user bootstrap

`on_auth_user_created` fires after an `auth.users` insert and creates the profile, a default
workspace named *My Shelf*, and the owner membership row. A user who somehow predates the
migration will have no workspace and needs a manual backfill.

---

## Token-authenticated ingestion

`/api/ingest` is the only way into the database that does not begin with a signed-in browser
session, so three schema facts hold it together.

**The credential is a hash.** `ingestion_tokens.token_hash` is SHA-256 of a 256-bit secret, unique.
`token_prefix` keeps the first eight characters so a person can tell two tokens apart in a list;
that is all it is for. Nothing stores the token, so nothing can return it — Settings shows it once
at creation and never again. Revoking stamps `revoked_at`; it never deletes the row, because the
deliveries that row authorised still point at it.

`scope_topic_id` / `scope_subtopic_id` are the token's default destination, and both use composite
foreign keys `(scope_topic_id, workspace_id) → topics (id, workspace_id)` per AD-11 — a plain FK
to `topics(id)` would let a token in one workspace default to a topic in another.

**A retry is free.** `ingestion_deliveries` is the ledger: `unique (token_id, idempotency_key)`.
The same token and key return the stored receipt and write nothing; the same key with a different
`request_fingerprint` is refused. The unique index is the enforcement — not the endpoint
remembering to look first, which would race with itself under concurrent retries.

This is **not** duplicate detection. Duplicate detection compares content and proposes a merge to a
person (rule 17). Idempotency compares a key the client chose and refuses to act twice on one
delivery. See AD-22.

**One write path.** `ingest_from_token()` resolves the token, checks the destination against the
token's own workspace, sets the JWT claim so `auth.uid()` names the token's owner, and then calls
`persist_ingestion()` — the same function the Inbox calls. It carries no copy of the ingestion
logic. What it adds beyond that call is file references for the paths the session touched, the
actions the payload NAMES as completed, the new actions it opened, and any decision it proposes,
written `proposed`.

It is `SECURITY INVOKER` with `EXECUTE` granted to `service_role` alone, so the workspace boundary
is its own explicit checks rather than RLS — stated here because it is the one place in the schema
where that is true, and asserted in `supabase/tests/08_ingest.test.sql` rather than assumed. See
AD-21.

`assert_ingest_work_allowed()` refuses any `work` key outside
`completedActions` / `nextActions` / `proposedDecisions`, naming the key in the error. Ignoring an
unknown key would let a client believe a decision had been superseded when nothing happened.

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
