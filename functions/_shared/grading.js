import { openaiJson } from "./services.js";

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
  required: ["interfaceScore", "logicScore", "correctnessScore", "interfaceFeedback", "logicFeedback", "correctnessFeedback", "overallFeedback"],
  additionalProperties: false,
};

export async function gradeHomework(env, assignment, aiaSummary) {
  const prompt = `You are an App Inventor grading assistant in Taiwan. Grade the extracted AIA source.

Assignment description: ${assignment.description}
Rubric: ${JSON.stringify(assignment.rubric)}
Extracted AIA source: ${aiaSummary}

Score ranges: interfaceScore 0-20, logicScore 0-50, correctnessScore 0-30.
Grade functionality and code completion. Do not deduct for beauty, naming, or typos unless they break functionality. Use .scm and .bky as evidence.
Write all feedback in Traditional Chinese. Return separate feedback for the three rubric categories. Each category must explain completed evidence, missing or incorrect behavior, and one concrete improvement when needed. The overall feedback should be a short summary. Keep all feedback together under 900 Chinese characters.`;

  const parsed = await openaiJson(env, prompt, { name: "app_inventor_grade", schema: GRADE_SCHEMA, maxOutputTokens: 2000 });
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
