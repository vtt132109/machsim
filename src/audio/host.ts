/**
 * Starts the audio of one interactive run (loaded on demand by the simulation controller, so the
 * Web Audio code stays out of the start-up chunk): finds the speakers in the netlist build and the
 * microphone parts in the design, opens the sound card lazily and the input device on the first
 * microphone, and returns the AudioRun the controller feeds with every streamed chunk.
 */
import type { NetlistBuildEx } from '../model/netlister';
import type { Design } from '../model/types';
import { defaultParams, getPart } from '../library';
import { openInput } from './input';
import { AudioRun, microphonesOf, speakerSettings, speakersOf, type AudioSink, type MicPart, type ParamEditLike } from './monitor';
import { createWebAudioSink } from './webAudioSink';

export const MICROPHONE_PART_ID = 'sources/microphone';

/** The sound card and the input device; tests replace them with fakes. */
export const audioBackend: { sink: () => AudioSink | null; openInput: (part: MicPart) => ReturnType<typeof openInput> } = {
  sink: () => createWebAudioSink(),
  openInput: (part) => openInput(part),
};

/** True when the design has a part that streams live input (the microphone). */
export function hasLiveInput(design: Design): boolean {
  return design.sheets.some((s) => s.parts.some((p) => !p.excludeFromSim && p.partId === MICROPHONE_PART_ID));
}

/** True when a run of this build / design has anything to play or to feed. */
export function needsAudio(build: Pick<NetlistBuildEx, 'indicators'>, design: Design): boolean {
  return build.indicators.some((b) => b.kind === 'speaker') || hasLiveInput(design);
}

/** Start the audio of a run; null when the design has neither a speaker nor a live microphone. */
export function startAudioRun(build: Pick<NetlistBuildEx, 'indicators'>, design: Design, currentDesign: () => Design, applyEdits: (edits: ParamEditLike[]) => void): AudioRun | null {
  const speakers = speakersOf(build.indicators);
  const micDef = getPart(MICROPHONE_PART_ID);
  const micDefaults = micDef ? defaultParams(micDef) : {};
  const mics = microphonesOf(design, (id) => id === MICROPHONE_PART_ID, micDefaults);
  if (!speakers.length && !mics.length) return null;
  return new AudioRun(
    build.indicators,
    mics,
    {
      sink: () => audioBackend.sink(),
      settings: (refdes) => {
        const d = currentDesign();
        const inst = d.sheets.flatMap((s) => s.parts).find((p) => p.refdes.toUpperCase() === refdes.toUpperCase());
        const def = inst ? getPart(inst.partId) : undefined;
        return speakerSettings(d, refdes, def ? defaultParams(def) : {});
      },
      openInput: (part) => audioBackend.openInput(part),
    },
    applyEdits,
  );
}
