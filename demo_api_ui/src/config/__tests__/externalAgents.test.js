import { describe, expect, it } from 'vitest';
import { EXTERNAL_AGENTS, getExternalAgent, STANDARD_DOOR, AI_GATEWAY_DOOR } from '../externalAgents';
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

  it('every agent declares its app-side verification state (no unverified flow stated as fact)', () => {
    for (const a of EXTERNAL_AGENTS) {
      expect(['verified', 'expected'], a.id).toContain(a.verification);
    }
    // No per-client connection has been app-verified yet (matrix cells all ⏳),
    // so nothing may claim 'verified' — LM Studio's 2026-09-11 precedent is
    // machine-side only.
    expect(EXTERNAL_AGENTS.every((a) => a.verification === 'expected')).toBe(true);
  });

  it('consumer assistants connect only from the app directory (no URL, no paste in customer steps)', () => {
    const directory = EXTERNAL_AGENTS.filter((a) => a.path === 'directory').map((a) => a.id);
    expect(directory).toEqual(['muse-app', 'grok-app', 'chatgpt']);
    for (const a of EXTERNAL_AGENTS.filter((x) => x.path === 'directory')) {
      expect(a.assistant, a.id).toBeTruthy();
      expect(a.setup.length, a.id).toBeGreaterThanOrEqual(4);
      for (const step of a.setup) {
        const text = `${step.title} ${step.body}`;
        expect(text, a.id).not.toMatch(/https?:\/\//i);
        expect(text, a.id).not.toMatch(/\/mcp\b|localhost/i);
        expect(text, a.id).not.toMatch(/paste/i);
        expect(text, a.id).not.toMatch(/client[ _-]?id/i);
        expect(text, a.id).not.toMatch(/\bdoor\b/i);
      }
      const all = a.setup.map((s) => s.body).join(' ');
      expect(all, a.id).toMatch(/directory/i);
      expect(all, a.id).toMatch(/Connect/);
      expect(all, a.id).toMatch(/PingOne/);
      expect(all, a.id).toContain('sub=user, act=agent');
      // The real URL is kept only in the presenter-only rehearsal note.
      expect(a.rehearsal, a.id).toContain(STANDARD_DOOR);
    }
  });

  it('every non-directory agent is labelled a developer path', () => {
    for (const a of EXTERNAL_AGENTS) {
      expect(['directory', 'developer'], a.id).toContain(a.path);
    }
    const developer = EXTERNAL_AGENTS.filter((a) => a.path === 'developer').map((a) => a.id);
    expect(developer).toEqual(['muse-code', 'grok-cli', 'lm-studio', 'librechat']);
  });

  it('lesson-catalog demo steps for consumer assistants never ask the customer to paste a URL', () => {
    for (const id of ['muse-app', 'grok-app', 'chatgpt']) {
      const lesson = getLesson(id);
      expect(lesson.walkthrough.length, id).toBeGreaterThan(0);
      const text = JSON.stringify([lesson.walkthrough, lesson.talkingPoints]);
      expect(text, id).not.toMatch(/paste|https?:\/\/|SE-host (door )?URL/i);
    }
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

describe('runbook/lesson drift guard', () => {
  it('runbook URLs match the lesson page URLs', () => {
    const runbook = readFileSync(
      join(__dirname, '../../../../docs/MUSE_RUNBOOK.md'), 'utf8');
    expect(runbook).toContain('https://cmuir-mcp.ping-devops.com/mcp');
    expect(runbook).toContain('/mcp-facade/privilege-gateway/mcp');
    expect(runbook).toContain('UC-MUSE1');
    expect(runbook).toContain('UC-MUSE2');
  });

  it('the door constants themselves appear verbatim in the runbook and plan', () => {
    const runbook = readFileSync(join(__dirname, '../../../../docs/MUSE_RUNBOOK.md'), 'utf8');
    const plan = readFileSync(join(__dirname, '../../../../docs/superpowers/plans/2026-10-08-muse-user-agent-demo.md'), 'utf8');
    expect(runbook).toContain(STANDARD_DOOR);
    expect(runbook).toContain(AI_GATEWAY_DOOR);
    expect(plan).toContain(STANDARD_DOOR);
    // A change to either constant now fails here until the docs move with it.
  });
});
