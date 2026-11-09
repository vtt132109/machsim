/**
 * Renderer-side types for the desktop (Electron) bridge exposed by desktop/preload.cjs.
 * In a plain browser `getDesktopBridge()` returns undefined and callers fall back to web APIs.
 */

export interface DesktopFile {
  path: string;
  name: string;
  /** UTF-8 text of the file ('' for binary files, see base64) */
  content: string;
  /** binary files (snippet pictures .png, closed formats): the bytes as base64 */
  base64?: string;
}

/** File-system facts of an opened file (File > File information). */
export interface DesktopFileStat {
  size: number;
  /** ISO 8601 times */
  created: string;
  modified: string;
}

/** Page options the desktop shell needs to print the print-only pages (src/ui/print). */
/** What the desktop shell read from the system clipboard (binary data as base64). */
export interface DesktopClipboardContent {
  formats: string[];
  /** the private format, when present */
  privateData?: string;
  html?: string;
  /** the picture, re-encoded as PNG */
  png?: string;
  text?: string;
}

export interface DesktopPrintOptions {
  /** paper size in millimetres, as printed (landscape already applied) */
  widthMm: number;
  heightMm: number;
  landscape: boolean;
  /** false = print in black and white */
  color: boolean;
}

export interface DesktopSaved {
  path: string;
  name: string;
}

export interface MachsimDesktopBridge {
  readonly isDesktop: true;
  readonly platform: string;
  openFile(opts?: { title?: string; spice?: boolean }): Promise<DesktopFile | null>;
  saveFileAs(
    content: string,
    opts?: { title?: string; suggestedName?: string; extension?: string; filterName?: string },
  ): Promise<DesktopSaved | null>;
  /**
   * Overwrite a file previously opened or chosen by the user. `opts.backups` > 0 keeps that many
   * older versions next to it (name.msim.bak, name.msim.bak2 …); older desktop builds ignore it.
   */
  writeFile(path: string, content: string, opts?: { backups?: number }): Promise<DesktopSaved>;
  exportFile(opts: {
    title?: string;
    suggestedName?: string;
    filters?: { name: string; extensions: string[] }[];
    text?: string;
    base64?: string;
  }): Promise<DesktopSaved | null>;
  recentFiles(): Promise<string[]>;
  openRecent(path: string): Promise<DesktopFile>;
  setDirty(value: boolean): void;
  setTitle(title: string): void;
  info(): Promise<{ version: string; electron: string; platform: string; userData: string }>;
  onOpenFile(callback: (file: DesktopFile) => void): () => void;
  /**
   * UI language for the native dialogs of the desktop shell ('vi' | 'en'). Optional: older
   * desktop builds do not have it.
   */
  setLanguage?(lang: 'vi' | 'en'): void;

  // ---- document tabs and printing (optional: older desktop builds lack them)
  /** Names of the documents with unsaved changes; the shell lists them if it has to ask itself. */
  setDirtyDocuments?(names: string[]): void;
  /**
   * The window was asked to close while a document has unsaved changes. The renderer asks its
   * Close all question and calls {@link confirmQuit} to let the window close; doing nothing keeps it open.
   */
  onCloseRequest?(callback: () => void): () => void;
  /** Close the window now, without asking again. */
  confirmQuit?(): void;
  // ---- the system clipboard (optional: older desktop builds lack it)
  /**
   * Put a circuit on the system clipboard: the picture (`png`), the plain text, the HTML form that
   * carries the circuit and — when the platform lets it sit next to the others — the private format
   * `privateFormat` holding `privateData`. All binary data is base64. Resolves the formats that ended up on the clipboard.
   */
  clipboardWrite?(opts: { png: string; text: string; html: string; privateFormat: string; privateData: string }): Promise<{ formats: string[] }>;
  /** Read the system clipboard: its formats, the private format, the HTML, the picture (PNG) and the text. */
  clipboardRead?(privateFormat: string): Promise<DesktopClipboardContent>;

  /** Print the current page (the print-only pages of the print preview) with the system print dialog. */
  printPage?(opts: DesktopPrintOptions): Promise<{ ok: boolean; error?: string }>;
  /** Save the current page (the print-only pages) as a PDF through a save dialog; null when cancelled. */
  printToPdf?(opts: DesktopPrintOptions & { suggestedName?: string }): Promise<DesktopSaved | null>;

