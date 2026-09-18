import { readFileSync, writeFileSync } from 'node:fs';

const chatViewPath = '/app/client/src/components/Chat/ChatView.tsx';
const testPath = '/app/client/src/components/Chat/__tests__/ChatView.spec.tsx';
const scheduleCardPath = '/app/client/src/components/SidePanel/Schedules/ScheduleCard.tsx';
const scheduleExplanationPath = '/app/client/src/components/SidePanel/Schedules/ScheduleExplanation.tsx';
const scheduleExplanationTestPath = '/app/client/src/components/SidePanel/Schedules/__tests__/ScheduleExplanation.spec.tsx';
const mcpErrorRecoveryPath = '/app/client/src/components/Chat/Messages/Content/McpErrorRecovery.ts';
const mcpErrorRecoveryTestPath = '/app/client/src/components/Chat/Messages/Content/McpErrorRecovery.spec.ts';
const mcpRecoveryControllerPath = '/app/client/src/components/Chat/Messages/Content/McpRecoveryController.ts';
const mcpRecoveryControllerTestPath = '/app/client/src/components/Chat/Messages/Content/McpRecoveryController.spec.ts';
const overrideRoot = '/tmp/client-overrides';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first === -1 || source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`${label}: expected exactly one upstream match`);
  }
  return source.replace(before, after);
}

let chatView = readFileSync(chatViewPath, 'utf8');
chatView = replaceOnce(
  chatView,
  'function ChatView({ index = 0, project }: { index?: number; project?: TChatProject }) {',
  `export function shouldShowConversationStarters(isSubmitting: boolean) {
  return !isSubmitting;
}

function ChatView({ index = 0, project }: { index?: number; project?: TChatProject }) {`,
  'starter visibility helper',
);
chatView = replaceOnce(
  chatView,
  '{isLandingPage && <ConversationStarters />}',
  '{shouldShowConversationStarters(isSubmitting) && <ConversationStarters />}',
  'starter render condition',
);
writeFileSync(chatViewPath, chatView);

let test = readFileSync(testPath, 'utf8');
test = replaceOnce(
  test,
  "import ChatView from '../ChatView';",
  "import ChatView, { shouldShowConversationStarters } from '../ChatView';",
  'test import',
);
test += `

describe('ChatView conversation starters', () => {
  test('shows starters after a response settles', () => {
    expect(shouldShowConversationStarters(false)).toBe(true);
  });

  test('hides starters while a response is generating', () => {
    expect(shouldShowConversationStarters(true)).toBe(false);
  });
});
`;
writeFileSync(testPath, test);

const scheduleExplanation = readFileSync(`${overrideRoot}/ScheduleExplanation.tsx`, 'utf8');
writeFileSync(scheduleExplanationPath, scheduleExplanation);

const scheduleExplanationTest = readFileSync(`${overrideRoot}/ScheduleExplanation.spec.tsx`, 'utf8');
writeFileSync(scheduleExplanationTestPath, scheduleExplanationTest);

const mcpErrorRecovery = readFileSync(`${overrideRoot}/McpErrorRecovery.ts`, 'utf8');
writeFileSync(mcpErrorRecoveryPath, mcpErrorRecovery);

const mcpErrorRecoveryTest = readFileSync(`${overrideRoot}/McpErrorRecovery.spec.ts`, 'utf8');
writeFileSync(mcpErrorRecoveryTestPath, mcpErrorRecoveryTest);

const mcpRecoveryController = readFileSync(`${overrideRoot}/McpRecoveryController.ts`, 'utf8');
writeFileSync(mcpRecoveryControllerPath, mcpRecoveryController);

const mcpRecoveryControllerTest = readFileSync(`${overrideRoot}/McpRecoveryController.spec.ts`, 'utf8');
writeFileSync(mcpRecoveryControllerTestPath, mcpRecoveryControllerTest);

