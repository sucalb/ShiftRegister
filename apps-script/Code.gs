/**
 * Backend cho app Đăng ký lịch làm việc.
 * Cách cài đặt: xem README.md ở thư mục gốc repo.
 */

var SPREADSHEET_ID = '1GBqzs8Y4Cj6KtIE1AvkpMIbIX-C6b4YZ5lpShZYOxds';

var DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
var TIME_RE = /^\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*$/;
var WEEKDAY_NAMES = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

function doGet(e) {
  var action = e.parameter.action;
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (action === 'weeks') {
      return jsonOut_(listWeeks_(ss));
    }
    if (action === 'grid') {
      var weekName = e.parameter.week;
      var code = e.parameter.code || '';
      var sheet = ss.getSheetByName(weekName);
      if (!sheet) throw new Error('Không tìm thấy tuần: ' + weekName);
      var g = findGrid_(sheet);
      var cells = {};
      for (var i = 0; i < g.shiftRows.length; i++) {
        var r = g.shiftRows[i];
        for (var j = 0; j < g.dayCols.length; j++) {
          var c = g.dayCols[j];
          var raw = String(g.values[r][c] || '');
          var names = splitNames_(raw);
          cells[(r + 1) + '_' + (c + 1)] = code ? (names.indexOf(code) !== -1) : false;
        }
      }
      return jsonOut_({ week: weekName, days: g.days, shifts: g.shifts, cells: cells });
    }
    if (action === 'employees') {
      var weeks = listWeeks_(ss);
      if (weeks.length === 0) throw new Error('Chưa có tab tuần nào (tên tab phải bắt đầu bằng "TUẦN ")');
      var empSheet = ss.getSheetByName(weeks[weeks.length - 1].name);
      return jsonOut_(findEmployees_(empSheet));
    }
    return jsonOut_({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var payload = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var action = payload.action || 'sync';

    if (action === 'createWeek') {
      var week = createWeek_(ss, payload.mondayDate);
      return jsonOut_({ ok: true, week: week });
    }

    var sheet = ss.getSheetByName(payload.week);
    if (!sheet) throw new Error('Không tìm thấy tuần: ' + payload.week);
    var code = String(payload.code || '').trim();
    if (!code) throw new Error('Thiếu mã nhân viên (code)');

    var cells = payload.cells || [];
    if (cells.length > 0) {
      var rows = cells.map(function (c) { return c.row; });
      var cols = cells.map(function (c) { return c.col; });
      var minRow = Math.min.apply(null, rows), maxRow = Math.max.apply(null, rows);
      var minCol = Math.min.apply(null, cols), maxCol = Math.max.apply(null, cols);

      var range = sheet.getRange(minRow, minCol, maxRow - minRow + 1, maxCol - minCol + 1);
      var values = range.getValues();

      cells.forEach(function (cell) {
        var r = cell.row - minRow, c = cell.col - minCol;
        var names = splitNames_(String(values[r][c] || ''));
        var idx = names.indexOf(code);
        if (cell.checked && idx === -1) names.push(code);
        if (!cell.checked && idx !== -1) names.splice(idx, 1);
        values[r][c] = names.join(', ');
      });

      range.setValues(values);
    }
    return jsonOut_({ ok: true, updated: cells.length });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Tạo 1 tab tuần mới bằng cách nhân bản tab mẫu "BẢN GỐC" và điền ngày tháng. */
function createWeek_(ss, mondayDateStr) {
  var m = DATE_RE.exec(String(mondayDateStr || '').trim());
  if (!m) throw new Error('Ngày không hợp lệ: ' + mondayDateStr);
  var picked = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  // Luôn quy về Thứ Hai của tuần chứa ngày được chọn.
  var dow = picked.getDay(); // 0 = Chủ Nhật .. 6 = Thứ Bảy
  var offsetToMonday = (dow === 0) ? -6 : (1 - dow);
  var monday = new Date(picked.getTime());
  monday.setDate(monday.getDate() + offsetToMonday);

  var name = 'TUẦN ' + pad2_(monday.getDate()) + '/' + pad2_(monday.getMonth() + 1);
  if (ss.getSheetByName(name)) {
    throw new Error('Tuần "' + name + '" đã tồn tại rồi, chọn tuần khác trong danh sách nhé.');
  }

  var template = ss.getSheetByName('BẢN GỐC');
  if (!template) throw new Error('Không tìm thấy tab mẫu "BẢN GỐC" để tạo tuần mới.');

  var newSheet = template.copyTo(ss);
  newSheet.setName(name);
  ss.setActiveSheet(newSheet);
  ss.moveActiveSheet(ss.getSheets().length);

  var g = findGrid_(newSheet);
  for (var i = 0; i < g.dayCols.length; i++) {
    var d = new Date(monday.getTime());
    d.setDate(d.getDate() + i);
    newSheet.getRange(g.dateRowIdx + 1, g.dayCols[i] + 1).setValue(d);
  }

  var weekLabelRow = findWeekLabelRow_(newSheet, g.dateRowIdx);
  if (weekLabelRow !== -1) {
    newSheet.getRange(weekLabelRow + 1, g.dayCols[0] + 1).setValue(monday);
  }

  return { name: name, startDate: formatDdMmYyyy_(monday) };
}

/** Tìm hàng có ô chữ "Tuần" (nhãn ngày bắt đầu tuần) phía trên hàng ngày/tháng chính. */
function findWeekLabelRow_(sheet, dateRowIdx) {
  var values = sheet.getRange(1, 1, dateRowIdx, sheet.getLastColumn()).getValues();
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (String(values[r][c]).trim() === 'Tuần') return r;
    }
  }
  return -1;
}

/** Dò cấu trúc lưới ca/ngày của 1 tab tuần, không phụ thuộc số dòng/cột cố định. */
function findGrid_(sheet) {
  var values = sheet.getDataRange().getValues();
  var nRows = values.length;
  var nCols = nRows > 0 ? values[0].length : 0;

  var dateRowIdx = -1, dayCols = [];
  for (var r = 0; r < nRows; r++) {
    var cols = [];
    for (var c = 0; c < nCols; c++) {
      if (DATE_RE.test(cellToDateString_(values[r][c]))) cols.push(c);
    }
    if (cols.length >= 5) { dateRowIdx = r; dayCols = cols; break; }
  }
  if (dateRowIdx === -1) throw new Error('Không tìm thấy hàng ngày/tháng trong tab ' + sheet.getName());

  var shiftCol = dayCols[0] - 1;
  var shiftRows = [];
  for (var r2 = dateRowIdx + 1; r2 < nRows; r2++) {
    var s = String(values[r2][shiftCol] || '').trim();
    if (TIME_RE.test(s)) {
      shiftRows.push(r2);
    } else if (shiftRows.length > 0) {
      break;
    }
  }
  if (shiftRows.length === 0) throw new Error('Không tìm thấy hàng ca làm trong tab ' + sheet.getName());

  var days = dayCols.map(function (c) {
    var dateStr = cellToDateString_(values[dateRowIdx][c]);
    return { col: c + 1, date: dateStr, weekday: weekdayFromDdMmYyyy_(dateStr) };
  });
  var shifts = shiftRows.map(function (r3) {
    return { row: r3 + 1, label: String(values[r3][shiftCol]).trim() };
  });

  return { values: values, dateRowIdx: dateRowIdx, dayCols: dayCols, shiftRows: shiftRows, days: days, shifts: shifts };
}

/** Dò bảng danh sách nhân sự (cột "TÊN" / "KÝ HIỆU") ở bất kỳ đâu trong tab. */
function findEmployees_(sheet) {
  var values = sheet.getDataRange().getValues();
  var nRows = values.length;
  var nCols = nRows > 0 ? values[0].length : 0;
  for (var r = 0; r < nRows; r++) {
    for (var c = 0; c < nCols; c++) {
      if (String(values[r][c]).trim() === 'KÝ HIỆU') {
        var codeCol = c, nameCol = c - 1;
        var list = [];
        for (var rr = r + 1; rr < nRows; rr++) {
          var name = String(values[rr][nameCol] || '').trim();
          var code = String(values[rr][codeCol] || '').trim();
          if (!name && !code) break;
          if (code) list.push({ name: name || code, code: code });
        }
        return list;
      }
    }
  }
  throw new Error('Không tìm thấy bảng danh sách nhân sự (cột "KÝ HIỆU") trong tab ' + sheet.getName());
}

function listWeeks_(ss) {
  var sheets = ss.getSheets();
  var weeks = [];
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var name = sheet.getName();
    if (!/^TUẦN\s/.test(name)) continue;
    try {
      var g = findGrid_(sheet);
      weeks.push({ name: name, startDate: g.days[0].date });
    } catch (err) {
      // bỏ qua tab không đúng cấu trúc
    }
  }
  weeks.sort(function (a, b) {
    return parseDdMmYyyy_(a.startDate) - parseDdMmYyyy_(b.startDate);
  });
  return weeks;
}

function splitNames_(raw) {
  return raw.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return !!s; });
}

function cellToDateString_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  }
  return String(v || '').trim();
}

function weekdayFromDdMmYyyy_(s) {
  var m = DATE_RE.exec(s);
  if (!m) return '';
  var date = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return WEEKDAY_NAMES[date.getDay()];
}

function parseDdMmYyyy_(s) {
  var m = DATE_RE.exec(s);
  if (!m) return 0;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function formatDdMmYyyy_(date) {
  return pad2_(date.getDate()) + '/' + pad2_(date.getMonth() + 1) + '/' + date.getFullYear();
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
