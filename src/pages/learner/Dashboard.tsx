import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { StatCard } from '@/components/ui/stat-card';
import { ProgressRing } from '@/components/ui/progress-ring';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Enrollment, Course, LessonProgress } from '@/lib/types';
import { BookOpen, Clock, Award, Play, ArrowRight, Loader2 } from 'lucide-react';

export default function LearnerDashboard() {
  const { user, currentOrg } = useAuth();
  const [enrollments, setEnrollments] = useState<(Enrollment & { course: Course })[]>([]);
  const [progressData, setProgressData] = useState<Record<string, { total: number; completed: number }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!user || !currentOrg) {
        // Don't set loading to false if user exists but currentOrg isn't loaded yet
        if (!user) {
          setLoading(false);
        }
        return;
      }

      // Fetch enrollments with courses
      const { data: enrollmentData } = await supabase
        .from('enrollments')
        .select('*, course:courses(*)')
        .eq('user_id', user.id)
        .eq('org_id', currentOrg.id);

      if (enrollmentData) {
        setEnrollments(enrollmentData as any);

        // Fetch progress for each course
        const progressMap: Record<string, { total: number; completed: number }> = {};
        
        for (const enrollment of enrollmentData) {
          // Get total lessons for the course
          const { data: modules } = await supabase
            .from('course_modules')
            .select('id')
            .eq('course_id', enrollment.course_id);

          if (modules) {
            const moduleIds = modules.map(m => m.id);
            const { count: totalLessons } = await supabase
              .from('lessons')
              .select('*', { count: 'exact', head: true })
              .in('module_id', moduleIds);

            const { count: completedLessons } = await supabase
              .from('lesson_progress')
              .select('*', { count: 'exact', head: true })
              .eq('user_id', user.id)
              .eq('org_id', currentOrg.id)
              .eq('status', 'completed')
              .in('lesson_id', (await supabase
                .from('lessons')
                .select('id')
                .in('module_id', moduleIds)).data?.map(l => l.id) || []);

            progressMap[enrollment.course_id] = {
              total: totalLessons || 0,
              completed: completedLessons || 0,
            };
          }
        }
        setProgressData(progressMap);
      }

      setLoading(false);
    };

    fetchData();
  }, [user, currentOrg]);

  const inProgressCourses = enrollments.filter(e => e.status === 'enrolled');
  const completedCourses = enrollments.filter(e => e.status === 'completed');
  const totalProgress = enrollments.length > 0
    ? (completedCourses.length / enrollments.length) * 100
    : 0;

  if (loading) {
    return (
      <AppLayout title="Dashboard">
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout title="Dashboard">
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">No organization selected.</p>
          <p className="text-sm text-muted-foreground">Join an organization to access your courses.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="My Dashboard">
      {/* Stats Grid */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Courses Enrolled"
          value={enrollments.length}
          icon={<BookOpen className="h-5 w-5" />}
        />
        <StatCard
          title="In Progress"
          value={inProgressCourses.length}
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          title="Completed"
          value={completedCourses.length}
          icon={<Award className="h-5 w-5" />}
        />
        <StatCard
          title="Overall Progress"
          value={`${Math.round(totalProgress)}%`}
          icon={<ProgressRing progress={totalProgress} size={40} showLabel={false} />}
        />
      </div>

      {/* Continue Learning */}
      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Continue Learning</h2>
          <Link to="/app/courses">
            <Button variant="ghost" size="sm">
              View all courses
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </div>

        {inProgressCourses.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-6 w-6" />}
            title="No courses in progress"
            description="Start learning by enrolling in a course from the catalog."
            action={
              <Link to="/app/courses">
                <Button>Browse Courses</Button>
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {inProgressCourses.slice(0, 3).map((enrollment) => {
              const progress = progressData[enrollment.course_id];
              const progressPercent = progress
                ? (progress.completed / progress.total) * 100
                : 0;

              return (
                <Card key={enrollment.id} className="overflow-hidden transition-shadow hover:shadow-card-hover">
                  <div className="aspect-video bg-gradient-to-br from-primary/80 to-primary" />
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <h3 className="font-display font-semibold leading-tight">
                        {enrollment.course?.title}
                      </h3>
                      <Badge variant="secondary" className="shrink-0">
                        {enrollment.course?.level}
                      </Badge>
                    </div>
                    <p className="mb-4 text-sm text-muted-foreground line-clamp-2">
                      {enrollment.course?.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ProgressRing progress={progressPercent} size={32} strokeWidth={4} />
                        <span className="text-xs text-muted-foreground">
                          {progress?.completed || 0}/{progress?.total || 0} lessons
                        </span>
                      </div>
                      <Link to={`/app/learn/${enrollment.course_id}`}>
                        <Button size="sm">
                          <Play className="mr-1 h-3 w-3" />
                          Continue
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Completed Courses */}
      {completedCourses.length > 0 && (
        <div>
          <h2 className="mb-4 font-display text-lg font-semibold">Completed Courses</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {completedCourses.map((enrollment) => (
              <Card key={enrollment.id}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-success/10">
                    <Award className="h-6 w-6 text-success" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium">{enrollment.course?.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      Completed on {new Date(enrollment.completed_at!).toLocaleDateString()}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </AppLayout>
  );
}
