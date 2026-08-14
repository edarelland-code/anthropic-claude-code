-- ContextShelf — Phase 3 (Capture & retrieval), part 1 of 2: enum values only.
--
-- This file exists separately from 0004 for one reason. PostgreSQL refuses to
-- USE a value added to an enum by `alter type ... add value` in the same
-- transaction that added it:
--
--   ERROR: unsafe use of new value "ingestion_record" of enum type entity_type
--
-- 0004 creates a view that casts these literals, so the two must land in
-- different transactions. Splitting the file is the portable way to guarantee
-- that: `supabase db push` and the Management API both apply one migration per
-- transaction, whereas relying on psql autocommit would only work locally.
--
-- Additive only. No value is renamed and none is removed — dropping an enum
-- value is destructive and would break every row already using it (rule 5).

-- ---------------------------------------------------------------------------
-- 1. Inbox states
--
-- Phase 0 gave ingestion_records four states, which were enough for "it
-- arrived / it was filed / it is done / throw it away". Triage needs more:
-- a state for an item the deterministic extractor could not confidently split
-- ('needs_review'), one for an item where some segments were filed and others
-- were not ('partially_processed'), one for an item whose adapter raised
-- ('failed'), and a terminal filing state that is not a value judgement
-- ('archived').
--
-- 'discarded' is kept as a legacy value, exactly as 'reversed' was kept on
-- decision_status in 0002. New writes produce 'archived' instead.
-- ---------------------------------------------------------------------------

alter type ingestion_status add value if not exists 'needs_review';
alter type ingestion_status add value if not exists 'partially_processed';
alter type ingestion_status add value if not exists 'failed';
alter type ingestion_status add value if not exists 'archived';

-- ---------------------------------------------------------------------------
-- 2. Two more addressable entity types
--
-- entity_type is the address space for relationships, tags, the deletion log,
-- and now the search projection. Two record types were missing from it:
--
--   ingestion_record  — so an inbox item can be linked to the records it
--                       produced, tagged, and named as a search hit.
--   context_snapshot  — so a SAVED memory snapshot can be addressed and shown
--                       in search results as a snapshot.
--
-- Adding context_snapshot does NOT make snapshots authoritative. AD-8 still
-- holds: Master Topic Memory is derived on every read and a snapshot is a
-- historical rendering of it, never a second Current State. 0004's search view
-- labels snapshot hits accordingly.
-- ---------------------------------------------------------------------------

alter type entity_type add value if not exists 'ingestion_record';
alter type entity_type add value if not exists 'context_snapshot';
