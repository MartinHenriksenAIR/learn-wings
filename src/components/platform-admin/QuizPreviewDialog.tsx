import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { Quiz, QuizQuestion, QuizOption } from '@/lib/types';
import { Loader2, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';

interface QuizPreviewDialogProps {
  lessonId: string;
  lessonTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuizPreviewDialog({
  lessonId,
  lessonTitle,
  open,
  onOpenChange,
}: QuizPreviewDialogProps) {
  const [loading, setLoading] = useState(true);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    if (open && lessonId) {
      fetchQuiz();
      setAnswers({});
      setSubmitted(false);
      setScore(null);
    }
  }, [open, lessonId]);

  const fetchQuiz = async () => {
    setLoading(true);
    try {
      // Fetch quiz for this lesson
      const { data: quizData, error: quizError } = await supabase
        .from('quizzes')
        .select('*')
        .eq('lesson_id', lessonId)
        .maybeSingle();

      if (quizError || !quizData) {
        setQuiz(null);
        setLoading(false);
        return;
      }

      // Fetch questions
      const { data: questionsData } = await supabase
        .from('quiz_questions')
        .select('*')
        .eq('quiz_id', quizData.id)
        .order('sort_order');

      const questions: QuizQuestion[] = [];
      
      if (questionsData) {
        for (const q of questionsData) {
          // Platform admins can see all options including is_correct via RPC
          const { data: optionsData } = await supabase.rpc('get_quiz_options_with_answers', {
            p_question_id: q.id,
          });

          questions.push({
            ...q,
            options: optionsData || [],
          });
        }
      }

      setQuiz({
        ...quizData,
        questions,
      });
    } catch (err) {
      console.error('Error fetching quiz:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    if (!quiz?.questions) return;

    let correct = 0;
    quiz.questions.forEach((q) => {
      const selectedOptionId = answers[q.id];
      const correctOption = q.options?.find((opt) => opt.is_correct);
      if (selectedOptionId && correctOption && selectedOptionId === correctOption.id) {
        correct++;
      }
    });

    const scorePercent = Math.round((correct / quiz.questions.length) * 100);
    setScore(scorePercent);
    setSubmitted(true);
  };

  const handleReset = () => {
    setAnswers({});
    setSubmitted(false);
    setScore(null);
  };

  const getOptionStatus = (question: QuizQuestion, option: QuizOption) => {
    if (!submitted) return null;
    const isSelected = answers[question.id] === option.id;
    if (option.is_correct) return 'correct';
    if (isSelected && !option.is_correct) return 'incorrect';
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            Quiz Preview: {lessonTitle}
          </DialogTitle>
          <DialogDescription>
            Preview how learners will experience this quiz. Your answers will not be saved.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !quiz ? (
            <div className="text-center py-12">
              <HelpCircle className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-muted-foreground">No quiz configured for this lesson yet.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Use "Edit Quiz" to add questions.
              </p>
            </div>
          ) : !quiz.questions?.length ? (
            <div className="text-center py-12">
              <HelpCircle className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-muted-foreground">This quiz has no questions yet.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Use "Edit Quiz" to add questions.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {submitted && score !== null && (
                <Card className={`p-4 ${score >= quiz.passing_score ? 'bg-success/10 border-success' : 'bg-destructive/10 border-destructive'}`}>
                  <div className="flex items-center gap-3">
                    {score >= quiz.passing_score ? (
                      <CheckCircle2 className="h-6 w-6 text-success" />
                    ) : (
                      <XCircle className="h-6 w-6 text-destructive" />
                    )}
                    <div>
                      <p className="font-medium">
                        {score >= quiz.passing_score ? 'Quiz Passed!' : 'Quiz Not Passed'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Score: {score}% (Passing: {quiz.passing_score}%)
                      </p>
                    </div>
                  </div>
                </Card>
              )}

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">{quiz.questions.length} Questions</Badge>
                <Badge variant="outline">Passing Score: {quiz.passing_score}%</Badge>
              </div>

              {quiz.questions.map((question, qIndex) => (
                <Card key={question.id} className="p-4">
                  <p className="font-medium mb-3">
                    {qIndex + 1}. {question.question_text}
                  </p>
                  <RadioGroup
                    value={answers[question.id] || ''}
                    onValueChange={(value) => 
                      !submitted && setAnswers((prev) => ({ ...prev, [question.id]: value }))
                    }
                    disabled={submitted}
                  >
                    <div className="space-y-2">
                      {question.options?.map((option) => {
                        const status = getOptionStatus(question, option);
                        return (
                          <div
                            key={option.id}
                            className={`flex items-center space-x-3 p-3 rounded-md border transition-colors ${
                              status === 'correct'
                                ? 'bg-success/10 border-success'
                                : status === 'incorrect'
                                ? 'bg-destructive/10 border-destructive'
                                : 'hover:bg-muted/50'
                            }`}
                          >
                            <RadioGroupItem value={option.id} id={option.id} />
                            <Label htmlFor={option.id} className="flex-1 cursor-pointer">
                              {option.option_text}
                            </Label>
                            {submitted && option.is_correct && (
                              <CheckCircle2 className="h-4 w-4 text-success" />
                            )}
                            {status === 'incorrect' && (
                              <XCircle className="h-4 w-4 text-destructive" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </RadioGroup>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {quiz?.questions?.length ? (
            submitted ? (
              <Button onClick={handleReset}>Try Again</Button>
            ) : (
              <Button 
                onClick={handleSubmit}
                disabled={Object.keys(answers).length < (quiz.questions?.length || 0)}
              >
                Submit Answers
              </Button>
            )
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
