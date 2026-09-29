# AI Screen Translator — Privacy Policy

Last updated: 29 September 2026. Applies to version 2.6.0 and its optional VieNeu local companion. The pending version 2.5.0 Store submission retains its [existing policy](privacy-policy.md).

AI Screen Translator helps you translate loaded webpage text or translate/extract text from a selected screen area, and optionally read Vietnamese text aloud. The project is maintained by the GitHub account [nguyenduchoai](https://github.com/nguyenduchoai). This policy describes the published source code, not the independent policies of AI or voice providers.

## Information processed

- **Selected screen content.** After you start a capture and select a rectangle, Chrome captures the visible tab in memory. The extension crops that image locally and sends the selected image, your translation/OCR instructions, language and specialty settings to the AI provider you selected. It does not send the full uncropped screenshot to that provider. Images and resulting text may contain personal, dental/health, financial or other sensitive information if you include it in the selected area.
- **Webpage text.** Only when you press Translate page, eligible rendered text from the current main page is sent in batches to the selected AI provider with language, specialty and selected prompt instructions. The extension skips forms, input/editable fields, hidden text, code and embedded frames. Ordinary page text may still contain sensitive information. Translation changes existing text nodes; original text is kept in page memory for Restore, not in persistent translation history. A page reload discards this in-memory snapshot. Processing is limited to 600 text nodes / 60,000 characters per run; nodes over 4,000 characters are skipped.
- **Prompt templates.** Custom templates, selected template IDs and an unfinished editor draft are saved in `chrome.storage.local`. Only the selected saved instructions are included in AI requests; drafts are not sent. You can delete custom templates or discard a draft in Settings.
- **API credentials and settings.** You supply your own OpenAI or Google Gemini API key. Keys, provider/model selections and translation settings are saved using `chrome.storage.sync`; Chrome may synchronize them through your Google account when synchronization is enabled. A key is sent to its corresponding provider to authenticate requests. The extension does not maintain a developer-operated account or API proxy.
- **Translation history.** Up to 50 recent results, including cropped images, returned text, timestamps, model names, mode and token metadata, are stored in `chrome.storage.local` in your browser profile. History is not uploaded to a developer-operated server.
- **Speech.** When you choose VieNeu local, text selected for reading and the selected preset voice are sent to `http://127.0.0.1:8001` on your own computer. The companion generates speech locally and streams audio back to the extension. Its source does not intentionally save submitted text or generated audio. Runtime errors may appear in the local terminal. When you choose a browser voice, the text is passed to your browser/operating system speech service. That service may process text locally or remotely depending on the installed voice and platform; this is not a guarantee of offline processing.
- **Speech preferences.** Engine, voice and volume are stored locally. Text pasted into the speech input and the audio playback queue are not intentionally persisted by the extension.
- **Support and links.** If you choose to contact the project through GitHub or open an external link, that service receives the information you submit and ordinary connection information under its own policies. Do not post API keys, patient records or other private content in public GitHub issues.

The extension has no advertising, analytics, developer telemetry or sale of user data. It does not record microphones or meetings, collect a browsing-history log, or continuously capture pages. A selected screenshot can still contain a URL or any other text visible within the selected area.

## Third parties and purposes

The selected AI provider receives requests directly over HTTPS: OpenAI at `api.openai.com`, or Google Gemini at `generativelanguage.googleapis.com`. Requests are used to provide the translation/OCR or connection test you requested. Clicking **Test Server** sends a short test prompt even if no image is selected. Provider usage fees, retention, training policies and account settings are governed by that provider; the extension cannot delete data already received by it. Consult the applicable [OpenAI API data documentation](https://platform.openai.com/docs/guides/your-data) and [Gemini API terms](https://ai.google.dev/gemini-api/terms).

The optional VieNeu companion downloads its software dependencies and speech models during setup. Package/model hosts receive ordinary download connection information. Speech generation then runs on your computer. Installing the companion is optional and separate from installing the browser extension.

Version 2.6.0 also requests interface fonts from Google Fonts when its side panel or bundled guide is opened. Font hosts may receive ordinary connection metadata, such as IP address; translation images, text and API keys are not included in those font requests.

## Your choices and retention

Capturing a region or pressing Translate page initiates processing by your selected AI provider. Choose content you are permitted to share with that provider. Speech starts only when you request it or enable automatic reading for the current session. **Stop** cancels queued playback and requests as far as the receiving provider allows.

For webpage translation, Stop cancels further work and Restore replaces extension-owned text with its original content where the site has not changed it. Cancellation cannot retract requests already received by the provider.

Use the trash button in the side panel to clear translation history. New completed results replace the oldest stored results after the 50-item limit. Copies you exported as text files or copied to the clipboard remain under your control. Remove saved extension data through Chrome's extension/storage controls and manage synchronized data through Chrome Sync settings. Revoke an API key in the corresponding provider account to invalidate it. Uninstalling the extension does not revoke keys or delete copies already sent to providers, exported files, model caches or the separately installed companion.

No developer-operated server receives translation history or maintains a retention database for this extension. Provider-side retention and browser/OS voice processing remain subject to those services' own terms. Local data remains available until cleared, replaced under the history limit, or removed with the browser profile/extension storage.

## Limited use

AI Screen Translator uses user information only to provide the user-facing translation, OCR and speech features described here. It does not sell user information, use it for advertising, or use it to determine creditworthiness or lending eligibility. Its use and transfer of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Contact and updates

For privacy questions, use the project's [support page](https://github.com/nguyenduchoai/AI-Translation-Extension/issues). Public issues are visible to others; ask for an appropriate private contact channel before sharing personal information. Changes to this policy will be published here with an updated date.
