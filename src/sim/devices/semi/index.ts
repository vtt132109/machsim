/**
 * Semiconductor device factories: D (diode), Q (BJT), J (JFET), M (MOSFET: levels 1-3, and BSIM3 through
 * the mosdevice.ts dispatcher), Z (MESFET).
 * Merged into the global device registry by src/sim/devices/registry.ts.
 */
import type { DeviceFactoryTable } from '../../device';
import { createBjt } from './bjt';
import { createDiode } from './diode';
import { createJfet } from './jfet';
import { createMesfet } from './mesfet';
import { createMosDevice } from './mosdevice';

export const semiconductorFactories: DeviceFactoryTable = {
  D: createDiode,
  Q: createBjt,
  J: createJfet,
  M: createMosDevice,
  Z: createMesfet,
};

export { Diode, createDiode, DIODE_DEFAULTS, DIODE_ALIASES } from './diode';
export { Bjt, createBjt, BJT_DEFAULTS, BJT_ALIASES } from './bjt';
export { Jfet, createJfet, JFET_DEFAULTS, JFET_ALIASES } from './jfet';
export { Mosfet, createMosfet, MOS_DEFAULTS, MOS_ALIASES, DEFAULT_MOS_L, DEFAULT_MOS_W } from './mosfet';
export { Mesfet, createMesfet, MESFET_DEFAULTS, MESFET_ALIASES } from './mesfet';
export { Bsim3, createBsim3, BSIM3_DEFAULTS, BSIM3_LEVELS, BSIM4_LEVELS } from './bsim3';
export { Ekv, createEkv, EKV_DEFAULTS, EKV_LEVELS } from './ekv';
export { MosDevice, createMosDevice, isBsimLevel, isEkvLevel } from './mosdevice';
