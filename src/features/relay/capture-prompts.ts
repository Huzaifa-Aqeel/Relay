export const CAPTURE_PROMPTS = [
  {
    id: 'role-responsibilities',
    title: 'Role responsibilities',
    question: 'What are the main responsibilities of this role? Include the work you do regularly, ongoing projects, important relationships, and anything the role title does not make obvious.',
  },
  {
    id: 'annual-registration-training',
    title: 'Annual registration or training',
    question: 'What annual registration, re-registration, training, onboarding, or compliance steps does the next leader need to complete? Include when they happen and anything that must be prepared beforehand.',
  },
  {
    id: 'finances-budget',
    title: 'Finances or budget handoff',
    question: 'What does the next leader need to know about the budget and finances? Include funding, bookkeeping, reimbursements, grants, signatories, and any financial work that still needs to be completed.',
  },
  {
    id: 'recurring-events',
    title: 'Recurring events',
    question: 'What events happen regularly, and how should the next leader prepare for them? Include when planning should begin, space or vendor arrangements, important dates, and anything that usually causes problems.',
  },
  {
    id: 'advisor-vendor-contacts',
    title: 'Advisor or vendor contacts',
    question: 'Who does the next leader need to know? Include advisors, sponsors, vendors, coaches, staff, venue contacts, or other important people—and what each person helps with.',
  },
  {
    id: 'account-tool-access',
    title: 'Account and tool access',
    question: 'What accounts, files, systems, or tools does the next leader need access to? Include email, shared drives, messaging tools, websites, social accounts, software, and any training needed to use them.',
  },
  {
    id: 'calendars-deadlines',
    title: 'Calendars and deadlines',
    question: "What dates should already be on the next leader's calendar? Include meetings, events, planning deadlines, recruitment, elections, training, registration, and leadership-transition dates.",
  },
  {
    id: 'constitution-policies',
    title: 'Constitution or policies',
    question: 'What constitution, policies, procedures, or governing rules does the next leader need to understand? Include anything that affects how the role, elections, events, finances, or organization must operate.',
  },
  {
    id: 'lessons-common-mistakes',
    title: 'Lessons and common mistakes',
    question: 'What do you wish you had known when you started? What was hardest, what mistakes should the next leader avoid, what worked well, and what would you do differently next time?',
  },
] as const;

export type CapturePrompt = (typeof CAPTURE_PROMPTS)[number];

const MAX_CAPTURE_TITLE_LENGTH = 80;

function conciseTextTitle(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const firstSentence = normalized.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? normalized;
  const withoutTrailingPunctuation = firstSentence.replace(/[.!?]+$/, '').trim();
  if (withoutTrailingPunctuation.length <= MAX_CAPTURE_TITLE_LENGTH) return withoutTrailingPunctuation;
  const candidate = withoutTrailingPunctuation.slice(0, MAX_CAPTURE_TITLE_LENGTH + 1);
  const lastSpace = candidate.lastIndexOf(' ');
  const cutAt = lastSpace >= 40 ? lastSpace : MAX_CAPTURE_TITLE_LENGTH;
  return `${withoutTrailingPunctuation.slice(0, cutAt).trimEnd()}…`;
}

export function deriveCaptureDisplayTitle(input: {
  promptTitle?: string | null;
  textContent?: string | null;
  attachmentTitles?: string[];
}) {
  if (input.promptTitle?.trim()) return input.promptTitle.trim();
  const textTitle = conciseTextTitle(input.textContent ?? '');
  if (textTitle) return textTitle;
  const attachmentTitles = (input.attachmentTitles ?? []).map((title) => title.trim()).filter(Boolean);
  if (attachmentTitles.length === 1) return attachmentTitles[0];
  if (attachmentTitles.length > 1) return `${attachmentTitles[0]} + ${attachmentTitles.length - 1} more`;
  return 'Capture';
}
