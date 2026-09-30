# AI Screen Translator v2.7.0

Thêm **Dịch âm thanh tab (thử nghiệm)**: Groq nhận dạng online → OpenAI/Gemini dịch tiếng Việt bằng chuyên ngành/mẫu prompt đã lưu → VieNeu local hoặc giọng Việt của browser. Không cần chạy model ASR trên máy.

## Tải và dùng

- **`ai-translate-extension-v2.7.0.zip`**: giải nén, mở `chrome://extensions/`, bật Developer mode → Load unpacked. Khi nâng cấp, thay file trong đúng thư mục cũ rồi Reload để giữ ID/cài đặt.
- **`vieneu-local-v2.7.0.zip`**: helper TTS riêng, không đổi engine so với v2.6.1. Windows mở `companion/start-vieneu.bat`, Mac mở `companion/start-vieneu.command`. Nếu đã có VieNeu chạy trên cổng 8001, không cần cài lại.
- Trong ⚙️ lưu key AI dịch. Mở 🎧 Dịch âm thanh tab, nhập key của [Groq](https://console.groq.com/keys), chọn ngôn ngữ nguồn, chọn nguồn giọng ở mục 🔊. Bấm Bắt đầu, chọn Tab Chrome có video và bật chia sẻ audio.
- Bỏ chọn Đọc bản dịch nếu chỉ cần xem chữ. Giữ panel mở; Dừng hoặc ngừng chia sẻ của Chrome để kết thúc.

## Cách xử lý dữ liệu

Groq key chỉ lưu trên máy khi bấm Lưu, không Chrome Sync. Xóa ô key rồi Lưu để gỡ. Audio gửi trực tiếp tới Groq; chữ gửi tới AI dịch đã chọn. Chỉ nhận audio tab được chọn, không mic/Zoom desktop/toàn màn hình. Chrome giữ video track để duy trì chia sẻ nhưng luồng này không đọc/gửi video. Audio không lưu trên đĩa; 30 cặp chữ/bản dịch gần nhất chỉ nằm trong panel. Xem [chính sách v2.7.0](https://github.com/nguyenduchoai/AI-Translation-Extension/blob/main/docs/privacy-policy-v2.7.0.md).

## Giới hạn bản thử nghiệm

Audio được gom khoảng 10 giây mỗi đoạn. Có độ trễ ASR/dịch/đọc; không đồng bộ tức thì với hình, có thể cắt giữa từ/câu. Phần cuối chưa đủ 10 giây bị bỏ khi dừng. ASR/dịch và phát giọng có hàng đợi riêng, mỗi hàng tối đa 3 đoạn; giọng đọc giới hạn thêm 2.400 ký tự. Quá tải, lỗi API/quota hoặc TTS sẽ báo và dừng toàn phiên. Không tự đổi provider hay tự trả phí. Groq Free Plan có hạn mức; AI dịch áp dụng chi phí/hạn mức riêng.

## Kiểm tra

- 137 kiểm tra Node tự động đã qua, gồm ASR multipart/WAV, hủy và phản hồi muộn, thứ tự xử lý, giới hạn hai hàng đợi, prompt/nhà cung cấp và hồi quy tính năng cũ.
- Chrome thật + AudioWorklet với audio/phản hồi Groq, AI và VieNeu mô phỏng: luồng nhận dạng → dịch → phát PCM; lưu/xóa key local, Stop, hủy hộp chọn, thiếu audio và HTTP 429.
- Native getDisplayMedia trong side panel thật của Chrome 153 trên macOS với tab phát âm thử: thu WAV 48 kHz/10 giây, xác nhận âm phát từ extension không bị thu ngược và hai track dừng. Không thay thế API capture trong kiểm tra này.
- Chưa xác nhận Groq/AI thật bằng key người dùng, chất lượng dịch video/Meet/Zoom thực tế hoặc native capture trên Windows. Không coi các kiểm tra mô phỏng là kết quả dịch thật.
- Bản ZIP này không cập nhật hay gửi lại hồ sơ Chrome Web Store trước đó.
