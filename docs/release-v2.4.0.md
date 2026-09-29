## Tải và cài extension

Tải **ai-translate-extension-v2.4.0.zip** trong mục **Assets** bên dưới, rồi:

1. Giải nén ZIP vào một thư mục cố định.
2. Mở `chrome://extensions/`, bật **Developer mode**.
3. Chọn **Load unpacked** → chọn thư mục vừa giải nén có `manifest.json`.
4. Mở extension → ⚙️ → chọn **Google Gemini** hoặc **OpenAI** → nhập API key đúng nhà cung cấp.
5. Chọn model và **Nha khoa** (hoặc phân ngành) → **Test Server** → **Lưu lại**.
6. Nhấn **Alt+Q**, kéo chọn vùng chữ cần dịch.

Chrome cần thư mục đã giải nén, không nạp trực tiếp ZIP. Nếu đã cài bản cũ, thay nội dung trong đúng thư mục đó rồi bấm **Reload** để giữ ID/cài đặt. File `.zip.sha256` dùng đối chiếu tính toàn vẹn tải xuống.

## Thay đổi

- Thêm Gemini cho dịch ảnh, OCR và streaming; API key/model riêng cho từng nhà cung cấp, giữ cài đặt OpenAI cũ.
- Gemini mặc định `gemini-3.8-flash`, thêm `gemini-3.5-flash-lite` và ô nhập mã model khác có hỗ trợ ảnh.
- Prompt nha khoa và các phân ngành giữ nguyên số răng, đơn vị, liều lượng, nồng độ, phủ định, trích dẫn và cấu trúc. Chữ không rõ đánh dấu `[...]`; không tự thêm chẩn đoán hay nội dung ngoài nguồn.
- OCR dùng prompt riêng để trích nguyên văn, không dịch.
- Sửa nút Copy/Export và xử lý lỗi kết quả bị cắt, API bị chặn, hết quota hoặc kết nối ngắt giữa chừng.
- Tự động chạy test và đính kèm ZIP/checksum khi phát hành tag mới.

## Kiểm tra

26 kiểm thử tự động đạt: hợp đồng API, luồng streaming Unicode, prompt, tích hợp background với phản hồi API mô phỏng, đóng gói/checksum. Đã nạp extension vào Chrome thử nghiệm và kiểm tra chọn nhà cung cấp, lưu/khôi phục key-model riêng, OCR, model tùy chỉnh và hiển thị lỗi.

Chưa kiểm chứng gọi API thật hoặc chất lượng bản dịch với API key của người dùng. Test Server xác nhận yêu cầu văn bản tới model; dịch ảnh thực tế cần model hỗ trợ ảnh và quota phù hợp.
