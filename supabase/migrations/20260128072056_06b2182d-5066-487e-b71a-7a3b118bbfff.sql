-- Create a secure function to accept an invitation
-- This function runs with elevated privileges to create the org membership
CREATE OR REPLACE FUNCTION public.accept_invitation(p_invitation_link_id text, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation RECORD;
  v_result jsonb;
BEGIN
  -- Get the invitation
  SELECT * INTO v_invitation
  FROM invitations
  WHERE link_id = p_invitation_link_id
    AND status = 'pending'
    AND expires_at > NOW();
  
  IF v_invitation IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired invitation');
  END IF;
  
  -- Handle platform admin invite
  IF v_invitation.is_platform_admin_invite THEN
    UPDATE profiles
    SET is_platform_admin = true
    WHERE id = p_user_id;
  -- Handle org invite
  ELSIF v_invitation.org_id IS NOT NULL THEN
    -- Check if membership already exists
    IF NOT EXISTS (
      SELECT 1 FROM org_memberships
      WHERE org_id = v_invitation.org_id AND user_id = p_user_id
    ) THEN
      -- Insert membership with the role from the invitation
      INSERT INTO org_memberships (org_id, user_id, role, status)
      VALUES (v_invitation.org_id, p_user_id, v_invitation.role, 'active');
    END IF;
  END IF;
  
  -- Mark invitation as accepted
  UPDATE invitations
  SET status = 'accepted'
  WHERE id = v_invitation.id;
  
  RETURN jsonb_build_object(
    'success', true,
    'is_platform_admin', v_invitation.is_platform_admin_invite,
    'org_id', v_invitation.org_id,
    'role', v_invitation.role
  );
END;
$$;