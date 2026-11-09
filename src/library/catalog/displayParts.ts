/**
 * Display and indicator catalogue (group Indicators): character LCD modules (HD44780-compatible
 * controller, D_LCD code model), LED dot-matrix displays, 14- and 16-segment alphanumeric
 * displays, more bar graphs, a hex display with decimal point and logic probes in several colours.
 *
 * LED displays are real diodes (one LED model per segment / dot, by colour) plus display-sensing
 * code models (D_DISPLAY) that drive internal "code" nodes to the bit mask of the lit LEDs; the
 * schematic reads those nodes (bindIndicator → signal / signals) to draw the lit segments, bars
 * and dots. The LCD's controller drives one code node per visible character, a status node and
 * the 64 custom-character rows (src/sim/devices/digital/displays.ts). Symbols are original
 * line-art; segment glyphs are drawn as 2-unit-wide lines in segment order, which the editor uses
 * to light them.
 */
import { thermalVoltage } from '../../sim/device';
import type { ModelCard } from '../../sim/netlist';
import type { SignalRef } from '../../model/types';
import { card, elB, elD, elR, internalNode, internalNodeName, numParam, selectParam, type LibraryPartDef } from '../partkit';
import { circle, line, makeSymbol, pin, rect, text } from '../symbols';
import type { ParamDef, PinDef, SymbolPrim, ToSpiceContext } from '../types';
import { ledModel } from '../parts/diodes';
import { aElement, digitGlyph, familyModel, icSymbol, idealLevels, type PowerNodes } from '../parts/digital/kit';
import { withMeta } from './kit';

const GROUND_REF: PowerNodes = { nodes: ['0'], pwr: 1 };

/** LED colours of displays: forward voltage at 20 mA, emission coefficient, series R, CSS colour. */
export const DISPLAY_COLORS: Record<string, { label: string; vf: number; n: number; rs: number; css: string }> = {
  red: { label: 'Red', vf: 2.0, n: 2.0, rs: 5, css: '#ff3b30' },
  orange: { label: 'Orange', vf: 2.0, n: 2.0, rs: 5, css: '#ff9f0a' },
  yellow: { label: 'Yellow', vf: 2.1, n: 2.0, rs: 5, css: '#ffd60a' },
  green: { label: 'Green', vf: 2.2, n: 2.0, rs: 5, css: '#34c759' },
  blue: { label: 'Blue', vf: 3.2, n: 2.6, rs: 10, css: '#3d8bff' },
  white: { label: 'White', vf: 3.2, n: 2.6, rs: 10, css: '#f2f2f2' },
};

const colorParam = (def = 'red'): ParamDef =>
  selectParam(
    'color',
    'Colour',
    def,
    Object.entries(DISPLAY_COLORS).map(([k, v]) => [k, v.label] as [string, string]),
    { group: 'display' },
  );

function ledFor(ctx: ToSpiceContext, key = (ctx.params.color ?? 'red').toLowerCase()): { model: ModelCard; von: number } {
  const spec = DISPLAY_COLORS[key];
  if (!spec) throw new Error(`bad value for color: '${ctx.params.color}'`);
  const model = ledModel(`MS_DISPLAY_LED_${key.toUpperCase()}`, spec.vf, 20e-3, spec.n, spec.rs);
  const von = spec.n * thermalVoltage(300.15) * Math.log(1e-3 / model.params.is + 1) + 1e-3 * spec.rs;
  return { model, von };
}

function senseCard(von: number): ModelCard {
  return card(`MS_DISPLAY_SENSE_${Math.round(von * 1000)}`, 'D_DISPLAY', { von });
}

const vref = (refdes: string, suffix: string): SignalRef => ({ kind: 'voltage', pos: internalNodeName(refdes, suffix), neg: '0' });

// ---------------------------------------------------------------------------------------------
// character LCD

