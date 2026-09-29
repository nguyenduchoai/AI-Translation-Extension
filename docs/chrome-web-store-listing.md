# Chrome Web Store listing — submission copy

Prepared from version 2.5.0 source, 29 September 2026. The package has been uploaded as a Chrome Web Store draft; this is not submission for review or approval. Update version-dependent facts if the package changes.

## Fields

| Field | Value |
|---|---|
| Name | AI Screen Translator |
| Primary language | Vietnamese |
| Category | Tools (Công cụ), under Productivity |
| Homepage | https://github.com/nguyenduchoai/AI-Translation-Extension |
| Support | https://github.com/nguyenduchoai/AI-Translation-Extension/issues |
| Privacy policy | https://github.com/nguyenduchoai/AI-Translation-Extension/blob/main/docs/privacy-policy.md |

Publisher identity and contact email must match the owner's actual account details; this document does not invent those values. The owner has confirmed non-trader (phi thương mại) status.

Current Store status (29 September 2026): version 2.5.0 uploaded and submitted; Dashboard reports **Pending review / Đang chờ xem xét**. Item ID: `bikabhabjbgncdjlehogglgepofcjoge`. Publisher ID: `a9658b75-5c38-4483-af78-278258b08dae`. Owner confirmed non-trader and authorized `nguyenduchoai@gmail.com` as public contact. Approval/public availability is not yet confirmed. See `chrome-web-store-submission.md` for evidence.

## Short description

Chụp vùng màn hình để dịch hoặc trích xuất chữ với Gemini/OpenAI; hỗ trợ thuật ngữ nha khoa và đọc tiếng Việt.

## Detailed description — Vietnamese

AI Screen Translator giúp anh/chị đọc nội dung trên trình duyệt bằng cách chọn một vùng ảnh và nhận bản dịch ngay trong bảng bên cạnh trang web.

Tính năng:
- Nhấn Alt+Q hoặc chọn menu chuột phải, kéo khung quanh nội dung cần dịch.
- Chọn OpenAI hoặc Google Gemini và dùng API key của mình.
- Xem kết quả xuất hiện từng phần trong Chrome Side Panel.
- Trích xuất chữ từ vùng ảnh bằng chế độ OCR.
- Dịch sang 9 ngôn ngữ; có hướng dẫn dịch chuyên ngành nha khoa và các phân ngành.
- Lưu tối đa 50 kết quả gần nhất trên máy, sao chép, xuất file văn bản và xóa lịch sử.
- Đọc tiếng Việt bằng giọng có sẵn trong trình duyệt hoặc VieNeu local; chọn giọng, dừng và nghe lại. Có thể dán văn bản để nghe hoặc bật tự đọc từng câu bản dịch mới.

Yêu cầu sử dụng:
- Chrome 116 trở lên.
- Dịch và OCR cần API key hợp lệ, model hỗ trợ ảnh và quota của OpenAI hoặc Gemini. Phí/quota áp dụng theo nhà cung cấp; extension không bao gồm tín dụng API.
- Giọng trình duyệt cần máy có giọng tiếng Việt tương thích.
- VieNeu là lựa chọn riêng: cần cài và chạy bộ đồng hành trên máy, tải model lần đầu. Model VieNeu chạy trong dịch vụ local; trình duyệt nhận và phát âm thanh. Không cần VieNeu để sử dụng dịch/OCR.

Dữ liệu: chỉ vùng ảnh đã chọn được gửi tới nhà cung cấp AI mà anh/chị chọn. API key và cài đặt dùng Chrome Sync; ảnh và lịch sử dịch lưu trong trình duyệt. Giọng đọc của trình duyệt có thể dùng dịch vụ online tùy hệ điều hành/giọng. Xem chính sách quyền riêng tư để biết đầy đủ luồng xử lý dữ liệu.

