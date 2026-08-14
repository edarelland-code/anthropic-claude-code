# ContextShelf — Development State

> Live status file. Update after every meaningful milestone, without being asked
> (CLAUDE.md working rules). Permanent rules live in `/CLAUDE.md`; reasoning lives in
> `docs/ARCHITECTURE.md`; setup and deployment live in `docs/DEPLOYMENT.md`.

**Last updated:** 2026-08-14
**Current phase:** Phase 6 — Assisted ingestion. **Core complete; AI provider pending
configuration.** The whole source → suggestions → persistent review → correction → confirmation →
authoritative records workflow is built, hosted-validated and usable. The Anthropic provider is
written against the same interface, reports itself unconfigured, and makes no external call.

Phases 1–5 are closed and merged.

Live at **<https://contextshelf.vercel.app>**, backed by Supabase `omhktzxwffaipmcoljic`, carrying
migrations `0001`–`0007` — **29 tables**, 4 views, 38 policies. Phase 6 added two tables
(`extraction_runs`, `extraction_suggestions`) and one function.

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

## Phase 6 — Assisted ingestion

**Status: Core complete; AI provider pending configuration.** Those are two separable layers and
the distinction is load-bearing — see "What is and is not operational" below.

### The rule

**A provider may suggest. A person confirms.** Every part of Phase 6 is arranged so that no output
becomes project memory without somebody agreeing to it, and so that a reviewer always knows what
produced a suggestion.

```
Raw source (unchanged, in the Inbox)
  → deterministic preparation   size check · credential scan · chunking
  → ExtractionProvider          deterministic today; Anthropic when configured
  → strict validation           malformed records rejected BY NAME, valid ones kept
  → merge across chunks         the same thing said twice is one suggestion
  → duplicate/conflict          from the Phase 3 fingerprint, never from the provider
  → extraction_suggestions      rows, so a review survives a closed tab
  → user reviews, edits, rejects
  → confirm_extraction_suggestions()   one transaction, idempotent
  → authoritative records       decisions PROPOSED, ideas SUGGESTED, prompts UNTESTED
```

### What is and is not operational

| Layer | Status |
|---|---|
| **Phase 6 Core** — the workflow above, with deterministic extraction | ✅ Complete, hosted-validated |
| **Phase 6 AI Enhancement** — Anthropic-backed semantic extraction | ⏸ Code-ready, **not connected**. No key, no external call, and the UI says so |

**Nothing in the product describes deterministic extraction as AI.** The button says *Extract
suggestions*, the panel says *deterministic extraction — it does not understand the conversation*,
and Settings lists "Deterministic extraction" and "AI-assisted extraction" as two separate rows
with the second marked *Not configured*. This is not modesty. A reviewer who believes a model read
their conversation reviews far less carefully than one who knows a matcher scanned it, and the
review is the only thing between a suggestion and the project's memory.

### What deterministic extraction can and cannot identify

**Can**, because the author stated it: labelled records (`Decision:`, `Idea:`, `Bug:`, `Fix:`,
`TODO:`, `Prompt:`, `Question:`) at confidence 1; phrase-matched types ("we decided", "blocked on",
"next step") capped at 0.75; the record kind each belongs to, so a decision becomes a Decision and
a TODO becomes an Action rather than all of them becoming generic entries; and a line anchor for
every one.

**Cannot**: read an unlabelled conversation. A discussion that reaches a decision without anyone
writing "Decision:" yields nothing, and a recommendation phrased as one is correctly left as an
idea. It proposes no Current State and no relationships at all — both require judgement about the
project rather than about a sentence, and a keyword matcher proposing "here is your new Current
State" would be the system pretending to understand.

### Issues found and fixed

| # | Severity | Issue | Fix |
|---|---|---|---|
| 54 | **High — an unauthenticated caller could reach the confirm function** | `revoke ... from anon` does not remove the implicit `PUBLIC` EXECUTE grant PostgreSQL puts on every new function, so `anon` inherited it. RLS would still have refused the writes, but a function that reaches a workspace's rows should not be callable at all | `revoke ... from public` first. Asserted in `09_extraction.test.sql` |
| 55 | **Medium — a credential warning that named the wrong vendor** | `sk-ant-…` matches OpenAI's pattern too, and the scan stops at the first hit, so every Anthropic key was reported as an OpenAI key | Anthropic ordered first; OpenAI's pattern excludes `ant-` |
| 56 | **Medium — the commonest secret shape went undetected** | `\bpassword\b` never matches inside `DATABASE_PASSWORD=…` because `_` is a word character | Word boundaries dropped, so prefixed and suffixed names match |
| 57 | Medium | `prompts` has no `source_session_id` column, so confirming a prompt suggestion raised | Provenance in `metadata`, with the source anchor on the version |
| 58 | Low | The validator's Phase 6 section renamed an identifier inside a result string | Renamed properly; the check now reads as written |

### Not done in Phase 6

