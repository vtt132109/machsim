/**
 * Small learning circuits used by the breadboard tests and the demo page.
 *
 * Connections are made with net labels placed on the pins (no schematic wires), so every circuit
 * is unambiguous regardless of where the symbols sit. Label "GND" is ground.
 */

import { DesignBuilder, type PartHandle } from '../model/designkit';
import type { Design } from '../model/types';
import { ledArrayTitle, tr } from '../i18n/breadboard';

type PinRef = [PartHandle, string];

class Kit {
  readonly b: DesignBuilder;
  private x = 0;

  constructor(title: string) {
    this.b = new DesignBuilder(title);
  }

  part(partId: string, refdes: string, params: Record<string, string> = {}): PartHandle {
    const h = this.b.part(partId, refdes, this.x, 0, params);
    this.x += 300;
    return h;
  }

  net(name: string, ...pins: PinRef[]): void {
    for (const [h, pin] of pins) this.b.labelPin(h, pin, name);
  }

  get design(): Design {
    return this.b.design;
  }
}

/** 9 V battery, 470 Ω resistor and a red LED in series. */
export function seriesLedCircuit(): Design {
  const k = new Kit('LED nối tiếp điện trở / LED with series resistor');
  const bat = k.part('sources/battery', 'BAT1', { value: '9' });
  const r1 = k.part('basic/resistor', 'R1', { value: '470' });
  const led = k.part('diodes/led-red', 'LED1');
  k.net('VBAT', [bat, '+'], [r1, '1']);
  k.net('N_LED', [r1, '2'], [led, 'A']);
  k.net('GND', [led, 'K'], [bat, '-']);
  return k.design;
}

/** 12 V source with a 10 kΩ / 4.7 kΩ voltage divider. */
export function dividerCircuit(): Design {
  const k = new Kit('Cầu phân áp / Voltage divider');
  const v1 = k.part('sources/dc-voltage', 'V1', { value: '12' });
  const r1 = k.part('basic/resistor', 'R1', { value: '10k' });
  const r2 = k.part('basic/resistor', 'R2', { value: '4.7k' });
  k.net('VIN', [v1, '+'], [r1, '1']);
  k.net('VOUT', [r1, '2'], [r2, '1']);
  k.net('GND', [r2, '2'], [v1, '-']);
  return k.design;
}

/** NPN low-side switch driving an LED, controlled by a 5 V input. */
export function transistorSwitchCircuit(): Design {
  const k = new Kit('Transistor làm công tắc / Transistor switch');
  const v1 = k.part('sources/dc-voltage', 'V1', { value: '9' });
  const v2 = k.part('sources/dc-voltage', 'V2', { value: '5' });
  const rb = k.part('basic/resistor', 'R1', { value: '10k' });
  const q1 = k.part('transistors/2n3904', 'Q1');
  const rc = k.part('basic/resistor', 'R2', { value: '470' });
  const led = k.part('diodes/led-green', 'LED1');
  k.net('VCC', [v1, '+'], [rc, '1']);
  k.net('N_A', [rc, '2'], [led, 'A']);
  k.net('N_C', [led, 'K'], [q1, 'C']);
  k.net('IN', [v2, '+'], [rb, '1']);
  k.net('N_B', [rb, '2'], [q1, 'B']);
  k.net('GND', [q1, 'E'], [v1, '-'], [v2, '-']);
  return k.design;
}

/** 555 astable blinking an LED (≈ 0.7 Hz). */
export function astable555Circuit(): Design {
  const k = new Kit('555 tạo dao động nháy LED / 555 LED flasher');
  const v1 = k.part('sources/battery', 'BAT1', { value: '9' });
  const u1 = k.part('analog/555', 'U1');
  const r1 = k.part('basic/resistor', 'R1', { value: '1k' });
  const r2 = k.part('basic/resistor', 'R2', { value: '100k' });
  const c1 = k.part('basic/electrolytic', 'C1', { value: '10u' });
  const c2 = k.part('basic/capacitor', 'C2', { value: '10n' });
  const r3 = k.part('basic/resistor', 'R3', { value: '470' });
  const led = k.part('diodes/led-red', 'LED1');
  k.net('VCC', [v1, '+'], [u1, 'VCC'], [u1, 'RST'], [r1, '1']);
  k.net('DIS', [r1, '2'], [u1, 'DIS'], [r2, '1']);
  k.net('THR', [r2, '2'], [u1, 'THR'], [u1, 'TRIG'], [c1, '+']);
  k.net('CTRL', [u1, 'CTRL'], [c2, '1']);
  k.net('OUT', [u1, 'OUT'], [r3, '1']);
  k.net('N_LED', [r3, '2'], [led, 'A']);
  k.net('GND', [v1, '-'], [u1, 'GND'], [c1, '-'], [c2, '2'], [led, 'K']);
  return k.design;
}

