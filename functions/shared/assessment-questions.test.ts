import { describe, it, expect } from 'vitest';
import {
  ASSESSMENT_QUESTIONS,
  QUESTIONNAIRE_VERSION,
  evaluateAnswers,
  levelForScore,
} from './assessment-questions';

// Helper: build a valid answers object using the lowest-scoring option for each question.
function minAnswers(): Record<string, string> {
  return Object.fromEntries(ASSESSMENT_QUESTIONS.map((q) => [q.id, q.options[0]]));
}

// Helper: build a valid answers object using the highest-scoring option for each question.
function maxAnswers(): Record<string, string> {
  return Object.fromEntries(ASSESSMENT_QUESTIONS.map((q) => [q.id, q.options[q.options.length - 1]]));
}

// Helper: build answers where each question gets index `idx`.
function uniformAnswers(idx: number): Record<string, string> {
  return Object.fromEntries(ASSESSMENT_QUESTIONS.map((q) => [q.id, q.options[idx]]));
}

describe('ASSESSMENT_QUESTIONS', () => {
  it('exports the correct version', () => {
    expect(QUESTIONNAIRE_VERSION).toBe('v1');
  });

  it('has exactly 7 questions', () => {
    expect(ASSESSMENT_QUESTIONS).toHaveLength(7);
  });

  it('each question has exactly 4 options', () => {
    for (const q of ASSESSMENT_QUESTIONS) {
      expect(q.options).toHaveLength(4);
    }
  });
});

describe('levelForScore', () => {
  it('score 0 → basic', () => expect(levelForScore(0)).toBe('basic'));
  it('score 7 → basic',  () => expect(levelForScore(7)).toBe('basic'));
  it('score 8 → intermediate', () => expect(levelForScore(8)).toBe('intermediate'));
  it('score 14 → intermediate', () => expect(levelForScore(14)).toBe('intermediate'));
  it('score 15 → advanced', () => expect(levelForScore(15)).toBe('advanced'));
  it('score 21 → advanced', () => expect(levelForScore(21)).toBe('advanced'));
});

describe('evaluateAnswers — happy path', () => {
  it('all-index-0 answers → score 0, basic', () => {
    const result = evaluateAnswers(minAnswers());
    expect(result).toEqual({ ok: true, score: 0, level: 'basic' });
  });

  it('all-index-3 answers → score 21, advanced', () => {
    const result = evaluateAnswers(maxAnswers());
    expect(result).toEqual({ ok: true, score: 21, level: 'advanced' });
  });

  it('all-index-1 answers → score 7, basic', () => {
    const result = evaluateAnswers(uniformAnswers(1));
    expect(result).toEqual({ ok: true, score: 7, level: 'basic' });
  });

  it('mixed answers producing score 8 → intermediate', () => {
    // 7 questions × index 1 = 7 points, then bump one to index 2 (+1 extra) = 8
    const answers = uniformAnswers(1);
    const firstQ = ASSESSMENT_QUESTIONS[0];
    answers[firstQ.id] = firstQ.options[2]; // index 2 instead of 1: +1
    const result = evaluateAnswers(answers);
    expect(result).toEqual({ ok: true, score: 8, level: 'intermediate' });
  });
});

describe('evaluateAnswers — rejections', () => {
  it('rejects a non-object (string)', () => {
    const result = evaluateAnswers('not an object');
    expect(result).toEqual({ ok: false, error: 'answers must be an object' });
  });

  it('rejects null', () => {
    const result = evaluateAnswers(null);
    expect(result).toEqual({ ok: false, error: 'answers must be an object' });
  });

  it('rejects an array', () => {
    const result = evaluateAnswers([]);
    expect(result).toEqual({ ok: false, error: 'answers must be an object' });
  });

  it('rejects when a question id is missing', () => {
    const answers = minAnswers();
    delete answers[ASSESSMENT_QUESTIONS[3].id];
    const result = evaluateAnswers(answers);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('missing answer for') });
  });

  it('rejects when there is an extra / unknown question id', () => {
    const answers = { ...minAnswers(), 'bogus-question': 'some-value' };
    const result = evaluateAnswers(answers);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('unexpected question id') });
  });

  it('rejects an unknown option id', () => {
    const answers = minAnswers();
    answers[ASSESSMENT_QUESTIONS[0].id] = 'not-a-real-option';
    const result = evaluateAnswers(answers);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('unknown option') });
  });
});
