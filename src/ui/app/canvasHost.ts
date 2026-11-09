/**
 * Connects the canvas interaction controller to the shell: text prompts, properties dialogs,
 * instrument windows (PartDef.instrument → the floating window kind registered for it, opened
 * with { refdes }), the canvas context menu and the "is simulating" query used by interactive
 * parts; also the file actions of the Properties panel (save a block as a file, replace a
 * picture, replace component, replace by subcircuit).
 */
import type { InstrumentKind } from '../../model/types';
import { actions, getState, partLookup } from '../store';
import { findItem } from '../store/designOps';
import { activeViewPath } from '../store/editorStore';
import type { HitResult } from '../store/hitTest';
import type { Design, PartInstance, Wire } from '../../model/types';
import { promptText } from '../common/dialogs';
import { openContextMenu, type MenuEntry } from '../common/Menu';
import { beginnerEntries } from './beginner';
import { interaction } from '../editor/controller';
import { hasCommand, isSimulationActive, openFloatingWindow, runCommand } from './extensions';
import { openPropertiesDialog } from './appDialogs';
import { isBlockPartId } from '../../model/hierarchy';
import { findSheet } from '../../model/hierarchy';
import { setPropertiesHost } from '../editor/PropertiesPanel';
/** Schematic dialogs load on first use (kept out of the start-up bundle). */
const dialogs = () => import('./schematicDialogs');
/** ERC options / NC markers / net settings / capture (lazy chunk) */
const schematicTools = () => import('../schematicTools/flows');
import { shortcutLabel } from './shortcuts';
import { t, type MessageKey } from '../../i18n';
import { libText } from '../../i18n/library';
import { controlKeys } from '../store/interactive';
import { activeVariant, isFitted, setFitted } from '../../model/variants';

const WIRE_COLORS: { name: MessageKey; value: string | undefined }[] = [
  { name: 'color.default', value: undefined },
  { name: 'color.blue', value: '#1a4fd6' },
  { name: 'color.red', value: '#c62828' },
  { name: 'color.green', value: '#2e7d32' },
  { name: 'color.orange', value: '#e8590c' },
  { name: 'color.violet', value: '#6741d9' },
  { name: 'color.black', value: '#1d2330' },
];

type MenuItem = Extract<MenuEntry, { onSelect: () => void }>;

/**
 * A context-menu entry that runs a command. The `id` matters: it is what beginner mode filters on
 * (`beginnerEntries`, src/ui/app/beginner.ts), so an entry without one would show a command the
 * menu bar hides.
 */
function cmd(id: string, label: string, enabled = true): MenuItem {
  return { id, label, shortcut: shortcutLabel(id), disabled: !enabled || !hasCommand(id), onSelect: () => runCommand(id) };
}

/** Open the floating window registered for an instrument kind. */
export function openInstrumentWindow(refdes: string, kind: InstrumentKind): string {
  // an instrument inside an opened block is named by the copy the learner looks at ("X2.XMM1")
  const view = activeViewPath(getState());
  return openFloatingWindow(kind, { refdes: view.length ? [...view, refdes].join('.') : refdes });
}

/** Entries of the canvas context menu for what was right-clicked. */
/** "Fitted in variant <active>" toggle of a part's context menu (only when the design has variants). */
function variantEntry(design: Design, inst: PartInstance): MenuEntry[] {
  const v = activeVariant(design);
  if (!v) return [];
  const fitted = isFitted(inst, v.id);
  return [{ label: t('variant.toggleFitted', { variant: v.name }), checked: fitted, onSelect: () => actions.applyDesign((d) => setFitted(d, [inst.id], v.id, !fitted)) }];
}