/** Inverting amplifier (gain −10) with a dual ±12 V supply and an AC input. */
export function invertingAmpCircuit(): Design {
  const k = new Kit('Khuếch đại đảo / Inverting amplifier');
  const vp = k.part('sources/dc-voltage', 'V1', { value: '12' });
  const vn = k.part('sources/dc-voltage', 'V2', { value: '12' });
  const vin = k.part('sources/ac-voltage', 'V3', { amplitude: '0.5', freq: '1k' });
  const u1 = k.part('analog/lm741', 'U1');
  const r1 = k.part('basic/resistor', 'R1', { value: '10k' });
  const r2 = k.part('basic/resistor', 'R2', { value: '100k' });
  const rl = k.part('basic/resistor', 'R3', { value: '10k' });
  k.net('VP', [vp, '+'], [u1, 'V+']);
  k.net('VN', [vn, '-'], [u1, 'V-']);
  k.net('IN', [vin, '+'], [r1, '1']);
  k.net('INV', [r1, '2'], [u1, 'IN-'], [r2, '1']);
  k.net('OUT', [r2, '2'], [u1, 'OUT'], [rl, '1']);
  k.net('GND', [vp, '-'], [vn, '+'], [vin, '-'], [u1, 'IN+'], [rl, '2']);
  return k.design;
}

/** 7400 NAND gate (hidden VCC / GND pins) sinking an LED; unused inputs tied to ground. */
export function nandLedCircuit(): Design {
  const k = new Kit('Cổng NAND 7400 / 7400 NAND gate');
  const vcc = k.part('sources/vcc', 'VCC1', { voltage: '5' });
  const u1 = k.part('ttl/7400', 'U1');
  const r1 = k.part('basic/resistor', 'R1', { value: '330' });
  const led = k.part('diodes/led-yellow', 'LED1');
  k.net('VCC', [vcc, '1'], [u1, '1A'], [u1, '1B'], [r1, '1']);
  k.net('N_LED', [r1, '2'], [led, 'A']);
  k.net('Y1', [led, 'K'], [u1, '1Y']);
  k.net('GND', [u1, '2A'], [u1, '2B'], [u1, '3A'], [u1, '3B'], [u1, '4A'], [u1, '4B']);
  return k.design;
}

/** `n` LED + resistor branches across a 5 V supply (2n parts; stress test for layout and 3D). */
export function ledArrayCircuit(n = 60): Design {
  const k = new Kit(tr(ledArrayTitle(n)));
  const v1 = k.part('sources/dc-voltage', 'V1', { value: '5' });
  const colors = ['red', 'green', 'yellow', 'blue', 'orange', 'white'];
  const plus: PinRef[] = [[v1, '+']];
  const gnd: PinRef[] = [[v1, '-']];
  for (let i = 1; i <= n; i++) {
    const r = k.part('basic/resistor', `R${i}`, { value: '330' });
    const led = k.part(`diodes/led-${colors[(i - 1) % colors.length]}`, `LED${i}`);
    plus.push([r, '1']);
    k.net(`N${i}`, [r, '2'], [led, 'A']);
    gnd.push([led, 'K']);
  }
  k.net('V5', ...plus);
  k.net('GND', ...gnd);
  return k.design;
}

export const EXAMPLE_CIRCUITS: { id: string; build: () => Design }[] = [
  { id: 'series-led', build: seriesLedCircuit },
  { id: 'divider', build: dividerCircuit },
  { id: 'transistor-switch', build: transistorSwitchCircuit },
  { id: 'astable-555', build: astable555Circuit },
  { id: 'inverting-amp', build: invertingAmpCircuit },
  { id: 'nand-led', build: nandLedCircuit },
];
