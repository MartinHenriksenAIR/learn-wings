-- Create platform_settings table for storing all platform configuration
CREATE TABLE public.platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb NOT NULL DEFAULT '{}',
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id)
);

-- Enable RLS
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Only platform admins can read/write settings
CREATE POLICY "Platform admins can do everything with settings"
ON public.platform_settings
FOR ALL
USING (is_platform_admin())
WITH CHECK (is_platform_admin());

-- Insert default settings
INSERT INTO public.platform_settings (key, value) VALUES
  ('branding', '{"platform_name": "AIR Academy", "primary_color": "#6366f1", "logo_url": null}'::jsonb),
  ('user_access', '{"default_role": "learner", "require_email_verification": false, "allow_self_registration": true}'::jsonb),
  ('email', '{"from_name": "AIR Academy", "from_email": null, "smtp_configured": false}'::jsonb),
  ('features', '{"certificates_enabled": true, "quizzes_enabled": true, "analytics_enabled": true, "course_reviews_enabled": false}'::jsonb);

-- Create function to update timestamp
CREATE OR REPLACE FUNCTION update_platform_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_platform_settings_timestamp
BEFORE UPDATE ON public.platform_settings
FOR EACH ROW
EXECUTE FUNCTION update_platform_settings_updated_at();