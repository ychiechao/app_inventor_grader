# 超哥 App Inventor 學習幫手

提供 App Inventor 作業發布、AI 初評、正式繳交與教師管理。

## 網站路徑

- `/`：公開作業列表
- `/submit?id=作業ID`：學生初評與正式繳交
- `/teacher`：教師管理中心
- `/teacher/assignment?id=作業ID`：查看學生繳交、批次評分與評分紀錄

## 主要功能

- 教師建立作業後取得學生繳交連結。
- 作業可設定草稿、開放、關閉、排程開放與截止時間。
- 學生初評不需填寫身分，也不會儲存檔案。
- 正式繳交需要電子郵件、班級與座號。
- 正式檔名為 `原檔名_YYYYMMDD_班級_座號.aia`。
- 相同電子郵件重新正式繳交時，先詢問是否覆蓋；同意後更新原紀錄並取代舊檔。
- 評分分為功能介面需求 20 分、程式邏輯完成度 50 分、目標功能正確性 30 分。
- 教師可貼入有存取權限的 Google Drive 資料夾網址，依 `班級_座號_姓名.aia` 批次評分。
- 批次評分以班級與座號辨識學生；相同學生檔案未更新時略過，檔案更新時覆蓋最新評分。
- 批次結果寫入該作業試算表的 `batch_grading` 工作表，來源 Drive 檔案不會被刪除或移動。
- Apps Script 會自動建立作業索引，並匯入既有作業試算表。

## 批次評分

1. 將學生 `.aia` 放入 Google Drive 資料夾，檔名使用 `班級_座號_姓名.aia`。
2. 確認執行 Apps Script 的教師帳號可以讀取該資料夾。
3. 在教師作業管理頁貼入資料夾網址並按「掃描資料夾」。
4. 確認檔案清單後按「開始批次評分」，評分期間保持頁面開啟。
5. 個別檔案失敗不會中止其他檔案；修正後重新掃描即可再次評分。

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
