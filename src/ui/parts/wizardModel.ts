/**
 * Component wizard state and the part it builds (pure; the dialog is ComponentWizard.tsx).
 *
 * Steps: 0 information (name, group, family, prefix, database) · 1 symbol (template or drawn) ·
 * 2 pins (names, numbers, types) · 3 footprint and user fields · 4 simulation model (none, a library
 * part, pasted SPICE text, a model maker) · 5 pin mapping (model terminal -> symbol pin) · 6 test
 * simulation · 7 save.
 *
 *   newWizard(opts)                  a fresh state (optionally starting from a maker or SPICE text)
 *   wizardFromPart(data, db)         edit an existing user component (keeps its id)
 *   wizardFromPlaced(def, params)    "edit a placed part and save it as a new part"
 *   setTemplate / setModelSource / setSpice / setMaker / setBuiltin   state transitions
 *   modelTerminals(state)            terminal names of the chosen model (in SPICE order)
 *   buildPart(state, makerResult)    the CustomPartData to save
 *   stepIssues(state, step)          problem codes that block "Next" (i18n parts.issue.*)
 *   testDesign(part)                 a bias bench (every pin through 1 kΩ to a different voltage)
 */
import { getPart } from '../../library';
import { boxTemplate, cloneSymbol, templateInfo, templateSymbol, type SymbolTemplateId } from '../../library/custom/templates';
import { autoMapPins, findSubckt, modelTerminals as libTerminals, parseModelLibrary } from '../../library/custom/spiceModels';
import { customPartProblems, isCustomPartDef, subcktParamDefs, type CustomPartProblem } from '../../library/custom/partDef';
import { partFromLibrary, uniquePartId } from '../../library/custom/database';
import { isWebLink, type CustomPartData, type MakerId } from '../../library/custom/types';
import type { ParamDef, PartDef, PartGroup, SymbolDef } from '../../library/types';
import { getMaker, defaultMakerInput, importProvenance, makerProvenance, MOTOR_PART } from '../../library/modelmaker';
import type { MakerResult } from '../../library/modelmaker/types';
import { DesignBuilder } from '../../model/designkit';
import type { Design } from '../../model/types';
import { inlineIncludes } from './spiceImport';
import type { DbKind } from './partDatabases';

