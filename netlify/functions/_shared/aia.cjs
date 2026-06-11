async function summarizeAia(file) {
  return [
    `檔案名稱：${file.name}`,
    `檔案大小：${file.size} bytes`,
    `檔案類型：${file.type || "application/octet-stream"}`,
    "第一版部署環境採用免打包後端，因此先記錄 .aia 檔案基本資料。下一版可在 GitHub/Netlify 雲端建置流程中加入完整積木解析。",
  ].join("\n");
}

module.exports = { summarizeAia };
