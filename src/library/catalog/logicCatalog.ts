/**
 * The 74xx families and the 4000B series (one part per device type and family), generated from
 * the logic specification tables. A catalogue pack (catalog/index.ts CATALOGUE_PACKS 'logic'):
 * this module and the two spec tables load on demand.
 */
import { logicParts } from './logicKit';
import { LOGIC74_SPECS } from './logic74';
import { LOGIC4000_SPECS } from './logic4000';

/** 74xx families and 4000B series (one part per device type and family). */
export const LOGIC_CATALOG = logicParts([...LOGIC74_SPECS, ...LOGIC4000_SPECS]);
