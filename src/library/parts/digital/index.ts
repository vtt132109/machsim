/**
 * Digital catalogue: TTL (74xx), CMOS (4000B), misc-digital (ideal gates, flip-flops, latches,
 * pattern source, pull-up / pull-down), mixed (ADC, DAC, comparator to logic), digital
 * indicators (seven-segment, hex display, bar graph, logic probe) and digital sources (clock,
 * logic constants, interactive logic switch).
 *
 * Every part simulates through the code models of src/sim/devices/digital ('A' elements);
 * kit.ts documents the families, the hidden power pins and the symbol conventions.
 */
import type { LibraryPartDef } from '../../partkit';
import { CMOS_PARTS } from './cmos';
import { DIGITAL_INDICATOR_PARTS } from './indicators';
import { MIXED_PARTS } from './mixed';
import { SECTION_PARTS } from './sectionParts';
import { DIGITAL_SOURCE_PARTS } from './sources';
import { TTL_PARTS } from './ttl';
import { VIRTUAL_PARTS } from './virtual';

export const DIGITAL_PARTS: LibraryPartDef[] = [...TTL_PARTS, ...CMOS_PARTS, ...SECTION_PARTS, ...VIRTUAL_PARTS, ...MIXED_PARTS, ...DIGITAL_INDICATOR_PARTS, ...DIGITAL_SOURCE_PARTS];

export { CMOS_PARTS, DIGITAL_INDICATOR_PARTS, DIGITAL_SOURCE_PARTS, MIXED_PARTS, SECTION_PARTS, TTL_PARTS, VIRTUAL_PARTS };
export { FAMILIES, TTL_FAMILY_KEYS, cmosLevels, cmosSpeedFactor, powerNodes, type FamilyLevels, type TtlFamily } from './kit';
