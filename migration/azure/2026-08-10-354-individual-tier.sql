-- #354 individual tier — safe to run repeatedly.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'standard';

INSERT INTO public.organizations (id, name, slug, kind, seat_limit, allow_self_registration)
VALUES ('00000000-0000-0000-0000-000000000354', 'AI Uddannelse', 'individuals', 'individual', NULL, false)
ON CONFLICT (id) DO NOTHING;