* **The Anthropic provider is not connected.** See the setup below.
* **Relationship suggestions are accepted and confirmable, but nothing proposes them.** The
  deterministic provider does not, for the reason above. The path is built and tested; a model
  provider is what would populate it.
* **Duplicate linking is a warning, not an action.** Review shows "possible existing record" and
  leaves the choice; there is no "link to existing" button yet, so the honest options today are
  keep-as-new or deselect.
* **Cost display shows tokens, not currency.** No pricing table is configured, and an estimate
  nobody can reproduce is worse than no number.

### The one-time setup that would enable AI-assisted extraction

Set in Vercel **production**, server-side only:

```
ANTHROPIC_API_KEY=sk-ant-…                       required
CONTEXTSHELF_EXTRACTION_MODEL=claude-sonnet-4-5  optional; this is the default
```

Nothing goes in the client bundle, in git, in `CLAUDE.md`, or in any log. There is deliberately no
place in the app to paste a key: storing one per user would mean encrypting it at rest, which
would mean a key-management dependency this deployment does not have.

**Expected cost.** One call per chunk, only when someone presses Extract. A typical conversation is
one chunk of roughly 10–20k input tokens returning ~2k — a fraction of a cent at Sonnet pricing. A
long one splits into two or three. Nothing analyses automatically, and Claude Code deliveries never
trigger a call.

**What validation would remain after the key is supplied:** the Anthropic client itself (the
`extract()` body, which today refuses by name), a live call proving structured output validates
against the existing schema, the fixtures 6AI cases 1–7 re-run against the model rather than the
matcher, token/cost recording from a real response, and the pre-send credential flow exercised with
a provider that actually sends.

---

## Phase 5 — Claude Code integration

### What Phase 0 and Phase 3 had already built

The fourth audit in a row to find most of the phase already modelled. `ingestion_tokens` existed
with a unique `token_hash`, RLS and a `revoked_at` stamp. `source_sessions` already carried
`repo_url`, `branch`, `commit_sha`, `files_changed/added/removed`, `build_status`, `test_summary`
and `artifacts`. Phase 3 had built the whole funnel — adapters → `NormalizedIngestion` →
`persist_ingestion()` → `ingestion_records` → `source_sessions` → entries — and had written the
canonical Claude Session Import format specifically so that Phase 5 would be a transport rather
than a second parser.

What was genuinely missing was the part that makes a token usable without a browser session, and
the part that makes a retry safe.

### The architecture

```
Claude Code
  → npm run contextshelf:sync            (or the optional SessionEnd hook)
  → POST /api/ingest      Authorization: Bearer cs_live_… · Idempotency-Key
  → claudeSessionJsonAdapter             the SAME adapter the JSON import screen uses
  → ingest_from_token()                  resolves the token, checks scope, then calls
  → persist_ingestion()                  the SAME function the Inbox calls
  → ingestion_records → source_sessions → knowledge entries
                                       → file references, actions, proposed decisions
  → Timeline · Search · the next Resume
```

There is no second write path. A payload posted to the endpoint and the same payload pasted into
the JSON import screen produce the same records.

### Delivery is not authority

The line Phase 5 draws, and the only reason automated capture is safe to switch on:

| A delivery MAY record | A delivery may NOT |
|---|---|
| repository, branch, commit | replace Current State |
| files changed / added / removed | supersede or reject a decision |
| build result, test result | approve its own proposed decision |
| implementation, bug, fix, progress | reject an idea |
| an action it NAMES as completed | choose a winning prompt version |
| a new next action or blocker | delete anything |
| a decision, **as `proposed`** | resolve a conflict |

The refusal is explicit at both ends. `validateClaudeSessionImport` rejects an unrecognised `work`
key by name, and `assert_ingest_work_allowed()` refuses it again in the database. Silently
ignoring one would be the worst outcome available: a client that sent `supersedeDecisions` would
get a 200 and believe a decision had been replaced, with its absence as the only evidence.

**An action closes only when the delivery names it.** Omission is not evidence — a payload that
forgot to mention an action would otherwise silently close work the user still intends to do.

### Where the workspace comes from

From the token row and from nothing else. There is no parameter for a workspace, the payload
schema warns when something tries to name one, and the topic named in `target` is looked up
scoped to the token's workspace — so a topic belonging to somebody else is answered exactly as a
topic that does not exist, with the same message and the same 404.

**What enforces this is the function's own checks, not RLS**, and that is stated in the migration
rather than left to be discovered. `service_role` bypasses row-level security by design, because
a delivery carries no Supabase session for a policy to read. The original design dropped to
`authenticated` inside the function so the ordinary policies would apply; PostgreSQL forbids
`SET ROLE` inside a `SECURITY DEFINER` function, and `08_ingest.test.sql` caught it on the first
run. A version that silently failed to switch would have looked identical while enforcing
nothing — so the checks are asserted in that suite instead of assumed.

### Idempotency is not duplicate detection

Two different things that a shared word would have blurred:

