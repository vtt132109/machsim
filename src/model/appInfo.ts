/**
 * Product name and version, shared by the UI (About dialog) and the file writers that record
 * which program saved a file (Design.meta.savedBy, snippets, XML exchange files).
 * Keep APP_VERSION equal to the version in package.json / desktop/package.json.
 */
export const APP_NAME = 'MachSim';
export const APP_VERSION = '0.1.0';

/** "MachSim 0.1.0": the `savedBy` text written into files. */
export const SAVED_BY = `${APP_NAME} ${APP_VERSION}`;
