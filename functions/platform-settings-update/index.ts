import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

const ALLOWED_KEYS = ['user_access', 'features', 'seat_pricing'] as const;
type SettingKey = typeof ALLOWED_KEYS[number];

type FieldCheck = (v: unknown) => boolean;
const isString: FieldCheck = (v) => typeof v === 'string';
const isBoolean: FieldCheck = (v) => typeof v === 'boolean';
const isNonNegativeNumberOrNull: FieldCheck = (v) =>
  v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);

const FIELD_SHAPES: Record<SettingKey, Record<string, FieldCheck>> = {
  user_access: {
    allow_self_registration: isBoolean,
    allow_individual_registration: isBoolean,
  },
  features: {
    certificates_enabled: isBoolean,
    quizzes_enabled: isBoolean,
    analytics_enabled: isBoolean,
    course_reviews_enabled: isBoolean,
    community_enabled: isBoolean,
    exercises_enabled: isBoolean,
  },
  seat_pricing: {
    annual_price_per_seat: isNonNegativeNumberOrNull,
    currency: isString,
    notification_email: isString,
  },
};

interface PlatformSettingsUpdateBody {
  key?: unknown;
  value?: unknown;
}

export default adminEndpoint('platform-settings-update', async ({ req, profile, reply }) => {
  const body = await req.json() as PlatformSettingsUpdateBody;

  if (typeof body.key !== 'string' || !(ALLOWED_KEYS as readonly string[]).includes(body.key)) {
    return reply(400, { error: 'key must be one of: user_access, features, seat_pricing' });
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

  const setting = await queryOne(
    `UPDATE platform_settings SET value = value || $2::jsonb, updated_by = $3 WHERE key = $1 RETURNING key, value`,
    [key, JSON.stringify(value), profile.id],
  );

  if (!setting) return reply(404, { error: 'Setting not found' });

  return reply(200, { setting });
});
