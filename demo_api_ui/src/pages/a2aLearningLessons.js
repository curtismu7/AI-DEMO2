'use strict';

/**
 * Lessons derived from the current A2A documentation, kept separate from the
 * page component so the learning contract can be tested without rendering.
 */
export const A2A_LATEST_LESSONS = [
  {
    id: 'tasks-and-artifacts',
    title: 'Tasks are the durable unit of work',
    body: 'A quick answer can be a Message, but long-running work should become a Task with a contextId, taskId, lifecycle states, and versioned Artifacts. Our walkthrough is intentionally one-shot today.',
    href: 'https://a2a-protocol.org/latest/topics/life-of-a-task/',
  },
  {
    id: 'streaming-and-reconnect',
    title: 'Design for progress and reconnects',
    body: 'Use SendStreamingMessage for incremental status and artifact updates, and SubscribeToTask when an SSE connection breaks. Push notifications are the fit for clients that cannot stay connected.',
    href: 'https://a2a-protocol.org/latest/topics/streaming-and-async/',
  },
  {
    id: 'discovery-and-card-security',
    title: 'An Agent Card is capability metadata',
    body: 'Cards describe interfaces, skills, and authentication requirements. Keep secrets out of them, protect sensitive cards, verify signatures, and cache them with normal HTTP validators such as ETag.',
    href: 'https://a2a-protocol.org/latest/topics/agent-discovery/',
  },
  {
    id: 'multi-tenant-routing',
    title: 'Make routing explicit when agents are shared',
    body: 'Our vertical is in the URL today. If several tenants share an Agent Card or endpoint, the selected supportedInterfaces entry can advertise an opaque tenant value that the client must echo on every request.',
    href: 'https://a2a-protocol.org/latest/topics/multi-tenancy/',
  },
];

export const A2A_IMPLEMENTATION_STATUS = [
  {
    id: 'one-shot-message',
    label: 'One-shot JSON-RPC message/send',
    state: 'supported',
    detail: 'Live in this walkthrough; the wire bearer and provenance are shown.',
  },
  {
    id: 'signed-agent-cards',
    label: 'Signed Agent Cards',
    state: 'supported',
    detail: 'Live with a local JWKS trust boundary and explicit supportedInterfaces.',
  },
  {
    id: 'stateful-tasks',
    label: 'Stateful tasks, artifacts, and follow-ups',
    state: 'next',
    detail: 'Next implementation milestone: durable task storage and task lifecycle coverage.',
  },
  {
    id: 'streaming-and-push',
    label: 'Streaming, reconnect, and push notifications',
    state: 'next',
    detail: 'Next implementation milestone: advertise only after the transport and webhook security are real.',
  },
];
