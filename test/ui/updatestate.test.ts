import { describe, expect, it } from 'vitest';

import { shouldPrompt, updateReducer } from '../../ui/lib/updatestate.js';
import type { UpdateEvent, UpdatePhase } from '../../ui/lib/updatestate.js';

const TABLE: Array<{ when: string; from: UpdatePhase; event: UpdateEvent; to: UpdatePhase }> = [
  { when: 'ready', from: 'idle', event: { type: 'ready' }, to: 'ready' },
  { when: 'ready', from: 'ready', event: { type: 'ready' }, to: 'ready' },
  { when: 'ready', from: 'prompted', event: { type: 'ready' }, to: 'prompted' },
  { when: 'ready', from: 'restarting', event: { type: 'ready' }, to: 'restarting' },
  { when: 'prompt', from: 'ready', event: { type: 'prompt' }, to: 'prompted' },
  { when: 'prompt', from: 'idle', event: { type: 'prompt' }, to: 'idle' },
  { when: 'prompt', from: 'prompted', event: { type: 'prompt' }, to: 'prompted' },
  { when: 'prompt', from: 'restarting', event: { type: 'prompt' }, to: 'restarting' },
  { when: 'restart', from: 'prompted', event: { type: 'restart' }, to: 'restarting' },
  { when: 'restart', from: 'ready', event: { type: 'restart' }, to: 'ready' },
  { when: 'restartFailed', from: 'restarting', event: { type: 'restartFailed' }, to: 'prompted' },
  { when: 'restartFailed', from: 'idle', event: { type: 'restartFailed' }, to: 'idle' },
];

describe.each(TABLE)('updateReducer: $when from $from', ({ from, event, to }) => {
  it(`lands on ${to}`, () => {
    expect(updateReducer(from, event)).toBe(to);
  });
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
