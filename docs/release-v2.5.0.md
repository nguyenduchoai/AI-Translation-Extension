## Giọng đọc tiếng Việt — bản triển khai thử nghiệm

Extension có thể đọc từng câu AI trả về, đọc văn bản dán vào và nghe lại bản dịch bằng **VieNeu local** hoặc **giọng tiếng Việt có sẵn trong trình duyệt**.

### Tải và cài

1. Tải **ai-translate-extension-v2.5.0.zip**, giải nén → `chrome://extensions/` → Developer mode → **Load unpacked** → chọn thư mục có `manifest.json`.
2. Để dùng VieNeu trên Mac, tải thêm **vieneu-local-v2.5.0.zip**, giải nén → mở **companion/start-vieneu.command**. Cần Python 3.12 hoặc `uv`; hướng dẫn ở README trong gói. Lần đầu cài thư viện và tải khoảng 580 MiB model; giữ Terminal mở.
3. Đợi VieNeu sẵn sàng → trong extension mở **🔊 Đọc tiếng Việt → VieNeu local → Kết nối** → chọn giọng → **Nghe thử**.
4. Dán câu trả lời AI để nghe ngay; không cần API key dịch cho tính năng này. Hoặc bật **Tự đọc từng câu khi AI dịch** rồi chụp/dịch ảnh. Tự đọc áp dụng bản dịch tiếng Việt, không tự đọc OCR.
5. **Dừng** hủy lượt phát và câu đang chờ. Giữ side panel mở khi nghe.

Nếu máy có giọng `vi-VN`, chọn **Giọng trình duyệt** để dùng không cần helper. Đây là giọng hệ thống/browser, không phải VieNeu hay edge-tts. Đã thử giọng Linh trên Mac.

Nếu nâng cấp extension cũ, thay nội dung trong đúng thư mục đã nạp rồi bấm **Reload** để giữ cài đặt.

### Đã làm và kiểm tra

- VieNeu v3 Turbo ONNX fp32 chạy trên máy; browser nhận PCM16 48 kHz streaming và phát theo thứ tự.
- Tách câu tránh cắt số thập phân và chữ viết tắt; giới hạn backlog có báo lỗi, không âm thầm bỏ câu.
- Dừng/hủy, thay nội dung đọc, chọn giọng, âm lượng, nghe lại từng bản dịch và thời gian tới âm thanh đầu.
- 58 kiểm thử Node và 5 kiểm thử API Python đạt; các bài kiểm tra tự động dùng mock cho phần model.
- Model VieNeu thật đã được khởi động và tạo mẫu nha khoa trên M2 Pro: byte đầu **0,347 giây**, tổng tạo **1,875 giây**, audio **6,08 giây**, giọng Mai Anh. Đây là một mẫu sau khi làm nóng model.
- Chrome đã kết nối đủ 25 giọng, phát VieNeu thật, thử dừng/đọc lại và giọng Linh. Luồng chữ AI mô phỏng → VieNeu thật gửi mỗi câu đúng một lần; `3.5 mm` không bị tách.

### Phạm vi hiện tại

Tạo giọng VieNeu chạy bằng Python local; âm thanh phát trong browser. **Chưa có suy luận VieNeu hoàn toàn trong browser, thu âm/nhận dạng hay phiên dịch Meet/Zoom.** Chưa chấm chất lượng phát âm bởi người nghe. Số đo trong panel bắt đầu từ lúc gửi câu tới TTS, không bao gồm thời gian AI dịch.

Hai file `.sha256` dùng kiểm tra tải xuống. Gói extension/helper không chứa API key, model đã tải, cache, môi trường Python hoặc dữ liệu kiểm thử.
