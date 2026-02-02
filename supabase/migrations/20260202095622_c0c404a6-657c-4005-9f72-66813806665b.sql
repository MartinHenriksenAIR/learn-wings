-- Create AI Champions table to track who has the AI Champion title in each org
CREATE TABLE public.ai_champions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES public.profiles(id),
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, org_id)
);

-- Enable RLS
ALTER TABLE public.ai_champions ENABLE ROW LEVEL SECURITY;

-- Org members can view AI champions in their org
CREATE POLICY "Org members can view AI champions"
ON public.ai_champions
FOR SELECT
USING (is_org_member(org_id));

-- Platform admins can view all AI champions
CREATE POLICY "Platform admins can view all AI champions"
ON public.ai_champions
FOR SELECT
USING (is_platform_admin());

-- Org admins can manage AI champions in their org
CREATE POLICY "Org admins can manage AI champions"
ON public.ai_champions
FOR ALL
USING (is_org_admin(org_id))
WITH CHECK (is_org_admin(org_id));

-- Platform admins can manage all AI champions
CREATE POLICY "Platform admins can manage all AI champions"
ON public.ai_champions
FOR ALL
USING (is_platform_admin())
WITH CHECK (is_platform_admin());

-- Create index for performance
CREATE INDEX idx_ai_champions_org_id ON public.ai_champions(org_id);
CREATE INDEX idx_ai_champions_user_id ON public.ai_champions(user_id);