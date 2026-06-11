import { requireEnv } from "./http.js";

export async function callAppsScript(env, payload) {
  const response = await fetch(requireEnv(env, "APPS_SCRIPT_WEB_APP_URL"), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, token: requireEnv(env, "APPS_SCRIPT_TOKEN") }),
    redirect: "follow",
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script 回傳的不是 JSON：${text.slice(0, 300)}`);
  }
  if (!data.ok) throw new Error(data.error || "Apps Script 執行失敗");
  return data.data;
}

export async function openaiJson(env, prompt, options) {
  const { name, schema, maxOutputTokens = 1200 } = options;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireEnv(env, "OPENAI_API_KEY")}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.1",
      input: prompt,
      reasoning: { effort: "none" },
      max_output_tokens: maxOutputTokens,
      text: { format: { type: "json_schema", name, strict: true, schema } },
    }),
  });

  if (!response.ok) throw new Error(`OpenAI API failed: ${await response.text()}`);
  const data = await response.json();
  if (data.status === "incomplete") {
    throw new Error(`AI 評分未完成：${data.incomplete_details?.reason || "輸出長度不足"}`);
  }
  const refusal = collectRefusal(data);
  if (refusal) throw new Error(`AI 無法完成評分：${refusal}`);
  const output = data.output_text || collectOutputText(data);
  if (!output) throw new Error("AI 沒有回傳評分內容");
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`AI 評分格式異常，請重新上傳。回傳片段：${output.slice(0, 160)}`);
  }
}

function collectOutputText(data) {
  return (data.output || []).flatMap((item) => item.content || []).filter((content) => content.type === "output_text").map((content) => content.text || "").join("");
}

function collectRefusal(data) {
  return (data.output || []).flatMap((item) => item.content || []).filter((content) => content.type === "refusal").map((content) => content.refusal || "").join(" ");
}
