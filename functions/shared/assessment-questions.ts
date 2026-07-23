/**
 * Server-owned questionnaire — pure data and pure functions.
 * Zero side-effect imports: this file is imported by frontend tests directly.
 */

export const QUESTIONNAIRE_VERSION = 'v1';

export interface AssessmentQuestion {
  id: string;
  options: readonly string[];
}

// Options are in ladder order; an option's score = its index (0–3).
export const ASSESSMENT_QUESTIONS: readonly AssessmentQuestion[] = [
  { id: 'usage-frequency',      options: ['never', 'tried-a-few-times', 'weekly', 'daily'] },
  { id: 'task-breadth',         options: ['nothing-yet', 'one-task-type', 'a-few-task-types', 'many-task-types'] },
  { id: 'tool-range',           options: ['none', 'one', 'two-to-three', 'four-plus'] },
  { id: 'iteration-behavior',   options: ['not-there-yet', 'accept-or-do-myself', 'rephrase-and-retry', 'iterate-with-context'] },
  { id: 'workflow-integration', options: ['not-part-of-day', 'now-and-then', 'fixed-part-of-tasks', 'woven-into-most'] },
  { id: 'self-sufficiency',     options: ['no-idea-where-to-start', 'need-help-or-guide', 'figure-it-out-myself', 'colleagues-ask-me'] },
  { id: 'advanced-features',    options: ['plain-chat-only', 'tried-a-couple', 'use-some-regularly', 'build-my-own'] },
];

export type AssessmentLevel = 'basic' | 'intermediate' | 'advanced';

/** Map a raw score (0–21) to a level. basic 0–7, intermediate 8–14, advanced 15–21. */
export function levelForScore(score: number): AssessmentLevel {
  if (score <= 7) return 'basic';
  if (score <= 14) return 'intermediate';
  return 'advanced';
}

/**
 * Validate a caller-supplied answers object and compute score + level.
 * The answers object must have exactly the 7 question ids as keys, each mapped
 * to a known option id for that question. Returns ok:false with a short
 * caller-facing error string on any validation failure (deliberate 400 contract).
 */
export function evaluateAnswers(
  answers: unknown,
): { ok: true; score: number; level: AssessmentLevel } | { ok: false; error: string } {
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
    return { ok: false, error: 'answers must be an object' };
  }

  const obj = answers as Record<string, unknown>;

  // Check for unexpected question ids.
  const expectedIds = new Set(ASSESSMENT_QUESTIONS.map((q) => q.id));
  for (const key of Object.keys(obj)) {
    if (!expectedIds.has(key)) {
      return { ok: false, error: `unexpected question id ${key}` };
    }
  }

  // Check for missing question ids and validate each option.
  let score = 0;
  for (const question of ASSESSMENT_QUESTIONS) {
    if (!(question.id in obj)) {
      return { ok: false, error: `missing answer for ${question.id}` };
    }
    const answer = obj[question.id];
    const optionIndex = question.options.indexOf(answer as string);
    if (optionIndex === -1) {
      return { ok: false, error: `unknown option ${answer} for ${question.id}` };
    }
    score += optionIndex;
  }

  return { ok: true, score, level: levelForScore(score) };
}
