import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
import { PdfViewer } from '@/components/learner/PdfViewer';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { callApi } from '@/lib/api-client';
import { Course, CourseModule, Lesson, LessonProgress, Quiz, QuizQuestion, QuizOption, CourseReview } from '@/lib/types';
import { getSignedAssetUrl } from '@/lib/storage';
import {
  Check,
  CheckCircle2,
  Circle,
  Play,
  FileText,
  HelpCircle,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Star
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { CourseCompletionDialog } from '@/components/course/CourseCompletionDialog';
import { CourseReviewDialog } from '@/components/course/CourseReviewDialog';

// Minimum course progress (percent of lessons completed) before the review entry point appears.
const REVIEW_MIN_PROGRESS = 20;

export default function CoursePlayer() {
  const { courseId } = useParams<{ courseId: string }>();
  const { user, currentOrg } = useAuth();
  const { features } = usePlatformSettings();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<(CourseModule & { lessons: Lesson[] })[]>([]);
  const [progress, setProgress] = useState<Record<string, LessonProgress>>({});
  const [currentLesson, setCurrentLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [completingLesson, setCompletingLesson] = useState(false);
  // Lessons completed DURING this session — only these get the pop-in celebration.
  // Lessons already completed on load render the completed state with no animation.
  const [justCompletedIds, setJustCompletedIds] = useState<Set<string>>(new Set());

  // Quiz state
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<(QuizQuestion & { options: QuizOption[] })[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState(0);

  // Signed URLs for secure content access
  const [signedVideoUrl, setSignedVideoUrl] = useState<string | null>(null);
  const [signedDocUrl, setSignedDocUrl] = useState<string | null>(null);
  const [azureVideoUrl, setAzureVideoUrl] = useState<string | null>(null);
  const [azureDocUrl, setAzureDocUrl] = useState<string | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(false);

  // Course completion and review state
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [existingReview, setExistingReview] = useState<CourseReview | null>(null);
  const [courseJustCompleted, setCourseJustCompleted] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!user || !currentOrg || !courseId) return;

      try {
        const data = await callApi<{
          course: Course;
          modules: Array<CourseModule & { lessons: Lesson[] }>;
          progressMap: Record<string, { status: string; completed_at: string }>;
          review: { id: string; rating: number; comment: string } | null;
        }>('/api/course-player-data', { courseId, orgId: currentOrg.id });

        setCourse(data.course);
        setModules(data.modules as any);
        setProgress(data.progressMap as any);
        setExistingReview(data.review as any);

        if (data.modules.length > 0 && data.modules[0].lessons.length > 0) {
          setCurrentLesson(data.modules[0].lessons[0] as Lesson);
        }
      } catch (error) {
        // 403 (no org access to this course), 404, or a transient failure. Leave course null so
        // the "not found" empty state renders with a Back button instead of a frozen spinner.
        console.error('Error loading course:', error);
        toast({
          title: 'Unable to open course',
          description: 'You may not have access to this course, or it is unavailable.',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user, currentOrg, courseId]);

  // Load quiz when lesson changes - single endpoint, no is_correct exposed
  useEffect(() => {
    const loadQuiz = async () => {
      if (!currentLesson || currentLesson.lesson_type !== 'quiz') {
        setQuiz(null);
        setQuestions([]);
        setAnswers({});
        setQuizSubmitted(false);
        return;
      }

      try {
        const data = await callApi<{
          quiz: Quiz | null;
          questions: Array<QuizQuestion & { options: QuizOption[] }>;
        }>('/api/quiz-by-lesson', { lessonId: currentLesson.id });

        if (data.quiz) {
          setQuiz(data.quiz as Quiz);
          setQuestions(data.questions as any);
        } else {
          setQuiz(null);
          setQuestions([]);
          setAnswers({});
          setQuizSubmitted(false);
        }
      } catch (error) {
        console.error('Error loading quiz:', error);
        setQuiz(null);
        setQuestions([]);
        setAnswers({});
        setQuizSubmitted(false);
      }
    };

    loadQuiz();
  }, [currentLesson]);

  // Load signed URLs for secure content access when lesson changes
  useEffect(() => {
    const loadSignedUrls = async () => {
      if (!currentLesson) {
        setSignedVideoUrl(null);
        setSignedDocUrl(null);
        setAzureVideoUrl(null);
        setAzureDocUrl(null);
        return;
      }

      setLoadingAssets(true);
      try {
        // Check for Azure blob path first (preferred for videos)
        if (currentLesson.azure_blob_path) {
          const data = await callApi<{ viewUrl: string }>('/api/azure-view-url', {
            blobPath: currentLesson.azure_blob_path, lessonId: currentLesson.id,
          });

          if (data?.viewUrl) {
            setAzureVideoUrl(data.viewUrl);
          } else {
            setAzureVideoUrl(null);
          }
          setSignedVideoUrl(null);
        } else if (currentLesson.video_storage_path) {
          // Fallback to legacy storage path for older videos
          const videoUrl = await getSignedAssetUrl(currentLesson.video_storage_path);
          setSignedVideoUrl(videoUrl);
          setAzureVideoUrl(null);
        } else {
          setSignedVideoUrl(null);
          setAzureVideoUrl(null);
        }

        // Load document URL - check if it's an Azure path (starts with 'documents/')
        if (currentLesson.document_storage_path) {
          if (currentLesson.document_storage_path.startsWith('documents/')) {
            // Azure-stored document
            const data = await callApi<{ viewUrl: string }>('/api/azure-view-url', {
              blobPath: currentLesson.document_storage_path, lessonId: currentLesson.id,
            });

            if (data?.viewUrl) {
              setAzureDocUrl(data.viewUrl);
            } else {
              setAzureDocUrl(null);
            }
            setSignedDocUrl(null);
          } else {
            // Legacy storage-path document
            const docUrl = await getSignedAssetUrl(currentLesson.document_storage_path);
            setSignedDocUrl(docUrl);
            setAzureDocUrl(null);
          }
        } else {
          setSignedDocUrl(null);
          setAzureDocUrl(null);
        }
      } catch (error) {
        console.error('Error loading signed URLs:', error);
      } finally {
        setLoadingAssets(false);
      }
    };

    loadSignedUrls();
  }, [currentLesson]);

  const handleSelectLesson = (lesson: Lesson) => {
    setCurrentLesson(lesson);
    setQuizSubmitted(false);
    setAnswers({});
  };

  const handleCompleteLesson = async () => {
    if (!user || !currentOrg || !currentLesson) return;

    setCompletingLesson(true);
    try {
      // Upsert progress
      try {
        await callApi('/api/lesson-progress', { orgId: currentOrg.id, lessonId: currentLesson.id, status: 'completed' });
      } catch {
        return;
      }

      const newProgress = {
        ...progress,
        [currentLesson.id]: {
          id: '',
          org_id: currentOrg.id,
          user_id: user.id,
          lesson_id: currentLesson.id,
          status: 'completed' as const,
          completed_at: new Date().toISOString(),
        }
      };
      setProgress(newProgress);
      setJustCompletedIds(prev => new Set(prev).add(currentLesson.id));

      // Check if this completes the course. Count completed lessons of THIS course
      // only — the progress map from course-player-data spans every course in the
      // org, so counting all of it misattributed foreign progress to this course (#18).
      const allLessons = modules.flatMap(m => m.lessons);
      const completedCount = allLessons.filter(l => newProgress[l.id]?.status === 'completed').length;
      const isCourseComplete = allLessons.length > 0 && completedCount >= allLessons.length;

      if (isCourseComplete && !courseJustCompleted) {
        // Record completion server-side BEFORE celebrating — enrollments.status /
        // completed_at is what the dashboard count and the course cards read. A
        // failed or silently no-op'd call here left the course stuck on
        // "Continue" / "Completed 0" forever with no feedback (#18).
        try {
          await callApi('/api/enrollment-complete', { orgId: currentOrg.id, courseId });
        } catch (error) {
          console.error('Error recording course completion:', error);
          toast({
            title: t('coursePlayer.completionSaveFailed'),
            description: t('coursePlayer.completionSaveFailedDescription'),
            variant: 'destructive',
          });
          return;
        }
        setCourseJustCompleted(true);
        setShowCompletionDialog(true);
      } else {
        // Routine confirmation: the sidebar status dot pops in green (and the
        // footer shows the Completed badge) — no success toast.

        // Auto-advance to next lesson if not last
        const currentIndex = allLessons.findIndex(l => l.id === currentLesson.id);
        if (currentIndex < allLessons.length - 1) {
          setCurrentLesson(allLessons[currentIndex + 1]);
        }
      }
    } finally {
      setCompletingLesson(false);
    }
  };

  const handleSubmitQuiz = async () => {
    if (!quiz || !user || !currentOrg) return;

    // Grade quiz server-side — attempts inserted server-side, never trust client score
    let gradeResult: { score: number; passed: boolean };
    try {
      gradeResult = await callApi<{ score: number; passed: boolean }>('/api/grade-quiz', {
        quiz_id: quiz.id,
        answers,
      });
    } catch {
      toast({
        title: 'Failed to grade quiz',
        description: 'An error occurred while grading your quiz. Please try again.',
        variant: 'destructive',
      });
      return;
    }

    const { score, passed } = gradeResult;

    setQuizScore(score);
    setQuizSubmitted(true);

    if (!passed) {
      toast({
        title: 'Quiz not passed',
        description: `You scored ${score}%. You need ${quiz.passing_score}% to pass. Try again!`,
        variant: 'destructive',
      });
    }
    // If passed, user will see success UI and can click "Mark as Complete" manually
  };

  // Per-course progress: only lessons of THIS course count — the progress map
  // from course-player-data spans every course in the org (#18).
  const allLessons = modules.flatMap(m => m.lessons);
  const totalLessons = allLessons.length;
  const completedLessons = allLessons.filter(l => progress[l.id]?.status === 'completed').length;
  const progressPercent = totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0;
  const currentIndex = currentLesson ? allLessons.findIndex(l => l.id === currentLesson.id) : -1;

  const lessonIcon = (type: string) => {
    switch (type) {
      case 'video': return <Play className="h-3.5 w-3.5" />;
      case 'document': return <FileText className="h-3.5 w-3.5" />;
      case 'quiz': return <HelpCircle className="h-3.5 w-3.5" />;
      default: return <Circle className="h-3.5 w-3.5" />;
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!course) {
    return (
      <AppLayout>
        <div className="py-12 text-center">
          <p className="text-muted-foreground">{t('coursePlayer.courseNotFound')}</p>
          <Button className="mt-4" onClick={() => navigate('/app/courses')}>
            {t('coursePlayer.backToCourses')}
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      breadcrumbs={[
        { label: t('nav.courses'), href: '/app/courses' },
        { label: course.title },
      ]}
    >
      <div className="grid items-start gap-5 lg:grid-cols-[320px,1fr]">
        {/* Sidebar - Module List */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-[#eceef3] px-[18px] pb-3.5 pt-[18px]">
            <h2 className="mb-3 font-display text-[15px] font-extrabold leading-[1.3]">{course.title}</h2>
            <div className="mb-[7px] flex justify-between text-xs font-semibold text-muted-foreground">
              <span>{t('courses.progress')}</span>
              <span className="text-foreground">
                {completedLessons}/{totalLessons} · {Math.round(progressPercent)}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#eceef3]">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {features.course_reviews_enabled && progressPercent >= REVIEW_MIN_PROGRESS && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3.5 w-full rounded-[10px] text-[12.5px] font-bold"
                onClick={() => setShowReviewDialog(true)}
              >
                <Star aria-hidden="true" className="mr-2 h-4 w-4" />
                {existingReview ? t('coursePlayer.editYourReview') : t('coursePlayer.rateThisCourse')}
              </Button>
            )}
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {modules.map((module, moduleIndex) => (
              <div key={module.id}>
                <div className="bg-[#f7f8fa] px-[18px] py-[9px] text-[11.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                  {t('coursePlayer.moduleHeader', { number: moduleIndex + 1, title: module.title })}
                </div>
                {module.lessons.map((lesson) => {
                  const isCompleted = progress[lesson.id]?.status === 'completed';
                  const isCurrent = currentLesson?.id === lesson.id;

                  return (
                    <button
                      key={lesson.id}
                      onClick={() => handleSelectLesson(lesson)}
                      className={cn(
                        'flex w-full items-center gap-[11px] border-l-[3px] px-[18px] py-[11px] text-left transition-colors',
                        isCurrent ? 'border-l-primary bg-accent' : 'border-l-transparent hover:bg-[#f3f4f8]',
                      )}
                    >
                      <span
                        className={cn(
                          'grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full',
                          isCompleted
                            ? 'bg-success text-success-foreground'
                            : 'bg-[#eceef3] text-muted-foreground',
                          isCompleted && justCompletedIds.has(lesson.id) && 'animate-pop-in'
                        )}
                      >
                        {isCompleted ? (
                          <Check aria-hidden="true" className="h-3.5 w-3.5" />
                        ) : (
                          lessonIcon(lesson.lesson_type)
                        )}
                      </span>
                      <span
                        className={cn(
                          'flex-1 text-[13px] font-semibold',
                          isCompleted && !isCurrent ? 'text-[#9aa0af]' : 'text-foreground'
                        )}
                      >
                        {lesson.title}
                      </span>
                      {lesson.duration_minutes != null && (
                        <span className="text-[11px] text-[#9aa0af]">
                          {t('coursePlayer.durationMinutes', { minutes: lesson.duration_minutes })}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Main Content */}
        {currentLesson ? (
          <div className="rounded-2xl border border-border bg-card px-[26px] py-6">
            <div className="mb-[18px] flex items-center gap-2.5">
              <span className="rounded-[7px] bg-accent px-[11px] py-[5px] text-[11px] font-bold uppercase tracking-[0.06em] text-accent-foreground">
                {t(`coursePlayer.lessonTypes.${currentLesson.lesson_type}`)}
              </span>
              <h2 className="font-display text-lg font-extrabold">{currentLesson.title}</h2>
            </div>

            {/* Lesson content based on type */}
            {currentLesson.lesson_type === 'video' && (
              <div className="space-y-4">
                <div className="flex aspect-video items-center justify-center overflow-hidden rounded-[14px] bg-muted">
                  {loadingAssets ? (
                    <div className="text-center text-muted-foreground">
                      <Loader2 className="mx-auto mb-2 h-12 w-12 animate-spin" />
                      <p>{t('coursePlayer.loadingVideo')}</p>
                    </div>
                  ) : azureVideoUrl ? (
                    <video
                      key={azureVideoUrl}
                      controls
                      className="h-full w-full"
                      src={azureVideoUrl}
                    />
                  ) : signedVideoUrl ? (
                    <video
                      key={signedVideoUrl}
                      controls
                      className="h-full w-full"
                      src={signedVideoUrl}
                    />
                  ) : currentLesson.azure_blob_path || currentLesson.video_storage_path ? (
                    <div className="text-center text-muted-foreground">
                      <Play className="mx-auto mb-2 h-12 w-12" />
                      <p>{t('coursePlayer.videoLoadFailed')}</p>
                    </div>
                  ) : (
                    <div className="text-center text-muted-foreground">
                      <Play className="mx-auto mb-2 h-12 w-12" />
                      <p>{t('coursePlayer.noVideo')}</p>
                    </div>
                  )}
                </div>
                {currentLesson.content_text && (
                  <p className="text-[13.5px] leading-relaxed text-muted-foreground">{currentLesson.content_text}</p>
                )}
              </div>
            )}

            {currentLesson.lesson_type === 'document' && (
              <div className="space-y-4">
                {currentLesson.content_text && (
                  <div className="prose prose-sm max-w-none">
                    <p>{currentLesson.content_text}</p>
                  </div>
                )}
                {loadingAssets ? (
                  <div className="flex items-center justify-center rounded-[14px] border bg-muted/50 py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <span className="ml-3 text-muted-foreground">{t('coursePlayer.loadingDocument')}</span>
                  </div>
                ) : (signedDocUrl || azureDocUrl) ? (
                  <div className="overflow-hidden rounded-[14px] border">
                    <PdfViewer url={azureDocUrl || signedDocUrl || ''} />
                  </div>
                ) : currentLesson.document_storage_path ? (
                  <div className="flex items-center justify-center rounded-[14px] border bg-muted/50 py-12">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                    <span className="ml-3 text-muted-foreground">{t('coursePlayer.documentLoadFailed')}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center rounded-[14px] border bg-muted/50 py-12">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                    <span className="ml-3 text-muted-foreground">{t('coursePlayer.noDocument')}</span>
                  </div>
                )}
              </div>
            )}

            {currentLesson.lesson_type === 'quiz' && quiz && (
              <div className="space-y-6">
                {quizSubmitted ? (
                  <div
                    className={cn(
                      'rounded-[14px] p-7 text-center',
                      quizScore >= quiz.passing_score ? 'bg-[#e7f6ef]' : 'bg-[#fdecec]'
                    )}
                  >
                    <span
                      className={cn(
                        'block text-[38px] font-extrabold',
                        quizScore >= quiz.passing_score ? 'text-success' : 'text-[#c43d3d]'
                      )}
                    >
                      {quizScore}%
                    </span>
                    <p
                      className={cn(
                        'mb-3.5 mt-1.5 text-[13.5px] font-semibold',
                        quizScore >= quiz.passing_score ? 'text-success' : 'text-[#c43d3d]'
                      )}
                    >
                      {quizScore >= quiz.passing_score
                        ? t('coursePlayer.quizPassedMessage')
                        : t('coursePlayer.quizFailedMessage', { score: quiz.passing_score })}
                    </p>
                    {quizScore >= quiz.passing_score ? (
                      progress[currentLesson.id]?.status === 'completed' ? (
                        (() => {
                          const isLastLesson = currentIndex >= allLessons.length - 1;

                          // Find current module and check if this is the last lesson in the module
                          const currentModule = modules.find(m => m.lessons.some(l => l.id === currentLesson.id));
                          const isLastInModule = currentModule &&
                            currentModule.lessons[currentModule.lessons.length - 1]?.id === currentLesson.id;

                          const buttonText = isLastLesson
                            ? t('coursePlayer.finishCourse')
                            : isLastInModule
                              ? t('coursePlayer.nextModule')
                              : t('coursePlayer.nextLesson');

                          return (
                            <div className="space-y-3">
                              <span
                                className={cn(
                                  'inline-flex items-center gap-[5px] rounded-[7px] bg-success/15 px-[11px] py-[5px] text-xs font-bold text-success',
                                  justCompletedIds.has(currentLesson.id) && 'animate-pop-in'
                                )}
                              >
                                <CheckCircle2 aria-hidden="true" className="h-3 w-3" />
                                {t('coursePlayer.lessonComplete')}
                              </span>
                              <div>
                                <Button
                                  className="h-auto rounded-[10px] px-[18px] py-2.5 text-[13.5px] font-bold"
                                  onClick={() => {
                                    if (isLastLesson) {
                                      navigate('/app/courses');
                                    } else {
                                      setCurrentLesson(allLessons[currentIndex + 1]);
                                      setQuizSubmitted(false);
                                      setAnswers({});
                                    }
                                  }}
                                >
                                  {buttonText}
                                  <ArrowRight aria-hidden="true" />
                                </Button>
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        <Button
                          onClick={() => handleCompleteLesson()}
                          disabled={completingLesson}
                          className="h-auto rounded-[10px] px-[18px] py-2.5 text-[13.5px] font-bold"
                        >
                          {completingLesson ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <CheckCircle2 aria-hidden="true" />
                          )}
                          {t('coursePlayer.markAsComplete')}
                        </Button>
                      )
                    ) : (
                      <Button
                        variant="outline"
                        className="h-auto rounded-[10px] border-[#dcdee6] bg-card px-4 py-[9px] text-[13px] font-bold"
                        onClick={() => {
                          setQuizSubmitted(false);
                          setAnswers({});
                        }}
                      >
                        {t('coursePlayer.tryAgain')}
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    {questions.length > 0 && (
                      <p className="text-[13px] text-muted-foreground">
                        {t('coursePlayer.quizIntro', { total: questions.length, score: quiz.passing_score })}
                      </p>
                    )}
                    <div className="flex flex-col gap-4">
                      {questions.map((question, qIndex) => (
                        <div key={question.id} className="rounded-[14px] border border-border px-5 py-[18px]">
                          <p className="mb-3 text-sm font-bold">
                            {qIndex + 1}. {question.question_text}
                          </p>
                          <div className="flex flex-col gap-[7px]">
                            {question.options.map((option) => (
                              <label
                                key={option.id}
                                className={cn(
                                  'flex cursor-pointer items-center gap-2.5 rounded-[10px] border px-[13px] py-2.5 text-[13px] font-medium transition-colors',
                                  answers[question.id] === option.id
                                    ? 'border-primary bg-accent'
                                    : 'border-border bg-card hover:bg-muted/50'
                                )}
                              >
                                <input
                                  type="radio"
                                  name={question.id}
                                  value={option.id}
                                  checked={answers[question.id] === option.id}
                                  onChange={() => setAnswers(prev => ({
                                    ...prev,
                                    [question.id]: option.id
                                  }))}
                                  className="sr-only"
                                />
                                <span
                                  aria-hidden="true"
                                  className={cn(
                                    'h-[15px] w-[15px] shrink-0 rounded-full border-2',
                                    answers[question.id] === option.id
                                      ? 'border-primary bg-primary shadow-[inset_0_0_0_2.5px_#fff]'
                                      : 'border-[#c9cdd9] bg-card'
                                  )}
                                />
                                <span>{option.option_text}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <Button
                      onClick={handleSubmitQuiz}
                      disabled={Object.keys(answers).length !== questions.length}
                      className="h-auto rounded-[11px] px-5 py-[11px] text-[13.5px] font-bold"
                    >
                      {t('coursePlayer.submitAnswers')}
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Footer: Previous / Mark as complete · Completed badge / Next (non-quiz lessons) */}
            {currentLesson.lesson_type !== 'quiz' && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#eceef3] pt-[18px]">
                <Button
                  variant="outline"
                  className="rounded-[10px] border-[#dcdee6] text-[13px] font-bold"
                  onClick={() => {
                    if (currentIndex > 0) {
                      setCurrentLesson(allLessons[currentIndex - 1]);
                    }
                  }}
                  disabled={currentIndex === 0}
                >
                  <ArrowLeft aria-hidden="true" />
                  {t('common.previous')}
                </Button>

                {progress[currentLesson.id]?.status === 'completed' ? (
                  <span
                    className={cn(
                      'inline-flex items-center gap-[7px] text-[13.5px] font-bold text-success',
                      justCompletedIds.has(currentLesson.id) && 'animate-pop-in'
                    )}
                  >
                    <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                    {t('coursePlayer.completed')}
                  </span>
                ) : (
                  <Button
                    onClick={() => handleCompleteLesson()}
                    disabled={completingLesson}
                    className="h-auto rounded-[10px] px-[18px] py-2.5 text-[13.5px] font-bold"
                  >
                    {completingLesson ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <CheckCircle2 aria-hidden="true" />
                    )}
                    {t('coursePlayer.markAsComplete')}
                  </Button>
                )}

                <Button
                  variant="outline"
                  className="rounded-[10px] border-[#dcdee6] text-[13px] font-bold"
                  onClick={() => {
                    if (currentIndex < allLessons.length - 1) {
                      setCurrentLesson(allLessons[currentIndex + 1]);
                    }
                  }}
                  disabled={currentIndex >= allLessons.length - 1}
                >
                  {t('common.next')}
                  <ArrowRight aria-hidden="true" />
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card py-12 text-center">
            <p className="text-muted-foreground">{t('coursePlayer.selectLessonToBegin')}</p>
          </div>
        )}
      </div>

      {/* Course Completion Dialog */}
      {course && (
        <CourseCompletionDialog
          open={showCompletionDialog}
          onOpenChange={setShowCompletionDialog}
          courseTitle={course.title}
          onLeaveReview={() => setShowReviewDialog(true)}
        />
      )}

      {/* Course Review Dialog */}
      {course && user && currentOrg && (
        <CourseReviewDialog
          open={showReviewDialog}
          onOpenChange={setShowReviewDialog}
          courseId={course.id}
          courseTitle={course.title}
          orgId={currentOrg.id}
          existingReview={existingReview ? {
            id: existingReview.id,
            rating: existingReview.rating,
            comment: existingReview.comment,
          } : undefined}
          onReviewSubmitted={() => {
            callApi<{ course: Course; modules: any; progressMap: any; review: any } | null>(
              '/api/course-player-data', { courseId: course.id, orgId: currentOrg.id }
            )
              .then(data => { if (data?.review) setExistingReview(data.review as any); })
              // Endpoint can now 403 (access revoked mid-session) — don't leave the rejection unhandled.
              .catch(error => { console.error('Error refreshing review:', error); });
          }}
        />
      )}
    </AppLayout>
  );
}
