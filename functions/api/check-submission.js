import { errorResponse, json } from "../_shared/http.js";
import { callAppsScript } from "../_shared/services.js";

export async function onRequestPost({ request, env }) {
  try {
    const payload = await request.json();
    const assignmentId = String(payload.assignmentId || "").trim();
    const email = String(payload.email || "").trim().toLowerCase();
    if (!assignmentId || !email) return json({ error: "缺少作業或電子郵件資料" }, 400);
    const result = await callAppsScript(env, {
      action: "checkSubmission",
      assignmentId,
      email,
    });
    return json(result);
  } catch (error) {
    return errorResponse(error, "檢查繳交紀錄失敗");
  }
}
