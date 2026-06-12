import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { SearchFilter } from '@/components/ui/search-filter';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileUpload } from '@/components/ui/file-upload';
import { callApi, ApiError } from '@/lib/api-client';
import { useOrganizations } from '@/hooks/useOrganizations';
import { Organization, Profile, OrgRole } from '@/lib/types';
import { Building2, Plus, Users, Loader2, ChevronRight, UserPlus, Mail, UsersRound } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { sendInvitationEmail } from '@/lib/sendInvitationEmail';
import { buildPublicUrl } from '@/lib/storage-url';
import { orgSchema } from '@/lib/org-validation';

export default function OrganizationsManager() {
  const navigate = useNavigate();
  const {
    data: orgsData,
    isLoading: loading,
    error: orgsError,
    refetch: refetchOrgs,
  } = useOrganizations();
  const orgs = useMemo<(Organization & { memberCount: number })[]>(
    () => (orgsData ?? []).map((o) => ({ ...o, memberCount: o.member_count })),
    [orgsData]
  );
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
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

  const fetchProfiles = async () => {
    try {
      const { profiles } = await callApi<{ profiles: Profile[] }>('/api/profiles', {});
      if (profiles) setProfiles(profiles);
    } catch (err) {
      toast({
        title: 'Failed to load users',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
      console.error('OrganizationsManager: failed to load profiles', err);
    }
  };

  useEffect(() => {
    fetchProfiles();
  }, []);

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
          setErrors({ slug: 'This slug is already taken' });
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
      <AppLayout title="Organizations" breadcrumbs={[{ label: 'Organizations' }]}>
        <PageSpinner />
      </AppLayout>
    );
  }

  const filteredOrgs = orgs.filter(org =>
    searchQuery === '' ||
    org.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    org.slug.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AppLayout title="Organizations" breadcrumbs={[{ label: 'Organizations' }]}>
      {/* Search and Actions */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <SearchFilter
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search organizations..."
          onClearFilters={() => setSearchQuery('')}
        />
        <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Organization
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Organization</DialogTitle>
              <DialogDescription>
                Add a new company to the platform.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Logo Upload */}
              <div className="space-y-2">
                <Label>Logo (optional)</Label>
                <FileUpload
                  bucket="org-logos"
                  accept="image"
                  value={logoUrl}
                  onChange={(url, storagePath) => {
                    if (url && storagePath) {
                      setLogoUrl(buildPublicUrl(storagePath));
                    } else {
                      setLogoUrl(null);
                    }
                  }}
                  maxSizeMB={5}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Organization Name</Label>
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
                <Label htmlFor="slug">Slug (URL identifier)</Label>
                <Input
                  id="slug"
                  placeholder="acme-corp"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className={errors.slug ? 'border-destructive' : ''}
                />
                {errors.slug && (
                  <p className="text-xs text-destructive">{errors.slug}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="seatLimit">Seat Limit (optional)</Label>
                <Input
                  id="seatLimit"
                  type="number"
                  min="1"
                  placeholder="Unlimited"
                  value={seatLimit}
                  onChange={(e) => setSeatLimit(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum number of users allowed. Leave empty for unlimited.
                </p>
              </div>

              {/* Initial Admin Assignment */}
              <div className="space-y-2">
                <Label>Initial Admin (optional)</Label>
                <Tabs value={adminTab} onValueChange={(v) => setAdminTab(v as 'existing' | 'invite')}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="existing" className="flex items-center gap-1">
                      <UserPlus className="h-3 w-3" />
                      Existing User
                    </TabsTrigger>
                    <TabsTrigger value="invite" className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      Send Invite
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="existing" className="mt-2">
                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a user..." />
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
                      An invite link will be created for this email.
                    </p>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Organization
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Organizations List */}
      {filteredOrgs.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-6 w-6" />}
          title={searchQuery ? "No matching organizations" : "No organizations yet"}
          description={searchQuery ? "Try a different search term." : "Create your first organization to get started."}
          action={
            !searchQuery ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Organization
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Seats</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrgs.map((org) => (
                <TableRow 
                  key={org.id} 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/app/admin/organizations/${org.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {org.logo_url ? (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted overflow-hidden">
                          <img
                            src={org.logo_url}
                            alt={org.name}
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                      )}
                      <span className="font-medium">{org.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{org.slug}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <UsersRound className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {org.memberCount}
                        {org.seat_limit ? ` / ${org.seat_limit}` : ''}
                      </span>
                      {org.seat_limit && org.memberCount >= org.seat_limit && (
                        <span className="ml-1 text-xs text-destructive font-medium">Full</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(org.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </AppLayout>
  );
}
