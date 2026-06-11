export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function errorResponse(error, fallback) {
  const message = error instanceof Error ? error.message : fallback;
  console.error(error);
  return json({ error: message }, 500);
}

export function requireEnv(env, name) {
  const value = env[name];
  if (!value) throw new Error(`伺服器尚未設定環境變數：${name}`);
  return value;
}