* **Idempotency** compares a key the *client* chose. The same token and key return the original
  receipt and write nothing; the same key with different content is refused with a 409 rather than
  answered with the wrong receipt. Enforced by a unique index, not by the endpoint remembering.
* **Duplicate detection** (Phase 3, rule 17) compares *content* and proposes a merge to a person.
  The same content under a new key is a new delivery, and whether it is a duplicate is the user's
  judgement.

`npm run contextshelf:sync` defaults its key to a hash of the payload, so running it twice by
accident replays rather than duplicating. That is a client convenience; the server treats the key
as opaque.

### Issues found and fixed

| # | Severity | Issue | Fix |
|---|---|---|---|
| 47 | **High — would have enforced nothing** | `ingest_from_token` was written `SECURITY DEFINER` and dropped to `authenticated` so RLS would apply. PostgreSQL forbids `SET ROLE` in a definer function | Restructured to `SECURITY INVOKER`, executable by `service_role` alone, with the workspace boundary as explicit checks that `08_ingest.test.sql` proves rather than assumes |
| 48 | **High — told a session to avoid something nobody rejected** | `avoidList()` treated every non-active decision as evaluated-and-set-aside. Safe while every decision had been decided by a person; since Phase 5 a delivery can create one nobody has reviewed. A proposal on the avoid list makes the next session refuse a direction that was never turned down | `proposed` excluded from the avoid list, with a regression that a genuinely *rejected* decision still reaches it |
| 49 | Medium | Recent Meaningful Changes labelled a proposed decision `(historical)` — "not current" had silently meant "was current once" | A third state: `proposed`, rendered "proposed — not approved" |
| 50 | **Medium — an unauthenticated format oracle** | The route parsed and validated the payload before checking the token, so a caller with an invented token got a 422 listing exactly which fields were wrong | Authenticate first. One indexed lookup buys an endpoint that says nothing at all to a caller it does not know |
| 51 | **Medium — a table anyone could reach** | Supabase's default privileges grant every NEW public table to `anon`; 0005 did not revoke them. `npm run test:db` passed because the local cluster has no such defaults | Migration 0006. RLS already stood in front of the table, so nothing leaked — but "anon has no table privileges" is exactly the check that only earns its keep on the real project |
| 52 | Medium | A 24px icon-only Resolve button on the Topic page, from Phase 3. Invisible to every earlier audit because no QA topic had ever had an open action | Raised to 44px; the Phase 5 QA topic has three |
| 53 | **Medium — a check that lied, again** | Three Resume assertions read the preview after clicking "Claude Code", waiting for text the *previous* document already contained. Same class as Phase 4 issue 46 | Wait for the preview to change, and assert the destination re-rendered before reading it |

### The optional session-end hook

Shipped, not deferred, because `SessionEnd` could be verified as a real hook event in the
installed Claude Code (2.1.231) rather than assumed. It was chosen over `Stop` and `PostToolUse`
because it fires once per session — a delivery per tool call would bury the shelf.

Nothing installs it; registering it in `.claude/settings.json` is the opt-in, and
`CONTEXTSHELF_SYNC_ON_SESSION_END=0` disables it without unregistering. It exits 0 unconditionally
and runs under a 20-second timeout, so an outage cannot hold a session open. It reports only what
git can be asked. It cannot know which action you finished, what you decided, or whether the build
passed — those come from running the sync command with `--done`, `--next` and `--tests` yourself,
and a hook that guessed at them would be inventing the most important records in the product.

A hard kill does not fire `SessionEnd`. Manual sync is the path that can be relied on; this is a
convenience on top of it.

### Not done in Phase 5

* **MCP pathway.** The brief lists it beside hooks. The canonical payload and the endpoint are
  what an MCP server would call, so it is an adapter away rather than a rewrite — but it is not
  built and is not implied anywhere in the UI.
* **Rate limiting on `/api/ingest`.** A token is required, a body is capped at 1 MB, and the
  ledger makes a retry free. Beyond that a compromised token could write until it is revoked.
  Worth revisiting when there is more than one user.
* **Relationship editing** — still deferred from Phase 4.

---

## Phase 4 — Continuation

### What Phase 0 and Phase 2 had already built

The third audit in a row to find most of the phase already modelled. `context_snapshots` had
`density`, `target`, `body`, `inputs jsonb`, topic and subtopic FKs, RLS and an index — that is
Resume History. `resume_trigger_if` / `resume_trigger_then` existed on **both** `topics` and
`subtopics`. `context_density` and `RESUME_TARGETS` existed. Phase 2 had left `assembleMemory()`,
`avoidList()` and `prompt_current_winning` behind, which are the derivations Resume reuses rather
than reinventing.

**No migration was written.** Everything 4Q asks Resume History to record fits the existing
columns plus `inputs` — size, sections, record ids, freshness, conflicts and an optional label.

### The winning-prompt defect, found by the audit