const LCD_PINS: [string, string, 'input' | 'passive'][] = [
  ['VSS', '1', 'passive'],
  ['VDD', '2', 'passive'],
  ['V0', '3', 'passive'],
  ['RS', '4', 'input'],
  ['RW', '5', 'input'],
  ['E', '6', 'input'],
  ['D0', '7', 'input'],
  ['D1', '8', 'input'],
  ['D2', '9', 'input'],
  ['D3', '10', 'input'],
  ['D4', '11', 'input'],
  ['D5', '12', 'input'],
  ['D6', '13', 'input'],
  ['D7', '14', 'input'],
  ['A', '15', 'passive'],
  ['K', '16', 'passive'],
];

const CELL_W = 8;
const CELL_H = 12;

function lcdSymbol(cols: number, rows: number) {
  const sw = cols * CELL_W + 8;
  const sh = rows * CELL_H + 8;
  const w = Math.max(340, Math.ceil((sw + 40) / 20) * 20);
  const h = Math.ceil((sh + 40) / 20) * 20;
  const top = -h / 2;
  const screen = { x: -sw / 2, y: top + 24, w: sw, h: sh };
  const prims: SymbolPrim[] = [rect(-w / 2, top, w, h, false, 4), text(0, top + 14, `LCD ${cols}x${rows}`, 9, 'middle', true), rect(screen.x, screen.y, screen.w, screen.h, '#7da34f', 2)];
  const pins: PinDef[] = [];
  const x0 = -((LCD_PINS.length - 1) * 20) / 2;
  const y = h / 2 + 10;
  LCD_PINS.forEach(([name, num, type], i) => {
    const x = x0 + 20 * i;
    prims.push(line(x, h / 2, x, y), text(x + 3, h / 2 + 7, num, 6, 'start'));
    pins.push(pin(name, x, y, 'down', { label: name, type, number: num }));
  });
  return { symbol: makeSymbol(prims, pins, { refPos: { x: -w / 2, y: top - 8 }, valuePos: { x: w / 2, y: top - 8 } }), screen };
}

function lcdPart(cols: number, rows: number): LibraryPartDef {
  const { symbol, screen } = lcdSymbol(cols, rows);
  const cells = cols * rows;
  const suffixes = [...Array.from({ length: cells }, (_, k) => `c${k}`), 'st', ...Array.from({ length: 64 }, (_, k) => `g${k}`)];
  return withMeta(
    {
      id: `indicators/lcd-${cols}x${rows}`,
      name: `LCD ${cols}x${rows}`,
      group: 'indicators',
      family: 'Character LCD',
      description: `${cols} x ${rows} character LCD module with an HD44780-compatible controller: 8- or 4-bit bus (RS, RW, E, D0-D7), data latched on the falling edge of E; instructions clear, home, entry mode, display on/off, shift, function set, CGRAM / DDRAM address; 8 custom characters. Starts with the display off: send function set and display on first. Backlight A-K is an LED; VSS / VDD / V0 are drawn for wiring.`,
      prefix: 'U',
      symbol,
      params: [
        selectParam('backlight', 'Backlight', 'green', [['green', 'Yellow-green'], ['blue', 'Blue'], ['white', 'White']], { group: 'display' }),
        numParam('texec', 'Instruction time', '37u', 's', { min: 0, group: 'model', help: 'Busy time after an instruction or data write (clear / home: 1.52 ms)' }),
      ],
      optionalPins: ['VSS', 'VDD', 'V0', 'A', 'K', 'RW', 'D0', 'D1', 'D2', 'D3'],
      indicator: { kind: 'lcd', signal: 'c0', cols, rows, screen },
      toSpice: (ctx) => {
        const lv = { ...idealLevels(5, 120e-9, 1.4), rlow: 200, rhigh: 200 };
        const m = familyModel('MS_LCD', 'D_LCD', lv, 1, { cols, rows, texec: ctx.num('texec'), tclear: 1.52e-3 });
        const ports = ['RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'].map((p) => ctx.node(p));
        const led = ledFor(ctx, 'white');
        return {
          elements: [
            aElement(ctx.name('A'), [...ports, ...suffixes.map((s) => internalNode(ctx, s))], GROUND_REF, m.name),
            elD(ctx.name('D', 'bl'), ctx.node('A'), ctx.node('K'), led.model.name),
            elR(ctx.name('R', 'vdd'), ctx.node('VDD'), ctx.node('VSS'), 1e6),
            elR(ctx.name('R', 'v0'), ctx.node('V0'), ctx.node('VSS'), 1e6),
          ],
          models: [m, led.model],
        };
      },
      bindIndicator: (b) => ({ signal: vref(b.refdes, 'c0'), signals: suffixes.map((s) => vref(b.refdes, s)) }),
      footprint: 'LCD-16P',
      keywords: ['lcd', 'character lcd', 'hd44780', '1602', '2004', 'display', 'text'],
      provenance: 'MachSim display controller code model (D_LCD): HD44780-compatible instruction subset from the public instruction table; original rendering',
    },
    {
      vi: `Màn hình LCD ký tự ${cols} x ${rows} có bộ điều khiển tương thích HD44780: bus 8 hoặc 4 bit (RS, RW, E, D0-D7), dữ liệu được chốt ở sườn xuống của E; các lệnh xoá màn hình, về đầu dòng, chế độ nhập, bật/tắt hiển thị, dịch, đặt chức năng, địa chỉ CGRAM / DDRAM; 8 ký tự tự tạo. Lúc khởi động màn hình tắt: hãy gửi lệnh đặt chức năng và bật hiển thị trước. Đèn nền A-K là một LED; VSS / VDD / V0 chỉ để nối dây.`,
      nameVi: `LCD ${cols}x${rows}`,
      specs: { positions: 16 },
      sortKey: cells,
      series: 'Character LCD',
    },
  );
}

