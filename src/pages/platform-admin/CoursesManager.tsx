import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { LevelBadge } from '@/components/ui/level-badge';
import { SlidingTabs } from '@/components/ui/sliding-tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { FileUpload } from '@/components/ui/file-upload';
import { callApi } from '@/lib/api-client';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useToastMutation } from '@/hooks/useToastMutation';
import { extractLmsAssetPath, getSignedLmsAssetUrl } from '@/lib/storage';
import { Course, CourseLevel, OrgCourseAccess } from '@/lib/types';
import { BookOpen, Plus, Loader2, Trash2, Building2, ShieldCheck, Search, Check, ChevronsUpDown, Pencil } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';

/**
 * Cache key for the admin course list + access matrix (one query, one ship).
 * Re-exported from the factory so CourseEditor can import it unchanged.
 */
export const coursesAdminQueryKey = queryKeys.coursesAdmin.all;

interface CoursesAdminData {
  /** Courses with thumbnail_url already re-signed for display. */
  courses: Course[];
  accessRecords: OrgCourseAccess[];
}

/** RETURNING'd access rows replace any prior row for the same org+course pair. */
function upsertAccessRecords(existing: OrgCourseAccess[], incoming: OrgCourseAccess[]): OrgCourseAccess[] {
  const kept = existing.filter(
    (r) => !incoming.some((n) => n.org_id === r.org_id && n.course_id === r.course_id),
  );
  return [...kept, ...incoming];
}

