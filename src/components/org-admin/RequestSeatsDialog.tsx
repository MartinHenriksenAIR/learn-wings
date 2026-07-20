import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useToastMutation } from '@/hooks/useToastMutation';
import { useSeatPricing } from '@/hooks/useSeatPricing';
import type { SeatRequest } from '@/lib/types';

interface RequestSeatsDialogProps {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RequestSeatsDialog({ orgId, open, onOpenChange }: RequestSeatsDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: pricing, isLoading } = useSeatPricing();
  const [seats, setSeats] = useState(1);

  const price = pricing?.annual_price_per_seat ?? null;
  const currency = pricing?.currency ?? 'DKK';
  const priceConfigured = price !== null;
  const total = priceConfigured ? seats * price : 0;

  const mutation = useToastMutation({
    mutationFn: () =>
      callApi<{ request: SeatRequest }>('/api/seat-request-create', { orgId, additionalSeats: seats }),
    errorTitle: t('seatRequests.submit'),
    onSuccess: () => {
      toast({ title: t('seatRequests.submitted') });
      queryClient.invalidateQueries({ queryKey: queryKeys.seatRequests.list(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.orgDetail.detail(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.all });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('seatRequests.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('seatRequests.dialogDescription')}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : !priceConfigured ? (
          <p className="text-sm font-medium text-muted-foreground">{t('seatRequests.notConfigured')}</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="additional_seats" className="text-xs font-bold text-[#4a4f60]">
                {t('seatRequests.additionalSeats')}
              </Label>
              <Input
                id="additional_seats"
                type="number"
                min={1}
                max={1000}
                step={1}
                value={seats}
                onChange={(e) => setSeats(Math.max(1, Math.min(1000, Math.round(Number(e.target.value) || 1))))}
              />
            </div>
            <p className="text-sm font-medium">
              {t('seatRequests.estimate', { seats, price, currency, total })}
            </p>
            <p className="text-xs text-muted-foreground">{t('seatRequests.vatNote')}</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!priceConfigured || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('seatRequests.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
