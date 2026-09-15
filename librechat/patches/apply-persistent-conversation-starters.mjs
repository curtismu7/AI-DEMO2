import { readFileSync, writeFileSync } from 'node:fs';

const chatViewPath = '/app/client/src/components/Chat/ChatView.tsx';
const testPath = '/app/client/src/components/Chat/__tests__/ChatView.spec.tsx';

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
