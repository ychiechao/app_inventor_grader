import { errorResponse, json } from "../_shared/http.js";
import { callAppsScript } from "../_shared/services.js";

export async function onRequestGet({ request, env }) {
  try {
    const assignmentId = new URL(request.url).searchParams.get("assignment")?.trim();
    if (!assignmentId) return json({ error: "缺少作業代碼" }, 400);
    const assignment = await callAppsScript(env, { action: "getAssignment", assignmentId });
    return json(assignment);
  } catch (error) {
    return errorResponse(error, "讀取作業失敗");
  }
}
