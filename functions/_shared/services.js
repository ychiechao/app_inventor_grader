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

export async function openaiJson(env, prompt, maxOutputTokens = 1200) {
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
    }),
  });
  if (!response.ok) throw new Error(`OpenAI API failed: ${await response.text()}`);
  const data = await response.json();
  const output = data.output_text || collectOutputText(data);
  const match = output.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error("AI 回傳內容不是有效的 JSON");
  return JSON.parse(match[0]);
}

function collectOutputText(data) {
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("\n");
}
