import { verticalSuggestionChips } from '../components/agentChrome';

const RECALL = 'What do you remember about me?';
const NEUTRAL = ['Always keep your answers short', 'Call me Sam'];

/**
 * Dot's suggested prompts for the ACTIVE vertical: its first three plain chips (the same prompts
 * the main agent offers; mode 'direct' attack-sim chips are skipped), then the generic recall question,
 * which is what makes Dot Dot. Signed-out guests get a stripped manifest (identity + theme only,
 * see routes/verticalManifest.js /me) and a manifest that is still loading has none either: those
 * get two vertical-neutral preference prompts instead, never another vertical's prompts.
 * @returns {{ label: string, message: string }[]}
 */
export function dotSuggestions(pageManifest) {
  const own = verticalSuggestionChips(pageManifest)
    .filter((c) => c.message && c.mode !== 'direct')
    .slice(0, 3)
    .map((c) => ({ label: c.label, message: c.message }));
  const lead = own.length ? own : NEUTRAL.map((t) => ({ label: t, message: t }));
  return [...lead, { label: RECALL, message: RECALL }];
}

// The Studio and pop-out chats talk to the airline demo, so every skin offers the same airline prompts;
// Dot adds the recall question, which is what makes Dot Dot. Transfer miles shows the PingOne MFA approval.
const AIRLINE_PROMPTS = [
  'What is my loyalty status?',
  'Show my airline bookings',
  'Transfer 20,000 of my miles to my brother',
];

/** @returns {{ label: string, message: string }[]} */
export function airlineSuggestions(skin) {
  const prompts = skin === 'dot' ? [...AIRLINE_PROMPTS, RECALL] : AIRLINE_PROMPTS;
  return prompts.map((t) => ({ label: t, message: t }));
}
