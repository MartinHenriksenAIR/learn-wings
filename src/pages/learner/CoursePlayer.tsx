import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageSpinner } from '@/components/ui/page-spinner';
import { PdfViewer } from '@/components/learner/PdfViewer';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { callApi } from '@/lib/api-client';
import { Course, CourseModule, Lesson, LessonProgress, Quiz, QuizQuestion, QuizOption, CourseReview } from '@/lib/types';
import { getSignedAssetUrl } from '@/lib/storage';
import {
  ChevronRight,
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
        toast({
          title: 'Lesson completed!',
          description: 'Great job! Keep up the momentum.',
        });

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

  const totalLessons = modules.reduce((acc, m) => acc + m.lessons.length, 0);
  const completedLessons = Object.values(progress).filter(p => p.status === 'completed').length;
  const progressPercent = totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0;

  const lessonIcon = (type: string) => {
    switch (type) {
      case 'video': return <Play className="h-4 w-4" />;
      case 'document': return <FileText className="h-4 w-4" />;
      case 'quiz': return <HelpCircle className="h-4 w-4" />;
      default: return <Circle className="h-4 w-4" />;
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
        <div className="text-center py-12">
          <p className="text-muted-foreground">Course not found</p>
          <Button className="mt-4" onClick={() => navigate('/app/courses')}>
            Back to Courses
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      breadcrumbs={[
        { label: 'Courses', href: '/app/courses' },
        { label: course.title },
      ]}
    >
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sidebar - Module List */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{course.title}</CardTitle>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium">{completedLessons}/{totalLessons}</span>
                </div>
                <Progress value={progressPercent} className="h-2" />
              </div>
              {features.course_reviews_enabled && progressPercent >= REVIEW_MIN_PROGRESS && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => setShowReviewDialog(true)}
                >
                  <Star className="mr-2 h-4 w-4" />
                  {existingReview ? 'Edit your review' : 'Rate this course'}
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-y-auto">
                {modules.map((module, moduleIndex) => (
                  <div key={module.id}>
                    <div className="bg-muted/50 px-4 py-2 text-sm font-medium">
                      Module {moduleIndex + 1}: {module.title}
                    </div>
                    {module.lessons.map((lesson) => {
                      const isCompleted = progress[lesson.id]?.status === 'completed';
                      const isCurrent = currentLesson?.id === lesson.id;

                      return (
                        <button
                          key={lesson.id}
                          onClick={() => handleSelectLesson(lesson)}
                          className={cn(
                            'flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50',
                            isCurrent && 'bg-accent/10 border-l-2 border-accent',
                          )}
                        >
                          <div className={cn(
                            'flex h-6 w-6 items-center justify-center rounded-full',
                            isCompleted ? 'bg-success text-success-foreground' : 'bg-muted'
                          )}>
                            {isCompleted ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : (
                              lessonIcon(lesson.lesson_type)
                            )}
                          </div>
                          <span className={cn(isCompleted && 'text-muted-foreground')}>
                            {lesson.title}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-2">
          {currentLesson ? (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {currentLesson.lesson_type}
                  </Badge>
                  <CardTitle>{currentLesson.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {/* Lesson content based on type */}
                {currentLesson.lesson_type === 'video' && (
                  <div className="space-y-4">
                    <div className="aspect-video rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                      {loadingAssets ? (
                        <div className="text-center text-muted-foreground">
                          <Loader2 className="mx-auto h-12 w-12 mb-2 animate-spin" />
                          <p>Loading video...</p>
                        </div>
                      ) : azureVideoUrl ? (
                        <video
                          key={azureVideoUrl}
                          controls
                          className="w-full h-full rounded-lg"
                          src={azureVideoUrl}
                        />
                      ) : signedVideoUrl ? (
                        <video
                          key={signedVideoUrl}
                          controls
                          className="w-full h-full rounded-lg"
                          src={signedVideoUrl}
                        />
                      ) : currentLesson.azure_blob_path || currentLesson.video_storage_path ? (
                        <div className="text-center text-muted-foreground">
                          <Play className="mx-auto h-12 w-12 mb-2" />
                          <p>Unable to load video. Please try again.</p>
                        </div>
                      ) : (
                        <div className="text-center text-muted-foreground">
                          <Play className="mx-auto h-12 w-12 mb-2" />
                          <p>No video uploaded</p>
                        </div>
                      )}
                    </div>
                    {currentLesson.content_text && (
                      <p className="text-muted-foreground">{currentLesson.content_text}</p>
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
                      <div className="flex items-center justify-center py-12 border rounded-lg bg-muted/50">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <span className="ml-3 text-muted-foreground">Loading document...</span>
                      </div>
                    ) : (signedDocUrl || azureDocUrl) ? (
                      <div className="rounded-lg border overflow-hidden">
                        <PdfViewer url={azureDocUrl || signedDocUrl || ''} />
                      </div>
                    ) : currentLesson.document_storage_path ? (
                      <div className="flex items-center justify-center py-12 border rounded-lg bg-muted/50">
                        <FileText className="h-8 w-8 text-muted-foreground" />
                        <span className="ml-3 text-muted-foreground">Unable to load document. Please try again.</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center py-12 border rounded-lg bg-muted/50">
                        <FileText className="h-8 w-8 text-muted-foreground" />
                        <span className="ml-3 text-muted-foreground">No document uploaded</span>
                      </div>
                    )}
                  </div>
                )}

                {currentLesson.lesson_type === 'quiz' && quiz && (
                  <div className="space-y-6">
                    {quizSubmitted ? (
                      <div className={cn(
                        'rounded-lg p-6 text-center',
                        quizScore >= quiz.passing_score ? 'bg-success/10' : 'bg-destructive/10'
                      )}>
                        {quizScore >= quiz.passing_score ? (
                          <CheckCircle2 className="mx-auto h-12 w-12 text-success mb-3" />
                        ) : null}
                        <div className={cn(
                          'text-4xl font-bold mb-2',
                          quizScore >= quiz.passing_score ? 'text-success' : 'text-destructive'
                        )}>
                          {quizScore}%
                        </div>
                        <p className={cn(
                          'mb-4',
                          quizScore >= quiz.passing_score ? 'text-success' : 'text-muted-foreground'
                        )}>
                          {quizScore >= quiz.passing_score
                            ? '🎉 Congratulations! You passed the quiz!'
                            : `You need ${quiz.passing_score}% to pass. Try again!`}
                        </p>
                        {quizScore >= quiz.passing_score ? (
                          progress[currentLesson.id]?.status === 'completed' ? (
                            (() => {
                              const allLessons = modules.flatMap(m => m.lessons);
                              const currentIndex = allLessons.findIndex(l => l.id === currentLesson.id);
                              const isLastLesson = currentIndex >= allLessons.length - 1;
                              
                              // Find current module and check if this is the last lesson in the module
                              const currentModule = modules.find(m => m.lessons.some(l => l.id === currentLesson.id));
                              const isLastInModule = currentModule && 
                                currentModule.lessons[currentModule.lessons.length - 1]?.id === currentLesson.id;
                              
                              const buttonText = isLastLesson 
                                ? 'Finish Course' 
                                : isLastInModule 
                                  ? 'Next Module' 
                                  : 'Next Lesson';

                              return (
                                <div className="space-y-3">
                                  <Badge variant="secondary" className="bg-success/20 text-success">
                                    <CheckCircle2 className="mr-1 h-3 w-3" />
                                    Lesson Complete
                                  </Badge>
                                  <div>
                                    <Button
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
                                      <ArrowRight className="ml-2 h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              );
                            })()
                          ) : (
                            <Button onClick={() => handleCompleteLesson()} disabled={completingLesson}>
                              {completingLesson ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                              )}
                              Mark as Complete
                            </Button>
                          )
                        ) : (
                          <Button
                            onClick={() => {
                              setQuizSubmitted(false);
                              setAnswers({});
                            }}
                          >
                            Retry Quiz
                          </Button>
                        )}
                      </div>
                    ) : (
                      <>
                        {questions.map((question, qIndex) => (
                          <div key={question.id} className="space-y-3">
                            <p className="font-medium">
                              {qIndex + 1}. {question.question_text}
                            </p>
                            <div className="space-y-2">
                              {question.options.map((option) => (
                                <label
                                  key={option.id}
                                  className={cn(
                                    'flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
                                    answers[question.id] === option.id
                                      ? 'border-accent bg-accent/10'
                                      : 'hover:bg-muted/50'
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
                                  <div className={cn(
                                    'h-4 w-4 rounded-full border-2',
                                    answers[question.id] === option.id
                                      ? 'border-accent bg-accent'
                                      : 'border-muted-foreground'
                                  )} />
                                  <span>{option.option_text}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                        <Button
                          onClick={handleSubmitQuiz}
                          disabled={Object.keys(answers).length !== questions.length}
                          className="w-full"
                        >
                          Submit Quiz
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {/* Complete button for non-quiz lessons */}
                {currentLesson.lesson_type !== 'quiz' && (
                  <div className="mt-6 flex items-center justify-between border-t pt-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        const allLessons = modules.flatMap(m => m.lessons);
                        const currentIndex = allLessons.findIndex(l => l.id === currentLesson.id);
                        if (currentIndex > 0) {
                          setCurrentLesson(allLessons[currentIndex - 1]);
                        }
                      }}
                      disabled={modules.flatMap(m => m.lessons).findIndex(l => l.id === currentLesson.id) === 0}
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Previous
                    </Button>

                    {progress[currentLesson.id]?.status === 'completed' ? (
                      <Button
                        onClick={() => {
                          const allLessons = modules.flatMap(m => m.lessons);
                          const currentIndex = allLessons.findIndex(l => l.id === currentLesson.id);
                          if (currentIndex < allLessons.length - 1) {
                            setCurrentLesson(allLessons[currentIndex + 1]);
                          }
                        }}
                      >
                        Next Lesson
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    ) : (
                      <Button onClick={() => handleCompleteLesson()} disabled={completingLesson}>
                        {completingLesson ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                        )}
                        Mark as Complete
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">Select a lesson to begin</p>
              </CardContent>
            </Card>
          )}
        </div>
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
