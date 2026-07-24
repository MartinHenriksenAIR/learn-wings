/**
 * Shared dynamic-UPDATE builder for PATCH-style endpoints.
 *
 * `buildUpdateSet(updates, allowedFields, options)` performs the checks that
 * resource-update, idea-update, and organization-update all repeated verbatim,
 * plus builds the parameterized SET clause list:
 *
 *   1. shape check — `updates` must be a non-null, non-array object,
 *   2. whitelist enforcement — ONE policy: any key NOT in `allowedFields` is an
 *      error (400). This is the stricter of the two behaviours that had forked
 *      (resource/organization 400'd on unknown keys; idea used to silently drop
 *      them — #252 unifies on reject),
 *   3. empty-after-check — zero recognized keys is an error,
 *   4. parameter-index bookkeeping — `$1..$n` placeholders in body key order.
 *
 * Per-field DOMAIN validation (value types, enum checks, trims) stays in each
 * endpoint — this helper is deliberately field-agnostic. It only decides which
 * keys are allowed and how the SET clause + params are assembled.
 *
 * SQL-INJECTION SAFETY INVARIANT: the only strings interpolated into the SET
 * clause are the whitelisted key names from `allowedFields` — never any value
 * and never a caller-supplied key that failed the whitelist. Every value goes
 * through a `$n` placeholder into `params`. Because a key must be present in
 * `allowedFields` (a caller-controlled literal set) before it can reach the SQL
 * string, no attacker-influenced identifier is ever concatenated. Keep it that
 * way: do not add a code path that interpolates a non-whitelisted key.
 */

/** Success: the SET clauses + the ordered param values (no id param — the
 * caller pushes the WHERE id and computes its placeholder from `params.length`,
 * matching how all three endpoints build their final UPDATE). */
export interface BuildUpdateSetOk {
  ok: true;
  /** e.g. ['title = $1', 'url = $2'] — join with ', ' into the UPDATE. */
  setClauses: string[];
  /** SET values in the same order as `setClauses`, ready to splice/push id onto. */
  params: unknown[];
}

/** Failure: a 400-worthy message the caller returns as `reply(400, { error })`. */
export interface BuildUpdateSetError {
  ok: false;
  error: string;
}

export type BuildUpdateSetResult = BuildUpdateSetOk | BuildUpdateSetError;

export interface BuildUpdateSetOptions {
  /**
   * Optional per-key value transform, applied to the value stored for `key`
   * before it becomes a param (e.g. organization-update trims `name` via
   * normalizeOrgName). Return the value unchanged for keys you don't transform.
   * The transform never affects the interpolated key name — only the param value.
   * NOTE: it runs BEFORE the endpoint's per-field domain validation, so it sees
   * raw, un-validated values — guard any type assumption inside the transform.
   */
  transform?: (key: string, value: unknown) => unknown;
  /** 400 message when `updates` fails the object-shape check. */
  notObjectError?: string;
  /** 400 message factory for an unknown (non-whitelisted) key. */
  unknownKeyError?: (key: string) => string;
  /** 400 message when no recognized keys remain. */
  emptyError?: string;
}

const DEFAULTS = {
  notObjectError: 'updates must be an object',
  unknownKeyError: (key: string) => `Invalid update field: ${key}`,
  emptyError: 'No update fields provided',
};

/**
 * Validate the shape + whitelist of `updates` and build the parameterized SET
 * clause list. Returns a discriminated union: `{ ok: true, setClauses, params }`
 * on success, `{ ok: false, error }` (a 400 message) on any check failure.
 *
 * @param updates       the raw client-supplied value (unknown — shape-checked here)
 * @param allowedFields whitelist of column names that may be updated
 * @param options       optional value transform + per-endpoint 400 wording
 */
export function buildUpdateSet(
  updates: unknown,
  allowedFields: ReadonlySet<string>,
  options: BuildUpdateSetOptions = {},
): BuildUpdateSetResult {
  const notObjectError = options.notObjectError ?? DEFAULTS.notObjectError;
  const unknownKeyError = options.unknownKeyError ?? DEFAULTS.unknownKeyError;
  const emptyError = options.emptyError ?? DEFAULTS.emptyError;

  // 1. Shape: must be a non-null, non-array object.
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return { ok: false, error: notObjectError };
  }

  const updatesObj = updates as Record<string, unknown>;
  const updateKeys = Object.keys(updatesObj);

  // 2. Whitelist: unknown key → error (the strict, unified #252 policy).
  for (const key of updateKeys) {
    if (!allowedFields.has(key)) {
      return { ok: false, error: unknownKeyError(key) };
    }
  }

  // 3. Empty after the whitelist walk → error.
  if (updateKeys.length === 0) {
    return { ok: false, error: emptyError };
  }

  // 4. Build SET clauses + params in body key order; every value is a $n
  //    placeholder, only the whitelisted key name is interpolated (see invariant).
  const params: unknown[] = [];
  const setClauses = updateKeys.map((key) => {
    const value = options.transform ? options.transform(key, updatesObj[key]) : updatesObj[key];
    params.push(value);
    return `${key} = $${params.length}`;
  });

  return { ok: true, setClauses, params };
}
