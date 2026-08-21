import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleCheck, SearchX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

type EmptyStateTier = 'blank' | 'done' | 'no-results' | 'coming-soon';

interface EmptyStateProps {
  tier?: EmptyStateTier;
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

function EmptyStateMedia({ tier, icon }: { tier: EmptyStateTier; icon?: ReactNode }) {
  const { t } = useTranslation();

  if (tier === 'done') {
    return (
      <EmptyMedia>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-pastel text-green-deep">
          <CircleCheck className="h-5 w-5" />
        </span>
      </EmptyMedia>
    );
  }

  if (tier === 'no-results') {
    return (
      <EmptyMedia>
        <span className="flex h-10 w-10 items-center justify-center rounded-xs bg-surface-sunken text-neutral-500 [&_svg]:h-5 [&_svg]:w-5">
          {icon ?? <SearchX />}
        </span>
      </EmptyMedia>
    );
  }

  if (tier === 'coming-soon') {
    return (
      <EmptyMedia>
        <span className="flex flex-col items-center gap-2">
          {icon && (
            <span className="flex h-10 w-10 items-center justify-center rounded-xs bg-interactive-tint text-interactive [&_svg]:h-5 [&_svg]:w-5">
              {icon}
            </span>
          )}
          <span className="rounded-full bg-amber-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-amber-deep">
            {t('common.soon')}
          </span>
        </span>
      </EmptyMedia>
    );
  }

  if (!icon) return null;

  return (
    <EmptyMedia>
      <span className="relative flex h-12 w-16 items-center justify-center">
        <span
          aria-hidden="true"
          className="absolute left-0 top-1 h-10 w-10 -rotate-[8deg] rounded-xs border border-neutral-150 bg-surface-sunken"
        />
        <span
          aria-hidden="true"
          className="absolute right-0 top-1 h-10 w-10 rotate-[8deg] rounded-xs border border-neutral-150 bg-surface-sunken"
        />
        <span className="relative flex h-10 w-10 items-center justify-center rounded-xs bg-peri-tint text-peri-deep [&_svg]:h-5 [&_svg]:w-5">
          {icon}
        </span>
      </span>
    </EmptyMedia>
  );
}

export function EmptyState({ tier = 'blank', icon, title, description, action, className }: EmptyStateProps) {
  return (
    <Empty className={cn('gap-4', className)}>
      <EmptyHeader>
        <EmptyStateMedia tier={tier} icon={icon} />
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
