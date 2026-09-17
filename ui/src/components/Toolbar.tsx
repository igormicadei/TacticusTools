/**
 * The controls a page uses to group, filter and sort a list, built from the
 * same handful of pieces everywhere they appear.
 *
 * Before this, each page hand-rolled its own `.tabs`/`.select`/`.switch`
 * markup, and small differences crept in — one page's dropdown carried a
 * label, another's did not; one screen's toggle sat before the search field,
 * another's after. None of that was a deliberate choice per page, so it is
 * collapsed here: the same component renders the same way everywhere, and a
 * future style change is one edit rather than six.
 */
import type { ReactNode } from 'react';

/** The bordered strip every list page's controls sit inside. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

/** A row of mutually exclusive choices — a view, a category, a mode. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; hint?: string }[];
}) {
  return (
    <div className="tabs">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={value === opt.value ? 'active' : ''}
          onClick={() => onChange(opt.value)}
          title={opt.hint}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Free-text search, styled the same wherever a list can be searched. */
export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      className="search"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** A labelled dropdown — "Group by", "Sort by", a rarity or a min rank. */
export function SelectField<T extends string>({
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="inline-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} disabled={disabled}>
        {children}
      </select>
    </label>
  );
}

/** An on/off setting that reshapes the list, rather than merely slicing it. */
export function SwitchField({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="switch" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/**
 * How many of what, right-aligned — `.counts` already pins itself to the
 * toolbar's far end, so nothing upstream of this needs a spacer.
 */
export function ToolbarCounts({
  items,
}: {
  items: readonly { value: number | string; label: string; color?: string }[];
}) {
  return (
    <div className="counts small muted">
      {items.map((item, i) => (
        <span className="count" key={i}>
          <b style={item.color ? { color: item.color } : undefined}>{item.value}</b> {item.label}
        </span>
      ))}
    </div>
  );
}
