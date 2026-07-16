import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
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
import { useOrgCourseProgress } from '@/hooks/useOrgCourseProgress';
import { useOrgCourseEnrollees } from '@/hooks/useOrgCourseEnrollees';
import { LevelBadge } from '@/components/ui/level-badge';
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
  orgId: string;
}

interface CourseEnrollee {
  userId: string;
  name: string;
  status: 'enrolled' | 'completed';
  enrolledAt: string;
  completedAt: string | null;
}

export function CourseProgressTab({ orgId }: CourseProgressTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>('grouped');
  const [selectedCourse, setSelectedCourse] = useState<CourseStats | null>(null);

  // Fetch course data via shared query hook
  const courseProgressQuery = useOrgCourseProgress(orgId);

  // Derive courseStats with avgProgress — byte-for-byte from the old fetchCourseStats
  const courseStats = useMemo((): CourseStats[] => {
    const data = courseProgressQuery.data;
    if (!data) return [];
    return data.courses.map((course) => ({
      id: course.id,
      title: course.title,
      level: course.level,
      enrolled: course.enrolled,
      completed: course.completed,
      avgProgress: course.enrolled > 0 ? Math.round((course.completed / course.enrolled) * 100) : 0,
    }));
  }, [courseProgressQuery.data]);

  // Fetch enrollees for the selected course — enabled only while a course is selected
  const enrolleesQuery = useOrgCourseEnrollees(orgId, selectedCourse?.id);

  // Derive enrollees (snake_case → camelCase) — byte-for-byte from the old fetchEnrollees
  const enrollees = useMemo((): CourseEnrollee[] => {
    const data = enrolleesQuery.data;
    if (!data) return [];
    return data.enrollees.map((e) => ({
      userId: e.user_id,
      name: e.full_name || 'Unknown',
      status: e.status,
      enrolledAt: e.enrolled_at,
      completedAt: e.completed_at,
    }));
  }, [enrolleesQuery.data]);

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

  const CourseRow = ({ course }: { course: CourseStats }) => (
    <div
      className="flex items-center gap-4 p-4 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => {
        setSelectedCourse(course);
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="font-medium truncate">{course.title}</h4>
          <LevelBadge level={course.level} />
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

  if (courseProgressQuery.isLoading) {
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
                    <LevelBadge level={level as CourseLevel} />
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
        {/* No description text by design — explicit opt-out silences Radix's missing-Description a11y warning */}
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedCourse?.title}
              {selectedCourse && <LevelBadge level={selectedCourse.level} />}
            </DialogTitle>
          </DialogHeader>

          {enrolleesQuery.isLoading ? (
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
                          className={`rounded-[7px] px-2.5 py-1 text-[11px] font-bold ${
                            enrollee.status === 'completed'
                              ? 'bg-success/10 text-success'
                              : 'bg-accent text-primary'
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
