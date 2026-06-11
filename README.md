# App Inventor 作業評分助手

教師可建立作業與評分標準，學生上傳 App Inventor `.aia` 原始檔後，由 OpenAI API 依功能完成度評分，並將結果寫入 Google 試算表。

## 專案架構

- `public/`：網站畫面
- `functions/`：Cloudflare Pages Functions
- `netlify/functions/`：原 Netlify Functions，搬移期間暫時保留
- `apps-script/Code.gs`：Google Apps Script，負責 Drive 與 Sheets

## Cloudflare 環境變數

在 Cloudflare Pages 專案中設定：

- `OPENAI_API_KEY`
- `OPENAI_MODEL`，目前預設為 `gpt-5.1`
- `APPS_SCRIPT_WEB_APP_URL`
- `APPS_SCRIPT_TOKEN`

請勿將實際金鑰寫入 GitHub。`.env` 與 `.dev.vars` 已排除上傳。

## Google Apps Script 設定

1. 將 `apps-script/Code.gs` 放入 Apps Script 專案。
2. 修改 `ROOT_FOLDER_ID` 為教師 Google Drive 資料夾 ID。
3. 到「專案設定」的「指令碼屬性」新增 `APPS_SCRIPT_TOKEN`。
4. 將 Apps Script 部署為網頁應用程式，並把網址設為 Cloudflare 的 `APPS_SCRIPT_WEB_APP_URL`。

## 本機檢查

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run cf:dev
```

## 部署

```powershell
npm.cmd run cf:deploy
```