export function canvasMenuEntries(hit: HitResult | null): MenuEntry[] {
  const s = getState();
  const hasSel = s.selection.length > 0;
  const editing: MenuEntry[] = [
    cmd('edit.cut', t('app.canvasHost.cut'), hasSel),
    cmd('edit.copy', t('common.copy'), hasSel),
    cmd('edit.duplicate', t('app.canvasHost.duplicate'), hasSel),
    cmd('edit.delete', t('common.delete'), hasSel),
  ];
  const transform: MenuEntry[] = [
    cmd('edit.rotateCw', t('app.canvasHost.rotate90Clockwise'), hasSel),
    cmd('edit.rotateCcw', t('app.canvasHost.rotate90CounterClockwise'), hasSel),
    cmd('edit.flipH', t('app.canvasHost.flipHorizontally'), hasSel),
    cmd('edit.flipV', t('app.canvasHost.flipVertically'), hasSel),
  ];
  if (!hit) {
    return [
      cmd('edit.paste', t('app.canvasHost.pasteHere'), s.clipboardAvailable),
      cmd('edit.selectAll', t('app.canvasHost.selectAll')),
      { type: 'separator' },
      cmd('place.component', t('app.canvasHost.placeComponent')),
      cmd('place.wire', t('app.canvasHost.wire')),
      cmd('place.label', t('app.canvasHost.netLabel')),
      cmd('place.text', t('app.canvasHost.textNote')),
      cmd('place.probe.voltage', t('app.canvasHost.voltageProbe')),
      cmd('place.bus', t('cmd.place.bus')),
      cmd('place.offpage', t('cmd.place.offpage')),
      cmd('place.comment', t('cmd.place.comment')),
      ...(findSheet(s.design, s.activeSheetId)?.child ? [{ type: 'separator' } as MenuEntry, cmd('view.parentSheet', t('cmd.view.parentSheet'))] : []),
      { type: 'separator' },
      cmd('view.fitAll', t('app.canvasHost.fitSheet')),
      { ...cmd('view.grid', t('app.canvasHost.grid')), checked: s.showGrid },
      cmd('options.sheetProperties', t('app.canvasHost.sheetProperties')),
    ];
  }
  if (hit.kind === 'part' || hit.kind === 'partLabel' || hit.kind === 'pin') {
    const id = hit.kind === 'pin' ? hit.partId : hit.id;
    const inst = findItem(s.design, 'part', id)?.item as PartInstance | undefined;
    const def = inst ? partLookup(inst.partId) : undefined;
    const extra: MenuEntry[] = [];
    if (inst && def?.instrument) {
      const kind = def.instrument;
      extra.push({ id: 'view.instruments', label: t('app.canvasHost.openInstrumentPanel'), onSelect: () => openInstrumentWindow(inst.refdes, kind) });
    }
    if (inst && (def as { mcu?: unknown } | undefined)?.mcu) {
      extra.push({ id: 'simulate.mcuEditor', label: t('cmd.simulate.mcuEditor'), onSelect: () => openFloatingWindow('mcu', { refdes: inst.refdes }) });
    }
    if (inst && isBlockPartId(inst.partId)) {
      extra.push({ id: 'view.openBlock', label: t('cmd.view.openBlock'), onSelect: () => actions.openBlock(inst.id) });
      extra.push({ id: 'place.saveBlock', label: t('schematic.prop.saveBlock'), onSelect: () => void dialogs().then((m) => m.saveChildAsFile(inst.partId.slice('hier:'.length))) });
    } else if (inst && def && def.globalNet === undefined) {
      extra.push({ id: 'edit.replaceComponent', label: t('cmd.edit.replaceComponent'), onSelect: () => void dialogs().then((m) => m.openReplacePartDialog(inst.id)) });
    }
    if (s.selection.some((x) => x.kind === 'part')) extra.push({ id: 'place.replaceBySubcircuit', label: t('cmd.place.replaceBySubcircuit'), onSelect: () => void dialogs().then((m) => m.replaceBySubcircuitFlow()) });
    if (inst && def && def.globalNet === undefined && !isBlockPartId(inst.partId)) {
      extra.push({ id: 'edit.ncMarker', label: t('cmd.edit.ncMarker'), onSelect: () => void schematicTools().then((m) => m.openNcMarkerDialog(inst.id)) });
    }
    if (inst && def?.interactive?.controls?.length) {
      // multi-control parts (DIP switch, keypad): one entry per control
      const idef = def.interactive;
      const keys = controlKeys(idef, inst.params);
      (idef.controls ?? []).forEach((c, i) => {
        const key = keys[i];
        const label = `${libText(idef.label)} ${c.label}`;
        extra.push({
          label: key ? t('app.canvasHost.interactiveKey', { label, key }) : label,
          onSelect: () => actions.interact(inst.refdes, idef.kind === 'slider' ? 'increase' : 'click', i),
        });
      });
    } else if (inst && def?.interactive) {
      const idef = def.interactive;
      extra.push({
        label: idef.key ? t('app.canvasHost.interactiveKey', { label: libText(idef.label), key: idef.key }) : libText(idef.label),
        onSelect: () => actions.interact(inst.refdes, idef.kind === 'slider' ? 'increase' : 'click'),
      });
      if (idef.kind === 'slider') extra.push({ label: t('app.canvasHost.decreaseSetting'), onSelect: () => actions.interact(inst.refdes, 'decrease') });
    }
    return [
      { label: t('app.canvasHost.properties'), shortcut: 'Alt+Enter', disabled: !inst, onSelect: () => inst && openPropertiesDialog({ kind: 'part', id: inst.id }) },
      ...(extra.length ? [{ type: 'separator' } as MenuEntry, ...extra] : []),
      { type: 'separator' },
      ...editing,
      { type: 'separator' },
      ...transform,
      ...(inst
        ? [
            { type: 'separator' } as MenuEntry,
            {
              label: inst.excludeFromSim ? t('app.canvasHost.includeInSimulation') : t('app.canvasHost.excludeFromSimulation'),
              onSelect: () => actions.updatePart(inst.id, { excludeFromSim: inst.excludeFromSim ? undefined : true }),
            },
            ...variantEntry(s.design, inst),
          ]
        : []),
    ];
  }
  if (hit.kind === 'wire') {
    const wire = findItem(s.design, 'wire', hit.id)?.item as Wire | undefined;
    if (wire?.bus) {
      return [
        {
          label: t('schematic.ctx.renameBus'),
          onSelect: async () => {
            const name = await promptText({ title: t('schematic.ctx.renameBus'), label: t('schematic.prop.busName'), initial: wire.busName ?? '' });
            if (name !== null) actions.renameBus(wire.id, name);
          },
        },
        { label: t('schematic.ctx.busEntryHere'), onSelect: () => actions.setTool({ kind: 'label', labelKind: 'bus-entry' }) },
        { type: 'separator' },
        ...editing,
      ];
    }
    return [
      {
        type: 'submenu',
        label: t('app.canvasHost.wireColour'),
        items: WIRE_COLORS.map((c) => ({ label: t(c.name), checked: (wire?.color ?? undefined) === c.value, onSelect: () => actions.updateWire(hit.id, { color: c.value }) })),
      },
      {
        label: t('app.canvasHost.addNetLabelHere'),
        onSelect: async () => {
          const name = await promptText({ title: t('app.canvasHost.placeNetLabel'), label: t('common.netName'), validate: (v) => (v.trim() && !/\s/.test(v.trim()) ? null : t('app.canvasHost.enterANameWithoutSpaces')) });
          if (name) actions.addNetLabel({ x: hit.x, y: hit.y }, name.trim());
        },
      },
      { label: t('app.canvasHost.addVoltageProbeHere'), onSelect: () => actions.addProbe('voltage', { x: hit.x, y: hit.y }) },
      {
        id: 'tools.netSettings',
        label: t('cmd.tools.netSettings'),
        onSelect: () => {
          actions.select([{ kind: 'wire', id: hit.id }]);
          void schematicTools().then((m) => m.openNetSettingsDialog());
        },
      },
      { type: 'separator' },
      ...editing,
    ];
  }
  return [{ label: t('app.canvasHost.properties'), shortcut: 'Alt+Enter', onSelect: () => openPropertiesDialog({ kind: hit.kind, id: hit.id }) }, { type: 'separator' }, ...editing, { type: 'separator' }, ...transform];
}

