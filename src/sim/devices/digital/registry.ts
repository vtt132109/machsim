/**
 * Code-model registry: ModelCard.type (upper case) -> behaviour factory.
 *
 * Built-in families: gates.ts (gates, buffers, Schmitt, tri-state, bridges, pull-up/down),
 * sequential.ts (flip-flops, latches), msi.ts (counters, registers, decoders, multiplexers,
 * arithmetic, 7-segment drivers, monostables, transceivers), msi2.ts (more counters and shift
 * registers, generic registers / latches, encoders, 74181 ALU, look-ahead, comparators, parity,
 * AND-OR-INVERT), memory.ts (RAM, ROM, register file), pld.ts (programmable logic block),
 * mixed.ts (clock, pattern source, ADC, DAC, comparator, display sensing), mixed2.ts (serial and
 * microprocessor converters, VCO, PLL phase comparators), displays.ts (character LCD) and
 * analogBlocks.ts (analog control blocks with memory: A_HYST, A_ONESHOT, A_SAH, A_PWM), mcu.ts
 * (the 8051-compatible core, D_MCU8051), ladder.ts (the ladder-diagram scan machine, A_LADDER)
 * and mecha.ts (the mechatronics models, A_MECHA). Other
 * modules may add types with registerBehaviour().
 */
import type { BehaviourFactory } from './behaviour';
import { GATE_BEHAVIOURS } from './gates';
import { MIXED_BEHAVIOURS } from './mixed';
import { MSI_BEHAVIOURS } from './msi';
import { SEQUENTIAL_BEHAVIOURS } from './sequential';
import { MSI2_BEHAVIOURS } from './msi2';
import { MEMORY_BEHAVIOURS } from './memory';
import { PLD_BEHAVIOURS } from './pld';
import { MIXED2_BEHAVIOURS } from './mixed2';
import { DISPLAY_BEHAVIOURS } from './displays';
import { ANALOG_BLOCK_BEHAVIOURS } from './analogBlocks';
import { MCU_BEHAVIOURS } from './mcu';
import { LADDER_BEHAVIOURS } from './ladder';
import { MECHA_BEHAVIOURS } from './mecha';

const table = new Map<string, BehaviourFactory>();
for (const group of [GATE_BEHAVIOURS, SEQUENTIAL_BEHAVIOURS, MSI_BEHAVIOURS, MSI2_BEHAVIOURS, MEMORY_BEHAVIOURS, PLD_BEHAVIOURS, MIXED_BEHAVIOURS, MIXED2_BEHAVIOURS, DISPLAY_BEHAVIOURS, ANALOG_BLOCK_BEHAVIOURS, MCU_BEHAVIOURS, LADDER_BEHAVIOURS, MECHA_BEHAVIOURS]) {
  for (const [type, f] of Object.entries(group)) table.set(type, f);
}

/** Factory of a code-model type (case-insensitive), or undefined. */
export function getBehaviourFactory(type: string): BehaviourFactory | undefined {
  return table.get(type.trim().toUpperCase());
}

/** Add or replace a code-model type. */
export function registerBehaviour(type: string, factory: BehaviourFactory): void {
  table.set(type.trim().toUpperCase(), factory);
}

/** Every supported code-model type, sorted. */
export function digitalModelTypes(): string[] {
  return [...table.keys()].sort();
}
