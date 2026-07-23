import { describe, it, expect } from 'vitest';
import { validateExercise, emptyQuickCheck, emptyBucketSort } from './validateExercise';

describe('validateExercise', () => {
  it('flags an empty quick_check (needs 1–3 questions with content)', () => {
    expect(validateExercise('quick_check', emptyQuickCheck())).toMatch(/question/i);
  });
  it('flags a bucket_sort with an item assigned to no bucket', () => {
    const c = emptyBucketSort();
    c.buckets = [{ id: 'b1', label: 'X' }, { id: 'b2', label: 'Y' }];
    c.items = [{ id: 'i1', text: 't', bucketId: '' }];
    expect(validateExercise('bucket_sort', c)).toMatch(/bucket/i);
  });
  it('passes a well-formed bucket_sort', () => {
    expect(validateExercise('bucket_sort', {
      version: 1, buckets: [{ id: 'b1', label: 'X' }, { id: 'b2', label: 'Y' }],
      items: [{ id: 'i1', text: 't', bucketId: 'b1' }],
    })).toBeNull();
  });
});
