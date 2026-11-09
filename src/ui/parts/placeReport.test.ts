/**
 * The UI-language layer of the Select-a-component dialog and its Detail report: everything a
 * learner reads comes from the i18n catalogue, so the Function line, the part name and the
 * parameter labels must be the Vietnamese ones when the part has them (the library's own texts are
 * English), and the whole report must switch with the language.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { getPart, loadAllGroups } from '../../library';
import { partDetailReport, partDetails } from '../../library/partInfo';
import { partDescription, partName } from '../../i18n/library';
import { getLang, setLang } from '../../i18n';
import { databaseName, detailFields, detailReportTables, functionText, modelKindText, reportText } from './placeReport';

await loadAllGroups();

const lang0 = getLang();
afterAll(() => setLang(lang0));

const part = (id: string) => {
  const p = getPart(id);
  if (!p) throw new Error(`no part ${id}`);
  return p;
};

/** The detail pane of a part as { label: value }. */
const fields = (id: string): Record<string, string> => {
  const def = part(id);
  return Object.fromEntries(detailFields(partDetails(def), def));
};

describe('detail fields in the UI language', () => {
  it('the Function line is the Vietnamese description of the part, not the library English', () => {
    setLang('vi');
    const r = part('transistors/bc337-16');
    // the library text is English; the catalogue part carries its Vietnamese text
    expect(r.description).toMatch(/Small-signal NPN/);
    expect(partDescription(r)).toMatch(/^Transistor NPN tín hiệu nhỏ/);
    expect(functionText(partDetails(r), r)).toBe(partDescription(r));
    expect(fields('transistors/bc337-16')['Chức năng']).toBe(partDescription(r));
    setLang('en');
    expect(functionText(partDetails(r), r)).toBe(r.description);
    expect(fields('transistors/bc337-16')['Chức năng']).toBeUndefined();
    expect(fields('transistors/bc337-16')['Function']).toBe(r.description);
  });

  it('labels, the database name and the model kind follow the language', () => {
    setLang('vi');
    expect(Object.keys(fields('basic/resistor'))).toEqual(['Chức năng', 'Nhà sản xuất mô hình', 'Mã mô hình', 'Loại mô hình', 'Nhà sản xuất vỏ', 'Kiểu vỏ']);
    expect(databaseName('master')).toBe('Gốc (thư viện MachSim)');
    expect(databaseName('user')).toBe('Người dùng (của tôi)');
    expect(modelKindText({ kind: 'model', id: 'MS_BC337_16', type: 'NPN', manufacturer: 'MachSim' })).toContain('NPN');
    setLang('en');
    expect(Object.keys(fields('basic/resistor'))).toEqual(['Function', 'Model manufacturer', 'Model ID', 'Model kind', 'Package manufacturer', 'Package type']);
    expect(databaseName('master')).toBe('Master (MachSim library)');
  });

  it('a drawing-only symbol says it is not simulated instead of leaving the rows empty', () => {
    setLang('vi');
    const rows = fields('basic/test-point');
    expect(partDetails(part('basic/test-point')).model.kind).toBe('none');
    expect(rows['Mã mô hình']).toBe('—');
    expect(rows['Nhà sản xuất mô hình']).toBe('—');
    expect(rows['Loại mô hình']).toBe('Không mô phỏng (chỉ vẽ trên sơ đồ)');
    // a part with no footprint at all says so in the package row
    expect(fields('sources/ground')['Kiểu vỏ']).toBe('— (không có vỏ vật lý)');
    // a catalogue part with a footprint but no named vendor: a generic industry outline
    expect(fields('transistors/bc337-16')['Kiểu vỏ']).toBe('TO-92');
    expect(fields('transistors/bc337-16')['Nhà sản xuất vỏ']).toBe('Chung (kích thước theo chuẩn công nghiệp)');
  });
});

describe('Detail report tables', () => {
  it('names the part in the UI language and translates the parameter labels', () => {
    setLang('vi');
    const def = part('transistors/bc337-16');
    const tables = detailReportTables(partDetailReport(def), def);
    const general = Object.fromEntries(tables[0].rows.map((row) => [String(row[0]), String(row[1])]));
    expect(general['Tên']).toBe(partName(def));
    expect(general['Mã trong thư viện']).toBe('transistors/bc337-16');
    expect(general['Cơ sở dữ liệu']).toBe('Gốc (thư viện MachSim)');
    expect(general['Nhóm']).toBe('Transistor');
    expect(general['Chức năng']).toMatch(/^Transistor NPN tín hiệu nhỏ/);
    // the model follows a real part's datasheet: the provenance travels with the report
    expect(general['Nguồn gốc mô hình']).toMatch(/BC337/);
    // pins of a BJT with their numbers
    const pins = tables.find((t) => t.title === 'Chân')!;
    expect(pins.rows.map((row) => String(row[0]))).toEqual(['C', 'B', 'E']);
    expect(pins.rows.map((row) => String(row[1]))).toEqual(['1', '2', '3']);
    // parameters: the label is the translated one ("Mô hình", not "Model")
    const params = tables.find((t) => t.title === 'Tham số')!;
    expect(params.rows.map((row) => String(row[1]))).toEqual(['Thay bằng model SPICE']);
    // datasheet figures with Vietnamese labels and engineering values
    const specs = tables.find((t) => t.title === 'Thông số datasheet')!;
    const byLabel = Object.fromEntries(specs.rows.map((row) => [String(row[0]), String(row[1])]));
    expect(byLabel['Điện áp VCEO / VCES']).toBe('45 V');
    expect(byLabel['Dòng collector IC']).toBe('800 mA');
    expect(byLabel['Tần số cắt fT']).toBe('210 MHz');
    expect(byLabel['Loại / cực tính']).toBe('NPN');
  });

  it('the report of a part with no datasheet figures leaves that table out', () => {
    setLang('vi');
    const def = part('sources/ground');
    const titles = detailReportTables(partDetailReport(def), def).map((t) => t.title);
    expect(titles).toContain('Thông tin chung');
    expect(titles).not.toContain('Thông số datasheet');
  });

  it('the text form holds every table, the model listing and the localized name', () => {
    setLang('vi');
    const def = part('basic/resistor');
    const r = partDetailReport(def);
    const text = reportText(r, def);
    for (const t of detailReportTables(r, def)) expect(text).toContain(`== ${t.title} ==`);
    expect(text.split('\n')[0]).toContain(partName(def));
    expect(partName(def)).toBe('Điện trở');
    // the model listing of a resistor is its element card with the pins as nodes
    expect(text).toMatch(/\nR1 \S+ \S+ 1k/i);
    expect(text).toContain('== Mô hình SPICE ==');
  });

  it('a user component reports its hyperlink; a built-in part points at its help page', () => {
    setLang('vi');
    const def = part('basic/resistor');
    const general = detailReportTables(partDetailReport(def), def)[0].rows;
    const link = general.find((row) => String(row[0]) === 'Liên kết')!;
    expect(String(link[1])).toBe('Trang trợ giúp của linh kiện');
  });
});
