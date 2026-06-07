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
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { callApi } from '@/lib/api-client';
import { toast } from '@/components/ui/sonner';
import { Loader2, BookOpen, Users, GraduationCap } from 'lucide-react';
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

export function EnrollUserDialog({
  open,
  onOpenChange,
  orgId,
  orgName,
  members,
  onSuccess,
}: EnrollUserDialogProps) {
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [courses, setCourses] = useState<AvailableCourse[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);

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
      }>('/api/org-course-access', { orgId });

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

    let success = 0;
    let failed = 0;

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
        } catch (_err) {
          failed++;
        }
      }
    } finally {
      setEnrolling(false);
    }

    if (success > 0) {
      const selectedUser = activeLearners.find((m) => m.user_id === selectedUserId);
      toast({
        title: 'Enrollment successful',
        description: `${selectedUser?.profile?.full_name} has been enrolled in ${success} course${success > 1 ? 's' : ''}.`,
      });
      onSuccess();
      onOpenChange(false);
    } else {
      toast({
        title: 'Enrollment failed',
        description: 'Failed to enroll user in courses. They may already be enrolled.',
        variant: 'destructive',
      });
    }
  };

  const availableCourses = courses.filter((c) => !c.alreadyEnrolled);
  const enrolledCourses = courses.filter((c) => c.alreadyEnrolled);

  const levelColors = {
    basic: 'bg-green-100 text-green-800',
    intermediate: 'bg-yellow-100 text-yellow-800',
    advanced: 'bg-red-100 text-red-800',
  };

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
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
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
                  <Loader2 className="h-6 w-6 animate-spin text-accent" />
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
                            <Badge variant="outline" className={levelColors[course.level]}>
                              {course.level}
                            </Badge>
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
                            <GraduationCap className="h-4 w-4 text-accent" />
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
