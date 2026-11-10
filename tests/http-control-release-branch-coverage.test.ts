import { expect, it } from 'vitest';
import { planManagedControlAnswer, managedControlAnswerId } from '../src/managed-runtime/control-input-plan.js';
import { createManagedHarnessHttpControlChannel, type ManagedHarnessWireEvent } from '../src/managed-runtime/http-control.js';

const event = (id: string, type: string, fields = {}): ManagedHarnessWireEvent => ({ id, type, processed_at: null, ...fields });
const answer = event('answer', 'user.tool_confirmation', { tool_use_id: 'call' });
it('isolates answer threads and rejects unknown or unspecified pending requests', () => {
  const paused = event('pause', 'session.status_idle', { stop_reason: { type: 'requires_action', event_ids: ['call'] } });
  expect(planManagedControlAnswer([paused, { ...answer, session_thread_id: 'other' }], answer)).toBe('release');
  expect(planManagedControlAnswer([paused], { ...answer, tool_use_id: 'unknown' })).toBe('closed');
  expect(planManagedControlAnswer([event('pause', 'session.status_idle', { stop_reason: { type: 'requires_action' } })], answer)).toBe('closed');
  expect(managedControlAnswerId(event('result', 'agent.tool_result', { tool_use_id: 'call' }))).toBe('call');
  expect(planManagedControlAnswer([paused, event('result', 'agent.tool_result', { tool_use_id: 'call' })], answer)).toBe('closed');
});

const scope = { workspaceId: 'w', environmentId: 'e', sessionId: 's', workId: 'work' };
const options = { scope, harness: { id: 'acp', version: '1' }, workspacePath: '/workspace', apiBaseUrl: 'https://test', sessionsToken: 'token', fetch: async () => Response.json({ id: 's', environment_id: 'e' }) };
it('rejects missing canonical input before either dispatch or receipt hook runs', async () => {
  let hooks = 0;
  const channel = createManagedHarnessHttpControlChannel({ ...options,
    onBeforeDispatch: async () => { hooks++; }, onConsumed: async () => { hooks++; },
  });
  const command = { type: 'session.prompt' as const, sessionId: 's', turnId: 'root', text: 'hello' };
  await expect(channel.beforeDispatch!(command, new AbortController().signal)).rejects.toThrow('Canonical input context');
  await expect(channel.onConsumed!(command, 'prompt-dispatched')).rejects.toThrow('Canonical input context');
  expect(hooks).toBe(0);
  await channel.close();
});
it('replays a queued confirmation before idle and ignores empty native system context', async () => {
  const confirmations: string[] = [];
  let page = 0;
  const channel = createManagedHarnessHttpControlChannel({ ...options,
    scheduler: { sleep: async () => {} },
    onToolConfirmation: async ({ event }) => { confirmations.push(event.id); return 'answered'; },
    eventReader: { async read() {
      page++;
      return { events: page === 1 ? [answer, event('idle', 'session.status_idle')] : [
        event('context', 'system.message', { source_position: { revision: 2, index: 0 }, content: [] }),
        event('next', 'user.message', { content: [{ type: 'text', text: 'next' }] }),
        event('end', 'session.status_terminated'),
      ], cursor: String(page), hasMore: false };
    } },
  });
  const commands = [];
  for await (const command of channel.commands(new AbortController().signal)) commands.push(command);
  expect(confirmations).toEqual(['answer']);
  expect(commands.filter(command => command.type === 'session.prompt')).toMatchObject([{ text: 'next', turnId: 'next' }]);
  await channel.close();
});
