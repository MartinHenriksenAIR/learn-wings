-- Security fix: Protect invitation tokens from being exposed to org admins
-- The issue: org admins can see raw tokens which could be stolen if their account is compromised

-- Step 1: Add a token_hash column to store hashed tokens for lookup
-- And a link_id column for sharing (not the actual token)
ALTER TABLE public.invitations 
ADD COLUMN IF NOT EXISTS token_hash TEXT,
ADD COLUMN IF NOT EXISTS link_id TEXT DEFAULT encode(extensions.gen_random_bytes(16), 'hex');

-- Step 2: Create a function to hash tokens using SHA256
CREATE OR REPLACE FUNCTION public.hash_invitation_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Hash the token for secure lookup
  NEW.token_hash := encode(sha256(NEW.token::bytea), 'hex');
  RETURN NEW;
END;
$$;

-- Step 3: Create trigger to hash tokens on insert/update
DROP TRIGGER IF EXISTS hash_invitation_token_trigger ON public.invitations;
CREATE TRIGGER hash_invitation_token_trigger
  BEFORE INSERT OR UPDATE OF token ON public.invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.hash_invitation_token();

-- Step 4: Update existing invitations to have hashed tokens and link_ids
UPDATE public.invitations 
SET 
  token_hash = encode(sha256(token::bytea), 'hex'),
  link_id = COALESCE(link_id, encode(extensions.gen_random_bytes(16), 'hex'))
WHERE token_hash IS NULL OR link_id IS NULL;

-- Step 5: Create a secure view that hides tokens from org admins
-- Only platform admins can see the actual token (for admin purposes)
CREATE OR REPLACE VIEW public.invitations_safe
WITH (security_invoker = on) AS
SELECT 
  id,
  email,
  org_id,
  role,
  is_platform_admin_invite,
  status,
  expires_at,
  created_at,
  invited_by_user_id,
  link_id,
  -- Only platform admins can see the token
  CASE WHEN is_platform_admin() THEN token ELSE NULL END as token
FROM public.invitations;

-- Step 6: Update the get_invitation_by_token function to use link_id instead
-- This function is called during signup with the link_id from URL
CREATE OR REPLACE FUNCTION public.get_invitation_by_token(lookup_token text)
RETURNS SETOF invitations
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.invitations
  WHERE link_id = lookup_token
    AND status = 'pending'
    AND expires_at > NOW()
  LIMIT 1
$$;

-- Step 7: Create a function for org admins to get the shareable link_id
-- This returns the link_id (not the actual token) for creating invite URLs
CREATE OR REPLACE FUNCTION public.get_invitation_link_id(invitation_id uuid)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT link_id FROM public.invitations
  WHERE id = invitation_id
    AND status = 'pending'
    AND (
      is_platform_admin()
      OR (org_id IS NOT NULL AND is_org_admin(org_id))
    )
  LIMIT 1
$$;