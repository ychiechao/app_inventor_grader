import { limit } from "../_shared/aia.js";
import { gradeHomework } from "../_shared/grading.js";
import { errorResponse, json, requireTeacher } from "../_shared/http.js";
import { callAppsScript } from "../_shared/services.js";

export async function onRequestPost({ request, env }) {
  const denied = requireTeacher(request, env);
  if (denied) return denied;
  try {
    const payload = await request.json();
    const assignmentId = String(payload.assignmentId || "").trim();
    if (!assignmentId) return json({ error: "缺少作業代碼" }, 400);

    if (payload.action === "scan") {
      const result = await callAppsScript(env, { action: "listBatchFiles", assignmentId, folderUrl: payload.folderUrl });
      return json(result);
    }
    if (payload.action !== "grade") return json({ error: "不支援的批次操作" }, 400);

    const assignment = await callAppsScript(env, { action: "getAssignment", assignmentId });
    const source = await callAppsScript(env, { action: "getBatchFileSummary", assignmentId, fileId: payload.fileId }, { attempts: 2 });
    if (source.unchanged) return json({ skipped: true, reason: "unchanged", record: source.record });
    const aiaSummary = String(source.aiaSummary || "");
    if (!aiaSummary) return json({ error: "無法取得 AIA 程式摘要", fileId: payload.fileId }, 422);
    const grade = await gradeHomework(env, assignment, aiaSummary);
    const saved = await callAppsScript(env, {
      action: "saveBatchGrade",
      assignmentId,
      source: {
        fileId: source.fileId,
        fileName: source.name,
        fileUrl: source.fileUrl,
        updatedAt: source.updatedAt,
        className: source.className,
        seatNumber: source.seatNumber,
        studentName: source.studentName,
      },
      grade,
      aiaSummary: limit(aiaSummary, 12000),
    });
    return json({ ...grade, ...saved });
  } catch (error) {
    return errorResponse(error, "批次評分失敗");
  }
}
