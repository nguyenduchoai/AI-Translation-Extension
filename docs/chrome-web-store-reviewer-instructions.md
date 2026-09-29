# Reviewer instructions — AI Screen Translator

Prepared for version 2.5.0. These instructions explain the real feature paths. They do not bypass paid-provider access or inject simulated translation results.

## Installation and basic interface

1. Install the submitted extension on Chrome 116 or later.
2. Open a normal HTTPS page with non-sensitive English text. Chrome internal pages and Chrome Web Store pages cannot be used as ordinary capture targets.
3. Click the extension action to open its side panel. Its interface language is Vietnamese.
4. Click the gear icon to open settings. `Nhà cung cấp AI` selects OpenAI or Gemini. `API Key` and model are required for translation/OCR.

## Translation and OCR

The extension uses bring-your-own-key access; there is no extension login. A valid API key for the selected provider, an image-capable model available to that account, and sufficient quota are needed. The publisher must arrange reviewer access through the dashboard's private review fields if required. No credential is included in the ZIP, public repository or this document.

1. Choose OpenAI or Gemini; enter an authorized review API key and compatible model. `Model khác…` accepts a model ID if the account does not expose a preset model.
2. Click `Test Server`. Expected: connection-success status. This sends a small real API request and may consume quota.
3. Choose translation (`Dịch thuật`), target `Tiếng Việt`, and specialty `Nha khoa`. Click `Lưu lại`.
4. On the test webpage, press Alt+Q or use the context-menu capture command. Drag a rectangle containing the text. Expected: region-selection UI closes and a Vietnamese translation streams into the side panel. The result includes the cropped source image. Escape cancels an in-progress selection.
5. Repeat with `Chỉ trích Text` selected. Expected: original-language text extraction rather than translation.
6. Use the copy button and export button. Expected: text copied/downloaded. Reload the panel: recent results persist. Use the trash button and confirm: history clears.

Suggested non-sensitive text to place on a page before capture: “Dental plaque can accumulate along the gumline. The measurement is 3.5 mm.” This is generic test text, not a patient record or treatment instruction.

## Vietnamese read-aloud without an AI key

1. Expand `Đọc tiếng Việt — Thử nghiệm`.
2. Select `Giọng trình duyệt`. This requires a Vietnamese voice installed/exposed by the browser or OS. Lack of such a voice is reported; the extension does not silently use an English voice.
3. Paste `Xin chào. Đây là bản thử đọc tiếng Việt.` into the text field and click `Đọc nội dung`.
4. Expected: Vietnamese speech, playback status, and first-audio timing. `Dừng` stops current and queued speech. Keep the side panel open during playback.

## Optional VieNeu local provider

This companion is optional; translation/OCR and compatible browser speech work independently of it. It is not a remote script loaded by the extension or an executable installed automatically by Chrome.

1. Download the separate `vieneu-local-v2.5.0.zip` from the project's GitHub release. On macOS, run `companion/start-vieneu.command` with Python 3.12 or `uv` available. Other setup details are in the companion README.
2. Allow setup to install dependencies and download approximately 580 MiB of model files on first use. Wait until the local service is ready at `127.0.0.1:8001`.
3. In the side panel choose `VieNeu local`, click `Kết nối`, select a voice, then `Nghe thử`.
4. Expected: real locally generated speech streams into the browser. If the companion is absent, the extension shows an actionable connection error.
5. Optionally enable `Tự đọc từng câu khi AI dịch` and perform a Vietnamese translation. Completed sentences are read while the AI response continues. OCR mode and non-Vietnamese target languages are not read automatically.

The local model does not run entirely inside the browser. This build does not capture microphones or meeting audio, translate Meet/Zoom calls, or send generated speech to other call participants.

## Submission-specific items still needed

- Version 2.5.0 has been uploaded as draft item `bikabhabjbgncdjlehogglgepofcjoge` under publisher `a9658b75-5c38-4483-af78-278258b08dae`. The owner has confirmed non-trader status; public contact validation and confirmation of saved account declarations remain pending. Draft upload is not submission for review or approval.
- If Google requires private test credentials, provide a dedicated review credential through the private dashboard field. A missing credential is not evidence that API translation was tested.
- Confirm `https://github.com/nguyenduchoai/AI-Translation-Extension/blob/main/docs/privacy-policy.md` is public after publishing the document, and the screenshots depict the submitted build.
- Record the exact submitted ZIP version/checksum and dashboard status separately; preparation is not submission or approval.
