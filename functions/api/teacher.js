import { errorResponse, json, requireTeacher } from "../_shared/http.js";
import { callAppsScript } from "../_shared/services.js";

export async function onRequestGet({ request, env }) {
  const denied = requireTeacher(request, env);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "list";
    if (action === "detail") {
      const id = url.searchParams.get("id") || "";
      const data = await callAppsScript(env, { action: "getAssignmentAdmin", assignmentId: id });
      return json(data);
    }
    const assignments = await callAppsScript(env, { action: "listAdminAssignments" });
    return json({ assignments });
  } catch (error) {
    return errorResponse(error, "讀取教師管理資料失敗");
  }
}

export async function onRequestPost({ request, env }) {
  const denied = requireTeacher(request, env);
  if (denied) return denied;
  try {
    const payload = await request.json();
    if (payload.action !== "update") return json({ error: "不支援的管理操作" }, 400);
    const assignment = await callAppsScript(env, {
      action: "updateAssignment",
      assignmentId: payload.id,
      title: payload.title,
      description: payload.description,
      baseStatus: payload.baseStatus,
      openAt: payload.openAt,
      closeAt: payload.closeAt,
    });
    return json({ assignment });
  } catch (error) {
    return errorResponse(error, "更新作業失敗");
  }
}
