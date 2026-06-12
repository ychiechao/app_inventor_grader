import { filePayload, limit, summarizeAia } from "../_shared/aia.js";
import { errorResponse, json } from "../_shared/http.js";
import { callAppsScript, openaiJson } from "../_shared/services.js";

const MAX_APPS_SCRIPT_FILE_BYTES = 1_500_000;
const MAX_SHEET_SUMMARY_CHARS = 12_000;

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    interfaceScore: { type: "integer" },
    logicScore: { type: "integer" },
    correctnessScore: { type: "integer" },
    interfaceFeedback: { type: "string" },
    logicFeedback: { type: "string" },
    correctnessFeedback: { type: "string" },
    overallFeedback: { type: "string" },
  },
  required: [
    "interfaceScore",
    "logicScore",
    "correctnessScore",
    "interfaceFeedback",
    "logicFeedback",
    "correctnessFeedback",
    "overallFeedback",
  ],
  additionalProperties: false,
};

export async function onRequestPost({ request, env }) {
  try {
    const form = await request.formData();
    const assignmentId = String(form.get("assignmentId") || "").trim();
    const email = String(form.get("email") || "").trim();
    const className = String(form.get("className") || "").trim();
    const seatNumber = String(form.get("seatNumber") || "").trim();
    const submissionMode = form.get("submissionMode") === "final" ? "final" : "preview";
    const overwriteConfirmed = form.get("overwriteConfirmed") === "true";
    const homeworkAia = form.get("homeworkAia");

    if (!assignmentId || !(homeworkAia instanceof File) || homeworkAia.size === 0) {
      return json({ error: "請確認作業連結並選擇 .aia 檔案" }, 400);
    }
    if (submissionMode === "final" && (!email || !className || !seatNumber)) {
      return json({ error: "正式繳交請填寫電子郵件、班級與座號" }, 400);
    }

    const assignment = await callAppsScript(env, { action: "getAssignment", assignmentId });
    if (!assignment.canSubmit) {
      return json({ error: assignment.status === "scheduled" ? "作業尚未開放繳交" : "作業已停止繳交" }, 403);
    }
    if (submissionMode === "final") {
      const existing = await callAppsScript(env, { action: "checkSubmission", assignmentId, email });
      if (existing.exists && !overwriteConfirmed) {
        return json({ error: "此電子郵件已繳交過，請確認是否覆蓋", duplicate: true, existing }, 409);
      }
    }
    const buffer = await homeworkAia.arrayBuffer();
    if (submissionMode === "final" && buffer.byteLength > MAX_APPS_SCRIPT_FILE_BYTES) {
      return json({ error: "檔案較大，可以先使用 AI 初評，但目前無法正式儲存到 Google Drive" }, 413);
    }

    const aiaSummary = summarizeAia(homeworkAia, buffer);
    const grade = await gradeHomework(env, assignment, aiaSummary);

    if (submissionMode === "preview") {
      return json({ ...grade, submissionMode });
    }

    const saved = await callAppsScript(env, {
      action: "saveSubmission",
      submissionVersion: 2,
      assignmentId,
      email,
      className,
      seatNumber,
      overwriteConfirmed,
      assignmentDescription: assignment.description,
      aiaSummary: limit(aiaSummary, MAX_SHEET_SUMMARY_CHARS),
      grade,
      homeworkFile: filePayload(homeworkAia, buffer),
    });

    return json({ ...grade, ...saved, submissionMode });
  } catch (error) {
    return errorResponse(error, "上傳與評分失敗");
  }
}

async function gradeHomework(env, assignment, aiaSummary) {
  const prompt = `You are an App Inventor grading assistant in Taiwan. Grade the extracted AIA source.

Assignment description: ${assignment.description}
Rubric: ${JSON.stringify(assignment.rubric)}
Extracted AIA source: ${aiaSummary}

Score ranges: interfaceScore 0-20, logicScore 0-50, correctnessScore 0-30.
Grade functionality and code completion. Do not deduct for beauty, naming, or typos unless they break functionality. Use .scm and .bky as evidence.
Write all feedback in Traditional Chinese. Return separate feedback for the three rubric categories. Each category must explain completed evidence, missing or incorrect behavior, and one concrete improvement when needed. The overall feedback should be a short summary. Keep all feedback together under 900 Chinese characters.`;

  const parsed = await openaiJson(env, prompt, {
    name: "app_inventor_grade",
    schema: GRADE_SCHEMA,
    maxOutputTokens: 2000,
  });
  const interfaceScore = clamp(parsed.interfaceScore, 20);
  const logicScore = clamp(parsed.logicScore, 50);
  const correctnessScore = clamp(parsed.correctnessScore, 30);
  const interfaceFeedback = String(parsed.interfaceFeedback || "未提供功能介面評語");
  const logicFeedback = String(parsed.logicFeedback || "未提供程式邏輯評語");
  const correctnessFeedback = String(parsed.correctnessFeedback || "未提供目標正確性評語");
  const overallFeedback = String(parsed.overallFeedback || "未提供整體評語");
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
      `功能介面需求：${interfaceFeedback}`,
      `程式邏輯完成度：${logicFeedback}`,
      `目標功能正確性：${correctnessFeedback}`,
      `整體評語：${overallFeedback}`,
    ].join("\n\n"),
  };
}

function clamp(value, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, Math.round(number))) : 0;
}
