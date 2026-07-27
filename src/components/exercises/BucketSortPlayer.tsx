import { useState, type ReactNode } from 'react';
import {
  DndContext, KeyboardSensor, PointerSensor,
  useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BucketSortConfig } from '@/lib/types';
import { useBucketAssignments } from './useBucketAssignments';

interface Props { config: BucketSortConfig; onComplete: () => void; }

const TRAY = '__tray__';

export function BucketSortPlayer({ config, onComplete }: Props) {
  const { t } = useTranslation();
  const { assignments, assign, isAllCorrect } = useBucketAssignments(config);
  const [selected, setSelected] = useState<string | null>(null);   // click-to-place selection
  const [checked, setChecked] = useState(false);
  const [completed, setCompleted] = useState(false);   // latch: onComplete fires exactly once
  // distance:8 → a zero-movement click is NOT treated as a drag, so a plain click still
  // reaches the item's onClick (click-to-place); a real drag starts after 8px of movement.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const place = (itemId: string, bucketId: string | null) => { assign(itemId, bucketId); setSelected(null); setChecked(false); };
  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over?.id as string | undefined;
    if (over) place(e.active.id as string, over === TRAY ? null : over);
  };
  const handleCheck = () => {
    setChecked(true);
    if (isAllCorrect && !completed) { setCompleted(true); onComplete(); }
  };

  const itemsIn = (bucketId: string | null) => config.items.filter((it) => (assignments[it.id] ?? null) === bucketId);
  const itemById = (id: string) => config.items.find((it) => it.id === id)!;

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {/* Tray of unassigned items */}
      <Tray bucketId={null} selected={selected}>
        {itemsIn(null).map((it) => (
          <Item key={it.id} id={it.id} text={it.text} isSelected={selected === it.id}
            onSelect={() => setSelected(selected === it.id ? null : it.id)} />
        ))}
      </Tray>

      {/* One drop zone per bucket */}
      <div className="grid gap-4 sm:grid-cols-2 mt-4">
        {config.buckets.map((b) => (
          <Bucket key={b.id} id={b.id} label={b.label}
            canPlace={!!selected}
            onPlaceClick={() => selected && place(selected, b.id)}>
            {itemsIn(b.id).map((it) => {
              const correct = itemById(it.id).bucketId === b.id;
              return (
                <Item key={it.id} id={it.id} text={it.text} isSelected={selected === it.id}
                  feedback={checked ? (correct ? 'correct' : 'incorrect') : undefined}
                  onSelect={() => setSelected(selected === it.id ? null : it.id)} />
              );
            })}
          </Bucket>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={handleCheck} disabled={completed}>{t('exercise.check')}</Button>
        {checked && (
          <span role="status" className={cn('text-sm', isAllCorrect ? 'text-green-600' : 'text-destructive')}>
            {isAllCorrect ? t('exercise.allCorrect') : t('exercise.tryAgain')}
          </span>
        )}
      </div>
    </DndContext>
  );
}

// Draggable + click-selectable item (button => keyboard/click operable by default)
function Item({ id, text, isSelected, feedback, onSelect }: {
  id: string; text: string; isSelected: boolean; feedback?: 'correct' | 'incorrect'; onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <button ref={setNodeRef} {...listeners} {...attributes} type="button" onClick={onSelect}
      aria-pressed={isSelected}
      className={cn('block w-full text-left rounded-md border px-3 py-2 text-sm',
        isSelected && 'ring-2 ring-primary', isDragging && 'opacity-50',
        feedback === 'correct' && 'border-green-600 bg-green-50',
        feedback === 'incorrect' && 'border-destructive bg-destructive/10')}>
      {text}
    </button>
  );
}

function Bucket({ id, label, canPlace, onPlaceClick, children }: {
  id: string; label: string; canPlace: boolean; onPlaceClick: () => void; children: ReactNode;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn('rounded-lg border-2 border-dashed p-3', isOver && 'border-primary bg-accent')}>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{label}</span>
        {canPlace && (
          <button type="button" onClick={onPlaceClick} className="text-xs underline"
            aria-label={t('exercise.placeInBucket', { label })}>{t('exercise.placeHere')}</button>
        )}
      </div>
      <div className="space-y-2 min-h-[3rem]">{children}</div>
    </div>
  );
}

function Tray({ children }: { bucketId: null; selected: string | null; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: TRAY });
  return <div ref={setNodeRef} className={cn('rounded-lg border p-3 space-y-2 min-h-[3rem]', isOver && 'bg-accent')}>{children}</div>;
}
