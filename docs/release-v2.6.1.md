## Nhấp đúp BAT để chạy VieNeu trên Windows

Tải **vieneu-local-v2.6.1.zip** bên dưới, giải nén toàn bộ, mở thư mục **companion** rồi nhấp đúp **start-vieneu.bat**.

- Tự chuẩn bị Python 3.12 64-bit bằng uv, cài các thư viện phù hợp với Windows. Nếu thiếu uv, bộ chạy gọi WinGet; làm theo yêu cầu cài đặt hiện trên màn hình. Máy không có WinGet sẽ được hướng dẫn cài uv.
- Lần đầu tải khoảng 580 MiB model cùng Python/thư viện. Đợi **Application startup complete**.
- Trong extension: **Đọc tiếng Việt → VieNeu local → Kết nối → chọn giọng → Nghe thử**.
- Giữ cửa sổ BAT mở khi dùng; **Ctrl+C** để dừng. Những lần sau nhấp đúp BAT, không cần gõ lệnh hay cài lại thư viện không thay đổi.
- Nếu có lỗi, cửa sổ giữ mở để đọc thông báo. Phải giữ BAT, PowerShell và các file Python cùng thư mục; không chỉ tải riêng BAT.

Helper này dùng được với extension **v2.6.0** đang cài. Extension **v2.6.1** chỉ cập nhật hướng dẫn/phiên bản; dịch trang, OCR, prompt và TTS giữ nguyên. Gói macOS vẫn có `start-vieneu.command`.

Đã kiểm tra trên Windows x64 của GitHub Actions: BAT khởi động, mở lại, lỗi cài đặt/thử lại và đường dẫn Unicode/khoảng trắng đều đạt. Model VieNeu thật trả 25 giọng và tạo 84.480 byte PCM 48 kHz cho câu thử. [Kết quả kiểm tra](https://github.com/nguyenduchoai/AI-Translation-Extension/actions/runs/36587076458). Kiểm tra model xác nhận tạo audio, không đánh giá chất lượng phát âm hay tốc độ trên máy người dùng. CI Linux tiếp tục chạy kiểm thử JavaScript và API Python.

ZIP không chứa model, API key, cache hoặc môi trường Python. Các file `.sha256` dùng kiểm tra tải xuống. Hồ sơ Chrome Web Store v2.5.0 không bị thay đổi.
