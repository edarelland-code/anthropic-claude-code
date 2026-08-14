import { describe, expect, it } from 'vitest';

import { toEntry, toSourceSession, toSubtopic, toTopic, toWinningPrompts } from './mappers';

/**
 * The adapter boundary is where snake_case rows become domain objects. A silent
 * mapping failure here would look like data loss to the user, so the cases that
 * matter are the ones where a field is absent or the wrong shape.
 */

describe('toTopic', () => {
  it('maps a full row', () => {
    const topic = toTopic({
      id: 't1',
      workspace_id: 'ws',
      name: 'DailyRelay',
      slug: 'dailyrelay',
      description: 'A relay app',
      goal: 'Ship v1',
      current_state: 'Builder done',
      status: 'active',
      progress: 40,
      pinned: true,
      resume_trigger_if: 'I return',
      resume_trigger_then: 'Finish testing',
      last_meaningful_update_at: '2026-08-05T00:00:00Z',
      archived_at: null,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-05T00:00:00Z',
    });

    expect(topic.name).toBe('DailyRelay');
    expect(topic.progress).toBe(40);
    expect(topic.pinned).toBe(true);
    // The two timestamps stay distinct — a rename must not look like progress.
    expect(topic.lastMeaningfulUpdateAt).not.toBe(topic.createdAt);
  });

  it('defaults rather than throwing on a sparse row', () => {
    const topic = toTopic({ id: 't1', workspace_id: 'ws', name: 'Bare' });
    expect(topic.status).toBe('active');
    expect(topic.progress).toBe(0);
    expect(topic.pinned).toBe(false);
    expect(topic.goal).toBeNull();
  });
});

describe('toSubtopic', () => {
  it('preserves the parent link that makes nesting work', () => {
    const sub = toSubtopic({
      id: 's2',
      workspace_id: 'ws',
      topic_id: 't1',
      parent_subtopic_id: 's1',
      name: 'App Icon',
      slug: 'app-icon',
      position: 2,
    });
    expect(sub.parentSubtopicId).toBe('s1');
    expect(sub.topicId).toBe('t1');
  });

  it('treats a root subtopic as having no parent', () => {
    const sub = toSubtopic({ id: 's1', workspace_id: 'ws', topic_id: 't1', name: 'Branding' });
    expect(sub.parentSubtopicId).toBeNull();
  });
});

describe('toEntry', () => {
  it('keeps provenance intact', () => {
    const entry = toEntry({
      id: 'e1',
      workspace_id: 'ws',
      topic_id: 't1',
      knowledge_type: 'decision',
      status: 'active',
      title: 'Approved geometry',
      source_type: 'claude_code',
      source_session_id: 'sess1',
      source_reference: 'lines 40-58',
      occurred_at: '2026-08-05T00:00:00Z',
    });

    expect(entry.sourceType).toBe('claude_code');
    expect(entry.sourceSessionId).toBe('sess1');
    expect(entry.sourceReference).toBe('lines 40-58');
  });

  it('falls back to manual provenance rather than inventing a source', () => {
    const entry = toEntry({ id: 'e1', workspace_id: 'ws', topic_id: 't1', title: 'Note' });
    expect(entry.sourceType).toBe('manual');
    expect(entry.sourceSessionId).toBeNull();
  });

  it('carries the supersession link and its reason', () => {
    const entry = toEntry({
      id: 'v1',
      workspace_id: 'ws',
      topic_id: 't1',
      title: 'Blue icon',
      status: 'superseded',
      superseded_by_id: 'v3',
      supersedes_reason: 'Did not read at 16px',
    });
    expect(entry.status).toBe('superseded');
    expect(entry.supersededById).toBe('v3');
    expect(entry.supersedesReason).toBe('Did not read at 16px');
  });

  it('flattens the joined subtopic rows', () => {
    const entry = toEntry({
      id: 'e1',
      workspace_id: 'ws',
      topic_id: 't1',
      title: 'Entry',
      entry_subtopics: [{ subtopic_id: 's1' }, { subtopic_id: 's2' }],
    });
    expect(entry.subtopicIds).toEqual(['s1', 's2']);
  });

  it('yields an empty list when the join was not selected', () => {
    expect(toEntry({ id: 'e1', workspace_id: 'ws', topic_id: 't1', title: 'X' }).subtopicIds).toEqual([]);
  });
});

