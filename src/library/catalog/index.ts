/**
 * Generated part catalogue: every family generator of src/library/catalog, in group order.
 * Hand-written parts (src/library/parts) keep their ids; a generated part with the same id is
 * dropped (`dedupe`), so the catalogue only adds parts.
 *
 * Two parts:
 *  - the **core catalogue** (`catalogParts`): families samples, lessons, wizards and model makers
 *    use (sources, control blocks, passives E-series, real / multi-control basic parts, analog ICs,
 *    power, electromechanical, sensors, small digital / mixed / display catalogue). It loads at
 *    start-up with the library, so getPart() finds these parts at once.
 *  - **catalogue packs** (`CATALOGUE_PACKS`): the big part-number and standard-value tables (diode
 *    and thyristor part numbers, BJT / FET part numbers, 74xx / 4000 logic families, resistor and
 *    capacitor series by package, connectors, RF parts). Each is a separate code-split chunk that
 *    the registry (src/library/index.ts) loads on the first open of one of its groups, on a
 *    catalogue search, or when a design that uses one of its parts is opened. `counts` must equal
 *    the parts each pack adds per group (lazyPacks.test.ts checks it).
 */
import type { CataloguePack } from '../index';
import type { LibraryPartDef } from '../partkit';
import { dedupe } from './kit';
import { PASSIVE_CATALOG } from './passives';
import { ANALOG_CATALOG } from './analogics';
import { POWER_CATALOG } from './power';
import { ELECTROMECH_CATALOG, FUSE_CATALOG } from './electromech';
import { SENSOR_CATALOG } from './sensors';
import { SOURCE_CATALOG } from './sources';
import { SIGNAL_BLOCK_CATALOG } from './signalBlocks';
import { BASIC_EXTRA_CATALOG } from './basicExtras';
import { ANALOG_EXTRA_CATALOG } from './analogExtras';
import { DIGITAL_MISC_CATALOG } from './digitalMisc';
import { MIXED_SIGNAL_CATALOG } from './mixedSignal';
import { DISPLAY_CATALOG } from './displayParts';
import { MCU_CATALOG } from './mcu';
import { PLC_CATALOG } from './plc';
import { MECHA_CATALOG } from './mecha';
import { AUDIO_CATALOG } from './audio';
import { RELAY_CATALOG } from './relays';
import { MAGNETICS_CATALOG } from './lineMagnetics';
import { BATTERY_CATALOG } from './batteries';
import { MEASUREMENT_CATALOG } from './measurementSource';
import { PROTECTION_CATALOG } from './protection';
import { HYSTERESIS_CATALOG } from './magneticCore';
import { COMPACT_MOS_CATALOG } from './compactMos';

/** Core catalogue parts for a library whose hand-written part ids are `existing`. */
export function catalogParts(existing: ReadonlySet<string>): LibraryPartDef[] {
  return dedupe([...SOURCE_CATALOG, ...SIGNAL_BLOCK_CATALOG, ...PASSIVE_CATALOG, ...BASIC_EXTRA_CATALOG, ...ANALOG_CATALOG, ...ANALOG_EXTRA_CATALOG, ...POWER_CATALOG, ...FUSE_CATALOG, ...ELECTROMECH_CATALOG, ...SENSOR_CATALOG, ...DIGITAL_MISC_CATALOG, ...MCU_CATALOG, ...PLC_CATALOG, ...MECHA_CATALOG, ...MIXED_SIGNAL_CATALOG, ...DISPLAY_CATALOG, ...AUDIO_CATALOG, ...RELAY_CATALOG, ...MAGNETICS_CATALOG, ...BATTERY_CATALOG, ...MEASUREMENT_CATALOG, ...PROTECTION_CATALOG, ...HYSTERESIS_CATALOG, ...COMPACT_MOS_CATALOG], existing);
}

/**
 * The code-split catalogue packs, in listing order (the browser lists a group's core parts first,
 * then its packs in this order). Every loader imports its modules dynamically, so each pack is its
 * own chunk (vite.config.ts names them catalogue-<pack>).
 */
export const CATALOGUE_PACKS: CataloguePack[] = [
  {
    id: 'basic-series',
    counts: { basic: 682 },
    load: async () => (await import('./passiveSeries')).PASSIVE_SERIES_CATALOG,
  },
  {
    id: 'diodes',
    counts: { diodes: 1109 },
    load: async () => {
      const [d, t] = await Promise.all([import('./diodes'), import('./thyristors')]);
      return [...d.DIODE_CATALOG, ...t.THYRISTOR_CATALOG];
    },
  },
  {
    id: 'transistors',
    counts: { transistors: 527, rf: 25 },
    load: async () => {
      const [b, f] = await Promise.all([import('./bjts'), import('./fets')]);
      return [...b.BJT_CATALOG, ...f.FET_CATALOG];
    },
  },
  {
    id: 'rf',
    counts: { rf: 105 },
    load: async () => (await import('./rf')).RF_CATALOG,
  },
  {
    id: 'connectors',
    counts: { connectors: 158 },
    load: async () => (await import('./connectors')).CONNECTOR_CATALOG,
  },
  {
    id: 'logic',
    counts: { ttl: 484, cmos: 348 },
    load: async () => (await import('./logicCatalog')).LOGIC_CATALOG,
  },
  // round 4 (library breadth): more device types, order codes and packages. Each pack is its own chunk
  // (vite.config.ts catalogue-more-*), loaded on the first open of one of its groups like the packs above.
  {
    id: 'logic-more',
    counts: { ttl: 1092, cmos: 1338 },
    load: async () => (await import('./more/logicMore')).LOGIC_MORE_CATALOG,
  },
  {
    id: 'analog-more',
    counts: { analog: 1095, power: 450 },
    load: async () => (await import('./more/analogMore')).ANALOG_MORE_CATALOG,
  },
  {
    id: 'discretes-more',
    counts: { diodes: 503, transistors: 496, rf: 2 },
    load: async () => (await import('./more/discretesMore')).DISCRETES_MORE_CATALOG,
  },
  {
    id: 'passives-more',
    counts: { basic: 1267 },
    load: async () => (await import('./more/passivesMore')).PASSIVES_MORE_CATALOG,
  },
  {
    id: 'sensors-more',
    counts: { basic: 90, misc: 70, indicators: 53 },
    load: async () => (await import('./more/sensorsMore')).SENSORS_MORE_CATALOG,
  },
];