export const WIZARD_STEPS = ['info', 'symbol', 'pins', 'footprint', 'model', 'mapping', 'test', 'save'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export type ModelSource = 'none' | 'builtin' | 'spice' | 'maker';

export interface WizardState {
  step: number;
  /** id of the user component being edited (kept on save) */
  editingId?: string;
  /** placed instance to replace with the saved part */
  replaceInstance?: string;
  db: DbKind;
  name: string;
  description: string;
  group: PartGroup;
  family: string;
  prefix: string;
  footprint: string;
  /** datasheet / product page (http or https; blank = none) */
  hyperlink: string;
  keywords: string;
  fields: Record<string, string>;
  template: SymbolTemplateId | 'custom';
  boxLeft: number;
  boxRight: number;
  boxTitle: string;
  symbol: SymbolDef;
  source: ModelSource;
  builtinId: string;
  builtinParams: Record<string, string>;
  spiceText: string;
  spiceName: string;
  /** included files resolved for the SPICE text (normalised path -> text) */
  spiceFiles: [string, string][];
  makerId: MakerId;
  makerInput: Record<string, string>;
  /** symbol pin for each model terminal (spice / maker models) */
  pinMap: string[];
  /** library pin -> symbol pin (built-in models) */
  builtinMap: Record<string, string>;
  /** subcircuit parameters offered in Properties */
  params: ParamDef[];
  /** LED colour when the component glows */
  ledColor: string;
  provenance?: string;
}

function base(db: DbKind): WizardState {
  const tpl = templateInfo('box');
  return {
    step: 0,
    db,
    name: '',
    description: '',
    group: tpl.group,
    family: tpl.family,
    prefix: tpl.prefix,
    footprint: '',
    hyperlink: '',
    keywords: '',
    fields: {},
    template: 'box',
    boxLeft: 2,
    boxRight: 2,
    boxTitle: '',
    symbol: boxTemplate(2, 2),
    source: 'none',
    builtinId: '',
    builtinParams: {},
    spiceText: '',
    spiceName: '',
    spiceFiles: [],
    makerId: 'diode',
    makerInput: defaultMakerInput(getMaker('diode')),
    pinMap: [],
    builtinMap: {},
    params: [],
    ledColor: 'red',
  };
}

/** A fresh wizard; `maker` starts at the model step's maker with its template, `spice` with pasted text. */
export function newWizard(opts: { db?: DbKind; maker?: MakerId; spice?: { text: string; name: string; files?: [string, string][] } } = {}): WizardState {
  let s = base(opts.db ?? 'user');
  if (opts.maker) {
    s = setMaker(s, opts.maker);
    s = setTemplate(s, getMaker(opts.maker).template);
    s = { ...s, source: 'maker' };
  }
  if (opts.spice) {
    s = setSpice(s, opts.spice.text, opts.spice.name, opts.spice.files ?? []);
    const t = guessTemplate(s);
    if (t) s = setTemplate(s, t);
    s = { ...s, source: 'spice', name: opts.spice.name };
  }
  return autoMap(s);
}

/** Template that fits a SPICE model: diode / transistor symbols for device models, an IC box for subcircuits. */
export function guessTemplate(s: WizardState): SymbolTemplateId | undefined {
  const lib = parseModelLibrary(s.spiceText, { files: new Map(s.spiceFiles) });
  const card = lib.models.find((m) => m.name.toLowerCase() === s.spiceName.toLowerCase());
  if (card) {
    const map: Record<string, SymbolTemplateId> = { D: 'diode', NPN: 'npn', PNP: 'pnp', NMOS: 'nmos', PMOS: 'pmos', NJF: 'njfet', PJF: 'pjfet' };
    return map[card.type.toUpperCase()];
  }
  const sub = findSubckt(lib, s.spiceName);
  if (sub) {
    if (sub.ports.length === 5) return 'opamp';
    return 'box';
  }
  return undefined;
}

export function wizardFromPart(data: CustomPartData, db: DbKind, opts: { keepId?: boolean } = { keepId: true }): WizardState {
  const s: WizardState = {
    ...base(db),
    ...(opts.keepId !== false ? { editingId: data.id } : {}),
    name: data.name,
    description: data.description,
    group: data.group,
    family: data.family,
    prefix: data.prefix,
    footprint: data.footprint ?? '',
    hyperlink: data.hyperlink ?? '',
    keywords: (data.keywords ?? []).join(', '),
    fields: { ...(data.fields ?? {}) },
    template: 'custom',
    symbol: cloneSymbol(data.symbol),
    params: data.params ? [...data.params] : [],
    ledColor: data.indicator?.color ?? 'red',
    ...(data.provenance ? { provenance: data.provenance } : {}),
  };
  const m = data.model;
  if (m.kind === 'builtin') {
    if (m.maker) return { ...s, source: 'maker', makerId: m.maker.id, makerInput: { ...defaultMakerInput(getMaker(m.maker.id)), ...m.maker.input }, builtinMap: { ...m.pinMap }, pinMap: getMaker(m.maker.id).terminals.map((t) => m.pinMap[t] ?? '') };
    return { ...s, source: 'builtin', builtinId: m.partId, builtinMap: { ...m.pinMap }, builtinParams: { ...(m.params ?? {}) } };
  }
  if (m.kind === 'spice') {
    if (m.maker) return { ...s, source: 'maker', makerId: m.maker.id, makerInput: { ...defaultMakerInput(getMaker(m.maker.id)), ...m.maker.input }, pinMap: [...m.pins] };
    return { ...s, source: 'spice', spiceText: m.text, spiceName: m.name, pinMap: [...m.pins] };
  }
  return s;
}

/** Start from a placed part: a library part is reused (its parameter values become defaults); a user component is copied. */
export function wizardFromPlaced(def: PartDef, params: Record<string, string>, instanceId: string, db: DbKind = 'user'): WizardState {
  const data = isCustomPartDef(def) ? def.custom : partFromLibrary(def, { params });
  const s = wizardFromPart(data, db, { keepId: false });
  return { ...s, replaceInstance: instanceId };
}

// ---------------------------------------------------------------------------------------------
// transitions

export function setTemplate(s: WizardState, id: SymbolTemplateId, opts: { left?: number; right?: number; title?: string } = {}): WizardState {
  const prev = s.template === 'custom' ? undefined : templateInfo(s.template);
  const next = templateInfo(id);
  const left = opts.left ?? s.boxLeft;
  const right = opts.right ?? s.boxRight;
  const title = opts.title ?? s.boxTitle;
  const symbol = id === 'box' ? boxTemplate(left, right, title) : templateSymbol(id);
  // follow the template's prefix / group / family unless the user changed them
  const follow = (cur: string, old: string | undefined, nu: string) => (!cur || cur === old ? nu : cur);
  return autoMap({
    ...s,
    template: id,
    boxLeft: left,
    boxRight: right,
    boxTitle: title,
    symbol,
    prefix: follow(s.prefix, prev?.prefix, next.prefix),
    group: (follow(s.group, prev?.group, next.group) as PartGroup),
    family: follow(s.family, prev?.family, next.family),
  });
}

export function setSymbol(s: WizardState, symbol: SymbolDef): WizardState {
  return autoMap({ ...s, template: 'custom', symbol });
}

export function setModelSource(s: WizardState, source: ModelSource): WizardState {
  return autoMap({ ...s, source });
}

export function setSpice(s: WizardState, text: string, name: string, files: [string, string][] = s.spiceFiles): WizardState {
  const lib = parseModelLibrary(text, { files: new Map(files) });
  const names = [...lib.subckts.map((x) => x.name), ...lib.models.map((m) => m.name)];
  const chosen = names.find((n) => n.toLowerCase() === name.toLowerCase()) ?? names[0] ?? name;
  const sub = findSubckt(lib, chosen);
  return autoMap({ ...s, spiceText: text, spiceName: chosen, spiceFiles: files, params: sub ? subcktParamDefs(sub.params) : [] });
}

export function setMaker(s: WizardState, id: MakerId): WizardState {
  return autoMap({ ...s, makerId: id, makerInput: s.makerId === id ? s.makerInput : defaultMakerInput(getMaker(id)) });
}

export function setBuiltin(s: WizardState, partId: string): WizardState {
  return autoMap({ ...s, builtinId: partId, builtinParams: {}, builtinMap: {} });
}

/** Terminal names of the chosen model, in SPICE order (built-in: the library part's pins). */
export function modelTerminals(s: WizardState): string[] {
  switch (s.source) {
    case 'spice':
      return libTerminals(parseModelLibrary(s.spiceText, { files: new Map(s.spiceFiles) }), s.spiceName) ?? [];
    case 'maker':
      return [...getMaker(s.makerId).terminals];
    case 'builtin':
      return getPart(s.builtinId)?.symbol.pins.map((p) => p.name) ?? [];
    default:
      return [];
  }
}

/** Fill unmapped terminals by name / synonym / order (keeps the user's choices when still valid). */
export function autoMap(s: WizardState): WizardState {
  const pins = s.symbol.pins.map((p) => p.name);
  const terms = modelTerminals(s);
  const auto = autoMapPins(terms, pins);
  if (s.source === 'builtin' || (s.source === 'maker' && getMaker(s.makerId).id === 'acmotor')) {
    const map: Record<string, string> = {};
    terms.forEach((t, i) => (map[t] = pins.includes(s.builtinMap[t] ?? '') ? s.builtinMap[t] : auto[i]));
    return { ...s, builtinMap: map, pinMap: terms.map((t) => map[t]) };
  }
  const pinMap = terms.map((_t, i) => (pins.includes(s.pinMap[i] ?? '') ? s.pinMap[i] : auto[i]));
  return { ...s, pinMap };
}

export function setMapping(s: WizardState, index: number, pin: string): WizardState {
  const terms = modelTerminals(s);
  const pinMap = terms.map((_t, i) => (i === index ? pin : (s.pinMap[i] ?? '')));
  if (s.source === 'builtin' || (s.source === 'maker' && s.makerId === 'acmotor')) {
    const builtinMap = { ...s.builtinMap, [terms[index]]: pin };
    return { ...s, pinMap, builtinMap };
  }
  return { ...s, pinMap };
}

// ---------------------------------------------------------------------------------------------
// building

/** SPICE model name derived from a part name: letters, digits and _; starts with a letter. */
export function modelNameFor(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'D')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return /^[A-Z]/.test(s) ? s.slice(0, 40) : `M_${s}`.slice(0, 40);
}

