'use strict';

import {
  A2A_LATEST_LESSONS,
  A2A_IMPLEMENTATION_STATUS,
} from '../a2aLearningLessons';

describe('latest A2A learning hub lessons', () => {
  it('covers the current protocol concepts that are missing from the one-shot walkthrough', () => {
    const ids = A2A_LATEST_LESSONS.map((lesson) => lesson.id);

    expect(ids).toEqual([
      'tasks-and-artifacts',
      'streaming-and-reconnect',
      'discovery-and-card-security',
      'multi-tenant-routing',
    ]);
    for (const lesson of A2A_LATEST_LESSONS) {
      expect(lesson.title).toBeTruthy();
      expect(lesson.body).toBeTruthy();
      expect(lesson.href).toMatch(/^https:\/\/a2a-protocol\.org\/latest\//);
    }
  });

  it('states implementation support honestly', () => {
    expect(A2A_IMPLEMENTATION_STATUS).toEqual([
      expect.objectContaining({ id: 'one-shot-message', state: 'supported' }),
      expect.objectContaining({ id: 'signed-agent-cards', state: 'supported' }),
      expect.objectContaining({ id: 'stateful-tasks', state: 'supported' }),
      expect.objectContaining({ id: 'streaming', state: 'supported' }),
      expect.objectContaining({ id: 'push-notifications', state: 'supported' }),
      expect.objectContaining({ id: 'reconnect', state: 'next' }),
    ]);
  });
});
