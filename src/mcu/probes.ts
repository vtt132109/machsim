/**
 * Names of the read-out vectors the co-simulated MCU publishes.
 *
 * The `D_MCU8051` code model (src/sim/devices/digital/mcu.ts) returns these keys from
 * `Behaviour.probes`, so the engine turns them into result vectors `Mpc(A_U1)`, `Ma(A_U1)` … The
 * netlister lists them for the design's recorded vectors (`src/ui/integration/live.ts`
 * `neededVectors`) and the code editor panel (src/ui/mcu) reads them from the live snapshot.
 *
 * The `M` prefix keeps the engine from reading the first letter as a unit (engine/outputs.ts
 * `unitForKey`: V / I / P / G / R mean volts, amps, watts, siemens and ohms).
 */

/** Bytes of internal RAM the read-out window shows (base in `Mbase`, bytes in `Mm0`…). */
export const RAM_WINDOW = 16;

const r8 = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, k) => `${prefix}${k}`);

/** Read-out keys in display order. */
export const MCU_PROBE_KEYS: readonly string[] = [
  'Mpc',
  'Ma',
  'Mb',
  'Msp',
  'Mpsw',
  'Mdptr',
  ...r8('Mr', 8),
  ...r8('Mp', 4),
  'Mtmod',
  'Mtcon',
  'Mtl0',
  'Mth0',
  'Mtl1',
  'Mth1',
  'Mie',
  'Mip',
  'Mscon',
  'Msbuf',
  'Mpcon',
  'Mcyc',
  'Mtxn',
  ...r8('Mtx', 4),
  'Mrxn',
  'Mrxq',
  'Mhalt',
  'Mbase',
  ...r8('Mm', RAM_WINDOW),
];

/** Vector names of one MCU element, e.g. `Mpc(A_U1)`. */
export function mcuVectorNames(element: string): string[] {
  return MCU_PROBE_KEYS.map((k) => `${k}(${element})`);
}

/** Value of one read-out in a lower-cased vector snapshot (undefined when it was not recorded). */
export function mcuProbeValue(values: Map<string, number>, element: string, key: string): number | undefined {
  return values.get(`${key}(${element})`.toLowerCase());
}
