import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

const ALLOWED_KEYS = ['branding', 'user_access', 'email', 'features'] as const;
type SettingKey = typeof ALLOWED_KEYS[number];

// Per-field shape validation (issue #90). Field lists derive from the frontend's
// interfaces (src/pages/platform-admin/PlatformSettings.tsx) and the seed shapes
// (migration/azure/02-seed.sql) — the two are kept in sync deliberately.
type FieldCheck = (v: unknown) => boolean;
const isString: FieldCheck = (v) => typeof v === 'string';
const isStringOrNull: FieldCheck = (v) => v === null || typeof v === 'string';
const isBoolean: FieldCheck = (v) => typeof v === 'boolean';
const isFiniteNumber: FieldCheck = (v) => typeof v === 'number' && Number.isFinite(v);
const isOneOf = (...allowed: string[]): FieldCheck => (v) => typeof v === 'string' && allowed.includes(v);

const FIELD_SHAPES: Record<SettingKey, Record<string, FieldCheck>> = {
  branding: {
    platform_name: isString,
    primary_color: isString,
    accent_color: isString,
    sidebar_primary_color: isString,
    sidebar_accent_color: isString,
    logo_url: isStringOrNull,
    favicon_url: isStringOrNull,
  },
  user_access: {
    default_role: isOneOf('learner', 'org_admin'),
    require_email_verification: isBoolean,
    allow_self_registration: isBoolean,
  },
  email: {
    from_name: isString,
    from_email: isStringOrNull,
    smtp_configured: isBoolean,
    smtp_host: isString,
    smtp_port: isFiniteNumber,
    smtp_username: isString,
    smtp_password: isString,
    smtp_encryption: isOneOf('none', 'ssl_tls', 'starttls'),
  },
  features: {
    certificates_enabled: isBoolean,
    quizzes_enabled: isBoolean,
    analytics_enabled: isBoolean,
    course_reviews_enabled: isBoolean,
    community_enabled: isBoolean,
  },
};

interface PlatformSettingsUpdateBody {
  key?: unknown;
  value?: unknown;
}

export default adminEndpoint('platform-settings-update', async ({ req, profile, reply }) => {
  const body = await req.json() as PlatformSettingsUpdateBody;

  if (typeof body.key !== 'string' || !(ALLOWED_KEYS as readonly string[]).includes(body.key)) {
    return reply(400, { error: 'key must be one of: branding, user_access, email, features' });
  }
  const key = body.key as SettingKey;

  if (
    body.value === null ||
    typeof body.value !== 'object' ||
    Array.isArray(body.value)
  ) {
    return reply(400, { error: 'value must be a plain object' });
  }
  const value = body.value as Record<string, unknown>;

  // Per-field validation: every field present must be a known field of this
  // setting key with the expected shape. Unknown fields are rejected — the
  // frontend only ever sends the known field set, so a stray field signals a
  // bypassing caller, not a legitimate write.
  const shape = FIELD_SHAPES[key];
  for (const [field, fieldValue] of Object.entries(value)) {
    const check = shape[field];
    if (!check) {
      return reply(400, { error: `unknown field "${field}" for setting "${key}"` });
    }
    if (!check(fieldValue)) {
      return reply(400, { error: `invalid value for field "${field}" of setting "${key}"` });
    }
  }

  // MERGE, never replace (issue #90): `value || $2::jsonb` only touches the
  // fields present in the body — absent fields keep their stored values, so a
  // partial write can no longer clobber the rest of the setting (e.g. wipe the
  // stored SMTP config with blanks). updated_at is managed by a DB trigger on
  // UPDATE; updated_by is the authenticated caller's profile id.
  const setting = await queryOne(
    `UPDATE platform_settings SET value = value || $2::jsonb, updated_by = $3 WHERE key = $1 RETURNING key, value`,
    [key, JSON.stringify(value), profile.id],
  );

  if (!setting) return reply(404, { error: 'Setting not found' });

  return reply(200, { setting });
});
