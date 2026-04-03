<p align="center">
  <img src="screenshots/banner.png" alt="AI Screen Translator Banner" width="100%">
</p>

<h1 align="center">🌐 AI Screen Translator</h1>

<p align="center">
  <strong>Chụp vùng màn hình → Chia đôi trình duyệt → AI đọc & dịch tức thì</strong><br>
  Hỗ trợ đọc truyện, PDF/ebook bị khóa copy • Streaming real-time • Chrome Side Panel
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.2.0-blueviolet?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/manifest-v3-blue?style=for-the-badge" alt="Manifest V3">
  <img src="https://img.shields.io/badge/AI-OpenAI_GPT--4o-green?style=for-the-badge" alt="OpenAI">
  <img src="https://img.shields.io/badge/license-MIT-yellow?style=for-the-badge" alt="License">
</p>

---

## ✨ Tính năng Nổi bật (v2.2.0)

| Tính năng | Mô tả |
|-----------|-------|
| 🖥️ **Chrome Side Panel** | Dịch thuật theo cơ chế Split-screen nguyên bản trình duyệt, không làm vỡ giao diện web |
| ⚡ **Streaming Response** | Text tiếng Việt hiện real-time từng chữ giống hệt ChatGPT |
| 📝 **OCR Mode** | Trích xuất văn bản từ hình ảnh/truyện tranh — copy text từ PDF bị khóa |
| 🧪 **Thiết lập nhanh gọn** | Cài đặt API Key và Modal nằm rọ gọn trong Bánh răng (⚙) của Side Panel |
| 🤖 **Multi-Model** | Hỗ trợ GPT-4o (tốt nhất) / GPT-4o-mini (siêu tiết kiệm) / GPT-4.5 |
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
git clone https://github.com/nguyenduchoai/ai-translate-extension.git
```

1. Mở Chrome → gõ `chrome://extensions/`
2. Bật **Developer mode** (góc trên trành duyệt)
3. Click **"Load unpacked"**
4. Chọn thư mục `ai-translate-extension`
5. **Ghim 📌 extension lên thanh công cụ** để tiện sử dụng.

### Cách 2: Bằng file ZIP

1. Tải file `ai-translate-extension-v2.2.0.zip` từ [Releases](../../releases)
2. Giải nén vào một thư mục
3. Load unpacked thư mục đó tương tự Cách 1.

## ⚙️ Cấu hình API

1. **Click icon Extension** 🌐 trên toolbar để mở khóa giao diện **Side Panel** bên phải màn hình.
2. Click biểu tượng **Bánh răng (⚙️)** để mở giao diện cài đặt.
3. Nhập **OpenAI API Key** (vào [platform.openai.com/api-keys](https://platform.openai.com/api-keys) để lấy key).
4. Click **🧪 Test Server** để kiểm tra mạng internet và API.
5. Cuối cùng, nhấn **💾 Lưu lại**

## 🎯 Cách sử dụng

### Dịch thuật nhanh

```
Alt + Q  →  Kéo chuột tạo khung chữ nhật  →  AI xuất luồng chữ chạy lập tức ⚡
```

Hoặc sử dụng chuột: **Chuột phải** trên trình duyệt → **🌐 Chụp & Dịch vùng này**

### Trích xuất text đơn thuần (Copy text truyện/ảnh)

1. Mở Cài đặt trong Side Panel (⚙️) → Chọn **📝 Chỉ trích Text**
2. Nhấn `Alt + Q` quét đoạn cần lấy $\Rightarrow$ extension sẽ gõ ra đúng hệt nguyên bản để bạn Copy.

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

## 📝 Changelog

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
