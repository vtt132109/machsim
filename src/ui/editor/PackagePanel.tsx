/**
 * Package panel of the Properties tab for a section of a multi-section chip (7400A, 7474B, TL072A …):
 * which sections of the chip are placed and which are free, a switch to another free section, and
 * the two moves "to a new chip" / "into another chip". Loads on demand (PropertiesPanel lazy-loads it
 * only for parts that carry LibraryPartDef.pkg). The rules are src/model/sectionPlan.ts; the edits
 * are the pure design operations of src/ui/store/designOps.ts, applied as one undo step each.
 */
import { useMemo } from 'react';
import type { PartDef } from '../../library/types';
import { levelSheets } from '../store/refdes';
import { moveToNewPackage, moveToPackage, setSection } from '../store/designOps';
import { actions, partLookup, useEditor } from '../store';
import { joinTargets, packageUses, sectionChoices } from '../../model/sectionPlan';
import { packageOf } from '../../model/sections';
import type { Design, PartInstance } from '../../model/types';
import { partName } from '../../i18n/library';
import { useLang } from '../../i18n/react';
import { openHelp } from '../help/open';
import { sxt } from '../../i18n/sectionText';

export function PackagePanel({ def, inst }: { def: PartDef; inst: PartInstance }) {
  useLang();
  const design = useEditor((s) => s.design);
  const sheetId = useEditor((s) => s.activeSheetId);
  const alwaysNew = useEditor((s) => !!s.ui.newPackage);
  const info = useMemo(() => {
    const pkg = packageOf(def);
    if (!pkg) return null;
    const uses = packageUses(levelSheets(design, sheetId), partLookup);
    const use = uses.find((u) => u.packageId === pkg.id && u.refdes.trim().toUpperCase() === inst.refdes.trim().toUpperCase());
    if (!use) return null;
    return { use, choices: sectionChoices(use, inst, partLookup), targets: joinTargets(uses, inst, partLookup, inst.partId) };
  }, [design, sheetId, def, inst]);
  if (!info) return null;
  const { use, choices, targets } = info;
  const packageDef = partLookup(use.packageId);
  const apply = (fn: (d: Design) => Design) => actions.applyDesign(fn);
  return (
    <div className="ms-prop-section ms-package-panel" role="group" aria-label={sxt('title')}>
      <h4>{sxt('title')}</h4>
      <p className="ms-hint">{sxt('intro')}</p>
      <div>
        <b>{sxt('chip', { refdes: use.refdes, name: packageDef ? partName(packageDef) : use.packageId })}</b>
      </div>
      <ul className="ms-package-sections" aria-label={sxt('sections')}>
        {choices.map((c) => (
          <li key={c.letter} className={c.current ? 'is-current' : undefined}>
            {c.current ? sxt('thisOne', { letter: c.letter }) : c.free ? sxt('free', { letter: c.letter }) : sxt('used', { letter: c.letter })}
          </li>
        ))}
      </ul>
      <p className="ms-hint">{use.free.length ? sxt('spare', { list: use.free.join(', ') }) : sxt('noSpare')}</p>
      <label className="ms-prop-row">
        <span>{sxt('changeSection')}</span>
        <select className="ms-input" value={choices.find((c) => c.current)?.letter ?? ''} title={sxt('tipChangeSection')} aria-label={sxt('changeSection')} onChange={(e) => apply((d) => setSection(d, inst.id, e.target.value, partLookup))}>
          {choices.map((c) => (
            <option key={c.letter} value={c.letter} disabled={!c.free && !c.current}>
              {c.letter}
            </option>
          ))}
        </select>
      </label>
      <div className="ms-prop-row">
        <button type="button" className="ms-btn ms-btn-small" title={sxt('tipNewPackage')} disabled={use.placed.length < 2} onClick={() => apply((d) => moveToNewPackage(d, inst.id, partLookup))}>
          {sxt('newPackage')}
        </button>
        {targets.length ? (
          <select className="ms-input" value="" title={sxt('tipJoinPackage')} aria-label={sxt('joinPackage')} onChange={(e) => (e.target.value ? apply((d) => moveToPackage(d, inst.id, e.target.value, partLookup)) : undefined)}>
            <option value="">{sxt('joinPackage')}</option>
            {targets.map((u) => (
              <option key={u.refdes} value={u.refdes}>
                {sxt('joinOption', { refdes: u.refdes, list: u.free.join(', ') })}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {alwaysNew ? <p className="ms-hint">{sxt('alwaysNew')}</p> : null}
      <button type="button" className="ms-btn ms-btn-small" onClick={() => openHelp({ kind: 'guide', page: 'placement' })}>
        {sxt('help')}
      </button>
    </div>
  );
}
