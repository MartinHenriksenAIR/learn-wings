import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Search, BookOpen, ChevronRight, Users, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { CourseLevel } from '@/lib/types';

interface CourseStats {
  id: string;
  title: string;
  level: CourseLevel;
  enrolled: number;
  completed: number;
  avgProgress: number;
}

interface CourseProgressTabProps {
  orgId?: string;
}

interface CourseEnrollee {
  userId: string;
  name: string;
  status: 'enrolled' | 'completed';
  enrolledAt: string;
  completedAt: string | null;
}

export function CourseProgressTab({ orgId }: CourseProgressTabProps) {
  const [loading, setLoading] = useState(true);
  const [courseStats, setCourseStats] = useState<CourseStats[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>('grouped');
  const [selectedCourse, setSelectedCourse] = useState<CourseStats | null>(null);
  const [enrollees, setEnrollees] = useState<CourseEnrollee[]>([]);
  const [loadingEnrollees, setLoadingEnrollees] = useState(false);

  // Fetch course data
  useEffect(() => {
    const fetchCourseStats = async () => {
      setLoading(true);

      // When orgId is provided, use org_course_access to get enabled courses for that org.
      // When orgId is absent (all-orgs view), fetch all distinct courses directly.
      let coursesToProcess: { id: string; title: string; level: CourseLevel }[] = [];

      if (orgId) {
        const { data: orgCourses } = await supabase
          .from('org_course_access')
          .select('course_id, course:courses(id, title, level)')
          .eq('org_id', orgId)
          .eq('access', 'enabled');

        if (orgCourses) {
          coursesToProcess = orgCourses
            .map((a) => a.course as any)
            .filter(Boolean);
        }
      } else {
        const { data: allCourses } = await supabase
          .from('courses')
          .select('id, title, level')
          .order('title');

        if (allCourses) {
          coursesToProcess = allCourses as { id: string; title: string; level: CourseLevel }[];
        }
      }

      const statsData: CourseStats[] = [];

      for (const course of coursesToProcess) {
        let enrollmentsQuery = supabase
          .from('enrollments')
          .select('status')
          .eq('course_id', course.id);
        if (orgId) {
          enrollmentsQuery = enrollmentsQuery.eq('org_id', orgId);
        }
        const { data: courseEnrollments } = await enrollmentsQuery;

        const enrolled = courseEnrollments?.length || 0;
        const completed = courseEnrollments?.filter(e => e.status === 'completed').length || 0;

        statsData.push({
          id: course.id,
          title: course.title,
          level: course.level,
          enrolled,
          completed,
          avgProgress: enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0,
        });
      }

      setCourseStats(statsData);
      setLoading(false);
    };

    fetchCourseStats();
  }, [orgId]);

  // Fetch enrollees for selected course
  const fetchEnrollees = async (courseId: string) => {
    setLoadingEnrollees(true);

    let enrollmentsQuery = supabase
      .from('enrollments')
      .select('user_id, status, enrolled_at, completed_at, profile:profiles(full_name)')
      .eq('course_id', courseId);
    if (orgId) {
      enrollmentsQuery = enrollmentsQuery.eq('org_id', orgId);
    }
    const { data: enrollments } = await enrollmentsQuery;

    if (enrollments) {
      setEnrollees(
        enrollments.map((e) => ({
          userId: e.user_id,
          name: (e.profile as any)?.full_name || 'Unknown',
          status: e.status as 'enrolled' | 'completed',
          enrolledAt: e.enrolled_at,
          completedAt: e.completed_at,
        }))
      );
    }
    
    setLoadingEnrollees(false);
  };

  // Filter courses
  const filteredCourses = useMemo(() => {
    return courseStats.filter((course) => {
      if (searchQuery && !course.title.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (levelFilter !== 'all' && course.level !== levelFilter) {
        return false;
      }
      return true;
    });
  }, [courseStats, searchQuery, levelFilter]);

  // Group by level
  const groupedByLevel = useMemo(() => {
    const groups: Record<string, CourseStats[]> = {
      basic: [],
      intermediate: [],
      advanced: [],
    };
    filteredCourses.forEach((course) => {
      groups[course.level].push(course);
    });
    return groups;
  }, [filteredCourses]);

  const levelLabels: Record<string, string> = {
    basic: 'Basic',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
  };

  const levelColors: Record<string, string> = {
    basic: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    intermediate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    advanced: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  };

  const CourseRow = ({ course }: { course: CourseStats }) => (
    <div
      className="flex items-center gap-4 p-4 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => {
        setSelectedCourse(course);
        fetchEnrollees(course.id);
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="font-medium truncate">{course.title}</h4>
          <span className={`text-xs px-2 py-0.5 rounded-full ${levelColors[course.level]}`}>
            {levelLabels[course.level]}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{course.enrolled} enrolled</span>
          <span>{course.completed} completed</span>
        </div>
      </div>
      <div className="w-32">
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-medium">{course.avgProgress}%</span>
        </div>
        <Progress value={course.avgProgress} className="h-2" />
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground" />
    </div>
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search courses..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Levels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="basic">Basic</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
              </SelectContent>
            </Select>

            <Select value={viewMode} onValueChange={(v) => setViewMode(v as 'list' | 'grouped')}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="list">List View</SelectItem>
                <SelectItem value="grouped">By Level</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-3 text-sm text-muted-foreground">
            {filteredCourses.length} of {courseStats.length} courses
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {filteredCourses.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
            <p className="text-muted-foreground">
              {courseStats.length === 0 ? 'No courses available.' : 'No courses match your filters.'}
            </p>
          </CardContent>
        </Card>
      ) : viewMode === 'grouped' ? (
        <Accordion type="multiple" defaultValue={['basic', 'intermediate', 'advanced']} className="space-y-2">
          {Object.entries(groupedByLevel).map(([level, courses]) => 
            courses.length > 0 && (
              <AccordionItem key={level} value={level} className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${levelColors[level]}`}>
                      {levelLabels[level]}
                    </span>
                    <span className="text-sm text-muted-foreground">({courses.length} courses)</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 pt-2">
                    {courses.map((course) => (
                      <CourseRow key={course.id} course={course} />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          )}
        </Accordion>
      ) : (
        <div className="space-y-2">
          {filteredCourses.map((course) => (
            <CourseRow key={course.id} course={course} />
          ))}
        </div>
      )}

      {/* Course Detail Dialog */}
      <Dialog open={!!selectedCourse} onOpenChange={(open) => !open && setSelectedCourse(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedCourse?.title}
              {selectedCourse && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${levelColors[selectedCourse.level]}`}>
                  {levelLabels[selectedCourse.level]}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {loadingEnrollees ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : enrollees.length === 0 ? (
            <div className="py-8 text-center">
              <Users className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-muted-foreground">No learners enrolled in this course.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold">{selectedCourse?.enrolled}</div>
                    <div className="text-sm text-muted-foreground">Total Enrolled</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold">{selectedCourse?.completed}</div>
                    <div className="text-sm text-muted-foreground">Completed</div>
                  </CardContent>
                </Card>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Learner</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Enrolled</TableHead>
                    <TableHead>Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrollees.map((enrollee) => (
                    <TableRow key={enrollee.userId}>
                      <TableCell className="font-medium">{enrollee.name}</TableCell>
                      <TableCell>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            enrollee.status === 'completed'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                          }`}
                        >
                          {enrollee.status === 'completed' ? 'Completed' : 'In Progress'}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(enrollee.enrolledAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {enrollee.completedAt
                          ? new Date(enrollee.completedAt).toLocaleDateString()
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
