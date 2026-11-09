/**
 * Device factory registry. Maps an IR element type to the factory that builds it.
 * Owners fill in their own table module; this file only merges them.
 *   linear/index.ts     -> R C L K V I E F G H S W T (engine team)
 *   semi/index.ts       -> D Q J M Z (semiconductor team)
 *   behavioral.ts       -> B (parser/expression team)
 *   digital/index.ts    -> A (digital / mixed-signal team)
 */
import type { DeviceFactory, DeviceFactoryTable } from '../device';
import type { ElementType } from '../netlist';
import { linearFactories } from './linear';
import { semiconductorFactories } from './semi';
import { behavioralFactories } from './behavioral';
import { digitalFactories } from './digital';

const table: DeviceFactoryTable = {
  ...linearFactories,
  ...semiconductorFactories,
  ...behavioralFactories,
  ...digitalFactories,
};

export function getDeviceFactory(type: ElementType): DeviceFactory | undefined {
  return table[type];
}

export function registerDeviceFactory(type: ElementType, factory: DeviceFactory): void {
  table[type] = factory;
}

export function supportedElementTypes(): ElementType[] {
  return Object.keys(table) as ElementType[];
}
