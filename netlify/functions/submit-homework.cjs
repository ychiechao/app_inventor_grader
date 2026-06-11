const zlib = require("node:zlib");

const MAX_APPS_SCRIPT_FILE_BYTES = 1_500_000;
const MAX_SHEET_SUMMARY_CHARS = 12_000;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  try {
    const parsed = await parseMultipart(event);
    const assignmentId = String(parsed.fields.assignmentId || "").trim();
    const email = String(parsed.fields.email || "").trim();
    const className = String(parsed.fields.className || "").trim();
    const seatNumber = String(parsed.fields.seatNumber || "").trim();
    const submissionMode = parsed.fields.submissionMode === "final" ? "final" : "preview";
    const homeworkAia = parsed.files.homeworkAia;

    if (!assignmentId || !homeworkAia) {
      return jsonResponse(400, { error: "請確認作業連結並上傳 .aia 檔案" });
    }
    if (submissionMode === "final" && (!email || !className || !seatNumber)) {
      return jsonResponse(400, { error: "正式繳交請填寫電子郵件、班級與座號" });
    }

    const assignment = await callAppsScript({ action: "getAssignment", assignmentId });
    const homeworkBuffer = Buffer.from(await homeworkAia.arrayBuffer());
    if (submissionMode === "final" && homeworkBuffer.length > MAX_APPS_SCRIPT_FILE_BYTES) {
      return jsonResponse(413, {
        error: "此檔案可進行初評，但超過正式繳交上限，請縮小專案中的圖片或音訊後再正式繳交。",
      });
    }

    const aiaSummary = summarizeAia(homeworkAia, homeworkBuffer);
    const grade = await gradeHomework({
      assignmentDescription: assignment.description,
      rubric: assignment.rubric,
      aiaSummary,
    });

    if (submissionMode === "preview") {
      return jsonResponse(200, { ...grade, submissionMode });
    }

    const saved = await callAppsScript({
      action: "saveSubmission",
      assignmentId,
      email,
      className,
      seatNumber,
      assignmentDescription: assignment.description,
      aiaSummary: limit(aiaSummary, MAX_SHEET_SUMMARY_CHARS),
      grade,
      homeworkFile: filePayloadFromBuffer(homeworkAia, homeworkBuffer),
    });

    return jsonResponse(200, {
      ...grade,
      ...saved,
      submissionMode,
    });
  } catch (error) {
    return errorResponse(error, "上傳作業失敗");
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
    .slice(0, 8)
    .map((entry) => section(entry.name, entry.text))
    .join("\n\n");
  const blockText = blockEntries
    .slice(0, 8)
    .map((entry) => section(entry.name, entry.text))
    .join("\n\n");
  const projectText = projectEntries
    .slice(0, 4)
    .map((entry) => section(entry.name, entry.text))
    .join("\n\n");

  return [
    `AIA file name: ${file.name}`,
    `AIA file size: ${file.size} bytes`,
    `ZIP entries: ${entries.length}`,
    `Screen (.scm) files: ${screenEntries.map((entry) => entry.name).join(", ") || "none"}`,
    `Blocks (.bky) files: ${blockEntries.map((entry) => entry.name).join(", ") || "none"}`,
    "",
    "Project properties:",
    limit(projectText || "none", 3000),
    "",
    "Screen/component source (.scm):",
    limit(screenText || "none", 18000),
    "",
    "Blocks source (.bky XML):",
    limit(blockText || "none", 28000),
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
  if (eocdOffset < 0) throw new Error("無法讀取 .aia：不是有效的 ZIP 檔案");

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

async function gradeHomework(input) {
  const prompt = `You are an App Inventor grading assistant for a teacher in Taiwan. Grade the student's uploaded project using the assignment description, rubric, and extracted AIA project content below.

Assignment description:
${input.assignmentDescription}

Rubric:
${JSON.stringify(input.rubric)}

Extracted AIA project content:
${input.aiaSummary}

Return only one JSON object, no Markdown:
{
  "interfaceScore": integer from 0 to 20,
  "logicScore": integer from 0 to 50,
  "correctnessScore": integer from 0 to 30,
  "interfaceFeedback": "Traditional Chinese feedback for 功能介面需求",
  "logicFeedback": "Traditional Chinese feedback for 程式邏輯完成度",
  "correctnessFeedback": "Traditional Chinese feedback for 目標功能正確性",
  "overallFeedback": "short Traditional Chinese overall suggestion"
}

Use the .scm component definitions and .bky XML blocks as primary evidence. In each category, mention concrete evidence, missing behavior, and one improvement when needed. Be conservative only when the extracted source is insufficient.`;

  const text = await openaiText(prompt);
  const parsed = extractJson(text);
  const interfaceScore = clampScore(parsed.interfaceScore, 20);
  const logicScore = clampScore(parsed.logicScore, 50);
  const correctnessScore = clampScore(parsed.correctnessScore, 30);
  const interfaceFeedback = String(parsed.interfaceFeedback || "未提供功能介面需求說明");
  const logicFeedback = String(parsed.logicFeedback || "未提供程式邏輯完成度說明");
  const correctnessFeedback = String(parsed.correctnessFeedback || "未提供目標功能正確性說明");
  const overallFeedback = String(parsed.overallFeedback || "已完成初步評分");
  return {
    interfaceScore,
    logicScore,
    correctnessScore,
    totalScore: interfaceScore + logicScore + correctnessScore,
    interfaceFeedback,
    logicFeedback,
    correctnessFeedback,
    overallFeedback,
    feedback: [
      `【功能介面需求】${interfaceFeedback}`,
      `【程式邏輯完成度】${logicFeedback}`,
      `【目標功能正確性】${correctnessFeedback}`,
      `【整體建議】${overallFeedback}`,
    ].join("\n\n"),
  };
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

function clampScore(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(max, Math.round(number)));
}

function getEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`尚未設定環境變數：${name}`);
  return value;
}
