/**
 * Project packs carry the user components their designs use; templates travel as .msimtpl files.
 */
import { describe, expect, it } from 'vitest';
import type { CustomPartData } from '../library/custom/types';
import { boxSymbol } from '../library/symbols';
import { unzipFiles } from '../util/zip';
import { DesignBuilder } from './designkit';
import { addProjectEntry, bundleComponents, newProject, packProject, PACK_COMPONENTS, unpackProject } from './project';
import { parseDesign, serializeDesign } from './serialize';
import { parseTemplateFile, templateFromDesign } from './templates';

function part(id: string, modified: string, name = id): CustomPartData {
  return {
    id: `custom:${id}`,
    name: name.replace(/^custom:/, ''),
    group: 'misc',
    family: 'Mine',
    description: 'test part',
    prefix: 'U',
    symbol: boxSymbol({ left: [{ name: 'A' }], right: [{ name: 'B' }] }),
    model: { kind: 'none' },
    modified,
  };
}

function designWith(parts: CustomPartData[]): string {
  const b = new DesignBuilder('uses parts');
  parts.forEach((p, i) => b.part(p.id, `U${i + 1}`, 100 + 100 * i, 100));
  b.design.customParts = parts;
  return serializeDesign(b.design);
}

describe('packed projects and user components', () => {
  it('packs every embedded user component once (newest copy) and unpacks them', async () => {
    let p = newProject('Lab');
    p = addProjectEntry(p, { path: 'a.msim' });
    p = addProjectEntry(p, { path: 'b.msim' });
    const contents = new Map<string, string | Uint8Array>([
      ['a.msim', designWith([part('amp', '2026-01-01T00:00:00Z', 'Old amp'), part('sensor', '2026-01-01T00:00:00Z')])],
      ['b.msim', designWith([part('amp', '2026-06-01T00:00:00Z', 'New amp')])],
    ]);
    expect(bundleComponents({ project: p, contents }).map((c) => c.name).sort()).toEqual(['New amp', 'sensor']);
    const packed = packProject({ project: p, contents });
    expect(packed.components).toBe(2);
    const names = (await unzipFiles(packed.bytes)).map((e) => e.name);
    expect(names).toContain(PACK_COMPONENTS);
    const back = await unpackProject(packed.bytes);
    expect(back.components.map((c) => c.name).sort()).toEqual(['New amp', 'sensor']);
    // the component database is kept with the unpacked files, the designs still embed their parts
    expect(back.extra).toEqual([PACK_COMPONENTS]);
    expect(parseDesign(back.contents.get('a.msim') as string).customParts).toHaveLength(2);
  });

  it('adds no component file when no design uses user components', async () => {
    let p = newProject('Plain');
    p = addProjectEntry(p, { path: 'a.msim' });
    const packed = packProject({ project: p, contents: new Map([['a.msim', serializeDesign(new DesignBuilder('x').design)]]) });
    expect(packed.components).toBe(0);
    expect((await unzipFiles(packed.bytes)).map((e) => e.name)).toEqual(['project.msimproj', 'a.msim']);
    expect((await unpackProject(packed.bytes)).components).toEqual([]);
  });
});

describe('template files', () => {
  it('reads a .msimtpl record and uses a plain .msim design as a template with its content', () => {
    const b = new DesignBuilder('Bài thí nghiệm');
    b.part('basic/resistor', 'R1', 100, 100);
    b.design.sheets[0].props = { paper: 'A3' };
    const rec = templateFromDesign(b.design, 'Lớp 12A', false, new Date('2026-11-09T00:00:00Z'));
    expect(parseTemplateFile(JSON.stringify(rec, null, 2), 'ignored')).toEqual(rec);
    const fromDesign = parseTemplateFile(serializeDesign(b.design), 'Từ thiết kế', new Date('2026-11-09T00:00:00Z'))!;
    expect(fromDesign.name).toBe('Từ thiết kế');
    expect(fromDesign.withContent).toBe(true);
    expect(parseDesign(fromDesign.design).sheets[0].parts).toHaveLength(1);
    expect(parseTemplateFile('{"format":"machsim-template","name":"x"}', 'x')).toBeNull();
    expect(parseTemplateFile('not json', 'x')).toBeNull();
  });
});
