'use client';
import { useCallback, useState } from 'react';

/**
 * Drag to reorder — ONE mechanism, every list.
 *
 * Six lists could be reordered by dragging (dashboard widgets, the menu groups
 * and their entries, deal lines, sales lines, EPC sections and items), and all
 * six had grown their own copy of the same three pieces of state and their own
 * idea of what to draw while a drag is in flight. The owner's verdict on
 * 2026-08-23: *"it feels off and not enough indication. It should have a clear
 * positioning and line where it will land."*
 *
 * He is right, and the diagnosis is precise. Every copy drew a RING AROUND THE
 * ROW under the pointer. A ring says "this row" — but the row is not where the
 * thing lands, it is only what the pointer is over. Three of the six then
 * always inserted BEFORE that row while the other three read the pointer's
 * half, so the same gesture meant different things on different screens, and
 * nothing on the screen said which.
 *
 * So the rule is one rule now, and it draws the ANSWER rather than the
 * question: a line at the exact seam the row will land in, above or below
 * whichever half of the target the pointer is in. The line is the app's action
 * colour, 3px, with a faint halo on the row it belongs to, and it moves the
 * instant the pointer crosses the midline. (3px, not 2: the dashboard's
 * customise panel already outlines the "for your role" rows in the same
 * green, and at 2px the seam had to compete with them.)
 *
 * Native HTML5 drag-and-drop, like everything here before it — no library.
 * The ▲▼ arrows each list already carries are untouched: they are how this
 * works on touch and on a keyboard, where there is no drag at all.
 */

export type DropEdge = 'above' | 'below';

/** Where the dragged row will land, if it is dropped now. */
export interface DropTarget<K> { key: K; after: boolean }

/**
 * The line itself.
 *
 * An inset box-shadow rather than an absolutely-positioned element, for one
 * reason: it has to work identically on a `<li>`, a `<div>`, a grid row and a
 * `<tr>`, and only a shadow does that without a positioned ancestor. The
 * second shadow is the halo — enough to tell the eye which row the seam
 * belongs to, not enough to compete with the line.
 *
 * `opts.table` is for tables: a `<tr>` cannot carry a reliable box-shadow, so
 * the line is drawn on the cells instead, which are contiguous and therefore
 * read as one line.
 */
export function dropLineClass(edge: DropEdge | null, opts?: { table?: boolean }): string {
  if (!edge) return '';
  const y = edge === 'above' ? '3px' : '-3px';
  const line = `inset_0_${y}_0_0_rgb(var(--c-emerald-400))`;
  // Underscores are Tailwind's spaces, so this is `rgb(var(--…) / 0.10)` —
  // the palette stores each colour as a bare triplet, alpha applied here.
  const halo = 'inset_0_0_0_9999px_rgb(var(--c-emerald-400)_/_0.10)';
  return opts?.table
    ? `[&>td]:shadow-[${line},${halo}]`
    : `shadow-[${line},${halo}]`;
}

/** What a row being carried looks like — faded, everywhere, always. */
export const DRAGGING_ROW = 'opacity-40';

/** Every reorderable row wants this: the line has to arrive smoothly. */
export const REORDER_ROW = 'transition-shadow duration-100';

export interface DragReorder<K extends string> {
  /** The row currently being carried, or null. */
  dragKey: K | null;
  /** True while any drag is in flight — for showing a drop zone, say. */
  isDragging: boolean;
  /** Where the line goes for this row: above, below, or nowhere. */
  edgeAt: (key: K) => DropEdge | null;
  /** The line's classes for this row, ready to concatenate. */
  lineAt: (key: K, opts?: { table?: boolean }) => string;
  /** Spread onto the row that can be dropped ON. */
  rowProps: (key: K, opts?: { stopPropagation?: boolean }) => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
  };
  /**
   * Spread onto whatever starts the drag — the whole row, or a grip inside it.
   * `rowImage` drags the picture of the enclosing `[data-drag-row]` element
   * rather than the grip alone, which is what a grip should look like.
   */
  handleProps: (key: K, opts?: { enabled?: boolean; rowImage?: boolean }) => {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  /** Cancel — for an Escape key, or a caller that drops somewhere else. */
  end: () => void;
}

export function useDragReorder<K extends string>(
  /** Do the move. `after` is true when the pointer was in the lower half. */
  onMove: (from: K, to: K, after: boolean) => void,
  opts?: {
    /** Refuse a drop — a different group, a row that cannot move, itself. */
    canDrop?: (from: K, to: K) => boolean;
  },
): DragReorder<K> {
  const [dragKey, setDragKey] = useState<K | null>(null);
  const [target, setTarget] = useState<DropTarget<K> | null>(null);

  const end = useCallback(() => { setDragKey(null); setTarget(null); }, []);

  const accepts = (to: K) =>
    dragKey != null && dragKey !== to && (opts?.canDrop?.(dragKey, to) ?? true);

  /** Top half → it lands above; bottom half → below. Read fresh every time. */
  const halfOf = (e: React.DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };

  return {
    dragKey,
    isDragging: dragKey !== null,
    end,
    edgeAt: (key) => (target && target.key === key ? (target.after ? 'below' : 'above') : null),
    lineAt: (key, o) =>
      dropLineClass(target && target.key === key ? (target.after ? 'below' : 'above') : null, o),
    rowProps: (key, o) => ({
      onDragOver: (e) => {
        if (!accepts(key)) return;
        e.preventDefault();
        if (o?.stopPropagation) e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const after = halfOf(e);
        // Same seam as last frame: leave state alone rather than re-render on
        // every pixel of pointer travel.
        setTarget((t) => (t && t.key === key && t.after === after ? t : { key, after }));
      },
      onDragLeave: () => setTarget((t) => (t && t.key === key ? null : t)),
      onDrop: (e) => {
        e.preventDefault();
        if (o?.stopPropagation) e.stopPropagation();
        const from = dragKey;
        if (from && accepts(key)) onMove(from, key, halfOf(e));
        end();
      },
    }),
    handleProps: (key, o) => ({
      draggable: o?.enabled ?? true,
      onDragStart: (e) => {
        if (o?.enabled === false) return;
        e.dataTransfer.effectAllowed = 'move';
        if (o?.rowImage) {
          const row = (e.currentTarget as HTMLElement).closest('[data-drag-row]');
          if (row instanceof HTMLElement) e.dataTransfer.setDragImage(row, 24, 16);
        }
        setDragKey(key);
      },
      onDragEnd: end,
    }),
  };
}

/**
 * The end-of-list target, for a list where dropping past the last row is a
 * thing people try. Same colours as the line, so it reads as the same idea.
 */
export const DROP_ZONE = {
  idle: 'border-slate-800 text-slate-600',
  over: 'border-emerald-500 bg-emerald-500/10 text-emerald-300',
};
