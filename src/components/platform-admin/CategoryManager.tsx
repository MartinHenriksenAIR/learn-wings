import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ArrowDown, Loader2, Pencil, Plus, Tags, Trash2 } from 'lucide-react';

import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useCourseCategories } from '@/hooks/useCourseCategories';
import { useToastMutation } from '@/hooks/useToastMutation';
import type { CourseCategory } from '@/lib/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Platform-admin management UI for course categories: add, rename (both
 * locales), reorder via up/down arrows, and delete. Lives in its own component
 * so CoursesManager stays focused on the course + access tabs.
 */
export function CategoryManager() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: categories = [], isLoading, error, refetch } = useCourseCategories();

  // The server already returns rows ordered by sort_order; sort defensively so
  // the reorder index math never depends on response ordering.
  const ordered = useMemo(
    () => [...categories].sort((a, b) => a.sort_order - b.sort_order),
    [categories],
  );

  const [newNameEn, setNewNameEn] = useState('');
  const [newNameDa, setNewNameDa] = useState('');

  const [renaming, setRenaming] = useState<CourseCategory | null>(null);
  const [editNameEn, setEditNameEn] = useState('');
  const [editNameDa, setEditNameDa] = useState('');

  const [deleting, setDeleting] = useState<CourseCategory | null>(null);

  const invalidateCategories = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.courseCategories.all });

  const createMutation = useToastMutation({
    mutationFn: (input: { nameEn: string; nameDa: string }) =>
      callApi<{ category: CourseCategory }>('/api/course-category-create', input),
    errorTitle: t('categoryManager.createFailed'),
    onSuccess: () => {
      toast({ title: t('categoryManager.created') });
      setNewNameEn('');
      setNewNameDa('');
      invalidateCategories();
    },
  });

  const renameMutation = useToastMutation({
    mutationFn: (input: { categoryId: string; nameEn: string; nameDa: string }) =>
      callApi<{ category: CourseCategory }>('/api/course-category-update', {
        categoryId: input.categoryId,
        updates: { nameEn: input.nameEn, nameDa: input.nameDa },
      }),
    errorTitle: t('categoryManager.renameFailed'),
    onSuccess: () => {
      toast({ title: t('categoryManager.renamed') });
      setRenaming(null);
      invalidateCategories();
    },
  });

  const deleteMutation = useToastMutation({
    mutationFn: (categoryId: string) =>
      callApi<{ success: boolean }>('/api/course-category-delete', { categoryId }),
    errorTitle: t('categoryManager.deleteFailed'),
    onSuccess: () => {
      toast({ title: t('categoryManager.deleted') });
      setDeleting(null);
      invalidateCategories();
      // Courses in the deleted category lose their category_id on the server.
      queryClient.invalidateQueries({ queryKey: queryKeys.coursesAdmin.all });
    },
  });

  const reorderMutation = useToastMutation({
    mutationFn: (orderedIds: string[]) =>
      callApi<{ categories: CourseCategory[] }>('/api/course-category-reorder', { orderedIds }),
    errorTitle: t('categoryManager.reorderFailed'),
    onSuccess: () => {
      invalidateCategories();
    },
  });

  const handleAdd = () => {
    const nameEn = newNameEn.trim();
    const nameDa = newNameDa.trim();
    if (!nameEn || !nameDa) return;
    createMutation.mutate({ nameEn, nameDa });
  };

  const openRename = (category: CourseCategory) => {
    setRenaming(category);
    setEditNameEn(category.name_en);
    setEditNameDa(category.name_da);
  };

  const handleRename = () => {
    if (!renaming) return;
    const nameEn = editNameEn.trim();
    const nameDa = editNameDa.trim();
    if (!nameEn || !nameDa) return;
    renameMutation.mutate({ categoryId: renaming.id, nameEn, nameDa });
  };

  /** Swap the row at `index` with its neighbour and persist the new id order. */
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const orderedIds = ordered.map((c) => c.id);
    [orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]];
    reorderMutation.mutate(orderedIds);
  };

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-4 text-center">
        <p className="font-medium text-destructive">{t('categoryManager.loadError')}</p>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <Button variant="outline" onClick={() => refetch()}>
          {t('coursesManager.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[17px] font-extrabold tracking-[-0.01em]">{t('categoryManager.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('categoryManager.description')}</p>
      </div>

      {/* Add form */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="category-add-name-en">{t('categoryManager.addNameEnLabel')}</Label>
            <Input
              id="category-add-name-en"
              value={newNameEn}
              onChange={(e) => setNewNameEn(e.target.value)}
              placeholder={t('categoryManager.addNameEnPlaceholder')}
            />
          </div>
          <div className="flex-1 space-y-2">
            <Label htmlFor="category-add-name-da">{t('categoryManager.addNameDaLabel')}</Label>
            <Input
              id="category-add-name-da"
              value={newNameDa}
              onChange={(e) => setNewNameDa(e.target.value)}
              placeholder={t('categoryManager.addNameDaPlaceholder')}
            />
          </div>
          <Button
            onClick={handleAdd}
            disabled={createMutation.isPending || !newNameEn.trim() || !newNameDa.trim()}
          >
            {createMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {t('categoryManager.addButton')}
          </Button>
        </div>
      </div>

      {/* List */}
      {ordered.length === 0 ? (
        <EmptyState
          icon={<Tags className="h-6 w-6" />}
          title={t('categoryManager.empty')}
          description={t('categoryManager.emptyDescription')}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-3 bg-[#f7f8fa] px-5 py-3 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[#9aa0af]">
            <span>{t('categoryManager.nameEnHeader')}</span>
            <span>{t('categoryManager.nameDaHeader')}</span>
            <span className="text-right">{t('categoryManager.actionsHeader')}</span>
          </div>
          {ordered.map((category, index) => (
            <div
              key={category.id}
              className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 border-t border-[#f3f4f8] px-5 py-3.5"
            >
              <span className="truncate text-[13px] font-bold">{category.name_en}</span>
              <span className="truncate text-[13px] font-semibold text-[#4a4f60]">{category.name_da}</span>
              <span className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0 || reorderMutation.isPending}
                  title={t('categoryManager.moveUp')}
                  aria-label={t('categoryManager.moveUp')}
                  className="grid h-[30px] w-[30px] place-items-center rounded-lg text-[#9aa0af] transition-colors hover:bg-[#f3f4f8] hover:text-primary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#9aa0af]"
                >
                  <ArrowUp className="h-[14px] w-[14px]" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === ordered.length - 1 || reorderMutation.isPending}
                  title={t('categoryManager.moveDown')}
                  aria-label={t('categoryManager.moveDown')}
                  className="grid h-[30px] w-[30px] place-items-center rounded-lg text-[#9aa0af] transition-colors hover:bg-[#f3f4f8] hover:text-primary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#9aa0af]"
                >
                  <ArrowDown className="h-[14px] w-[14px]" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => openRename(category)}
                  title={t('categoryManager.rename')}
                  aria-label={t('categoryManager.rename')}
                  className="grid h-[30px] w-[30px] place-items-center rounded-lg text-[#9aa0af] transition-colors hover:bg-[#f3f4f8] hover:text-primary"
                >
                  <Pencil className="h-[14px] w-[14px]" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(category)}
                  title={t('categoryManager.delete')}
                  aria-label={t('categoryManager.delete')}
                  className="grid h-[30px] w-[30px] place-items-center rounded-lg text-[#9aa0af] transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-[14px] w-[14px]" aria-hidden="true" />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Rename dialog */}
      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('categoryManager.renameTitle')}</DialogTitle>
            <DialogDescription>{t('categoryManager.renameDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="category-rename-name-en">{t('categoryManager.addNameEnLabel')}</Label>
              <Input
                id="category-rename-name-en"
                value={editNameEn}
                onChange={(e) => setEditNameEn(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-rename-name-da">{t('categoryManager.addNameDaLabel')}</Label>
              <Input
                id="category-rename-name-da"
                value={editNameDa}
                onChange={(e) => setEditNameDa(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>{t('common.cancel')}</Button>
            <Button
              onClick={handleRename}
              disabled={renameMutation.isPending || !editNameEn.trim() || !editNameDa.trim()}
            >
              {renameMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('categoryManager.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('categoryManager.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('categoryManager.deleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Keep the dialog mounted until the mutation settles (it closes
                // itself onSuccess); the default action closes on click.
                e.preventDefault();
                if (deleting) deleteMutation.mutate(deleting.id);
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('categoryManager.deleteButton')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
