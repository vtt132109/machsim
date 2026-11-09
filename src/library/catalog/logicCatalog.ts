/**
 * The 74xx families and the 4000B series (one part per device type and family), generated from
 * the logic specification tables. A catalogue pack (catalog/index.ts CATALOGUE_PACKS 'logic'):
 * this module and the two spec tables load on demand.
 *
 * The dual flip-flops (73, 74, 76, 107, 109, 112, 113) and the quad analog switches (4016, 4066)
 * of every family also exist section by section ("74LS74A", "74HC4066C"): one part per flip-flop
 * or switch that shares its reference designator with the other sections and is netlisted as one
 * chip (src/model/sections.ts). They are generated from the package parts, so pins, levels, timing
 * and models are those of the package.
 */
import { sectionPartsOf, type SectionSpec } from '../parts/digital/sectionParts';
import type { LibraryPartDef } from '../partkit';
import { logicParts } from './logicKit';
import { LOGIC74_SPECS } from './logic74';
import { LOGIC4000_SPECS } from './logic4000';

type SectionKind = Pick<SectionSpec, 'shape' | 'invert' | 'title' | 'en' | 'vi'>;

const D_FF: SectionKind = { shape: 'ff', invert: false, title: 'D', en: 'D flip-flop with preset and clear', vi: 'flip-flop D có đặt trước và xoá' };
const JK_FF: SectionKind = { shape: 'ff', invert: false, title: 'JK', en: 'JK flip-flop', vi: 'flip-flop JK' };
const SWITCH: SectionKind = { shape: 'switch', invert: false, title: 'SW', en: 'bilateral analog switch', vi: 'công tắc tương tự hai chiều' };

/** Device types (LogicSpec.pn) that also exist section by section. */
const SECTIONED: Record<string, SectionKind> = {
  '73': JK_FF,
  '74': D_FF,
  '76': JK_FF,
  '107': JK_FF,
  '109': JK_FF,
  '112': JK_FF,
  '113': JK_FF,
  '4016': SWITCH,
  '4066': SWITCH,
};

const SPECS = [...LOGIC74_SPECS, ...LOGIC4000_SPECS];
const PACKAGES = logicParts(SPECS);

/** The section parts of the sectioned device types, in every family. */
function sectionParts(): LibraryPartDef[] {
  const byId = new Map(PACKAGES.map((p) => [p.id, p]));
  const out: LibraryPartDef[] = [];
  for (const spec of SPECS) {
    const kind = SECTIONED[spec.pn];
    if (!kind) continue;
    for (const pkg of logicParts([spec])) {
      const registered = byId.get(pkg.id);
      if (registered) out.push(...sectionPartsOf(registered, { ...kind, id: pkg.id }));
    }
  }
  return out;
}

/** 74xx families and 4000B series (one part per device type and family), plus their section parts. */
export const LOGIC_CATALOG: LibraryPartDef[] = [...PACKAGES, ...sectionParts()];
