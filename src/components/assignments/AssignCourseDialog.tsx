import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useToastMutation } from '@/hooks/useToastMutation';
import { useOrgCourseAccess } from '@/hooks/useOrgCourseAccess';
import type { OrgMembership, Profile } from '@/lib/types';

interface AssignCourseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  orgName: string;
  members: (OrgMembership & { profile: Profile })[];
  /** When set, the target is locked to this member (opened from a member row). */
  presetUserId?: string;
  onSuccess?: () => void;
}

type Target = 'member' | 'org';

export function AssignCourseDialog({
  open,
  onOpenChange,
  orgId,
  orgName,
  members,
  presetUserId,
  onSuccess,
}: AssignCourseDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [target, setTarget] = useState<Target>('member');
  const [userId, setUserId] = useState<string>('');
  const [courseId, setCourseId] = useState<string>('');
  const [mandatory, setMandatory] = useState<boolean>(true);
  const [dueDate, setDueDate] = useState<string>('');

  const activeLearners = useMemo(
    () => members.filter((m) => m.status === 'active' && m.role === 'learner'),
    [members],
  );

  const { data: courses = [], isLoading: coursesLoading } = useOrgCourseAccess(open ? orgId : undefined);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setTarget('member');
      setUserId(presetUserId ?? '');
      setCourseId('');
      setMandatory(true);
      setDueDate('');
    }
  }, [open, presetUserId]);

  const presetMember = presetUserId
    ? members.find((m) => m.user_id === presetUserId)
    : undefined;

  const mutation = useToastMutation({
    mutationFn: async () => {
      await callApi('/api/assignment-create', {
        orgId,
        courseId,
        userId: target === 'member' ? userId : null,
        mandatory,
        dueDate: dueDate || null,
      });
    },
    errorTitle: t('assignments.assignFailed'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assignments.list(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.learnerAssignments.list(orgId) });
      toast({ title: t('assignments.assigned') });
      onSuccess?.();
      onOpenChange(false);
    },
  });

  const noCourses = !coursesLoading && courses.length === 0;
  const canSubmit =
    !!courseId &&
    (target === 'org' || !!userId) &&
    !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('assignments.assignCourse')}</DialogTitle>
          <DialogDescription>{t('assignments.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Target */}
          {presetUserId ? (
            <div className="space-y-1.5">
              <Label>{t('assignments.targetLabel')}</Label>
              <p className="text-sm text-muted-foreground">
                {presetMember?.profile.full_name ?? presetUserId}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label id="assign-target-label">{t('assignments.targetLabel')}</Label>
              <RadioGroup
                aria-labelledby="assign-target-label"
                value={target}
                onValueChange={(v) => setTarget(v as Target)}
                className="flex flex-col gap-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="member" id="assign-target-member" />
                  <Label htmlFor="assign-target-member" className="font-normal">
                    {t('assignments.target.member')}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="org" id="assign-target-org" />
                  <Label htmlFor="assign-target-org" className="font-normal">
                    {t('assignments.target.wholeOrg')} ({orgName})
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Member select (only when targeting a member and no preset) */}
          {!presetUserId && target === 'member' && (
            <div className="space-y-1.5">
              <Label htmlFor="assign-member">{t('assignments.selectMember')}</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger id="assign-member">
                  <SelectValue placeholder={t('assignments.selectMemberPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {activeLearners.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.profile.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Course select */}
          <div className="space-y-1.5">
            <Label htmlFor="assign-course">{t('assignments.selectCourse')}</Label>
            <Select value={courseId} onValueChange={setCourseId} disabled={noCourses}>
              <SelectTrigger id="assign-course">
                <SelectValue placeholder={t('assignments.selectCoursePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {courses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {noCourses && (
              <p className="text-sm text-muted-foreground">{t('assignments.noCourses')}</p>
            )}
          </div>

          {/* Type: mandatory / recommended */}
          <div className="space-y-2">
            <Label id="assign-type-label">{t('assignments.typeLabel')}</Label>
            <RadioGroup
              aria-labelledby="assign-type-label"
              value={mandatory ? 'mandatory' : 'recommended'}
              onValueChange={(v) => setMandatory(v === 'mandatory')}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="mandatory" id="assign-type-mandatory" />
                <Label htmlFor="assign-type-mandatory" className="font-normal">
                  {t('assignments.type.mandatory')}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="recommended" id="assign-type-recommended" />
                <Label htmlFor="assign-type-recommended" className="font-normal">
                  {t('assignments.type.recommended')}
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Optional due date */}
          <div className="space-y-1.5">
            <Label htmlFor="assign-due-date">{t('assignments.dueDateOptional')}</Label>
            <Input
              id="assign-due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('assignments.assign')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
