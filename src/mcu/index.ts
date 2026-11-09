/**
 * MCU support of MachSim: the 8051-compatible core, its assembler, the Intel HEX codec and the
 * program builder that the schematic part, the code editor panel and the tests share.
 *
 *   import { Cpu8051, assemble8051, buildProgram } from '../mcu';
 *
 * The modules are pure (no engine, no DOM, no i18n): the co-simulation shell lives in
 * src/sim/devices/digital/mcu.ts and the user interface in src/ui/mcu.
 */
export * from './cpu8051';
export * from './asm8051';
export * from './hex';
export * from './program';
export * from './probes';
