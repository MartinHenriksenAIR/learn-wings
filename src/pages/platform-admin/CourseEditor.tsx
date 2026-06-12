import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { FileUpload } from '@/components/ui/file-upload';
import { AzureVideoUpload } from '@/components/ui/azure-video-upload';
import { AzureDocumentUpload } from '@/components/ui/azure-document-upload';
import { QuizEditorDialog } from '@/components/platform-admin/QuizEditorDialog';

import { callApi } from '@/lib/api-client';
import { extractLmsAssetPath, getSignedLmsAssetUrl } from '@/lib/storage';
import { Course, CourseModule, Lesson, CourseLevel, LessonType } from '@/lib/types';
import { ArrowLeft, Plus, Loader2, GripVertical, Trash2, Video, FileText, HelpCircle, Save, Pencil, Settings } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { useToastMutation } from '@/hooks/useToastMutation';
import { coursesAdminQueryKey } from './CoursesManager';

/** Cache key for one course's full admin structure (course + modules + lessons). */
const courseStructureQueryKey = (courseId: string) => ['course-structure-admin', courseId] as const;

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
  const queryClient = useQueryClient();
  const { features } = usePlatformSettings();

  // Course edit state
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLevel, setEditLevel] = useState<CourseLevel>('basic');
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
      toast({ title: 'Failed to load course', description: loadError.message, variant: 'destructive' });
    }
  }, [loadError]);

  // Seed the editable course fields whenever the server row changes (initial
  // load + post-save refetch). Module/lesson cache patches keep the same
  // `course` reference, so they do NOT re-seed (and can't clobber) these fields.
  useEffect(() => {
    if (course) {
      setEditTitle(course.title);
      setEditDescription(course.description || '');
      setEditLevel(course.level);
      setEditThumbnailUrl(signedThumbnailUrl);
    }
  }, [course, signedThumbnailUrl]);

  const saveCourseMutation = useToastMutation({
    mutationFn: (updates: { title: string; description: string; level: CourseLevel; thumbnailUrl: string | null }) =>
      callApi<{ course: Course }>('/api/course-update', { courseId, updates }),
    errorTitle: 'Failed to save course',
    onSuccess: () => {
      toast({ title: 'Course saved!' });
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
      thumbnailUrl: thumbnailToPersist,
    });
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
      toast({ title: moduleId ? 'Module updated!' : 'Module created!' });
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
        toast({ title: 'Module deleted', description: `Could not delete ${result.blobsFailed} video file(s) from storage.`, variant: 'destructive' });
      } else {
        toast({ title: 'Module deleted' });
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
      toast({ title: lessonId ? 'Lesson updated!' : 'Lesson created!' });
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
        toast({ title: 'Lesson deleted', description: 'Could not delete the video file from storage.', variant: 'destructive' });
      } else {
        toast({ title: 'Lesson deleted' });
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
        toast({ title: 'Course deleted', description: `Could not delete ${result.blobsFailed} video file(s) from storage.`, variant: 'destructive' });
      } else {
        toast({ title: 'Course deleted' });
      }
      // The cached admin list still holds the deleted course; drop it so the
      // list page does a fresh load instead of flashing the deleted row.
      queryClient.removeQueries({ queryKey: coursesAdminQueryKey });
      navigate('/app/admin/courses');
    },
  });
  const deleting = deleteCourseMutation.isPending;

  const handleDeleteCourse = () => {
    if (!courseId) return;
    deleteCourseMutation.mutate();
  };

  const lessonTypeIcon = (type: LessonType) => {
    switch (type) {
      case 'video': return <Video className="h-4 w-4" />;
      case 'document': return <FileText className="h-4 w-4" />;
      case 'quiz': return <HelpCircle className="h-4 w-4" />;
    }
  };

  const levelColors = { basic: 'bg-green-100 text-green-800', intermediate: 'bg-yellow-100 text-yellow-800', advanced: 'bg-red-100 text-red-800' };


  if (loading) {
    return (
      <AppLayout title="Course Editor">
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!loading && loadError) {
    return (
      <AppLayout title="Course Editor">
        <div className="flex h-64 flex-col items-center justify-center gap-4 text-center">
          <p className="text-destructive font-medium">Failed to load course</p>
          <p className="text-sm text-muted-foreground">{loadError.message}</p>
          {/* While the retry is in flight with no cached data, isLoading goes
              true and the spinner branch above takes over. */}
          <Button variant="outline" onClick={() => refetchStructure()}>
            Retry
          </Button>
        </div>
      </AppLayout>
    );
  }

  if (!course) {
    return (
      <AppLayout title="Course Editor">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Course not found</p>
          <Button variant="outline" onClick={() => navigate('/app/admin/courses')} className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Courses
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Course Editor"
      breadcrumbs={[{ label: 'Courses', href: '/app/admin/courses' }, { label: course.title }]}
    >
      <div className="mb-4">
        <Button variant="ghost" onClick={() => navigate('/app/admin/courses')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Courses
        </Button>
      </div>

      {/* Course Details Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Course Details</span>
            <Badge className={levelColors[course.level]}>{course.level}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Thumbnail</Label>
            <FileUpload
              bucket="lms-assets"
              folder="thumbnails"
              accept="image"
              value={editThumbnailUrl}
              onChange={(url) => setEditThumbnailUrl(url)}
              maxSizeMB={10}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Level</Label>
              <Select value={editLevel} onValueChange={(v) => setEditLevel(v as CourseLevel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="basic">Basic</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete Course
            </Button>
            <Button onClick={handleSaveCourse} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-2 h-4 w-4" /> Save Course
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delete Course Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Course?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This will permanently delete <strong>"{course.title}"</strong> and all associated data including:
              </p>
              <ul className="list-disc list-inside text-sm">
                <li>All modules and lessons</li>
                <li>All learner enrollments and progress</li>
                <li>All quiz attempts and reviews</li>
              </ul>
              <p className="font-medium">This action cannot be undone.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCourse}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Course
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modules & Lessons */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Modules & Lessons</span>
            <Button size="sm" onClick={openAddModule}>
              <Plus className="mr-2 h-4 w-4" /> Add Module
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {modules.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No modules yet. Add your first module to get started.</p>
          ) : (
            <Accordion type="multiple" className="w-full">
              {modules.map((mod, modIndex) => (
                <AccordionItem key={mod.id} value={mod.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 flex-1">
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">Module {modIndex + 1}: {mod.title}</span>
                      <Badge variant="outline" className="ml-2">{mod.lessons?.length || 0} lessons</Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pl-8">
                    <div className="flex items-center gap-2 mb-4">
                      <Button size="sm" variant="outline" onClick={() => openEditModule(mod)}>
                        <Pencil className="mr-1 h-3 w-3" /> Edit Module
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openAddLesson(mod.id)}>
                        <Plus className="mr-1 h-3 w-3" /> Add Lesson
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDeleteModule(mod.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {mod.lessons && mod.lessons.length > 0 ? (
                      <div className="space-y-2">
                        {mod.lessons.map((lesson, lessonIndex) => (
                          <div key={lesson.id} className="flex items-center gap-3 p-3 border rounded-md bg-muted/30">
                            <GripVertical className="h-4 w-4 text-muted-foreground" />
                            <div className="flex items-center gap-2 flex-1">
                              {lessonTypeIcon(lesson.lesson_type)}
                              <span className="text-sm">{lessonIndex + 1}. {lesson.title}</span>
                              <Badge variant="secondary" className="text-xs">{lesson.lesson_type}</Badge>
                              {lesson.duration_minutes && (
                                <span className="text-xs text-muted-foreground">{lesson.duration_minutes} min</span>
                              )}
                            </div>
                            {lesson.lesson_type === 'quiz' && features.quizzes_enabled && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setQuizLessonId(lesson.id);
                                  setQuizLessonTitle(lesson.title);
                                  setQuizEditorOpen(true);
                                }}
                              >
                                <Settings className="mr-1 h-3 w-3" />
                                Edit Quiz
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" onClick={() => openEditLesson(lesson)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDeleteLesson(lesson.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No lessons in this module.</p>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      {/* Module Dialog */}
      <Dialog open={moduleDialogOpen} onOpenChange={setModuleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingModule ? 'Edit Module' : 'Add Module'}</DialogTitle>
            <DialogDescription>
              {editingModule ? 'Update the module title.' : 'Create a new module for this course.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Module Title</Label>
              <Input value={moduleTitle} onChange={(e) => setModuleTitle(e.target.value)} placeholder="e.g., Introduction" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModuleDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveModule} disabled={savingModule}>
              {savingModule && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingModule ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lesson Dialog */}
      <Dialog open={lessonDialogOpen} onOpenChange={setLessonDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingLesson ? 'Edit Lesson' : 'Add Lesson'}</DialogTitle>
            <DialogDescription>
              {editingLesson ? 'Update the lesson details.' : 'Add a new lesson to this module.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Lesson Title</Label>
              <Input value={lessonTitle} onChange={(e) => setLessonTitle(e.target.value)} placeholder="e.g., Getting Started" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={lessonType} onValueChange={(v) => setLessonType(v as LessonType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="video">Video</SelectItem>
                    <SelectItem value="document">Document</SelectItem>
                    {features.quizzes_enabled && <SelectItem value="quiz">Quiz</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Duration (minutes)</Label>
                <Input
                  type="number"
                  value={lessonDuration ?? ''}
                  onChange={(e) => setLessonDuration(e.target.value ? parseInt(e.target.value) : null)}
                  placeholder="e.g., 15"
                />
              </div>
            </div>
            {lessonType === 'document' && (
              <>
                <div className="space-y-2">
                  <Label>Document File (optional)</Label>
                  <AzureDocumentUpload
                    value={lessonDocPath}
                    onChange={setLessonDocPath}
                    maxSizeMB={100}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Content Text (optional)</Label>
                  <Textarea
                    value={lessonContent}
                    onChange={(e) => setLessonContent(e.target.value)}
                    rows={5}
                    placeholder="Additional lesson content or description..."
                  />
                </div>
              </>
            )}
            {lessonType === 'video' && (
              <>
                <div className="space-y-2">
                  <Label>Video File (Azure Cloud)</Label>
                  <AzureVideoUpload
                    value={lessonAzureBlobPath}
                    onChange={setLessonAzureBlobPath}
                  />
                  <p className="text-xs text-muted-foreground">
                    Ingen filstørrelses-begrænsning. Videoer uploades direkte til Azure Cloud Storage.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Content Text (optional)</Label>
                  <Textarea
                    value={lessonContent}
                    onChange={(e) => setLessonContent(e.target.value)}
                    rows={5}
                    placeholder="Additional lesson content or description..."
                  />
                </div>
              </>
            )}
            {lessonType === 'quiz' && (
              <>
                <div className="rounded-lg border border-dashed p-4 text-center">
                  <HelpCircle className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground mb-2">
                    {editingLesson
                      ? 'Save the lesson first, then use "Edit Quiz" to configure questions.'
                      : 'Create the lesson first, then configure the quiz questions.'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Learners will need to pass the quiz to complete this lesson.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Content Text (optional)</Label>
                  <Textarea
                    value={lessonContent}
                    onChange={(e) => setLessonContent(e.target.value)}
                    rows={5}
                    placeholder="Quiz instructions or additional context..."
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLessonDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveLesson} disabled={savingLesson}>
              {savingLesson && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingLesson ? 'Update' : 'Create'}
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
