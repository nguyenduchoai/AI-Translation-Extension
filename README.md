<p align="center">
  <img src="screenshots/banner.png" alt="AI Screen Translator Banner" width="100%">
</p>

<h1 align="center">🌐 AI Screen Translator</h1>

<p align="center">
  <strong>Chụp vùng màn hình → Chia đôi trình duyệt → AI đọc & dịch tức thì</strong><br>
  Hỗ trợ đọc truyện, PDF/ebook bị khóa copy • Streaming real-time • Chrome Side Panel
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.6.0-blueviolet?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/manifest-v3-blue?style=for-the-badge" alt="Manifest V3">
  <img src="https://img.shields.io/badge/AI-OpenAI_+_Gemini-green?style=for-the-badge" alt="OpenAI">
  <img src="https://img.shields.io/badge/license-MIT-yellow?style=for-the-badge" alt="License">
</p>

---

## ✨ Tính năng Nổi bật (v2.6.0)

| Tính năng | Mô tả |
|-----------|-------|
| 🌐 **Dịch trang web** | Thay chữ ngay trên trang, giữ liên kết/định dạng; có tiến độ, Dừng và Bản gốc |
| 🧩 **Mẫu prompt** | Chọn mẫu sát nghĩa, tự nhiên, học thuật hoặc tạo/sửa/xóa mẫu riêng; OCR có mẫu độc lập |
| 🖥️ **Chrome Side Panel** | Dịch thuật theo cơ chế Split-screen nguyên bản trình duyệt, không làm vỡ giao diện web |
| ⚡ **Streaming Response** | Text tiếng Việt hiện real-time từng chữ giống hệt ChatGPT |
| 📝 **OCR Mode** | Trích xuất văn bản từ hình ảnh/truyện tranh — copy text từ PDF bị khóa |
| 🧪 **Thiết lập nhanh gọn** | Cài đặt API Key và model nằm gọn trong Bánh răng (⚙) của Side Panel |
| 🤖 **Multi-Model** | OpenAI GPT-4o / GPT-4o-mini và Google Gemini; nhập mã model khác nếu cần |
| 🦷 **Dịch nha khoa** | Prompt riêng cho nha khoa, chỉnh nha, implant, nội nha, nha chu, phục hình, phẫu thuật miệng và nha khoa trẻ em |
| 🔊 **Đọc tiếng Việt** | Đọc từng câu AI trả về bằng VieNeu local hoặc giọng Việt có sẵn trong browser; có Dừng, Nghe lại, đo thời gian tới âm thanh đầu |
| 🌍 **9 ngôn ngữ** | Việt, Anh, Trung, Nhật, Hàn, Pháp, Đức, Tây Ban Nha, Thái |
| 💾 **Lưu lịch sử & Export**| Tự động lưu 50 bản dịch gần nhất, hỗ trợ tải về dưới dạng `.txt` |

## 📸 Screenshots

*(Hình ảnh minh họa Giao diện Side Panel)*

<p align="center">
  <img src="screenshots/result-panel.png" alt="Translation Result Panel" width="480">
</p>

## 🚀 Cài đặt

### Cách 1: Từ mã nguồn

```bash
# Clone repo
git clone https://github.com/nguyenduchoai/AI-Translation-Extension.git
```

1. Mở Chrome → gõ `chrome://extensions/`
2. Bật **Developer mode** (góc trên trành duyệt)
3. Click **"Load unpacked"**
4. Chọn thư mục `AI-Translation-Extension` (thư mục chứa `manifest.json`)
5. **Ghim 📌 extension lên thanh công cụ** để tiện sử dụng.

### Cách 2: Bằng file ZIP

