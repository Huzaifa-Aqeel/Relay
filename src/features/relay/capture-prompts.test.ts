import { describe, expect, it } from 'vitest';

import {
  CAPTURE_PROMPTS,
  deriveCaptureDisplayTitle,
} from '@/features/relay/capture-prompts';

const EXPECTED_PROMPTS = [
  ['Role responsibilities', 'What are the main responsibilities of this role? Include the work you do regularly, ongoing projects, important relationships, and anything the role title does not make obvious.'],
  ['Annual registration or training', 'What annual registration, re-registration, training, onboarding, or compliance steps does the next leader need to complete? Include when they happen and anything that must be prepared beforehand.'],
  ['Finances or budget handoff', 'What does the next leader need to know about the budget and finances? Include funding, bookkeeping, reimbursements, grants, signatories, and any financial work that still needs to be completed.'],
  ['Recurring events', 'What events happen regularly, and how should the next leader prepare for them? Include when planning should begin, space or vendor arrangements, important dates, and anything that usually causes problems.'],
  ['Advisor or vendor contacts', 'Who does the next leader need to know? Include advisors, sponsors, vendors, coaches, staff, venue contacts, or other important people—and what each person helps with.'],
  ['Account and tool access', 'What accounts, files, systems, or tools does the next leader need access to? Include email, shared drives, messaging tools, websites, social accounts, software, and any training needed to use them.'],
  ['Calendars and deadlines', "What dates should already be on the next leader's calendar? Include meetings, events, planning deadlines, recruitment, elections, training, registration, and leadership-transition dates."],
  ['Constitution or policies', 'What constitution, policies, procedures, or governing rules does the next leader need to understand? Include anything that affects how the role, elections, events, finances, or organization must operate.'],
  ['Lessons and common mistakes', 'What do you wish you had known when you started? What was hardest, what mistakes should the next leader avoid, what worked well, and what would you do differently next time?'],
];

describe('unified Handoff capture prompts', () => {
  it('keeps every guided-capture question fixed and exact', () => {
    expect(CAPTURE_PROMPTS.map(({ title, question }) => [title, question])).toEqual(EXPECTED_PROMPTS);
  });

  it('keeps prompt IDs as metadata distinct from their visible guidance', () => {
    expect(new Set(CAPTURE_PROMPTS.map(({ id }) => id)).size).toBe(CAPTURE_PROMPTS.length);
    expect(CAPTURE_PROMPTS[7]).toMatchObject({
      id: 'constitution-policies',
      title: 'Constitution or policies',
    });
  });

  it('uses the chip label as the display title when a prompt is selected', () => {
    expect(deriveCaptureDisplayTitle({
      promptTitle: 'Finances or budget handoff',
      textContent: 'This text must not replace the selected prompt label.',
      attachmentTitles: ['Budget 2027'],
    })).toBe('Finances or budget handoff');
  });

  it('derives custom text and voice-produced Capture titles from submitted text', () => {
    const submittedText = 'Update the event budget spreadsheet every Friday. Send it to the advisor afterward.';
    expect(deriveCaptureDisplayTitle({ textContent: submittedText }))
      .toBe('Update the event budget spreadsheet every Friday');
  });

  it('derives file-only Capture titles from the submitted attachments', () => {
    expect(deriveCaptureDisplayTitle({ attachmentTitles: ['Budget 2027'] })).toBe('Budget 2027');
    expect(deriveCaptureDisplayTitle({
      attachmentTitles: ['Budget 2027', 'Reimbursement Policy', 'Funding Guide'],
    })).toBe('Budget 2027 + 2 more');
  });

  it('keeps automatically derived text titles concise', () => {
    const title = deriveCaptureDisplayTitle({
      textContent: 'This is a deliberately long capture contribution explaining several operational details that should not take over the entire capture history card because it keeps going.',
    });
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(81);
  });
});
