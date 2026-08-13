import { describe, expect, it, vi } from 'vitest';

import { toUserFacingError } from './errors';
import { ConflictError } from './ports/repositories';

describe('toUserFacingError', () => {
  it('surfaces a conflict so the user reloads instead of clobbering', () => {
    const result = toUserFacingError(
      new ConflictError('This topic changed on another device.', 'topic', 'abc'),
    );
    expect(result.conflict).toBe(true);
    expect(result.message).toMatch(/another device/);
  });

  it('tells the user nothing was saved when the database is unreachable', () => {
    const result = toUserFacingError(new Error('TypeError: fetch failed'));
    expect(result.retryable).toBe(true);
    expect(result.message).toMatch(/Nothing was saved/);
  });

  it('explains an expired session without losing the user data reassurance', () => {
    const result = toUserFacingError(new Error('JWT expired'));
    expect(result.message).toMatch(/Sign in again/);
    expect(result.message).toMatch(/nothing you saved has been lost/i);
  });

  it('reports a permission denial without describing the schema', () => {
    const result = toUserFacingError(
      new Error('new row violates row-level security policy for table "topics"'),
    );
    expect(result.message).toBe('You do not have access to that.');
    expect(result.message).not.toMatch(/topics|policy/);
  });

  it('never leaks raw driver detail for an unrecognised failure', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const secret = 'postgresql://admin:hunter2@db.internal:5432/prod relation "x" does not exist';
    const result = toUserFacingError(new Error(secret));

    expect(result.message).not.toMatch(/hunter2|postgresql:|relation/);
    expect(result.message).toMatch(/previous data is unaffected/);
    // The detail is still available to the operator, just not to the browser.
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('passes through deliberate phase gates verbatim', () => {
    const result = toUserFacingError(new Error('Creating decisions lands in Phase 2. It is not implemented yet.'));
    expect(result.message).toMatch(/Phase 2/);
  });

  it('passes through the supersede-reason requirement verbatim', () => {
    const result = toUserFacingError(new Error('A reason is required to supersede an entry.'));
    expect(result.message).toMatch(/reason is required/);
  });

  it('handles a non-Error throw without crashing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toUserFacingError('something odd').message).toBeTruthy();
    expect(toUserFacingError(null).message).toBeTruthy();
    spy.mockRestore();
  });
});
