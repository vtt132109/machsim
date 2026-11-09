/**
 * Analog and power IC breadth (round 4). A catalogue pack ('analog-more', groups Analog and Power).
 *
 *   op-amps        about 90 more types (precision, JFET, rail-to-rail CMOS, audio, wideband), through the
 *                  same table row format and macromodel as src/library/catalog/analogics.ts; the dual
 *                  and quad types come as a whole chip plus one part per amplifier
 *   comparators    push-pull / open-collector types, same model as the existing ones
 *   references     shunt and series voltage references
 *   regulators     fixed, low-dropout and adjustable linear regulators and the LM257x/LM259x family of
 *                  step-down regulators (rows of src/library/catalog/power.ts), with the real pin
 *                  numbers of their packages
 *   variants       package and second-source variants (variants.ts) of the op-amps, comparators,
 *                  references and regulators: "TL072CD" (SOIC-8), "LM358PW" (TSSOP-8), "OPA350DBV"
 *                  (SOT-23-5, pins renumbered), "L7805CV" / "MC7805CD2T" / "KA7805" (78xx from five makers
 *                  in TO-220, D2PAK, DPAK), "LM1117MP-3.3" (SOT-223), "LM317T" …
 *
 * Figures in the new tables are typical values read off public datasheets and rounded to one or two
 * digits: they set the macromodel (gain-bandwidth, slew rate, offset, supply current …); check the
 * maker's datasheet for guaranteed limits.
 */
import type { LibraryPartDef } from '../../partkit';
import { ALL_PARTS } from '../../parts';
import { comparatorRow, opampRowPackages, opampRowParts, seriesRow, shuntRow } from '../analogics';
import { buckFromText, regulatorFromText } from '../power';
import { repackage, variantId, type VariantSpec } from './variants';

// ---------------------------------------------------------------------------------------------
// op-amps: "names avol gbw slew rin rout vos iq vsatp vsatn isc vmax input rr package" (analogics.ts)

