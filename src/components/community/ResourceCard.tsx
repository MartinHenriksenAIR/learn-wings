import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { formatDistanceToNow } from 'date-fns';
import type { CommunityResource } from '@/lib/resources-api';

interface ResourceCardProps {
  resource: CommunityResource;
  isOwner: boolean;
  isAdmin: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onTogglePin?: (pinned: boolean) => void;
}

const typeIcons: Record<string, typeof Link> = {
  link: Link,
  document: FileText,
  template: FileCode,
  guide: BookOpen,
};

export function ResourceCard({
  resource,
  isOwner,
  isAdmin,
  onEdit,
  onDelete,
  onTogglePin,
}: ResourceCardProps) {
  const TypeIcon = typeIcons[resource.resource_type] || Link;
  const canManage = isOwner || isAdmin;

  const initials = resource.profile?.full_name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U';

  return (
    <Card className={`group hover:shadow-md transition-shadow ${resource.is_pinned ? 'border-primary/50 bg-primary/5' : ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`p-2 rounded-lg ${resource.is_pinned ? 'bg-primary/10' : 'bg-muted'}`}>
              <TypeIcon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base font-semibold line-clamp-1 flex items-center gap-2">
                {resource.title}
                {resource.is_pinned && (
                  <Pin className="h-3 w-3 text-primary shrink-0" />
                )}
              </CardTitle>
            </div>
          </div>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isAdmin && onTogglePin && (
                  <DropdownMenuItem onClick={() => onTogglePin(!resource.is_pinned)}>
                    {resource.is_pinned ? (
                      <>
                        <PinOff className="h-4 w-4 mr-2" />
                        Unpin
                      </>
                    ) : (
                      <>
                        <Pin className="h-4 w-4 mr-2" />
                        Pin
                      </>
                    )}
                  </DropdownMenuItem>
                )}
                {(isOwner || isAdmin) && onEdit && (
                  <DropdownMenuItem onClick={onEdit}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                )}
                {(isOwner || isAdmin) && onDelete && (
                  <DropdownMenuItem onClick={onDelete} className="text-destructive">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {resource.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {resource.description}
          </p>
        )}

        {resource.url && (
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Open Resource
          </a>
        )}

        {resource.tags && resource.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {resource.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                #{tag}
              </Badge>
            ))}
            {resource.tags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{resource.tags.length - 3}
              </Badge>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Avatar className="h-5 w-5">
              <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
            </Avatar>
            <span>{resource.profile?.full_name}</span>
          </div>
          <span>
            {formatDistanceToNow(new Date(resource.created_at), { addSuffix: true })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
