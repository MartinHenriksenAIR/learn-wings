-- Create org-logos bucket (public for display)
INSERT INTO storage.buckets (id, name, public)
VALUES ('org-logos', 'org-logos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for org-logos bucket
CREATE POLICY "Anyone can view org logos"
ON storage.objects FOR SELECT
USING (bucket_id = 'org-logos');

CREATE POLICY "Platform admins can upload org logos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'org-logos' AND is_platform_admin());

CREATE POLICY "Platform admins can update org logos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'org-logos' AND is_platform_admin());

CREATE POLICY "Platform admins can delete org logos"
ON storage.objects FOR DELETE
USING (bucket_id = 'org-logos' AND is_platform_admin());

-- RLS Policies for lms-assets bucket (already exists)
CREATE POLICY "Platform admins can upload lms assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'lms-assets' AND is_platform_admin());

CREATE POLICY "Platform admins can update lms assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'lms-assets' AND is_platform_admin());

CREATE POLICY "Platform admins can delete lms assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'lms-assets' AND is_platform_admin());

CREATE POLICY "Authenticated users can read lms assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'lms-assets' AND auth.role() = 'authenticated');