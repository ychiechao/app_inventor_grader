# App Inventor 作業評分助手

教師可建立作業與評分標準，學生上傳 App Inventor `.aia` 原始檔後，由 OpenAI API 依功能完成度評分，並將結果寫入 Google 試算表。

## 繳交流程

- 教師建立作業後會取得學生上傳連結，連結會自動帶入作業代碼。
- 學生可只上傳 `.aia` 取得初評，不必填寫個人資料，且初評不會留下正式紀錄。
- 正式繳交才需要電子郵件、班級與座號；檔名會改為 `原檔名_YYYYMMDD_班級_座號.aia`。
- 同一作業中，相同班級與座號重新繳交時會更新原紀錄並替換舊檔。
- 評分結果分為「功能介面需求」、「程式邏輯完成度」與「目標功能正確性」。

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

更新 `apps-script/Code.gs` 後必須建立新的 Apps Script 部署版本，正式繳交的改名與覆蓋功能才會生效。

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
