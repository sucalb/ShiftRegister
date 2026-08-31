# ShiftRegister — Đăng ký lịch làm việc

Web app tĩnh để nhân viên tự chọn tên, đánh dấu ca mình làm được, và đồng bộ trực tiếp
vào Google Sheet `[URANUS] ĐĂNG KÝ LỊCH LÀM VIỆC MÔN TIẾNG ANH 2026 - 2027`.

## Cấu trúc
 
```
index.html         Giao diện chính (chọn tên -> chọn ca -> lưu/đồng bộ)
css/style.css       Style
js/config.js         Nơi dán URL Web App sau khi deploy Apps Script
js/app.js            Toàn bộ logic frontend
apps-script/Code.gs  Backend, dán vào Apps Script gắn với Google Sheet
```

App **không cần server riêng** — mọi thao tác đọc/ghi Sheet đi qua một Google Apps Script
Web App, gọi thẳng từ trình duyệt.

## Bước 1 — Cài Apps Script vào Sheet

1. Mở Google Sheet đăng ký lịch.
2. Vào menu **Tiện ích (Extensions) → Apps Script**.
3. Xoá nội dung mặc định trong file `Code.gs`, dán toàn bộ nội dung file
   [`apps-script/Code.gs`](apps-script/Code.gs) của repo này vào.
4. Kiểm tra dòng đầu `SPREADSHEET_ID` đã đúng ID của Sheet (mặc định đã điền sẵn ID hiện tại).
5. Bấm **Lưu** (biểu tượng đĩa mềm).

## Bước 2 — Deploy thành Web App

1. Trong Apps Script, bấm **Deploy → New deployment**.
2. Chọn loại **Web app**.
3. Cấu hình:
   - **Execute as**: Me (tài khoản của bạn)
   - **Who has access**: Anyone (để nhân viên không cần đăng nhập Google vẫn dùng được)
4. Bấm **Deploy**, cấp quyền khi được hỏi (Google sẽ cảnh báo vì script chưa xác minh —
   chọn **Advanced → Go to (tên project) → Allow**, đây là cảnh báo mặc định cho mọi script tự viết).
5. Copy **Web app URL** vừa tạo (dạng `https://script.google.com/macros/s/xxx/exec`).

> Mỗi khi bạn sửa lại `Code.gs`, phải **Deploy → Manage deployments → sửa (Edit) → New version**
> thì thay đổi mới có hiệu lực trên URL cũ.

## Bước 3 — Gắn URL vào app

Mở [`js/config.js`](js/config.js), thay:

```js
API_URL: 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE'
```

bằng URL vừa copy ở Bước 2.

## Bước 4 — Chạy thử / host

- Chạy thử cục bộ: mở thẳng `index.html` bằng trình duyệt, hoặc dùng một server tĩnh bất kỳ
  (VD `npx serve .`).
- Host miễn phí: bật **GitHub Pages** cho repo này (Settings → Pages → Deploy from branch),
  hoặc Netlify/Vercel kéo-thả cả thư mục — không cần build.
- Gửi link đó cho nhân viên là dùng được ngay trên điện thoại.

## Cách hoạt động

- App tự dò cấu trúc từng tab tuần (dòng chứa ngày tháng, dòng chứa khung giờ ca, và bảng
  "TÊN / KÝ HIỆU") thay vì hardcode toạ độ ô — nên vẫn chạy đúng dù các tuần sau này có thêm/bớt
  ca hoặc đổi khung giờ, miễn cấu trúc bảng (cột ngày, cột ca, bảng nhân sự) giữ nguyên kiểu.
- Khi nhân viên bấm ô để chọn/bỏ chọn ca, dữ liệu chỉ lưu tạm ở trình duyệt (localStorage) cho
  đến khi bấm **Đồng bộ lên Sheet** — lúc đó Apps Script mới thêm/xoá đúng ký hiệu tên của họ
  trong ô tương ứng trên Sheet (không đụng tới tên người khác đã có trong cùng ô).
- Danh sách nhân viên và danh sách tuần được đọc trực tiếp từ Sheet mỗi lần tải trang, nên
  thêm/bớt nhân viên hay thêm tuần mới trong Sheet sẽ tự xuất hiện trên app, không cần sửa code.