describe('toSourceSession', () => {
  it('maps Claude Code git metadata and file arrays', () => {
    const session = toSourceSession({
      id: 'sess1',
      workspace_id: 'ws',
      source_type: 'claude_code',
      repo_url: 'https://github.com/example/repo',
      branch: 'main',
      commit_sha: 'abc123',
      files_changed: ['src/a.ts', 'src/b.ts'],
      files_added: ['src/c.ts'],
      files_removed: [],
      build_status: 'passing',
      occurred_at: '2026-08-05T00:00:00Z',
    });

    expect(session.branch).toBe('main');
    expect(session.filesChanged).toEqual(['src/a.ts', 'src/b.ts']);
    expect(session.filesRemoved).toEqual([]);
  });

  it('ignores non-string junk in a jsonb array instead of propagating it', () => {
    const session = toSourceSession({
      id: 'sess1',
      workspace_id: 'ws',
      files_changed: ['ok', 42, null, { path: 'x' }],
    });
    expect(session.filesChanged).toEqual(['ok']);
  });
});

describe('toWinningPrompts — the winner is a version, not the latest', () => {
  /**
   * The regression case, spelled out: v1 and v2 both exist, v2 is newer, and v1
   * is the one that was selected. Every consumer must see v1.
   */
  const promptRow = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    workspace_id: 'ws',
    topic_id: 't1',
    title: 'Icon prompt',
    is_winning: true,
    prompt_versions: [
      { id: 'v1', prompt_id: 'p1', workspace_id: 'ws', version: 1, body: 'VERSION ONE BODY', result: 'worked', created_at: '2026-08-01T00:00:00Z' },
      { id: 'v2', prompt_id: 'p1', workspace_id: 'ws', version: 2, body: 'VERSION TWO BODY', result: 'failed', created_at: '2026-08-05T00:00:00Z' },
    ],
    ...over,
  });

  const selection = (over: Record<string, unknown> = {}) => ({
    prompt_id: 'p1',
    prompt_version_id: 'v1',
    winning_version: 1,
    reason: 'v1 still renders better at 16px',
    ...over,
  });

  it('resolves the selected version, not the newest', () => {
    const [winner] = toWinningPrompts([promptRow()], [selection()]);
    expect(winner!.version?.id).toBe('v1');
    expect(winner!.version?.version).toBe(1);
    expect(winner!.version?.body).toBe('VERSION ONE BODY');
    expect(winner!.reason).toBe('v1 still renders better at 16px');
  });

  it('keeps the later version visible as history', () => {
    const [winner] = toWinningPrompts([promptRow()], [selection()]);
    // v2 is not the winner, but it is not hidden either — it is history, and
    // Full Audit renders it as such.
    expect(winner!.versions.map((v) => v.id)).toEqual(['v2', 'v1']);
  });

  it('ignores is_winning, which only says a winner exists somewhere', () => {
    // The flag is true and the versions are present, but nothing was selected.
    // Substituting the latest here is exactly the defect this guards.
    expect(toWinningPrompts([promptRow()], [])).toHaveLength(0);
  });

  it('reports a missing winner rather than substituting one', () => {
    const [winner] = toWinningPrompts([promptRow()], [selection({ prompt_version_id: 'gone' })]);
    expect(winner!.version).toBeNull();
    expect(winner!.versions).toHaveLength(2);
  });

  it('follows a changed selection to the newly chosen version', () => {
    const [winner] = toWinningPrompts([promptRow()], [selection({ prompt_version_id: 'v2', winning_version: 2 })]);
    expect(winner!.version?.id).toBe('v2');
  });
});
