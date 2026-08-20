import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { routes } from '@/lib/routes';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { LevelBadge } from '@/components/ui/level-badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useAuth } from '@/hooks/useAuth';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { useCourseDetail } from '@/hooks/useCourseDetail';
import { useCourseCategories } from '@/hooks/useCourseCategories';
import { useFavorites, useToggleFavorite } from '@/hooks/useFavorites';
import { FavoriteToggle } from '@/components/learner/FavoriteToggle';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { BookOpen, Layers, Play } from 'lucide-react';

export default function CourseDetail() {
  const { courseId } = useParams<{ courseId: string }>();
  const { currentOrg } = useAuth();
  const orgGuard = useOrgGuard();
  const { t, i18n } = useTranslation();

  const query = useCourseDetail(currentOrg?.id, courseId, {
    enabled: orgGuard === 'ready' && !!currentOrg,
  });

  const categoriesQuery = useCourseCategories({ enabled: orgGuard === 'ready' });

  const { isFavorite } = useFavorites(currentOrg?.id, {
    enabled: orgGuard === 'ready' && !!currentOrg,
  });
  const { toggleFavorite, togglingId } = useToggleFavorite(currentOrg?.id);

  const course = query.data?.course;
  const modules = query.data?.modules ?? [];
  const enrollment = query.data?.enrollment;

  const isDanish = i18n.language.startsWith('da');
  const categoryName = useMemo(() => {
    if (!course?.category_id) return null;
    const match = (categoriesQuery.data ?? []).find((c) => c.id === course.category_id);
    return match ? (isDanish ? match.name_da : match.name_en) : null;
  }, [categoriesQuery.data, course?.category_id, isDanish]);

  if (orgGuard === 'loading' || query.isLoading) {
    return (
      <AppLayout headerLabel={t('nav.courses')}>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout headerLabel={t('nav.courses')}>
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <BookOpen className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <p className="text-muted-foreground">{t('common.noOrgSelected')}</p>
          <p className="text-sm text-muted-foreground">{t('courses.joinOrgToAccessCourses')}</p>
        </div>
      </AppLayout>
    );
  }

  if (query.isError || !course) {
    return (
      <AppLayout headerLabel={t('nav.courses')}>
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title={t('courses.detail.notAvailable')}
          description={t('courses.detail.notAvailableDescription')}
          className="rounded-2xl border-[#d6d8e0] bg-card"
        />
      </AppLayout>
    );
  }

  const isCompleted = enrollment?.status === 'completed';
  const ctaLabel = isCompleted
    ? t('courses.reviewCourse')
    : enrollment
      ? t('common.continue')
      : t('courses.startCourse');

  return (
    <AppLayout headerLabel={course.title}>
      <div className="mx-auto max-w-[820px]">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="relative h-[190px] bg-gradient-to-br from-primary/80 to-primary">
            {course.thumbnail_url && (
              <img
                src={course.thumbnail_url}
                alt={course.title}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
          </div>

          <div className="flex flex-col gap-4 px-6 pb-6 pt-5 md:px-8">
            <div className="flex items-start justify-between gap-3">
              <h1
                data-testid="course-detail-title"
                className="font-display text-[26px] font-extrabold leading-[1.2] tracking-[-0.02em]"
              >
                {course.title}
              </h1>
              <FavoriteToggle
                isFavorite={isFavorite(course.id)}
                pending={togglingId === course.id}
                onToggle={(next) => toggleFavorite({ courseId: course.id, favorite: next })}
                className="mt-1 h-9 w-9 shrink-0"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <LevelBadge level={course.level} />
              {categoryName && (
                <span className="inline-flex items-center rounded-[7px] bg-accent px-[11px] py-[5px] text-[11px] font-bold text-accent-foreground">
                  {categoryName}
                </span>
              )}
            </div>

            {course.description && (
              <p className="whitespace-pre-line text-[14.5px] leading-relaxed text-muted-foreground">
                {course.description}
              </p>
            )}

            {modules.length > 0 && (
              <div className="mt-1" data-testid="module-outline">
                <div className="mb-2.5 flex items-center gap-2">
                  <Layers aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-display text-[15px] font-bold">{t('courses.detail.contents')}</h2>
                </div>
                <Accordion type="single" collapsible className="flex flex-col gap-1.5">
                  {modules.map((m) =>
                    m.lessons.length > 0 ? (
                      <AccordionItem
                        key={m.id}
                        value={m.id}
                        className="rounded-xl border border-border bg-background"
                      >
                        <AccordionTrigger className="gap-3 px-4 py-3 hover:no-underline">
                          <span className="text-[13.5px] font-semibold">{m.title}</span>
                          <span className="ml-auto whitespace-nowrap text-xs font-semibold text-muted-foreground">
                            {t('courses.detail.lessonCount', { count: m.lesson_count })}
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-3 pt-0">
                          <ul className="flex flex-col gap-1.5 border-t border-border pt-3">
                            {m.lessons.map((lesson) => (
                              <li key={lesson.id} className="text-[13px] text-muted-foreground">
                                {lesson.title}
                              </li>
                            ))}
                          </ul>
                        </AccordionContent>
                      </AccordionItem>
                    ) : (
                      <div
                        key={m.id}
                        className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3"
                      >
                        <span className="text-[13.5px] font-semibold">{m.title}</span>
                        <span className="ml-auto whitespace-nowrap text-xs font-semibold text-muted-foreground">
                          {t('courses.detail.lessonCount', { count: m.lesson_count })}
                        </span>
                      </div>
                    ),
                  )}
                </Accordion>
              </div>
            )}

            <div className="mt-2">
              <Button
                asChild
                data-testid="course-detail-cta"
                className="h-auto w-full rounded-[10px] px-4 py-3 text-[14px] font-bold sm:w-auto"
              >
                <Link to={routes.learner.coursePlayer(course.id)}>
                  <Play aria-hidden="true" />
                  {ctaLabel}
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
