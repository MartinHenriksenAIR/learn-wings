import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileUpload } from '@/components/ui/file-upload';
import { callApi, ApiError } from '@/lib/api-client';
import { routes } from '@/lib/routes';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useProfiles } from '@/hooks/useProfiles';
import { Organization, OrgRole } from '@/lib/types';
import { Building2, Plus, Loader2, ChevronRight, UserPlus, Mail, Search } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { sendInvitationEmail } from '@/lib/sendInvitationEmail';
import { useSignedBrandingUrl } from '@/hooks/useSignedBrandingUrl';
import { orgSchema } from '@/lib/org-validation';
import { SeatUsageBar } from '@/components/platform-admin/SeatUsageBar';

/** Org-list row logo: signs the stored branding path for display; placeholder otherwise. */
function OrgRowLogo({ logoPath }: { logoPath: string | null }) {
  const { data: src } = useSignedBrandingUrl(logoPath);
  if (src) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-muted">
        <img src={src} alt="" className="max-h-full max-w-full object-contain" />
      </span>
    );
  }
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-accent text-primary">
      <Building2 className="h-[17px] w-[17px]" aria-hidden="true" />
    </span>
  );
}

export default function OrganizationsManager() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const {
    data: orgsData,
    isLoading: loading,
    error: orgsError,
    refetch: refetchOrgs,
  } = useOrganizations();
  const orgs = useMemo<(Organization & { memberCount: number; usedSeats: number })[]>(
    () =>
      (orgsData ?? []).map((o) => ({
        ...o,
        memberCount: o.member_count ?? 0,
        // A seat is consumed by an active member OR a pending invite, so the
        // seat ratio / atLimit must count both (the plain Members column below
        // still shows active members only).
        usedSeats: (o.member_count ?? 0) + (o.pending_invite_count ?? 0),
      })),
    [orgsData]
  );
  const { data: profiles = [], error: profilesError } = useProfiles();
  const [searchQuery, setSearchQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  // logoUrl holds the raw container-relative path (for create); sign it for the preview.
  const { data: logoDisplaySrc } = useSignedBrandingUrl(logoUrl);
  const [seatLimit, setSeatLimit] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Initial admin state
  const [adminTab, setAdminTab] = useState<'existing' | 'invite'>('existing');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [inviteEmail, setInviteEmail] = useState('');

  // Org list failures surface the same way the old inline fetch did.
  useEffect(() => {
    if (orgsError) {
      toast({
        title: 'Failed to load organizations',
        description: orgsError instanceof Error ? orgsError.message : 'Unknown error',
        variant: 'destructive',
      });
      console.error('OrganizationsManager: failed to load organizations', orgsError);
    }
  }, [orgsError]);

  // Profile list failures surface the same way the old inline fetch did.
  useEffect(() => {
    if (profilesError) {
      toast({
        title: 'Failed to load users',
        description: profilesError instanceof Error ? profilesError.message : 'Unknown error',
        variant: 'destructive',
      });
      console.error('OrganizationsManager: failed to load profiles', profilesError);
    }
  }, [profilesError]);

  const handleCreate = async () => {
    setErrors({});

    const result = orgSchema.safeParse({ name, slug });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) fieldErrors[err.path[0] as string] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setCreating(true);
    try {
      let newOrg: Organization;
      try {
        const result = await callApi<{ organization: Organization }>('/api/organization-create', {
          name,
          slug,
          logo_url: logoUrl,
          seat_limit: seatLimit ? parseInt(seatLimit, 10) : null,
        });
        newOrg = result.organization;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create organization';
        // Match the structured code (ADR-0013), not the English error sentence.
        if (err instanceof ApiError && err.code === 'DUPLICATE_SLUG') {
          setErrors({ slug: t('organizations.slugTaken') });
        } else {
          toast({
            title: 'Failed to create organization',
            description: message,
            variant: 'destructive',
          });
        }
        return;
      }

      // Post-create steps capture each step's error so a follow-up failure no
      // longer hides behind a green success toast.
      let postCreateError: string | null = null;

      if (adminTab === 'existing' && selectedUserId) {
        try {
          await callApi('/api/org-membership-create', {
            orgId: newOrg.id,
            userId: selectedUserId,
            role: 'org_admin' as OrgRole,
            status: 'active',
          });
        } catch (err) {
          postCreateError = `admin assignment failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      } else if (adminTab === 'invite' && inviteEmail.trim()) {
        try {
          const { invitation } = await callApi<{ invitation: { id: string; link_id: string } }>(
            '/api/invitation-create',
            {
              orgId: newOrg.id,
              email: inviteEmail.trim(),
              role: 'org_admin' as OrgRole,
            },
          );

          if (invitation?.link_id) {
            const emailResult = await sendInvitationEmail({
              email: inviteEmail.trim(),
              orgName: name,
              role: 'org_admin',
              linkId: invitation.link_id,
            });
            if (!emailResult.success) {
              postCreateError = `invitation email failed: ${emailResult.error ?? 'unknown'}`;
            }
          }
        } catch (err) {
          postCreateError = `invitation creation failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      }

      if (postCreateError) {
        toast({
          title: 'Organization created, but follow-up step failed',
          description: postCreateError,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Organization created!',
          description: `${name} is now ready.`,
        });
      }
      setCreateOpen(false);
      resetForm();
      refetchOrgs();
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setName('');
    setSlug('');
    setLogoUrl(null);
    setSeatLimit('');
    setAdminTab('existing');
    setSelectedUserId('');
    setInviteEmail('');
    setErrors({});
  };

  // Auto-generate slug from name
  useEffect(() => {
    const generatedSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    setSlug(generatedSlug);
  }, [name]);

  if (loading) {
    return (
      <AppLayout title={t('organizations.title')} breadcrumbs={[{ label: t('organizations.title') }]}>
        <PageSpinner />
      </AppLayout>
    );
  }

  const filteredOrgs = orgs.filter(org =>
    searchQuery === '' ||
    org.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    org.slug.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const createDialog = (
    <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetForm(); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('organizations.newOrganization')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('organizations.createOrganization')}</DialogTitle>
          <DialogDescription>{t('organizations.createDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Logo Upload */}
          <div className="space-y-2">
            <Label>{t('organizations.logoOptional')}</Label>
            <FileUpload
              assetType="org-logo"
              accept="image"
              value={logoDisplaySrc ?? null}
              onChange={(url, storagePath) => {
                // Store the raw container-relative path; it's signed for display
                // via the value prop above (useSignedBrandingUrl).
                setLogoUrl(url && storagePath ? storagePath : null);
              }}
              maxSizeMB={5}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">{t('organizations.organizationName')}</Label>
            <Input
              id="name"
              placeholder="Acme Corporation"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={errors.name ? 'border-destructive' : ''}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">{t('organizations.slug')}</Label>
            <Input
              id="slug"
              placeholder="acme-corp"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className={`font-mono ${errors.slug ? 'border-destructive' : ''}`}
            />
            {errors.slug && (
              <p className="text-xs text-destructive">{errors.slug}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="seatLimit">{t('organizations.seatLimitOptional')}</Label>
            <Input
              id="seatLimit"
              type="number"
              min="1"
              placeholder={t('organizations.seatLimitPlaceholder')}
              value={seatLimit}
              onChange={(e) => setSeatLimit(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t('organizations.seatLimitHint')}
            </p>
          </div>

          {/* Initial Admin Assignment */}
          <div className="space-y-2">
            <Label>{t('organizations.initialAdminOptional')}</Label>
            <Tabs value={adminTab} onValueChange={(v) => setAdminTab(v as 'existing' | 'invite')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="existing" className="flex items-center gap-1">
                  <UserPlus className="h-3 w-3" aria-hidden="true" />
                  {t('organizations.existingUser')}
                </TabsTrigger>
                <TabsTrigger value="invite" className="flex items-center gap-1">
                  <Mail className="h-3 w-3" aria-hidden="true" />
                  {t('organizations.sendInvite')}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="existing" className="mt-2">
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('organizations.selectUser')} />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TabsContent>
              <TabsContent value="invite" className="mt-2">
                <Input
                  type="email"
                  placeholder="admin@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('organizations.inviteEmailHint')}
                </p>
              </TabsContent>
            </Tabs>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCreateOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('organizations.createOrganization')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <AppLayout breadcrumbs={[{ label: t('organizations.title') }]}>
      {/* Header — the page owns its heading; AppLayout `title` is omitted here to avoid a
          duplicate <h1> (the loading/error branches keep `title` since they have no in-page header). */}
      <div className="mb-5 flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div>
          <h1 className="font-display text-[26px] font-extrabold tracking-[-0.02em]">{t('organizations.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('organizations.subtitle')}</p>
        </div>
        {createDialog}
      </div>

      {/* Search */}
      <div className="relative mb-[18px] max-w-[420px]">
        <Search aria-hidden="true" className="absolute left-[13px] top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0af]" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('organizations.searchPlaceholder')}
          className="pl-10"
        />
      </div>

      {/* Organizations List */}
      {filteredOrgs.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-6 w-6" />}
          title={searchQuery ? t('organizations.noMatchingTitle') : t('organizations.noOrganizationsTitle')}
          description={searchQuery ? t('organizations.noMatchingDescription') : t('organizations.noOrganizationsDescription')}
          action={
            !searchQuery ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('organizations.createOrganization')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {/* Header row */}
          <div className="grid grid-cols-[2.2fr_1.2fr_0.9fr_1fr_1fr_0.4fr] gap-3 bg-[#f7f8fa] px-5 py-3 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[#9aa0af]">
            <span>{t('organizations.colOrganization')}</span>
            <span>{t('organizations.colSlug')}</span>
            <span>{t('organizations.colMembers')}</span>
            <span>{t('organizations.colSeats')}</span>
            <span>{t('organizations.colCreated')}</span>
            <span aria-hidden="true" />
          </div>
          {filteredOrgs.map((org) => {
            const atLimit = !!org.seat_limit && org.usedSeats >= org.seat_limit;
            return (
              <button
                key={org.id}
                type="button"
                onClick={() => navigate(routes.platformAdmin.organizationDetail(org.id))}
                className="grid w-full grid-cols-[2.2fr_1.2fr_0.9fr_1fr_1fr_0.4fr] items-center gap-3 border-t border-[#f3f4f8] px-5 py-3.5 text-left transition-colors hover:bg-[#f7f8fa]"
              >
                {/* Organization: icon chip + name */}
                <span className="flex min-w-0 items-center gap-3">
                  <OrgRowLogo logoPath={org.logo_url} />
                  <span className="truncate text-[13.5px] font-bold">{org.name}</span>
                </span>
                {/* Slug (mono) */}
                <span className="truncate font-mono text-[12.5px] text-muted-foreground">{org.slug}</span>
                {/* Members */}
                <span className="text-[13px] font-semibold text-[#4a4f60]">{org.memberCount}</span>
                {/* Seats: label + usage bar */}
                <span className="min-w-0">
                  {org.seat_limit ? (
                    <>
                      <span className={`text-[13px] font-semibold ${atLimit ? 'text-destructive' : 'text-[#4a4f60]'}`}>
                        {org.usedSeats}/{org.seat_limit}
                      </span>
                      <SeatUsageBar
                        used={org.usedSeats}
                        limit={org.seat_limit}
                        className="mt-1.5 h-[5px]"
                      />
                    </>
                  ) : (
                    <span className="text-[13px] font-semibold text-muted-foreground">
                      {t('organizations.seatsUnlimited')}
                    </span>
                  )}
                </span>
                {/* Created */}
                <span className="text-[12.5px] text-muted-foreground">
                  {new Date(org.created_at).toLocaleDateString()}
                </span>
                {/* Chevron */}
                <span className="flex justify-end text-[#c3c7d3]">
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
}
