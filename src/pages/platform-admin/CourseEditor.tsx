import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { supabase } from '@/integrations/supabase/client';
import { Course, CourseModule, Lesson, CourseLevel, LessonType } from '@/lib/types';
import { isSharePointUrl, validateSharePointUrl } from '@/lib/sharepoint';
import { ArrowLeft, Plus, Loader2, GripVertical, Trash2, Video, FileText, HelpCircle, Save, Pencil, Link } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';

export default function CourseEditor() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { features } = usePlatformSettings();

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<CourseModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Course edit state
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLevel, setEditLevel] = useState<CourseLevel>('basic');
  const [editThumbnailUrl, setEditThumbnailUrl] = useState<string | null>(null);

  // Module dialog state
  const [moduleDialogOpen, setModuleDialogOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<CourseModule | null>(null);
  const [moduleTitle, setModuleTitle] = useState('');
  const [savingModule, setSavingModule] = useState(false);

  // Lesson dialog state
  const [lessonDialogOpen, setLessonDialogOpen] = useState(false);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [lessonModuleId, setLessonModuleId] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonType, setLessonType] = useState<LessonType>('document');
  const [lessonContent, setLessonContent] = useState('');
  const [lessonDuration, setLessonDuration] = useState<number | null>(null);
  const [lessonVideoPath, setLessonVideoPath] = useState<string | null>(null);
  const [lessonVideoUrl, setLessonVideoUrl] = useState<string | null>(null);
  const [lessonVideoSource, setLessonVideoSource] = useState<'upload' | 'sharepoint'>('upload');
  const [lessonDocPath, setLessonDocPath] = useState<string | null>(null);
  const [savingLesson, setSavingLesson] = useState(false);

  // Delete course state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchCourse = async () => {
    if (!courseId) return;
    const { data } = await supabase.from('courses').select('*').eq('id', courseId).maybeSingle();
    if (data) {
      setCourse(data as Course);
      setEditTitle(data.title);
      setEditDescription(data.description || '');
      setEditLevel(data.level as CourseLevel);
      setEditThumbnailUrl(data.thumbnail_url || null);
    }
  };

  const fetchModules = async () => {
    if (!courseId) return;
    const { data: modulesData } = await supabase
      .from('course_modules')
      .select('*')
      .eq('course_id', courseId)
      .order('sort_order');

    if (modulesData) {
      // Fetch lessons for each module
      const modulesWithLessons = await Promise.all(
        modulesData.map(async (mod) => {
          const { data: lessonsData } = await supabase
            .from('lessons')
            .select('*')
            .eq('module_id', mod.id)
            .order('sort_order');
          return { ...mod, lessons: lessonsData || [] } as CourseModule;
        })
      );
      setModules(modulesWithLessons);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCourse();
    fetchModules();
  }, [courseId]);

  const handleSaveCourse = async () => {
    if (!courseId || !editTitle.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from('courses')
      .update({ title: editTitle, description: editDescription, level: editLevel, thumbnail_url: editThumbnailUrl })
      .eq('id', courseId);
    if (error) {
      toast({ title: 'Failed to save course', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Course saved!' });
      fetchCourse();
    }
    setSaving(false);
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

  const handleSaveModule = async () => {
    if (!courseId || !moduleTitle.trim()) return;
    setSavingModule(true);

    if (editingModule) {
      const { error } = await supabase.from('course_modules').update({ title: moduleTitle }).eq('id', editingModule.id);
      if (error) toast({ title: 'Failed to update module', description: error.message, variant: 'destructive' });
      else toast({ title: 'Module updated!' });
    } else {
      const nextOrder = modules.length;
      const { error } = await supabase.from('course_modules').insert({ course_id: courseId, title: moduleTitle, sort_order: nextOrder });
      if (error) toast({ title: 'Failed to create module', description: error.message, variant: 'destructive' });
      else toast({ title: 'Module created!' });
    }

    setModuleDialogOpen(false);
    fetchModules();
    setSavingModule(false);
  };

  const handleDeleteModule = async (modId: string) => {
    const { error } = await supabase.from('course_modules').delete().eq('id', modId);
    if (error) toast({ title: 'Failed to delete module', description: error.message, variant: 'destructive' });
    else {
      toast({ title: 'Module deleted' });
      fetchModules();
    }
  };

  // Lesson handlers
  const openAddLesson = (moduleId: string) => {
    setEditingLesson(null);
    setLessonModuleId(moduleId);
    setLessonTitle('');
    setLessonType('document');
    setLessonContent('');
    setLessonDuration(null);
    setLessonVideoPath(null);
    setLessonVideoUrl(null);
    setLessonVideoSource('upload');
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
    setLessonVideoUrl(lesson.video_url || null);
    setLessonVideoSource(lesson.video_url ? 'sharepoint' : 'upload');
    setLessonDocPath(lesson.document_storage_path || null);
    setLessonDialogOpen(true);
  };

  const handleSaveLesson = async () => {
    if (!lessonModuleId || !lessonTitle.trim()) return;
    
    // Validate SharePoint URL if using that source
    if (lessonType === 'video' && lessonVideoSource === 'sharepoint' && lessonVideoUrl) {
      const validation = validateSharePointUrl(lessonVideoUrl);
      if (!validation.valid) {
        toast({ title: 'Invalid SharePoint URL', description: validation.error, variant: 'destructive' });
        return;
      }
    }
    
    setSavingLesson(true);

    const lessonData = {
      module_id: lessonModuleId,
      title: lessonTitle,
      lesson_type: lessonType,
      content_text: lessonContent || null,
      duration_minutes: lessonDuration,
      video_storage_path: lessonType === 'video' && lessonVideoSource === 'upload' ? lessonVideoPath : null,
      video_url: lessonType === 'video' && lessonVideoSource === 'sharepoint' ? lessonVideoUrl : null,
      document_storage_path: lessonType === 'document' ? lessonDocPath : null,
    };

    if (editingLesson) {
      const { error } = await supabase.from('lessons').update(lessonData).eq('id', editingLesson.id);
      if (error) toast({ title: 'Failed to update lesson', description: error.message, variant: 'destructive' });
      else toast({ title: 'Lesson updated!' });
    } else {
      const mod = modules.find((m) => m.id === lessonModuleId);
      const nextOrder = mod?.lessons?.length || 0;
      const { error } = await supabase.from('lessons').insert({ ...lessonData, sort_order: nextOrder });
      if (error) toast({ title: 'Failed to create lesson', description: error.message, variant: 'destructive' });
      else toast({ title: 'Lesson created!' });
    }

    setLessonDialogOpen(false);
    fetchModules();
    setSavingLesson(false);
  };

  const handleDeleteLesson = async (lessonId: string) => {
    const { error } = await supabase.from('lessons').delete().eq('id', lessonId);
    if (error) toast({ title: 'Failed to delete lesson', description: error.message, variant: 'destructive' });
    else {
      toast({ title: 'Lesson deleted' });
      fetchModules();
    }
  };

  const handleDeleteCourse = async () => {
    if (!courseId) return;
    setDeleting(true);
    const { error } = await supabase.from('courses').delete().eq('id', courseId);
    if (error) {
      toast({ title: 'Failed to delete course', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Course deleted' });
      navigate('/app/admin/courses');
    }
    setDeleting(false);
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
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
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
        <DialogContent className="max-w-lg">
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
                  <FileUpload
                    bucket="lms-assets"
                    folder="documents"
                    accept="document"
                    value={lessonDocPath ? `Document uploaded` : null}
                    onChange={(_, path) => setLessonDocPath(path)}
                    maxSizeMB={50}
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
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Video Source</Label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="videoSource"
                        checked={lessonVideoSource === 'upload'}
                        onChange={() => setLessonVideoSource('upload')}
                        className="h-4 w-4"
                      />
                      <span className="text-sm">Upload Video</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="videoSource"
                        checked={lessonVideoSource === 'sharepoint'}
                        onChange={() => setLessonVideoSource('sharepoint')}
                        className="h-4 w-4"
                      />
                      <span className="text-sm flex items-center gap-1">
                        <Link className="h-3 w-3" />
                        SharePoint URL
                      </span>
                    </label>
                  </div>
                </div>
                
                {lessonVideoSource === 'upload' ? (
                  <div className="space-y-2">
                    <Label>Video File</Label>
                    <FileUpload
                      bucket="lms-assets"
                      folder="videos"
                      accept="video"
                      value={lessonVideoPath ? `Video uploaded` : null}
                      onChange={(_, path) => setLessonVideoPath(path)}
                      maxSizeMB={500}
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>SharePoint Embed URL</Label>
                    <Input
                      value={lessonVideoUrl || ''}
                      onChange={(e) => setLessonVideoUrl(e.target.value || null)}
                      placeholder="https://yourcompany.sharepoint.com/.../embed.aspx?..."
                    />
                    <p className="text-xs text-muted-foreground">
                      <strong>Important:</strong> Use SharePoint's <strong>Embed</strong> option (not Share). 
                      Right-click the video → "Embed" → Copy the URL from the iframe code.
                    </p>
                  </div>
                )}
              </div>
            )}
            {lessonType === 'quiz' && (
              <p className="text-sm text-muted-foreground">Quiz editor will be available in a future update.</p>
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
    </AppLayout>
  );
}
