-- Add seat_limit column to organizations table
ALTER TABLE public.organizations
ADD COLUMN seat_limit integer DEFAULT NULL;

-- Add a comment explaining the column
COMMENT ON COLUMN public.organizations.seat_limit IS 'Maximum number of users allowed in this organization. NULL means unlimited.';