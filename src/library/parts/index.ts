/**
 * Part catalogue: one module per group (see each module's header for models and provenance).
 *
 * ALL_PARTS is the start-up list the registry (src/library/index.ts) indexes: the hand-written
 * BASE_PARTS plus the core generated catalogue of real part numbers and standard values. The big
 * catalogue packs (src/library/catalog/index.ts CATALOGUE_PACKS) are NOT in it: they load on
 * demand and then join the registry's built-in list (listParts / getPart). Part ids are unique
 * ('<group>/<slug>'); the test suite enforces it over the full list (core + every pack).
 */
import type { PartDef } from '../types';
import { ANALOG_PARTS } from './analog';
import { BASIC_PARTS } from './basic';
import { DIGITAL_PARTS } from './digital';
import { DIODE_PARTS } from './diodes';
import { INDICATOR_PARTS } from './indicators';
import { INSTRUMENT_PARTS } from './instruments';
import { BENCH_INSTRUMENT_PARTS } from './benchInstruments';
import { MISC_PARTS } from './misc';
import { POWER_PARTS } from './power';
import { SOURCE_PARTS } from './sources';
import { TRANSISTOR_PARTS } from './transistors';
import { catalogParts } from '../catalog';

/** Hand-written parts (one module per group). */
export const BASE_PARTS: PartDef[] = [
  ...SOURCE_PARTS,
  ...BASIC_PARTS,
  ...DIODE_PARTS,
  ...TRANSISTOR_PARTS,
  ...ANALOG_PARTS,
  ...INDICATOR_PARTS,
  ...POWER_PARTS,
  ...MISC_PARTS,
  ...INSTRUMENT_PARTS,
  ...BENCH_INSTRUMENT_PARTS,
  ...DIGITAL_PARTS,
];

/** Hand-written parts followed by the core generated catalogue (src/library/catalog). */
export const ALL_PARTS: PartDef[] = [...BASE_PARTS, ...catalogParts(new Set(BASE_PARTS.map((p) => p.id)))];
