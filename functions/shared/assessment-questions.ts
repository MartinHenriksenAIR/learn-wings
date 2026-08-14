export const QUESTIONNAIRE_VERSION = 'v1';

export interface AssessmentQuestion {
  id: string;
  options: readonly string[];
}

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

export function levelForScore(score: number): AssessmentLevel {
  if (score <= 7) return 'basic';
  if (score <= 14) return 'intermediate';
  return 'advanced';
}

export function evaluateAnswers(
  answers: unknown,
): { ok: true; score: number; level: AssessmentLevel } | { ok: false; error: string } {
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
    return { ok: false, error: 'answers must be an object' };
  }

  const obj = answers as Record<string, unknown>;

  const expectedIds = new Set(ASSESSMENT_QUESTIONS.map((q) => q.id));
  for (const key of Object.keys(obj)) {
    if (!expectedIds.has(key)) {
      return { ok: false, error: `unexpected question id ${key}` };
    }
  }

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
