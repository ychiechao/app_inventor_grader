const { createSign } = require("node:crypto");
const { getEnv } = require("./env.cjs");

const driveScope = "https://www.googleapis.com/auth/drive";
const sheetsScope = "https://www.googleapis.com/auth/spreadsheets";
let tokenCache;

function base64Url(input) {
  return Buffer.from(input).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function accessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
      scope: `${driveScope} ${sheetsScope}`,
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsignedJwt = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  const signature = base64Url(signer.sign(getEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n")));

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsignedJwt}.${signature}`,
    }),
  });

  if (!response.ok) throw new Error(`Google auth failed: ${await response.text()}`);
  const data = await response.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return tokenCache.token;
}

async function googleFetch(url, init = {}) {
  const token = await accessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Google API failed: ${await response.text()}`);
  return response;
}

async function uploadAiaFile(file, namePrefix) {
  const metadata = {
    name: `${namePrefix}-${Date.now()}-${file.name || "project.aia"}`,
    parents: [getEnv("GOOGLE_DRIVE_FOLDER_ID")],
  };
  const form = new FormData();
  form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.set("file", file, file.name || "project.aia");

  const response = await googleFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    body: form,
  });
  const data = await response.json();
  return { id: data.id, webViewLink: data.webViewLink };
}

async function createAssignmentSheet(title, description, rubric) {
  const createdResponse = await googleFetch("https://sheets.googleapis.com/v4/spreadsheets?fields=spreadsheetId,spreadsheetUrl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: { title: `App Inventor 作業評分-${title}` },
      sheets: [{ properties: { title: "submissions" } }, { properties: { title: "rubric" } }],
    }),
  });
  const created = await createdResponse.json();
  const spreadsheetId = created.spreadsheetId;

  await googleFetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}?addParents=${getEnv("GOOGLE_DRIVE_FOLDER_ID")}&fields=id,parents`, {
    method: "PATCH",
  });

  await updateValues(spreadsheetId, "submissions!A1:L1", [
    [
      "時間",
      "Email",
      "班級",
      "座號",
      "檔案連結",
      "介面分數",
      "邏輯分數",
      "正確度分數",
      "總分",
      "AI 說明",
      "AIA 摘要",
      "作業描述",
    ],
  ]);

  await updateValues(spreadsheetId, "rubric!A1:C2", [
    ["作業描述", "Rubric JSON", "建立時間"],
    [description, JSON.stringify(rubric), new Date().toISOString()],
  ]);

  return { spreadsheetId, spreadsheetUrl: created.spreadsheetUrl };
}

async function readAssignmentRubric(spreadsheetId) {
  const response = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("rubric!A2:B2")}`,
  );
  const data = await response.json();
  const row = data.values && data.values[0];
  if (!row) throw new Error("找不到此作業的評分規準");
  return {
    description: String(row[0] || ""),
    rubric: JSON.parse(String(row[1] || "[]")),
  };
}

async function appendSubmissionRow(spreadsheetId, values) {
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("submissions!A:L")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [values] }),
    },
  );
}

async function updateValues(spreadsheetId, range, values) {
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    },
  );
}

module.exports = { uploadAiaFile, createAssignmentSheet, readAssignmentRubric, appendSubmissionRow };
