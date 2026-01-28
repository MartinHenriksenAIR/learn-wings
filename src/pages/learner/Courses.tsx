import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Course, Enrollment } from '@/lib/types';
import { BookOpen, Search, Play, Clock, CheckCircle2, Loader2, MoreVertical, LogOut } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function LearnerCourses() {
  const { user, currentOrg } = useAuth();
  const { toast } = useToast();
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [unenrollDialog, setUnenrollDialog] = useState<{ open: boolean; course: Course | null; enrollment: Enrollment | null }>({
    open: false,
    course: null,
    enrollment: null,
  });
  const [unenrolling, setUnenrolling] = useState(false);

  const fetchData = async () => {
    if (!user || !currentOrg) {
      setLoading(false);
      return;
    }

    // Fetch accessible courses for this org
    const { data: accessData } = await supabase
      .from('org_course_access')
      .select('course_id')
      .eq('org_id', currentOrg.id)
      .eq('access', 'enabled');

    if (accessData && accessData.length > 0) {
      const courseIds = accessData.map(a => a.course_id);
      
      const { data: coursesData } = await supabase
        .from('courses')
        .select('*')
        .in('id', courseIds)
        .eq('is_published', true);

      if (coursesData) {
        setCourses(coursesData as Course[]);
      }
    }

    // Fetch user's enrollments
    const { data: enrollmentData } = await supabase
      .from('enrollments')
      .select('*')
      .eq('user_id', user.id)
      .eq('org_id', currentOrg.id);

    if (enrollmentData) {
      setEnrollments(enrollmentData as Enrollment[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [user, currentOrg]);

  const handleEnroll = async (courseId: string) => {
    if (!user || !currentOrg) return;

    setEnrolling(courseId);

    const { error } = await supabase.from('enrollments').insert({
      org_id: currentOrg.id,
      user_id: user.id,
      course_id: courseId,
      status: 'enrolled',
    });

    if (error) {
      toast({
        title: 'Enrollment failed',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Enrolled successfully!',
        description: 'You can now start learning.',
      });
      fetchData();
    }

    setEnrolling(null);
  };

  const handleUnenroll = async () => {
    if (!unenrollDialog.enrollment) return;

    setUnenrolling(true);

    const { error } = await supabase
      .from('enrollments')
      .delete()
      .eq('id', unenrollDialog.enrollment.id);

    if (error) {
      toast({
        title: 'Failed to unenroll',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Unenrolled from course',
        description: `You've been unenrolled from "${unenrollDialog.course?.title}". Your progress has been removed.`,
      });
      fetchData();
    }

    setUnenrolling(false);
    setUnenrollDialog({ open: false, course: null, enrollment: null });
  };

  const getEnrollmentStatus = (courseId: string) => {
    return enrollments.find(e => e.course_id === courseId);
  };

  const filteredCourses = courses.filter(course =>
    course.title.toLowerCase().includes(search.toLowerCase()) ||
    course.description?.toLowerCase().includes(search.toLowerCase())
  );

  const levelColors = {
    basic: 'bg-green-100 text-green-800',
    intermediate: 'bg-yellow-100 text-yellow-800',
    advanced: 'bg-red-100 text-red-800',
  };

  if (loading) {
    return (
      <AppLayout title="Course Catalog" breadcrumbs={[{ label: 'Courses' }]}>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout title="Course Catalog" breadcrumbs={[{ label: 'Courses' }]}>
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">No organization selected.</p>
          <p className="text-sm text-muted-foreground">Join an organization to access courses.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Course Catalog" breadcrumbs={[{ label: 'Courses' }]}>
      {/* Search */}
      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search courses..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {filteredCourses.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title="No courses available"
          description={
            search
              ? 'No courses match your search. Try a different term.'
              : 'There are no courses available for your organization yet.'
          }
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredCourses.map((course) => {
            const enrollment = getEnrollmentStatus(course.id);

            return (
              <Card key={course.id} className="overflow-hidden transition-shadow hover:shadow-card-hover">
                <div className="aspect-video bg-gradient-to-br from-primary/80 to-primary relative">
                  {enrollment?.status === 'completed' && (
                    <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-success px-2 py-1 text-xs font-medium text-success-foreground">
                      <CheckCircle2 className="h-3 w-3" />
                      Completed
                    </div>
                  )}
                  {enrollment && enrollment.status !== 'completed' && (
                    <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-accent px-2 py-1 text-xs font-medium text-accent-foreground">
                      Enrolled
                    </div>
                  )}
                </div>
                <CardContent className="p-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <h3 className="font-display font-semibold leading-tight">
                      {course.title}
                    </h3>
                    <div className="flex items-center gap-1">
                      <Badge className={levelColors[course.level]}>
                        {course.level}
                      </Badge>
                      {enrollment && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => setUnenrollDialog({ open: true, course, enrollment })}
                              className="text-destructive focus:text-destructive"
                            >
                              <LogOut className="mr-2 h-4 w-4" />
                              Unenroll from course
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                  <p className="mb-4 text-sm text-muted-foreground line-clamp-2">
                    {course.description}
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>Self-paced</span>
                    </div>
                    
                    {enrollment ? (
                      <Link to={`/app/learn/${course.id}`}>
                        <Button size="sm">
                          <Play className="mr-1 h-3 w-3" />
                          {enrollment.status === 'completed' ? 'Review' : 'Continue'}
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleEnroll(course.id)}
                        disabled={enrolling === course.id}
                      >
                        {enrolling === course.id ? (
                          <>
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            Enrolling...
                          </>
                        ) : (
                          'Enroll'
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Unenroll Confirmation Dialog */}
      <AlertDialog
        open={unenrollDialog.open}
        onOpenChange={(open) => !open && setUnenrollDialog({ open: false, course: null, enrollment: null })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unenroll from course?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to unenroll from <strong>"{unenrollDialog.course?.title}"</strong>? 
              This will remove all your progress and you'll need to re-enroll to access the course again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unenrolling}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnenroll}
              disabled={unenrolling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {unenrolling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Unenrolling...
                </>
              ) : (
                'Unenroll'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
