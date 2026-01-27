import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Course, CourseLevel } from '@/lib/types';
import { BookOpen, Plus, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function CoursesManager() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState<CourseLevel>('basic');
  const [creating, setCreating] = useState(false);

  const fetchCourses = async () => {
    const { data } = await supabase.from('courses').select('*').order('created_at', { ascending: false });
    if (data) setCourses(data as Course[]);
    setLoading(false);
  };

  useEffect(() => { fetchCourses(); }, []);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    const { error } = await supabase.from('courses').insert({
      title, description, level, created_by_user_id: user?.id, is_published: false,
    });
    if (error) {
      toast({ title: 'Failed to create course', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Course created!' });
      setCreateOpen(false); setTitle(''); setDescription(''); setLevel('basic');
      fetchCourses();
    }
    setCreating(false);
  };

  const togglePublish = async (course: Course) => {
    await supabase.from('courses').update({ is_published: !course.is_published }).eq('id', course.id);
    fetchCourses();
  };

  const levelColors = { basic: 'bg-green-100 text-green-800', intermediate: 'bg-yellow-100 text-yellow-800', advanced: 'bg-red-100 text-red-800' };

  if (loading) return <AppLayout title="Courses"><div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div></AppLayout>;

  return (
    <AppLayout title="Course Manager" breadcrumbs={[{ label: 'Courses' }]}>
      <div className="mb-6 flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Create Course</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Course</DialogTitle><DialogDescription>Add a new course to the platform.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Course title" /></div>
              <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Course description" /></div>
              <div className="space-y-2"><Label>Level</Label>
                <Select value={level} onValueChange={(v) => setLevel(v as CourseLevel)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="basic">Basic</SelectItem><SelectItem value="intermediate">Intermediate</SelectItem><SelectItem value="advanced">Advanced</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={handleCreate} disabled={creating}>{creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {courses.length === 0 ? (
        <EmptyState icon={<BookOpen className="h-6 w-6" />} title="No courses yet" description="Create your first course." action={<Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Create Course</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <Card
              key={course.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => navigate(`/app/admin/courses/${course.id}`)}
            >
              <div className="aspect-video bg-gradient-to-br from-primary/80 to-primary" />
              <CardContent className="p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="font-display font-semibold">{course.title}</h3>
                  <Badge className={levelColors[course.level]}>{course.level}</Badge>
                </div>
                <p className="mb-4 text-sm text-muted-foreground line-clamp-2">{course.description}</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Switch checked={course.is_published} onCheckedChange={() => togglePublish(course)} />
                    <span className="text-sm">{course.is_published ? 'Published' : 'Draft'}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
