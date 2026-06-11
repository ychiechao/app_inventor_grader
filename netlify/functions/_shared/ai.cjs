const { getEnv } = require("./env.cjs");

async function gemini(prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${getEnv("GEMINI_API_KEY")}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    },
  );
  if (!response.ok) throw new Error(`Gemini API failed: ${await response.text()}`);
  const data = await response.json();
  return ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [])
    .map((part) => part.text || "")
    .join("\n");
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error("AI 回傳格式無法解析");
  return JSON.parse(match[0]);
}

async function generateRubric(title, description) {
  const text = await gemini(`你是台灣國中小 App Inventor 教學教師。請根據作業名稱與描述建立評分規準。

作業名稱：${title}
作業描述：${description}

請只回傳 JSON 陣列，不要 Markdown。陣列必須剛好包含三個項目：
1. 介面設計
2. 程式邏輯
3. 功能正確度

每個項目格式：
{"name":"介面設計","points":5,"description":"..."}
points 都是 5。description 用繁體中文，具體描述可觀察的完成條件。`);
  const parsed = extractJson(text);
  if (!Array.isArray(parsed)) throw new Error("AI rubric 格式錯誤");
  return parsed;
}

async function gradeHomework(input) {
  const text = await gemini(`你是 App Inventor 作業評分助教。請根據作業描述、評分規準與 .aia 檔案摘要做初步評分。

作業描述：
${input.assignmentDescription}

評分規準：
${JSON.stringify(input.rubric)}

.aia 檔案摘要：
${input.aiaSummary}

請只回傳 JSON 物件，不要 Markdown：
{
  "interfaceScore": 0到5的整數,
  "logicScore": 0到5的整數,
  "correctnessScore": 0到5的整數,
  "totalScore": 三項總分,
  "feedback": "繁體中文，說明完成度與可改進處"
}`);
  const parsed = extractJson(text);
  const interfaceScore = clampScore(parsed.interfaceScore);
  const logicScore = clampScore(parsed.logicScore);
  const correctnessScore = clampScore(parsed.correctnessScore);
  return {
    interfaceScore,
    logicScore,
    correctnessScore,
    totalScore: interfaceScore + logicScore + correctnessScore,
    feedback: String(parsed.feedback || "已完成初步評分。"),
  };
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(5, Math.round(number)));
}

module.exports = { generateRubric, gradeHomework };
