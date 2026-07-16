import { useTranslation } from 'react-i18next';
import { Building2, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Organization } from '@/lib/types';

interface OrgDetailHeaderProps {
  org: Organization;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * Header row for the org-detail page: logo chip + name/slug/created date +
 * Edit / Delete trigger buttons.
 */
export function OrgDetailHeader({ org, onEdit, onDelete }: OrgDetailHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="mb-6 flex flex-wrap items-center gap-4">
      {org.logo_url ? (
        <img src={org.logo_url} alt="" className="h-14 w-14 shrink-0 rounded-2xl bg-muted object-contain" />
      ) : (
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent text-primary">
          <Building2 className="h-[26px] w-[26px]" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-extrabold tracking-[-0.02em]">{org.name}</h1>
        <p className="truncate font-mono text-[13px] text-muted-foreground">
          {org.slug} · {new Date(org.created_at).toLocaleDateString()}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" onClick={onEdit}>
          <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('orgDetail.editSeatLimit')}
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onDelete}
          className="text-destructive hover:bg-destructive/10"
          aria-label={t('orgDetail.deleteOrganization')}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
