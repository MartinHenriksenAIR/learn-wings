import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Switch } from '@/components/ui/switch';
import { SaveButton } from '@/components/ui/save-button';
import { LanguageBadge } from '@/components/ui/language-badge';
import { useFlash } from '@/hooks/useFlash';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { FileUpload } from '@/components/ui/file-upload';
import { AzureVideoUpload } from '@/components/ui/azure-video-upload';
import { AzureDocumentUpload } from '@/components/ui/azure-document-upload';
import { QuizEditorDialog } from '@/components/platform-admin/QuizEditorDialog';

import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import { extractLmsAssetPath, getSignedLmsAssetUrl } from '@/lib/storage';
import { Course, CourseModule, Lesson, CourseLevel, LessonType } from '@/lib/types';
import { ArrowLeft, Plus, Loader2, GripVertical, Trash2, Video, FileText, HelpCircle, Pencil } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { useToastMutation } from '@/hooks/useToastMutation';
import { cn } from '@/lib/utils';
import { coursesAdminQueryKey } from './CoursesManager';

/** Cache key for one course's full admin structure (course + modules + lessons). */
const courseStructureQueryKey = (courseId: string) => queryKeys.courseStructureAdmin.detail(courseId);

interface CourseStructureData {
  course: Course | null;
  modules: CourseModule[];
  /** Display URL re-signed from course.thumbnail_url (the DB row carries the raw path). */
  signedThumbnailUrl: string | null;
}

interface SaveLessonInput {
  /** null → create (sort_order is server-owned, issue #46); set → update. */
  lessonId: string | null;
  moduleId: string;
  title: string;
  lessonType: LessonType;
  contentText: string | null;
  durationMinutes: number | null;
  videoStoragePath: string | null;
  azureBlobPath: string | null;
  documentStoragePath: string | null;
}

