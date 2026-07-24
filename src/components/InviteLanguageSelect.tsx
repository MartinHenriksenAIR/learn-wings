import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { InviteLanguage } from '@/lib/inviteLanguage';

interface InviteLanguageSelectProps {
  value: InviteLanguage;
  onChange: (value: InviteLanguage) => void;
  id?: string;
}

/**
 * Language picker for invitation emails. Options reuse the shared `languages.*`
 * labels; the resolved language is applied server-side (an existing recipient's
 * own preference can still override this pick — see ADR-0016 category 3).
 */
export function InviteLanguageSelect({ value, onChange, id = 'invite-language' }: InviteLanguageSelectProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t('common.emailLanguage')}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as InviteLanguage)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="da">{t('languages.da')}</SelectItem>
          <SelectItem value="en">{t('languages.en')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
