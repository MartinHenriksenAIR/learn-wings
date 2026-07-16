import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Loader2 } from 'lucide-react';
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
} from '@/components/ui/dialog';
import { FileUpload } from '@/components/ui/file-upload';
import { buildPublicUrl } from '@/lib/storage-url';
import type { Organization } from '@/lib/types';

export interface EditOrgPayload {
  name: string;
  slug: string;
  logoUrl: string | null;
  seatLimit: string;
}

interface EditOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  org: Organization;
  orgId: string | undefined;
  onSubmit: (payload: EditOrgPayload) => void;
  pending: boolean;
}

/**
 * Edit-organization dialog (logo FileUpload + name / slug / seat-limit).
 * Owns its own form state, seeded from `org` each time the dialog opens.
 */
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

  // Seed the form from the org each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName(org.name);
      setSlug(org.slug);
      setLogoUrl(org.logo_url || null);
      setSeatLimit(org.seat_limit?.toString() || '');
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
            <Label>{t('orgDetail.logo')}</Label>
            <div className="border-2 border-dashed rounded-lg p-4 mb-3">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                  <Building2 className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{t('orgDetail.logoRecommended')}</p>
                  <p className="text-xs text-muted-foreground">{t('orgDetail.logoSize')}</p>
                  <p className="text-xs text-muted-foreground">{t('orgDetail.logoFormat')}</p>
                </div>
              </div>
            </div>
            <FileUpload
              bucket="org-logos"
              folder={orgId}
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onSubmit({ name, slug, logoUrl, seatLimit })} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