const OPAMP_MORE_TEXT = [
  // general-purpose bipolar
  'UA741 200k 1M 0.5M 2M 75 1m 1.7m 2 2 25m 36 bipolar - DIP-8',
  'LM101A/LM201A 160k 1M 0.5M 2M 75 2m 1.8m 1.5 1.5 25m 36 bipolar - DIP-8',
  'MC1458:2/MC1558:2 200k 1M 0.5M 2M 75 2m 2.3m 2 2 20m 36 bipolar - DIP-8',
  'MC33171/MC33172:2/MC33174:4 100k 1.8M 2.1M 150k 50 2m 0.2m 1.2 1.2 30m 44 bipolar - DIP-8',
  'MC34071/MC34072:2/MC34074:4 100k 4.5M 10M 1M 50 0.5m 1.9m 1.5 1.5 30m 44 bipolar - DIP-8',
  'MC33078:2/MC33079:4 100k 16M 7M 150k 37 0.15m 4m 1.5 1.5 40m 36 bipolar - DIP-8',
  'MC33201/MC33202:2/MC33204:4 100k 4.5M 10M 1M 50 0.5m 1.9m 0.05 0.05 80m 12 bipolar io SO-8',
  'SA5534 100k 10M 13M 100k 50 0.5m 4m 1 1 38m 44 bipolar - DIP-8',
  // audio
  'LM4562:2/LME49720:2 1M 55M 20M 30M 40 0.1m 10m 1.5 1.5 26m 34 bipolar - DIP-8',
  'LME49710 1M 55M 20M 30M 40 0.1m 5m 1.5 1.5 26m 34 bipolar - DIP-8',
  'OPA1642:2 1M 11M 20M 10T 40 0.5m 1.8m 1.5 1.5 30m 36 jfet - SO-8',
  'OPA1652:2 1M 18M 10M 10M 40 0.5m 2m 1 1 30m 36 bipolar io SO-8',
  'OPA132/OPA2132:2/OPA4132:4 1M 8M 20M 10T 50 0.5m 4m 1.5 1.5 40m 36 jfet - DIP-8',
  // precision
  'LT1007 7M 8M 2.5M 20M 40 20u 2.6m 1.5 1.5 25m 44 bipolar - DIP-8',
  'LT1037 7M 60M 15M 20M 40 20u 2.6m 1.5 1.5 25m 44 bipolar - DIP-8',
  'LT1055/LT1056 400k 5M 13M 1T 100 0.15m 4m 1.5 1.5 25m 36 jfet - DIP-8',
  'LT1097 1M 0.7M 0.2M 10M 50 10u 0.4m 1.5 1.5 20m 44 bipolar - DIP-8',
  'OP77 12M 0.6M 0.3M 45M 60 10u 1.6m 1.5 1.5 30m 44 bipolar - DIP-8',
  'OP113 4M 3.4M 1.2M 20M 30 50u 2.5m 1 1 30m 36 bipolar - DIP-8',
  'OP196/OP296:2/OP496:4 100k 0.45M 0.2M 100M 30 0.2m 0.06m 0.1 0.1 10m 12 bipolar io SO-8',
  'OPA227/OPA2227:2/OPA4227:4 1M 8M 2.3M 10M 50 5u 3.7m 1.5 1.5 35m 44 bipolar - DIP-8',
  'OPA211/OPA2211:2 1M 80M 27M 1M 20 20u 3.6m 1 1 30m 36 bipolar - SO-8',
  'OPA188/OPA2188:2/OPA4188:4 1M 2M 0.8M 1T 40 6u 0.45m 0.1 0.1 20m 36 cmos io SO-8',
  'OPA192/OPA2192:2/OPA4192:4 1M 10M 20M 1T 40 5u 1m 0.1 0.1 40m 36 cmos io SO-8',
  'OPA140/OPA2140:2/OPA4140:4 1M 11M 20M 10T 40 30u 1.8m 0.3 0.3 30m 36 jfet o SO-8',
  'AD8671/AD8672:2/AD8674:4 1M 10M 4M 1G 30 75u 3m 1 1 25m 36 bipolar - SO-8',
  'LT1677 1M 7.2M 2.5M 1G 40 60u 3m 0.1 0.1 25m 12 bipolar io SO-8',
  // JFET
  'LF347:4 100k 4M 13M 1T 100 5m 2m 1.5 1.5 20m 36 jfet - DIP-14',
  'LF357 50k 20M 50M 1T 100 3m 5m 1.5 1.5 20m 44 jfet - DIP-8',
  'LF441/LF442:2/LF444:4 200k 1M 1M 1T 100 1m 0.25m 1.5 1.5 25m 36 jfet - DIP-8',
  'TL051/TL052:2/TL054:4 200k 3M 20M 1T 100 0.8m 1.5m 1.5 1.5 40m 36 jfet - DIP-8',
  'AD8510/AD8512:2/AD8513:4 300k 8M 20M 10T 50 0.05m 2.2m 1.5 1.5 40m 30 jfet - SO-8',
  // CMOS / rail-to-rail, general purpose
  'OPA171/OPA2171:2/OPA4171:4 1M 3M 1.5M 1T 100 0.25m 0.475m 0.2 0.2 65m 36 cmos o SO-8',
  'OPA172/OPA2172:2/OPA4172:4 1M 10M 10M 1T 100 0.2m 1.6m 0.2 0.2 65m 36 cmos o SO-8',
  'OPA333/OPA2333:2 1M 0.35M 0.16M 100G 40 2u 17u 0.01 0.01 5m 5.5 cmos io SOT-23-5',
  'OPA335/OPA2335:2 1M 2M 1.6M 100G 40 5u 0.285m 0.01 0.01 5m 5.5 cmos io SO-8',
  'OPA344/OPA2344:2/OPA4344:4 1M 1M 0.8M 10T 50 0.2m 0.15m 0.005 0.005 20m 5.5 cmos io SOT-23-5',
  'OPA348/OPA2348:2 1M 1M 0.5M 10T 50 1m 0.045m 0.05 0.05 10m 5.5 cmos io SOT-23-5',
  'OPA354/OPA2354:2 1M 250M 150M 10T 10 2m 4.9m 0.1 0.1 100m 5.5 cmos io SOT-23-5',
  'OPA365/OPA2365:2 1M 50M 25M 10T 20 100u 4.6m 0.01 0.01 65m 5.5 cmos io SOT-23-5',
  'TLV271 1M 3M 2.4M 1T 50 0.5m 0.55m 0.05 0.05 40m 16 cmos io SOT-23-5',
  'TLV9061/TLV9062:2/TLV9064:4 1M 10M 6.5M 1T 50 0.3m 0.54m 0.01 0.01 40m 5.5 cmos io SOT-23-5',
  'TLV9001/TLV9002:2/TLV9004:4 1M 1M 2M 1T 50 0.4m 0.06m 0.01 0.01 40m 5.5 cmos io SOT-23-5',
  'LMC660:4/LMC662:2 100k 1.4M 1.1M 10T 100 3m 0.1m 0.3 0.3 20m 15.5 cmos o DIP-8',
  'AD8541/AD8542:2/AD8544:4 100k 1M 0.92M 10T 100 1m 0.045m 0.05 0.05 10m 5.5 cmos io SOT-23-5',
  'AD8531/AD8532:2/AD8534:4 100k 3M 5M 10T 50 1m 0.75m 0.1 0.1 250m 6 cmos io SOT-23-5',
  'AD8601/AD8602:2/AD8604:4 100k 8.4M 5M 10T 30 0.1m 0.75m 0.05 0.05 50m 6 cmos io SOT-23-5',
  'AD8603/AD8607:2/AD8609:4 100k 0.4M 0.1M 10T 100 0.1m 0.04m 0.01 0.01 10m 6 cmos io SOT-23-5',
  'AD8615/AD8616:2/AD8618:4 100k 24M 12M 10T 20 0.1m 1m 0.05 0.05 70m 6 cmos io SOT-23-5',
  'AD8628/AD8629:2/AD8630:4 1M 2.5M 1M 100G 100 1u 0.9m 0.05 0.05 20m 6 cmos io SOT-23-5',
  'AD8655/AD8656:2 100k 28M 11M 10T 20 0.1m 3.5m 0.05 0.05 50m 6 cmos io SO-8',
  'AD8051/AD8052:2/AD8054:4 100k 110M 170M 190k 20 1.7m 4.4m 0.1 0.1 40m 12 bipolar io SO-8',
  'AD8055 10k 300M 1400M 10M 10 5m 5.5m 1.2 1.2 60m 12 bipolar - SO-8',
  'MCP6021/MCP6022:2/MCP6024:4 100k 10M 7M 10T 90 0.5m 1m 0.025 0.025 30m 5.5 cmos io SO-8',
  'MCP6041/MCP6042:2/MCP6044:4 1M 0.014M 0.003M 10T 100 2m 0.6u 0.05 0.05 3m 5.5 cmos io SOT-23-5',
  'MCP6231/MCP6232:2/MCP6234:4 100k 0.3M 0.15M 10T 100 3m 20u 0.05 0.05 15m 5.5 cmos io SOT-23-5',
  'MCP6281/MCP6282:2/MCP6284:4 100k 5M 2.5M 10T 100 3m 0.445m 0.05 0.05 25m 6 cmos io SOT-23-5',
  'MCP6291/MCP6292:2/MCP6294:4 100k 10M 7M 10T 90 3m 1m 0.025 0.025 25m 6 cmos io SOT-23-5',
  'MCP6H01/MCP6H02:2/MCP6H04:4 100k 1.2M 0.8M 10T 70 0.7m 0.135m 0.05 0.05 20m 16 cmos io SOT-23-5',
  'CA3160 100k 4M 10M 1.5T 60 2m 2m 0.2 2 25m 16 cmos - DIP-8',
  'CA3240:2 100k 4.5M 9M 1.5T 60 5m 2m 3 0.15 30m 36 cmos - DIP-8',
  // wideband
  'THS4001 100k 270M 400M 5M 5 2m 7.8m 1.5 1.5 100m 33 bipolar - SO-8',
];