// ---------------------------------------------------------------------------------------------
// dot matrix

function matrixPart(cols: number, rows: number, rowAnode: boolean): LibraryPartDef {
  const pitch = 10;
  const sw = cols * pitch;
  const sh = rows * pitch;
  const screen = { x: -sw / 2, y: -sh / 2, w: sw, h: sh };
  const prims: SymbolPrim[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) prims.push(circle(screen.x + (c + 0.5) * pitch, screen.y + (r + 0.5) * pitch, 3));
  const rowPins = Array.from({ length: rows }, (_, k) => ({ name: `R${k + 1}`, type: 'passive' as const }));
  const colPins = Array.from({ length: cols }, (_, k) => ({ name: `C${k + 1}`, type: 'passive' as const }));
  const half = Math.ceil(cols / 2);
  const symbol = icSymbol(`${cols}x${rows}`, rowPins, [], { w: Math.max(80, Math.ceil((sw + 30) / 20) * 20), top: colPins.slice(0, half), bottom: colPins.slice(half), extra: prims });
  const kind = rowAnode ? 'ra' : 'ca';
  return withMeta(
    {
      id: `indicators/matrix-${cols}x${rows}${rowAnode ? '' : '-ca'}`,
      name: `Dot matrix ${cols}x${rows} (${rowAnode ? 'row anode' : 'column anode'})`,
      group: 'indicators',
      family: 'Dot matrix',
      description: `${cols} x ${rows} LED dot-matrix display: the LED at row r, column c lights when ${rowAnode ? 'row Rr is driven high and column Cc low (rows are anodes)' : 'column Cc is driven high and row Rr low (columns are anodes)'}; scan the rows (or columns) quickly to show a pattern, through current-limiting resistors`,
      prefix: 'U',
      symbol,
      params: [colorParam()],
      indicator: { kind: 'matrix', signal: 'row1', cols, rows, screen },
      toSpice: (ctx) => {
        const { model, von } = ledFor(ctx);
        const sense = senseCard(von);
        const elements = [];
        for (let r = 1; r <= rows; r++) {
          const pairs: string[] = [];
          for (let c = 1; c <= cols; c++) {
            const [a, k] = rowAnode ? [ctx.node(`R${r}`), ctx.node(`C${c}`)] : [ctx.node(`C${c}`), ctx.node(`R${r}`)];
            elements.push(elD(ctx.name('D', `${r}_${c}`), a, k, model.name));
            pairs.push(a, k);
          }
          elements.push(aElement(ctx.name('A', `row${r}`), [...pairs, internalNode(ctx, `row${r}`)], GROUND_REF, sense.name));
        }
        return { elements, models: [model, sense] };
      },
      bindIndicator: (b) => ({ signal: vref(b.refdes, 'row1'), signals: Array.from({ length: rows }, (_, k) => vref(b.refdes, `row${k + 1}`)) }),
      footprint: `MATRIX-${cols}X${rows}-${kind.toUpperCase()}`,
      keywords: ['dot matrix', 'led matrix', 'display', `${cols}x${rows}`, rowAnode ? 'row anode' : 'column anode'],
      provenance: 'MachSim display: one LED model per dot (MachSim fit, VF at 20 mA per colour) plus display-sensing code models per row',
    },
    {
      vi: `LED ma trận điểm ${cols} x ${rows}: điểm ở hàng r, cột c sáng khi ${rowAnode ? 'hàng Rr ở mức cao và cột Cc ở mức thấp (hàng là anode)' : 'cột Cc ở mức cao và hàng Rr ở mức thấp (cột là anode)'}; quét lần lượt các hàng (hoặc cột) thật nhanh để hiện hình, nhớ có điện trở hạn dòng`,
      nameVi: `LED ma trận ${cols}x${rows} (${rowAnode ? 'anode theo hàng' : 'anode theo cột'})`,
      specs: { positions: rows + cols },
      sortKey: rows * cols * (rowAnode ? 1 : 2),
      series: 'Dot matrix',
    },
  );
}

