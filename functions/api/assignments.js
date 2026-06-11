import { errorResponse, json } from "../_shared/http.js";
import { callAppsScript } from "../_shared/services.js";

export async function onRequestGet({ env }) {
  try {
    const assignments = await callAppsScript(env, { action: "listPublicAssignments" });
    return json({ assignments });
  } catch (error) {
    return errorResponse(error, "讀取作業列表失敗");
  }
}
