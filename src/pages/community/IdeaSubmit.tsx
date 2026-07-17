import { useState, useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
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
import { PageSpinner } from '@/components/ui/page-spinner';
import { useAuth } from '@/hooks/useAuth';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { createIdea, submitIdea, updateIdea, fetchIdea, deleteIdea, fetchOrgTags } from '@/lib/ideas-api';
import { BUSINESS_AREAS } from '@/lib/community-types';
import type { BusinessArea } from '@/lib/community-types';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
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

const LABEL_CLASSES = 'text-xs font-bold text-[#4a4f60]';

export default function IdeaSubmit() {
  const navigate = useNavigate();
  const { ideaId } = useParams<{ ideaId?: string }>();
  const { t } = useTranslation();
  // profile.id (DB row UUID) is the ownership identity — user.id is the Entra OID.
  const { currentOrg, profile } = useAuth();
  const orgGuard = useOrgGuard();
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
    queryKey: queryKeys.idea.detail(ideaId),
    queryFn: () => fetchIdea(ideaId!),
    enabled: !!ideaId,
  });

  const { data: orgTags = [] } = useQuery({
    queryKey: queryKeys.ideaTags.list(currentOrg?.id),
    queryFn: () => fetchOrgTags(currentOrg!.id),
    enabled: !!currentOrg,
  });

  // Populate form when draft data loads
  useEffect(() => {
    if (existingIdea && existingIdea.status === 'draft' && existingIdea.user_id === profile?.id) {
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
  }, [existingIdea, profile?.id, form]);

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
      queryClient.invalidateQueries({ queryKey: queryKeys.ideas.all });
      toast.success(t('ideas.draftSaved'));
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
      queryClient.invalidateQueries({ queryKey: queryKeys.ideas.all });
      toast.success(t('ideas.ideaSubmitted'));
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
      queryClient.invalidateQueries({ queryKey: queryKeys.ideas.all });
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
    { title: t('community.ideaForm.stepBasics') },
    { title: t('community.ideaForm.stepCurrentState') },
    { title: t('community.ideaForm.stepProposedChange') },
    { title: t('community.ideaForm.stepDetails') },
  ];

  if (!settingsLoading && !features.community_enabled) {
    return <Navigate to="/app/dashboard" replace />;
  }

  // Profile-gated guard (useOrgGuard): don't flash "No Organization Selected"
  // while the signed-in user's context is still resolving.
  if (orgGuard === 'loading') {
    return (
      <AppLayout>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout>
        <div className="py-12 text-center">
          <h1 className="mb-2 font-display text-[26px] font-extrabold tracking-[-0.02em]">
            {t('community.noOrganizationTitle')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('community.noOrgSubmitIdea')}</p>
        </div>
      </AppLayout>
    );
  }

  if (isEditMode && isLoadingIdea) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumbs={[{ label: 'Community' }, { label: 'Idea Library' }, { label: isEditMode ? 'Edit Draft' : 'Submit Idea' }]}>
      <div className="max-w-[680px]">
        {/* Back to idea library */}
        <Button
          variant="ghost"
          onClick={() => navigate('/app/community/org/ideas')}
          className="mb-3.5 h-auto rounded-lg px-2 py-1.5 text-[13px] font-bold text-muted-foreground hover:bg-transparent hover:text-primary"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          {t('community.backToIdeas')}
        </Button>

        {/* Header */}
        <div className="mb-[22px]">
          <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">
            {isEditMode ? t('community.ideaForm.editHeading') : t('ideas.submitNew')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('community.ideaForm.subtitle', { orgName: currentOrg.name })}
          </p>
        </div>

        {/* Progress steps */}
        <div className="mb-7 flex items-center justify-between">
          {steps.map((step, index) => (
            <button
              key={step.title}
              type="button"
              onClick={() => setCurrentStep(index)}
              className={cn(
                'flex-1 border-b-2 pb-2 text-center transition-colors',
                index === currentStep
                  ? 'border-primary font-bold text-primary'
                  : index < currentStep
                  ? 'border-muted-foreground/50 font-semibold text-muted-foreground'
                  : 'border-muted font-semibold text-muted-foreground/50'
              )}
            >
              <span className="text-[13px]">{step.title}</span>
            </button>
          ))}
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            {/* Step 0: Basics */}
            {currentStep === 0 && (
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-[17px] font-bold">
                    <Lightbulb aria-hidden="true" className="h-5 w-5 text-primary" />
                    {t('community.ideaForm.whatsYourIdea')}
                  </CardTitle>
                  <CardDescription className="text-[13px]">
                    {t('community.ideaForm.whatsYourIdeaDescription')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={LABEL_CLASSES}>{t('community.ideaForm.titleLabel')}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('community.ideaForm.titlePlaceholder')}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('community.ideaForm.titleDescription')}
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
                        <FormLabel className={LABEL_CLASSES}>{t('community.ideaForm.businessAreaLabel')}</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t('community.ideaForm.businessAreaPlaceholder')} />
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
                          {t('community.ideaForm.businessAreaDescription')}
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
                        <FormLabel className={LABEL_CLASSES}>{t('community.ideaForm.tagsLabel')}</FormLabel>
                        <div className="flex gap-2">
                          <Input
                            placeholder={t('community.ideaForm.addTagPlaceholder')}
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
                          <Button type="button" variant="outline" onClick={addTag} className="text-[13px] font-bold">
                            {t('community.postForm.add')}
                          </Button>
                        </div>
                        {(form.watch('tags') || []).length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {form.watch('tags')?.map((tag) => (
                              <Badge key={tag} variant="secondary" className="gap-1 rounded-[7px] bg-accent text-[11.5px] font-semibold text-accent-foreground">
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
                          {t('community.ideaForm.tagsDescription')}
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
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="text-[17px] font-bold">{t('community.ideaForm.stepCurrentState')}</CardTitle>
                  <CardDescription className="text-[13px]">
                    {t('community.ideaForm.currentStateDescription')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="current_process"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={LABEL_CLASSES}>{t('community.ideaForm.currentProcessLabel')}</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={t('community.ideaForm.currentProcessPlaceholder')}
                            className="min-h-[120px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('community.ideaForm.currentProcessDescription')}
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
                        <FormLabel className={LABEL_CLASSES}>{t('community.ideaForm.painPointsLabel')}</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={t('community.ideaForm.painPointsPlaceholder')}
                            className="min-h-[120px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('community.ideaForm.painPointsDescription')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="affected_roles"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={LABEL_CLASSES}>{t('community.ideaForm.affectedRolesLabel')}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t('community.ideaForm.affectedRolesPlaceholder')}
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            {t('community.ideaForm.affectedRolesDescription')}
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
                          <FormLabel className={LABEL_CLASSES}>{t('community.ideaForm.frequencyLabel')}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t('community.ideaForm.frequencyPlaceholder')}
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            {t('community.ideaForm.frequencyDescription')}
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
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="text-[17px] font-bold">{t('community.ideaForm.proposedTitle')}</CardTitle>
                  <CardDescription className="text-[13px]">
                    {t('community.ideaForm.proposedDescription')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="proposed_improvement"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={LABEL_CLASSES}>{t('community.ideaForm.proposedImprovementLabel')}</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={t('community.ideaForm.proposedImprovementPlaceholder')}
                            className="min-h-[150px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('community.ideaForm.proposedImprovementDescription')}
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
                        <FormLabel className={LABEL_CLASSES}>{t('community.ideaForm.desiredProcessLabel')}</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={t('community.ideaForm.desiredProcessPlaceholder')}
                            className="min-h-[120px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('community.ideaForm.desiredProcessDescription')}
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
                        <FormLabel className={LABEL_CLASSES}>{t('community.ideaForm.successMetricsLabel')}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('community.ideaForm.successMetricsPlaceholder')}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('community.ideaForm.successMetricsDescription')}
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
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="text-[17px] font-bold">{t('community.ideaForm.detailsTitle')}</CardTitle>
                  <CardDescription className="text-[13px]">
                    {t('community.ideaForm.detailsDescription')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="data_inputs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={LABEL_CLASSES}>{t('community.ideaForm.dataInputsLabel')}</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={t('community.ideaForm.dataInputsPlaceholder')}
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
                        <FormLabel className={LABEL_CLASSES}>{t('community.ideaForm.systemsLabel')}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('community.ideaForm.systemsPlaceholder')}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('community.ideaForm.systemsDescription')}
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
                        <FormLabel className={LABEL_CLASSES}>{t('community.ideaForm.constraintsLabel')}</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={t('community.ideaForm.constraintsPlaceholder')}
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
            <div className="mt-6 flex justify-between">
              <div className="flex gap-2">
                {currentStep > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCurrentStep(currentStep - 1)}
                    className="rounded-[10px] border-[#dcdee6] text-[13px] font-bold"
                  >
                    {t('common.previous')}
                  </Button>
                )}
                {isEditMode && draftId && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-[10px] text-[13px] font-bold text-destructive hover:text-destructive"
                        disabled={deleteDraftMutation.isPending}
                      >
                        {deleteDraftMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                        )}
                        {t('ideas.deleteDraft')}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('ideas.deleteConfirm')}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('ideas.deleteWarning')}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteDraftMutation.mutate()}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {t('common.delete')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={saveDraftMutation.isPending}
                  className="rounded-[10px] bg-accent text-[13px] font-bold text-accent-foreground hover:bg-[#dfe5f8]"
                >
                  {saveDraftMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save aria-hidden="true" className="h-4 w-4" />
                  )}
                  {t('ideas.saveDraft')}
                </Button>
                {currentStep < steps.length - 1 ? (
                  <Button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setCurrentStep(currentStep + 1);
                    }}
                    className="rounded-[10px] text-[13px] font-bold"
                  >
                    {t('common.next')}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={submitMutation.isPending}
                    className="rounded-[10px] text-[13px] font-bold"
                  >
                    {submitMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send aria-hidden="true" className="h-4 w-4" />
                    )}
                    {t('ideas.submitIdea')}
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