`TopicContext.winningPrompts` sorted each prompt's versions descending and took the first — the
**newest**, not the winner. Rule 9a exists because those differ: the latest version is often a
later experiment that did worse. Master Topic Memory rendered the wrong body, and a Resume built
on it would have pasted a failed experiment into a fresh session under a heading saying it worked.

Fixed by resolving through `prompt_current_winning`, in a pure `toWinningPrompts()` so the rule is
testable without a database. `prompts.is_winning` is deliberately ignored — it is a derived
boolean meaning "a winner exists somewhere", not which one.

### The architecture

`assembleResumeContext(input, options)` is pure and returns **structured data**. The three
formatters are pure functions of that one object, so Chat, Cowork and Code are formatting profiles
over one memory rather than three that can drift.

The rule the user set is enforced by the type signature: the assembler takes records and a clock
reading, and has **no parameter through which a `context_snapshots` row could arrive**. A past
export therefore cannot become an input to the next one. `is_current` is written `false` and never
read.

| Selection rule | Why it is not the obvious thing |
|---|---|
| Meaningful changes are a projection, not the last N rows | The Inbox makes low-value capture cheap, so there is a lot of it. A resume full of "chatted about colours" tells a session nothing |
| The avoid list is ranked, superseded decisions first | Compact has room for five. A superseded decision explains why the current direction exists, which prevents the most expensive mistake. An item with no reason is dropped, because "do not do X" without a why invites a session to find out by trying X |
| The next action never promotes a blocker | A blocker says work is stopped, not what to do. Presenting it as the next action would tell a fresh session to do nothing |
| No next action is invented when none is recorded | A fabricated task presented as stored truth is indistinguishable from a real one. The output says so plainly instead |
| Compact skips the conflict scan | A warning it has no room to explain is worse than none |
| Subtopic scope keeps topic-wide decisions and requirements | Work inside a subtopic is still governed by them, and a session that never saw them would cheerfully violate them |

### Issues found and fixed

| # | Severity | Issue | Fix |
|---|---|---|---|
| 40 | **High — would have exported the wrong prompt** | `TopicContext.winningPrompts` returned the newest version rather than the selected one | Resolve through `prompt_current_winning`; five regression assertions |
| 41 | **Medium — a density that was only a label** | Compact's requirements section was uncapped, so a large topic produced a 3,798-token "compact" export — four times its intent | Requirements and blockers capped, with the omission recorded in `truncations` |
| 42 | Medium | The Topic page issued two queries per prompt to fetch versions and the winner; the Prompts page issued one per prompt for the winner | `getContext` resolves both in its batched read; `listWithVersions` replaced the Prompts page loop |
| 43 | Medium | `/topics/[id]` had never been in the responsive audit, so two real defects had gone unseen: a 20px "Edit current context" button and a 36px select | Both raised to 44px; the audit now takes run-time page ids from the harness that owns the session |
| 44 | Medium | A blocked clipboard aborted the copy before the export was recorded, so history silently omitted it | The text is selected as a fallback and the export is recorded either way — clicking Copy is the act of taking the context |
| 45 | Low | Resetting "copied" inside the regeneration effect caused a cascading render and briefly claimed Copied about text no longer shown | Derived from which document is on screen |
| 46 | **Medium — a check that lied, in the other direction** | Hosted validation reported "the export is recorded in resume history — no row" twice. The recording was correct throughout: the button flips to Copied when the click is handled, and the server action that writes the row resolves afterwards, so the check was reading the database while the insert was still in flight. It would have failed a working feature, and issue 44 was fixed on the strength of it | The check waits for the confirmation the write returns, then polls for the row; the detail line now says whether the copy was ever acknowledged, so the next failure distinguishes "never clicked" from "not written". Issue 44's fix is kept — it is a real improvement, just not this cause |

### Not done in Phase 4

- **Relationship editing UI.** Deferred explicitly, as the brief allows. Resume traversal reads
  edges that `supersede_entry()` and `supersede_decision()` write automatically, so manual linking
  does not currently change what a Resume contains. Building an editor to justify a traversal that
  already works would have widened the phase for nothing.
- **AI-assisted compression.** Not needed: Compact is ~560 tokens on a real topic and stays under
  2,000 on the 500-entry fixture. Adding a model dependency would break the offline guarantee
  (4AI) for a problem that does not exist yet.

### Search performance — review threshold recorded

Phase 3's finding stands unchanged, as instructed (4AH). No leakproof marking, no definer search
function. **Revisit when either** a typical authenticated search exceeds **250 ms**, **or** a
workspace approaches **25,000–40,000 searchable records**. Measured today: 35 ms at 4,000 entries.

---

## Phase 3 — Capture & retrieval

### What Phase 0 had already built

The audit found the same thing it found in Phase 2, more strongly: the Inbox (`ingestion_records`,
complete with `raw_content`, `payload`, `suggested_topic_id`, `created_entry_ids` and a status
enum), Layer 1 evidence (`source_sessions`), file and URL references (`file_references`), tags,
bearer tokens for a future ingest endpoint, and the deletion log all existed with the right
columns. `knowledge_entries.search_vector` and two trigram indexes existed too.

