import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CategoryBadge } from './CategoryBadge';
import { Loader2, X, Calendar } from 'lucide-react';
import type { CommunityCategory, CommunityScope, CreatePostInput } from '@/lib/community-types';

const postSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(200),
  content: z.string().min(10, 'Content must be at least 10 characters'),
  category_id: z.string().min(1, 'Please select a category'),
  tags: z.array(z.string()).max(5, 'Maximum 5 tags allowed'),
  event_date: z.string().optional(),
  event_location: z.string().optional(),
  event_registration_url: z.string().url().optional().or(z.literal('')),
});

type PostFormValues = z.infer<typeof postSchema>;

interface PostFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreatePostInput) => Promise<void>;
  categories: CommunityCategory[];
  scope: CommunityScope;
  orgId?: string;
  canPostRestricted?: boolean;
  initialData?: Partial<PostFormValues>;
  editMode?: boolean;
}

export function PostForm({
  open,
  onOpenChange,
  onSubmit,
  categories,
  scope,
  orgId,
  canPostRestricted = false,
  initialData,
  editMode = false,
}: PostFormProps) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tagInput, setTagInput] = useState('');

  const form = useForm<PostFormValues>({
    resolver: zodResolver(postSchema),
    defaultValues: {
      title: '',
      content: '',
      category_id: '',
      tags: [],
      event_date: '',
      event_location: '',
      event_registration_url: '',
      ...initialData,
    },
  });

  const selectedCategoryId = form.watch('category_id');
  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
  const isEventCategory = selectedCategory?.slug === 'events';

  // Filter categories based on permissions
  const availableCategories = categories.filter(
    (c) => !c.is_restricted || canPostRestricted
  );

  const handleSubmit = async (values: PostFormValues) => {
    setIsSubmitting(true);
    try {
      await onSubmit({
        scope,
        org_id: scope === 'org' ? orgId : undefined,
        category_id: values.category_id,
        title: values.title,
        content: values.content,
        tags: values.tags,
        event_date: isEventCategory ? values.event_date : undefined,
        event_location: isEventCategory ? values.event_location : undefined,
        event_registration_url: isEventCategory && values.event_registration_url 
          ? values.event_registration_url 
          : undefined,
      });
      form.reset();
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (tag && !form.getValues('tags').includes(tag)) {
      const currentTags = form.getValues('tags');
      if (currentTags.length < 5) {
        form.setValue('tags', [...currentTags, tag]);
      }
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    form.setValue(
      'tags',
      form.getValues('tags').filter((t) => t !== tag)
    );
  };

  useEffect(() => {
    if (initialData) {
      form.reset({ ...form.getValues(), ...initialData });
    }
  }, [initialData]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No description text by design — explicit opt-out silences Radix's missing-Description a11y warning */}
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-[17px] font-extrabold">
            {editMode ? t('community.postForm.editPost') : t('community.postForm.createNewPost')}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="category_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('community.postForm.category')}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('community.postForm.selectCategory')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableCategories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          <div className="flex items-center gap-2">
                            <CategoryBadge
                              name={cat.name}
                              icon={cat.icon}
                              size="sm"
                            />
                            {cat.is_restricted && (
                              <span className="text-xs text-muted-foreground">{t('community.postForm.adminOnly')}</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('community.postForm.title')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('community.postForm.titlePlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="content"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('community.postForm.content')}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t('community.postForm.contentPlaceholder')}
                      className="min-h-[150px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Event-specific fields */}
            {isEventCategory && (
              <>
                <FormField
                  control={form.control}
                  name="event_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('community.postForm.eventDateTime')}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            type="datetime-local"
                            className="pl-10"
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="event_location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('community.postForm.location')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('community.postForm.locationPlaceholder')}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>{t('community.postForm.locationDescription')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="event_registration_url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('community.postForm.registrationUrl')}</FormLabel>
                      <FormControl>
                        <Input
                          type="url"
                          placeholder="https://..."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {/* Tags */}
            <FormField
              control={form.control}
              name="tags"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('community.postForm.tagsOptional')}</FormLabel>
                  <div className="flex gap-2">
                    <Input
                      placeholder={t('community.postForm.addTagPlaceholder')}
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                    />
                    <Button type="button" variant="outline" onClick={addTag}>
                      {t('community.postForm.add')}
                    </Button>
                  </div>
                  {field.value.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {field.value.map((tag) => (
                        <Badge key={tag} variant="secondary" className="rounded-[7px] bg-accent pr-1 text-[11.5px] font-semibold text-accent-foreground">
                          #{tag}
                          <button
                            type="button"
                            onClick={() => removeTag(tag)}
                            className="ml-1 hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <FormDescription>{t('community.postForm.tagsDescription')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
                className="rounded-[10px] text-[13px] font-bold"
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting} className="rounded-[10px] text-[13px] font-bold">
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editMode ? t('community.postForm.saveChanges') : t('community.createPost')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
