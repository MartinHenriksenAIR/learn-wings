CREATE TABLE public.org_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins can manage their org settings" ON public.org_settings
  FOR ALL TO public
  USING (is_org_admin(org_id))
  WITH CHECK (is_org_admin(org_id));

CREATE POLICY "Platform admins can manage all org settings" ON public.org_settings
  FOR ALL TO public
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Org members can view their org settings" ON public.org_settings
  FOR SELECT TO public
  USING (is_org_member(org_id));