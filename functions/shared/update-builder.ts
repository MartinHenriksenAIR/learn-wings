export interface BuildUpdateSetOk {
  ok: true;
  setClauses: string[];
  params: unknown[];
}

export interface BuildUpdateSetError {
  ok: false;
  error: string;
}

export type BuildUpdateSetResult = BuildUpdateSetOk | BuildUpdateSetError;

export interface BuildUpdateSetOptions {
  transform?: (key: string, value: unknown) => unknown;
  notObjectError?: string;
  unknownKeyError?: (key: string) => string;
  emptyError?: string;
}

const DEFAULTS = {
  notObjectError: 'updates must be an object',
  unknownKeyError: (key: string) => `Invalid update field: ${key}`,
  emptyError: 'No update fields provided',
};

export function buildUpdateSet(
  updates: unknown,
  allowedFields: ReadonlySet<string>,
  options: BuildUpdateSetOptions = {},
): BuildUpdateSetResult {
  const notObjectError = options.notObjectError ?? DEFAULTS.notObjectError;
  const unknownKeyError = options.unknownKeyError ?? DEFAULTS.unknownKeyError;
  const emptyError = options.emptyError ?? DEFAULTS.emptyError;

  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return { ok: false, error: notObjectError };
  }

  const updatesObj = updates as Record<string, unknown>;
  const updateKeys = Object.keys(updatesObj);

  for (const key of updateKeys) {
    if (!allowedFields.has(key)) {
      return { ok: false, error: unknownKeyError(key) };
    }
  }

  if (updateKeys.length === 0) {
    return { ok: false, error: emptyError };
  }

  const params: unknown[] = [];
  const setClauses = updateKeys.map((key) => {
    const value = options.transform ? options.transform(key, updatesObj[key]) : updatesObj[key];
    params.push(value);
    return `${key} = $${params.length}`;
  });

  return { ok: true, setClauses, params };
}