// ---------------------------------------------------------------------------------------------
// alphanumeric 14 / 16 segment

/** Segment names in drawing (bit) order. */
export const ALNUM_SEGMENTS: Record<14 | 16, string[]> = {
  14: ['a', 'b', 'c', 'd', 'e', 'f', 'g1', 'g2', 'h', 'i', 'j', 'k', 'l', 'm'],
  16: ['a1', 'a2', 'b', 'c', 'd1', 'd2', 'e', 'f', 'g1', 'g2', 'h', 'i', 'j', 'k', 'l', 'm'],
};

/** Segment glyph lines (2 units wide) of a 14 / 16-segment character centred at (cx, cy). */
function alnumGlyph(n: 14 | 16, cx: number, cy: number, h: number): SymbolPrim[] {
  const w = h * 0.55;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const xm = cx;
  const y0 = cy - h / 2;
  const ym = cy;
  const y1 = cy + h / 2;
  const L = (a: number, b: number, c: number, d: number) => line(a, b, c, d, 2);
  // diagonals: h (top-left), i (top centre), j (top-right), k (bottom-right), l (bottom centre), m (bottom-left)
  const inner = [L(x0, y0, xm, ym), L(xm, y0, xm, ym), L(x1, y0, xm, ym), L(xm, ym, x1, y1), L(xm, ym, xm, y1), L(xm, ym, x0, y1)];
  if (n === 14) return [L(x0, y0, x1, y0), L(x1, y0, x1, ym), L(x1, ym, x1, y1), L(x0, y1, x1, y1), L(x0, ym, x0, y1), L(x0, y0, x0, ym), L(x0, ym, xm, ym), L(xm, ym, x1, ym), ...inner];
  return [L(x0, y0, xm, y0), L(xm, y0, x1, y0), L(x1, y0, x1, ym), L(x1, ym, x1, y1), L(xm, y1, x1, y1), L(x0, y1, xm, y1), L(x0, ym, x0, y1), L(x0, y0, x0, ym), L(x0, ym, xm, ym), L(xm, ym, x1, ym), ...inner];
}

