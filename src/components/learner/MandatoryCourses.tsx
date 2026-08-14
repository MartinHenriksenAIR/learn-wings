import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookOpen, CircleCheck, Clock, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-locale';
import { useLearnerAssignments } from '@/hooks/useLearnerAssignments';
import type { ListView } from '@/hooks/useListView';

export function MandatoryCourses({
  orgId,
  view = 'card',
}: {
  orgId: string | undefined;
  view?: ListView;
}) {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useLearnerAssignments(orgId);

  if (isLoading) return null;

  const courses = (data ?? []).filter((a) => a.mandatory);

  return (
    <section className="mb-8">
      <h2 className="mb-3.5 font-display text-[17px] font-bold">{t('training.mandatory.title')}</h2>

      {courses.length === 0 ? (
        <EmptyState icon={<BookOpen className="h-6 w-6" />} title={t('training.mandatory.empty')} />
      ) : (
        <div className={view === 'list' ? 'flex flex-col gap-3' : 'grid gap-3.5 md:grid-cols-2 lg:grid-cols-3'}>
          {courses.map((course) =>
            view === 'list' ? (
              <div
                key={course.courseId}
                data-testid="training-mandatory-row"
                className="hover-lift flex items-center gap-4 rounded-xl border border-border bg-card p-3"
              >
                <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-primary/80 to-primary">
                  {course.thumbnailUrl && (
                    <img
                      src={course.thumbnailUrl}
                      alt={course.courseTitle}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[14px] font-bold leading-[1.35]">{course.courseTitle}</h3>
                  {!course.completed && course.dueDate && (
                    <div
                      data-testid="mandatory-due"
                      className={cn(
                        'mt-1 flex items-center gap-2 text-xs font-semibold',
                        course.overdue ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {t('training.mandatory.due')} {formatDate(new Date(course.dueDate), 'P', i18n.language)}
                      </span>
                      {course.overdue && (
                        <Badge data-testid="mandatory-overdue" variant="destructive">
                          {t('training.mandatory.overdue')}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                {course.completed ? (
                  <span
                    data-testid="mandatory-completed"
                    className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-success/10 px-3 py-2 text-[13px] font-bold text-success"
                  >
                    <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" />
                    {t('training.mandatory.completed')}
                  </span>
                ) : (
                  <Button
                    asChild
                    className="h-auto shrink-0 rounded-[10px] bg-accent px-3 py-2 text-[12.5px] font-bold text-accent-foreground hover:bg-[#dfe5f8]"
                  >
                    <Link to={routes.learner.coursePlayer(course.courseId, 'training')}>
                      <Play aria-hidden="true" className="h-3.5 w-3.5" />
                      {t('courses.openCourse')}
                    </Link>
                  </Button>
                )}
              </div>
            ) : (
              <div
                key={course.courseId}
                data-testid="training-mandatory-card"
                className="hover-lift flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
              >
                <div className="relative h-[110px] bg-gradient-to-br from-primary/80 to-primary">
                  {course.thumbnailUrl && (
                    <img
                      src={course.thumbnailUrl}
                      alt={course.courseTitle}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2.5 px-[18px] pb-[18px] pt-4">
                  <h3 className="text-[14.5px] font-bold leading-[1.35]">{course.courseTitle}</h3>

                  {!course.completed && course.dueDate && (
                    <div
                      data-testid="mandatory-due"
                      className={cn(
                        'flex items-center gap-2 text-xs font-semibold',
                        course.overdue ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {t('training.mandatory.due')} {formatDate(new Date(course.dueDate), 'P', i18n.language)}
                      </span>
                      {course.overdue && (
                        <Badge data-testid="mandatory-overdue" variant="destructive" className="ml-auto">
                          {t('training.mandatory.overdue')}
                        </Badge>
                      )}
                    </div>
                  )}

                  {course.completed ? (
                    <span
                      data-testid="mandatory-completed"
                      className="mt-auto flex items-center justify-center gap-1.5 rounded-[10px] bg-success/10 px-3 py-[9px] text-[13px] font-bold text-success"
                    >
                      <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" />
                      {t('training.mandatory.completed')}
                    </span>
                  ) : (
                    <Button
                      asChild
                      className="mt-auto h-auto w-full rounded-[10px] bg-accent px-3 py-[9px] text-[13px] font-bold text-accent-foreground hover:bg-[#dfe5f8]"
                    >
                      <Link to={routes.learner.coursePlayer(course.courseId, 'training')}>
                        <Play aria-hidden="true" className="h-3.5 w-3.5" />
                        {t('courses.openCourse')}
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}
