(function () {
  var API_URL = window.APP_CONFIG.API_URL;
  var STORAGE_KEY = 'shiftregister.employee';
  var DRAFT_KEY_PREFIX = 'shiftregister.draft.';

  var els = {
    stepName: document.getElementById('step-name'),
    stepGrid: document.getElementById('step-grid'),
    continueBtn: document.getElementById('continueBtn'),
    nameError: document.getElementById('nameError'),
    topbarRight: document.getElementById('topbarRight'),
    topbarWeekBadge: document.getElementById('topbarWeekBadge'),
    tabstrip: document.getElementById('tabstrip'),
    whoami: document.getElementById('whoamiName'),
    changeNameBtn: document.getElementById('changeNameBtn'),
    currentWeekLabel: document.getElementById('currentWeekLabel'),
    newWeekBtn: document.getElementById('newWeekBtn'),
    newWeekForm: document.getElementById('newWeekForm'),
    newWeekDate: document.getElementById('newWeekDate'),
    createWeekBtn: document.getElementById('createWeekBtn'),
    cancelWeekBtn: document.getElementById('cancelWeekBtn'),
    newWeekError: document.getElementById('newWeekError'),
    tableHeadRow: document.getElementById('tableHeadRow'),
    tableBody: document.getElementById('tableBody'),
    saveDraftBtn: document.getElementById('saveDraftBtn'),
    syncBtn: document.getElementById('syncBtn'),
    syncStatus: document.getElementById('syncStatus'),
    gridError: document.getElementById('gridError'),
    toast: document.getElementById('toast')
  };

  var state = {
    employee: null, // { name, code }
    weeks: [],
    currentWeek: null,
    days: [],
    shifts: [],
    selected: {}, // "row_col" -> boolean
    closed: {} // "row_col" -> boolean (ô không có ca, không cho chọn)
  };

  var nameDropdown = createDropdown_(document.getElementById('nameDropdown'));

  init();

  function init() {
    var saved = readJSON_(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.code) {
      state.employee = saved;
      showGridStep_();
    } else {
      showNameStep_();
    }

    els.changeNameBtn.addEventListener('click', function () {
      showNameStep_();
    });
    els.continueBtn.addEventListener('click', onContinue_);
    els.saveDraftBtn.addEventListener('click', onSaveDraft_);
    els.syncBtn.addEventListener('click', onSync_);
    els.newWeekBtn.addEventListener('click', onToggleNewWeekForm_);
    els.cancelWeekBtn.addEventListener('click', function () {
      els.newWeekForm.hidden = true;
      hideError_(els.newWeekError);
    });
    els.createWeekBtn.addEventListener('click', onCreateWeek_);
  }

  /** Dropdown tùy chỉnh thay cho <select> để tự vẽ được cả phần menu (native select không style được). */
  function createDropdown_(root) {
    var trigger = root.querySelector('.dropdown-trigger');
    var menu = root.querySelector('.dropdown-menu');
    var options = [];
    var value = '';
    var changeCb = null;

    function close() { menu.hidden = true; }
    function open() { menu.hidden = false; }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (trigger.disabled) return;
      menu.hidden ? open() : close();
    });
    menu.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function (e) {
      if (!root.contains(e.target)) close();
    });

    function render() {
      menu.innerHTML = '';
      options.forEach(function (opt) {
        var item = document.createElement('div');
        item.className = 'dropdown-item' + (opt.value === value ? ' selected' : '');
        item.textContent = opt.label;
        item.addEventListener('click', function () {
          value = opt.value;
          trigger.textContent = opt.label;
          close();
          render();
          if (changeCb) changeCb(value);
        });
        menu.appendChild(item);
      });
    }

    return {
      setOptions: function (opts, placeholderText) {
        options = opts;
        value = '';
        trigger.textContent = placeholderText || (opts[0] && opts[0].label) || '';
        trigger.disabled = false;
        render();
      },
      setValue: function (v) {
        value = v;
        var found = options.filter(function (o) { return o.value === v; })[0];
        if (found) trigger.textContent = found.label;
        render();
      },
      getValue: function () { return value; },
      getLabel: function () {
        var found = options.filter(function (o) { return o.value === value; })[0];
        return found ? found.label : '';
      },
      onChange: function (fn) { changeCb = fn; },
      setLoading: function (text) {
        options = [];
        value = '';
        trigger.textContent = text;
        trigger.disabled = true;
        menu.innerHTML = '';
      }
    };
  }

  // Gộp "employees" + "weeks" thành 1 lần gọi (action=bootstrap) và cache lại trong phiên,
  // để không phải quét lại Sheet mỗi khi chuyển bước — đây là chỗ trước đây gây chậm lúc mới vào.
  var bootstrapPromise = null;

  function getBootstrap_() {
    if (!bootstrapPromise) {
      bootstrapPromise = apiGet_('bootstrap', {}).then(function (data) {
        if (data.error) throw new Error(data.error);
        return data;
      }).catch(function (err) {
        bootstrapPromise = null; // cho phép thử lại nếu lỗi
        throw err;
      });
    }
    return bootstrapPromise;
  }

  function showNameStep_() {
    els.stepGrid.hidden = true;
    els.topbarRight.hidden = true;
    els.tabstrip.hidden = true;
    els.stepName.hidden = false;

    nameDropdown.setLoading('Đang tải danh sách...');
    els.continueBtn.disabled = true;
    getBootstrap_()
      .then(function (data) {
        nameDropdown.setOptions(
          data.employees.map(function (emp) { return { value: emp.code, label: emp.name }; }),
          '— Chọn tên —'
        );
        nameDropdown.onChange(function () {
          els.continueBtn.disabled = !nameDropdown.getValue();
        });
      })
      .catch(function (err) {
        showError_(els.nameError, 'Không tải được danh sách nhân sự: ' + err.message);
      });
  }

  function showGridStep_() {
    els.stepName.hidden = true;
    els.stepGrid.hidden = false;
    els.topbarRight.hidden = false;
    els.tabstrip.hidden = false;
    els.whoami.textContent = state.employee.name;
    loadWeeks_();
  }

  function onContinue_() {
    var code = nameDropdown.getValue();
    if (!code) return;
    state.employee = { code: code, name: nameDropdown.getLabel() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.employee));
    showGridStep_();
  }

  function loadWeeks_(selectWeek) {
    getBootstrap_()
      .then(function (data) {
        var weeks = data.weeks;
        if (!weeks.length) throw new Error('Chưa có tuần nào trong Sheet.');
        state.weeks = weeks;
        var target = selectWeek && weeks.some(function (w) { return w.name === selectWeek; })
          ? selectWeek
          : pickDefaultWeek_(weeks);
        loadGrid_(target);
      })
      .catch(function (err) {
        showError_(els.gridError, 'Không tải được danh sách tuần: ' + err.message);
      });
  }

  // Luôn mặc định vào tuần SAU (tuần hiện tại + 7 ngày) — lịch đăng ký luôn được gửi
  // trước 1 tuần, nên đây mới là tuần nhân viên cần đăng ký, không phải tuần đang chạy.
  function pickDefaultWeek_(weeks) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var dow = today.getDay(); // 0 = Chủ Nhật .. 6 = Thứ Bảy
    var offsetToMonday = (dow === 0) ? -6 : (1 - dow);
    var thisMonday = new Date(today.getTime());
    thisMonday.setDate(thisMonday.getDate() + offsetToMonday);
    var nextMonday = new Date(thisMonday.getTime());
    nextMonday.setDate(nextMonday.getDate() + 7);

    var best = weeks[0].name;
    var bestDiff = Infinity;
    for (var i = 0; i < weeks.length; i++) {
      var d = parseDdMmYyyy_(weeks[i].startDate);
      var diff = Math.abs(d - nextMonday);
      if (diff <= bestDiff) { bestDiff = diff; best = weeks[i].name; }
    }
    return best;
  }

  function parseDdMmYyyy_(s) {
    var parts = s.split('/');
    return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  }

  function loadGrid_(weekName) {
    hideError_(els.gridError);
    els.syncStatus.textContent = 'Đang tải...';
    els.tableBody.innerHTML = '';
    els.tableHeadRow.innerHTML = '';
    apiGet_('grid', { week: weekName, code: state.employee.code })
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        state.currentWeek = weekName;
        state.days = data.days;
        state.shifts = data.shifts;
        els.currentWeekLabel.textContent = weekName;
        els.topbarWeekBadge.textContent = weekName;
        els.topbarWeekBadge.hidden = false;

        state.closed = {};
        var serverSelected = {};
        Object.keys(data.cells).forEach(function (key) {
          state.closed[key] = !!data.cells[key].closed;
          serverSelected[key] = !!data.cells[key].on;
        });

        var draft = readJSON_(localStorage.getItem(DRAFT_KEY_PREFIX + state.employee.code + '.' + weekName));
        state.selected = draft || serverSelected;

        renderTable_();
        els.syncStatus.textContent = 'Chưa đồng bộ (đang xem lịch hiện có trên Sheet)';
      })
      .catch(function (err) {
        showError_(els.gridError, 'Không tải được lịch tuần: ' + err.message);
      });
  }

  function renderTable_() {
    var headHtml = '<th class="corner">Ca</th>';
    state.days.forEach(function (d) {
      headHtml += '<th><span class="weekday">' + escapeHtml_(d.weekday) + '</span><span class="date">' + escapeHtml_(d.date) + '</span></th>';
    });
    els.tableHeadRow.innerHTML = headHtml;

    var bodyHtml = '';
    state.shifts.forEach(function (shift) {
      bodyHtml += '<tr><th>' + escapeHtml_(shift.label) + '</th>';
      state.days.forEach(function (day) {
        var key = shift.row + '_' + day.col;
        var isClosed = !!state.closed[key];
        var isOn = !isClosed && !!state.selected[key];
        var cls = 'cell-btn' + (isOn ? ' selected' : '') + (isClosed ? ' closed' : '');
        bodyHtml += '<td><button type="button" class="' + cls + '" data-key="' + key + '"' + (isClosed ? ' disabled' : '') + '>' + (isOn ? '✓' : '') + '</button></td>';
      });
      bodyHtml += '</tr>';
    });
    els.tableBody.innerHTML = bodyHtml;

    var buttons = els.tableBody.querySelectorAll('.cell-btn:not(.closed)');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-key');
        var next = !state.selected[key];
        state.selected[key] = next;
        btn.classList.toggle('selected', next);
        btn.textContent = next ? '✓' : '';
      });
    });
  }

  function onSaveDraft_() {
    if (!state.currentWeek) return;
    localStorage.setItem(
      DRAFT_KEY_PREFIX + state.employee.code + '.' + state.currentWeek,
      JSON.stringify(state.selected)
    );
    showToast_('Đã lưu nháp trên máy này.', 'ok');
  }

  function onSync_() {
    if (!state.currentWeek) return;
    els.syncBtn.disabled = true;
    els.syncStatus.textContent = 'Đang đồng bộ...';

    var cells = [];
    state.shifts.forEach(function (shift) {
      state.days.forEach(function (day) {
        var key = shift.row + '_' + day.col;
        if (state.closed[key]) return; // ô không có ca, không gửi lên
        cells.push({ row: shift.row, col: day.col, checked: !!state.selected[key] });
      });
    });

    apiPost_({ week: state.currentWeek, code: state.employee.code, cells: cells })
      .then(function (data) {
        els.syncBtn.disabled = false;
        if (!data.ok) throw new Error(data.error || 'Lỗi không xác định');
        localStorage.removeItem(DRAFT_KEY_PREFIX + state.employee.code + '.' + state.currentWeek);
        els.syncStatus.innerHTML = '<span class="ok">Đã đồng bộ lên Sheet lúc ' + new Date().toLocaleTimeString('vi-VN') + '</span>';
        showToast_('Đồng bộ thành công!', 'ok');
      })
      .catch(function (err) {
        els.syncBtn.disabled = false;
        els.syncStatus.textContent = 'Đồng bộ thất bại';
        showToast_('Đồng bộ thất bại: ' + err.message, 'error');
      });
  }

  function onToggleNewWeekForm_() {
    els.newWeekForm.hidden = !els.newWeekForm.hidden;
    hideError_(els.newWeekError);
  }

  function onCreateWeek_() {
    var raw = els.newWeekDate.value; // yyyy-mm-dd
    if (!raw) {
      showError_(els.newWeekError, 'Chọn 1 ngày trước đã.');
      return;
    }
    var parts = raw.split('-');
    var mondayDate = parts[2] + '/' + parts[1] + '/' + parts[0];

    els.createWeekBtn.disabled = true;
    hideError_(els.newWeekError);

    apiPost_({ action: 'createWeek', mondayDate: mondayDate })
      .then(function (data) {
        els.createWeekBtn.disabled = false;
        if (!data.ok) throw new Error(data.error || 'Lỗi không xác định');
        els.newWeekForm.hidden = true;
        els.newWeekDate.value = '';
        showToast_('Đã tạo tuần ' + data.week.name + '!', 'ok');
        bootstrapPromise = null; // danh sách tuần vừa đổi, bỏ cache cũ để lấy lại từ server
        loadWeeks_(data.week.name);
      })
      .catch(function (err) {
        els.createWeekBtn.disabled = false;
        showError_(els.newWeekError, err.message);
      });
  }

  function apiGet_(action, params) {
    var url = new URL(API_URL);
    url.searchParams.set('action', action);
    Object.keys(params).forEach(function (k) { url.searchParams.set(k, params[k]); });
    return fetch(url.toString()).then(function (res) { return res.json(); });
  }

  function apiPost_(payload) {
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json(); });
  }

  function showError_(el, msg) {
    el.textContent = msg;
    el.hidden = false;
  }

  function hideError_(el) {
    el.hidden = true;
  }

  function showToast_(msg, kind) {
    els.toast.textContent = msg;
    els.toast.className = 'toast ' + (kind || '');
    els.toast.hidden = false;
    clearTimeout(showToast_._t);
    showToast_._t = setTimeout(function () { els.toast.hidden = true; }, 3000);
  }

  function readJSON_(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function escapeHtml_(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
