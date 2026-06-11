import { filePayload, limit, summarizeAia } from "../_shared/aia.js";
import { errorResponse, json } from "../_shared/http.js";
import { callAppsScript, openaiJson } from "../_shared/services.js";

const MAX_APPS_SCRIPT_FILE_BYTES = 1_500_000;
const MAX_SHEET_SUMMARY_CHARS = 12_000;

export async function onRequestPost({ request, env }) {
  try {
    const form = await request.formData();
    const assignmentId = String(form.get("assignmentId") || "").trim();
    const email = String(form.get("email") || "").trim();
    const className = String(form.get("className") || "").trim();
    const seatNumber = String(form.get("seatNumber") || "").trim();
    const homeworkAia = form.get("homeworkAia");

    if (!assignmentId || !email || !className || !seatNumber || !(homeworkAia instanceof File)) {
      return json({ error: "請完整填寫作業代碼、電子郵件、班級、座號並上傳 .aia 檔案" }, 400);
    }

    const assignment = await callAppsScript(env, { action: "getAssignment", assignmentId });
    const buffer = await homeworkAia.arrayBuffer();
    const aiaSummary = summarizeAia(homeworkAia, buffer);
    const grade = await gradeHomework(env, assignment, aiaSummary);
    const shouldUploadFile = buffer.byteLength <= MAX_APPS_SCRIPT_FILE_BYTES;

    if (!shouldUploadFile) {
      grade.feedback += "\n\n系統提醒：檔案較大，本次已完成評分與紀錄，但未將原始 .aia 上傳到 Google 雲端硬碟。";
    }

    const saved = await callAppsScript(env, {
      action: "saveSubmission",
      assignmentId,
      email,
      className,
      seatNumber,
      assignmentDescription: assignment.description,
      aiaSummary: limit(aiaSummary, MAX_SHEET_SUMMARY_CHARS),
      grade,
      homeworkFile: shouldUploadFile ? filePayload(homeworkAia, buffer) : null,
    });

    return json({ ...grade, ...saved, uploadSkipped: !shouldUploadFile });
  } catch (error) {
    return errorResponse(error, "上傳與評分失敗");
  }
}

async function gradeHomework(env, assignment, aiaSummary) {
  const prompt = `You are an App Inventor grading assistant in Taiwan. Grade the extracted AIA source.

Assignment description: ${assignment.description}
Rubric: ${JSON.stringify(assignment.rubric)}
Extracted AIA source: ${aiaSummary}

Return only JSON:
{"interfaceScore":0,"logicScore":0,"correctnessScore":0,"totalScore":0,"feedback":"以繁體中文說明完成度、功能證據與待修正項目"}

Score ranges: interfaceScore 0-20, logicScore 0-50, correctnessScore 0-30. Grade functionality and code completion. Do not deduct for beauty, naming, or typos unless they break functionality. Use .scm and .bky as evidence.`;
  const parsed = await openaiJson(env, prompt, 1600);
  const interfaceScore = clamp(parsed.interfaceScore, 20);
  const logicScore = clamp(parsed.logicScore, 50);
  const correctnessScore = clamp(parsed.correctnessScore, 30);
  return {
    interfaceScore,
    logicScore,
    correctnessScore,
    totalScore: interfaceScore + logicScore + correctnessScore,
    feedback: String(parsed.feedback || "未提供文字評語"),
  };
}

function clamp(value, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, Math.round(number))) : 0;
}
