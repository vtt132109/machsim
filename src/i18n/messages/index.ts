/**
 * The merged message catalogue. Each section file maps dotted keys to [vi, en] pairs; sections
 * are split by UI area so translators can work on one screen at a time.
 */
import analysis from './analysis';
import app from './app';
import audio from './audio';
import beginner from './beginner';
import catalog from './catalog';
import common from './common';
import digital from './digital';
import documents from './documents';
import editor from './editor';
import erc from './erc';
import files from './files';
import help from './help';
import instruments from './instruments';
import integration from './integration';
import ladder from './ladder';
import learn from './learn';
import library from './library';
import mcu from './mcu';
import parts from './parts';
import placement from './placement';
import results from './results';
import schematic from './schematic';
import schematicTools from './schematicTools';
import shell from './shell';
import sim from './sim';
import simtools from './simtools';
import store from './store';
import tips from './tips';
import wizards from './wizards';

/** Every section, by name (the i18n tests check each one for duplicates and placeholder parity). */
export const SECTIONS = { analysis, app, audio, beginner, catalog, common, digital, documents, editor, erc, files, help, instruments, integration, ladder, learn, library, mcu, parts, placement, results, schematic, schematicTools, shell, sim, simtools, store, tips, wizards } as const;

export const MESSAGES = { ...analysis, ...app, ...audio, ...beginner, ...catalog, ...common, ...digital, ...documents, ...editor, ...erc, ...files, ...help, ...instruments, ...integration, ...ladder, ...learn, ...library, ...mcu, ...parts, ...placement, ...results, ...schematic, ...schematicTools, ...shell, ...sim, ...simtools, ...store, ...tips, ...wizards } as const;
