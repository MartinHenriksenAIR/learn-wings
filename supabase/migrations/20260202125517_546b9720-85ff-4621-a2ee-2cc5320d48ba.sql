-- Create resources table for org-scoped resource sharing
CREATE TABLE public.community_resources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  resource_type TEXT NOT NULL DEFAULT 'link', -- link, document, template, guide
  url TEXT,
  tags TEXT[] DEFAULT '{}'::TEXT[],
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.community_resources ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Org members can view resources"
ON public.community_resources
FOR SELECT
USING (is_org_member(org_id));

CREATE POLICY "Org members can create resources"
ON public.community_resources
FOR INSERT
WITH CHECK ((user_id = auth.uid()) AND is_org_member(org_id));

CREATE POLICY "Authors can update their resources"
ON public.community_resources
FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Authors can delete their resources"
ON public.community_resources
FOR DELETE
USING (user_id = auth.uid());

CREATE POLICY "Org admins can manage all resources"
ON public.community_resources
FOR ALL
USING (is_org_admin(org_id))
WITH CHECK (is_org_admin(org_id));

CREATE POLICY "Platform admins can manage all resources"
ON public.community_resources
FOR ALL
USING (is_platform_admin())
WITH CHECK (is_platform_admin());

-- Updated at trigger
CREATE TRIGGER update_community_resources_updated_at
BEFORE UPDATE ON public.community_resources
FOR EACH ROW
EXECUTE FUNCTION public.update_community_updated_at();

-- Remove Resources / Templates category
DELETE FROM public.community_categories WHERE slug = 'resources-templates';