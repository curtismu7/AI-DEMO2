import { randomUUID } from 'node:crypto';
import type { AgentCard, Message, Task } from '@a2a-js/sdk';
import type { Client } from '@a2a-js/sdk/client';
import {
  ClientFactory,
  ClientFactoryOptions,
  JsonRpcTransportFactory,
} from '@a2a-js/sdk/client';

function authenticatedFetch(bearer: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (bearer) headers.set('Authorization', `Bearer ${bearer}`);
    return fetch(input, { ...init, headers });
  };
}

export interface WorkerClient {
  sendQuestion(question: string, contextId: string): Promise<string>;
}

function textFromParts(parts: Message['parts'] | undefined): string {
  return (parts ?? [])
    .flatMap(part => part.kind === 'text' ? [part.text] : [])
    .join('\n')
    .trim();
}

function taskAnswer(task: Task): string {
  const message = task.status.message;
  const answer = textFromParts(message?.parts);
  if (task.status.state === 'failed') {
    throw new Error(answer || 'The worker A2A task failed');
  }
  return answer;
}

export async function buildWorkerClient(baseUrl: string, bearer: string): Promise<WorkerClient> {
  const base = baseUrl.replace(/\/+$/, '');
  const card: AgentCard = {
    protocolVersion: '0.3.0',
    name: 'analyst_agent',
    description: 'Access-review analyst holding the entitlement tools.',
    version: '1.0.0',
    url: `${base}/jsonrpc`,
    preferredTransport: 'JSONRPC',
    capabilities: { streaming: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'access_review',
        name: 'Access review',
        description: 'Look up user entitlements, role holders, grants on a resource, and access tickets.',
        tags: ['identity', 'access', 'review'],
      },
    ],
  };
  const transport = new JsonRpcTransportFactory({ fetchImpl: authenticatedFetch(bearer) });
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, { transports: [transport] }),
  );
  const client: Client = await factory.createFromAgentCard(card);

  return {
    async sendQuestion(question, contextId) {
      const result = await client.sendMessage({
        message: {
          kind: 'message',
          messageId: randomUUID(),
          contextId,
          role: 'user',
          parts: [{ kind: 'text', text: question }],
        },
        configuration: { blocking: true },
      });
      if ('status' in result) return taskAnswer(result);
      return textFromParts(result.parts) || 'The worker returned an empty A2A message.';
    },
  };
}
