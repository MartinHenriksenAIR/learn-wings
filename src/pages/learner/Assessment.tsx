import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Loader2, Play } from 'lucide-react';
import logoLightDa from '@/assets/logo-light.png';
import logoLightEn from '@/assets/logo-light-en.png';
import i18n from '@/i18n';
import { Button } from '@/components/ui/button';
import { LevelBadge, LEVEL_STYLES } from '@/components/ui/level-badge';
import { toast } from '@/components/ui/sonner';
import { useAuth } from '@/hooks/useAuth';
import { useAssessmentQuestions } from '@/hooks/useAssessmentQuestions';
import { useLearnerCourses } from '@/hooks/useLearnerCourses';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { Course, CourseLevel, Enrollment } from '@/lib/types';
import { cn } from '@/lib/utils';

const MAX_SCORE = 21;
const LEVEL_ORDER: CourseLevel[] = ['basic', 'intermediate', 'advanced'];

interface AssessmentResult {
  score: number;
  level: CourseLevel;
}

// ── Score ring ───────────────────────────────────────────────────────────────
// A drawn SVG progress ring (NOT an icon) showing score / MAX_SCORE, its arc
// stroked with the same per-level color LevelBadge uses.
function ScoreRing({ score, level }: { score: number; level: CourseLevel }) {
  const size = 132;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.max(0, Math.min(1, score / MAX_SCORE));
  const color = LEVEL_STYLES[level].fg;

  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e6e8f0"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[30px] font-extrabold leading-none" style={{ color }}>
          {score}
        </span>
        <span className="text-[13px] font-semibold text-muted-foreground">/ {MAX_SCORE}</span>
      </div>
    </div>
  );
}

// ── Top row (logo + skip) ────────────────────────────────────────────────────
function TopRow({ onSkip, skipDisabled }: { onSkip?: () => void; skipDisabled?: boolean }) {
  const { t } = useTranslation();
  const logo = i18n.language === 'da' ? logoLightDa : logoLightEn;
  return (
    <div className="mx-auto flex w-full max-w-[960px] items-center justify-between px-4 pt-6">
      <img
        src={logo}
        alt={i18n.language === 'da' ? 'AI Uddannelse' : 'AI Education'}
        className="h-9 w-auto object-contain"
      />
      {onSkip && (
        <Button
          variant="ghost"
          onClick={onSkip}
          disabled={skipDisabled}
          className="h-auto rounded-lg px-3 py-2 text-[13.5px] font-semibold text-muted-foreground hover:text-primary"
        >
          {skipDisabled && <Loader2 className="animate-spin" />}
          {t('assessment.skip')}
        </Button>
      )}
    </div>
  );
}

