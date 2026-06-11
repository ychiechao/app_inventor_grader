function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(data),
  };
}

function errorResponse(error, fallback = "伺服器處理失敗") {
  const message = error instanceof Error ? error.message : fallback;
  console.error(error);
  return jsonResponse(500, { error: message });
}

module.exports = { jsonResponse, errorResponse };
