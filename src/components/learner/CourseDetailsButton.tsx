import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

export function CourseDetailsButton({
  courseId,
  courseTitle,
  className,
}: {
  courseId: string;
  courseTitle: string | undefined;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <Button
      asChild
      variant="outline"
      className={cn('h-auto shrink-0 rounded-[10px] px-3 py-[9px] text-[13px] font-bold', className)}
    >
      <Link
        to={routes.learner.courseDetail(courseId)}
        aria-label={t('courses.detailsFor', { title: courseTitle })}
      >
        <Info aria-hidden="true" className="h-3.5 w-3.5" />
        {t('courses.details')}
      </Link>
    </Button>
  );
}