// ── Wizard ───────────────────────────────────────────────────────────────────
function Wizard({ onComplete }: { onComplete: (result: AssessmentResult) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { refreshUserContext } = useAuth();
  const { data, isLoading, isError, refetch } = useAssessmentQuestions();

  const questions = data?.questions ?? [];
  const total = questions.length;

  const [index, setIndex] = useState(0);
  // questionId -> selected optionId
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  // Move focus to the question heading whenever the question changes so
  // screen-reader users hear the new question without manual navigation.
  useEffect(() => {
    questionHeadingRef.current?.focus();
  }, [index]);

  const submitMutation = useMutation({
    mutationFn: (payload: Record<string, string>) =>
      callApi<AssessmentResult>('/api/assessment-submit', { answers: payload }),
    onSuccess: async (result) => {
      toast({ title: t('assessment.toasts.saved') });
      await refreshUserContext();
      onComplete(result);
    },
    onError: (error) => {
      toast({
        title: t('assessment.error.title'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    },
  });

  const skipMutation = useMutation({
    mutationFn: () => callApi<{ skipped_at: string }>('/api/assessment-skip', {}),
    onSuccess: async () => {
      toast({ title: t('assessment.toasts.skipped') });
      await refreshUserContext();
      navigate(routes.learner.dashboard);
    },
    onError: (error) => {
      toast({
        title: t('assessment.error.title'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    },
  });

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || total === 0) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-muted-foreground">{t('assessment.error.title')}</p>
          <Button onClick={() => refetch()}>{t('assessment.error.retry')}</Button>
        </div>
      </div>
    );
  }

  const question = questions[index];
  const selected = answers[question.id];
  const isLast = index === total - 1;
  const canGoBack = index > 0;

  const handleSelect = (optionId: string) => {
    setAnswers((prev) => ({ ...prev, [question.id]: optionId }));
  };

  const handleNext = () => {
    if (!selected) return;
    if (isLast) {
      submitMutation.mutate(answers);
    } else {
      setIndex((i) => i + 1);
    }
  };

  const handleBack = () => {
    if (canGoBack) setIndex((i) => i - 1);
  };

  const progress = (index + 1) / total;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopRow onSkip={() => skipMutation.mutate()} skipDisabled={skipMutation.isPending || submitMutation.isPending} />

      <div className="mx-auto flex w-full max-w-[600px] flex-1 flex-col px-4 pb-16 pt-10">
        {/* Meta row */}
        <div className="mb-2 flex items-center justify-between text-[12.5px] font-semibold text-muted-foreground">
          <span>{t('assessment.questionOf', { current: index + 1, total })}</span>
          <span>{t('assessment.timeEstimate')}</span>
        </div>

        {/* Progress bar — tracks which question you're on (1-based), intentionally
            matches the "Spørgsmål N af 7" label above. */}
        <div className="mb-8 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {/* Keyed by question id: the entrance animation replays only on question
            change, never when an option is selected (which re-renders in place). */}
        <div
          key={question.id}
          className="animate-in fade-in slide-in-from-right-4 duration-300"
        >
          <h1
            ref={questionHeadingRef}
            id="assessment-question-heading"
            tabIndex={-1}
            className="mb-6 font-display text-[24px] font-extrabold leading-[1.3] tracking-[-0.02em]"
          >
            {t(`assessment.questions.${question.id}.text`)}
          </h1>

          <div className="flex flex-col gap-3" role="radiogroup" aria-labelledby="assessment-question-heading">
            {question.options.map((optionId) => {
              const isSelected = selected === optionId;
              return (
                <button
                  key={optionId}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => handleSelect(optionId)}
                  className={cn(
                    'flex items-center gap-3 rounded-2xl border px-4 py-4 text-left text-[14.5px] font-medium transition-colors',
                    isSelected
                      ? 'border-primary bg-accent text-foreground'
                      : 'border-border bg-card text-foreground hover:border-primary/40',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                      isSelected ? 'border-primary' : 'border-muted-foreground/40',
                    )}
                  >
                    {isSelected && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  {t(`assessment.questions.${question.id}.options.${optionId}`)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-10 flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={!canGoBack}
            className="h-auto gap-1.5 rounded-xl px-3 py-2.5 text-[14px] font-semibold text-muted-foreground disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('assessment.back')}
          </Button>
          <Button
            onClick={handleNext}
            disabled={!selected || submitMutation.isPending}
            className="h-auto gap-1.5 rounded-xl px-5 py-2.5 text-[14px] font-semibold"
          >
            {submitMutation.isPending && <Loader2 className="animate-spin" />}
            {isLast ? t('assessment.seeResult') : t('assessment.next')}
            {!isLast && <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Result: recommended course row ───────────────────────────────────────────
function RecommendedRow({
  course,
  enrollment,
  currentOrgId,
}: {
  course: Course;
  enrollment: Enrollment | undefined;
  currentOrgId: string | undefined;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const enrollMutation = useMutation({
    mutationFn: ({ orgId, courseId }: { orgId: string; courseId: string }) =>
      callApi('/api/enroll', { orgId, courseId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.learnerCourses.list(currentOrgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.learnerDashboard.detail(currentOrgId) });
      navigate(routes.learner.coursePlayer(course.id));
    },
    onError: (error) => {
      toast({
        title: t('courses.enrollmentFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    },
  });

  const handleStart = () => {
    if (enrollment) {
      navigate(routes.learner.coursePlayer(course.id));
      return;
    }
    if (!currentOrgId) return;
    enrollMutation.mutate({ orgId: currentOrgId, courseId: course.id });
  };

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
      <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary/80 to-primary">
        {course.thumbnail_url && (
          <img
            src={course.thumbnail_url}
            alt={course.title}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="truncate text-[14px] font-bold leading-tight">{course.title}</h3>
        <LevelBadge level={course.level} className="self-start" />
      </div>
      <Button
        onClick={handleStart}
        disabled={enrollMutation.isPending}
        className="h-auto shrink-0 gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-bold"
      >
        {enrollMutation.isPending ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Play aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        {t('assessment.result.startCourse')}
      </Button>
    </div>
  );
}

// ── Result view (variant B split) ────────────────────────────────────────────
function ResultView({ result }: { result: AssessmentResult }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentOrg } = useAuth();
  const coursesQuery = useLearnerCourses(currentOrg?.id);

  const courses = coursesQuery.data?.courses;
  const enrollments = coursesQuery.data?.enrollments;

  // Level-matching courses first; if fewer than 3, fill with nearest-level
  // courses (by distance in the basic→intermediate→advanced order) so the
  // column is never empty. No new backend — pure client ordering.
  const recommended = useMemo(() => {
    const resultRank = LEVEL_ORDER.indexOf(result.level);
    const sorted = [...(courses ?? [])].sort((a, b) => {
      const da = Math.abs(LEVEL_ORDER.indexOf(a.level) - resultRank);
      const db = Math.abs(LEVEL_ORDER.indexOf(b.level) - resultRank);
      return da - db;
    });
    return sorted.slice(0, 3);
  }, [courses, result.level]);

  const enrollmentByCourse = useMemo(() => {
    const map = new Map<string, Enrollment>();
    for (const e of enrollments ?? []) map.set(e.course_id, e);
    return map;
  }, [enrollments]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopRow />

      <div className="mx-auto grid w-full max-w-[960px] flex-1 gap-8 px-4 pb-16 pt-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Left card */}
        <div className="flex flex-col items-center rounded-3xl border border-border bg-card p-8 text-center">
          <span className="mb-5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {t('assessment.result.eyebrow')}
          </span>
          <ScoreRing score={result.score} level={result.level} />
          <span className="mt-4 text-[13.5px] font-semibold text-muted-foreground">
            {t('assessment.result.scoreOf', { score: result.score, max: MAX_SCORE })}
          </span>
          <h1 className="mt-5 font-display text-[26px] font-extrabold tracking-[-0.02em]">
            {t(`assessment.result.personas.${result.level}`)}
          </h1>
          <LevelBadge level={result.level} className="mt-3" />
          <p className="mt-5 text-left text-[14px] leading-[1.6] text-muted-foreground">
            {t(`assessment.result.blurbs.${result.level}`)}
          </p>
          <Button
            onClick={() => navigate(routes.learner.dashboard)}
            className="mt-7 h-auto w-full rounded-xl px-5 py-3 text-[14.5px] font-semibold"
          >
            {t('assessment.result.goToDashboard')}
          </Button>
        </div>

        {/* Right column */}
        <div className="flex flex-col">
          <h2 className="mb-4 font-display text-[19px] font-extrabold tracking-[-0.01em]">
            {t('assessment.result.startHere')}
          </h2>
          {coursesQuery.isLoading ? (
            <div className="grid flex-1 place-items-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {recommended.map((course) => (
                <RecommendedRow
                  key={course.id}
                  course={course}
                  enrollment={enrollmentByCourse.get(course.id)}
                  currentOrgId={currentOrg?.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Assessment() {
  const [result, setResult] = useState<AssessmentResult | null>(null);

  if (result) {
    return <ResultView result={result} />;
  }
  return <Wizard onComplete={setResult} />;
}
