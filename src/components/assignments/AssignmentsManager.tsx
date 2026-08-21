import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QueryErrorState } from '@/components/ui/query-error-state';
import { toast } from '@/components/ui/sonner';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useToastMutation } from '@/hooks/useToastMutation';
import { useOrgAssignments } from '@/hooks/useOrgAssignments';
import type { OrgAssignment } from '@/lib/types';

interface AssignmentsManagerProps {
  orgId: string;
}

export function AssignmentsManager({ orgId }: AssignmentsManagerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: assignments = [], isLoading, isError, refetch } = useOrgAssignments(orgId);
  const [removeTarget, setRemoveTarget] = useState<OrgAssignment | null>(null);

  const removeMutation = useToastMutation<void, string>({
    mutationFn: async (assignmentId: string) => {
      await callApi('/api/assignment-delete', { assignmentId });
    },
    errorTitle: t('assignments.removeFailed'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assignments.list(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.learnerAssignments.list(orgId) });
      toast({ title: t('assignments.removed') });
      setRemoveTarget(null);
    },
  });

  return (
    <section className="space-y-3">
      <h3 className="text-[15px] font-bold">{t('assignments.manageTitle')}</h3>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-legacy-muted-foreground" />
        </div>
      ) : isError ? (
        <QueryErrorState onRetry={() => refetch()} />
      ) : assignments.length === 0 ? (
        <p className="py-6 text-sm text-legacy-muted-foreground">{t('assignments.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('assignments.col.course')}</TableHead>
                <TableHead>{t('assignments.col.target')}</TableHead>
                <TableHead>{t('assignments.col.type')}</TableHead>
                <TableHead>{t('assignments.col.dueDate')}</TableHead>
                <TableHead>{t('assignments.col.assignedBy')}</TableHead>
                <TableHead className="text-right">{t('assignments.col.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.courseTitle}</TableCell>
                  <TableCell>{a.userFullName ?? t('assignments.wholeOrg')}</TableCell>
                  <TableCell>
                    <Badge variant={a.mandatory ? 'default' : 'secondary'}>
                      {a.mandatory ? t('assignments.type.mandatory') : t('assignments.type.recommended')}
                    </Badge>
                  </TableCell>
                  <TableCell>{a.dueDate ?? t('assignments.noDueDate')}</TableCell>
                  <TableCell>{a.assignedByName ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(a)}>
                      {t('assignments.remove')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={removeTarget !== null} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assignments.removeConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('assignments.removeConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMutation.isPending}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (removeTarget) removeMutation.mutate(removeTarget.id);
              }}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('assignments.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