// ---------------------------------------------------------------------------------------------
// comparators: "pn tresp iq oc|pp vmax package"

const COMP_MORE_TEXT = [
  'TLV3201 40n 40u pp 5.5 SOT-23-5',
  'TLV7011 260n 5u pp 5.5 SOT-23-5',
  'LMV7219 7n 1.1m pp 5.5 SOT-23-5',
  'TL331 1.3u 0.15m oc 36 SOT-23-5',
  'MCP6546 4u 0.6u oc 5.5 SOT-23-5',
  'MCP6561 56n 100u pp 5.5 SOT-23-5',
  'MCP6566 56n 100u oc 5.5 SOT-23-5',
  'LM293 300n 0.4m oc 36 DIP-8',
  'LM193 300n 0.4m oc 36 DIP-8',
  'LM139 1.3u 0.8m oc 36 DIP-14',
  'LM239 1.3u 0.8m oc 36 DIP-14',
  'LM111 165n 5m oc 36 DIP-8',
  'LM211 165n 5m oc 36 DIP-8',
  'LM710 40n 12m pp 14 DIP-8',
  'CMP-04 100n 5m pp 36 DIP-8',
  'TLV3501A 4.5n 3.2m pp 5.5 SOT-23-6',
];

// ---------------------------------------------------------------------------------------------
// references

/** Shunt: "pn vref zzt package". */
const SHUNT_MORE_TEXT = [
  'LM4050-2.0 2.048 0.3 SOT-23',
  'LM4050-2.5 2.5 0.3 SOT-23',
  'LM4050-3.0 3.0 0.4 SOT-23',
  'LM4050-3.3 3.3 0.4 SOT-23',
  'LM4050-4.1 4.096 0.5 SOT-23',
  'LM4050-5.0 5.0 0.5 SOT-23',
  'LM4050-8.2 8.192 0.6 SOT-23',
  'LM4050-10 10.0 0.7 SOT-23',
  'LM4040-3.3 3.3 0.4 SOT-23',
  'LM4041-ADJ 1.24 0.5 SOT-23',
  'LM285-2.5 2.5 0.6 TO-92',
  'LM285-1.2 1.235 0.6 TO-92',
  'LM236-2.5 2.49 0.2 TO-92',
  'LM236-5.0 5.0 0.6 TO-92',
  'LM136-2.5 2.49 0.2 TO-92',
  'LM136-5.0 5.0 0.6 TO-92',
  'LM329 6.9 0.6 TO-92',
  'LM129 6.9 0.6 TO-92',
  'LM399 6.95 0.5 TO-46',
  'LM313 1.22 0.3 TO-92',
  'AD589 1.235 0.6 TO-52',
  'ZRC250 2.5 0.3 SOT-23',
  'ZRC330 3.3 0.4 SOT-23',
  'TLV431 1.24 0.25 SOT-23',
  'TL1431 2.5 0.2 TO-92',
  'MAX6006 1.25 0.3 SOT-23',
  'MAX6001 1.25 0.5 SOT-23',
];

/** Series: "pn vout dropout iq iout package". */
const SERIES_MORE_TEXT = [
  'REF191 2.048 0.5 0.045m 30m SO-8',
  'REF192 2.5 0.5 0.045m 30m SO-8',
  'REF193 3.0 0.5 0.045m 30m SO-8',
  'REF194 4.5 0.5 0.045m 30m SO-8',
  'REF195 5.0 0.5 0.045m 30m SO-8',
  'REF196 3.3 0.5 0.045m 30m SO-8',
  'REF198 4.096 0.5 0.045m 30m SO-8',
  'ADR420 2.048 0.5 0.5m 10m SO-8',
  'ADR421 2.5 0.5 0.5m 10m SO-8',
  'ADR423 3.0 0.5 0.5m 10m SO-8',
  'ADR425 5.0 0.5 0.5m 10m SO-8',
  'ADR430 2.048 0.5 0.8m 30m SO-8',
  'ADR431 2.5 0.5 0.8m 30m SO-8',
  'ADR433 3.0 0.5 0.8m 30m SO-8',
  'ADR434 4.096 0.5 0.8m 30m SO-8',
  'ADR435 5.0 0.5 0.8m 30m SO-8',
  'AD780-2.5 2.5 2 0.75m 10m SO-8',
  'AD780-3.0 3.0 2 0.75m 10m SO-8',
  'LM4120-2.5 2.5 0.12 0.1m 5m SOT-23',
  'LM4120-3.3 3.3 0.12 0.1m 5m SOT-23',
  'LM4120-5.0 5.0 0.12 0.1m 5m SOT-23',
  'LM4132-2.5 2.5 0.1 0.06m 20m SOT-23',
  'LM4132-3.3 3.3 0.1 0.06m 20m SOT-23',
  'REF3012 1.25 0.2 0.05m 25m SOT-23',
  'REF3020 2.048 0.2 0.05m 25m SOT-23',
  'REF3025 2.5 0.2 0.05m 25m SOT-23',
  'REF3040 4.096 0.2 0.05m 25m SOT-23',
  'REF3050 5.0 0.2 0.05m 25m SOT-23',
  'MCP1525 2.5 0.15 0.1m 2m SOT-23',
  'MCP1541 4.096 0.15 0.1m 2m SOT-23',
  'LT1019-2.5 2.5 0.4 0.65m 10m SO-8',
  'LT1019-5 5.0 0.4 0.65m 10m SO-8',
  'LT1021-5 5.0 1.5 0.8m 10m SO-8',
  'LT1021-7 7.0 1.5 0.8m 10m SO-8',
  'LT1021-10 10.0 1.5 0.8m 10m SO-8',
  'LT1236-5 5.0 1.5 0.8m 10m SO-8',
  'LT1236-10 10.0 1.5 0.8m 10m SO-8',
  'MAX6125-3.0 3.0 0.2 0.1m 10m SOT-23',
  'MAX6025 2.5 0.2 0.04m 5m SOT-23',
  'MAX6250 5.0 0.2 0.35m 15m SO-8',
  'MAX6225 2.5 0.2 0.35m 15m SO-8',
];