/** The user component described by the wizard (`maker` = the fitted model when the source is a maker). */
export function buildPart(s: WizardState, maker: MakerResult | undefined, taken: ReadonlySet<string>): CustomPartData {
  const id = s.editingId ?? uniquePartId(s.name || 'part', taken);
  const keywords = s.keywords
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const part: CustomPartData = {
    id,
    name: s.name.trim(),
    group: s.group,
    family: s.family.trim() || 'User',
    description: s.description.trim(),
    prefix: s.prefix.trim().toUpperCase() || 'U',
    symbol: s.symbol,
    model: { kind: 'none' },
  };
  if (s.footprint.trim()) part.footprint = s.footprint.trim();
  if (s.hyperlink.trim() && isWebLink(s.hyperlink)) part.hyperlink = s.hyperlink.trim();
  if (keywords.length) part.keywords = keywords;
  const fields = Object.fromEntries(Object.entries(s.fields).filter(([, v]) => v.trim() !== ''));
  if (Object.keys(fields).length) part.fields = fields;
  switch (s.source) {
    case 'builtin': {
      const def = getPart(s.builtinId);
      part.model = { kind: 'builtin', partId: s.builtinId, pinMap: { ...s.builtinMap }, ...(Object.keys(s.builtinParams).length ? { params: { ...s.builtinParams } } : {}) };
      if (def?.provenance) part.provenance = def.provenance;
      break;
    }
    case 'spice': {
      const text = s.spiceFiles.length ? inlineIncludes(s.spiceText, new Map(s.spiceFiles)) : s.spiceText;
      part.model = { kind: 'spice', text, name: s.spiceName, pins: [...s.pinMap] };
      if (s.params.length) part.params = s.params;
      part.provenance = importProvenance(s.spiceName);
      break;
    }
    case 'maker': {
      if (!maker) break;
      const ref = { id: s.makerId, input: { ...s.makerInput } };
      part.provenance = makerProvenance(s.makerId, s.makerInput);
      if (maker.model.kind === 'spice') part.model = { kind: 'spice', text: maker.model.text, name: maker.model.name, pins: [...s.pinMap], maker: ref };
      else part.model = { kind: 'builtin', partId: maker.model.partId, pinMap: { ...s.builtinMap }, params: { ...maker.model.params }, maker: ref };
      break;
    }
    default:
      break;
  }
  if (s.template === 'led' || (s.symbol.pins.length === 2 && s.prefix.toUpperCase() === 'LED')) {
    if (part.model.kind === 'spice') part.indicator = { kind: 'led', color: s.ledColor };
  }
  return part;
}

