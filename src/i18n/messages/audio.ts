/**
 * UI messages: sound (speaker, headphones, microphone, WAV files) — the menu label and the window
 * title the start-up code shows. The texts of the Audio window, the WAV import and the WAV export
 * load with their chunks (src/i18n/audioText.ts). [vi, en]
 */
import type { Catalogue } from '../types';

export default {
  'cmd.simulate.audio': ['Âm thanh (loa, micrô)…', 'Audio (speaker, microphone)…'],
  'audio.window.title': ['Âm thanh', 'Audio'],
} satisfies Catalogue;
