import { describe, expect, it } from 'vitest';

import { shouldPrompt, updateReducer } from '../../ui/lib/updatestate.js';
import type { UpdateEvent, UpdatePhase, UpdateState } from '../../ui/lib/updatestate.js';

const at = (phase: UpdatePhase, failure: string | null = null): UpdateState => ({ phase, failure });

const TABLE: Array<{ when: string; from: UpdateState; event: UpdateEvent; to: UpdateState }> = [
  { when: 'ready', from: at('idle'), event: { type: 'ready' }, to: at('ready') },
  { when: 'ready', from: at('ready'), event: { type: 'ready' }, to: at('ready') },
  { when: 'ready', from: at('prompted'), event: { type: 'ready' }, to: at('prompted') },
  { when: 'ready', from: at('restarting'), event: { type: 'ready' }, to: at('restarting') },
  { when: 'prompt', from: at('ready'), event: { type: 'prompt' }, to: at('prompted') },
  { when: 'prompt', from: at('idle'), event: { type: 'prompt' }, to: at('idle') },
  { when: 'prompt', from: at('prompted'), event: { type: 'prompt' }, to: at('prompted') },
  { when: 'prompt', from: at('restarting'), event: { type: 'prompt' }, to: at('restarting') },
  {
    when: 'restart',
    from: at('prompted'),
    event: { type: 'restart' },
    to: at('restarting'),
  },
  {
    when: 'restart clears a stale failure',
    from: at('prompted', 'spawn failed'),
    event: { type: 'restart' },
    to: at('restarting'),
  },
  { when: 'restart', from: at('ready'), event: { type: 'restart' }, to: at('ready') },
  {
    when: 'restartFailed',
    from: at('restarting'),
    event: { type: 'restartFailed', message: 'spawn failed' },
    to: at('prompted', 'spawn failed'),
  },
  {
    when: 'restartFailed',
    from: at('idle'),
    event: { type: 'restartFailed', message: 'spawn failed' },
    to: at('idle'),
  },
];

describe.each(TABLE)('updateReducer: $when', ({ from, event, to }) => {
  it(`lands on ${to.phase} carrying ${JSON.stringify(to.failure)}`, () => {
    expect(updateReducer(from, event)).toEqual(to);
  });
});

// The failed restart reverts to the prompt WITH the backend message, so the
// dialog reports what happened instead of silently reverting.
it('carries the failure message back to the prompt', () => {
  const failed = updateReducer(at('restarting'), {
    type: 'restartFailed',
    message: 'spawn failed',
  });
  expect(failed).toEqual(at('prompted', 'spawn failed'));
  expect(updateReducer(failed, { type: 'restart' })).toEqual(at('restarting'));
});

const PROMPT_TABLE: Array<{ phase: UpdatePhase; modalOpen: boolean; prompts: boolean }> = [
  { phase: 'ready', modalOpen: false, prompts: true },
  { phase: 'ready', modalOpen: true, prompts: false },
  { phase: 'idle', modalOpen: false, prompts: false },
  { phase: 'prompted', modalOpen: false, prompts: false },
  { phase: 'restarting', modalOpen: false, prompts: false },
];

describe.each(PROMPT_TABLE)('shouldPrompt($phase) with modalOpen=$modalOpen', ({ phase, modalOpen, prompts }) => {
  it(prompts ? 'opens the prompt' : 'keeps the prompt closed', () => {
    expect(shouldPrompt(phase, modalOpen)).toBe(prompts);
  });
});
