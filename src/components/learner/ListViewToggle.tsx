import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, List } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ListView } from '@/hooks/useListView';

export function ListViewToggle({
  view,
  onChange,
}: {
  view: ListView;
  onChange: (next: ListView) => void;
}) {
  const { t } = useTranslation();

  const button = (value: ListView, label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={view === value}
      onClick={() => onChange(value)}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-legacy-lg transition-colors',
        view === value ? 'bg-legacy-accent text-legacy-primary' : 'text-legacy-muted-foreground hover:text-legacy-primary',
      )}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex items-center gap-0.5 rounded-legacy-xl border border-legacy-input bg-legacy-card p-0.5">
      {button('card', t('courses.viewAsCards'), <LayoutGrid aria-hidden="true" className="h-4 w-4" />)}
      {button('list', t('courses.viewAsList'), <List aria-hidden="true" className="h-4 w-4" />)}
    </div>
  );
}
