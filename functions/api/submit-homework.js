import { filePayload, limit, summarizeAia } from "../_shared/aia.js";
import { errorResponse, json } from "../_shared/http.js";
import { gradeHomework } from "../_shared/grading.js";
import { callAppsScript } from "../_shared/services.js";

const MAX_APPS_SCRIPT_FILE_BYTES = 1_500_000;
const MAX_SHEET_SUMMARY_CHARS = 12_000;

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
