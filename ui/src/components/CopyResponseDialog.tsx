import { useEffect, useMemo, useRef, useState } from 'react';

import { pickStructures, structuresOf, type Structure } from '../data/structures.ts';
import { localNumber } from '../i18n/game.ts';
import { t } from '../i18n/locale.ts';

/**
 * Choose which branches of the reply to take.
 *
 * The whole response is 45 KB, most of it inventory and campaign progress, and
 * whoever is being handed it usually wants one part. The list is of structures
 * rather than fields: which branch, not which key inside it — see
 * `structuresOf` for where that line is drawn.
 *
 * Sizes are on every row because they are the thing being weighed. This is a
 * tool for people who optimise resource allocation for fun; "16,496 bytes" is
 * the useful label and "large" is not.
 */
export function CopyResponseDialog({
  response,
  onCopy,
  onClose,
}: {
  /** The reply as it came back, or nothing when the dialog is closed. */
  response: string | undefined;
  /** Called with the text to put on the clipboard. */
  onCopy: (text: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  const parsed = useMemo(() => {
    if (response === undefined) return undefined;
    try {
      return JSON.parse(response) as unknown;
    } catch {
      return undefined;
    }
  }, [response]);

  const structures = useMemo(() => structuresOf(parsed), [parsed]);
  const leaves = useMemo(() => structures.filter((s) => s.children.length === 0), [structures]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // Everything, whenever a new reply arrives: the common case is wanting all of
  // it, and the list is there to take parts away.
  useEffect(() => {
    setSelected(new Set(leaves.map((leaf) => leaf.path)));
  }, [leaves]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (response !== undefined && !node.open) node.showModal();
    if (response === undefined && node.open) node.close();
  }, [response]);

  const everything = selected.size === leaves.length;

  /*
   * What the button would actually put on the clipboard.
   *
   * Built here rather than on the click so the counter below can be the real
   * length rather than a sum of the branches: those leave out the braces and
   * commas that hold them together, which on this reply is another 300 bytes.
   * A tool for people who count things should not round the count.
   */
  const payload = useMemo(
    () =>
      response === undefined || everything
        ? (response ?? '')
        : JSON.stringify(pickStructures(parsed, structures, selected)),
    [everything, response, parsed, structures, selected],
  );

  if (response === undefined) return <dialog ref={dialog} className="sheet" onClose={onClose} />;

  /** Leaves under a branch, or the branch itself when it is one. */
  const leavesUnder = (structure: Structure): string[] =>
    structure.children.length === 0
      ? [structure.path]
      : structure.children.flatMap((path) => {
          const child = structures.find((s) => s.path === path);
          return child ? leavesUnder(child) : [];
        });

  const toggle = (structure: Structure, on: boolean) => {
    const affected = leavesUnder(structure);
    setSelected((current) => {
      const next = new Set(current);
      for (const path of affected) {
        if (on) next.add(path);
        else next.delete(path);
      }
      return next;
    });
  };


  return (
    <dialog ref={dialog} className="sheet" onClose={onClose}>
      <h3>{t('pd.copyWhat')}</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('pd.copyWhatBlurb')}
      </p>

      <div className="row wrap" style={{ marginBottom: 8 }}>
        <button
          className="small"
          onClick={() => setSelected(new Set(leaves.map((leaf) => leaf.path)))}
          disabled={everything}
        >
          {t('pd.selectAll')}
        </button>
        <button className="small" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
          {t('pd.selectNone')}
        </button>
        <span style={{ flex: 1 }} />
        <span className="muted small">
          {t('pd.selectedBytes', {
            selected: localNumber(payload.length),
            total: localNumber(response.length),
          })}
        </span>
      </div>

      <ul className="branches">
        {structures.map((structure) => {
          const under = leavesUnder(structure);
          const on = under.filter((path) => selected.has(path));
          const checked = on.length === under.length;
          return (
            <li key={structure.path} style={{ paddingLeft: (structure.depth - 1) * 18 }}>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={checked}
                  ref={(node) => {
                    // A branch with some of its children kept is neither on nor
                    // off, and the box should not claim otherwise.
                    if (node) node.indeterminate = on.length > 0 && !checked;
                  }}
                  onChange={(e) => toggle(structure, e.target.checked)}
                />
                <span className="branch-key">{structure.key}</span>
                <span className="muted small">
                  {structure.measure.kind === 'value'
                    ? structure.measure.type
                    : t(structure.measure.kind === 'items' ? 'pd.nItems' : 'pd.nKeys', {
                        n: localNumber(structure.measure.n),
                      })}
                </span>
                <span style={{ flex: 1 }} />
                <span className="muted small">
                  {t('pd.nBytes', { n: localNumber(structure.bytes) })}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={() => onCopy(payload)} disabled={selected.size === 0}>
          {t('pd.copySelection')}
        </button>
        <button onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </dialog>
  );
}