export default function CourseEditor() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { features } = usePlatformSettings();

  // In-button "Save changes" success morph (toast policy: course save is routine).
  const { flashed, flash } = useFlash();

  // Course edit state
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLevel, setEditLevel] = useState<CourseLevel>('basic');
  const [editLanguage, setEditLanguage] = useState<'en' | 'da'>('da');
  const [editThumbnailUrl, setEditThumbnailUrl] = useState<string | null>(null);

  // Module dialog state
  const [moduleDialogOpen, setModuleDialogOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<CourseModule | null>(null);
  const [moduleTitle, setModuleTitle] = useState('');

  // Lesson dialog state
  const [lessonDialogOpen, setLessonDialogOpen] = useState(false);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [lessonModuleId, setLessonModuleId] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonType, setLessonType] = useState<LessonType>('document');
  const [lessonContent, setLessonContent] = useState('');
  const [lessonDuration, setLessonDuration] = useState<number | null>(null);
  const [lessonVideoPath, setLessonVideoPath] = useState<string | null>(null);
  const [lessonAzureBlobPath, setLessonAzureBlobPath] = useState<string | null>(null);
  const [lessonDocPath, setLessonDocPath] = useState<string | null>(null);

  // Delete course state
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Quiz editor state
  const [quizEditorOpen, setQuizEditorOpen] = useState(false);
  const [quizLessonId, setQuizLessonId] = useState<string | null>(null);
  const [quizLessonTitle, setQuizLessonTitle] = useState('');

  // Module/lesson mutations patch this cache from their RETURNING'd rows (issue
  // #48); only the course save path refetches it, because a changed thumbnail
  // needs re-signing. Patches must keep the `course` object reference intact so
  // the edit-field seeding effect below doesn't clobber unsaved course edits.
  const structureQueryKey = courseStructureQueryKey(courseId ?? '');
  const {
    data: structureData,
    isLoading: loading,
    error: loadError,
    refetch: refetchStructure,
  } = useQuery({
    queryKey: structureQueryKey,
    enabled: !!courseId,
    queryFn: async (): Promise<CourseStructureData> => {
      const res = await callApi<{ course: Course | null; modules: CourseModule[] }>(
        '/api/course-structure-admin',
        { courseId },
      );
      const signedThumbnailUrl = res.course ? await getSignedLmsAssetUrl(res.course.thumbnail_url) : null;
      return { course: res.course, modules: res.modules, signedThumbnailUrl };
    },
  });
  const course = structureData?.course ?? null;
  const modules = structureData?.modules ?? [];
  const signedThumbnailUrl = structureData?.signedThumbnailUrl ?? null;

  useEffect(() => {
    if (loadError) {
      toast({ title: t('courseEditor.failedToLoad'), description: loadError.message, variant: 'destructive' });
    }
  }, [loadError, t]);

  // Seed the editable text fields when the course identity changes (initial load
  // / switching courses). Keyed on the id, not the object, so a publish-toggle
  // cache patch (new `course` object, same id) can flip is_published WITHOUT
  // clobbering unsaved title/description edits.
  useEffect(() => {
    if (course) {
      setEditTitle(course.title);
      setEditDescription(course.description || '');
      setEditLevel(course.level);
      setEditLanguage(course.language ?? 'da');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id]);

  // Re-seed the thumbnail whenever the re-signed URL changes (initial load +
  // post-save refetch where the path is re-signed).
  useEffect(() => {
    if (course) setEditThumbnailUrl(signedThumbnailUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedThumbnailUrl]);

  const saveCourseMutation = useToastMutation({
    mutationFn: (updates: { title: string; description: string; level: CourseLevel; language: 'en' | 'da'; thumbnailUrl: string | null }) =>
      callApi<{ course: Course }>('/api/course-update', { courseId, updates }),
    errorTitle: 'Failed to save course',
    onSuccess: () => {
      // Toast policy: routine save → in-button morph, not a toast.
      flash('course');
      // KEEP the refetch here: a changed thumbnail path needs re-signing.
      queryClient.invalidateQueries({ queryKey: structureQueryKey });
    },
  });
  const saving = saveCourseMutation.isPending;

  const handleSaveCourse = () => {
    if (!courseId || !editTitle.trim()) return;
    const thumbnailToPersist = extractLmsAssetPath(editThumbnailUrl) ?? editThumbnailUrl;
    saveCourseMutation.mutate({
      title: editTitle,
      description: editDescription,
      level: editLevel,
      language: editLanguage,
      thumbnailUrl: thumbnailToPersist,
    });
  };

  // Publish toggle — same mutation/payload as the manager's publish switch
  // (#48: patch the cache from the RETURNING'd row, no full refetch). The patch
  // keeps the same course id so the seeding effects above don't re-seed; it also
  // preserves the already-signed thumbnail (the RETURNING'd row carries the raw
  // path). Toast policy: publish toggle is routine — the switch state IS the
  // feedback, no toast.
  const togglePublishMutation = useToastMutation({
    mutationFn: (isPublished: boolean) =>
      callApi<{ course: Course }>('/api/course-update', {
        courseId,
        updates: { isPublished },
      }),
    errorTitle: 'Failed to update course',
    onSuccess: ({ course: updated }) => {
      queryClient.setQueryData<CourseStructureData>(structureQueryKey, (prev) =>
        prev && prev.course
          ? { ...prev, course: { ...prev.course, is_published: updated.is_published } }
          : prev,
      );
    },
  });
  const togglingPublish = togglePublishMutation.isPending;

  const handleTogglePublish = () => {
    if (!course) return;
    togglePublishMutation.mutate(!course.is_published);
  };

  /** Patch only `modules` in the structure cache, preserving the `course` reference. */
  const patchModules = (update: (modules: CourseModule[]) => CourseModule[]) => {
    queryClient.setQueryData<CourseStructureData>(structureQueryKey, (prev) =>
      prev && { ...prev, modules: update(prev.modules) },
    );
  };

  // Module handlers
  const openAddModule = () => {
    setEditingModule(null);
    setModuleTitle('');
    setModuleDialogOpen(true);
  };

  const openEditModule = (mod: CourseModule) => {
    setEditingModule(mod);
    setModuleTitle(mod.title);
    setModuleDialogOpen(true);
  };

  const saveModuleMutation = useToastMutation({
    mutationFn: ({ moduleId, title }: { moduleId: string | null; title: string }) =>
      moduleId
        ? callApi<{ module: CourseModule }>('/api/module-update', { moduleId, title })
        : // sort_order is server-owned (issue #46): module-create appends at MAX+1
          callApi<{ module: CourseModule }>('/api/module-create', { courseId, title }),
    errorTitle: ({ moduleId }) => (moduleId ? 'Failed to update module' : 'Failed to create module'),
    onSuccess: ({ module }, { moduleId }) => {
      toast({ title: moduleId ? t('courseEditor.moduleUpdated') : t('courseEditor.moduleCreated') });
      setModuleDialogOpen(false);
      patchModules((mods) =>
        moduleId
          // RETURNING'd row is the bare module — keep the lessons we already have.
          ? mods.map((m) => (m.id === module.id ? { ...m, ...module, lessons: m.lessons } : m))
          // Server appends at MAX+1, so the end of the list is its sorted position.
          : [...mods, { ...module, lessons: [] }],
      );
    },
  });
  const savingModule = saveModuleMutation.isPending;

  const handleSaveModule = () => {
    if (!courseId || !moduleTitle.trim()) return;
    saveModuleMutation.mutate({ moduleId: editingModule?.id ?? null, title: moduleTitle });
  };

  const deleteModuleMutation = useToastMutation({
    mutationFn: (moduleId: string) =>
      callApi<{ success: boolean; blobsDeleted: number; blobsFailed: number }>('/api/module-delete', { moduleId }),
    errorTitle: 'Failed to delete module',
    onSuccess: (result, moduleId) => {
      if (result.blobsFailed > 0) {
        toast({ title: t('courseEditor.moduleDeleted'), description: `Could not delete ${result.blobsFailed} video file(s) from storage.`, variant: 'destructive' });
      } else {
        toast({ title: t('courseEditor.moduleDeleted') });
      }
      patchModules((mods) => mods.filter((m) => m.id !== moduleId));
    },
  });

  const handleDeleteModule = (modId: string) => deleteModuleMutation.mutate(modId);

  // Lesson handlers
  const openAddLesson = (moduleId: string) => {
    setEditingLesson(null);
    setLessonModuleId(moduleId);
    setLessonTitle('');
    setLessonType('document');
    setLessonContent('');
    setLessonDuration(null);
    setLessonVideoPath(null);
    setLessonAzureBlobPath(null);
    setLessonDocPath(null);
    setLessonDialogOpen(true);
  };

  const openEditLesson = (lesson: Lesson) => {
    setEditingLesson(lesson);
    setLessonModuleId(lesson.module_id);
    setLessonTitle(lesson.title);
    setLessonType(lesson.lesson_type);
    setLessonContent(lesson.content_text || '');
    setLessonDuration(lesson.duration_minutes);
    setLessonVideoPath(lesson.video_storage_path || null);
    setLessonAzureBlobPath(lesson.azure_blob_path || null);
    setLessonDocPath(lesson.document_storage_path || null);
    setLessonDialogOpen(true);
  };

  const saveLessonMutation = useToastMutation({
    mutationFn: ({ lessonId, ...payload }: SaveLessonInput) =>
      lessonId
        ? callApi<{ lesson: Lesson }>('/api/lesson-update', { lessonId, ...payload })
        : // sort_order is server-owned (issue #46): lesson-create appends at MAX+1
          callApi<{ lesson: Lesson }>('/api/lesson-create', payload),
    errorTitle: ({ lessonId }) => (lessonId ? 'Failed to update lesson' : 'Failed to create lesson'),
    onSuccess: ({ lesson }, { lessonId }) => {
      toast({ title: lessonId ? t('courseEditor.lessonUpdated') : t('courseEditor.lessonCreated') });
      setLessonDialogOpen(false);
      patchModules((mods) =>
        mods.map((m) =>
          m.id !== lesson.module_id
            ? m
            : {
                ...m,
                lessons: lessonId
                  ? (m.lessons ?? []).map((l) => (l.id === lesson.id ? lesson : l))
                  // Server appends at MAX+1, so the end of the list is its sorted position.
                  : [...(m.lessons ?? []), lesson],
              },
        ),
      );
    },
  });
  const savingLesson = saveLessonMutation.isPending;

  const handleSaveLesson = () => {
    if (!lessonModuleId || !lessonTitle.trim()) return;
    saveLessonMutation.mutate({
      lessonId: editingLesson?.id ?? null,
      moduleId: lessonModuleId,
      title: lessonTitle,
      lessonType,
      contentText: lessonContent || null,
      durationMinutes: lessonDuration,
      videoStoragePath: lessonType === 'video' ? lessonVideoPath : null,
      azureBlobPath: lessonType === 'video' ? lessonAzureBlobPath : null,
      documentStoragePath: lessonType === 'document' ? lessonDocPath : null,
    });
  };

  const deleteLessonMutation = useToastMutation({
    mutationFn: (lessonId: string) =>
      callApi<{ success: boolean; blobDeleted: boolean | null }>('/api/lesson-delete', { lessonId }),
    errorTitle: 'Failed to delete lesson',
    onSuccess: (result, lessonId) => {
      if (result.blobDeleted === false) {
        toast({ title: t('courseEditor.lessonDeleted'), description: 'Could not delete the video file from storage.', variant: 'destructive' });
      } else {
        toast({ title: t('courseEditor.lessonDeleted') });
      }
      patchModules((mods) =>
        mods.map((m) =>
          m.lessons?.some((l) => l.id === lessonId)
            ? { ...m, lessons: m.lessons.filter((l) => l.id !== lessonId) }
            : m,
        ),
      );
    },
  });

  const handleDeleteLesson = (lessonId: string) => deleteLessonMutation.mutate(lessonId);

  const deleteCourseMutation = useToastMutation({
    mutationFn: () =>
      callApi<{ success: boolean; blobsDeleted: number; blobsFailed: number }>('/api/course-delete', { courseId }),
    errorTitle: 'Failed to delete course',
    onSuccess: (result) => {
      if (result.blobsFailed > 0) {
        toast({ title: t('courseEditor.courseDeleted'), description: `Could not delete ${result.blobsFailed} video file(s) from storage.`, variant: 'destructive' });
      } else {
        toast({ title: t('courseEditor.courseDeleted') });
      }
      // The cached admin list still holds the deleted course; drop it so the
      // list page does a fresh load instead of flashing the deleted row.
      queryClient.removeQueries({ queryKey: coursesAdminQueryKey });
      navigate(routes.platformAdmin.courses);
    },
  });
  const deleting = deleteCourseMutation.isPending;

  const handleDeleteCourse = () => {
    if (!courseId) return;
    deleteCourseMutation.mutate();
  };

  // ── Language editions (#213) ───────────────────────────────────────────────
  // Candidate source is the shared admin course list — the same cache
  // CoursesManager populates. Gated on `course` so we don't fetch before the
  // editor has loaded (the section only renders once the course exists).
  // CoursesManager writes { courses, accessRecords } under this key while our
  // queryFn writes just the array, so read defensively — either shape yields a
  // course list.
  const coursesAdminQuery = useQuery({
    queryKey: queryKeys.coursesAdmin.all,
    queryFn: async () => (await callApi<{ courses: Course[] }>('/api/courses-admin', {})).courses,
    enabled: !!course,
    staleTime: 60 * 1000,
  });
  const coursesAdminData = coursesAdminQuery.data as Course[] | { courses?: Course[] } | undefined;
  const allCourses: Course[] = Array.isArray(coursesAdminData)
    ? coursesAdminData
    : coursesAdminData?.courses ?? [];
  const thisCourse = allCourses.find((c) => c.id === courseId);
  const siblings = thisCourse?.course_group_id
    ? allCourses.filter((c) => c.id !== courseId && c.course_group_id === thisCourse.course_group_id)
    : [];
  // A candidate is eligible only if it's standalone (no group) and brings a
  // language the group doesn't already have — one edition per language.
  const groupLanguages = new Set(
    [thisCourse, ...siblings].filter(Boolean).map((c) => (c as Course).language),
  );
  const candidates = allCourses.filter(
    (c) =>
      c.id !== courseId &&
      !c.course_group_id &&
      c.language != null &&
      !groupLanguages.has(c.language),
  );

  const [linkTargetId, setLinkTargetId] = useState<string>('');

  const linkEditionMutation = useToastMutation({
    mutationFn: (otherCourseId: string) =>
      callApi('/api/course-translation-link', { action: 'link', courseId, otherCourseId }),
    errorTitle: 'Failed to link edition',
    onSuccess: () => {
      setLinkTargetId('');
      queryClient.invalidateQueries({ queryKey: queryKeys.coursesAdmin.all });
    },
  });

  const unlinkEditionMutation = useToastMutation({
    mutationFn: (targetCourseId: string) =>
      callApi('/api/course-translation-link', { action: 'unlink', courseId: targetCourseId }),
    errorTitle: 'Failed to unlink edition',
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.coursesAdmin.all }),
  });

  const lessonTypeIcon = (type: LessonType) => {
    switch (type) {
      case 'video': return <Video className="h-[13px] w-[13px]" aria-hidden="true" />;
      case 'document': return <FileText className="h-[13px] w-[13px]" aria-hidden="true" />;
      case 'quiz': return <HelpCircle className="h-[13px] w-[13px]" aria-hidden="true" />;
    }
  };

  const lessonTypeLabel = (type: LessonType) => {
    switch (type) {
      case 'video': return t('courseEditor.lessonTypeVideo');
      case 'document': return t('courseEditor.lessonTypeDocument');
      case 'quiz': return t('courseEditor.lessonTypeQuiz');
    }
  };

  if (loading) {
    return (
      <AppLayout title={t('courseEditor.title')}>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!loading && loadError) {
    return (
      <AppLayout title={t('courseEditor.title')}>
        <div className="flex h-64 flex-col items-center justify-center gap-4 text-center">
          <p className="text-destructive font-medium">{t('courseEditor.failedToLoad')}</p>
          <p className="text-sm text-muted-foreground">{loadError.message}</p>
          {/* While the retry is in flight with no cached data, isLoading goes
              true and the spinner branch above takes over. */}
          <Button variant="outline" onClick={() => refetchStructure()}>
            {t('courseEditor.retry')}
          </Button>
        </div>
      </AppLayout>
    );
  }

  if (!course) {
    return (
      <AppLayout title={t('courseEditor.title')}>
        <div className="text-center py-12">
          <p className="text-muted-foreground">{t('courseEditor.courseNotFound')}</p>
          <Button variant="outline" onClick={() => navigate(routes.platformAdmin.courses)} className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" /> {t('courseEditor.backToCourses')}
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title={t('courseEditor.title')}
      breadcrumbs={[{ label: t('coursesManager.tabCourses'), href: routes.platformAdmin.courses }, { label: course.title }]}
    >
      <div className="mx-auto max-w-[860px]">
        {/* Back link */}
        <button
          type="button"
          onClick={() => navigate(routes.platformAdmin.courses)}
          className="mb-3.5 inline-flex items-center gap-[7px] rounded-lg px-2 py-1.5 text-[13px] font-bold text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {t('courseEditor.backToCourses')}
        </button>

        {/* Course Details Card */}
        <div className="mb-[18px] rounded-2xl border border-border bg-card p-6">
          <div className="mb-[18px] flex items-center justify-between gap-3">
            <h2 className="text-base font-extrabold">{t('courseEditor.courseDetails')}</h2>
            <span
              className={cn(
                'inline-flex items-center rounded-[7px] px-3 py-[5px] text-[11px] font-bold',
                course.is_published ? 'bg-success/10 text-success' : 'bg-[#f3f4f8] text-[#686d7e]',
              )}
            >
              {course.is_published ? t('courseEditor.published') : t('courseEditor.draft')}
            </span>
          </div>

          <div className="mb-4 flex flex-col gap-5 md:flex-row">
            <div className="flex-1 space-y-3.5">
              <div className="space-y-1.5">
                <Label>{t('courseEditor.titleLabel')}</Label>
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('courseEditor.descriptionLabel')}</Label>
                <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} />
              </div>
            </div>
            <div className="w-full shrink-0 space-y-3.5 md:w-[220px]">
              <div className="space-y-1.5">
                <Label>{t('courseEditor.thumbnail')}</Label>
                <FileUpload
                  folder="thumbnails"
                  accept="image"
                  value={editThumbnailUrl}
                  onChange={(url) => setEditThumbnailUrl(url)}
                  maxSizeMB={10}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('courseEditor.levelLabel')}</Label>
                <Select value={editLevel} onValueChange={(v) => setEditLevel(v as CourseLevel)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">{t('courses.levels.basic')}</SelectItem>
                    <SelectItem value="intermediate">{t('courses.levels.intermediate')}</SelectItem>
                    <SelectItem value="advanced">{t('courses.levels.advanced')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('courseEditor.languageLabel')}</Label>
                <Select value={editLanguage} onValueChange={(v) => setEditLanguage(v as 'en' | 'da')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="da">{t('languages.da')}</SelectItem>
                    <SelectItem value="en">{t('languages.en')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Language editions (#213) — link/unlink translated editions so
              analytics count a course and its siblings as one. */}
          <div className="mb-[18px] space-y-2 border-t border-border pt-[18px]">
            <Label>{t('courseEditor.editions.title')}</Label>
            <p className="text-sm text-muted-foreground">{t('courseEditor.editions.description')}</p>

            {siblings.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-[13px] font-semibold">{t('courseEditor.editions.linkedHeading')}</p>
                <ul className="space-y-1">
                  {siblings.map((s) => (
                    <li key={s.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {s.title}
                        {s.language && <LanguageBadge language={s.language} />}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => unlinkEditionMutation.mutate(s.id)}
                        disabled={unlinkEditionMutation.isPending}
                      >
                        {t('courseEditor.editions.unlinkButton')}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('courseEditor.editions.none')}</p>
            )}

            {candidates.length > 0 ? (
              <div className="flex items-center gap-2 pt-1">
                <Select value={linkTargetId} onValueChange={setLinkTargetId}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder={t('courseEditor.editions.linkPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.title} ({c.language})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => linkTargetId && linkEditionMutation.mutate(linkTargetId)}
                  disabled={!linkTargetId || linkEditionMutation.isPending}
                >
                  {t('courseEditor.editions.linkButton')}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('courseEditor.editions.noCandidates')}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <SaveButton
              done={flashed('course')}
              idleLabel={t('courseEditor.saveChanges')}
              doneLabel={t('courseEditor.saved')}
              onClick={handleSaveCourse}
              disabled={saving}
            />
            {/* Publish toggle (switch, not button) — wired to the publish mutation. */}
            <span className="inline-flex items-center gap-2.5 rounded-[10px] border border-[#eceef3] px-3.5 py-2">
              <span className="text-[13px] font-bold text-[#4a4f60]">{t('courseEditor.publishToggleLabel')}</span>
              <Switch
                checked={course.is_published}
                onCheckedChange={handleTogglePublish}
                disabled={togglingPublish}
                aria-label={course.is_published ? t('courseEditor.unpublishAria') : t('courseEditor.publishAria')}
              />
            </span>
            <div className="flex-1" />
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(true)}
              className="border-[#f0c7c7] text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" /> {t('courseEditor.deleteCourse')}
            </Button>
          </div>
        </div>

        {/* Modules & Lessons */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-extrabold">{t('courseEditor.modulesAndLessons')}</h2>
          <Button
            onClick={openAddModule}
            className="bg-accent text-primary hover:bg-[#dfe5f8]"
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> {t('courseEditor.addModule')}
          </Button>
        </div>

        {modules.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#d6d8e0] bg-card p-12 text-center text-sm text-muted-foreground">
            {t('courseEditor.noModules')}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {modules.map((mod, modIndex) => (
              <div key={mod.id} className="overflow-hidden rounded-2xl border border-border bg-card">
                {/* Module header */}
                <div className="flex items-center gap-2.5 bg-[#f7f8fa] px-[18px] py-3">
                  <span className="flex text-[#c3c7d3]" aria-hidden="true">
                    <GripVertical className="h-[15px] w-[15px]" />
                  </span>
                  <span className="flex-1 text-[13.5px] font-extrabold">
                    {t('courseEditor.moduleLabel', { n: modIndex + 1, title: mod.title })}
                  </span>
                  <button
                    type="button"
                    onClick={() => openAddLesson(mod.id)}
                    className="rounded-[7px] px-2.5 py-1.5 text-xs font-bold text-primary transition-colors hover:bg-accent"
                  >
                    + {t('courseEditor.lessonShort')}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditModule(mod)}
                    title={t('courseEditor.renameModule')}
                    aria-label={t('courseEditor.renameModule')}
                    className="grid h-7 w-7 place-items-center rounded-[7px] text-[#9aa0af] transition-colors hover:bg-[#eceef3] hover:text-primary"
                  >
                    <Pencil className="h-[13px] w-[13px]" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteModule(mod.id)}
                    title={t('courseEditor.deleteModule')}
                    aria-label={t('courseEditor.deleteModule')}
                    className="grid h-7 w-7 place-items-center rounded-[7px] text-[#9aa0af] transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-[13px] w-[13px]" aria-hidden="true" />
                  </button>
                </div>

                {/* Lessons */}
                {mod.lessons && mod.lessons.length > 0 ? (
                  mod.lessons.map((lesson) => (
                    <div
                      key={lesson.id}
                      className="flex items-center gap-[11px] border-t border-[#f3f4f8] px-[18px] py-[11px]"
                    >
                      <span className="flex text-[#d6d8e0]" aria-hidden="true">
                        <GripVertical className="h-3.5 w-3.5" />
                      </span>
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                        {lessonTypeIcon(lesson.lesson_type)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{lesson.title}</span>
                      <span className="rounded-[7px] bg-[#f3f4f8] px-2.5 py-[3px] text-[11px] font-bold capitalize text-[#686d7e]">
                        {lessonTypeLabel(lesson.lesson_type)}
                      </span>
                      {lesson.duration_minutes ? (
                        <span className="min-w-[44px] text-[11.5px] text-[#9aa0af]">
                          {t('courseEditor.minutesShort', { count: lesson.duration_minutes })}
                        </span>
                      ) : (
                        <span className="min-w-[44px]" aria-hidden="true" />
                      )}
                      {lesson.lesson_type === 'quiz' && features.quizzes_enabled && (
                        <button
                          type="button"
                          onClick={() => {
                            setQuizLessonId(lesson.id);
                            setQuizLessonTitle(lesson.title);
                            setQuizEditorOpen(true);
                          }}
                          className="rounded-[7px] px-2 py-[5px] text-xs font-bold text-primary transition-colors hover:bg-accent"
                        >
                          {t('courseEditor.editQuiz')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditLesson(lesson)}
                        title={t('courseEditor.editLesson')}
                        aria-label={t('courseEditor.editLesson')}
                        className="grid h-7 w-7 place-items-center rounded-[7px] text-[#9aa0af] transition-colors hover:bg-[#f3f4f8] hover:text-primary"
                      >
                        <Pencil className="h-[13px] w-[13px]" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteLesson(lesson.id)}
                        title={t('courseEditor.deleteLesson')}
                        aria-label={t('courseEditor.deleteLesson')}
                        className="grid h-7 w-7 place-items-center rounded-[7px] text-[#9aa0af] transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-[13px] w-[13px]" aria-hidden="true" />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="border-t border-[#f3f4f8] px-[18px] py-[11px] text-sm text-muted-foreground">
                    {t('courseEditor.noLessons')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Course Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('courseEditor.deleteCourseTitle')}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">{t('courseEditor.deleteIntro', { title: course.title })}</span>
              <ul className="list-inside list-disc text-sm">
                <li>{t('courseEditor.deleteItemModules')}</li>
                <li>{t('courseEditor.deleteItemEnrollments')}</li>
                <li>{t('courseEditor.deleteItemQuizzes')}</li>
              </ul>
              <span className="block font-medium">{t('courseEditor.deleteIrreversible')}</span>
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
              {t('courseEditor.deleteCourse')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Module Dialog */}
      <Dialog open={moduleDialogOpen} onOpenChange={setModuleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingModule ? t('courseEditor.moduleDialogEditTitle') : t('courseEditor.moduleDialogAddTitle')}</DialogTitle>
            <DialogDescription>
              {editingModule ? t('courseEditor.moduleDialogEditDescription') : t('courseEditor.moduleDialogAddDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('courseEditor.moduleTitleLabel')}</Label>
              <Input value={moduleTitle} onChange={(e) => setModuleTitle(e.target.value)} placeholder={t('courseEditor.moduleTitlePlaceholder')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModuleDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSaveModule} disabled={savingModule}>
              {savingModule && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {editingModule ? t('courseEditor.update') : t('courseEditor.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lesson Dialog */}
      <Dialog open={lessonDialogOpen} onOpenChange={setLessonDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingLesson ? t('courseEditor.lessonDialogEditTitle') : t('courseEditor.lessonDialogAddTitle')}</DialogTitle>
            <DialogDescription>
              {editingLesson ? t('courseEditor.lessonDialogEditDescription') : t('courseEditor.lessonDialogAddDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('courseEditor.lessonTitleLabel')}</Label>
              <Input value={lessonTitle} onChange={(e) => setLessonTitle(e.target.value)} placeholder={t('courseEditor.lessonTitlePlaceholder')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('courseEditor.lessonTypeLabel')}</Label>
                <Select value={lessonType} onValueChange={(v) => setLessonType(v as LessonType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="video">{t('courseEditor.lessonTypeVideo')}</SelectItem>
                    <SelectItem value="document">{t('courseEditor.lessonTypeDocument')}</SelectItem>
                    {features.quizzes_enabled && <SelectItem value="quiz">{t('courseEditor.lessonTypeQuiz')}</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('courseEditor.lessonDurationLabel')}</Label>
                <Input
                  type="number"
                  value={lessonDuration ?? ''}
                  onChange={(e) => setLessonDuration(e.target.value ? parseInt(e.target.value) : null)}
                  placeholder={t('courseEditor.lessonDurationPlaceholder')}
                />
              </div>
            </div>
            {lessonType === 'document' && (
              <>
                <div className="space-y-2">
                  <Label>{t('courseEditor.documentFileLabel')}</Label>
                  <AzureDocumentUpload
                    value={lessonDocPath}
                    onChange={setLessonDocPath}
                    maxSizeMB={100}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('courseEditor.contentTextLabel')}</Label>
                  <Textarea
                    value={lessonContent}
                    onChange={(e) => setLessonContent(e.target.value)}
                    rows={5}
                    placeholder={t('courseEditor.contentTextPlaceholder')}
                  />
                </div>
              </>
            )}
            {lessonType === 'video' && (
              <>
                <div className="space-y-2">
                  <Label>{t('courseEditor.videoFileLabel')}</Label>
                  <AzureVideoUpload
                    value={lessonAzureBlobPath}
                    onChange={setLessonAzureBlobPath}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('courseEditor.videoFileHint')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>{t('courseEditor.contentTextLabel')}</Label>
                  <Textarea
                    value={lessonContent}
                    onChange={(e) => setLessonContent(e.target.value)}
                    rows={5}
                    placeholder={t('courseEditor.contentTextPlaceholder')}
                  />
                </div>
              </>
            )}
            {lessonType === 'quiz' && (
              <>
                <div className="rounded-xl border border-dashed border-[#d6d8e0] p-4 text-center">
                  <HelpCircle className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
                  <p className="mb-2 text-sm text-muted-foreground">
                    {editingLesson
                      ? t('courseEditor.quizSetupHintEdit')
                      : t('courseEditor.quizSetupHintCreate')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('courseEditor.quizSetupSubhint')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>{t('courseEditor.contentTextLabel')}</Label>
                  <Textarea
                    value={lessonContent}
                    onChange={(e) => setLessonContent(e.target.value)}
                    rows={5}
                    placeholder={t('courseEditor.quizContentPlaceholder')}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLessonDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSaveLesson} disabled={savingLesson}>
              {savingLesson && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {editingLesson ? t('courseEditor.update') : t('courseEditor.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quiz Editor Dialog — no onQuizSaved refetch: the structure response
          carries no quiz data, so a quiz save changes nothing on this page. */}
      {quizLessonId && (
        <QuizEditorDialog
          key={quizLessonId}
          lessonId={quizLessonId}
          lessonTitle={quizLessonTitle}
          open={quizEditorOpen}
          onOpenChange={setQuizEditorOpen}
        />
      )}

    </AppLayout>
  );
}
