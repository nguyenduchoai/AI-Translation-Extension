## Dịch trang web và tùy chỉnh mẫu prompt

- **Dịch trang** thay chữ trực tiếp trong trang bằng OpenAI hoặc Gemini, giữ các phần tử/liên kết hiện có. Có tiến độ, **Dừng** và **Bản gốc**. Phản hồi cũ sau khi hủy/chuyển trang không ghi đè nội dung mới.
- **⚙️ → Mẫu prompt**: chọn mẫu sát nghĩa, tự nhiên, học thuật hoặc tạo mẫu riêng. Có lưu thay đổi, lưu thành mẫu mới, xóa mẫu và bỏ sửa; bản nháp được giữ khi đóng panel.
- Mẫu dịch ảnh/trang web và mẫu OCR được chọn độc lập. Mẫu bổ sung cách diễn đạt, vẫn giữ dữ kiện gốc và quy tắc OCR không dịch. Hỗ trợ `{{targetLanguage}}` và `{{specialty}}` trong mẫu dịch.
- Các chức năng chụp vùng, OCR, Gemini/OpenAI và đọc tiếng Việt từ bản trước được giữ lại.

### Cài đặt

Tải **ai-translate-extension-v2.6.0.zip**, giải nén → `chrome://extensions/` → bật Developer mode → **Load unpacked** → chọn thư mục có `manifest.json`. Nếu đã cài bản trước, thay nội dung trong đúng thư mục đã nạp rồi bấm **Reload** để giữ ID/cài đặt.

Mở side panel → ⚙️ lưu AI/key, ngôn ngữ và chuyên ngành → chọn mẫu prompt → mở trang cần dịch → **Dịch trang**. **Dừng** giữ phần đã dịch; **Bản gốc** khôi phục phần chữ extension đã thay, bảo toàn chữ website tự cập nhật.

**vieneu-local-v2.6.0.zip** là bộ chạy giọng đọc tùy chọn, không cần để dịch trang. Người đã chạy helper 2.5.0 không cần cài lại vì mã helper không thay đổi.

### Phạm vi và dữ liệu

- Dịch chữ đã tải trong trang chính; bỏ qua biểu mẫu, ô nhập liệu, vùng soạn thảo, nội dung ẩn, code, iframe và shadow DOM. Ảnh/PDF viewer dùng chụp vùng/OCR. Nội dung tải thêm cần dịch lại.
- Mỗi lượt tối đa 600 đoạn/60.000 ký tự; đoạn đơn trên 4.000 ký tự bị bỏ qua. API phản hồi một đợt quá 25 giây sẽ dừng và báo lỗi; phần đã dịch có thể khôi phục.
- Bấm Dịch trang gửi chữ phù hợp tới AI đã chọn, có chi phí/quota theo tài khoản. Mẫu và bản nháp lưu cục bộ; dữ liệu trang không được thêm vào lịch sử ảnh. TTS chưa tự đọc toàn bộ trang.
- Không thêm quyền extension. [Chính sách riêng tư v2.6.0](https://github.com/nguyenduchoai/AI-Translation-Extension/blob/main/docs/privacy-policy-v2.6.0.md) mô tả luồng dữ liệu mới.
- Hồ sơ Chrome Web Store v2.5.0 đang chờ duyệt được giữ nguyên; ZIP 2.6.0 này chưa được gửi thay thế lên Store.

### Kiểm tra

- **98/98 kiểm thử Node đạt**, gồm chia nhóm, JSON phản hồi, prompt, bản nháp, Dừng/khôi phục/chuyển trang, lỗi API và đóng gói.
- Kiểm tra trên Chrome thật, nạp trực tiếp từ **ZIP đã giải nén**: OpenAI/Gemini qua service worker tới DOM, chọn mẫu, giữ bản nháp sau reload, giữ liên kết, phục hồi chính xác, phản hồi muộn sau Dừng và nội dung website tự cập nhật.
- Browser test dùng phản hồi API mô phỏng; chưa xác nhận chất lượng dịch trang bằng API trả phí thực tế. Không tuyên bố đã kiểm tra mọi website.
- Mã kiểm tra browser: `scripts/verify-page-browser.cjs` (cần Playwright/Chrome; hỗ trợ biến `EXTENSION_PATH` trỏ tới gói giải nén).

Các file `.sha256` dùng để kiểm tra ZIP tải xuống. Gói không chứa API key, model, cache hay dữ liệu kiểm thử.
