# 超哥 App Inventor 學習幫手

提供 App Inventor 作業發布、AI 初評、正式繳交與教師管理。

## 網站路徑

- `/`：公開作業列表
- `/submit?id=作業ID`：學生初評與正式繳交
- `/teacher`：教師管理中心
- `/teacher/assignment?id=作業ID`：查看學生繳交與評分

## 主要功能

- 教師建立作業後取得學生繳交連結。
- 作業可設定草稿、開放、關閉、排程開放與截止時間。
- 學生初評不需填寫身分，也不會儲存檔案。
- 正式繳交需要電子郵件、班級與座號。
- 正式檔名為 `原檔名_YYYYMMDD_班級_座號.aia`。
- 同班級與座號重新繳交時，更新原紀錄並取代舊檔。
- 評分分為功能介面需求 20 分、程式邏輯完成度 50 分、目標功能正確性 30 分。
- Apps Script 會自動建立作業索引，並匯入既有作業試算表。

## Cloudflare 環境變數

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `APPS_SCRIPT_WEB_APP_URL`
- `APPS_SCRIPT_TOKEN`
- `TEACHER_ACCESS_KEY`

請勿將實際密碼寫入 GitHub。`.env` 與 `.dev.vars` 已排除版本控制。

## Google Apps Script

1. 將 `apps-script/Code.gs` 更新到 Apps Script 專案。
2. 確認 `ROOT_FOLDER_ID` 是老師的 Google Drive 資料夾 ID。
3. 指令碼屬性 `APPS_SCRIPT_TOKEN` 必須與 Cloudflare 相同。
4. 建立新版本並重新部署網頁應用程式。

## 檢查與部署

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run cf:deploy
```