1. Tải file `ai-translate-extension-v2.6.0.zip` từ [Releases](https://github.com/nguyenduchoai/AI-Translation-Extension/releases/latest)
2. Giải nén vào một thư mục
3. Load unpacked thư mục đó tương tự Cách 1.

## ⚙️ Cấu hình API

1. **Click icon Extension** 🌐 trên toolbar để mở khóa giao diện **Side Panel** bên phải màn hình.
2. Click biểu tượng **Bánh răng (⚙️)** để mở giao diện cài đặt.
3. Chọn **Nhà cung cấp AI**: **Google Gemini** hoặc **OpenAI**.
4. Nhập key tương ứng: [Google AI Studio](https://aistudio.google.com/apikey) cho Gemini, hoặc [OpenAI](https://platform.openai.com/api-keys).
5. Chọn model. Gemini mặc định `gemini-3.8-flash`, có `gemini-3.5-flash-lite`; **Model khác…** cho phép nhập mã model hỗ trợ ảnh có sẵn trong tài khoản.
6. Chọn **Dịch thuật → Nha khoa** hoặc phân ngành phù hợp, ngôn ngữ đích **Tiếng Việt**.
7. Click **🧪 Test Server**, rồi **💾 Lưu lại**. Test có gửi một yêu cầu nhỏ tới API; quota/chi phí theo tài khoản nhà cung cấp.

API key và model của hai nhà cung cấp được lưu riêng. Bản nâng cấp giữ lại cài đặt OpenAI cũ. Cài đặt dùng `chrome.storage.sync` và có thể đồng bộ qua Chrome; lịch sử ảnh/bản dịch nằm trong `chrome.storage.local`. Khi chụp vùng, chỉ ảnh đã cắt được gửi tới AI. Khi bấm **Dịch trang**, phần chữ phù hợp đã tải của trang được gửi theo từng đợt. Mẫu prompt và bản nháp được lưu cục bộ. Xem [chính sách riêng tư v2.6.0](docs/privacy-policy-v2.6.0.md).

### Prompt nha khoa

Prompt giữ cấu trúc, thuật ngữ chuyên ngành, số răng/hệ đánh số, liều lượng, đơn vị, nồng độ, trích dẫn và các phủ định trong nguồn. Không tự thêm chẩn đoán, khuyến nghị hay dữ kiện không có trong ảnh; chỗ mờ được đánh dấu. Bản dịch chỉ xuất ngôn ngữ đích, không tự thêm bản song ngữ. Chế độ **Chỉ trích Text** dùng prompt OCR riêng, không dịch.

Triển khai Gemini dựa trên [GenerateContent/streamGenerateContent](https://ai.google.dev/api/generate-content), [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) và [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite). Quyền truy cập model phụ thuộc tài khoản API.

## 🎯 Cách sử dụng

### Dịch trang web

1. Mở trang cần dịch → mở side panel → **⚙️** chọn nhà cung cấp, ngôn ngữ, chuyên ngành và lưu cấu hình.
2. Bấm **Dịch trang**. Chữ được thay ngay trong trang theo từng đợt; liên kết và các phần tử hiện có được giữ lại.
3. **Dừng** ngắt xử lý tiếp, giữ phần đã dịch. **Bản gốc** khôi phục phần chữ extension đã thay. Nội dung website tự cập nhật được giữ nguyên.
4. Muốn đổi ngôn ngữ/mẫu, lưu cấu hình rồi bấm **Dịch trang** lại. Trang sẽ được khôi phục trước khi dịch lại.

Chỉ xử lý chữ đã tải trong trang chính; không dịch ảnh, PDF viewer, iframe, shadow DOM, ô nhập liệu, biểu mẫu hoặc vùng soạn thảo. Nội dung tải thêm cần bấm dịch lại. Mỗi lượt tối đa 600 đoạn/60.000 ký tự; đoạn đơn trên 4.000 ký tự được bỏ qua và có thông báo giới hạn. Dịch trang gửi chữ tới AI anh/chị đã chọn, có thể phát sinh chi phí theo API. Không tự đọc toàn bộ trang bằng TTS; chức năng tự đọc vẫn áp dụng luồng dịch ảnh trong panel.

### Chọn và sửa mẫu prompt

Trong **⚙️ → Mẫu prompt**, chọn **Dịch ảnh / trang web** hoặc **Chỉ trích text / OCR**. Mỗi loại giữ mẫu được chọn riêng; dịch trang luôn dùng mẫu dịch kể cả khi chế độ chụp đang là OCR.

- Chọn mẫu có sẵn để áp dụng cho lượt tiếp theo: sát nghĩa theo chuyên ngành, tự nhiên, học thuật, OCR nguyên văn hoặc OCR giữ bố cục.
- Sửa tên/chỉ dẫn rồi **Lưu thành mẫu mới**. Với mẫu riêng, dùng **Lưu thay đổi**, **Xóa mẫu** hoặc **Bỏ sửa**.
- Có thể dùng `{{targetLanguage}}` và `{{specialty}}` trong chỉ dẫn mẫu dịch. Chỉ dẫn bổ sung cách diễn đạt; vẫn giữ dữ kiện gốc và không biến OCR thành dịch thuật.
- Mẫu và bản nháp lưu trên máy, tối đa 20 mẫu riêng/4.000 ký tự mỗi mẫu. Đóng/mở panel giữ bản sửa chưa lưu; chỉ **Lưu** mới áp dụng. Chọn/lưu mẫu không cần nhập API key.

### Dịch thuật nhanh

```
Alt + Q  →  Kéo chuột tạo khung chữ nhật  →  AI xuất luồng chữ chạy lập tức ⚡
```

Hoặc sử dụng chuột: **Chuột phải** trên trình duyệt → **🌐 Chụp & Dịch vùng này**

### Trích xuất text đơn thuần (Copy text truyện/ảnh)

1. Mở Cài đặt trong Side Panel (⚙️) → Chọn **📝 Chỉ trích Text** → **💾 Lưu lại**
2. Nhấn `Alt + Q` quét đoạn cần lấy $\Rightarrow$ extension sẽ gõ ra đúng hệt nguyên bản để bạn Copy.

### Đọc câu trả lời AI bằng tiếng Việt (v2.5.0)

**Đã triển khai TTS**, chưa có thu âm/nhận dạng/dịch cuộc họp Meet hoặc Zoom. VieNeu tạo giọng trong Python trên máy; extension nhận PCM streaming và phát trong trình duyệt. Không quảng cáo model VieNeu chạy hoàn toàn trong browser.

1. Tải thêm **`vieneu-local-v2.6.0.zip`** trong [Releases](https://github.com/nguyenduchoai/AI-Translation-Extension/releases/latest), giải nén và mở **`start-vieneu.command`** trên macOS. Cần Python 3.12 hoặc `uv`; xem [hướng dẫn VieNeu local](companion/README.md). Lần đầu tải khoảng 580 MiB model, ngoài các thư viện Python.
2. Đợi ứng dụng VieNeu báo sẵn sàng. Trong extension, mở **🔊 Đọc tiếng Việt → VieNeu local → Kết nối**.
3. Chọn giọng và **Nghe thử**. Có thể dán bất kỳ câu trả lời AI bằng tiếng Việt vào ô văn bản rồi bấm **Đọc nội dung**, không cần API key dịch.
4. Bật **Tự đọc từng câu khi AI dịch** rồi chụp/dịch ảnh như trước. Câu hoàn chỉnh được gửi tới VieNeu ngay khi AI trả chữ, không đợi hết bài.
5. **Dừng** hủy lượt tạo giọng và hàng đợi; nút 🔊 cạnh mỗi đoạn cho phép nghe lại. Giữ side panel mở để duy trì phát. Bật tự đọc là lựa chọn trong phiên, không tự bật lại khi mở panel.

Tự đọc áp dụng cho bản dịch đích tiếng Việt; OCR và ngôn ngữ đích khác không tự đọc. Có giới hạn hàng đợi để tránh đọc trễ quá lâu; lỗi sẽ hiện rõ, không âm thầm bỏ câu. Số thập phân và các chữ viết tắt phổ biến được giữ trong cùng đoạn.

**Giọng trình duyệt** là lựa chọn không cần VieNeu local nếu máy đã có giọng `vi-VN`; danh sách phụ thuộc hệ điều hành/browser. Đã thử giọng Linh trên máy Mac này. Đây không phải VieNeu và không phải edge-tts. Extension không tự đổi nhà cung cấp giọng khi xảy ra lỗi.

Số đo **Âm thanh đầu** trong panel tính từ lúc gửi một câu đến lúc sẵn sàng phát đoạn âm thanh đầu, không bao gồm thời gian AI dịch và không phải phép đo âm thanh vật lý ở loa. Tốc độ phụ thuộc giọng, văn bản, máy và trạng thái model. Chưa có suy luận VieNeu hoàn toàn trong browser.

### Phím tắt mặc định

| Phím | Chức năng |
|------|-----------|
| `Alt + Q` | Kích hoạt con trỏ cắt màn hình |
| `ESC` | Hủy việc đang chọn vùng |

> 💡 *Bạn có thể thay đổi phím tắt trong `chrome://extensions/shortcuts`*

## 🏗️ Cấu trúc thư mục (v2.2)

```
ai-translate-extension/
├── manifest.json      # Chrome Extension config (Hỗ trợ Side Panel permission)
├── background.js      # Service Worker: Logic screenshot, bắt API streaming, push data
├── content.js         # Content Script: Tool cắt ảnh trên web, con trỏ crosshair
├── content.css        # Reset layout an toàn
├── sidepanel.html     # Giao diện Native Side Panel (Chia đôi web)
├── sidepanel.js       # UI logic: streaming, lưu trữ, config, nút copy/xóa
└── ...
```

## Kiểm tra và đóng gói

Yêu cầu Node.js 20+ và Python 3; không cần cài thư viện ngoài.

```bash
npm test
npm run package
# Hoặc kiểm tra phiên bản tag trước khi phát hành:
python3 scripts/package-extension.py --tag v2.6.0
```

ZIP nằm tại `dist/ai-translate-extension-v2.6.0.zip`, có `manifest.json` ngay gốc. Giải nén rồi **Load unpacked**; Chrome không nạp trực tiếp file ZIP. Khi cập nhật bản cũ, thay nội dung trong đúng thư mục đã nạp rồi bấm **Reload** tại `chrome://extensions/` để giữ ID/cài đặt.

Workflow `.github/workflows/release.yml` chạy test, đóng ZIP chỉ gồm file runtime và đính kèm checksum vào Release khi push tag `v*`. Test tự động dùng phản hồi API mô phỏng; xác nhận dịch thật cần API key của nhà cung cấp.

## 📝 Changelog

### v2.6.0 (2026-09-29)
- Dịch chữ trực tiếp trên trang bằng OpenAI/Gemini; tiến độ, Dừng và khôi phục Bản gốc.
- Bỏ qua biểu mẫu/vùng soạn thảo; bảo toàn nội dung website tự cập nhật và chặn phản hồi cũ sau khi hủy/chuyển trang.
- Mẫu dịch/OCR độc lập; chọn mẫu có sẵn hoặc tạo, chỉnh sửa, xóa mẫu riêng; giữ bản nháp khi đóng panel.
- Bản 2.5.0 đã gửi Chrome Web Store vẫn giữ nguyên trong lúc chờ xét duyệt; bản 2.6.0 phát hành ZIP riêng.

### v2.5.0 (2026-09-29)
- Thêm giọng đọc VieNeu local: nhận PCM streaming, phát từng câu AI trả về, dán văn bản để nghe, nghe lại từng đoạn, Dừng/hủy và điều chỉnh âm lượng.
- Thêm giọng tiếng Việt của trình duyệt khi máy có sẵn.
- Tách bộ khởi động VieNeu local thành ZIP riêng; không đóng model, cache hoặc môi trường Python vào extension.
- Kiểm tra thật trên M2 Pro: mẫu nha khoa 6,08 giây audio, byte đầu 0,347 giây, tạo xong 1,875 giây khi model đã nóng. Các số đo không xác nhận chất lượng lâm sàng/phát âm.
- Chưa tích hợp thu âm hay phiên dịch Meet/Zoom; TTS là bước đã hoàn thành.

### v2.4.0 (2026-09-29)
- Thêm Google Gemini cho dịch ảnh, OCR và streaming; key/model riêng cho từng nhà cung cấp.
- Làm rõ prompt nha khoa và các phân ngành, giữ dữ kiện gốc và đánh dấu chữ không rõ.
- Sửa khởi tạo nút Copy/Export; hỗ trợ mã model tùy chỉnh.
- Có ZIP cài đặt và SHA-256 trên Releases; tự đóng gói khi đẩy tag phiên bản.

### v2.3.0 (2026-04-03)
- Thêm lựa chọn chuyên ngành và prompt dịch học thuật.

### v2.2.0 (2026-04-03)
- 🖥️ Nâng cấp toàn diện kiến trúc UI sang **Chrome Side Panel API**.
- ✂️ Loại bỏ Popup rườm rà, gộp Settings (Cài đặt) thẳng vào Side Panel.
- 🖱️ Nhấn icon extension tự mở Side panel lập tức.
- 🪲 Sửa dứt điểm lỗi bóng mờ đen (Zombie Injections) khi ấn nút nhiều lần.
- 👻 Màn hình cắt ảnh (selection) được làm trong suốt 100% không bị mờ đen.

### v2.0.0 (2026-04-03)
- ⚡ Streaming response (Tách stream chữ).
- 📝 OCR-only mode (Model Vision).
- 🖱️ Tính năng Context Menu.

### v1.0.0 
- 🎉 Initial framework release.

## 📄 License
MIT License. Tự do sửa đổi, biên dịch và nâng cấp theo mục đích cá nhân.

---

<p align="center">
  Made with ❤️ for Vietnamese readers<br>
  <sub>By <a href="https://github.com/nguyenduchoai">nguyenduchoai</a></sub>
</p>
