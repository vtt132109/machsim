/** Global / instance parameter text ("name = expression" per line) <-> variables record. */
import { t } from '../../i18n';

/** "name = expression" lines <-> variables record. */
export function variablesToText(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k} = ${v}`)
    .join('\n');
}

export function parseVariablesText(text: string): { vars: Record<string, string>; error: string | null } {
  const vars: Record<string, string> = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('*') || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
    if (!m) return { vars, error: t('editor.properties.lineValueUseNameValue', { value: i + 1 }) };
    vars[m[1]] = m[2].trim();
  }
  return { vars, error: null };
}
