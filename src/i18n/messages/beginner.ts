/**
 * Start-up texts of the learner-experience round: beginner mode (Options and the status bar), the
 * lesson-authoring and what's-new commands, and the first-run offer on the Welcome panel. The
 * authoring dialog's own texts load with it (src/i18n/learnUi.ts).
 */
const beginner = {
  // commands and menu labels
  'cmd.options.beginnerMode': ['Chế độ người mới', 'Beginner mode'],
  'cmd.help.whatsNew': ['Có gì mới', "What's new"],
  'cmd.help.lessonEditor': ['Soạn bài học…', 'Lesson editor…'],
  // Options menu / status bar
  'beginner.turnedOn': [
    'Đã bật chế độ người mới: menu, thanh công cụ và danh sách phân tích chỉ còn những mục cần cho mạch đầu tiên. Bỏ chọn Tuỳ chọn › Chế độ người mới để quay lại đầy đủ.',
    'Beginner mode is on: the menus, the toolbar and the analysis list keep only what a first circuit needs. Untick Options › Beginner mode to get everything back.',
  ],
  'beginner.turnedOff': ['Đã tắt chế độ người mới: giao diện đầy đủ đã trở lại.', 'Beginner mode is off: the full interface is back.'],
  'beginner.hiddenCommand': [
    'Lệnh “{command}” ({keys}) chỉ có trong giao diện đầy đủ. Bỏ chọn Tuỳ chọn › Chế độ người mới, hoặc nhấp ô “Người mới” ở thanh trạng thái, để dùng lệnh này.',
    'The command “{command}” ({keys}) is only in the full interface. Untick Options › Beginner mode, or click the “Beginner” cell in the status bar, to use it.',
  ],
  'beginner.status': ['Người mới', 'Beginner'],
  'beginner.statusTip': [
    'Đang ở chế độ người mới (giao diện gọn). Nhấp để quay lại giao diện đầy đủ, hoặc dùng Tuỳ chọn › Chế độ người mới.',
    'Beginner mode is on (simplified interface). Click to go back to the full interface, or use Options › Beginner mode.',
  ],
  'beginner.fullTip': ['Đang ở giao diện đầy đủ. Nhấp để bật chế độ người mới (ẩn các mục nâng cao).', 'The full interface is on. Click for beginner mode (the advanced entries are hidden).'],
  // first-run offer (Welcome panel)
  'beginner.offer.title': ['Bắt đầu gọn nhẹ?', 'Start simple?'],
  'beginner.offer.body': [
    'MachSim có rất nhiều chức năng. Chế độ người mới chỉ hiện những gì cần cho mạch đầu tiên: đặt linh kiện, nối dây, đo và chạy mô phỏng. Bạn bật lại giao diện đầy đủ bất cứ lúc nào trong menu Tuỳ chọn.',
    'MachSim has a lot of features. Beginner mode shows only what a first circuit needs: place parts, wire them, measure and run. You can switch the full interface back on at any time in the Options menu.',
  ],
  'beginner.offer.accept': ['Bật chế độ người mới', 'Turn beginner mode on'],
  'beginner.offer.decline': ['Dùng giao diện đầy đủ', 'Use the full interface'],
  'sim.source.beginner': ['Giao diện', 'Interface'],
  'sim.source.lessonFile': ['Tệp bài học', 'Lesson file'],
} as const;

export default beginner;