// ---------------------------------------------------------------------------------------------
// linear regulators: "pn kind v vdo ilim iq rout package [pin map]" (power.ts) and step-down regulators

const R = (name: string, kind: string, v: number, rest: string): string => `${name} ${kind} ${v} ${rest}`;
/** Voltage in a part number: 5.0, 8.0, 12, 2.85. */
const lab = (v: number): string => (Number.isInteger(v) ? (v < 10 ? v.toFixed(1) : String(v)) : String(v));

const REG_MORE_TEXT = [
  // fixed three-terminal (TO-220)
  R('7820', 'pos', 20, '2 1.5 5m 0.02 TO-220'),
  ...[5, 6, 8, 9, 12, 15, 18, 24].map((v) => R(`79M${String(v).padStart(2, '0')}`, 'neg', v, '1.1 0.7 3m 0.05 TO-220')),
  ...[10, 18, 20, 24].map((v) => R(`78M${v}`, 'pos', v, '2 0.7 4.5m 0.05 TO-220')),
  ...[10, 18, 24, 33].map((v) => R(`78L${v}`, 'pos', v / (v === 33 ? 10 : 1), '1.7 0.14 3m 0.1 TO-92 OUT1/GND2/IN3')),
  R('7920', 'neg', 20, '1.1 1.5 3m 0.02 TO-220'),
  ...[5, 12, 15, 24].map((v) => R(`LM340T-${lab(v)}`, 'pos', v, '2 1.5 8m 0.02 TO-220')),
  // LM1117 family and other 800 mA - 1.5 A regulators in the SOT-223 / TO-220 / TO-252 pin-out GND OUT IN
  ...[1.2, 1.5, 2.85].map((v) => R(`LM1117-${lab(v)}`, 'pos', v, '1.1 1.2 5m 0.02 SOT-223 GND1/OUT2/IN3')),
  ...[1.2, 1.8, 2.5, 2.85].map((v) => R(`LD1117-${lab(v)}`, 'pos', v, '1.0 1.0 5m 0.02 SOT-223 GND1/OUT2/IN3')),
  ...[1.8, 2.0, 2.5, 3.3, 5.0].map((v) => R(`NCP1117-${lab(v)}`, 'pos', v, '1.2 1.2 5m 0.02 SOT-223 GND1/OUT2/IN3')),
  'NCP1117-ADJ adj 1.25 1.2 1.2 60u 0.02 SOT-223 ADJ1/OUT2/IN3',
  ...[1.8, 2.5, 3.3, 5.0].map((v) => R(`TLV1117-${String(v).replace('.', '')}`, 'pos', v, '1.1 1.2 5m 0.02 SOT-223 GND1/OUT2/IN3')),
  ...[3.3, 5.0, 12].map((v) => R(`LM1084-${lab(v)}`, 'pos', v, '1.3 6 5m 0.004 TO-220 GND1/OUT2/IN3')),
  ...[3.3, 5.0].map((v) => R(`LM1085-${lab(v)}`, 'pos', v, '1.3 4 5m 0.006 TO-220 GND1/OUT2/IN3')),
  ...[1.8, 2.5].map((v) => R(`LM1086-${lab(v)}`, 'pos', v, '1.3 2.7 5m 0.01 TO-220 GND1/OUT2/IN3')),
  // automotive / low-dropout 500 mA – 1 A (TO-220 pin-out IN GND OUT)
  ...[2.5, 8, 10, 12, 15].map((v) => R(`LM2937-${lab(v)}`, 'pos', v, '0.5 0.75 2m 0.03 TO-220')),
  ...[8, 9, 10, 15].map((v) => R(`LM2940-${lab(v)}`, 'pos', v, '0.5 1.5 10m 0.02 TO-220')),
  ...[3.3, 8].map((v) => R(`LM2931-${lab(v)}`, 'pos', v, '0.3 0.15 0.4m 0.1 TO-92')),
  R('LM2936-3.3', 'pos', 3.3, '0.2 0.1 15u 0.2 SOT-223 IN1/GND2/OUT3'),
  R('LM2936-5.0', 'pos', 5, '0.2 0.1 15u 0.2 SOT-223 IN1/GND2/OUT3'),
  ...[3.0].map((v) => R(`LP2950-${lab(v)}`, 'pos', v, '0.38 0.16 75u 0.1 TO-92')),
  // small LDOs in SOT-23 / SOT-23-5 / SC-70-5
  ...[2.5, 3.0, 5.0].map((v) => R(`LP2985-${lab(v)}`, 'pos', v, '0.28 0.35 0.85m 0.1 SOT-23-5 IN1/GND2/OUT5')),
  R('LP5907-3.3', 'pos', 3.3, '0.12 0.35 12u 0.15 SC-70-5 IN1/GND2/OUT5'),
  R('LP5907-1.8', 'pos', 1.8, '0.12 0.35 12u 0.15 SC-70-5 IN1/GND2/OUT5'),
  ...[1.2, 1.8, 2.5, 3.3].map((v) => R(`TLV700${String(Math.round(v * 10)).padStart(2, '0')}`, 'pos', v, '0.25 0.35 31u 0.2 SOT-23-5 IN1/GND2/OUT5')),
  ...[1.8, 2.5, 3.3].map((v) => R(`MIC5205-${lab(v)}`, 'pos', v, '0.35 0.3 0.15m 0.1 SOT-23-5 IN1/GND2/OUT5')),
  R('MIC5205-5.0', 'pos', 5, '0.35 0.3 0.15m 0.1 SOT-23-5 IN1/GND2/OUT5'),
  ...[1.2, 1.8, 2.5, 3.3].map((v) => R(`AP2112K-${lab(v)}`, 'pos', v, '0.25 0.84 55u 0.1 SOT-23-5 IN1/GND2/OUT5')),
  ...[1.8, 2.5, 3.3].map((v) => R(`RT9013-${String(Math.round(v * 10))}`, 'pos', v, '0.25 0.7 25u 0.1 SOT-23-5 IN1/GND2/OUT5')),
  ...[1.8, 2.5, 3.0, 5.0].map((v) => R(`XC6206P${Math.round(v * 10)}2`, 'pos', v, '0.25 0.3 1u 0.3 SOT-23 GND1/OUT2/IN3')),
  ...[1.2, 3.0].map((v) => R(`MCP1700-${lab(v)}`, 'pos', v, '0.178 0.4 1.6u 0.2 SOT-23 GND1/OUT2/IN3')),
  ...[1.8, 2.5, 3.0].map((v) => R(`MCP1702-${lab(v)}`, 'pos', v, '0.625 0.4 2u 0.2 SOT-23 GND1/OUT2/IN3')),
  R('MCP1703-3.3', 'pos', 3.3, '0.65 0.4 2u 0.2 SOT-223 GND1/OUT2/IN3'),
  R('MCP1703-5.0', 'pos', 5, '0.65 0.4 2u 0.2 SOT-223 GND1/OUT2/IN3'),
  R('MCP1825-3.3', 'pos', 3.3, '0.21 0.7 0.12m 0.05 SOT-223 GND1/OUT2/IN3'),
  R('MCP1825-5.0', 'pos', 5, '0.21 0.7 0.12m 0.05 SOT-223 GND1/OUT2/IN3'),
  R('L4931-3.3', 'pos', 3.3, '0.4 0.4 0.4m 0.1 SOT-223 IN1/GND2/OUT3'),
  R('L4931-5.0', 'pos', 5, '0.4 0.4 0.4m 0.1 SOT-223 IN1/GND2/OUT3'),
  R('LD2981-3.3', 'pos', 3.3, '0.2 0.14 0.1m 0.1 SOT-23-5 IN1/GND2/OUT5'),
  R('LD2981-5.0', 'pos', 5, '0.2 0.14 0.1m 0.1 SOT-23-5 IN1/GND2/OUT5'),
  R('ADP3338-3.3', 'pos', 3.3, '1.3 1.4 2m 0.02 SOT-223 GND1/OUT2/IN3'),
  R('SPX1117-3.3', 'pos', 3.3, '1.1 1.2 5m 0.02 SOT-223 GND1/OUT2/IN3'),
  R('SPX1117-5.0', 'pos', 5, '1.1 1.2 5m 0.02 SOT-223 GND1/OUT2/IN3'),
];