export type WizardIssue = { code: string; params?: Record<string, string | number> };

/** What blocks leaving a step (empty = fine). */
export function stepIssues(s: WizardState, step: WizardStep, part?: CustomPartData, maker?: MakerResult): WizardIssue[] {
  switch (step) {
    case 'info':
      return [...(s.name.trim() ? [] : [{ code: 'noName' }]), ...(s.prefix.trim() ? [] : [{ code: 'noPrefix' }])];
    case 'symbol':
    case 'pins': {
      const out: WizardIssue[] = [];
      if (s.symbol.pins.length === 0) out.push({ code: 'noPins' });
      const seen = new Set<string>();
      for (const p of s.symbol.pins) {
        if (!p.name.trim()) out.push({ code: 'emptyPinName' });
        else if (seen.has(p.name)) out.push({ code: 'duplicatePin', params: { pin: p.name } });
        seen.add(p.name);
      }
      return out;
    }
    case 'footprint':
      return s.hyperlink.trim() && !isWebLink(s.hyperlink) ? [{ code: 'badHyperlink' }] : [];
    case 'model':
      if (s.source === 'builtin' && !getPart(s.builtinId)) return [{ code: 'chooseBuiltin' }];
      if (s.source === 'spice' && modelTerminals(s).length === 0) return [{ code: 'chooseSpice' }];
      if (s.source === 'maker' && !maker) return [{ code: 'runMaker' }];
      return [];
    case 'mapping': {
      const terms = modelTerminals(s);
      const out: WizardIssue[] = [];
      const used = new Set<string>();
      terms.forEach((t, i) => {
        const pin = s.pinMap[i] ?? '';
        const optionalBulk = s.source === 'spice' && terms.length === 4 && i === 3;
        if (!pin && !optionalBulk) out.push({ code: 'terminalUnmapped', params: { terminal: t } });
        else if (pin && used.has(pin)) out.push({ code: 'pinUsedTwice', params: { pin } });
        if (pin) used.add(pin);
      });
      return out;
    }
    case 'save':
      return part ? customPartProblems(part).map((p: CustomPartProblem) => ({ code: p.code, ...(p.params ? { params: p.params } : {}) })) : [{ code: 'notBuilt' }];
    default:
      return [];
  }
}

/** Bias bench of a component: pin k of n through 1 kΩ to (n − k) V; supply pins 12 V / 0 V through 1 Ω. */
export function testDesign(part: CustomPartData): Design {
  const b = new DesignBuilder(part.name);
  b.design.customParts = [part];
  const h = b.part(part.id, `${part.prefix}1`, 0, 0);
  const n = part.symbol.pins.length;
  part.symbol.pins.forEach((pin, i) => {
    b.labelPin(h, pin.name, `P${i}`);
    const supply = pin.type === 'power' && /^(V\+|VCC|VDD|VIN|VP|VS\+?)$/i.test(pin.name) ? 12 : pin.type === 'power' && /^(V-|VEE|VSS|GND|VN|VS-)$/i.test(pin.name) ? 0 : null;
    const r = b.part('basic/resistor', `RB${i}`, 2000 + i * 300, 1000, { value: supply !== null ? '1' : '1k' });
    b.labelPin(r, '1', `P${i}`);
    const v = b.part('sources/dc-voltage', `VB${i}`, 2000 + i * 300 + 100, 1200, { value: String(supply ?? n - i) });
    const g = b.part('sources/ground', `GB${i}`, 2000 + i * 300 + 200, 1400);
    b.connect(r, '2', v, '+');
    b.connect(v, '-', g, '1');
  });
  return b.design;
}

/** Whether a maker produces a built-in part model (pin map by library pin names). */
export function makerUsesBuiltin(id: MakerId): boolean {
  return id === 'acmotor';
}

export { MOTOR_PART };
