-- =============================================
-- COMMUNITY MODULE - PHASE 1C: ENHANCE IDEAS TABLE
-- =============================================

-- Add new columns to ideas table
ALTER TABLE public.ideas
  ADD COLUMN IF NOT EXISTS business_area business_area,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS current_process text,
  ADD COLUMN IF NOT EXISTS pain_points text,
  ADD COLUMN IF NOT EXISTS affected_roles text,
  ADD COLUMN IF NOT EXISTS frequency_volume text,
  ADD COLUMN IF NOT EXISTS proposed_improvement text,
  ADD COLUMN IF NOT EXISTS desired_process text,
  ADD COLUMN IF NOT EXISTS data_inputs text,
  ADD COLUMN IF NOT EXISTS systems_involved text,
  ADD COLUMN IF NOT EXISTS constraints_risks text,
  ADD COLUMN IF NOT EXISTS success_metrics text,
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Add indexes for ideas
CREATE INDEX IF NOT EXISTS idx_ideas_tags ON public.ideas USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_ideas_business_area ON public.ideas(business_area);

-- Create function to check if user can view admin fields
CREATE OR REPLACE FUNCTION public.can_view_idea_admin_fields(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_platform_admin() OR is_org_admin(p_org_id)
$$;