  // ---- projects (optional: desktop builds from before the schematic-capture round lack them)
  /** Open dialog for a project file (.msimproj); its folder becomes readable / writable by relative path. */
  openProject?(): Promise<DesktopFile | null>;
  /** Save dialog for a new project file. */
  saveProjectAs?(content: string, suggestedName?: string): Promise<DesktopSaved | null>;
  /** Read a file of an opened project by relative path (base64 content). */
  readProjectFile?(projectPath: string, rel: string): Promise<DesktopSaved & { base64: string }>;
  /** Write (create folders as needed) a file of an opened project by relative path. */
  writeProjectFile?(projectPath: string, rel: string, base64: string): Promise<DesktopSaved>;
  projectFileExists?(projectPath: string, rel: string): Promise<boolean>;
  /** Pick a file to add: inside the project folder it is referenced, outside it is copied in. */
  addFileToProject?(projectPath: string): Promise<{ rel: string; copied: boolean } | null>;
  /** Open dialog returning a binary file as base64 (e.g. a packed project). */
  openBinaryFile?(opts?: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<(DesktopSaved & { base64: string }) | null>;
  /** Choose a folder and write the unpacked files into a new sub-folder named after the project. */
  unpackProject?(files: { path: string; base64: string }[], projectName: string): Promise<(DesktopSaved & { folder: string }) | null>;
  recentProjects?(): Promise<string[]>;
  openRecentProject?(path: string): Promise<DesktopFile>;

  // ---- component tools (optional: older desktop builds lack them; callers fall back to browser storage)
  /** Read a named user-data file (part databases: 'partdb-user', 'partdb-corporate'); null when absent. */
  readUserData?(name: string): Promise<string | null>;
  /** Write a named user-data file (letters, digits and '-' only) in the app's user-data folder. */
  writeUserData?(name: string, content: string): Promise<void>;
  /**
   * Read a SPICE file included by a model file opened through openFile this session: `rel` is the
   * .include / .lib path, resolved against that file's folder. Only SPICE text extensions
   * (.lib .mod .inc .cir .sp .spi .sub .txt .model .ckt .net) are served; null when absent.
   */
  readIncludeFile?(basePath: string, rel: string): Promise<DesktopFile | null>;

  // ---- file features (optional: older desktop builds lack them; callers fall back)
  /** Size and dates of a file opened or saved this session; null when it is gone. */
  fileStat?(path: string): Promise<DesktopFileStat | null>;
  /** Crash-recovery slot in the user-data folder: the autosave record (JSON text) or null. */
  recoveryRead?(): Promise<string | null>;
  /** Write (text) or clear (null) the crash-recovery slot (atomic: temporary file + rename). */
  recoveryWrite?(text: string | null): Promise<void>;
  /** Whether the previous run ended without a normal quit (or the window's renderer crashed). */
  sessionInfo?(): Promise<{ uncleanExit: boolean }>;

  // ---- command-line batch mode (optional: only when the shell was started with --batch / --help)
  /** The batch job (arguments after the executable, working folder), null outside batch mode. */
  batchJob?(): Promise<{ args: string[]; cwd: string } | null>;
  /** Read a file named on the command line (relative paths resolve against the working folder): { text } or { error }. */
  batchRead?(path: string): Promise<{ text?: string; error?: string }>;
  /** Write a file named on the command line: {} or { error }. */
  batchWrite?(path: string, text: string): Promise<{ error?: string }>;
  /** Read a SPICE .include / .lib file next to the batch input (relative paths only). */
  batchInclude?(input: string, rel: string): Promise<string | null>;
  /** Finish the batch run: print the texts and exit with `code`. */
  batchDone?(code: number, stdout: string, stderr: string): void;
}

declare global {
  interface Window {
    machsimDesktop?: MachsimDesktopBridge;
  }
}

export function getDesktopBridge(): MachsimDesktopBridge | undefined {
  return typeof window !== 'undefined' ? window.machsimDesktop : undefined;
}

export function isDesktopApp(): boolean {
  return getDesktopBridge() !== undefined;
}
