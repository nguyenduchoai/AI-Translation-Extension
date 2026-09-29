# Giọng đọc VieNeu chạy trên máy

Dịch vụ này dùng **VieNeu v3 Turbo**, backend ONNX CPU **fp32**, phát PCM16 mono 48 kHz theo từng đoạn. Trình duyệt phát âm thanh; model chạy trong Python trên máy. Không gửi văn bản tới dịch vụ TTS bên ngoài. Lần khởi động đầu cần Internet để tải model từ Hugging Face. Sau khi tải đủ, model có thể chạy offline.

## Khởi động trên macOS

Có Python 3.12 hoặc [uv](https://docs.astral.sh/uv/getting-started/installation/). Mở Terminal tại thư mục mã nguồn rồi chạy:

```bash
bash companion/start-vieneu.command
```

Hoặc nhấp đúp `start-vieneu.command`. Giữ cửa sổ Terminal đang mở. Đợi dòng `Application startup complete`. Dịch vụ chỉ nghe tại `http://127.0.0.1:8001`. Lần đầu sẽ cài thư viện vào `.venv/`, tải model vào `.cache/` và đọc thử một câu để làm nóng model; các thư mục này không được đưa lên Git. Dùng Ctrl+C để dừng.

Mac ARM dùng fp32 vì bản int8 upstream yêu cầu CPU VNNI. Backend này có một lượt tạo âm thanh tại một thời điểm; extension xếp hàng câu và hủy lượt đang đọc khi bấm Dừng.

## API

Tất cả yêu cầu phải có `X-AI-Translator: 1`. Origin trình duyệt chỉ được phép là `chrome-extension://…`, `http://localhost[:port]` hoặc `http://127.0.0.1[:port]`. Host phải là localhost/127.0.0.1. Không mở port ra mạng LAN.

- `GET /health`: trạng thái sẵn sàng và `sampleRate: 48000`.
- `GET /voices`: `{ "voices": [{ "id": "Mai Anh", "name": "…" }] }`.
- `POST /speech`: `{ "text": "Xin chào.", "voice": "Mai Anh" }`; tối đa 1.200 ký tự. Không truyền voice để dùng giọng mặc định.
- Phản hồi: `Content-Type: audio/pcm`, `X-Sample-Rate: 48000`, `X-Audio-Channels: 1`; PCM16 signed little-endian không có WAV header. Âm thanh bắt đầu trả về ngay khi model có chunk đầu.
- `422`: dữ liệu không hợp lệ; `429`: CPU đang xử lý câu khác; `503`: model không tạo được chunk đầu. Lỗi sau khi bắt đầu stream sẽ ngắt kết nối.

Ngắt kết nối HTTP hủy hàng đợi và dừng model khi nó trả chunk kế tiếp. Không cam kết dừng tức thì trong một phép tính ONNX đang chạy.

## Kiểm tra

Các lệnh dưới áp dụng bản mã nguồn GitHub; ZIP helper không chứa tests và benchmark.

```bash
companion/.venv/bin/python -m unittest discover -s companion -p 'test_*.py'
# Khi server đã sẵn sàng: đo model thật, lưu WAV và số đo vào outputs/.
companion/.venv/bin/python companion/benchmark.py
```

Tests API dùng model giả để kiểm tra ràng buộc Origin/Host/header, định dạng PCM, lỗi và hủy hàng đợi. `benchmark.py` gọi model thật, đo thời gian nhận byte đầu, tổng thời gian tạo tiếng và độ dài audio. Số đo không tương đương chất lượng phát âm hoặc kiểm thử cuộc họp.

## Nguồn và giấy phép

[VieNeu-TTS chính thức](https://github.com/pnnbao97/VieNeu-TTS), Apache-2.0; [model v3 Turbo](https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo). `requirements.in` ghim gói trực tiếp; `requirements.txt` ghim toàn bộ môi trường đã thử. Model tải riêng, không nằm trong ZIP extension.

## Kết quả chạy thật ngày 2026-09-29

Trên Apple M2 Pro, 32 GB RAM, Python 3.12; model đã được làm nóng:

| Phép đo | Kết quả |
|---|---:|
| Câu mẫu | “Răng hàm có dấu hiệu viêm nha chu. Bác sĩ cần đánh giá mô quanh răng trước khi lập kế hoạch điều trị.” |
| Giọng | Mai Anh |
| Byte âm thanh đầu tiên | 0,347 giây |
| Tạo xong âm thanh | 1,875 giây |
| Độ dài âm thanh | 6,08 giây |
| Model Turbo đã tải | 494,06 MiB |
| Codec đã tải | 86,38 MiB |
| Giọng có sẵn | 25 |
| Ngắt HTTP → nhả lượt tạo tiếng | 0,088 giây |

WAV kiểm thử được lưu tại `outputs/dental-vieneu.wav`; số đo JSON tại `outputs/benchmark.json` (cả hai chỉ ở máy local). Đây là phép đo một câu, không phải cam kết tốc độ cho mọi văn bản. Chưa chấm chất lượng phát âm bằng người nghe hoặc kiểm thử cuộc họp Meet/Zoom.

Model snapshot đã chạy: VieNeu `61b85e3d937fbbacb387714180e8182823512523`, codec `ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae`. Model upstream có thể cập nhật ở lần tải sau; số đo trên áp dụng hai snapshot này.

ONNX Runtime 1.30 kiểm tra đường dẫn dữ liệu ngoài graph. `model_cache.py` dùng chế độ HF sao chép file và chuyển các symlink cache cũ thành file thật để graph/weights nằm cùng thư mục. Không tắt cơ chế kiểm tra của ONNX Runtime. Cache đã tải bằng symlink trước khi sửa có thể chiếm khoảng gấp đôi dung lượng model.