Bản hiện tại chưa thu âm, nhận dạng hay phiên dịch cuộc họp Meet/Zoom. Nội dung dịch bằng AI cần được kiểm tra lại, đặc biệt với thuật ngữ, số liệu và tài liệu chuyên ngành. Tiện ích hỗ trợ đọc hiểu, không cung cấp chẩn đoán hay quyết định điều trị.

## Single purpose — English

Help users understand selected visible browser content by translating or extracting text from a user-selected screen region in a side panel, with optional Vietnamese read-aloud for that text.

## Permission justifications — English

| Permission | Submission explanation |
|---|---|
| `activeTab` | Access the user-activated tab to capture its visible pixels after the user explicitly starts a region capture. Only the chosen crop is sent to the selected AI provider. |
| `storage` | Save AI provider/model and language settings and API credentials using Chrome Sync, and store up to 50 recent cropped images/results and speech preferences locally. |
| `scripting` | Insert the packaged region-selection interface into the active page when the user starts a capture and that interface is not already available. |
| `contextMenus` | Add the user-invoked capture/translate command to the page context menu. |
| `sidePanel` | Display settings, streaming translations, history and optional read-aloud controls alongside the current page. |

Current v2.5.0 additionally requests `<all_urls>` and installs a static content script across supported pages. Do not invent a narrower justification for that package. Its implemented purpose is to provide region-selection UI on arbitrary user-selected pages and permit API/local speech requests. **Recommended before submission:** replace the broad host grant with the two AI API hosts and loopback endpoint, and inject the selection interface using `activeTab` only on user action. If changed, use the following host justification instead:

> `https://api.openai.com/*` and `https://generativelanguage.googleapis.com/*` allow requests to the user's selected translation/OCR provider using their own API key. `http://127.0.0.1/*` allows optional streaming speech from the companion service on the user's computer. Requests to the companion use port 8001. No host grant is used for advertising or browsing-history collection.

## Remote code — English

The extension's JavaScript is included in its ZIP. It does not download or execute remote JavaScript or WebAssembly. AI API responses are handled as text/data, and local companion responses as audio data. The optional Python companion is installed and run separately by the user, outside the extension. Version 2.5.0 requests Google Fonts styles/fonts; those are interface resources, not remote JavaScript. Declare **No** to executing remotely hosted code only while this remains true for the actual uploaded package.

## Data-use declarations

Do not declare “no user data collected”: chosen content is transmitted to AI providers and API credentials are handled by the extension, even though there is no developer-operated backend.

At minimum, disclose **Website content** and **Authentication information**. The dental feature and arbitrary selected screenshots can also process **Health information**, **Personally identifiable information**, **Personal communications**, and **Financial and payment information** when users include them. Conservatively disclose these content categories with the explanation that they are user-selected content, not targeted background collection. Do not claim browsing-history logging, location tracking or user-activity analytics; none is implemented. Reconcile the current dashboard definitions and the final package before certifying.

The source has no data sales, advertising, lending decisions or developer analytics. Certifications must describe actual behavior and any future changes, not just this prepared text.

## Required assets and publication checks

- Extension ZIP with `manifest.json` at its root; submit the extension ZIP only, not the VieNeu helper ZIP.
- PNG icon 128×128. Use `icons/icon128.png` after visual inspection.
- At least one actual product screenshot, preferably 1280×800; 640×400 is also supported. Never include API keys or private health records.
- Small promotional image 440×280. Optional marquee 1400×560. Use screenshots of current behavior; do not illustrate unsupported live meetings.
- Public, accessible privacy-policy URL that matches the package and Store privacy declarations.
- Owner account registration, verified contact information and any dashboard-required identity/payment steps.
- Reviewer access/instructions for API-backed features; do not place a personal production API key in public documents.

Official references: [privacy fields and minimum permissions](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [listing fields](https://developer.chrome.com/docs/webstore/cws-dashboard-listing), [image requirements](https://developer.chrome.com/docs/webstore/images), [privacy policy requirements](https://developer.chrome.com/docs/webstore/program-policies/privacy).
