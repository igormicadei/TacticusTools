import { useSyncExternalStore } from 'react';

import { iconSnapshot, subscribeToIcons } from '../data/icons.ts';

/**
 * Subscribe a component to the icon manifest.
 *
 * The `*Icon()` resolvers read a module-level manifest that arrives after the
 * first paint, so anything calling them needs to re-render when it lands. One
 * call at the top of a component covers every resolver used beneath it.
 */
export function useIcons(): void {
  useSyncExternalStore(subscribeToIcons, iconSnapshot, iconSnapshot);
}

/**
 * One resolved icon, or nothing at all.
 *
 * Rendering nothing for an unresolved id is the point: art is decoration over
 * text that already says the same thing, so a gap in the manifest should leave
 * a tidy row rather than a broken-image glyph. `onError` covers the same case
 * one step later, when a hash has gone stale since the manifest was taken.
 *
 * In a list, though, nothing is the wrong shape: 51 of 558 materials have no
 * art, and dropping their icon would step their names left out of the column
 * the rest sit in. `reserve` holds the space open instead.
 */
export function Icon({
  src,
  alt = '',
  size = 20,
  className,
  title,
  reserve = false,
}: {
  src: string | undefined;
  alt?: string;
  size?: number;
  className?: string;
  title?: string;
  /** Keep the space when nothing resolves, so a column of rows stays aligned. */
  reserve?: boolean;
}) {
  if (!src) {
    return reserve ? <span className="icon icon-blank" style={{ width: size, height: size }} /> : null;
  }
  return (
    <img
      src={src}
      alt={alt}
      title={title}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={className ? `icon ${className}` : 'icon'}
      onError={(event) => {
        event.currentTarget.style.display = 'none';
      }}
    />
  );
}
