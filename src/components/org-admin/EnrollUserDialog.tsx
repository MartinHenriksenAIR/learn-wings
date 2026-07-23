import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LevelBadge } from '@/components/ui/level-badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { callApi } from '@/lib/api-client';
import { toast } from '@/components/ui/sonner';
import { Loader2, BookOpen, Users, GraduationCap, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Course, OrgMembership, Profile } from '@/lib/types';

interface EnrollUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  orgName: string;
  members: (OrgMembership & { profile: Profile })[];
  onSuccess: () => void;
}

interface AvailableCourse extends Course {
  alreadyEnrolled?: boolean;
}

interface EnrollFailure {
  courseId: string;
  courseTitle: string;
  reason: string;
}

export function EnrollUserDialog({
  open,
  onOpenChange,
  orgId,
  orgName,
  members,
  onSuccess,
}: EnrollUserDialogProps) {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [courses, setCourses] = useState<AvailableCourse[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [failures, setFailures] = useState<EnrollFailure[]>([]);

  const activeLearners = members.filter(
    (m) => m.status === 'active' && m.role === 'learner'
  );

  const fetchCourses = async () => {
    if (!orgId || !selectedUserId) {
      setCourses([]);
      return;
    }

    setLoading(true);

    try {
      // Get courses available to this org (joined with course details server-side)
      const accessResult = await callApi<{
        access: Array<{
          id: string;
          course_id: string;
          access: string;
          course: Course;
        }>;
      }>('/api/org-course-access', { orgId, language: i18n.resolvedLanguage ?? 'en' });

      const availableCourseList = accessResult.access
        .filter((row) => row.access === 'enabled' && row.course.is_published === true)
        .map((row) => row.course);

      // Get existing enrollments for selected user
      const enrollmentResult = await callApi<{
        enrollments: Array<{
          id: string;
          org_id: string;
          user_id: string;
          course_id: string;
          status: string;
          enrolled_at: string;
          completed_at: string | null;
        }>;
      }>('/api/enrollments', { orgId, userId: selectedUserId });

      const enrolledCourseIds = new Set(
        enrollmentResult.enrollments.map((e) => e.course_id),
      );

      const coursesWithStatus: AvailableCourse[] = availableCourseList.map((c) => ({
        ...c,
        alreadyEnrolled: enrolledCourseIds.has(c.id),
      }));

      setCourses(coursesWithStatus);
    } catch (_err) {
      setCourses([]);
      toast({
        title: 'Failed to load courses',
        description: 'Could not load available courses. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && selectedUserId) {
      fetchCourses();
    }
  }, [open, orgId, selectedUserId]);

  useEffect(() => {
    if (!open) {
      setSelectedUserId('');
      setSelectedCourseIds([]);
      setCourses([]);
      setFailures([]);
    }
  }, [open]);

  const toggleCourse = (courseId: string) => {
    setSelectedCourseIds((prev) =>
      prev.includes(courseId)
        ? prev.filter((id) => id !== courseId)
        : [...prev, courseId]
    );
  };

  const handleEnroll = async () => {
    if (!selectedUserId || selectedCourseIds.length === 0) return;

    setEnrolling(true);
    setFailures([]);

    let success = 0;
    const rowFailures: EnrollFailure[] = [];

    try {
      for (const courseId of selectedCourseIds) {
        try {
          await callApi('/api/enrollment-create', {
            orgId,
            userId: selectedUserId,
            courseId,
            status: 'enrolled',
          });
          success++;
        } catch (err) {
          const course = courses.find((c) => c.id === courseId);
          rowFailures.push({
            courseId,
            courseTitle: course?.title ?? courseId,
            reason: err instanceof Error ? err.message : t('enrollDialog.unknownError'),
          });
        }
      }
    } finally {
      setEnrolling(false);
    }

    setFailures(rowFailures);
    const failed = rowFailures.length;

    if (failed === 0) {
      const selectedUser = activeLearners.find((m) => m.user_id === selectedUserId);
      toast({
        title: 'Enrollment successful',
        description: `${selectedUser?.profile?.full_name} has been enrolled in ${success} course${success > 1 ? 's' : ''}.`,
      });
      onSuccess();
      onOpenChange(false);
    } else if (success > 0) {
      // Mixed outcome: keep the dialog open so the per-row failure reasons stay visible.
      toast({
        title: t('enrollDialog.partialTitle'),
        description: t('enrollDialog.partialDescription', { success, failed }),
        variant: 'destructive',
      });
      onSuccess();
      setSelectedCourseIds(rowFailures.map((f) => f.courseId));
      fetchCourses();
    } else {
      toast({
        title: t('enrollDialog.failedTitle'),
        description: t('enrollDialog.failedDescription'),
        variant: 'destructive',
      });
    }
  };

  const availableCourses = courses.filter((c) => !c.alreadyEnrolled);
  const enrolledCourses = courses.filter((c) => c.alreadyEnrolled);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Enroll User in Courses</DialogTitle>
          <DialogDescription>
            Select a team member and the courses to enroll them in.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {/* User Selection */}
          <div className="space-y-2">
            <Label>Select Team Member</Label>
            {activeLearners.length === 0 ? (
              <div className="p-4 rounded-lg border bg-muted/50 text-center">
                <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  No active learners to enroll. Invite team members first.
                </p>
              </div>
            ) : (
              <Select
                value={selectedUserId}
                onValueChange={(v) => {
                  setSelectedUserId(v);
                  setFailures([]);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a team member..." />
                </SelectTrigger>
                <SelectContent>
                  {activeLearners.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.profile?.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Course Selection */}
          {selectedUserId && (
            <div className="space-y-2">
              <Label>Select Courses</Label>
              {loading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : courses.length === 0 ? (
                <div className="p-4 rounded-lg border bg-muted/50 text-center">
                  <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No courses available for this organization.
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-64 border rounded-lg">
                  <div className="p-2 space-y-1">
                    {/* Available courses */}
                    {availableCourses.map((course) => (
                      <div
                        key={course.id}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 cursor-pointer"
                        onClick={() => toggleCourse(course.id)}
                      >
                        <Checkbox
                          checked={selectedCourseIds.includes(course.id)}
                          onCheckedChange={() => toggleCourse(course.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{course.title}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <LevelBadge level={course.level} />
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Already enrolled courses */}
                    {enrolledCourses.length > 0 && (
                      <>
                        <div className="px-3 py-2 text-xs text-muted-foreground font-medium uppercase">
                          Already Enrolled
                        </div>
                        {enrolledCourses.map((course) => (
                          <div
                            key={course.id}
                            className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 opacity-60"
                          >
                            <GraduationCap className="h-4 w-4 text-primary" />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{course.title}</p>
                              <p className="text-xs text-muted-foreground">
                                Already enrolled
                              </p>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          {/* Per-row failure reasons (pattern follows BulkInviteDialog results) */}
          {failures.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium">{t('enrollDialog.failuresTitle')}</p>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {failures.map((failure) => (
                    <li key={failure.courseId}>
                      <span className="font-medium">{failure.courseTitle}</span>: {failure.reason}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleEnroll}
            disabled={enrolling || !selectedUserId || selectedCourseIds.length === 0}
          >
            {enrolling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enrolling...
              </>
            ) : (
              <>
                <GraduationCap className="mr-2 h-4 w-4" />
                Enroll in {selectedCourseIds.length} Course{selectedCourseIds.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