let messageContent = readFileSync('/app/client/src/components/Chat/Messages/Content/MessageContent.tsx', 'utf8');
messageContent = replaceOnce(
  messageContent,
  "import { memo, Suspense, useMemo } from 'react';",
  "import { memo, Suspense, useMemo, useState } from 'react';",
  'message recovery state import',
);
messageContent = replaceOnce(
  messageContent,
  "import { useMessageContext } from '~/Providers';",
  "import { useMessageContext, useMessagesOperations } from '~/Providers';",
  'message recovery operations import',
);
messageContent = replaceOnce(
  messageContent,
  "import { useLocalize } from '~/hooks';",
  "import { useLocalize, useMCPServerManager } from '~/hooks';",
  'message recovery MCP manager import',
);
messageContent = replaceOnce(
  messageContent,
  "import Error from '~/components/Messages/Content/Error';",
  "import Error from '~/components/Messages/Content/Error';\nimport { createMcpRecoveryController } from './McpRecoveryController';",
  'message recovery controller import',
);
messageContent = replaceOnce(
  messageContent,
  `export const ErrorMessage = ({
  text,
  message,
  className = '',
}: Pick<TDisplayProps, 'text' | 'className'> & { message?: TMessage }) => {
  if (text === ERROR_CONNECTION_TEXT) {
    return <ConnectionError message={message} />;
  }

  return (
    <Container message={message}>
      <ErrorBox className={className}>
        <Error text={text} />
      </ErrorBox>
    </Container>
  );
};`,
  `const recoveryMessage = (status: string | undefined) => {
  switch (status) {
    case 'authentication-required':
      return 'Authentication is required to reconnect. Complete the sign-in window, then try again.';
    case 'no-server':
      return 'No MCP server is selected for this chat. Select a server and try again.';
    case 'reconnect-failed':
      return 'The MCP server could not reconnect. Check the gateway and try again.';
    case 'timeout':
      return 'The MCP reconnect timed out. Check the gateway and try again.';
    case 'delete-failed':
      return 'The MCP server reconnected, but this error could not be cleared. Try again.';
    case 'in-flight':
      return 'A reconnect is already in progress.';
    default:
      return undefined;
  }
};

export const ErrorMessage = ({
  text,
  message,
  className = '',
}: Pick<TDisplayProps, 'text' | 'className'> & { message?: TMessage }) => {
  const { getMessages, setMessages } = useMessagesOperations();
  const { initializeServer, mcpValues } = useMCPServerManager({
    conversationId: message?.conversationId,
  });
  const [recoveryStatus, setRecoveryStatus] = useState<string>();
  const [isRecovering, setIsRecovering] = useState(false);
  const isMcpToolsUnavailable = text.includes('AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE');

  const controller = useMemo(
    () =>
      createMcpRecoveryController({
        serverNames: mcpValues ?? [],
        initializeServer: async (serverName, force) => {
          const result = await initializeServer(serverName, force);
          return {
            success: result?.success ?? false,
            oauthRequired: result?.oauthRequired,
          };
        },
        deleteMessage: async () => {
          const conversationId = message?.conversationId;
          const messageId = message?.messageId;
          if (!conversationId || !messageId) {
            throw new Error('Cannot clear a message without conversation and message IDs');
          }

          const response = await fetch(
            '/api/messages/' + encodeURIComponent(conversationId) + '/' + encodeURIComponent(messageId),
            { method: 'DELETE', credentials: 'include' },
          );
          if (!response.ok) {
            throw new Error('Unable to clear the MCP error message');
          }

          const messages = getMessages();
          if (messages) {
            setMessages(messages.filter((currentMessage) => currentMessage.messageId !== messageId));
          }
        },
        timeoutMs: 10_000,
      }),
    [getMessages, initializeServer, mcpValues, message?.conversationId, message?.messageId, setMessages],
  );

  if (text === ERROR_CONNECTION_TEXT) {
    return <ConnectionError message={message} />;
  }

  const handleRecovery = async () => {
    setIsRecovering(true);
    const result = await controller.recover();
    setRecoveryStatus(result.status);
    setIsRecovering(false);
  };

  return (
    <Container message={message}>
      <ErrorBox className={className}>
        <Error text={text} />
        {isMcpToolsUnavailable && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-status-error-border px-2 py-1 text-xs font-medium text-text-primary hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleRecovery}
              disabled={isRecovering}
            >
              {isRecovering ? 'Reconnecting…' : 'Clear error & reconnect'}
            </button>
            {recoveryMessage(recoveryStatus) && (
              <span className="text-xs text-text-secondary" aria-live="polite">
                {recoveryMessage(recoveryStatus)}
              </span>
            )}
          </div>
        )}
      </ErrorBox>
    </Container>
  );
};`,
  'MCP recovery error UI',
);
writeFileSync('/app/client/src/components/Chat/Messages/Content/MessageContent.tsx', messageContent);

