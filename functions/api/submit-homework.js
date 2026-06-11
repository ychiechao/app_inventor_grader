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
    const homeworkAia = form.get("homeworkAia");

    if (!assignmentId || !(homeworkAia instanceof File) || homeworkAia.size === 0) {
      return json({ error: "請確認作業連結並上傳 .aia 檔案" }, 400);
    }
    if (submissionMode === "final" && (!email || !className || !seatNumber)) {
      return json({ error: "正式繳交請填寫電子郵件、班級與座號" }, 400);
    }

    const assignment = await callAppsScript(env, { action: "getAssignment", assignmentId });
    const buffer = await homeworkAia.arrayBuffer();
    if (submissionMode === "final" && buffer.byteLength > MAX_APPS_SCRIPT_FILE_BYTES) {
      return json(
        {
          error: "此檔案可進行初評，但超過正式繳交上限，請縮小專案中的圖片或音訊後再正式繳交。",
        },
        413,
      );
    }

    const aiaSummary = summarizeAia(homeworkAia, buffer);
    const grade = await gradeHomework(env, assignment, aiaSummary);

    if (submissionMode === "preview") {
      return json({ ...grade, submissionMode });
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

function clamp(value, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, Math.round(number))) : 0;
}
