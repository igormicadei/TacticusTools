/**
 * A card a pointer can drag left or right to commit an action, the same
 * gesture a phone's own mail or messaging app uses for "archive" or "delete".
 *
 * Generic on purpose: this only carries the drag, the reveal-behind-the-card
 * label and the fly-off animation. What a swipe means is entirely the
 * caller's — `GameCodeCard` is the one caller today, but nothing here assumes
 * that.
 *
 * Built on Pointer Events rather than separate mouse/touch handlers, so a
 * phone's finger and a desktop's mouse drag the same code path. `touch-action:
 * pan-y` on the drag surface (see `styles.css`) is what lets a mostly-vertical
 * drag still scroll the page — the axis lock below only claims the gesture
 * once a drag is clearly more horizontal than vertical.
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

/** Past this many pixels, releasing commits the swipe instead of snapping back. */
const THRESHOLD = 88;
/** How far the card flies off-screen once a swipe commits. */
const FLY_DISTANCE = 480;
/** How long that flight takes — the commit callback fires after, not during. */
const FLY_MS = 180;

export function SwipeableCard({
  onSwipeLeft,
  onSwipeRight,
  leftLabel,
  rightLabel,
  children,
}: {
  /** Omit to make that direction inert — dragged, but always snaps back. */
  onSwipeLeft?: (() => void) | undefined;
  onSwipeRight?: (() => void) | undefined;
  leftLabel?: string | undefined;
  rightLabel?: string | undefined;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [flying, setFlying] = useState<'left' | 'right' | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<'x' | 'y' | null>(null);

  useEffect(() => {
    if (!flying) return;
    const timer = setTimeout(
      () => (flying === 'right' ? onSwipeRight?.() : onSwipeLeft?.()),
      FLY_MS,
    );
    return () => clearTimeout(timer);
    // Firing the stored direction's own callback, not "whichever is current" —
    // re-running this for a handler identity change would refire the action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flying]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (flying) return;
    start.current = { x: e.clientX, y: e.clientY };
    axis.current = null;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const deltaX = e.clientX - start.current.x;
    const deltaY = e.clientY - start.current.y;
    if (!axis.current) {
      // Too small a movement to call yet — deciding early on a jitter would
      // wrongly lock out whichever axis loses the coin flip.
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      axis.current = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y';
      if (axis.current === 'x') setDragging(true);
    }
    if (axis.current !== 'x') return;
    if ((deltaX > 0 && !onSwipeRight) || (deltaX < 0 && !onSwipeLeft)) return;
    setDx(deltaX);
  };

  const finish = () => {
    if (!start.current) return;
    start.current = null;
    axis.current = null;
    setDragging(false);
    if (dx > THRESHOLD && onSwipeRight) {
      setFlying('right');
      setDx(FLY_DISTANCE);
    } else if (dx < -THRESHOLD && onSwipeLeft) {
      setFlying('left');
      setDx(-FLY_DISTANCE);
    } else {
      setDx(0);
    }
  };

  return (
    <div className="swipe-card">
      {onSwipeRight && (
        <div
          className="swipe-card-bg right"
          style={{ opacity: dx > 0 ? Math.min(1, dx / THRESHOLD) : 0 }}
        >
          {rightLabel}
        </div>
      )}
      {onSwipeLeft && (
        <div
          className="swipe-card-bg left"
          style={{ opacity: dx < 0 ? Math.min(1, -dx / THRESHOLD) : 0 }}
        >
          {leftLabel}
        </div>
      )}
      <div
        className={`swipe-card-content${dragging ? ' dragging' : ''}${flying ? ' flying' : ''}`}
        style={{ transform: `translateX(${dx}px) rotate(${dx / 44}deg)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        {children}
      </div>
    </div>
  );
}
