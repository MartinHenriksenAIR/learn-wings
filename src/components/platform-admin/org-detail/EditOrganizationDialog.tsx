import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FileUpload } from '@/components/ui/file-upload';
import { useSignedBrandingUrl } from '@/hooks/useSignedBrandingUrl';
import type { Organization } from '@/lib/types';

export interface EditOrgPayload {
  name: string;
  slug: string;
  logoUrl: string | null;
  seatLimit: string;
  entraTid: string;
  entraTidLabel: string;
  allowSelfRegistration: boolean;
}

interface EditOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  org: Organization;
  orgId: string | undefined;
  onSubmit: (payload: EditOrgPayload) => void;
  pending: boolean;
}

export function EditOrganizationDialog({
  open,
  onOpenChange,
  org,
  orgId,
  onSubmit,
  pending,
}: EditOrganizationDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [seatLimit, setSeatLimit] = useState<string>('');
  const [entraTid, setEntraTid] = useState<string>('');
  const [entraTidLabel, setEntraTidLabel] = useState<string>('');
  const [allowSelfRegistration, setAllowSelfRegistration] = useState(true);
  const { data: logoDisplaySrc } = useSignedBrandingUrl(logoUrl);

  useEffect(() => {
    if (open) {
      setName(org.name);
      setSlug(org.slug);
      setLogoUrl(org.logo_url || null);
      setSeatLimit(org.seat_limit?.toString() || '');
      setEntraTid(org.entra_tid ?? '');
      setEntraTidLabel(org.entra_tid_label ?? '');
      setAllowSelfRegistration(org.allow_self_registration ?? true);
    }
  }, [open, org]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('orgDetail.editDialogTitle')}</DialogTitle>
          <DialogDescription>{t('orgDetail.editDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-org-logo">{t('orgDetail.logo')}</Label>
            <div className="border-2 border-dashed rounded-lg p-4 mb-3">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                  <Building2 className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{t('orgDetail.logoRecommended')}</p>
                  <p className="text-xs text-muted-foreground">{t('orgDetail.logoSize')}</p>
                </div>
              </div>
            </div>
            <FileUpload
              id="edit-org-logo"
              assetType="org-logo"
              folder={orgId}
              accept="image"
              value={logoDisplaySrc ?? null}
              onChange={(url, storagePath) => {
                setLogoUrl(url && storagePath ? storagePath : null);
              }}
              maxSizeMB={5}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-name">{t('orgDetail.organizationName')}</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-slug">{t('orgDetail.slug')}</Label>
            <Input
              id="edit-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="acme-corp"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">{t('orgDetail.slugHint')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-seat-limit">{t('orgDetail.seatLimitLabel')}</Label>
            <Input
              id="edit-seat-limit"
              type="number"
              min="1"
              placeholder="Unlimited"
              value={seatLimit}
              onChange={(e) => setSeatLimit(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('orgDetail.seatLimitHint')}</p>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5 pr-4">
              <Label htmlFor="edit-allow-self-reg" className="text-sm font-medium">
                {t('orgDetail.selfRegLabel')}
              </Label>
              <p className="text-xs text-muted-foreground">{t('orgDetail.selfRegHint')}</p>
            </div>
            <Switch
              id="edit-allow-self-reg"
              checked={allowSelfRegistration}
              onCheckedChange={setAllowSelfRegistration}
            />
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{t('orgDetail.ssoBindingLabel')}</p>
              <p className="text-xs text-muted-foreground">{t('orgDetail.ssoBindingHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-entra-label">{t('orgDetail.ssoDomainLabel')}</Label>
              <Input
                id="edit-entra-label"
                value={entraTidLabel}
                onChange={(e) => setEntraTidLabel(e.target.value)}
                placeholder="acme.com"
              />
              <p className="text-xs text-muted-foreground">{t('orgDetail.ssoDomainHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-entra-tid">{t('orgDetail.ssoTenantIdLabel')}</Label>
              <Input
                id="edit-entra-tid"
                value={entraTid}
                onChange={(e) => setEntraTid(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">{t('orgDetail.ssoTenantIdHint')}</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onSubmit({ name, slug, logoUrl, seatLimit, entraTid, entraTidLabel, allowSelfRegistration })} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