function alnumPart(n: 14 | 16, anode: boolean): LibraryPartDef {
  const segs = [...ALNUM_SEGMENTS[n], 'dp'];
  const common = anode ? 'CA' : 'CC';
  const pinName = (s: string) => `SEG${s.toUpperCase()}`;
  const half = Math.ceil(segs.length / 2);
  const left = segs.slice(0, half).map((s) => ({ name: pinName(s), label: s, type: 'input' as const }));
  const right = segs.slice(half).map((s) => ({ name: pinName(s), label: s, type: 'input' as const }));
  const glyph = [...alnumGlyph(n, -4, 2, 46), circle(14, 26, 1.5, true)];
  return withMeta(
    {
      id: `indicators/alnum${n}-${anode ? 'ca' : 'cc'}`,
      name: `${n}-segment display (common ${anode ? 'anode' : 'cathode'})`,
      group: 'indicators',
      family: 'Alphanumeric display',
      description: `${n}-segment alphanumeric LED display with decimal point, common ${anode ? 'anode' : 'cathode'} pin ${common}: shows letters and digits; each segment is an LED (drive through series resistors)`,
      prefix: 'U',
      symbol: icSymbol(`${n}SEG ${common}`, left, right, { w: 80, top: [{ name: common, type: 'passive' }], extra: glyph }),
      params: [colorParam()],
      optionalPins: ['SEGDP'],
      indicator: { kind: 'alnum', signal: 'code', segments: n },
      toSpice: (ctx) => {
        const { model, von } = ledFor(ctx);
        const com = ctx.node(common);
        const elements = segs.map((s) => (anode ? elD(ctx.name('D', s), com, ctx.node(pinName(s)), model.name) : elD(ctx.name('D', s), ctx.node(pinName(s)), com, model.name)));
        const pairs = segs.flatMap((s) => (anode ? [com, ctx.node(pinName(s))] : [ctx.node(pinName(s)), com]));
        const sense = senseCard(von);
        elements.push(aElement(ctx.name('A'), [...pairs, internalNode(ctx, 'code')], GROUND_REF, sense.name));
        return { elements, models: [model, sense] };
      },
      bindIndicator: (b) => ({ signal: vref(b.refdes, 'code') }),
      footprint: `DISPLAY-${n}SEG`,
      keywords: [`${n}-segment`, 'alphanumeric', 'starburst', 'display', 'led', anode ? 'common anode' : 'common cathode'],
      provenance: 'MachSim display: one LED model per segment (MachSim fit, VF at 20 mA per colour) plus a display-sensing code model',
    },
    {
      vi: `LED hiển thị chữ và số ${n} đoạn có dấu chấm, chân ${anode ? 'anode' : 'cathode'} chung ${common}: hiện được chữ cái và chữ số; mỗi đoạn là một LED (cấp qua điện trở hạn dòng)`,
      nameVi: `LED ${n} đoạn (${anode ? 'anode' : 'cathode'} chung)`,
      specs: { positions: segs.length + 1 },
      sortKey: n * 2 + (anode ? 0 : 1),
      series: 'Alphanumeric display',
    },
  );
}

// ---------------------------------------------------------------------------------------------
// bar graphs, hex display, logic probes

