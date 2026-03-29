import { useState, useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { createIdea, submitIdea, updateIdea, fetchIdea, deleteIdea, fetchOrgTags } from '@/lib/ideas-api';
import { BUSINESS_AREAS } from '@/lib/community-types';
import type { BusinessArea } from '@/lib/community-types';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Loader2,
  Save,
  Send,
  Lightbulb,
  Trash2,
  X,
} from 'lucide-react';

const ideaFormSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(200, 'Title is too long'),
  business_area: z.string().optional(),
  tags: z.array(z.string()).optional(),
  current_process: z.string().optional(),
  pain_points: z.string().optional(),
  affected_roles: z.string().optional(),
  frequency_volume: z.string().optional(),
  proposed_improvement: z.string().optional(),
  desired_process: z.string().optional(),
  data_inputs: z.string().optional(),
  systems_involved: z.string().optional(),
  constraints_risks: z.string().optional(),
  success_metrics: z.string().optional(),
});

type IdeaFormValues = z.infer<typeof ideaFormSchema>;

export default function IdeaSubmit() {
  const navigate = useNavigate();
  const { ideaId } = useParams<{ ideaId?: string }>();
  const { currentOrg, user } = useAuth();
  const { features, isLoading: settingsLoading } = usePlatformSettings();
  const queryClient = useQueryClient();

  const [draftId, setDraftId] = useState<string | null>(ideaId || null);
  const [tagInput, setTagInput] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const isEditMode = !!ideaId;

  const form = useForm<IdeaFormValues>({
    resolver: zodResolver(ideaFormSchema),
    defaultValues: {
      title: '',
      business_area: '',
      tags: [],
      current_process: '',
      pain_points: '',
      affected_roles: '',
      frequency_volume: '',
      proposed_improvement: '',
      desired_process: '',
      data_inputs: '',
      systems_involved: '',
      constraints_risks: '',
      success_metrics: '',
    },
  });

  // Load existing draft if editing
  const { data: existingIdea, isLoading: isLoadingIdea } = useQuery({
    queryKey: ['idea', ideaId],
    queryFn: () => fetchIdea(ideaId!),
    enabled: !!ideaId,
  });

  const { data: orgTags = [] } = useQuery({
    queryKey: ['idea-tags', currentOrg?.id],
    queryFn: () => fetchOrgTags(currentOrg!.id),
    enabled: !!currentOrg,
  });

  // Populate form when draft data loads
  useEffect(() => {
    if (existingIdea && existingIdea.status === 'draft' && existingIdea.user_id === user?.id) {
      form.reset({
        title: existingIdea.title || '',
        business_area: existingIdea.business_area || '',
        tags: existingIdea.tags || [],
        current_process: existingIdea.current_process || '',
        pain_points: existingIdea.pain_points || '',
        affected_roles: existingIdea.affected_roles || '',
        frequency_volume: existingIdea.frequency_volume || '',
        proposed_improvement: existingIdea.proposed_improvement || '',
        desired_process: existingIdea.desired_process || '',
        data_inputs: existingIdea.data_inputs || '',
        systems_involved: existingIdea.systems_involved || '',
        constraints_risks: existingIdea.constraints_risks || '',
        success_metrics: existingIdea.success_metrics || '',
      });
    }
  }, [existingIdea, user?.id, form]);

  // Create or update draft mutation
  const saveDraftMutation = useMutation({
    mutationFn: async (values: IdeaFormValues) => {
      if (draftId) {
        return updateIdea(draftId, {
          ...values,
          business_area: values.business_area as BusinessArea | undefined,
        });
      } else {
        return createIdea({
          org_id: currentOrg!.id,
          title: values.title,
          ...values,
          business_area: values.business_area as BusinessArea | undefined,
        });
      }
    },
    onSuccess: (data) => {
      setDraftId(data.id);
      queryClient.invalidateQueries({ queryKey: ['ideas'] });
      toast.success('Draft saved! You can find it in the "My Drafts" tab of the Idea Library.');
      navigate('/app/community/org/ideas?tab=drafts');
    },
    onError: () => {
      toast.error('Failed to save draft');
    },
  });

  // Submit idea mutation
  const submitMutation = useMutation({
    mutationFn: async (values: IdeaFormValues) => {
      let ideaId = draftId;
      if (!ideaId) {
        const created = await createIdea({
          org_id: currentOrg!.id,
          title: values.title,
          ...values,
          business_area: values.business_area as BusinessArea | undefined,
        });
        ideaId = created.id;
      } else {
        await updateIdea(ideaId, {
          ...values,
          business_area: values.business_area as BusinessArea | undefined,
        });
      }
      return submitIdea(ideaId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ideas'] });
      toast.success('Idea submitted successfully!');
      navigate('/app/community/org/ideas');
    },
    onError: () => {
      toast.error('Failed to submit idea');
    },
  });

  // Delete draft mutation
  const deleteDraftMutation = useMutation({
    mutationFn: async () => {
      if (!draftId) throw new Error('No draft to delete');
      return deleteIdea(draftId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ideas'] });
      toast.success('Draft deleted');
      navigate('/app/community/org/ideas');
    },
    onError: () => {
      toast.error('Failed to delete draft');
    },
  });

  const handleSaveDraft = () => {
    const values = form.getValues();
    if (!values.title) {
      toast.error('Please add a title to save the draft');
      return;
    }
    saveDraftMutation.mutate(values);
  };

  const handleSubmit = (values: IdeaFormValues) => {
    if (currentStep < steps.length - 1) return;
    submitMutation.mutate(values);
  };

  const addTag = () => {
    if (tagInput.trim() && !form.getValues('tags')?.includes(tagInput.trim())) {
      const currentTags = form.getValues('tags') || [];
      form.setValue('tags', [...currentTags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    const currentTags = form.getValues('tags') || [];
    form.setValue('tags', currentTags.filter((t) => t !== tag));
  };

  const steps = [
    { title: 'Basics', description: 'Title and business area' },
    { title: 'Current State', description: 'Describe the current process' },
    { title: 'Proposed Change', description: 'Your improvement idea' },
    { title: 'Details', description: 'Optional additional context' },
  ];

  if (!settingsLoading && !features.community_enabled) {
    return <Navigate to="/app/dashboard" replace />;
  }

  if (!currentOrg) {
    return (
      <AppLayout>
        <div className="container mx-auto py-12 text-center">
          <h1 className="text-2xl font-bold mb-2">No Organization Selected</h1>
          <p className="text-muted-foreground">Please select an organization to submit an idea.</p>
        </div>
      </AppLayout>
    );
  }

  if (isEditMode && isLoadingIdea) {
    return (
      <AppLayout>
        <div className="container mx-auto py-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Submit Idea" breadcrumbs={[{ label: 'Community' }, { label: 'Idea Library' }, { label: isEditMode ? 'Edit Draft' : 'Submit Idea' }]}>
      <div className="container max-w-3xl mx-auto py-6 px-4">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/app/community/org/ideas')}
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Submit an Idea</h1>
            <p className="text-muted-foreground">
              Share your AI or process improvement idea with {currentOrg.name}
            </p>
          </div>
        </div>

        {/* Progress steps */}
        <div className="flex items-center justify-between mb-8">
          {steps.map((step, index) => (
            <button
              key={step.title}
              onClick={() => setCurrentStep(index)}
              className={`flex-1 text-center pb-2 border-b-2 transition-colors ${
                index === currentStep
                  ? 'border-primary text-primary font-medium'
                  : index < currentStep
                  ? 'border-muted-foreground/50 text-muted-foreground'
                  : 'border-muted text-muted-foreground/50'
              }`}
            >
              <span className="text-sm">{step.title}</span>
            </button>
          ))}
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            {/* Step 0: Basics */}
            {currentStep === 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-primary" />
                    What's your idea?
                  </CardTitle>
                  <CardDescription>
                    Start with a clear title and categorize your idea
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Idea Title *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g., Automate invoice processing with AI"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          A short, descriptive title for your idea
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="business_area"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Business Area / Domain</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a business area" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {BUSINESS_AREAS.map((area) => (
                              <SelectItem key={area.value} value={area.value}>
                                {area.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Which part of the business does this idea relate to?
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="tags"
                    render={() => (
                      <FormItem>
                        <FormLabel>Tags</FormLabel>
                        <div className="flex gap-2">
                          <Input
                            placeholder="Add a tag..."
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            list="org-idea-tags"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                addTag();
                              }
                            }}
                          />
                          <datalist id="org-idea-tags">
                            {orgTags.map((tag) => (
                              <option key={tag} value={tag} />
                            ))}
                          </datalist>
                          <Button type="button" variant="outline" onClick={addTag}>
                            Add
                          </Button>
                        </div>
                        {(form.watch('tags') || []).length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {form.watch('tags')?.map((tag) => (
                              <Badge key={tag} variant="secondary" className="gap-1">
                                {tag}
                                <button
                                  type="button"
                                  onClick={() => removeTag(tag)}
                                  className="hover:text-destructive"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}
                        <FormDescription>
                          Add keywords to help others find this idea
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Step 1: Current State */}
            {currentStep === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle>Current State</CardTitle>
                  <CardDescription>
                    Help us understand the current situation and why change is needed
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="current_process"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Current Process (As-Is)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Describe how things work today. What steps are involved? Who does what?"
                            className="min-h-[120px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Walk us through the current workflow or process
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="pain_points"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pain Points / Why It Matters</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="What problems does this cause? Time wasted? Errors? Frustration?"
                            className="min-h-[120px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Explain the impact and why this needs to change
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="affected_roles"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Who Is Affected?</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g., Finance team, all employees"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            Roles or teams impacted
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="frequency_volume"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Frequency / Volume</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g., 50 invoices/week, daily task"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            How often does this happen?
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Step 2: Proposed Change */}
            {currentStep === 2 && (
              <Card>
                <CardHeader>
                  <CardTitle>Proposed Improvement</CardTitle>
                  <CardDescription>
                    Describe your idea for how AI or automation could help
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="proposed_improvement"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>What Should Be Improved?</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Describe your idea for improvement. How could AI or automation help? What would change?"
                            className="min-h-[150px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Explain your proposed solution or improvement
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="desired_process"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Desired Future State (To-Be)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="How should the process work after the improvement? (Optional)"
                            className="min-h-[120px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Paint a picture of the improved workflow
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="success_metrics"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Success Metrics</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g., 50% time reduction, zero errors, faster turnaround"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          How would you measure success?
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Step 3: Details */}
            {currentStep === 3 && (
              <Card>
                <CardHeader>
                  <CardTitle>Additional Details</CardTitle>
                  <CardDescription>
                    Optional technical context that might help evaluate this idea
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="data_inputs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Data Inputs</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="What data is involved? Where does it come from? (e.g., emails, PDFs, Excel files, ERP system)"
                            className="min-h-[100px]"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="systems_involved"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Systems / Tools Involved</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g., SAP, Salesforce, SharePoint, custom apps"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Which software systems are part of this process?
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="constraints_risks"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Constraints / Risks</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Any concerns, limitations, or risks to consider? (e.g., data privacy, compliance, budget)"
                            className="min-h-[100px]"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Navigation buttons */}
            <div className="flex justify-between mt-6">
              <div className="flex gap-2">
                {currentStep > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCurrentStep(currentStep - 1)}
                  >
                    Previous
                  </Button>
                )}
                {isEditMode && draftId && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        disabled={deleteDraftMutation.isPending}
                      >
                        {deleteDraftMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 mr-2" />
                        )}
                        Delete Draft
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This action cannot be undone. The draft will be permanently deleted.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteDraftMutation.mutate()}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSaveDraft}
                  disabled={saveDraftMutation.isPending}
                >
                  {saveDraftMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save Draft
                </Button>
                {currentStep < steps.length - 1 ? (
                  <Button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setCurrentStep(currentStep + 1);
                    }}
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={submitMutation.isPending}
                  >
                    {submitMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Submit Idea
                  </Button>
                )}
              </div>
            </div>
          </form>
        </Form>
      </div>
    </AppLayout>
  );
}
