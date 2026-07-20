-- migration/azure/03-seat-requests.sql
-- Additive migration for #127 (seat-request flow). IDEMPOTENT — safe to re-run.
-- Apply to prod via psql from Azure Cloud Shell with a temporary single-IP
-- firewall rule (see migration/azure/README.md "How to apply"). HUMAN-GATED.
BEGIN;

DO $$ BEGIN
  CREATE TYPE public.seat_request_status AS ENUM ('pending', 'fulfilled', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.seat_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  additional_seats     integer NOT NULL CHECK (additional_seats >= 1),
  unit_price_snapshot  numeric(12,2) NOT NULL,
  currency             text NOT NULL DEFAULT 'DKK',
  status               public.seat_request_status NOT NULL DEFAULT 'pending',
  created_at           timestamptz NOT NULL DEFAULT now(),
  fulfilled_at         timestamptz,
  fulfilled_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_at         timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS seat_requests_one_pending_per_org
  ON public.seat_requests (org_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS seat_requests_org_id_idx ON public.seat_requests (org_id);

INSERT INTO public.platform_settings (key, value)
VALUES ('seat_pricing', '{"annual_price_per_seat": null, "currency": "DKK", "notification_email": "jacob@ai-raadgivning.dk"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