function barGraph(n: number, colors?: string[]): LibraryPartDef {
  const ks = Array.from({ length: n }, (_, k) => k + 1);
  const pitch = 20;
  const bars = ks.map((k) => rect(-12, -(n - 1) * 10 - 3 + pitch * (k - 1), 24, 6, false));
  const multi = !!colors;
  return withMeta(
    {
      id: multi ? `indicators/bargraph-${n}-rgy` : `indicators/bargraph-${n}`,
      name: multi ? `Bar graph (${n} segments, green / yellow / red)` : `Bar graph (${n} segments)`,
      group: 'indicators',
      family: 'Bar graph',
      description: multi ? `${n} independent LEDs in one package: green, then yellow, then red (level meters); anodes A1..A${n}, cathodes K1..K${n}` : `${n} independent LEDs (anodes A1..A${n}, cathodes K1..K${n}) in one package`,
      prefix: 'U',
      symbol: icSymbol('BAR', ks.map((k) => ({ name: `A${k}`, type: 'input' as const })), ks.map((k) => ({ name: `K${k}`, type: 'input' as const })), { w: 60, extra: bars }),
      params: multi ? [] : [colorParam()],
      indicator: { kind: 'bargraph', signal: 'code', bars: n, ...(colors ? { barColors: colors.map((c) => DISPLAY_COLORS[c].css) } : {}) },
      toSpice: (ctx) => {
        const keys = colors ?? ks.map(() => (ctx.params.color ?? 'red').toLowerCase());
        const leds = keys.map((c) => ledFor(ctx, c));
        const elements = ks.map((k) => elD(ctx.name('D', String(k)), ctx.node(`A${k}`), ctx.node(`K${k}`), leds[k - 1].model.name));
        const von = Math.min(...leds.map((l) => l.von));
        const sense = senseCard(von);
        elements.push(aElement(ctx.name('A'), [...ks.flatMap((k) => [ctx.node(`A${k}`), ctx.node(`K${k}`)]), internalNode(ctx, 'code')], GROUND_REF, sense.name));
        const models = [...new Map(leds.map((l) => [l.model.name, l.model])).values(), sense];
        return { elements, models };
      },
      bindIndicator: (b) => ({ signal: vref(b.refdes, 'code') }),
      footprint: `BARGRAPH-${2 * n}P`,
      keywords: ['bar graph', 'led bar', 'level indicator', multi ? 'vu meter' : 'led'],
      provenance: 'MachSim display: LED models (MachSim fit, VF at 20 mA per colour) plus a display-sensing code model',
    },
    {
      vi: multi ? `${n} LED độc lập trong một vỏ: xanh lá, rồi vàng, rồi đỏ (đồng hồ báo mức); anode A1..A${n}, cathode K1..K${n}` : `${n} LED độc lập (anode A1..A${n}, cathode K1..K${n}) trong một vỏ`,
      nameVi: multi ? `LED thanh (${n} đoạn, xanh / vàng / đỏ)` : `LED thanh (${n} đoạn)`,
      specs: { positions: 2 * n },
      sortKey: n * (multi ? 10 : 1),
      series: 'Bar graph',
    },
  );
}

const hexDisplayDp: LibraryPartDef = withMeta(
  {
    id: 'indicators/hex-display-dp',
    name: 'Hex display with decimal point',
    group: 'indicators',
    family: 'Seven-segment',
    description: 'Seven-segment display with built-in hex decoder and a decimal-point input: shows the hexadecimal digit of D3..D0; DP lights the point',
    prefix: 'U',
    symbol: icSymbol('HEX', [{ name: 'D0', type: 'input' }, { name: 'D1', type: 'input' }, { name: 'D2', type: 'input' }, { name: 'D3', type: 'input' }, { name: 'DP', type: 'input' }], [], { w: 60, extra: digitGlyph(4, -4, 30, true) }),
    params: [numParam('threshold', 'Input threshold', '2.5', 'V', { group: 'model' }), colorParam()],
    optionalPins: ['DP'],
    indicator: { kind: 'seven-seg', signal: 'code' },
    toSpice: (ctx) => {
      const m = familyModel('MS_HEXDISPLAY', 'D_HEXDISPLAY', idealLevels(5, 0, ctx.num('threshold')));
      // the decimal point adds bit 7 through a second (1-bit) display sensor on DP
      const dp = card(`MS_DPSENSE_${Math.round(ctx.num('threshold') * 1000)}`, 'D_DISPLAY', { von: ctx.num('threshold') });
      const hex = internalNode(ctx, 'hex');
      const point = internalNode(ctx, 'dp');
      return {
        elements: [
          aElement(ctx.name('A', 'hex'), [ctx.node('D0'), ctx.node('D1'), ctx.node('D2'), ctx.node('D3'), hex], GROUND_REF, m.name),
          aElement(ctx.name('A', 'dp'), [ctx.node('DP'), '0', point], GROUND_REF, dp.name),
          elB(ctx.name('B', 'code'), internalNode(ctx, 'code'), '0', 'V', `V(${hex}) + 128 * V(${point})`),
          elR(ctx.name('R', 'code'), internalNode(ctx, 'code'), '0', 1e6),
        ],
        models: [m, dp],
      };
    },
    bindIndicator: (b) => ({ signal: vref(b.refdes, 'code') }),
    footprint: 'DISPLAY-HEX',
    keywords: ['hex display', 'hexadecimal', '7-segment', 'decimal point'],
    provenance: 'MachSim decoded display code model (D_HEXDISPLAY) plus a 1-bit display sensor for the point',
  },
  { vi: 'LED 7 đoạn có sẵn bộ giải mã hex và chân dấu chấm: hiện chữ số thập lục phân của D3..D0; DP làm sáng dấu chấm', nameVi: 'LED hiển thị hex có dấu chấm', sortKey: 2, series: 'Hex display' },
);

