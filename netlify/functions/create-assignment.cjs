const zlib = require("node:zlib");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  try {
    const parsed = await parseMultipart(event);
    const title = String(parsed.fields.title || "").trim();
    const description = String(parsed.fields.description || "").trim();
    const sampleAia = parsed.files.sampleAia;

    if (!title || !description) {
      return jsonResponse(400, { error: "請填寫作業名稱與專案描述" });
    }

    const sampleBuffer = sampleAia ? Buffer.from(await sampleAia.arrayBuffer()) : null;
    const sampleSummary = sampleAia && sampleBuffer ? summarizeAia(sampleAia, sampleBuffer) : "";
    const rubric = await generateRubric(title, description, sampleSummary);
    const scriptResult = await callAppsScript({
      action: "createAssignment",
      title,
      description,
      rubric,
      sampleFile: sampleAia && sampleBuffer ? filePayloadFromBuffer(sampleAia, sampleBuffer) : null,
    });
    const submissionUrl = new URL("/", event.rawUrl || `https://${event.headers.host}`);
    submissionUrl.searchParams.set("assignment", scriptResult.assignmentId);
    submissionUrl.hash = "student";

    return jsonResponse(200, {
      assignmentId: scriptResult.assignmentId,
      spreadsheetUrl: scriptResult.spreadsheetUrl,
      sampleFileUrl: scriptResult.sampleFileUrl,
      submissionUrl: submissionUrl.toString(),
      rubric,
    });
  } catch (error) {
    return errorResponse(error, "建立作業失敗");
  }
};

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(data),
  };
}

function errorResponse(error, fallback) {
  const message = error instanceof Error ? error.message : fallback;
  console.error(error);
  return jsonResponse(500, { error: message });
}

async function parseMultipart(event) {
  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
  const request = new Request("https://local.netlify/function", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "utf8"),
  });
  const formData = await request.formData();
  const fields = {};
  const files = {};
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) files[key] = value;
    else fields[key] = value;
  }
  return { fields, files };
}

function filePayloadFromBuffer(file, buffer) {
  return {
    name: file.name || "project.aia",
    mimeType: file.type || "application/octet-stream",
    base64: buffer.toString("base64"),
  };
}

function summarizeAia(file, buffer) {
  const entries = readZipEntries(buffer);
  const screenEntries = entries.filter((entry) => entry.name.endsWith(".scm"));
  const blockEntries = entries.filter((entry) => entry.name.endsWith(".bky"));
  const projectEntries = entries.filter((entry) => entry.name.endsWith(".properties") || entry.name.endsWith("project.properties"));

  const screenText = screenEntries
    .slice(0, 4)
    .map((entry) => section(entry.name, entry.text))
    .join("\n\n");
  const blockText = blockEntries
    .slice(0, 4)
    .map((entry) => section(entry.name, entry.text))
    .join("\n\n");
  const projectText = projectEntries
    .slice(0, 2)
    .map((entry) => section(entry.name, entry.text))
    .join("\n\n");

  return [
    `Sample AIA file name: ${file.name}`,
    `Sample AIA file size: ${file.size} bytes`,
    `ZIP entries: ${entries.length}`,
    `Screen (.scm) files: ${screenEntries.map((entry) => entry.name).join(", ") || "none"}`,
    `Blocks (.bky) files: ${blockEntries.map((entry) => entry.name).join(", ") || "none"}`,
    "",
    "Project properties:",
    limit(projectText || "none", 1000),
    "",
    "Screen/component source (.scm):",
    limit(screenText || "none", 8000),
    "",
    "Blocks source (.bky XML):",
    limit(blockText || "none", 12000),
  ].join("\n");
}

function section(name, text) {
  return `--- ${name} ---\n${text}`;
}

function limit(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}

function readZipEntries(buffer) {
  const entries = [];
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("無法讀取範例 .aia：不是有效的 ZIP 檔案");

  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end && buffer.readUInt32LE(offset) === 0x02014b50) {
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    if (!name.endsWith("/") && isTextEntry(name)) {
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.slice(dataOffset, dataOffset + compressedSize);
      const raw = decompress(compressed, compressionMethod, uncompressedSize);
      entries.push({ name, text: raw.toString("utf8") });
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function isTextEntry(name) {
  return (
    name.endsWith(".scm") ||
    name.endsWith(".bky") ||
    name.endsWith(".properties") ||
    name.endsWith(".txt") ||
    name.endsWith(".json")
  );
}

function decompress(buffer, method, expectedSize) {
  if (method === 0) return buffer;
  if (method === 8) return zlib.inflateRawSync(buffer, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  throw new Error(`不支援的 ZIP 壓縮格式：${method} (${expectedSize} bytes)`);
}

async function callAppsScript(payload) {
  const url = getEnv("APPS_SCRIPT_WEB_APP_URL");
  const token = getEnv("APPS_SCRIPT_TOKEN");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, token }),
    redirect: "follow",
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script 回傳不是 JSON：${text.slice(0, 300)}`);
  }
  if (!data.ok) throw new Error(data.error || "Apps Script 執行失敗");
  return data.data;
}

async function generateRubric(title, description, sampleSummary) {
  const prompt = `You are an App Inventor programming teacher in Taiwan. Create a concise grading rubric for the assignment below.

Important grading policy:
- Grade mainly by code completion and whether the app achieves the assignment goal.
- UI beauty, component naming style, spelling mistakes, variable names, or typo-level issues must not reduce the score unless they prevent the app from functioning or make the required feature impossible to verify.
- A simple interface is acceptable if it provides the required inputs, buttons, and outputs needed for the assignment.
- Focus on observable functional behavior, event logic, variables, procedures, conditions, loops, data handling, and edge-case checks.

Assignment title:
${title}

Teacher assignment description:
${description}

Teacher sample AIA extracted source, if available:
${sampleSummary || "No sample AIA was uploaded. Build the rubric from the teacher description only."}

Return only a JSON array. Do not use Markdown. The array must contain exactly three objects:
1. 功能介面需求, 20 points
2. 程式邏輯完成度, 50 points
3. 目標功能正確性, 30 points

Each object must use this exact shape:
{"name":"功能介面需求","points":20,"description":"..."}

Use Traditional Chinese for all name and description values. The total points must be 100. Keep each description under 120 Chinese characters and focus on functional evidence in App Inventor components and blocks.`;

  const text = await openaiText(prompt);
  const parsed = extractJson(text);
  if (!Array.isArray(parsed)) throw new Error("AI rubric 格式錯誤");
  return parsed;
}

async function openaiText(prompt) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getEnv("OPENAI_API_KEY")}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.1",
      input: prompt,
      reasoning: { effort: "none" },
      max_output_tokens: 800,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI API failed: ${await response.text()}`);
  const data = await response.json();
  return data.output_text || collectOutputText(data);
}

function collectOutputText(data) {
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("\n");
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error("AI 回傳格式無法解析");
  return JSON.parse(match[0]);
}

function getEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`尚未設定環境變數：${name}`);
  return value;
}
