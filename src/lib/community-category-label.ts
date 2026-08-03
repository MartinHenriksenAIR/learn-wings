import type { TFunction } from 'i18next';
import type { CommunityCategory } from '@/lib/community-types';

/**
 * Translated display name for a community category (#342).
 *
 * Community categories are a fixed, seeded taxonomy with stable slugs and no UI
 * to create more, so labels are mapped by slug under
 * `community.categories.<slug>.name`. Every seeded slug has a key in BOTH en and
 * da; per #300 we call `t(key)` alone (no `defaultValue`) so a missing key
 * surfaces loudly rather than being masked.
 *
 * Single source of truth: every render site (filter chips, post-card badge,
 * post-detail badge, composer picker) goes through this helper.
 */
export function categoryLabel(
  category: Pick<CommunityCategory, 'slug'>,
  t: TFunction,
): string {
  return t(`community.categories.${category.slug}.name`);
}
