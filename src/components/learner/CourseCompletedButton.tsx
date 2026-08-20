import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

export function CourseCompletedButton({
  courseId,
  courseTitle,
  testId,
  className,
}: {
  courseId: string;
  courseTitle: string | undefined;
  testId?: string;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <Button
      asChild
      data-testid={testId}
      className={cn(
        'h-auto rounded-[10px] border-2 border-success bg-transparent px-3 py-[9px] text-[13px] font-bold text-success shadow-none hover:bg-success/10',
        className,
      )}
    >
      <Link
        to={routes.learner.coursePlayer(courseId, 'training')}
        aria-label={t('training.mandatory.completedFor', { title: courseTitle })}
      >
        <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" />
        {t('training.mandatory.completed')}
      </Link>
    </Button>
  );
}
