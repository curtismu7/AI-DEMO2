import type { ReactNode } from 'react';

export interface ScheduleExplanationCopy {
  summary: string;
  capability: string;
  successMeaning: string;
  recovery: string;
  tone: 'neutral' | 'warning' | 'error';
}

const EXPLANATIONS: Record<string, ScheduleExplanationCopy> = {
  'Morning balance report': {
    summary: 'Reads account balances and the five most recent transactions.',
    capability: 'Read-only. It creates a summary chat and does not change money.',
    successMeaning: 'Success means the summary chat was created.',
    recovery: 'No action is needed when the report is current.',
    tone: 'neutral',
  },
  'Daily rentals check': {
    summary: 'Checks active equipment rentals through the Super Sports gateway.',
    capability: 'Read-only. It needs the seed account connected to the gateway.',
    successMeaning: 'Success means the rentals response was recorded in a chat.',
    recovery: 'Sign in to the Sports gateway once; LibreChat reconnects it on startup, then run it again.',
    tone: 'error',
  },
  'Weekly savings sweep': {
    summary: 'Attempts to transfer $750 from checking to savings.',
    capability: 'Moves money only after the required step-up approval completes.',
    successMeaning: 'A successful run does not mean money moved; it may stop for step-up.',
    recovery: 'Complete the step-up approval in the resulting chat before retrying.',
    tone: 'warning',
  },
};

const FALLBACK: ScheduleExplanationCopy = {
  summary: 'Runs the selected agent with its saved prompt.',
  capability: 'Capabilities depend on the selected agent.',
  successMeaning: 'Success means the scheduled agent run completed.',
  recovery: 'Review the latest run details for next steps.',
  tone: 'neutral',
};

export function getScheduleExplanation(name: string): ScheduleExplanationCopy {
  return EXPLANATIONS[name] ?? FALLBACK;
}

export function ScheduleExplanation({ copy }: { copy: ScheduleExplanationCopy }): ReactNode {
  return (
    <div className="mt-2 space-y-0.5 text-xs text-text-secondary">
      <p>{copy.summary}</p>
      <p>{copy.capability}</p>
      <p>
        <span className="font-medium text-text-primary">What success means:</span>{' '}
        {copy.successMeaning}
      </p>
      <p>
        <span className="font-medium text-text-primary">If it stops:</span> {copy.recovery}
      </p>
    </div>
  );
}
