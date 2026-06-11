export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
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

export function requireTeacher(request, env) {
  const expected = requireEnv(env, "TEACHER_ACCESS_KEY");
  const provided = request.headers.get("X-Teacher-Key") || "";
  if (!provided || !timingSafeEqual(provided, expected)) {
    return json({ error: "教師管理密碼錯誤" }, 401);
  }
  return null;
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
