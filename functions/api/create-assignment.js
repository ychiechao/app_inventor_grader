import { filePayload, summarizeAia } from "../_shared/aia.js";
import { errorResponse, json, requireTeacher } from "../_shared/http.js";
import { callAppsScript, openaiJson } from "../_shared/services.js";

const RUBRIC_SCHEMA = {
  type: "object",
  properties: {
    rubric: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          points: { type: "integer" },
          description: { type: "string" },
        },
        required: ["name", "points", "description"],
        additionalProperties: false,
      },
    },
  },
  required: ["rubric"],
  additionalProperties: false,
};

export async function onRequestPost({ request, env }) {
  const denied = requireTeacher(request, env);
  if (denied) return denied;
  try {
    const form = await request.formData();
    const title = String(form.get("title") || "").trim();
    const description = String(form.get("description") || "").trim();
    const sampleAia = form.get("sampleAia");

    if (!title || !description) return json({ error: "請填寫作業名稱與專案描述" }, 400);

    let sampleBuffer = null;
    let sampleSummary = "";
    if (sampleAia instanceof File && sampleAia.size > 0) {
      sampleBuffer = await sampleAia.arrayBuffer();
      sampleSummary = summarizeAia(sampleAia, sampleBuffer, {
        properties: 1000,
        screens: 8000,
        blocks: 12000,
        maxPropertyFiles: 2,
        maxScreenFiles: 4,
        maxBlockFiles: 4,
      });
    }

    const rubric = await createRubric(env, title, description, sampleSummary);
    const result = await callAppsScript(env, {
      action: "createAssignment",
      title,
      description,
      rubric,
      sampleFile: sampleAia instanceof File && sampleBuffer ? filePayload(sampleAia, sampleBuffer) : null,
      baseStatus: String(form.get("baseStatus") || "draft"),
      openAt: String(form.get("openAt") || ""),
      closeAt: String(form.get("closeAt") || ""),
    });

    const submissionUrl = new URL("/submit", request.url);
    submissionUrl.searchParams.set("id", result.assignmentId);

    return json({ ...result, rubric, submissionUrl: submissionUrl.toString() });
  } catch (error) {
    return errorResponse(error, "建立作業失敗");
  }
}

async function createRubric(env, title, description, sampleSummary) {
  const prompt = `You are an App Inventor programming teacher in Taiwan. Create a concise 100-point grading rubric.

Grade mainly by code completion and whether the app achieves the assignment goal. UI beauty, naming style, spelling mistakes, and typo-level issues must not reduce the score unless they prevent the app from functioning or make the feature impossible to verify.

Assignment title: ${title}
Assignment description: ${description}
Teacher sample AIA source: ${sampleSummary || "No sample uploaded."}

Return exactly three rubric items in this order:
1. 功能介面需求: 20 points
2. 程式邏輯完成度: 50 points
3. 目標功能正確性: 30 points

Use Traditional Chinese. Keep each description under 120 Chinese characters and focus on observable functional evidence.`;

  const result = await openaiJson(env, prompt, {
    name: "app_inventor_rubric",
    schema: RUBRIC_SCHEMA,
    maxOutputTokens: 1000,
  });
  const categories = [
    { name: "功能介面需求", points: 20 },
    { name: "程式邏輯完成度", points: 50 },
    { name: "目標功能正確性", points: 30 },
  ];
  return categories.map((category, index) => ({
    ...category,
    description: String(result.rubric[index]?.description || "依專案功能完成度評分"),
  }));
}
