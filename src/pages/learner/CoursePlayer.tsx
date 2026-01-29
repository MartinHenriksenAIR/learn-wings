import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PdfViewer } from '@/components/learner/PdfViewer';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { supabase } from '@/integrations/supabase/client';
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
  ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { CourseCompletionDialog } from '@/components/course/CourseCompletionDialog';
import { CourseReviewDialog } from '@/components/course/CourseReviewDialog';

export default function CoursePlayer() {
  const { courseId } = useParams<{ courseId: string }>();
  const { user, currentOrg } = useAuth();
  const { features } = usePlatformSettings();
  const { toast } = useToast();
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

      // Fetch course
      const { data: courseData } = await supabase
        .from('courses')
        .select('*')
        .eq('id', courseId)
        .single();

      if (courseData) {
        setCourse(courseData as Course);
      }

      // Fetch modules with lessons
      const { data: modulesData } = await supabase
        .from('course_modules')
        .select('*')
        .eq('course_id', courseId)
        .order('sort_order');

      if (modulesData) {
        const modulesWithLessons = await Promise.all(
          modulesData.map(async (module) => {
            const { data: lessons } = await supabase
              .from('lessons')
              .select('*')
              .eq('module_id', module.id)
              .order('sort_order');
            return { ...module, lessons: lessons || [] };
          })
        );
        setModules(modulesWithLessons as any);

        // Set first lesson as current if none selected
        if (modulesWithLessons.length > 0 && modulesWithLessons[0].lessons.length > 0) {
          setCurrentLesson(modulesWithLessons[0].lessons[0] as Lesson);
        }
      }

      // Fetch progress
      const { data: progressData } = await supabase
        .from('lesson_progress')
        .select('*')
        .eq('user_id', user.id)
        .eq('org_id', currentOrg.id);

      if (progressData) {
        const progressMap: Record<string, LessonProgress> = {};
        progressData.forEach(p => {
          progressMap[p.lesson_id] = p as LessonProgress;
        });
        setProgress(progressMap);
      }

      setLoading(false);
    };

    fetchData();
  }, [user, currentOrg, courseId]);

  // Load existing review
  useEffect(() => {
    const loadExistingReview = async () => {
      if (!user || !currentOrg || !courseId) return;

      const { data } = await supabase
        .from('course_reviews')
        .select('*')
        .eq('user_id', user.id)
        .eq('org_id', currentOrg.id)
        .eq('course_id', courseId)
        .maybeSingle();

      if (data) {
        setExistingReview(data as CourseReview);
      }
    };

    loadExistingReview();
  }, [user, currentOrg, courseId]);

  // Load quiz when lesson changes - uses public view to hide is_correct
  useEffect(() => {
    const loadQuiz = async () => {
      if (!currentLesson || currentLesson.lesson_type !== 'quiz') {
        setQuiz(null);
        setQuestions([]);
        setAnswers({});
        setQuizSubmitted(false);
        return;
      }

      const { data: quizData } = await supabase
        .from('quizzes')
        .select('*')
        .eq('lesson_id', currentLesson.id)
        .single();

      if (quizData) {
        setQuiz(quizData as Quiz);

        const { data: questionsData } = await supabase
          .from('quiz_questions')
          .select('*')
          .eq('quiz_id', quizData.id)
          .order('sort_order');

        if (questionsData) {
          const questionsWithOptions = await Promise.all(
            questionsData.map(async (q) => {
              // Use the secure RPC function that checks access and excludes is_correct
              const { data: options } = await supabase
                .rpc('get_quiz_options_for_learner', { p_question_id: q.id });
              // Add is_correct as undefined since we don't have access to it
              return { 
                ...q, 
                options: (options || []).map(o => ({ ...o, is_correct: false })) 
              };
            })
          );
          setQuestions(questionsWithOptions as any);
        }
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
          const { data, error } = await supabase.functions.invoke('azure-view-url', {
            body: { blobPath: currentLesson.azure_blob_path, lessonId: currentLesson.id },
          });
          
          if (!error && data?.viewUrl) {
            setAzureVideoUrl(data.viewUrl);
          } else {
            console.error('Error getting Azure view URL:', error);
            setAzureVideoUrl(null);
          }
          setSignedVideoUrl(null);
        } else if (currentLesson.video_storage_path) {
          // Fallback to Supabase storage for legacy videos
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
            const { data, error } = await supabase.functions.invoke('azure-view-url', {
              body: { blobPath: currentLesson.document_storage_path, lessonId: currentLesson.id },
            });
            
            if (!error && data?.viewUrl) {
              setAzureDocUrl(data.viewUrl);
            } else {
              console.error('Error getting Azure document URL:', error);
              setAzureDocUrl(null);
            }
            setSignedDocUrl(null);
          } else {
            // Legacy Supabase-stored document
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

  const handleCompleteLesson = async (isLastLesson = false) => {
    if (!user || !currentOrg || !currentLesson) return;

    setCompletingLesson(true);

    // Upsert progress
    const { error } = await supabase.from('lesson_progress').upsert({
      org_id: currentOrg.id,
      user_id: user.id,
      lesson_id: currentLesson.id,
      status: 'completed',
      completed_at: new Date().toISOString(),
    }, {
      onConflict: 'org_id,user_id,lesson_id',
    });

    if (!error) {
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

      // Check if this completes the course
      const allLessons = modules.flatMap(m => m.lessons);
      const completedCount = Object.values(newProgress).filter(p => p.status === 'completed').length;
      const isCourseComplete = completedCount >= allLessons.length;

      if (isCourseComplete && !courseJustCompleted) {
        setCourseJustCompleted(true);
        setShowCompletionDialog(true);
        
        // Update enrollment status to completed
        await supabase.from('enrollments').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        }).eq('user_id', user.id).eq('org_id', currentOrg.id).eq('course_id', courseId);
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
    }

    setCompletingLesson(false);
  };

  const handleSubmitQuiz = async () => {
    if (!quiz || !user || !currentOrg) return;

    // Grade quiz server-side using edge function
    const { data: gradeResult, error: gradeError } = await supabase.functions.invoke('grade-quiz', {
      body: {
        quiz_id: quiz.id,
        answers,
      },
    });

    if (gradeError || !gradeResult) {
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

    // Save attempt
    await supabase.from('quiz_attempts').insert({
      org_id: currentOrg.id,
      user_id: user.id,
      quiz_id: quiz.id,
      score,
      passed,
      finished_at: new Date().toISOString(),
    });

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
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
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
          userId={user.id}
          existingReview={existingReview ? {
            id: existingReview.id,
            rating: existingReview.rating,
            comment: existingReview.comment,
          } : undefined}
          onReviewSubmitted={() => {
            // Refresh existing review
            supabase
              .from('course_reviews')
              .select('*')
              .eq('user_id', user.id)
              .eq('org_id', currentOrg.id)
              .eq('course_id', course.id)
              .maybeSingle()
              .then(({ data }) => {
                if (data) setExistingReview(data as CourseReview);
              });
          }}
        />
      )}
    </AppLayout>
  );
}
