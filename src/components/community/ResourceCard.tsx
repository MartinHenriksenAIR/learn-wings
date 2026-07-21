import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { TagList } from './TagList';
import {
  Link,
  FileText,
  FileCode,
  BookOpen,
  ExternalLink,
  MoreVertical,
  Pin,
  PinOff,
  Pencil,
  Trash2,
} from 'lucide-react';
import { formatDistanceToNowLocalized } from '@/lib/date-locale';
import { cn, getAvatarColor, getInitials } from '@/lib/utils';
import { RESOURCE_TYPES, type CommunityResource } from '@/lib/resources-api';

interface ResourceCardProps {
  resource: CommunityResource;
  isOwner: boolean;
  isAdmin: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onTogglePin?: (pinned: boolean) => void;
}

// Prototype `RTYPES`: icon + tinted chip/pill colors per resource type.
const typeStyles: Record<string, { icon: typeof Link; classes: string }> = {
  guide: { icon: BookOpen, classes: 'bg-accent text-accent-foreground' },
  template: { icon: FileCode, classes: 'bg-[#e7f6ef] text-success' },
  document: { icon: FileText, classes: 'bg-[#fdecec] text-[#c43d3d]' },
  link: { icon: Link, classes: 'bg-[#fbf2dd] text-warning' },
};

export function ResourceCard({
  resource,
  isOwner,
  isAdmin,
  onEdit,
  onDelete,
  onTogglePin,
}: ResourceCardProps) {
  const { t, i18n } = useTranslation();
  const { icon: TypeIcon, classes: typeClasses } = typeStyles[resource.resource_type] || typeStyles.link;
  const canManage = isOwner || isAdmin;

  const authorName = resource.profile?.full_name;
  const typeLabel = RESOURCE_TYPES.find((rt) => rt.value === resource.resource_type)?.label
    || resource.resource_type;

  return (
    <div
      className={cn(
        'group rounded-2xl border bg-card px-5 py-[18px] transition-shadow hover:shadow-[0_10px_28px_rgba(20,24,46,0.08)]',
        resource.is_pinned ? 'border-[#cfd6ef]' : 'border-border'
      )}
    >
      {/* Type chip + pills + admin actions */}
      <div className="mb-2.5 flex items-center gap-2">
        <span className={cn('grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px]', typeClasses)}>
          <TypeIcon aria-hidden="true" className="h-[15px] w-[15px]" />
        </span>
        <span className={cn('inline-flex items-center whitespace-nowrap rounded-[7px] px-[11px] py-1 text-[11px] font-bold', typeClasses)}>
          {typeLabel}
        </span>
        {resource.is_pinned && (
          <span className="inline-flex items-center whitespace-nowrap rounded-[7px] bg-accent px-[11px] py-1 text-[11px] font-bold text-accent-foreground">
            {t('community.pinned')}
          </span>
        )}
        <div className="flex-1" />
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg text-[#9aa0af] opacity-0 hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
              >
                <MoreVertical aria-hidden="true" className="h-4 w-4" />
                <span className="sr-only">{t('common.actions')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isAdmin && onTogglePin && (
                <DropdownMenuItem onClick={() => onTogglePin(!resource.is_pinned)}>
                  {resource.is_pinned ? (
                    <>
                      <PinOff className="mr-2 h-4 w-4" />
                      {t('community.unpin')}
                    </>
                  ) : (
                    <>
                      <Pin className="mr-2 h-4 w-4" />
                      {t('community.pin')}
                    </>
                  )}
                </DropdownMenuItem>
              )}
              {(isOwner || isAdmin) && onEdit && (
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {t('common.edit')}
                </DropdownMenuItem>
              )}
              {(isOwner || isAdmin) && onDelete && (
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('common.delete')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Title + description */}
      <h3 className="mb-1.5 line-clamp-2 text-[14.5px] font-bold leading-[1.35]">{resource.title}</h3>
      {resource.description && (
        <p className="mb-3 line-clamp-2 text-[12.5px] leading-normal text-muted-foreground">
          {resource.description}
        </p>
      )}

      <TagList tags={resource.tags || []} maxVisible={3} className="mb-3" />

      {/* Footer: open link + author · time */}
      <div className="flex items-center gap-2">
        {resource.url && (
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-[7px] rounded-[9px] bg-accent px-[13px] py-2 text-[12.5px] font-bold text-accent-foreground transition-colors hover:bg-[#dfe5f8]"
          >
            <ExternalLink aria-hidden="true" className="h-[13px] w-[13px]" />
            {t('community.openResource')}
          </a>
        )}
        <div className="flex-1" />
        <span className="inline-flex min-w-0 items-center gap-2 text-[11.5px] font-medium text-[#9aa0af]">
          <Avatar className="h-5 w-5 shrink-0">
            <AvatarFallback
              className="text-[9px] font-bold text-white"
              style={{ backgroundColor: getAvatarColor(authorName) }}
            >
              {getInitials(authorName)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">
            {authorName}
            {' · '}
            {formatDistanceToNowLocalized(new Date(resource.created_at), i18n.language)}
          </span>
        </span>
      </div>
    </div>
  );
}
