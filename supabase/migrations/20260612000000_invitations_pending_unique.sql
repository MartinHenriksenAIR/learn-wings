-- Enforce at most one pending invitation per (org_id, email).
-- functions/invitation-create and functions/invitation-bulk-create already
-- catch unique_violation (23505) and surface "An invitation for this email is
-- already pending" — a branch that could never fire without this index (#91).

-- 1. Dedupe existing duplicate pending rows: per (org_id, email) keep the row
--    with the latest expires_at (id as deterministic tie-break) and mark the
--    rest 'expired'.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY org_id, email
           ORDER BY expires_at DESC, id DESC
         ) AS rn
  FROM public.invitations
  WHERE status = 'pending'
)
UPDATE public.invitations i
SET status = 'expired'
FROM ranked r
WHERE i.id = r.id
  AND r.rn > 1;

-- 2. Partial unique index: uniqueness applies only while pending; accepted /
--    expired / revoked history rows are unaffected.
CREATE UNIQUE INDEX invitations_pending_unique_per_org
  ON public.invitations (org_id, email)
  WHERE status = 'pending';
