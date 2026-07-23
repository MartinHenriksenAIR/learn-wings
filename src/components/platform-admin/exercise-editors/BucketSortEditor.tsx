import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { BucketSortConfig } from '@/lib/types';
import { newId } from './validateExercise';

interface Props { value: BucketSortConfig; onChange: (c: BucketSortConfig) => void; }

export function BucketSortEditor({ value, onChange }: Props) {
  const { t } = useTranslation();
  const set = (patch: Partial<BucketSortConfig>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-6">
      <section>
        <h4 className="font-medium mb-2">{t('exercise.editor.buckets')}</h4>
        {value.buckets.map((b) => (
          <div key={b.id} className="flex gap-2 mb-2">
            <Input value={b.label} placeholder={t('exercise.editor.bucketLabel')}
              onChange={(e) => set({ buckets: value.buckets.map((x) => x.id === b.id ? { ...x, label: e.target.value } : x) })} />
            <Button variant="ghost" onClick={() => set({
              buckets: value.buckets.filter((x) => x.id !== b.id),
              items: value.items.map((it) => it.bucketId === b.id ? { ...it, bucketId: '' } : it),
            })} disabled={value.buckets.length <= 2}>✕</Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => set({ buckets: [...value.buckets, { id: newId('b'), label: '' }] })}>
          {t('exercise.editor.addBucket')}
        </Button>
      </section>

      <section>
        <h4 className="font-medium mb-2">{t('exercise.editor.items')}</h4>
        {value.items.map((it) => (
          <div key={it.id} className="flex gap-2 mb-2">
            <Input value={it.text} placeholder={t('exercise.editor.itemText')}
              onChange={(e) => set({ items: value.items.map((x) => x.id === it.id ? { ...x, text: e.target.value } : x) })} />
            <Select value={it.bucketId || undefined}
              onValueChange={(v) => set({ items: value.items.map((x) => x.id === it.id ? { ...x, bucketId: v } : x) })}>
              <SelectTrigger className="w-48"><SelectValue placeholder={t('exercise.editor.correctBucket')} /></SelectTrigger>
              <SelectContent>
                {value.buckets.map((b) => <SelectItem key={b.id} value={b.id}>{b.label || '—'}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" onClick={() => set({ items: value.items.filter((x) => x.id !== it.id) })}
              disabled={value.items.length <= 1}>✕</Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => set({ items: [...value.items, { id: newId('i'), text: '', bucketId: '' }] })}>
          {t('exercise.editor.addItem')}
        </Button>
      </section>
    </div>
  );
}