What was missing was retrieval **across** those records, a fingerprint to propose duplicates from,
one transactional write path for imports, and a soft delete that actually wrote its tombstone.
Phase 3 therefore adds **no table**, and Import History is a read of `ingestion_records` rather
than a second audit trail.

### Schema changes (0003, 0004)

Split across two files because PostgreSQL refuses to USE an enum value in the transaction that
added it, and `0004`'s view casts two of them.

| Change | Why |
|---|---|
| `ingestion_status` gains `needs_review`, `partially_processed`, `failed`, `archived` | Triage needs a state for an item the extractor could not split, one for a partial import, one for a failure, and a terminal filing state. `discarded` kept as legacy, as `reversed` was |
| `entity_type` gains `ingestion_record`, `context_snapshot` | So an inbox item can be linked and tagged, and a saved snapshot can be addressed as a search hit |
| `content_fingerprint()` + generated hash columns on 4 tables | Duplicate **candidates**. Indexed, never unique — a unique constraint would refuse the second copy and decide on the user's behalf (rule 17) |
| `search_vector` generated columns on 12 more tables | Universal search. Includes `topics.current_state` and `topics.goal`, which is how Current State and Master Topic Memory became searchable without a copy of either being stored |
| `search_documents` view, `security_invoker = true` | One projection over every searchable record type (AD-17) |
| `search_records()` / `search_type_counts()` | Deterministic ranking: `ts_rank_cd` with fixed state multipliers, ties broken on recency then id, so paging is a window on one total order |
| `persist_ingestion()` | Inbox record + Layer 1 session + N Layer 2 entries in one transaction. `security invoker`, so RLS decides which workspace a caller may write to |
| `soft_delete_record()` / `restore_record()` | Explicit allowlist of statically compiled statements. No dynamic SQL, so no argument can name a table |

### Clarifications carried into the build

1. **Search covers Current State and Master Topic Memory** by indexing the authoritative columns
   they are assembled from, not by storing a copy of either. `context_snapshots` participate as
   history: every hit reports `record_state` of `current`, `historical` or `snapshot`, so a saved
   rendering is never mistaken for the live answer.
2. **Quick Capture stayed one step.** The capture schema requires `content` and nothing else — no
   topic, subtopic, type, source, tag or classification. Asserted on the hosted deployment:
   *"capture required nothing but content — status unsorted, topic none"*.
3. **The soft-delete functions use an explicit allowlist**, not interpolated table names. Tested
   for unsupported types, immutable types, cross-workspace rows, and the impossibility of naming
   an arbitrary table.
4. **Suggestions stayed suggestions.** Path B returns `Suggestion<T>` rather than `T`, so a caller
   must reach through `.value`; confidence caps at 0.75; every suggestion carries its literal
   evidence. In the UI, rows read from a label start included and suggestions start **excluded**,
   so clicking straight through records only what the text actually stated.

### Issues found and fixed

| # | Severity | Issue | Fix |
|---|---|---|---|
| 28 | **High — would have over-captured** | A `Decision:` label consumed every paragraph after it, so prose nobody called a decision would have been filed inside one | Labels and speaker turns end at a blank line; headings keep their sections |
| 29 | Medium | `Assistant: Decision: ship it` was read as a speaker turn and the label inside discarded — throwing away the only part of the line that said what to record | Speaker prefixes are stripped, then the remainder is re-checked for a label |
| 30 | **Medium — a check that lied** | `EXPLAIN` in text form returns one row per line, and `execute … into` keeps only the first. Every plan assertion in the new performance suite was silently comparing against `"Limit (cost=…)"` and passing vacuously | `format json`, which is one row |
| 31 | **Medium — a test that measured nothing** | The performance seed put the search term in all 4,000 rows. A term present in every row is correctly answered by a sequential scan, so the index assertion could never have meant anything | Distinctive terms on ~1 row in 800 |
| 32 | Medium | `TopicCard`'s count list used `truncate` on a flex item without `min-w-0`, so it refused to shrink below its text and pushed the card 32px past the viewport at 390 and 47px at 375 | `min-w-0 flex-1` |
| 33 | Medium | The responsive audit flagged the search filter chips' visually-hidden radios as 1px touch targets, measuring the input rather than the 44px label that is actually tappable | The audit measures the associated label's box when a control is smaller than the minimum — and only when that label passes on its own |
| 34 | **Medium — half the harness was blind** | `responsive-qa.mjs` carried its own copy of the browser launcher which knew nothing about the proxy, so it failed on URLs the harness spawning it fetched successfully | One launcher, shared |
| 35 | Low | Four sidebar sections still carried "P2" badges after Phase 2 shipped, and Home promised Phase 3 features that already existed | Rule 14 cuts both ways; both corrected |
| 36 | **Medium — a grid item that could not shrink** | `TopicCard` is a grid item, and a grid item defaults to `min-width: auto`, so it refuses to compress below its own min-content. Measured at 406px against a 358px track — identically at 390 and 375, which is what identified it as a fixed floor rather than a content effect | `min-w-0` on the card root, so the track is authoritative and the `truncate` rules inside can work |
| 37 | Medium | Search result titles were 16px touch targets — an inline anchor around one line of text, the same defect Phase 2 fixed on the Timeline and the section pages | `inline-block min-h-11 py-2` with the padding negative-margined away, so the target grows without the layout moving |
| 38 | **Medium — two wrong diagnoses before the right one** | The responsive audit named the first three elements past the viewport in document order, which are always the outermost containers. Every overflow therefore read as "the card is too wide", and the real culprit was guessed at — wrongly | It now reports the elements that exceed **their own parent's** content box, with width and min-content, which names the break point instead of describing the symptom |
| 39 | **Medium — a validation run against a stale build** | A backgrounded `vercel --prod \| grep "ready."` swallowed the deploy's output, and because a pipeline's exit status is `tail`'s, the `&&` after it proceeded regardless. Two rounds of "the fix did not work" were actually the previous build | Deploys are checked unfiltered; the audit's class strings are what exposed it, since they still showed the old markup |

