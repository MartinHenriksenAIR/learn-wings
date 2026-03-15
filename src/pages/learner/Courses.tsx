import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SearchFilter, FilterConfig } from '@/components/ui/search-filter';
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
import { Course, Enrollment, CourseLevel } from '@/lib/types';
import { BookOpen, Play, Clock, CheckCircle2, Loader2, MoreVertical, LogOut } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function LearnerCourses() {
  const { user, currentOrg } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
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
        title: t('courses.enrollmentFailed'),
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: t('courses.enrolledSuccessfully'),
        description: t('courses.startLearningNow'),
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
        title: t('courses.unenrollFailed'),
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: t('courses.unenrolledFromCourse'),
        description: t('courses.unenrolledDescription', { courseTitle: unenrollDialog.course?.title }),
      });
      fetchData();
    }

    setUnenrolling(false);
    setUnenrollDialog({ open: false, course: null, enrollment: null });
  };

  const getEnrollmentStatus = (courseId: string) => {
    return enrollments.find(e => e.course_id === courseId);
  };

  const courseFilters: FilterConfig[] = [
    {
      key: 'level',
      label: t('courses.level'),
      options: [
        { value: 'basic', label: t('courses.levels.basic') },
        { value: 'intermediate', label: t('courses.levels.intermediate') },
        { value: 'advanced', label: t('courses.levels.advanced') },
      ],
    },
    {
      key: 'status',
      label: t('courses.status'),
      options: [
        { value: 'enrolled', label: t('courses.statusOptions.enrolled') },
        { value: 'completed', label: t('courses.statusOptions.completed') },
        { value: 'not_enrolled', label: t('courses.statusOptions.notEnrolled') },
      ],
    },
  ];

  const filterValues = { level: levelFilter, status: statusFilter };

  const handleFilterChange = (key: string, value: string) => {
    if (key === 'level') setLevelFilter(value);
    if (key === 'status') setStatusFilter(value);
  };

  const clearFilters = () => {
    setSearch('');
    setLevelFilter('all');
    setStatusFilter('all');
  };

  const filteredCourses = courses.filter(course => {
    // Search filter
    const matchesSearch = search === '' ||
      course.title.toLowerCase().includes(search.toLowerCase()) ||
      course.description?.toLowerCase().includes(search.toLowerCase());

    // Level filter
    const matchesLevel = levelFilter === 'all' || course.level === levelFilter;

    // Status filter
    const enrollment = getEnrollmentStatus(course.id);
    let matchesStatus = true;
    if (statusFilter === 'enrolled') {
      matchesStatus = !!enrollment && enrollment.status !== 'completed';
    } else if (statusFilter === 'completed') {
      matchesStatus = enrollment?.status === 'completed';
    } else if (statusFilter === 'not_enrolled') {
      matchesStatus = !enrollment;
    }

    return matchesSearch && matchesLevel && matchesStatus;
  });

  const levelColors = {
    basic: 'bg-green-100 text-green-800',
    intermediate: 'bg-yellow-100 text-yellow-800',
    advanced: 'bg-red-100 text-red-800',
  };

  if (loading) {
    return (
      <AppLayout title={t('courses.title')} breadcrumbs={[{ label: t('nav.courses') }]}>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout title={t('courses.title')} breadcrumbs={[{ label: t('nav.courses') }]}>
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">{t('common.noOrgSelected')}</p>
          <p className="text-sm text-muted-foreground">{t('courses.joinOrgToAccessCourses')}</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={t('courses.title')} breadcrumbs={[{ label: t('nav.courses') }]}>
      {/* Search and Filters */}
      <div className="mb-6">
        <SearchFilter
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('courses.searchPlaceholder')}
          filters={courseFilters}
          filterValues={filterValues}
          onFilterChange={handleFilterChange}
          onClearFilters={clearFilters}
        />
      </div>

      {filteredCourses.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title={t('courses.noCoursesAvailable')}
          description={
            search
              ? t('courses.noCoursesMatch')
              : t('courses.noCoursesForOrg')
          }
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredCourses.map((course) => {
            const enrollment = getEnrollmentStatus(course.id);

            return (
              <Card key={course.id} className="overflow-hidden transition-shadow hover:shadow-card-hover">
                <div className="aspect-video bg-gradient-to-br from-primary/80 to-primary relative overflow-hidden">
                  {course.thumbnail_url && (
                    <img
                      src={course.thumbnail_url}
                      alt={course.title}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                  {enrollment?.status === 'completed' && (
                    <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-success px-2 py-1 text-xs font-medium text-success-foreground">
                      <CheckCircle2 className="h-3 w-3" />
                      {t('dashboard.completed')}
                    </div>
                  )}
                  {enrollment && enrollment.status !== 'completed' && (
                    <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-accent px-2 py-1 text-xs font-medium text-accent-foreground">
                      {t('common.enrolled')}
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
                              {t('courses.unenrollFromCourse')}
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
                      <span>{t('common.selfPaced')}</span>
                    </div>
                    
                    {enrollment ? (
                      <Link to={`/app/learn/${course.id}`}>
                        <Button size="sm">
                          <Play className="mr-1 h-3 w-3" />
                          {enrollment.status === 'completed' ? t('common.review') : t('common.continue')}
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
                            {t('common.enrolling')}
                          </>
                        ) : (
                          t('common.enroll')
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
            <AlertDialogTitle>{t('courses.unenrollConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('courses.unenrollConfirmDescription', { courseTitle: unenrollDialog.course?.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unenrolling}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnenroll}
              disabled={unenrolling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {unenrolling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('common.unenrolling')}
                </>
              ) : (
                t('common.unenroll')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
