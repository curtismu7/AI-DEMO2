import { describe, expect, it } from 'vitest';
import { EXTERNAL_AGENTS, getExternalAgent } from '../externalAgents';
import { lessonCatalog, getLesson } from '../../learning/lessonCatalog';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const IDS = ['muse-app', 'muse-code', 'grok-app', 'grok-cli', 'lm-studio', 'librechat', 'chatgpt'];

describe('externalAgents data module', () => {
  it('has an entry per agent id, with complete content', () => {
    expect(EXTERNAL_AGENTS.map((a) => a.id)).toEqual(IDS);
    for (const a of EXTERNAL_AGENTS) {
      expect(a.name).toBeTruthy();
      expect(a.runsWhere).toMatch(/cloud|your machine|open source/i);
      expect(a.setup.length).toBeGreaterThan(0);
      expect(a.doors.standard).toContain('cmuir-mcp.ping-devops.com');
      expect(a.coverage).toEqual(expect.arrayContaining(['onboard', 'read']));
      expect(a.failurePlaybook.length).toBeGreaterThan(0);
    }
  });

  it('governed-write coverage matches the plan matrix (Muse Code leads; local clients can too)', () => {
    const canWrite = EXTERNAL_AGENTS.filter((a) => a.coverage.includes('governed-write')).map((a) => a.id);
    expect(canWrite).toEqual(['muse-code', 'grok-cli', 'lm-studio', 'librechat']);
  });

  it('every agent has a lesson-catalog entry with a matching route', () => {
    for (const id of IDS) {
      const lesson = getLesson(id);
      expect(lesson, id).toBeTruthy();
      expect(lesson.route).toBe(`/external-agents/${id}`);
    }
  });

  it('drift guard: door URLs in the data module match the plan doc', () => {
    const plan = readFileSync(join(__dirname, '../../../../docs/superpowers/plans/2026-10-08-muse-user-agent-demo.md'), 'utf8');
    expect(plan).toContain('https://cmuir-mcp.ping-devops.com');
    expect(plan).toContain('/mcp-facade/privilege-gateway/mcp');
  });
});