### The leakproof limit — a real, documented limitation

**Full-text search cannot use its GIN index for a real user, at any volume.**

A row-level security policy is a security-barrier qualifier, and PostgreSQL will not evaluate a
non-leakproof operator before one — doing so could reveal values from rows the policy exists to
hide. An index condition is evaluated inside the scan, before that qualifier, so a non-leakproof
operator cannot be an index condition at all. `ts_match_vq` (the `@@` operator) and `ILIKE` are
both marked not leakproof in stock PostgreSQL; equality is leakproof.

Consequences on every RLS-protected table:

- full-text search scans the rows the policy admits, however many GIN indexes exist
- fingerprint equality, foreign keys and ordering all keep their indexes

Establishing this took three attempts, and the first two conclusions were wrong. A casual plan
reading suggests the opposite: with sequential scans merely discouraged, the planner shows a
Bitmap Heap Scan and looks healthy — but the index it picks is `entries_workspace_recent_idx`,
driven by the leakproof `workspace_id` equality, with `@@` applied afterwards as a filter. The
search index is not involved. `07_performance.test.sql` settles it by dropping the workspace
predicate and penalising sequential scans by 1e10: at that price the planner would take any index
available, and as `authenticated` it still scans, while the owner running the identical statement
gets the GIN index.

**This is not a Phase 3 regression.** `entries_search_idx` has been unusable by real users since
Phase 0. It stayed invisible because query plans had only ever been inspected as the table owner,
who bypasses RLS — which is why the performance suite now runs as `authenticated` throughout.

**Measured cost today:** 35 ms for a full-text scan across 4,000 entries; 44 ms for a full
`search_records` call across 4,200 records. It grows linearly with the workspace.

**Not fixed, deliberately.** Every available fix changes the authorisation model:

| Option | What it costs |
|---|---|
| `ALTER FUNCTION ts_match_vq(tsvector,tsquery) LEAKPROOF` | Superuser, and a database-wide change to a system function's security marking |
| `search_records()` as `SECURITY DEFINER` with its own `is_workspace_member()` gate | Moves authorisation for search out of RLS — a second authorisation surface, which is the thing AD-17 exists to avoid |
| Accept it and revisit when volume demands | Nothing, until a workspace is large enough for 35 ms to become 350 ms |

Phase 3 ships the third. The first two are the user's call, not a unilateral one.

### Not done in Phase 3

- **File uploads.** `file_references.kind` has an `upload` value and a `storage_path` column
  waiting, but no object store is wired. The UI offers references and links only and says so —
  an upload control that stored a filename and no file would be exactly the fake rule 13 forbids.
  Lands in Phase 5 with the ingestion endpoint.
- **`POST /api/ingest`.** `ingestion_tokens` exists; the endpoint is Phase 5, and no
  unauthenticated ingestion surface was opened.
- **Model-assisted classification.** Phase 3 is deterministic by design (ARCHITECTURE §9 stage 4).
  Phase 6 may replace the mechanism; it does not get to replace the confirm gate.
- The three Phase 2 gaps (re-rating UI, relationship editing, supersede/lifecycle buttons) are
  still open.

These are named rather than mocked (rule 14).

---

## Phase 2 — Memory

### What Phase 0 had already built

The audit found that Phase 0 modelled the entire Phase 2 schema: `decisions`, `ideas`, `prompts`,
`prompt_versions`, `relationships`, and `context_snapshots` all existed with the right columns, and
`idea_status` already carried the exact six lifecycle states. Phase 1 left the write methods as
`NotYetImplemented` stubs rather than faking them. Phase 2 was therefore mostly a wire-up, not a
rebuild, and migration `0002` is additive: it creates one table plus one more for winning
selections, and drops nothing.

