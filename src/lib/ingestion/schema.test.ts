import { describe, expect, it } from 'vitest';

import { validateClaudeSessionImport } from './schema';

/**
 * The canonical payload's Phase 5 half: what a machine may state, and what it
 * may not.
 *
 * The interesting assertions here are the refusals. A validator that silently
 * dropped an unknown key would hand a client a 200 for an operation that never
 * happened — the client would go on believing a decision had been superseded,
 * and the only evidence would be its absence. So an unrecognised key is an
 * error that names itself, both here and in the database.
 */

const base = {
  version: 1,
  source: 'claude_code',
  code: { repoUrl: 'https://github.com/e/r', branch: 'main', commitSha: 'abc1234' },
};

describe('work', () => {
  it('accepts the three things a session may report', () => {
    const r = validateClaudeSessionImport({
      ...base,
      work: {
        completedActions: [{ title: 'Wire the export button' }],
        nextActions: [{ kind: 'next_step', title: 'Render the receipt ids' }],
        proposedDecisions: [{ title: 'Drop the exporter', decision: 'Remove it' }],
      },
    });
    expect(r.ok).toBe(true);
    expect(r.value?.work?.completedActions).toHaveLength(1);
    expect(r.value?.work?.nextActions?.[0]?.kind).toBe('next_step');
  });

  it('is a complete payload on its own, with no transcript', () => {
    // A commit that closed one action and opened the next is a real report
    // even when there is no conversation worth keeping.
    const r = validateClaudeSessionImport({
      ...base,
      work: { nextActions: [{ title: 'Ship the receipt view' }] },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a payload with nothing in it at all', () => {
    const r = validateClaudeSessionImport(base);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/at least one message, segment or work item/);
  });

  it.each([
    'supersedeDecisions',
    'rejectIdeas',
    'currentState',
    'winningPrompt',
    'deleteRecords',
    'resolveConflicts',
  ])('refuses %s, and says so by name', (key) => {
    const r = validateClaudeSessionImport({ ...base, work: { [key]: [] } });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain(`work.${key}`);
    expect(r.errors.join(' ')).toMatch(/stay with a signed-in person/);
  });

  it('warns that a proposed decision is not a decision yet', () => {
    const r = validateClaudeSessionImport({
      ...base,
      work: { proposedDecisions: [{ title: 'A', decision: 'B' }] },
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/PROPOSED/);
    expect(r.warnings.join(' ')).toMatch(/until someone approves/);
  });

  it('requires a decision to say what was decided', () => {
    const r = validateClaudeSessionImport({
      ...base,
      work: { proposedDecisions: [{ title: 'Something changed' }] },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/decision is required/);
  });

  it('needs enough to find an action before it will close one', () => {
    const r = validateClaudeSessionImport({ ...base, work: { completedActions: [{}] } });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/needs an id or a title/);
  });

  it('rejects an id that is not a uuid rather than passing it to the database', () => {
    const r = validateClaudeSessionImport({
      ...base,
      work: { completedActions: [{ id: 'action-7' }] },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/must be a uuid/);
  });

  it('rejects an action kind outside the three that exist', () => {
    const r = validateClaudeSessionImport({
      ...base,
      work: { nextActions: [{ kind: 'urgent', title: 'x' }] },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/"next_step", "blocker" or "question"/);
  });
});

describe('target', () => {
  it('accepts a topic and subtopic as uuids', () => {
    const r = validateClaudeSessionImport({
      ...base,
      work: { nextActions: [{ title: 'x' }] },
      target: {
        topicId: '11111111-2222-3333-4444-555555555555',
        subtopicId: '66666666-7777-8888-9999-aaaaaaaaaaaa',
      },
    });
    expect(r.ok).toBe(true);
    expect(r.value?.target?.topicId).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('refuses a subtopic with no topic', () => {
    const r = validateClaudeSessionImport({
      ...base,
      work: { nextActions: [{ title: 'x' }] },
      target: { subtopicId: '66666666-7777-8888-9999-aaaaaaaaaaaa' },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/cannot be given without target.topicId/);
  });
});

describe('the workspace is never the payload’s to name', () => {
  it.each(['workspaceId', 'workspace'])('ignores %s and says it was ignored', (key) => {
    const r = validateClaudeSessionImport({
      ...base,
      work: { nextActions: [{ title: 'x' }] },
      [key]: 'someone-elses-workspace',
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/comes from the token/);
    // Nothing carried it forward — the validated value has no such field.
    expect(JSON.stringify(r.value)).not.toContain('someone-elses-workspace');
  });
});

describe('code', () => {
  it('carries build and test state through', () => {
    const r = validateClaudeSessionImport({
      ...base,
      code: { ...base.code, buildStatus: 'passed', testSummary: '163 passed, 0 failed' },
      work: { nextActions: [{ title: 'x' }] },
    });
    expect(r.value?.code?.buildStatus).toBe('passed');
    expect(r.value?.code?.testSummary).toBe('163 passed, 0 failed');
  });

  it('rejects a file list that is not a list of strings', () => {
    const r = validateClaudeSessionImport({
      ...base,
      code: { ...base.code, filesChanged: [{ path: 'src/a.ts' }] },
      work: { nextActions: [{ title: 'x' }] },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/code.filesChanged must be an array of strings/);
  });
});
