import type { TFunction } from 'i18next';
import type { CommunityCategory } from '@/lib/community-types';

export function categoryLabel(
  category: Pick<CommunityCategory, 'slug'>,
  t: TFunction,
): string {
  return t(`community.categories.${category.slug}.name`);
}
