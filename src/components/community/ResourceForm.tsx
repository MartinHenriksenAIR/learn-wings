import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RESOURCE_TYPES, type CommunityResource, type CreateResourceInput } from '@/lib/resources-api';
import { Loader2 } from 'lucide-react';

interface ResourceFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: Omit<CreateResourceInput, 'org_id' | 'user_id'>) => Promise<void>;
  editResource?: CommunityResource | null;
}

const LABEL_CLASSES = 'text-xs font-bold text-[#4a4f60]';

export function ResourceForm({
  open,
  onOpenChange,
  onSubmit,
  editResource,
}: ResourceFormProps) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [resourceType, setResourceType] = useState('link');
  const [url, setUrl] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  // Sync form fields when editResource changes
  useEffect(() => {
    if (editResource) {
      setTitle(editResource.title || '');
      setDescription(editResource.description || '');
      setResourceType(editResource.resource_type || 'link');
      setUrl(editResource.url || '');
      setTagsInput(editResource.tags?.join(', ') || '');
    } else if (open) {
      setTitle('');
      setDescription('');
      setResourceType('link');
      setUrl('');
      setTagsInput('');
    }
  }, [editResource, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        resource_type: resourceType,
        url: url.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });

      // Reset form
      setTitle('');
      setDescription('');
      setResourceType('link');
      setUrl('');
      setTagsInput('');
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No description text by design — explicit opt-out silences Radix's missing-Description a11y warning */}
      <DialogContent className="sm:max-w-[500px]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-[17px] font-bold">
            {editResource ? t('community.resourceForm.editResource') : t('community.resourceForm.addResource')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title" className={LABEL_CLASSES}>{t('community.resourceForm.titleLabel')}</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('community.resourceForm.titlePlaceholder')}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="resource_type" className={LABEL_CLASSES}>{t('community.resourceForm.type')}</Label>
            <Select value={resourceType} onValueChange={setResourceType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOURCE_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="url" className={LABEL_CLASSES}>{t('community.resourceForm.url')}</Label>
            <Input
              id="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className={LABEL_CLASSES}>{t('community.resourceForm.description')}</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('community.resourceForm.descriptionPlaceholder')}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags" className={LABEL_CLASSES}>{t('community.resourceForm.tagsLabel')}</Label>
            <Input
              id="tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder={t('community.resourceForm.tagsPlaceholder')}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-[10px] border-[#dcdee6] text-[13px] font-bold"
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="rounded-[10px] text-[13px] font-bold"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {editResource ? t('community.resourceForm.update') : t('community.resourceForm.addResource')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
