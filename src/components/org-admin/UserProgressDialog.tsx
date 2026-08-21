import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useUserProgress, type CourseProgress } from '@/hooks/useUserProgress';
import {
  Loader2,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Award,
  Calendar,
  TrendingUp,
} from 'lucide-react';
import { formatDate } from '@/lib/date-locale';

interface UserProgressDialogProps {
  userId: string;
  userName: string;
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserProgressDialog({
  userId,
  userName,
  orgId,
  open,
  onOpenChange,
}: UserProgressDialogProps) {
  const { i18n } = useTranslation();
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());

  const query = useUserProgress(orgId, userId, { enabled: open });
  const courseProgress: CourseProgress[] = query.data?.courses ?? [];
  const loading = query.isLoading;

  const totalEnrolled = courseProgress.length;
  const totalCompleted = courseProgress.filter(c => c.enrollmentStatus === 'completed').length;
  const allQuizAttempts = courseProgress.flatMap(c => c.quizAttempts);
  const avgQuizScore = allQuizAttempts.length > 0
    ? Math.round(allQuizAttempts.reduce((acc, a) => acc + a.score, 0) / allQuizAttempts.length)
    : 0;
  const lastActivity = allQuizAttempts.length > 0
    ? allQuizAttempts.sort((a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      )[0]?.startedAt
    : null;

  const toggleCourse = (courseId: string) => {
    setExpandedCourses(prev => {
      const next = new Set(prev);
      if (next.has(courseId)) {
        next.delete(courseId);
      } else {
        next.add(courseId);
      }
      return next;
    });
  };

  const getLevelBadgeVariant = (level: string) => {
    switch (level) {
      case 'basic':
        return 'secondary';
      case 'intermediate':
        return 'default';
      case 'advanced':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-legacy-primary text-legacy-primary-foreground">
              {userName.charAt(0).toUpperCase()}
            </div>
            <span>{userName}</span>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-legacy-primary" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card>
                <CardContent className="p-3 text-center">
                  <BookOpen className="mx-auto h-5 w-5 text-legacy-muted-foreground" />
                  <p className="mt-1 text-2xl font-bold">{totalEnrolled}</p>
                  <p className="text-xs text-legacy-muted-foreground">Enrolled</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <Award className="mx-auto h-5 w-5 text-legacy-muted-foreground" />
                  <p className="mt-1 text-2xl font-bold">{totalCompleted}</p>
                  <p className="text-xs text-legacy-muted-foreground">Completed</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <TrendingUp className="mx-auto h-5 w-5 text-legacy-muted-foreground" />
                  <p className="mt-1 text-2xl font-bold">{avgQuizScore}%</p>
                  <p className="text-xs text-legacy-muted-foreground">Avg Quiz</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <Calendar className="mx-auto h-5 w-5 text-legacy-muted-foreground" />
                  <p className="mt-1 text-sm font-bold">
                    {lastActivity ? formatDate(new Date(lastActivity), 'MMM d', i18n.language) : '—'}
                  </p>
                  <p className="text-xs text-legacy-muted-foreground">Last Active</p>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold">Course Progress</h3>
              {courseProgress.length === 0 ? (
                <p className="text-sm text-legacy-muted-foreground">No course enrollments yet.</p>
              ) : (
                courseProgress.map(course => {
                  const progressPercent = course.totalLessons > 0
                    ? Math.round((course.completedLessons / course.totalLessons) * 100)
                    : 0;
                  const isExpanded = expandedCourses.has(course.courseId);

                  return (
                    <Collapsible
                      key={course.courseId}
                      open={isExpanded}
                      onOpenChange={() => toggleCourse(course.courseId)}
                    >
                      <Card>
                        <CollapsibleTrigger asChild>
                          <div className="cursor-pointer p-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                                <span className="font-medium">{course.courseTitle}</span>
                                <Badge variant={getLevelBadgeVariant(course.courseLevel)}>
                                  {course.courseLevel}
                                </Badge>
                              </div>
                              <Badge
                                variant={course.enrollmentStatus === 'completed' ? 'default' : 'secondary'}
                              >
                                {course.enrollmentStatus === 'completed' ? 'Completed' : 'In Progress'}
                              </Badge>
                            </div>
                            <div className="mt-2 flex items-center gap-3">
                              <Progress value={progressPercent} className="h-2 flex-1" />
                              <span className="text-sm text-legacy-muted-foreground">
                                {course.completedLessons}/{course.totalLessons} lessons
                              </span>
                            </div>
                            {course.completedAt && (
                              <p className="mt-1 text-xs text-legacy-muted-foreground">
                                Completed on {formatDate(new Date(course.completedAt), 'MMM d, yyyy', i18n.language)}
                              </p>
                            )}
                          </div>
                        </CollapsibleTrigger>

                        <CollapsibleContent>
                          <div className="border-t px-4 pb-4 pt-3">
                            <div className="space-y-3">
                              {course.modules.map(module => (
                                <div key={module.id}>
                                  <p className="text-sm font-medium text-legacy-muted-foreground">
                                    {module.title}
                                  </p>
                                  <div className="mt-1 space-y-1 pl-4">
                                    {module.lessons.map(lesson => (
                                      <div
                                        key={lesson.id}
                                        className="flex items-center gap-2 text-sm"
                                      >
                                        {lesson.status === 'completed' ? (
                                          <CheckCircle2 className="h-4 w-4 text-legacy-primary" />
                                        ) : (
                                          <Circle className="h-4 w-4 text-legacy-muted-foreground" />
                                        )}
                                        <span
                                          className={
                                            lesson.status === 'completed'
                                              ? 'text-legacy-foreground'
                                              : 'text-legacy-muted-foreground'
                                          }
                                        >
                                          {lesson.title}
                                        </span>
                                        {lesson.lessonType === 'quiz' && lesson.latestQuizScore !== undefined && (
                                          <Badge
                                            variant={lesson.latestQuizPassed ? 'default' : 'destructive'}
                                            className="ml-auto text-xs"
                                          >
                                            {lesson.latestQuizScore}%
                                          </Badge>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>

                            {course.quizAttempts.length > 0 && (
                              <div className="mt-4">
                                <p className="mb-2 text-sm font-medium">Quiz Attempts</p>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="text-xs">Quiz</TableHead>
                                      <TableHead className="text-right text-xs">Score</TableHead>
                                      <TableHead className="text-right text-xs">Status</TableHead>
                                      <TableHead className="text-right text-xs">Date</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {course.quizAttempts.map(attempt => (
                                      <TableRow key={attempt.id}>
                                        <TableCell className="text-xs">
                                          {attempt.lessonTitle}
                                        </TableCell>
                                        <TableCell className="text-right text-xs">
                                          {attempt.score}%
                                        </TableCell>
                                        <TableCell className="text-right">
                                          <Badge
                                            variant={attempt.passed ? 'default' : 'destructive'}
                                            className="text-xs"
                                          >
                                            {attempt.passed ? 'Passed' : 'Failed'}
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-right text-xs">
                                          {formatDate(new Date(attempt.startedAt), 'MMM d, h:mm a', i18n.language)}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  );
                })
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
