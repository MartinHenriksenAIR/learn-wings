import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Plus, Trash2, GripVertical, CheckCircle2, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';

interface QuizQuestion {
  id: string;
  question_text: string;
  sort_order: number;
  options: QuizOption[];
}

interface QuizOption {
  id: string;
  option_text: string;
  is_correct: boolean;
}

interface QuizEditorDialogProps {
  lessonId: string;
  lessonTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onQuizSaved?: () => void;
}

export function QuizEditorDialog({
  lessonId,
  lessonTitle,
  open,
  onOpenChange,
  onQuizSaved,
}: QuizEditorDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [quizId, setQuizId] = useState<string | null>(null);
  const [passingScore, setPassingScore] = useState(70);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);

  // Fetch quiz data on open
  useEffect(() => {
    if (open && lessonId) {
      fetchQuiz();
    }
  }, [open, lessonId]);

  const fetchQuiz = async () => {
    setLoading(true);
    
    // Check if quiz exists for this lesson
    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select('id, passing_score')
      .eq('lesson_id', lessonId)
      .maybeSingle();

    if (quizError) {
      console.error('Error fetching quiz:', quizError);
      toast.error('Failed to load quiz');
      setLoading(false);
      return;
    }

    if (quiz) {
      setQuizId(quiz.id);
      setPassingScore(quiz.passing_score);
      
      // Fetch questions
      const { data: questionsData, error: questionsError } = await supabase
        .from('quiz_questions')
        .select('id, question_text, sort_order')
        .eq('quiz_id', quiz.id)
        .order('sort_order');

      if (questionsError) {
        console.error('Error fetching questions:', questionsError);
        toast.error('Failed to load questions');
        setLoading(false);
        return;
      }

      // Fetch options for each question using the RPC that includes is_correct
      const questionsWithOptions: QuizQuestion[] = [];
      for (const q of questionsData || []) {
        const { data: optionsData } = await supabase.rpc('get_quiz_options_with_answers', {
          p_question_id: q.id,
        });
        
        questionsWithOptions.push({
          ...q,
          options: optionsData || [],
        });
      }

      setQuestions(questionsWithOptions);
    } else {
      // No quiz exists yet
      setQuizId(null);
      setQuestions([]);
    }

    setLoading(false);
  };

  const addQuestion = () => {
    const newQuestion: QuizQuestion = {
      id: `new-${Date.now()}`,
      question_text: '',
      sort_order: questions.length,
      options: [
        { id: `opt-${Date.now()}-1`, option_text: '', is_correct: true },
        { id: `opt-${Date.now()}-2`, option_text: '', is_correct: false },
      ],
    };
    setQuestions([...questions, newQuestion]);
  };

  const removeQuestion = (questionIndex: number) => {
    const updated = questions.filter((_, i) => i !== questionIndex);
    // Update sort orders
    updated.forEach((q, i) => (q.sort_order = i));
    setQuestions(updated);
  };

  const updateQuestionText = (questionIndex: number, text: string) => {
    const updated = [...questions];
    updated[questionIndex].question_text = text;
    setQuestions(updated);
  };

  const addOption = (questionIndex: number) => {
    const updated = [...questions];
    updated[questionIndex].options.push({
      id: `opt-${Date.now()}`,
      option_text: '',
      is_correct: false,
    });
    setQuestions(updated);
  };

  const removeOption = (questionIndex: number, optionIndex: number) => {
    const updated = [...questions];
    const wasCorrect = updated[questionIndex].options[optionIndex].is_correct;
    updated[questionIndex].options = updated[questionIndex].options.filter(
      (_, i) => i !== optionIndex
    );
    // If we removed the correct answer, make the first option correct
    if (wasCorrect && updated[questionIndex].options.length > 0) {
      updated[questionIndex].options[0].is_correct = true;
    }
    setQuestions(updated);
  };

  const updateOptionText = (questionIndex: number, optionIndex: number, text: string) => {
    const updated = [...questions];
    updated[questionIndex].options[optionIndex].option_text = text;
    setQuestions(updated);
  };

  const setCorrectOption = (questionIndex: number, optionId: string) => {
    const updated = [...questions];
    updated[questionIndex].options.forEach((opt) => {
      opt.is_correct = opt.id === optionId;
    });
    setQuestions(updated);
  };

  const validateQuiz = (): boolean => {
    if (questions.length === 0) {
      toast.error('Please add at least one question');
      return false;
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question_text.trim()) {
        toast.error(`Question ${i + 1} is empty`);
        return false;
      }
      if (q.options.length < 2) {
        toast.error(`Question ${i + 1} needs at least 2 options`);
        return false;
      }
      const hasCorrect = q.options.some((o) => o.is_correct);
      if (!hasCorrect) {
        toast.error(`Question ${i + 1} needs a correct answer`);
        return false;
      }
      for (let j = 0; j < q.options.length; j++) {
        if (!q.options[j].option_text.trim()) {
          toast.error(`Question ${i + 1}, Option ${j + 1} is empty`);
          return false;
        }
      }
    }

    return true;
  };

  const handleSave = async () => {
    if (!validateQuiz()) return;

    setSaving(true);

    try {
      let currentQuizId = quizId;

      // Create or update quiz
      if (!currentQuizId) {
        const { data: newQuiz, error: createError } = await supabase
          .from('quizzes')
          .insert({ lesson_id: lessonId, passing_score: passingScore })
          .select()
          .single();

        if (createError) throw createError;
        currentQuizId = newQuiz.id;
        setQuizId(currentQuizId);
      } else {
        const { error: updateError } = await supabase
          .from('quizzes')
          .update({ passing_score: passingScore })
          .eq('id', currentQuizId);

        if (updateError) throw updateError;
      }

      // Delete existing questions and options (cascade will handle options)
      const { data: existingQuestions } = await supabase
        .from('quiz_questions')
        .select('id')
        .eq('quiz_id', currentQuizId);

      if (existingQuestions && existingQuestions.length > 0) {
        const existingIds = existingQuestions.map((q) => q.id);
        
        // Delete options first
        await supabase
          .from('quiz_options')
          .delete()
          .in('question_id', existingIds);
        
        // Delete questions
        await supabase
          .from('quiz_questions')
          .delete()
          .eq('quiz_id', currentQuizId);
      }

      // Insert new questions and options
      for (const question of questions) {
        const { data: newQuestion, error: qError } = await supabase
          .from('quiz_questions')
          .insert({
            quiz_id: currentQuizId,
            question_text: question.question_text,
            sort_order: question.sort_order,
          })
          .select()
          .single();

        if (qError) throw qError;

        // Insert options
        const optionsToInsert = question.options.map((opt) => ({
          question_id: newQuestion.id,
          option_text: opt.option_text,
          is_correct: opt.is_correct,
        }));

        const { error: optError } = await supabase
          .from('quiz_options')
          .insert(optionsToInsert);

        if (optError) throw optError;
      }

      toast.success('Quiz saved successfully');
      onQuizSaved?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving quiz:', error);
      toast.error('Failed to save quiz');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            Quiz Editor
          </DialogTitle>
          <DialogDescription>
            Configure quiz for: <strong>{lessonTitle}</strong>
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Passing Score */}
            <div className="flex items-center gap-4">
              <Label className="whitespace-nowrap">Passing Score (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={passingScore}
                onChange={(e) => setPassingScore(parseInt(e.target.value) || 0)}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">
                Learners must score at least {passingScore}% to pass
              </span>
            </div>

            {/* Questions */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Questions</Label>
                <Badge variant="outline">{questions.length} question(s)</Badge>
              </div>

              {questions.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center">
                    <HelpCircle className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
                    <p className="text-muted-foreground mb-4">No questions yet. Add your first question.</p>
                    <Button onClick={addQuestion}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Question
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {questions.map((question, qIndex) => (
                    <Card key={question.id}>
                      <CardHeader className="pb-3">
                        <div className="flex items-start gap-3">
                          <GripVertical className="h-5 w-5 text-muted-foreground mt-1 flex-shrink-0" />
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-sm font-medium">Question {qIndex + 1}</Label>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => removeQuestion(qIndex)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                            <Textarea
                              value={question.question_text}
                              onChange={(e) => updateQuestionText(qIndex, e.target.value)}
                              placeholder="Enter your question..."
                              rows={2}
                            />
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="pl-8 space-y-3">
                          <Label className="text-sm text-muted-foreground">
                            Answer Options (select the correct answer)
                          </Label>
                          <RadioGroup
                            value={question.options.find((o) => o.is_correct)?.id || ''}
                            onValueChange={(value) => setCorrectOption(qIndex, value)}
                          >
                            {question.options.map((option, oIndex) => (
                              <div key={option.id} className="flex items-center gap-2">
                                <RadioGroupItem value={option.id} id={option.id} />
                                <Input
                                  value={option.option_text}
                                  onChange={(e) => updateOptionText(qIndex, oIndex, e.target.value)}
                                  placeholder={`Option ${oIndex + 1}`}
                                  className="flex-1"
                                />
                                {option.is_correct && (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                                )}
                                {question.options.length > 2 && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    onClick={() => removeOption(qIndex, oIndex)}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            ))}
                          </RadioGroup>
                          {question.options.length < 6 && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addOption(qIndex)}
                            >
                              <Plus className="mr-1 h-3 w-3" />
                              Add Option
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  <Button variant="outline" onClick={addQuestion} className="w-full">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Another Question
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Quiz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