### Schema changes (0002)

| Change | Why |
|---|---|
| `decision_status` gains `proposed`, `rejected`, `archived` | The ledger needs a pre-settled state, a turned-down state distinct from superseded, and a filing state. `reversed` is kept — dropping an enum value is destructive |
| `supersede_decision()` + a CHECK | Rule 7 was unenforced for decisions: the columns existed with neither function nor constraint, so a decision could be superseded with a null reason |
| `timeline_events` view | The unified Timeline, `security_invoker = true` |
| `prompt_version_outcomes` | Append-only ratings, so rule 6 stands |
| `prompt_winning_selections` | Winning identifies a VERSION; history of winner changes survives |
| Indexes | Timeline ordering, supersession lookups in both directions |

### Design decisions recorded

- **AD-17** — derived read models are views with `security_invoker`, never materialised tables.
- **AD-18** — judgements about a record are appended, never written onto it.
- **Rule 6 restated** to name all four history tables.
- **Rule 9a added** — winning identifies a version, and `prompts.is_winning` is derived by trigger.

### Issues found and fixed

| # | Severity | Issue | Fix |
|---|---|---|---|
| 20 | **High — would have leaked** | A view runs as its OWNER unless `security_invoker` is set, reading past RLS on every underlying table. Verified by removing it against a scratch cluster: user B then saw all 8 of user A's rows | `security_invoker = true` on all three views, asserted locally and on hosted |
| 21 | **High — silent regression** | `prompt_winning_selections` gave PostgREST a second relationship path between `prompts` and `prompt_versions`, so the implicit embed became ambiguous and every prompt read threw. The Topic page failed to render, and with it the forms — subtopics and entries stopped persisting | Embeds name the constraint: `prompt_versions!prompt_versions_prompt_id_fkey` |
| 22 | Medium | Outcome ordering used `created_at`, but `now()` is fixed for a whole transaction, so two outcomes recorded together tied and "newest" degraded to comparing random uuids | Identity sequence, also immune to clock skew |
| 23 | **Medium — a check that lied** | `schema-parity.mjs` applied only `0001`, hardcoded, so it compared hosted against a stale reference and reported all 61 new objects as differences | Applies every migration in order |
| 24 | Medium | Touch targets of 16px on Timeline links at 390/375 | `min-h-11` on both link types |
| 25 | Low | A Home note promised Phase 2 features that now exist | Rewritten to name only what is still absent |
| 26 | **Medium — invisible failure** | Several forms on the Topic page carry an input named `title`, so an unscoped fill in the validator populated a different form and left the real one's required field empty. The browser blocked submission silently: no error, no row, and a page-content assertion would have seen the title text and passed | Every fill scoped to its own form. Caught only by the database assertion — the same class of failure AD-16 exists for |
| 27 | Low | Topic links on the three section pages were 16px. They passed earlier only because those pages had no data to render | `min-h-11` on all five |

### Creation forms

Phase 2 is not finished until each object can be created through the interface — repository
support plus a read-only screen is not "Decisions work". One controlled disclosure group on the
Topic workspace holds all three forms: opening a second closes the first, and the open panel takes
full width, so the page gains a row rather than three permanently-open forms. The global sections
reuse the same forms behind a topic picker rather than keeping their own copies, because every
memory object belongs to a topic (rule 1) and three copies would mean three places to change a
field.

The prompt form's outcome is the part worth care: it appends to `prompt_version_outcomes` and is
never written onto the version, so `prompt_versions` stays insert-only.

### Not done in Phase 2

- **`rateVersion` UI beyond creation.** An outcome can be set when a prompt is saved; re-rating an
  existing version has no screen yet, though the repository method and its tests exist.
- **Relationship editing UI.** `RelationshipRepository` reads and writes; nothing exposes linking.
- **Supersede and lifecycle controls.** Superseding a decision and moving an idea through its
  lifecycle work at the repository and database level, with tests, but have no buttons.

These are named rather than mocked (rule 14).

---

## Phase 1 — closed

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
| Chromium to an allowlisted HTTPS host | **reachable**, with the TLS 1.2 cap below |

The Chromium row previously read "blocked". That was a symptom, not the constraint. Chromium's
TLS 1.3 ClientHello carries a post-quantum key share and runs to roughly 1,700 bytes, spanning
more than one TCP segment, and the relay beyond the proxy resets the connection when it does — so
the tunnel is established (`200 Connection Established`) and then dies mid-handshake, surfacing as
a bare `ERR_CONNECTION_RESET` on a URL `curl` fetches perfectly, with nothing in the proxy's own
log. Read out of Chromium's own net log: a 1,733-byte ClientHello followed immediately by
`ECONNRESET`.