function probePart(color: 'green' | 'blue' | 'yellow' | 'orange'): LibraryPartDef {
  const css = DISPLAY_COLORS[color].css;
  const label = DISPLAY_COLORS[color].label;
  const vi: Record<string, string> = { green: 'xanh lá', blue: 'xanh dương', yellow: 'vàng', orange: 'cam' };
  return withMeta(
    {
      id: `indicators/logic-probe-${color}`,
      name: `Logic probe (${label.toLowerCase()})`,
      group: 'indicators',
      family: 'Probe',
      description: `Logic level indicator with a ${label.toLowerCase()} light: lights at or above the high threshold (1 GΩ input)`,
      prefix: 'X',
      virtual: true,
      symbol: makeSymbol([line(0, 0, 0, 10), rect(-10, 10, 20, 26, false, 3), circle(0, 23, 6, css)], [pin('IN', 0, 0, 'up', { type: 'input' })], { refPos: { x: 16, y: 18 }, valuePos: { x: 16, y: 30 } }),
      params: [numParam('threshold', 'High threshold', '2', 'V', { showOnSchematic: true, help: 'Indicates H at or above this voltage' }), numParam('vlow', 'Low threshold', '0.8', 'V', { help: 'Indicates L at or below this voltage' })],
      indicator: { kind: 'probe', signal: 'voltage', color: css },
      toSpice: (ctx) => {
        if (!(ctx.num('vlow') <= ctx.num('threshold'))) throw new Error('bad value for vlow: must not exceed the high threshold');
        return { elements: [elR(ctx.name('R'), ctx.node('IN'), '0', 1e9)] };
      },
      bindIndicator: (ctx) => {
        const n = ctx.net('IN');
        return n === null ? null : { signal: { kind: 'voltage', pos: n, neg: '0' } };
      },
      keywords: ['logic probe', 'probe', 'level', color],
    },
    { vi: `Đầu dò mức logic có đèn màu ${vi[color]}: sáng khi điện áp bằng hoặc vượt ngưỡng cao (trở vào 1 GΩ)`, nameVi: `Đầu dò logic (${vi[color]})`, sortKey: 2, series: 'Logic probe' },
  );
}

/** Display parts added to the hand-written seven-segment, hex display, bar graph and probe. */
export const DISPLAY_CATALOG: LibraryPartDef[] = [
  lcdPart(16, 1),
  lcdPart(16, 2),
  lcdPart(20, 2),
  lcdPart(20, 4),
  lcdPart(40, 2),
  matrixPart(5, 7, true),
  matrixPart(8, 8, true),
  matrixPart(8, 8, false),
  alnumPart(14, true),
  alnumPart(14, false),
  alnumPart(16, true),
  alnumPart(16, false),
  barGraph(5),
  barGraph(8),
  barGraph(10, ['green', 'green', 'green', 'green', 'green', 'yellow', 'yellow', 'yellow', 'red', 'red']),
  hexDisplayDp,
  probePart('green'),
  probePart('blue'),
  probePart('yellow'),
  probePart('orange'),
];
