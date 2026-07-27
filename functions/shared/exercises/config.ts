/**
 * Per-kind exercise config validators (ADR-0017). The DB does not enforce
 * config shape — this module is the single authority. exercise-admin-save calls
 * validateExerciseConfig() and returns 400 with the message on any failure.
 *
 * Kinds are plain strings (no DB enum) so new kinds add a case here + a renderer,
 * with zero schema change. Every config must carry integer version === 1.
 */
export const EXERCISE_KINDS = ['quick_check', 'bucket_sort'] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

function validateQuickCheck(config: Record<string, unknown>): string | null {
  if (config.version !== 1) return 'quick_check config version must be 1';
  const { questions } = config;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3) {
    return 'quick_check must have 1–3 questions';
  }
  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi];
    if (!isObj(q)) return `question ${qi}: must be an object`;
    if (!isNonEmptyString(q.id)) return `question ${qi}: id is required`;
    if (!isNonEmptyString(q.text)) return `question ${qi}: text is required`;
    const opts = q.options;
    if (!Array.isArray(opts) || opts.length < 2) return `question ${qi}: at least 2 options required`;
    let correctCount = 0;
    for (let oi = 0; oi < opts.length; oi++) {
      const o = opts[oi];
      if (!isObj(o)) return `question ${qi} option ${oi}: must be an object`;
      if (!isNonEmptyString(o.id)) return `question ${qi} option ${oi}: id is required`;
      if (!isNonEmptyString(o.text)) return `question ${qi} option ${oi}: text is required`;
      if (typeof o.correct !== 'boolean') return `question ${qi} option ${oi}: correct must be boolean`;
      if (o.correct) correctCount++;
    }
    if (correctCount !== 1) return `question ${qi}: exactly one correct option is required`;
  }
  return null;
}

function validateBucketSort(config: Record<string, unknown>): string | null {
  if (config.version !== 1) return 'bucket_sort config version must be 1';
  const { buckets, items } = config;
  if (!Array.isArray(buckets) || buckets.length < 2) return 'bucket_sort needs at least 2 buckets';
  const bucketIds = new Set<string>();
  for (let bi = 0; bi < buckets.length; bi++) {
    const b = buckets[bi];
    if (!isObj(b)) return `bucket ${bi}: must be an object`;
    if (!isNonEmptyString(b.id)) return `bucket ${bi}: id is required`;
    if (!isNonEmptyString(b.label)) return `bucket ${bi}: label is required`;
    if (bucketIds.has(b.id)) return `bucket ${bi}: duplicate id`;
    bucketIds.add(b.id);
  }
  if (!Array.isArray(items) || items.length < 1) return 'bucket_sort needs at least 1 item';
  for (let ii = 0; ii < items.length; ii++) {
    const it = items[ii];
    if (!isObj(it)) return `item ${ii}: must be an object`;
    if (!isNonEmptyString(it.id)) return `item ${ii}: id is required`;
    if (!isNonEmptyString(it.text)) return `item ${ii}: text is required`;
    if (!isNonEmptyString(it.bucketId) || !bucketIds.has(it.bucketId)) {
      return `item ${ii}: bucketId references an unknown bucket`;
    }
  }
  return null;
}

export function validateExerciseConfig(kind: string, config: unknown): string | null {
  if (!EXERCISE_KINDS.includes(kind as ExerciseKind)) {
    return `unknown exercise_kind: ${kind}`;
  }
  if (!isObj(config)) return 'config must be an object';
  switch (kind as ExerciseKind) {
    case 'quick_check': return validateQuickCheck(config);
    case 'bucket_sort': return validateBucketSort(config);
  }
}
