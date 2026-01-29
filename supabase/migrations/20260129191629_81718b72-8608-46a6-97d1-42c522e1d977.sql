-- Create idea_status enum
CREATE TYPE public.idea_status AS ENUM ('draft', 'submitted', 'under_review', 'approved', 'in_progress', 'completed', 'archived');

-- Create idea_categories table (platform-wide taxonomy)
CREATE TABLE public.idea_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES public.idea_categories(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create ideas table (core idea records)
CREATE TABLE public.ideas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.idea_categories(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    problem_statement TEXT,
    proposed_solution TEXT,
    expected_impact TEXT,
    status idea_status NOT NULL DEFAULT 'draft',
    course_context_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
    lesson_context_id UUID REFERENCES public.lessons(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    submitted_at TIMESTAMP WITH TIME ZONE
);

-- Create idea_comments table
CREATE TABLE public.idea_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idea_id UUID NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    parent_comment_id UUID REFERENCES public.idea_comments(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create idea_votes table
CREATE TABLE public.idea_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idea_id UUID NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(idea_id, user_id)
);

-- Create idea_evaluations table (org admin assessments)
CREATE TABLE public.idea_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idea_id UUID NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
    evaluated_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    value_score INTEGER CHECK (value_score >= 1 AND value_score <= 5),
    complexity_score INTEGER CHECK (complexity_score >= 1 AND complexity_score <= 5),
    notes TEXT,
    viability_assessment TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create idea_specifications table (scope documents)
CREATE TABLE public.idea_specifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idea_id UUID NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    problem_definition TEXT,
    success_criteria TEXT,
    requirements TEXT,
    out_of_scope TEXT,
    dependencies TEXT,
    risks TEXT,
    estimated_effort TEXT,
    next_steps TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create ai_conversations table (chat history with AI)
CREATE TABLE public.ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    context_type TEXT NOT NULL CHECK (context_type IN ('ideas_hub', 'course', 'lesson')),
    context_id UUID,
    idea_id UUID REFERENCES public.ideas(id) ON DELETE SET NULL,
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_ideas_org_id ON public.ideas(org_id);
CREATE INDEX idx_ideas_user_id ON public.ideas(user_id);
CREATE INDEX idx_ideas_status ON public.ideas(status);
CREATE INDEX idx_ideas_category_id ON public.ideas(category_id);
CREATE INDEX idx_idea_comments_idea_id ON public.idea_comments(idea_id);
CREATE INDEX idx_idea_votes_idea_id ON public.idea_votes(idea_id);
CREATE INDEX idx_ai_conversations_user_id ON public.ai_conversations(user_id);
CREATE INDEX idx_ai_conversations_idea_id ON public.ai_conversations(idea_id);

-- Enable RLS on all tables
ALTER TABLE public.idea_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_specifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for idea_categories (platform-wide, read by all authenticated)
CREATE POLICY "Anyone can view idea categories"
ON public.idea_categories FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Platform admins can manage categories"
ON public.idea_categories FOR ALL
USING (is_platform_admin());

-- RLS Policies for ideas (fully transparent within org)
CREATE POLICY "Platform admins can do everything with ideas"
ON public.ideas FOR ALL
USING (is_platform_admin());

CREATE POLICY "Org members can view all ideas in their org"
ON public.ideas FOR SELECT
USING (is_org_member(org_id));

CREATE POLICY "Users can create ideas in their org"
ON public.ideas FOR INSERT
WITH CHECK (user_id = auth.uid() AND is_org_member(org_id));

CREATE POLICY "Users can update their own ideas"
ON public.ideas FOR UPDATE
USING (user_id = auth.uid() AND is_org_member(org_id));

CREATE POLICY "Users can delete their own draft ideas"
ON public.ideas FOR DELETE
USING (user_id = auth.uid() AND status = 'draft');

-- RLS Policies for idea_comments
CREATE POLICY "Platform admins can do everything with comments"
ON public.idea_comments FOR ALL
USING (is_platform_admin());

CREATE POLICY "Org members can view comments in their org"
ON public.idea_comments FOR SELECT
USING (is_org_member(org_id));

CREATE POLICY "Users can create comments in their org"
ON public.idea_comments FOR INSERT
WITH CHECK (user_id = auth.uid() AND is_org_member(org_id));

CREATE POLICY "Users can update their own comments"
ON public.idea_comments FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own comments"
ON public.idea_comments FOR DELETE
USING (user_id = auth.uid());

-- RLS Policies for idea_votes
CREATE POLICY "Platform admins can do everything with votes"
ON public.idea_votes FOR ALL
USING (is_platform_admin());

CREATE POLICY "Org members can view votes in their org"
ON public.idea_votes FOR SELECT
USING (is_org_member(org_id));

CREATE POLICY "Users can manage their own votes"
ON public.idea_votes FOR ALL
USING (user_id = auth.uid() AND is_org_member(org_id));

-- RLS Policies for idea_evaluations (org admins only)
CREATE POLICY "Platform admins can do everything with evaluations"
ON public.idea_evaluations FOR ALL
USING (is_platform_admin());

CREATE POLICY "Org admins can manage evaluations for ideas in their org"
ON public.idea_evaluations FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.ideas i
        WHERE i.id = idea_id AND is_org_admin(i.org_id)
    )
);

CREATE POLICY "Org members can view evaluations for ideas in their org"
ON public.idea_evaluations FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.ideas i
        WHERE i.id = idea_id AND is_org_member(i.org_id)
    )
);

-- RLS Policies for idea_specifications
CREATE POLICY "Platform admins can do everything with specifications"
ON public.idea_specifications FOR ALL
USING (is_platform_admin());

CREATE POLICY "Org admins can manage specifications for ideas in their org"
ON public.idea_specifications FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.ideas i
        WHERE i.id = idea_id AND is_org_admin(i.org_id)
    )
);

CREATE POLICY "Org members can view specifications for ideas in their org"
ON public.idea_specifications FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.ideas i
        WHERE i.id = idea_id AND is_org_member(i.org_id)
    )
);

-- RLS Policies for ai_conversations (user-scoped)
CREATE POLICY "Platform admins can view all conversations"
ON public.ai_conversations FOR SELECT
USING (is_platform_admin());

CREATE POLICY "Users can manage their own conversations"
ON public.ai_conversations FOR ALL
USING (user_id = auth.uid());

-- Create trigger function for updating updated_at
CREATE OR REPLACE FUNCTION public.update_ideas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Add update triggers
CREATE TRIGGER update_ideas_updated_at
    BEFORE UPDATE ON public.ideas
    FOR EACH ROW
    EXECUTE FUNCTION public.update_ideas_updated_at();

CREATE TRIGGER update_idea_comments_updated_at
    BEFORE UPDATE ON public.idea_comments
    FOR EACH ROW
    EXECUTE FUNCTION public.update_ideas_updated_at();

CREATE TRIGGER update_idea_evaluations_updated_at
    BEFORE UPDATE ON public.idea_evaluations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_ideas_updated_at();

CREATE TRIGGER update_idea_specifications_updated_at
    BEFORE UPDATE ON public.idea_specifications
    FOR EACH ROW
    EXECUTE FUNCTION public.update_ideas_updated_at();

CREATE TRIGGER update_ai_conversations_updated_at
    BEFORE UPDATE ON public.ai_conversations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_ideas_updated_at();

-- Enable realtime for idea_comments (for live discussions)
ALTER PUBLICATION supabase_realtime ADD TABLE public.idea_comments;