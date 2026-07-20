import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { useTranslation } from 'react-i18next';
import { BrandingAvatar } from '@/components/ui/branding-avatar';
import { Sparkles } from 'lucide-react';
import { callApi } from '@/lib/api-client';
import { getAvatarColor, getInitials } from '@/lib/utils';

interface ChampionProfile {
  id: string;
  full_name: string;
  department: string | null;
  avatar_url: string | null;
}

interface AIChampion {
  id: string;
  user_id: string;
  org_id: string;
  assigned_at: string;
  profile: ChampionProfile | null;
}

interface AIChampionsListProps {
  orgId: string;
}

export function AIChampionsList({ orgId }: AIChampionsListProps) {
  const { t } = useTranslation();
  const { data: champions = [], isLoading } = useQuery({
    queryKey: queryKeys.aiChampions.list(orgId),
    queryFn: async () => {
      const data = await callApi<{ champions: AIChampion[] }>('/api/ai-champions', { orgId });
      return data.champions;
    },
    enabled: !!orgId,
  });

  if (isLoading || champions.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-[18px]">
      <h3 className="mb-2 flex items-center gap-2 text-[13.5px] font-extrabold">
        <Sparkles aria-hidden="true" className="h-[15px] w-[15px] text-warning" />
        {t('community.aiChampions')}
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">{t('community.aiChampionsBlurb')}</p>
      <div className="flex flex-col gap-[11px]">
        {champions.map((champion) => (
          <div key={champion.id} className="flex items-center gap-2.5">
            <BrandingAvatar
              avatarPath={champion.profile?.avatar_url}
              fallback={getInitials(champion.profile?.full_name, '??')}
              className="h-[30px] w-[30px] shrink-0"
              fallbackClassName="text-[10.5px] font-bold text-white"
              fallbackStyle={{ backgroundColor: getAvatarColor(champion.profile?.full_name) }}
            />
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-[12.5px] font-bold">
                {champion.profile?.full_name || t('community.unknownUser')}
              </p>
              {champion.profile?.department && (
                <p className="truncate text-[11px] text-[#9aa0af]">
                  {champion.profile.department}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}