A second, independent problem sits behind the same symptom: the proxy re-signs *some* hosts with
its own CA and tunnels others through, and which is which changes between runs. A run that had
been passing failed mid-way with `ERR_CERT_AUTHORITY_INVALID` when a host it had been tunnelling
started being intercepted. Every other tool here is already told to trust that CA; Chromium reads
none of those, only the NSS database, and populating that needs `certutil`, which is absent.

`scripts/chromium-path.mjs` therefore does two things **when a proxy is configured**:

- caps at TLS 1.2, keeping the ClientHello inside one segment;
- passes the CA bundle's public-key fingerprints via
  `--ignore-certificate-errors-spki-list`, computed from the bundle at launch so a rotated CA is
  picked up and nothing can go stale.

Despite its name that flag is not `--ignore-certificate-errors`: it names exact public keys to
accept, which is what installing the CA would do. Nothing outside the bundle is trusted, chain,
hostname and expiry are all still verified, and a bad certificate still fails the run.

The end-to-end validation now drives the **real deployed URL** rather than a local production
build.

Three consequences, each with the workaround actually used:

- **`supabase db push` cannot run.** The migration was applied through the Management API's
  `database/query` endpoint — the fallback `docs/DEPLOYMENT.md` §4a already blesses. Migration
  history was then recorded in `supabase_migrations.schema_migrations`, which is what
  `migration repair --status applied 0001` would have written.
- **`supabase db diff --linked` cannot run**, so schema parity is checked by
  `npm run schema:parity` instead: the real migration is applied to a throwaway cluster and the
  catalogs are compared against hosted. This is a catalog comparison, not a byte-for-byte DDL
  diff, and should never be reported as "db diff clean".
- **The browser reaches the deployed URL** as of Phase 3, so the end-to-end run drives
  <https://contextshelf.vercel.app> itself — Vercel's edge serving included — against the real
  hosted Supabase.
- **`supabase db push` still cannot run**, so `npm run db:push:hosted` applies migrations over the
  Management API and records them in the same `supabase_migrations.schema_migrations` ledger
  `db push` would write. Phase 2 did this by hand with `curl`; it is now a script, so the next
  phase does not rediscover it.

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

## Test results (last run, 2026-08-14, end of Phase 5)

| Suite | Result |
|---|---|
| `npm run build` | pass — 22 routes |
| `npm run typecheck` | pass |
| `npm run lint` | pass, 0 warnings |
| `npm run test` | **265 passed** / 16 files |
| `npm run test:db` | **9 suites passed** against PostgreSQL 16.13, plus both hosted-script smoke tests |
| `npm run schema:parity` | columns 392, enums 17, RLS 29, policies 38, indexes 112, constraints 174, triggers 21, functions 20 — all matching |
| `hosted/01_verify_schema.sql` | **34/34 PASS** against `omhktzxwffaipmcoljic` |
| `hosted/02_rls_isolation.sql` | **ALL HOSTED RLS CHECKS PASSED**, rolled back |
| `npm run validate:hosted` | **128/128 checks pass** |
| Authenticated responsive QA | **105 combinations, 0 skipped, no layout failures** — now including the review workspace |
| Cross-device acceptance test | **PASS** — Work PC ↔ Mac, both directions, by the account holder |

Hosted data after validation: one workspace, one user, and the account holder's own
`Cross-device test from Work PC` topic. Every QA account, topic and row the validator creates is
deleted by its own cleanup — `context_snapshots`, `knowledge_entries`, `source_sessions` and
`ingestion_records` are all empty.

---

## Next task

**Connect the Anthropic provider**, if and when the account holder decides to. Everything else in
Phase 6 is finished; the exact one-time setup is in the Phase 6 section above, and the remaining
validation is listed there too.

After that, the outstanding items across phases, none of which blocks daily use: the MCP pathway
and rate limiting on `/api/ingest` (Phase 5), relationship editing (Phase 4), "link to existing"
as an action rather than a warning, and a browser companion for Chat/Cowork — which is a new
**adapter** posting the canonical payload to the existing endpoint, not a new write path (rule 20).
R2 in ARCHITECTURE §14 still holds: there is no supported export or API for Claude Chat and Cowork,
and nothing in the UI may imply otherwise until there is.

## Resume trigger

**IF** returning to ContextShelf development
**THEN** Phases 1–6 are complete, validated, and merged, except the Anthropic provider connection. The hosted project and the deployment
both exist and are proven, including cross-device continuity on two physical machines. Capture,
triage, search, files and recovery all work end to end, and a Topic or Subtopic now generates a
continuation prompt that a fresh Claude session can start from — assembled deterministically from
current records, with no model API and no second memory store. A Claude Code session can now
deliver its own work over an authenticated endpoint, idempotently, and that work reaches the
Timeline, search and the next Resume without a manual step — while every judgement it might have
made arrives as a proposal for you. Begin Phase 6 on a `phase-6-automation` branch, and read
"Not done in Phase 5" and the leakproof-limit note first — the MCP pathway, rate limiting,
relationship editing, the unwired realtime layer, and the full-text scan-not-index behaviour under
RLS are all live constraints.
