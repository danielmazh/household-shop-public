import { useRef, useState } from 'preact/hooks';

/** `ids` with the item at `from` moved to `to`. */
export function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it!);
  return next;
}

/**
 * Pointer drag to reorder rows. The handle gets `handle(id)` props; each row
 * needs `data-reorder-id`. The new order is sent once, on release. Keyboard
 * and screen reader users use the up and down buttons instead.
 */
export function useDragOrder(ids: readonly string[], onCommit: (ids: string[]) => void) {
  const [drag, setDrag] = useState<{ id: string; order: string[] } | null>(null);
  const start = useRef<string[]>([]);
  const order = drag?.order ?? [...ids];

  const handle = (id: string) => ({
    class: 'drag-handle',
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      start.current = [...ids];
      setDrag({ id, order: [...ids] });
    },
    onPointerMove: (e: PointerEvent) => {
      if (!drag) return;
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-reorder-id]')?.dataset.reorderId;
      if (!over || over === drag.id) return;
      setDrag({ id: drag.id, order: move(drag.order, drag.order.indexOf(drag.id), drag.order.indexOf(over)) });
    },
    onPointerUp: () => {
      if (!drag) return;
      const changed = drag.order.some((x, n) => x !== start.current[n]);
      setDrag(null);
      if (changed) onCommit(drag.order);
    },
    onPointerCancel: () => setDrag(null),
  });

  return { order, dragging: drag?.id ?? null, handle };
}
