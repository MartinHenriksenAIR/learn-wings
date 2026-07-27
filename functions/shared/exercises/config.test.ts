import { describe, it, expect } from 'vitest';
import { validateExerciseConfig, EXERCISE_KINDS } from './config';

describe('validateExerciseConfig', () => {
  it('rejects an unknown kind', () => {
    expect(validateExerciseConfig('mystery', { version: 1 })).toMatch(/unknown exercise_kind/i);
  });

  it('exposes exactly the Phase 1 kinds', () => {
    expect([...EXERCISE_KINDS]).toEqual(['quick_check', 'bucket_sort']);
  });

  // ── quick_check ──────────────────────────────────────────────────────────
  const validQuickCheck = {
    version: 1,
    questions: [
      { id: 'q1', text: 'Q?', options: [
        { id: 'o1', text: 'A', correct: true },
        { id: 'o2', text: 'B', correct: false },
      ] },
    ],
  };

  it('accepts a valid quick_check', () => {
    expect(validateExerciseConfig('quick_check', validQuickCheck)).toBeNull();
  });

  it('rejects quick_check with wrong version', () => {
    expect(validateExerciseConfig('quick_check', { ...validQuickCheck, version: 2 })).toMatch(/version/i);
  });

  it('rejects quick_check with zero questions', () => {
    expect(validateExerciseConfig('quick_check', { version: 1, questions: [] })).toMatch(/1.*3 questions/i);
  });

  it('rejects quick_check with more than 3 questions', () => {
    const q = validQuickCheck.questions[0];
    expect(validateExerciseConfig('quick_check', { version: 1, questions: [q, q, q, q] })).toMatch(/1.*3 questions/i);
  });

  it('rejects a question with fewer than 2 options', () => {
    expect(validateExerciseConfig('quick_check', { version: 1, questions: [
      { id: 'q1', text: 'Q?', options: [{ id: 'o1', text: 'A', correct: true }] },
    ] })).toMatch(/at least 2 options/i);
  });

  it('rejects a question without exactly one correct option', () => {
    expect(validateExerciseConfig('quick_check', { version: 1, questions: [
      { id: 'q1', text: 'Q?', options: [
        { id: 'o1', text: 'A', correct: true },
        { id: 'o2', text: 'B', correct: true },
      ] },
    ] })).toMatch(/exactly one correct/i);
  });

  // ── bucket_sort ──────────────────────────────────────────────────────────
  const validBucketSort = {
    version: 1,
    buckets: [{ id: 'b1', label: 'X' }, { id: 'b2', label: 'Y' }],
    items: [{ id: 'i1', text: 'thing', bucketId: 'b1' }],
  };

  it('accepts a valid bucket_sort', () => {
    expect(validateExerciseConfig('bucket_sort', validBucketSort)).toBeNull();
  });

  it('rejects bucket_sort with fewer than 2 buckets', () => {
    expect(validateExerciseConfig('bucket_sort', { ...validBucketSort, buckets: [{ id: 'b1', label: 'X' }] }))
      .toMatch(/at least 2 buckets/i);
  });

  it('rejects bucket_sort with zero items', () => {
    expect(validateExerciseConfig('bucket_sort', { ...validBucketSort, items: [] })).toMatch(/at least 1 item/i);
  });

  it('rejects an item whose bucketId is not a real bucket', () => {
    expect(validateExerciseConfig('bucket_sort', {
      ...validBucketSort, items: [{ id: 'i1', text: 'thing', bucketId: 'nope' }],
    })).toMatch(/unknown bucket/i);
  });
});