/** Install the shell host into the canvas interaction controller. */
export function installCanvasHost(): void {
  interaction.setHost({
    promptText,
    openPartProperties: (partId) => openPropertiesDialog({ kind: 'part', id: partId }),
    openInstrument: (refdes, kind) => {
      openInstrumentWindow(refdes, kind);
    },
    openMcuEditor: (refdes) => {
      openFloatingWindow('mcu', { refdes });
    },
    editItem: (item) => openPropertiesDialog(item),
    // beginner mode is a filter on the whole interface: a command the menu bar hides must not
    // come back on the right-click menu either (src/ui/app/beginner.ts)
    contextMenu: (hit, x, y) => openContextMenu(beginnerEntries(canvasMenuEntries(hit), getState().ui.beginner === true), x, y),
    isSimulating: () => isSimulationActive(),
    pickImage: async () => (await dialogs()).pickImageDataUrl(),
    captureArea: (rect) => {
      actions.cancelTool();
      void schematicTools().then((m) => m.captureAreaFlow(rect));
    },
  });
  setPropertiesHost({
    saveChildAsFile: (id) => void dialogs().then((m) => m.saveChildAsFile(id)),
    replaceImage: (id) => void dialogs().then((m) => m.replacePictureFlow(id)),
    replaceBySubcircuit: () => void dialogs().then((m) => m.replaceBySubcircuitFlow()),
    replacePart: (id) => void dialogs().then((m) => m.openReplacePartDialog(id)),
  });
}
