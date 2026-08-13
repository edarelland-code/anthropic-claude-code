import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configurationProblem, isConfigured, readEnv } from './env';

/**
 * The environment contract. A rename here breaks the deployed app in a way no
 * type error catches, so the variable names are asserted literally.
 */

const KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('readEnv', () => {
  it('reads the publishable key', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_abc123';

    expect(readEnv()).toEqual({
      url: 'https://abc.supabase.co',
      publishableKey: 'sb_publishable_abc123',
    });
    expect(isConfigured()).toBe(true);
  });

  it('does not fall back to the legacy anon key', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'legacy.jwt.value';

    expect(readEnv()).toBeNull();
    expect(isConfigured()).toBe(false);
  });

  it('treats the .env.example placeholder as unconfigured', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_abc123';

    expect(isConfigured()).toBe(false);
  });

  it('is unconfigured when nothing is set', () => {
    expect(isConfigured()).toBe(false);
  });
});

describe('configurationProblem', () => {
  it('is silent when configuration is complete', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_abc123';

    expect(configurationProblem()).toBeNull();
  });

  it('names the legacy variable when only that one is set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'legacy.jwt.value';

    const problem = configurationProblem();
    expect(problem).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY is set/);
    expect(problem).toMatch(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    expect(problem).toMatch(/sb_publishable_/);
  });

  it('never echoes the key value back', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'legacy.jwt.value';

    expect(configurationProblem()).not.toMatch(/legacy\.jwt\.value/);
  });

  it('reports a missing url first', () => {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_abc123';
    expect(configurationProblem()).toMatch(/NEXT_PUBLIC_SUPABASE_URL is not set/);
  });

  it('reports the placeholder url distinctly from a missing one', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_abc123';

    expect(configurationProblem()).toMatch(/placeholder/);
  });

  it('reports a missing publishable key with no legacy fallback present', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';
    const problem = configurationProblem();
    expect(problem).toBe('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.');
  });
});
