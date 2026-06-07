-- Partial index supporting the member_count correlated subquery in
-- functions/organizations/index.ts and isActiveMember lookups in
-- functions/shared/profile.ts. Only indexes active rows, keeping the
-- index small. UNIQUE(org_id, user_id) on the table already covers
-- exact-membership lookups; this adds the org-wide active-count probe.
CREATE INDEX IF NOT EXISTS org_memberships_org_id_active_idx
  ON public.org_memberships (org_id)
  WHERE status = 'active';