let schedulePanel = readFileSync('/app/client/src/components/SidePanel/Schedules/SchedulePanel.tsx', 'utf8');
schedulePanel = replaceOnce(
  schedulePanel,
  '  const [createOpen, setCreateOpen] = useState(false);\n',
  "  const [createOpen, setCreateOpen] = useState(false);\n  const [filter, setFilter] = useState<'all' | 'attention' | 'paused'>('all');\n",
  'schedule panel filter state',
);
schedulePanel = replaceOnce(
  schedulePanel,
  '  const schedules = data?.schedules ?? [];\n',
  "  const schedules = data?.schedules ?? [];\n  const attentionCount = schedules.filter(\n    (schedule) => schedule.lastRun?.status === 'error' || schedule.disabledReason != null,\n  ).length;\n  const visibleSchedules = schedules.filter((schedule) => {\n    if (filter === 'attention') return schedule.lastRun?.status === 'error' || schedule.disabledReason != null;\n    if (filter === 'paused') return !schedule.enabled;\n    return true;\n  });\n",
  'schedule panel filtered schedules',
);
schedulePanel = replaceOnce(
  schedulePanel,
  '        {schedules.map((schedule) => (',
  '        {visibleSchedules.map((schedule) => (',
  'schedule panel filtered render',
);
schedulePanel = replaceOnce(
  schedulePanel,
  '      <div className="shrink-0 px-3 pb-2">\n',
  '      <div className="shrink-0 space-y-2 px-3 pb-2">\n',
  'schedule panel header layout',
);
schedulePanel = replaceOnce(
  schedulePanel,
  '        </div>\n      </div>\n\n      <PanelContent',
  "        </div>\n        <div className=\"grid grid-cols-3 gap-1 text-center text-[11px] text-text-secondary\" aria-label=\"Schedule summary\">\n          <div className=\"rounded-md bg-surface-secondary px-2 py-1.5\"><span className=\"block text-sm font-semibold text-text-primary\">{schedules.length}</span> total</div>\n          <div className=\"rounded-md bg-surface-secondary px-2 py-1.5\"><span className=\"block text-sm font-semibold text-text-primary\">{schedules.filter((schedule) => schedule.enabled).length}</span> active</div>\n          <div className=\"rounded-md bg-surface-secondary px-2 py-1.5\"><span className=\"block text-sm font-semibold text-text-primary\">{attentionCount}</span> attention</div>\n        </div>\n        <div className=\"flex gap-1\" role=\"tablist\" aria-label=\"Filter schedules\">\n          {([['all', 'All'], ['attention', 'Needs attention'], ['paused', 'Paused']] as const).map(([value, label]) => (\n            <button key={value} type=\"button\" role=\"tab\" aria-selected={filter === value} className={`rounded-md px-2 py-1 text-xs ${filter === value ? 'bg-surface-tertiary font-medium text-text-primary' : 'text-text-secondary hover:bg-surface-secondary'}`} onClick={() => setFilter(value)}>\n              {label}\n            </button>\n          ))}\n        </div>\n      </div>\n\n      <PanelContent",
  'schedule panel summary and filters',
);
writeFileSync('/app/client/src/components/SidePanel/Schedules/SchedulePanel.tsx', schedulePanel);

let scheduleCard = readFileSync(scheduleCardPath, 'utf8');
scheduleCard = replaceOnce(
  scheduleCard,
  "import { describeCadence } from './cadence';",
  "import { describeCadence } from './cadence';\nimport { ScheduleExplanation, getScheduleExplanation } from './ScheduleExplanation';",
  'schedule explanation import',
);
scheduleCard = replaceOnce(
  scheduleCard,
  '  const cadenceText = describeCadence(\n',
  '  const explanation = getScheduleExplanation(schedule.name);\n\n  const cadenceText = describeCadence(\n',
  'schedule explanation lookup',
);
scheduleCard = replaceOnce(
  scheduleCard,
  '      <p className="mt-0.5 truncate text-xs text-text-secondary" title={agentName}>\n        {agentName}\n      </p>\n',
  '      <p className="mt-0.5 truncate text-xs text-text-secondary" title={agentName}>\n        {agentName}\n      </p>\n      <ScheduleExplanation copy={explanation} />\n',
  'schedule explanation render',
);
scheduleCard = replaceOnce(
  scheduleCard,
  '      <p className="mt-1 text-sm text-text-primary">{cadenceText}</p>\n',
  '      <p className="mt-1 text-sm text-text-primary">{cadenceText}</p>\n      <div className="mt-2 flex items-center gap-2">\n        {canWrite && (\n          <button type="button" className="rounded-md border border-border-light px-2 py-1 text-xs font-medium text-text-primary hover:bg-surface-secondary" aria-label={`${schedule.enabled ? \'Pause\' : \'Resume\'} schedule: ${schedule.name}`} onClick={() => handleToggle(!schedule.enabled)} disabled={updateSchedule.isLoading}>\n            {schedule.enabled ? \'Pause schedule\' : \'Resume schedule\'}\n          </button>\n        )}\n        {canWrite && (\n          <button type="button" className="rounded-md px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-secondary hover:text-text-primary" aria-label={`Run now: ${schedule.name}`} onClick={handleRunNow} disabled={runSchedule.isLoading}>\n            {runSchedule.isLoading ? \'Starting…\' : \'Run now\'}\n          </button>\n        )}\n      </div>\n',
  'schedule explicit controls',
);
writeFileSync(scheduleCardPath, scheduleCard);