const BUCK_MORE_TEXT = [
  'LM2576-3.3 3.3 1.23 4.2 52k 5m TO-220-5',
  'LM2576-15 15 1.23 4.2 52k 5m TO-220-5',
  'LM2575-3.3 3.3 1.23 1.7 52k 5m TO-220-5',
  'LM2575-12 12 1.23 1.7 52k 5m TO-220-5',
  'LM2575-15 15 1.23 1.7 52k 5m TO-220-5',
  'LM2576HV-5.0 5 1.23 4.2 52k 5m TO-220-5',
  'LM2576HV-12 12 1.23 4.2 52k 5m TO-220-5',
  'LM2576HV-ADJ 0 1.23 4.2 52k 5m TO-220-5',
  'LM2575HV-5.0 5 1.23 1.7 52k 5m TO-220-5',
  'LM2575HV-ADJ 0 1.23 1.7 52k 5m TO-220-5',
];

// ---------------------------------------------------------------------------------------------
// building the base parts

const known = new Set(ALL_PARTS.map((p) => p.id));

/** Pin numbers by pin name ("GND1/OUT2/IN3"). */
function pinMap(text: string | undefined): Record<string, string> | undefined {
  if (!text) return undefined;
  const out: Record<string, string> = {};
  for (const tok of text.split('/')) {
    const m = tok.match(/^([A-Z+-]+)(\d+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** SOT-23-5 / SC-70-5 numbering of a single op-amp or comparator (the usual DBV / DCK pin-out). */
const SOT5: Record<string, string> = { OUT: '1', 'V-': '2', 'IN+': '3', 'IN-': '4', 'V+': '5' };
/** The DIP-8 / SOIC-8 / TSSOP-8 numbering of a single op-amp or comparator. */
const DIP8_SINGLE: Record<string, string> = { 'IN-': '2', 'IN+': '3', 'V-': '4', OUT: '6', 'V+': '7' };

function withPinNumbers(part: LibraryPartDef, map: Record<string, string> | undefined): LibraryPartDef {
  if (!map) return part;
  return { ...part, symbol: { ...part.symbol, pins: part.symbol.pins.map((p) => (map[p.name] !== undefined ? { ...p, number: map[p.name] } : p)) } };
}

function regulatorRow(text: string): LibraryPartDef {
  const f = text.trim().split(/\s+/);
  const part = regulatorFromText(f.slice(0, 8).join(' '));
  return withPinNumbers(part, pinMap(f[8]));
}

const fresh = (parts: LibraryPartDef[]): LibraryPartDef[] => {
  const seen = new Set<string>();
  return parts.filter((p) => {
    if (known.has(p.id) || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
};

/**
 * A table row names one package for all of its types, but a dual or quad is never sold in a 5-pin SOT-23
 * (its single-amplifier part is drawn in the SO-8 / SO-14 of the chip), and a genuine 5-pin part has the
 * SOT-23-5 numbering instead of the DIP-8 one.
 */
function fitPackage(part: LibraryPartDef): LibraryPartDef {
  if ((part.footprint !== 'SOT-23-5' && part.footprint !== 'SOT-23-6') || part.pkg) return part;
  const quad = /one section of the quad/.test(part.description);
  if (quad || /one section of the dual/.test(part.description)) return { ...part, footprint: quad ? 'SOIC-14' : 'SOIC-8' };
  return withPinNumbers(part, part.footprint === 'SOT-23-6' ? { ...SOT5, 'V+': '6' } : SOT5);
}

/** The usual SOT-23-3 numbering of a series voltage reference: IN 1, OUT 2, GND 3 (the SO-8 versions keep IN 2, OUT 6, GND 4). */
const fitReference = (part: LibraryPartDef): LibraryPartDef => (part.footprint === 'SOT-23' && part.symbol.pins.some((p) => p.name === 'IN') ? withPinNumbers(part, { IN: '1', OUT: '2', GND: '3' }) : part);

/** Op-amp bases: one part per name and the whole chip and sections of each dual / quad. */
export const OPAMP_MORE: LibraryPartDef[] = fresh([...OPAMP_MORE_TEXT.flatMap(opampRowParts).map(fitPackage), ...OPAMP_MORE_TEXT.flatMap(opampRowPackages)]);
export const COMPARATOR_MORE: LibraryPartDef[] = fresh(COMP_MORE_TEXT.map(comparatorRow).map(fitPackage));
export const REFERENCE_MORE: LibraryPartDef[] = fresh([...SHUNT_MORE_TEXT.map(shuntRow), ...SERIES_MORE_TEXT.map(seriesRow).map(fitReference)]);
export const REGULATOR_MORE: LibraryPartDef[] = fresh([...REG_MORE_TEXT.map(regulatorRow), ...BUCK_MORE_TEXT.map(buckFromText)]);

// ---------------------------------------------------------------------------------------------
// variants

type PkgKey = 'dip8' | 'soic8' | 'tssop8' | 'msop8' | 'sot5' | 'sc70' | 'dip14' | 'soic14' | 'tssop14';

interface PackageForm {
  footprint: string;
  en: string;
  vi: string;
  renumber?: Record<string, string>;
}

const FORMS: Record<PkgKey, PackageForm> = {
  dip8: { footprint: 'DIP-8', en: '8-pin plastic DIP', vi: 'vỏ DIP nhựa 8 chân', renumber: DIP8_SINGLE },
  soic8: { footprint: 'SOIC-8', en: '8-pin SOIC', vi: 'vỏ dán SOIC 8 chân', renumber: DIP8_SINGLE },
  tssop8: { footprint: 'TSSOP-8', en: '8-pin TSSOP', vi: 'vỏ dán TSSOP 8 chân', renumber: DIP8_SINGLE },
  msop8: { footprint: 'MSOP-8', en: '8-pin MSOP', vi: 'vỏ dán MSOP 8 chân', renumber: DIP8_SINGLE },
  sot5: { footprint: 'SOT-23-5', en: '5-pin SOT-23', vi: 'vỏ dán SOT-23 5 chân', renumber: SOT5 },
  sc70: { footprint: 'SC-70-5', en: '5-pin SC-70', vi: 'vỏ dán SC-70 5 chân', renumber: SOT5 },
  dip14: { footprint: 'DIP-14', en: '14-pin plastic DIP', vi: 'vỏ DIP nhựa 14 chân' },
  soic14: { footprint: 'SOIC-14', en: '14-pin SOIC', vi: 'vỏ dán SOIC 14 chân' },
  tssop14: { footprint: 'TSSOP-14', en: '14-pin TSSOP', vi: 'vỏ dán TSSOP 14 chân' },
};

/** Order-code suffixes per maker family (public naming schemes); a missing entry means the maker has no such package code. */
type Codes = Partial<Record<PkgKey, string>>;

const TI_CODES: Codes = { dip8: 'P', soic8: 'D', tssop8: 'PW', msop8: 'DGK', sot5: 'DBV', sc70: 'DCK', dip14: 'N', soic14: 'D', tssop14: 'PW' };
const BB_CODES: Codes = { dip8: 'PA', soic8: 'UA', tssop8: 'PW', msop8: 'DGK', sot5: 'DBV', sc70: 'DCK', dip14: 'PA', soic14: 'UA', tssop14: 'PW' };
const MCP_CODES: Codes = { dip8: '-E/P', soic8: '-E/SN', tssop8: '-E/ST', msop8: '-E/MS', sot5: '-E/OT', sc70: '-E/LT', dip14: '-E/P', soic14: '-E/SL', tssop14: '-E/ST' };
const ADI_CODES: Codes = { dip8: 'NZ', soic8: 'RZ', tssop8: 'RUZ', msop8: 'RMZ', sot5: 'RTZ', dip14: 'NZ', soic14: 'RZ', tssop14: 'RUZ' };
const LT_CODES: Codes = { dip8: 'CN8', soic8: 'CS8', dip14: 'CN', soic14: 'CS' };
const ON_CODES: Codes = { dip8: 'P', soic8: 'D', dip14: 'P', soic14: 'D', tssop14: 'DTB' };
const MAX_CODES: Codes = { dip8: 'EPA', soic8: 'ESA', msop8: 'EUA', sot5: 'EUK' };
const GENERIC_CODES: Codes = { dip8: '-DIP8', soic8: '-SOIC8', tssop8: '-TSSOP8', msop8: '-MSOP8', sot5: '-SOT23-5', sc70: '-SC70-5', dip14: '-DIP14', soic14: '-SOIC14', tssop14: '-TSSOP14' };

/** Order-code scheme of a part number by its maker prefix. */
export function codesFor(pn: string): Codes {
  if (/^(OPA|INA|PGA)/i.test(pn)) return BB_CODES;
  if (/^(LM|LF|TL|TLC|TLV|NE|SA|UA|LMV|LMC|LMP|THS|REF3|REF5|CD|SN)/i.test(pn)) return TI_CODES;
  if (/^MCP/i.test(pn)) return MCP_CODES;
  if (/^(AD|OP|ADR|REF1)/i.test(pn)) return ADI_CODES;
  if (/^(LT|LTC)/i.test(pn)) return LT_CODES;
  if (/^MC\d/i.test(pn)) return ON_CODES;
  if (/^MAX/i.test(pn)) return MAX_CODES;
  return GENERIC_CODES;
}

function viaForm(base: LibraryPartDef, pn: string, key: PkgKey, codes: Codes): LibraryPartDef | null {
  const suffix = codes[key];
  const form = FORMS[key];
  if (suffix === undefined || form.footprint === base.footprint) return null;
  const name = `${pn}${suffix}`;
  return repackage(base, { id: variantId(base, name), name, footprint: form.footprint, pkg: form.footprint, en: `the ${form.en} version`, vi: `bản ${form.vi}`, renumber: form.renumber, keywords: [form.footprint.toLowerCase()] });
}

const compact = <T>(list: (T | null)[]): T[] => list.filter((x): x is T => x !== null);

/** Package variants of a single op-amp or comparator (not one section of a dual / quad). */
export function amplifierVariants(base: LibraryPartDef): LibraryPartDef[] {
  const fp = base.footprint ?? '';
  // one amplifier of a 14-pin quad (LM339, LMV339 …) has no 8-pin or 5-pin version of its own
  if (/-(14|16)$/.test(fp)) return [];
  const codes = codesFor(base.name);
  const keys: PkgKey[] = fp.startsWith('DIP') ? ['soic8', 'tssop8'] : fp === 'SOT-23-5' || fp === 'SOT-23-6' ? ['soic8', 'sc70'] : ['dip8', 'msop8'];
  return compact(keys.map((k) => viaForm(base, base.name, k, codes)));
}

/** Package variants of the whole chip of a dual / quad op-amp. */
export function packageChipVariants(base: LibraryPartDef): LibraryPartDef[] {
  const pn = base.name.replace(/ \((dual|quad)\)$/, '');
  const keys: PkgKey[] = base.name.endsWith('(quad)') ? ['dip14', 'soic14', 'tssop14'] : ['dip8', 'soic8', 'tssop8'];
  const codes = codesFor(pn);
  return compact(keys.map((k) => viaForm(base, pn, k, codes)));
}

/** Second sources and packages of the fixed regulators 78xx / 79xx / 78Mxx / 78Lxx. */
export function fixedRegulatorVariants(base: LibraryPartDef): LibraryPartDef[] {
  const m = base.name.match(/^(78|79)(M|L)?(\d{2,3})$/);
  if (!m) return [];
  const [, series, size, volts] = m;
  const out: LibraryPartDef[] = [];
  const mk = (name: string, footprint: string, maker: string, renumber?: Record<string, string>): void => {
    const phrase = footprint === 'TO-220' ? 'TO-220 through-hole' : footprint === 'TO-263-3' ? 'TO-263 (D2PAK) surface-mount' : footprint === 'TO-252' ? 'TO-252 (DPAK) surface-mount' : footprint === 'SOT-89' ? 'SOT-89 surface-mount' : footprint === 'SOIC-8' ? 'SOIC-8 surface-mount' : 'TO-92 through-hole';
    const phraseVi = footprint === 'TO-220' ? 'TO-220 chân xuyên lỗ' : footprint === 'TO-263-3' ? 'TO-263 (D2PAK) dán' : footprint === 'TO-252' ? 'TO-252 (DPAK) dán' : footprint === 'SOT-89' ? 'SOT-89 dán' : footprint === 'SOIC-8' ? 'SOIC-8 dán' : 'TO-92 chân xuyên lỗ';
    out.push(repackage(base, { id: variantId(base, name), name, footprint, pkg: footprint, en: `the ${phrase} version, ${maker} order code`, vi: `bản ${phraseVi}, mã đặt hàng kiểu ${maker}`, renumber, keywords: [maker.toLowerCase()] }));
  };
  const v = volts;
  if (!size) {
    mk(`L${series}${v}CV`, 'TO-220', 'STMicroelectronics');
    mk(`L${series}${v}CD2T`, 'TO-263-3', 'STMicroelectronics');
    mk(`L${series}${v}CDT`, 'TO-252', 'STMicroelectronics');
    mk(`MC${series}${v}CT`, 'TO-220', 'onsemi');
    mk(`MC${series}${v}CD2T`, 'TO-263-3', 'onsemi');
    mk(`KA${series}${v}`, 'TO-220', 'Fairchild');
    mk(`LM${series}${v}CT`, 'TO-220', 'Texas Instruments');
    if (series === '78') mk(`TS${series}${v}CZ`, 'TO-220', 'Taiwan Semiconductor');
  } else if (size === 'M') {
    mk(`L${series}M${v}CV`, 'TO-220', 'STMicroelectronics');
    mk(`L${series}M${v}CDT`, 'TO-252', 'STMicroelectronics');
    mk(`MC${series}M${v}CT`, 'TO-220', 'onsemi');
    mk(`MC${series}M${v}CDT`, 'TO-252', 'onsemi');
  } else if (series === '78') {
    const real = { OUT: '1', GND: '2', IN: '3' };
    mk(`L78L${v}ACZ`, 'TO-92', 'STMicroelectronics', real);
    mk(`L78L${v}ACUTR`, 'SOT-89', 'STMicroelectronics', real);
    mk(`L78L${v}ACD`, 'SOIC-8', 'STMicroelectronics', { OUT: '1', GND: '2', IN: '8' });
    mk(`MC78L${v}ACP`, 'TO-92', 'onsemi', real);
    mk(`LM78L${v}ACZ`, 'TO-92', 'Texas Instruments', real);
  }
  return out;
}

/** Packages of the LM1117 / LD1117 family: the real GND(ADJ) – OUT – IN numbering in SOT-223, TO-220, TO-252, TO-263. */
export function ldo1117Variants(base: LibraryPartDef): LibraryPartDef[] {
  const m = base.name.match(/^(LM1117|LD1117)-(.+)$/);
  if (!m) return [];
  const [, family, v] = m;
  const lm = family === 'LM1117';
  const real = { [base.symbol.pins.some((p) => p.name === 'ADJ') ? 'ADJ' : 'GND']: '1', OUT: '2', IN: '3' };
  const list: [string, string, string][] = lm
    ? [
        [`LM1117MP-${v}`, 'SOT-223', 'SOT-223'],
        [`LM1117T-${v}`, 'TO-220', 'TO-220'],
        [`LM1117DT-${v}`, 'TO-252', 'TO-252'],
        [`LM1117S-${v}`, 'TO-263-3', 'TO-263'],
      ]
    : [
        [`LD1117S${v.replace('.', '')}`, 'SOT-223', 'SOT-223'],
        [`LD1117DT${v.replace('.', '')}`, 'TO-252', 'TO-252'],
        [`LD1117V${v.replace('.', '')}`, 'TO-220', 'TO-220'],
      ];
  return list.map(([name, footprint, label]) =>
    repackage(base, { id: variantId(base, name), name, footprint, pkg: footprint, en: `the ${label} version with the real GND / OUT / IN pin numbers`, vi: `bản vỏ ${label} với số chân đúng (GND / OUT / IN)`, renumber: real, keywords: [label.toLowerCase()] }),
  );
}

/** Packages and the second sources of the adjustable regulators LM317 / LM337. */
export function adjustableVariants(base: LibraryPartDef): LibraryPartDef[] {
  if (base.id !== 'power/lm317') return [];
  const list: [string, string, string][] = [
    ['LM317T', 'TO-220', 'TO-220'],
    ['LM317D2T', 'TO-263-3', 'TO-263'],
    ['LM317DT', 'TO-252', 'TO-252'],
    ['LM317EMP', 'SOT-223', 'SOT-223'],
    ['LM217T', 'TO-220', 'TO-220'],
    ['LM117K', 'TO-3', 'TO-3 metal can'],
  ];
  return list.map(([name, footprint, label]) => repackage(base, { id: variantId(base, name), name, footprint, pkg: footprint, en: `the ${label} version`, vi: `bản vỏ ${label}`, keywords: [label.toLowerCase()] }));
}

/** TO-220-5 / TO-263-5 versions of the LM257x / LM259x regulators. */
export function buckVariants(base: LibraryPartDef): LibraryPartDef[] {
  const m = base.name.match(/^(LM2596|LM2576|LM2575)(HV)?-(.+)$/);
  if (!m) return [];
  const [, fam, hv, v] = m;
  const isS = base.footprint === 'TO-263';
  const name = `${fam}${hv ?? ''}${isS ? 'T' : 'S'}-${v}`;
  const footprint = isS ? 'TO-220-5' : 'TO-263';
  return [repackage(base, { id: variantId(base, name), name, footprint, pkg: footprint, en: `the ${footprint === 'TO-263' ? 'TO-263 (D2PAK) surface-mount' : 'TO-220 5-lead'} version`, vi: `bản vỏ ${footprint === 'TO-263' ? 'TO-263 (D2PAK) dán' : 'TO-220 5 chân'}`, keywords: [footprint.toLowerCase()] })];
}

const isSection = (p: LibraryPartDef): boolean => p.pkg !== undefined;
const isOneSection = (p: LibraryPartDef): boolean => /one section of the (dual|quad)/.test(p.description);
const IDEAL = new Set(['analog/opamp', 'analog/opamp-ideal-3', 'analog/opamp-ideal-5', 'analog/comparator']);
const isChip = (p: LibraryPartDef): boolean => p.family === 'Op-amp' && / \((dual|quad)\)$/.test(p.name) && !isSection(p);

/** Every variant of the analog and power parts (core catalogue and the new bases). */
export function analogVariants(): LibraryPartDef[] {
  const all = [...(ALL_PARTS as LibraryPartDef[]), ...OPAMP_MORE, ...COMPARATOR_MORE, ...REFERENCE_MORE, ...REGULATOR_MORE];
  const out: LibraryPartDef[] = [];
  for (const p of all) {
    if (isSection(p) || p.variantOf || IDEAL.has(p.id)) continue;
    if (p.group === 'analog') {
      if (p.family === 'Op-amp') {
        if (isChip(p)) out.push(...packageChipVariants(p));
        else if (!isOneSection(p) && p.symbol.pins.some((x) => x.name === 'IN+')) out.push(...amplifierVariants(p));
      } else if (p.family === 'Comparator') out.push(...amplifierVariants(p));
    } else if (p.group === 'power') {
      out.push(...fixedRegulatorVariants(p), ...ldo1117Variants(p), ...adjustableVariants(p), ...buckVariants(p));
    }
  }
  return out;
}

/** Everything of the pack, in its two groups. */
export const ANALOG_MORE_CATALOG: LibraryPartDef[] = fresh([...OPAMP_MORE, ...COMPARATOR_MORE, ...REFERENCE_MORE, ...REGULATOR_MORE, ...analogVariants()]);
