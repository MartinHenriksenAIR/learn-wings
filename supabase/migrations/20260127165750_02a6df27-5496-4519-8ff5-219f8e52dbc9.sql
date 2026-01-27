-- Create course_reviews table
CREATE TABLE public.course_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id, course_id)
);

-- Enable RLS
ALTER TABLE public.course_reviews ENABLE ROW LEVEL SECURITY;

-- Platform admins can do everything
CREATE POLICY "Platform admins can do everything with reviews"
ON public.course_reviews
FOR ALL
USING (is_platform_admin());

-- Org admins can view reviews in their org
CREATE POLICY "Org admins can view reviews in their org"
ON public.course_reviews
FOR SELECT
USING (is_org_admin(org_id));

-- Users can manage their own reviews
CREATE POLICY "Users can manage their own reviews"
ON public.course_reviews
FOR ALL
USING (user_id = auth.uid() AND is_org_member(org_id));

-- Users can view reviews for courses they have access to
CREATE POLICY "Users can view reviews for accessible courses"
ON public.course_reviews
FOR SELECT
USING (
  is_org_member(org_id) AND
  course_id IN (
    SELECT course_id FROM org_course_access 
    WHERE org_id IN (SELECT current_org_ids_for_user()) 
    AND access = 'enabled'
  )
);

-- Create trigger for updated_at
CREATE TRIGGER update_course_reviews_updated_at
BEFORE UPDATE ON public.course_reviews
FOR EACH ROW
EXECUTE FUNCTION public.update_platform_settings_updated_at();