import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2 } from 'lucide-react';

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => Promise<void>;
  targetType: 'post' | 'comment';
}

const REPORT_REASONS = [
  { value: 'spam', label: 'Spam or misleading' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'off-topic', label: 'Off-topic or irrelevant' },
  { value: 'other', label: 'Other' },
];

export function ReportDialog({
  open,
  onOpenChange,
  onSubmit,
  targetType,
}: ReportDialogProps) {
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [customReason, setCustomReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const reason = selectedReason === 'other' 
      ? customReason.trim() 
      : REPORT_REASONS.find(r => r.value === selectedReason)?.label || selectedReason;
    
    if (!reason) return;
    
    setIsSubmitting(true);
    try {
      await onSubmit(reason);
      onOpenChange(false);
      setSelectedReason('');
      setCustomReason('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isValid = selectedReason && (selectedReason !== 'other' || customReason.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report {targetType}</DialogTitle>
          <DialogDescription>
            Help us understand what's wrong with this {targetType}. Your report will be reviewed by moderators.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <RadioGroup value={selectedReason} onValueChange={setSelectedReason}>
            {REPORT_REASONS.map((reason) => (
              <div key={reason.value} className="flex items-center space-x-2">
                <RadioGroupItem value={reason.value} id={reason.value} />
                <Label htmlFor={reason.value} className="font-normal">
                  {reason.label}
                </Label>
              </div>
            ))}
          </RadioGroup>

          {selectedReason === 'other' && (
            <div className="space-y-2">
              <Label htmlFor="custom-reason">Please describe the issue</Label>
              <Textarea
                id="custom-reason"
                placeholder="Describe why you're reporting this content..."
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Submit Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