export default function CoursesManager() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab state from URL
  const activeTab = searchParams.get('tab') || 'courses';

  // Course list state
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState<CourseLevel>('basic');
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  // Delete state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [courseToDelete, setCourseToDelete] = useState<Course | null>(null);

  // Publish in-flight tracking
  const [publishingId, setPublishingId] = useState<string | null>(null);

  // Course Access state — org list comes from the shared cache (#87)
  const {
    data: orgsData,
    isLoading: orgsLoading,
    error: orgsError,
    refetch: refetchOrgs,
  } = useOrganizations();
  const orgs = orgsData ?? [];
  const [orgSearchQuery, setOrgSearchQuery] = useState('');
  const [selectedOrg, setSelectedOrg] = useState<string>('all');
  const [orgComboboxOpen, setOrgComboboxOpen] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  // Mutations patch this cache from their RETURNING'd rows (issue #48); only the
  // course create path refetches it, because new thumbnails need re-signing.
  // No-blank-page invariant: during a refetch the stale data keeps rendering
  // (isLoading is true only while there is no data at all).
  const {
    data: coursesData,
    isLoading: coursesLoading,
    error: coursesError,
    refetch: refetchCourses,
  } = useQuery({
    queryKey: coursesAdminQueryKey,
    queryFn: async (): Promise<CoursesAdminData> => {
      const adminRes = await callApi<CoursesAdminData>('/api/courses-admin', {});
      const coursesWithFreshThumbnails = await Promise.all(
        adminRes.courses.map(async (course) => ({
          ...course,
          thumbnail_url: await getSignedLmsAssetUrl(course.thumbnail_url),
        })),
      );
      return { courses: coursesWithFreshThumbnails, accessRecords: adminRes.accessRecords };
    },
  });
  const courses = coursesData?.courses ?? [];
  const accessRecords = coursesData?.accessRecords ?? [];

  // Load failures (either query) surface through the page's "Failed to load
  // courses" error block + toast, same as the pre-TanStack version.
  useEffect(() => {
    if (coursesError) {
      toast({ title: 'Failed to load courses', description: coursesError.message, variant: 'destructive' });
    }
  }, [coursesError]);
  useEffect(() => {
    if (orgsError) {
      toast({ title: 'Failed to load courses', description: (orgsError as Error).message, variant: 'destructive' });
    }
  }, [orgsError]);

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  // ========== Course CRUD ==========
  const createCourseMutation = useToastMutation({
    mutationFn: (input: { title: string; description: string; level: CourseLevel; thumbnailUrl: string | null }) =>
      callApi<{ course: Course }>('/api/course-create', input),
    errorTitle: 'Failed to create course',
    onSuccess: () => {
      toast({ title: t('coursesManager.courseCreated') });
      setCreateOpen(false); setTitle(''); setDescription(''); setLevel('basic'); setThumbnailUrl(null);
      // KEEP the refetch here: the new course's thumbnail path needs re-signing.
      queryClient.invalidateQueries({ queryKey: coursesAdminQueryKey });
    },
  });
  const creating = createCourseMutation.isPending;

  const handleCreate = () => {
    if (!title.trim()) return;
    const thumbnailToPersist = extractLmsAssetPath(thumbnailUrl) ?? thumbnailUrl;
    createCourseMutation.mutate({ title, description, level, thumbnailUrl: thumbnailToPersist });
  };

  const togglePublishMutation = useToastMutation({
    mutationFn: (course: Course) =>
      callApi<{ course: Course }>('/api/course-update', {
        courseId: course.id,
        updates: { isPublished: !course.is_published },
      }),
    errorTitle: 'Failed to update course',
    onSuccess: ({ course: updated }) => {
      queryClient.setQueryData<CoursesAdminData>(coursesAdminQueryKey, (prev) =>
        prev && {
          ...prev,
          courses: prev.courses.map((c) =>
            // Keep the already-signed thumbnail: the RETURNING'd row carries the raw path.
            c.id === updated.id ? { ...c, ...updated, thumbnail_url: c.thumbnail_url } : c,
          ),
        },
      );
    },
    onSettled: () => setPublishingId(null),
  });
  const togglePublish = (course: Course) => {
    setPublishingId(course.id);
    togglePublishMutation.mutate(course);
  };

  const openDeleteDialog = (course: Course) => {
    setCourseToDelete(course);
    setDeleteOpen(true);
  };

  const deleteCourseMutation = useToastMutation({
    mutationFn: (course: Course) =>
      callApi<{ success: boolean; blobsDeleted: number; blobsFailed: number }>('/api/course-delete', { courseId: course.id }),
    errorTitle: 'Failed to delete course',
    onSuccess: (result, course) => {
      if (result.blobsFailed > 0) {
        toast({ title: t('coursesManager.courseDeleted'), description: `Could not delete ${result.blobsFailed} video file(s) from storage.`, variant: 'destructive' });
      } else {
        toast({ title: t('coursesManager.courseDeleted') });
      }
      setDeleteOpen(false);
      setCourseToDelete(null);
      queryClient.setQueryData<CoursesAdminData>(coursesAdminQueryKey, (prev) =>
        prev && {
          courses: prev.courses.filter((c) => c.id !== course.id),
          accessRecords: prev.accessRecords.filter((r) => r.course_id !== course.id),
        },
      );
    },
  });
  const deleting = deleteCourseMutation.isPending;

  const handleDeleteCourse = () => {
    if (!courseToDelete) return;
    deleteCourseMutation.mutate(courseToDelete);
  };

  // ========== Course Access ==========
  const getAccessStatus = (orgId: string, courseId: string): boolean => {
    const record = accessRecords.find(
      (r) => r.org_id === orgId && r.course_id === courseId
    );
    return record?.access === 'enabled';
  };

  /** How many orgs currently have this course enabled (derived from the cache). */
  const orgAccessCount = (courseId: string): number =>
    accessRecords.filter((r) => r.course_id === courseId && r.access === 'enabled').length;

  const toggleAccessMutation = useToastMutation({
    mutationFn: ({ orgId, courseId, currentEnabled }: { orgId: string; courseId: string; currentEnabled: boolean }) =>
      callApi<{ record: OrgCourseAccess }>('/api/course-access-set', {
        orgId,
        courseId,
        access: currentEnabled ? 'disabled' : 'enabled',
      }),
    errorTitle: 'Failed to update access',
    onSuccess: ({ record }) => {
      queryClient.setQueryData<CoursesAdminData>(coursesAdminQueryKey, (prev) =>
        prev && { ...prev, accessRecords: upsertAccessRecords(prev.accessRecords, [record]) },
      );
    },
    onSettled: () => setUpdating(null),
  });

  const toggleAccess = (orgId: string, courseId: string, currentEnabled: boolean) => {
    setUpdating(`${orgId}-${courseId}`);
    toggleAccessMutation.mutate({ orgId, courseId, currentEnabled });
  };

  const enableAllMutation = useToastMutation({
    mutationFn: (orgId: string) =>
      callApi<{ records: OrgCourseAccess[] }>('/api/course-access-bulk', { orgId }),
    errorTitle: 'Failed to enable all courses',
    onSuccess: ({ records }) => {
      toast({
        title: t('coursesManager.accessGranted'),
        description: t('coursesManager.accessGrantedDescription'),
      });
      queryClient.setQueryData<CoursesAdminData>(coursesAdminQueryKey, (prev) =>
        prev && { ...prev, accessRecords: upsertAccessRecords(prev.accessRecords, records) },
      );
    },
    onSettled: () => setUpdating(null),
  });

  const enableAllForOrg = (orgId: string) => {
    setUpdating(`all-${orgId}`);
    enableAllMutation.mutate(orgId);
  };

  // ========== Filtering ==========
  const clearFilters = () => {
    setSearchQuery('');
    setLevelFilter('all');
    setStatusFilter('all');
  };

  const hasFilters = searchQuery !== '' || levelFilter !== 'all' || statusFilter !== 'all';

  const filteredCourses = courses.filter(course => {
    const matchesSearch = searchQuery === '' ||
      course.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      course.description?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesLevel = levelFilter === 'all' || course.level === levelFilter;

    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'published' && course.is_published) ||
      (statusFilter === 'draft' && !course.is_published);

    return matchesSearch && matchesLevel && matchesStatus;
  });

  const filteredOrgs = orgs.filter((o) => {
    const matchesSelection = selectedOrg === 'all' || o.id === selectedOrg;
    const matchesSearch = orgSearchQuery === '' || o.name.toLowerCase().includes(orgSearchQuery.toLowerCase());
    return matchesSelection && matchesSearch;
  });
  const publishedCourses = courses.filter((c) => c.is_published);

  const combinedLoadError = coursesError?.message ?? (orgsError ? (orgsError as Error).message : null);

  // isLoading is true only while there is no cached data, so a post-mutation
  // refetch keeps rendering the stale page instead of blanking to the spinner.
  if (coursesLoading || orgsLoading) {
    return (
      <AppLayout title={t('coursesManager.title')}>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (combinedLoadError) {
    return (
      <AppLayout title={t('coursesManager.title')}>
        <div className="flex h-64 flex-col items-center justify-center gap-4 text-center">
          <p className="text-destructive font-medium">{t('coursesManager.failedToLoad')}</p>
          <p className="text-sm text-muted-foreground">{combinedLoadError}</p>
          <Button
            variant="outline"
            onClick={() => {
              // Retry is a full reload — with no data cached, isLoading goes true
              // during the refetch, so the spinner shows, not a flash of empty UI.
              refetchCourses();
              if (orgsError) refetchOrgs();
            }}
          >
            {t('coursesManager.retry')}
          </Button>
        </div>
      </AppLayout>
    );
  }

  const createDialog = (
    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('coursesManager.newCourse')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('coursesManager.createTitle')}</DialogTitle>
          <DialogDescription>{t('coursesManager.createDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t('coursesManager.thumbnail')}</Label>
            <FileUpload
              bucket="lms-assets"
              folder="thumbnails"
              accept="image"
              value={thumbnailUrl}
              onChange={(url) => setThumbnailUrl(url)}
              maxSizeMB={10}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('coursesManager.titleLabel')}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('coursesManager.titlePlaceholder')} />
          </div>
          <div className="space-y-2">
            <Label>{t('coursesManager.descriptionLabel')}</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('coursesManager.descriptionPlaceholder')} />
          </div>
          <div className="space-y-2">
            <Label>{t('coursesManager.levelLabel')}</Label>
            <Select value={level} onValueChange={(v) => setLevel(v as CourseLevel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="basic">{t('courses.levels.basic')}</SelectItem>
                <SelectItem value="intermediate">{t('courses.levels.intermediate')}</SelectItem>
                <SelectItem value="advanced">{t('courses.levels.advanced')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('coursesManager.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <AppLayout breadcrumbs={[{ label: t('coursesManager.tabCourses') }]}>
      {/* Header — the page owns its heading; AppLayout `title` is omitted here to avoid a
          duplicate <h1> (the loading/error branches keep `title` since they have no in-page header). */}
      <div className="mb-5 flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div>
          <h1 className="font-display text-[26px] font-extrabold tracking-[-0.02em]">{t('coursesManager.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('coursesManager.subtitle')}</p>
        </div>
        {createDialog}
      </div>

      {/* Tabs */}
      <div className="mb-5">
        <SlidingTabs
          tabs={[
            { key: 'courses', label: t('coursesManager.tabCourses') },
            { key: 'access', label: t('coursesManager.tabAccess') },
          ]}
          active={activeTab}
          onChange={handleTabChange}
        />
      </div>

      {/* ========== Courses Tab ========== */}
      {activeTab === 'courses' && (
        <div className="space-y-[18px]">
          {/* Search + filters */}
          <div className="flex flex-col gap-[10px] sm:flex-row">
            <div className="relative flex-1">
              <Search aria-hidden="true" className="absolute left-[13px] top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0af]" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('coursesManager.searchPlaceholder')}
                className="pl-10"
              />
            </div>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-full sm:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('courses.allLevels')}</SelectItem>
                <SelectItem value="basic">{t('courses.levels.basic')}</SelectItem>
                <SelectItem value="intermediate">{t('courses.levels.intermediate')}</SelectItem>
                <SelectItem value="advanced">{t('courses.levels.advanced')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('courses.anyStatus')}</SelectItem>
                <SelectItem value="published">{t('coursesManager.published')}</SelectItem>
                <SelectItem value="draft">{t('coursesManager.draft')}</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" onClick={clearFilters} className="sm:self-stretch">
                {t('common.clear')}
              </Button>
            )}
          </div>

          {filteredCourses.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-6 w-6" />}
              title={hasFilters ? t('coursesManager.noMatchingTitle') : t('coursesManager.noCoursesTitle')}
              description={hasFilters ? t('coursesManager.noMatchingDescription') : t('coursesManager.noCoursesDescription')}
              action={!hasFilters ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t('coursesManager.newCourse')}
                </Button>
              ) : undefined}
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              {/* Header row */}
              <div className="grid grid-cols-[2.4fr_0.9fr_1fr_0.9fr_0.8fr] gap-3 bg-[#f7f8fa] px-5 py-3 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[#9aa0af]">
                <span>{t('coursesManager.colCourse')}</span>
                <span>{t('coursesManager.colLevel')}</span>
                <span>{t('coursesManager.colStatus')}</span>
                <span>{t('coursesManager.tabAccess')}</span>
                <span className="text-right">{t('coursesManager.colActions')}</span>
              </div>
              {filteredCourses.map((course) => (
                <div
                  key={course.id}
                  className="grid grid-cols-[2.4fr_0.9fr_1fr_0.9fr_0.8fr] items-center gap-3 border-t border-[#f3f4f8] px-5 py-3.5"
                >
                  {/* Course: thumb chip + title */}
                  <button
                    type="button"
                    onClick={() => navigate(routes.platformAdmin.courseEditor(course.id))}
                    className="flex min-w-0 items-center gap-3 text-left"
                  >
                    {course.thumbnail_url ? (
                      <img
                        src={course.thumbnail_url}
                        alt=""
                        className="h-[30px] w-[42px] shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <span className="h-[30px] w-[42px] shrink-0 rounded-lg bg-gradient-to-br from-primary/80 to-primary" />
                    )}
                    <span className="truncate text-[13px] font-bold">{course.title}</span>
                  </button>
                  {/* Level */}
                  <span>
                    <LevelBadge level={course.level} />
                  </span>
                  {/* Status pill + publish switch */}
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-[7px] px-2.5 py-1 text-[11px] font-bold',
                        course.is_published ? 'bg-success/10 text-success' : 'bg-[#f3f4f8] text-[#686d7e]',
                      )}
                    >
                      {course.is_published ? t('coursesManager.published') : t('coursesManager.draft')}
                    </span>
                    <Switch
                      checked={course.is_published}
                      onCheckedChange={() => togglePublish(course)}
                      disabled={publishingId === course.id}
                      aria-label={course.is_published ? t('courseEditor.unpublishAria') : t('courseEditor.publishAria')}
                    />
                  </span>
                  {/* Org-access count */}
                  <span className="text-[13px] font-semibold text-[#4a4f60]">{orgAccessCount(course.id)}</span>
                  {/* Actions */}
                  <span className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => navigate(routes.platformAdmin.courseEditor(course.id))}
                      title={t('coursesManager.editCourse')}
                      aria-label={t('coursesManager.editCourse')}
                      className="grid h-[30px] w-[30px] place-items-center rounded-lg text-[#9aa0af] transition-colors hover:bg-[#f3f4f8] hover:text-primary"
                    >
                      <Pencil className="h-[14px] w-[14px]" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openDeleteDialog(course)}
                      title={t('coursesManager.deleteCourse')}
                      aria-label={t('coursesManager.deleteCourse')}
                      className="grid h-[30px] w-[30px] place-items-center rounded-lg text-[#9aa0af] transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-[14px] w-[14px]" aria-hidden="true" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========== Organization Access Tab ========== */}
      {activeTab === 'access' && (
        <div className="space-y-6">
          {/* Info Banner */}
          <div className="flex items-start gap-3 rounded-2xl border border-[#d7ddf4] bg-[#eef1fb] px-5 py-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="font-bold text-primary">{t('coursesManager.accessInfoTitle')}</p>
              <p className="text-sm text-muted-foreground">{t('coursesManager.accessInfoBody')}</p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative max-w-sm flex-1">
              <Search aria-hidden="true" className="absolute left-[13px] top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0af]" />
              <Input
                placeholder={t('coursesManager.searchOrganizations')}
                value={orgSearchQuery}
                onChange={(e) => setOrgSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Popover open={orgComboboxOpen} onOpenChange={setOrgComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" aria-expanded={orgComboboxOpen} className="w-[240px] justify-between">
                    {selectedOrg === 'all'
                      ? t('coursesManager.allOrganizations')
                      : orgs.find((org) => org.id === selectedOrg)?.name || t('coursesManager.selectOrganization')}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[240px] p-0">
                  <Command>
                    <CommandInput placeholder={t('coursesManager.searchOrganizationPrompt')} />
                    <CommandList>
                      <CommandEmpty>{t('coursesManager.noOrganizationFound')}</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="All Organizations"
                          onSelect={() => {
                            setSelectedOrg('all');
                            setOrgComboboxOpen(false);
                          }}
                        >
                          <Check className={cn('mr-2 h-4 w-4', selectedOrg === 'all' ? 'opacity-100' : 'opacity-0')} />
                          {t('coursesManager.allOrganizations')}
                        </CommandItem>
                        {orgs.map((org) => (
                          <CommandItem
                            key={org.id}
                            value={org.name}
                            onSelect={() => {
                              setSelectedOrg(org.id);
                              setOrgComboboxOpen(false);
                            }}
                          >
                            <Check className={cn('mr-2 h-4 w-4', selectedOrg === org.id ? 'opacity-100' : 'opacity-0')} />
                            {org.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Access Matrix */}
          {publishedCourses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#d6d8e0] bg-card p-12 text-center">
              <BookOpen className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
              <p className="text-muted-foreground">{t('coursesManager.noPublishedCoursesTitle')}</p>
              <p className="text-sm text-muted-foreground">{t('coursesManager.noPublishedCoursesDescription')}</p>
            </div>
          ) : filteredOrgs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#d6d8e0] bg-card p-12 text-center">
              <Building2 className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
              <p className="text-muted-foreground">{t('coursesManager.noOrganizationsFound')}</p>
            </div>
          ) : (
            <div className="space-y-6">
              {filteredOrgs.map((org) => (
                <div key={org.id} className="overflow-hidden rounded-2xl border border-border bg-card">
                  {/* Org header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-accent text-primary">
                        <Building2 className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="text-[15px] font-extrabold">{org.name}</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => enableAllForOrg(org.id)}
                      disabled={updating === `all-${org.id}`}
                    >
                      {updating === `all-${org.id}` ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      {t('coursesManager.enableAllCourses')}
                    </Button>
                  </div>
                  {/* Access rows */}
                  <div className="border-t border-[#f3f4f8]">
                    {publishedCourses.map((course) => {
                      const isEnabled = getAccessStatus(org.id, course.id);
                      const key = `${org.id}-${course.id}`;
                      return (
                        <div
                          key={course.id}
                          className="flex items-center gap-3 border-b border-[#f3f4f8] px-5 py-3 last:border-b-0"
                        >
                          {course.thumbnail_url ? (
                            <img
                              src={course.thumbnail_url}
                              alt=""
                              className="h-[34px] w-[34px] shrink-0 rounded-[10px] object-cover"
                            />
                          ) : (
                            <span className="h-[34px] w-[34px] shrink-0 rounded-[10px] bg-gradient-to-br from-primary/80 to-primary" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{course.title}</span>
                          <LevelBadge level={course.level} />
                          <span
                            className={cn(
                              'inline-flex items-center rounded-[7px] px-2.5 py-1 text-[11px] font-bold',
                              isEnabled ? 'bg-success/10 text-success' : 'bg-[#f3f4f8] text-[#686d7e]',
                            )}
                          >
                            {isEnabled ? t('coursesManager.enabled') : t('coursesManager.disabled')}
                          </span>
                          <span className="flex items-center gap-2">
                            {updating === key && (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            )}
                            <Switch
                              checked={isEnabled}
                              onCheckedChange={() => toggleAccess(org.id, course.id, isEnabled)}
                              disabled={updating === key}
                              aria-label={course.title}
                            />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('coursesManager.deleteCourseTitle')}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">{t('coursesManager.deleteIntro', { title: courseToDelete?.title })}</span>
              <ul className="list-inside list-disc text-sm">
                <li>{t('coursesManager.deleteItemModules')}</li>
                <li>{t('coursesManager.deleteItemEnrollments')}</li>
                <li>{t('coursesManager.deleteItemQuizzes')}</li>
              </ul>
              <span className="block font-medium">{t('coursesManager.deleteIrreversible')}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCourse}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('coursesManager.deleteCourse')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
