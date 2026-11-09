/** UI messages: help. [vi, en] */
import type { Catalogue } from '../types';

export default {
  'help.title': ['Trợ giúp MachSim', 'MachSim help'],
  'help.topics': ['Mục lục trợ giúp', 'Help topics'],
  'help.whatIsThis': ['Đây là gì?', 'What is this?'],
  'help.what': ['Đây là gì?', 'What is it?'],
  'help.use': ['Dùng khi nào?', 'When to use it'],
  'help.read': ['Đọc kết quả thế nào?', 'How to read it'],
  'help.tip': ['Mẹo:', 'Tip:'],
  'help.startTitle': ['Bắt đầu từng bước', 'Getting started, step by step'],
  'help.startIntro': ['Làm theo các bước dưới đây để vẽ mạch đầu tiên: cầu phân áp hai điện trở, đo bằng đồng hồ vạn năng.', 'Follow these steps to build your first circuit: a two-resistor voltage divider measured with a multimeter.'],
  'help.openExamples': ['Mở mạch mẫu…', 'Open an example…'],
  'help.families': ['Các họ linh kiện', 'Families'],
  'help.partsInFamily': ['Linh kiện trong họ này', 'Parts in this family'],
  'help.notFound': ['Không tìm thấy mục trợ giúp.', 'Help topic not found.'],
  'help.provenance': ['Nguồn gốc tham số: {text}', 'Parameter source: {text}'],
  'help.placePart': ['Đặt linh kiện này lên sơ đồ', 'Place this part'],
  'help.placeInstrument': ['Đặt thiết bị này lên sơ đồ', 'Place this instrument'],
  'help.useAnalysis': ['Chọn và thiết lập phép phân tích này', 'Choose and set up this analysis'],
  'help.navParts': ['Linh kiện', 'Components'],
  'help.navInstruments': ['Thiết bị đo', 'Instruments'],
  'help.navGuides': ['Học tập, báo cáo, tệp', 'Learning, reports, files'],
  'help.navAnalyses': ['Phép phân tích', 'Analyses'],
  'help.analysisHelp': ['Giải thích phép phân tích này', 'Explain this analysis'],
  'help.instrumentHelp': ['Thiết bị này dùng thế nào?', 'How do I use this instrument?'],
  'help.whatIsThisName': ['{name} là gì? (mở trang giải thích)', 'What is {name}? (opens the explanation)'],
} as const satisfies Catalogue;
