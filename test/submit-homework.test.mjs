import assert from "node:assert/strict";
import test from "node:test";
import { File } from "node:buffer";
import { onRequestGet as listAssignments } from "../functions/api/assignments.js";
import { onRequestPost as createAssignment } from "../functions/api/create-assignment.js";
import { onRequestGet as getAssignment } from "../functions/api/get-assignment.js";
import { onRequestPost as submitHomework } from "../functions/api/submit-homework.js";
import { onRequestPost as teacherAction } from "../functions/api/teacher.js";
import { onRequestPost as checkSubmission } from "../functions/api/check-submission.js";
import { onRequestPost as batchGrading } from "../functions/api/batch-grading.js";

const env = {
  APPS_SCRIPT_WEB_APP_URL: "https://example.test/apps-script",
  APPS_SCRIPT_TOKEN: "script-token",
  OPENAI_API_KEY: "openai-key",
  OPENAI_MODEL: "test-model",
  TEACHER_ACCESS_KEY: "teacher-key",
};

test("teacher key is required to create an assignment", async () => {
  const form = new FormData();
  form.set("title", "測試作業");
  form.set("description", "完成指定功能");
  const response = await createAssignment({ request: new Request("https://example.test/api/create-assignment", { method: "POST", body: form }), env });
  assert.equal(response.status, 401);
});

test("assignment creation returns a short public submission link", async () => {
  await withMockFetch(async (input, init = {}) => {
    if (String(input) === "https://api.openai.com/v1/responses") {
      return jsonResponse({ status: "completed", output_text: JSON.stringify({ rubric: rubric() }) });
    }
    const payload = JSON.parse(init.body);
    assert.equal(payload.action, "createAssignment");
    assert.equal(payload.baseStatus, "open");
    return jsonResponse({ ok: true, data: { assignmentId: "abc123def456", spreadsheetUrl: "https://example.test/sheet", sampleFileUrl: "" } });
  }, async () => {
    const form = new FormData();
    form.set("title", "BMI 計算器");
    form.set("description", "計算 BMI");
    form.set("baseStatus", "open");
    const response = await createAssignment({ request: teacherRequest("https://branch.pages.dev/api/create-assignment", { method: "POST", body: form }), env });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.submissionUrl, "https://branch.pages.dev/submit?id=abc123def456");
  });
});

test("public assignment list and detail expose submission state", async () => {
  await withMockFetch(async (input, init = {}) => {
    const payload = JSON.parse(init.body);
    if (payload.action === "listPublicAssignments") return jsonResponse({ ok: true, data: [{ id: "abc123", title: "猜數字", status: "open", canSubmit: true }] });
    if (payload.action === "getAssignment") return jsonResponse({ ok: true, data: { id: "abc123", title: "猜數字", description: "完成 1A2B", status: "open", canSubmit: true, rubric: [] } });
    throw new Error("Unexpected action");
  }, async () => {
    const listResponse = await listAssignments({ env });
    assert.equal((await listResponse.json()).assignments[0].id, "abc123");
    const detailResponse = await getAssignment({ request: new Request("https://example.test/api/get-assignment?assignment=abc123"), env });
    assert.equal((await detailResponse.json()).canSubmit, true);
  });
});

test("preview does not save and closed assignments reject submissions", async () => {
  const actions = [];
  let assignmentOpen = true;
  await withMockFetch(async (input, init = {}) => {
    if (String(input) === env.APPS_SCRIPT_WEB_APP_URL) {
      const payload = JSON.parse(init.body);
      actions.push(payload.action);
      if (payload.action === "getAssignment") return jsonResponse({ ok: true, data: { title: "測試", description: "完成指定功能", rubric: [], status: assignmentOpen ? "open" : "closed", canSubmit: assignmentOpen } });
      if (payload.action === "checkSubmission") return jsonResponse({ ok: true, data: { exists: false } });
      if (payload.action === "saveSubmission") return jsonResponse({ ok: true, data: { fileName: "student_20260611_801_12.aia", replaced: true } });
    }
    if (String(input) === "https://api.openai.com/v1/responses") return jsonResponse({ status: "completed", output_text: JSON.stringify(grade()) });
    throw new Error(`Unexpected fetch: ${input}`);
  }, async () => {
    const preview = await submit({ submissionMode: "preview" });
    assert.equal(preview.status, 200);
    assert.deepEqual(actions, ["getAssignment"]);

    actions.length = 0;
    const final = await submit({ submissionMode: "final", email: "student@example.com", className: "801", seatNumber: "12" });
    assert.equal(final.status, 200);
    assert.deepEqual(actions, ["getAssignment", "checkSubmission", "saveSubmission"]);

    actions.length = 0;
    assignmentOpen = false;
    const closed = await submit({ submissionMode: "preview" });
    assert.equal(closed.status, 403);
    assert.deepEqual(actions, ["getAssignment"]);
  });
});

test("submission check finds an existing email", async () => {
  await withMockFetch(async (input, init = {}) => {
    const payload = JSON.parse(init.body);
    assert.equal(payload.action, "checkSubmission");
    assert.equal(payload.email, "student@example.com");
    return jsonResponse({ ok: true, data: { exists: true, className: "801", seatNumber: "12" } });
  }, async () => {
    const response = await checkSubmission({
      request: new Request("https://example.test/api/check-submission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: "abc123def456", email: "STUDENT@example.com" }),
      }),
      env,
    });
    assert.deepEqual(await response.json(), { exists: true, className: "801", seatNumber: "12" });
  });
});

test("duplicate final submission requires overwrite confirmation before grading", async () => {
  const actions = [];
  await withMockFetch(async (input, init = {}) => {
    if (String(input) !== env.APPS_SCRIPT_WEB_APP_URL) throw new Error("OpenAI should not be called");
    const payload = JSON.parse(init.body);
    actions.push(payload.action);
    if (payload.action === "getAssignment") return jsonResponse({ ok: true, data: { title: "測試", description: "完成指定功能", rubric: [], status: "open", canSubmit: true } });
    if (payload.action === "checkSubmission") return jsonResponse({ ok: true, data: { exists: true } });
    throw new Error("Unexpected action");
  }, async () => {
    const response = await submit({ submissionMode: "final", email: "student@example.com", className: "801", seatNumber: "12" });
    assert.equal(response.status, 409);
    assert.equal(response.data.duplicate, true);
    assert.deepEqual(actions, ["getAssignment", "checkSubmission"]);
  });
});

test("confirmed duplicate replaces the existing email submission", async () => {
  const actions = [];
  await withMockFetch(async (input, init = {}) => {
    if (String(input) === env.APPS_SCRIPT_WEB_APP_URL) {
      const payload = JSON.parse(init.body);
      actions.push(payload.action);
      if (payload.action === "getAssignment") return jsonResponse({ ok: true, data: { title: "測試", description: "完成指定功能", rubric: [], status: "open", canSubmit: true } });
      if (payload.action === "checkSubmission") return jsonResponse({ ok: true, data: { exists: true } });
      if (payload.action === "saveSubmission") {
        assert.equal(payload.overwriteConfirmed, true);
        return jsonResponse({ ok: true, data: { fileName: "student_20260612_801_12.aia", replaced: true } });
      }
    }
    if (String(input) === "https://api.openai.com/v1/responses") return jsonResponse({ status: "completed", output_text: JSON.stringify(grade()) });
    throw new Error(`Unexpected fetch: ${input}`);
  }, async () => {
    const response = await submit({ submissionMode: "final", email: "student@example.com", className: "801", seatNumber: "12", overwriteConfirmed: true });
    assert.equal(response.status, 200);
    assert.equal(response.data.replaced, true);
    assert.deepEqual(actions, ["getAssignment", "checkSubmission", "saveSubmission"]);
  });
});

test("teacher can delete an assignment", async () => {
  await withMockFetch(async (input, init = {}) => {
    const payload = JSON.parse(init.body);
    assert.equal(payload.action, "deleteAssignment");
    assert.equal(payload.assignmentId, "abc123def456");
    return jsonResponse({ ok: true, data: { deleted: true, assignmentId: payload.assignmentId } });
  }, async () => {
    const response = await teacherAction({
      request: teacherRequest("https://example.test/api/teacher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: "abc123def456" }),
      }),
      env,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted: true, assignmentId: "abc123def456" });
  });
});

test("teacher can scan a Drive folder for batch grading", async () => {
  await withMockFetch(async (input, init = {}) => {
    const payload = JSON.parse(init.body);
    assert.equal(payload.action, "listBatchFiles");
    assert.equal(payload.folderUrl, "https://drive.google.com/drive/folders/folder123456789012345");
    return jsonResponse({ ok: true, data: { folderName: "819 作業", files: [{ fileId: "file1", name: "819_09_王小明.aia", status: "pending" }] } });
  }, async () => {
    const response = await batchGrading({
      request: teacherRequest("https://example.test/api/batch-grading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan", assignmentId: "abc123def456", folderUrl: "https://drive.google.com/drive/folders/folder123456789012345" }),
      }),
      env,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).files[0].name, "819_09_王小明.aia");
  });
});

test("batch grading skips an unchanged Drive file before calling OpenAI", async () => {
  const actions = [];
  await withMockFetch(async (input, init = {}) => {
    if (String(input) !== env.APPS_SCRIPT_WEB_APP_URL) throw new Error("OpenAI should not be called");
    const payload = JSON.parse(init.body);
    actions.push(payload.action);
    if (payload.action === "getAssignment") return jsonResponse({ ok: true, data: { title: "測試", description: "完成指定功能", rubric: [] } });
    if (payload.action === "getBatchFileSummary") return jsonResponse({ ok: true, data: { unchanged: true, record: { totalScore: 88 } } });
    throw new Error("Unexpected action");
  }, async () => {
    const response = await batchGrading({
      request: teacherRequest("https://example.test/api/batch-grading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "grade", assignmentId: "abc123def456", fileId: "file1" }),
      }),
      env,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).skipped, true);
    assert.deepEqual(actions, ["getAssignment", "getBatchFileSummary"]);
  });
});

test("batch grading saves scores for a valid Drive AIA file", async () => {
  const actions = [];
  await withMockFetch(async (input, init = {}) => {
    if (String(input) === env.APPS_SCRIPT_WEB_APP_URL) {
      const payload = JSON.parse(init.body);
      actions.push(payload.action);
      if (payload.action === "getAssignment") return jsonResponse({ ok: true, data: { title: "測試", description: "完成指定功能", rubric: rubric() } });
      if (payload.action === "getBatchFileSummary") return jsonResponse({ ok: true, data: { unchanged: false, fileId: "file1", name: "819_09_王小明.aia", fileUrl: "https://drive.test/file1", updatedAt: "2026-06-12T00:00:00.000Z", className: "819", seatNumber: "09", studentName: "王小明", aiaSummary: "AIA file name: 819_09_王小明.aia\nBlocks source (.bky XML):\n<xml><block type=\"component_event\"></block></xml>" } });
      if (payload.action === "saveBatchGrade") {
        assert.equal(payload.source.className, "819");
        assert.equal(payload.source.seatNumber, "09");
        assert.equal(payload.grade.totalScore, 86);
        return jsonResponse({ ok: true, data: { replaced: false, recordSheetUrl: "https://example.test/sheet#gid=2" } });
      }
    }
    if (String(input) === "https://api.openai.com/v1/responses") return jsonResponse({ status: "completed", output_text: JSON.stringify(grade()) });
    throw new Error(`Unexpected fetch: ${input}`);
  }, async () => {
    const response = await batchGrading({
      request: teacherRequest("https://example.test/api/batch-grading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "grade", assignmentId: "abc123def456", fileId: "file1" }),
      }),
      env,
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.totalScore, 86);
    assert.deepEqual(actions, ["getAssignment", "getBatchFileSummary", "saveBatchGrade"]);
  });
});

test("batch grading retries when Apps Script temporarily returns HTML", async () => {
  let summaryAttempts = 0;
  await withMockFetch(async (input, init = {}) => {
    if (String(input) === env.APPS_SCRIPT_WEB_APP_URL) {
      const payload = JSON.parse(init.body);
      if (payload.action === "getAssignment") return jsonResponse({ ok: true, data: { title: "測試", description: "完成指定功能", rubric: [] } });
      if (payload.action === "getBatchFileSummary") {
        summaryAttempts += 1;
        if (summaryAttempts === 1) return new Response("<!DOCTYPE html><html><title>暫時錯誤</title></html>", { status: 200 });
        return jsonResponse({ ok: true, data: { unchanged: true, record: { totalScore: 90 } } });
      }
    }
    throw new Error(`Unexpected fetch: ${input}`);
  }, async () => {
    const response = await batchGrading({
      request: teacherRequest("https://example.test/api/batch-grading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "grade", assignmentId: "abc123def456", fileId: "file1" }),
      }),
      env,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).skipped, true);
    assert.equal(summaryAttempts, 2);
  });
});

function teacherRequest(url, init) {
  const headers = new Headers(init.headers || {});
  headers.set("X-Teacher-Key", env.TEACHER_ACCESS_KEY);
  return new Request(url, { ...init, headers });
}

async function submit(fields) {
  const form = new FormData();
  form.set("assignmentId", "abc123def456");
  form.set("submissionMode", fields.submissionMode);
  form.set("homeworkAia", new File([createStoredZip()], "student.aia", { type: "application/octet-stream" }));
  if (fields.email) form.set("email", fields.email);
  if (fields.className) form.set("className", fields.className);
  if (fields.seatNumber) form.set("seatNumber", fields.seatNumber);
  if (fields.overwriteConfirmed) form.set("overwriteConfirmed", "true");
  const response = await submitHomework({ request: new Request("https://example.test/api/submit-homework", { method: "POST", body: form }), env });
  return { status: response.status, data: await response.json() };
}

function rubric() { return [{ name: "功能介面需求", points: 20, description: "介面完整" }, { name: "程式邏輯完成度", points: 50, description: "邏輯完整" }, { name: "目標功能正確性", points: 30, description: "功能正確" }]; }
function grade() { return { interfaceScore: 18, logicScore: 42, correctnessScore: 26, interfaceFeedback: "介面完成", logicFeedback: "邏輯大致完成", correctnessFeedback: "功能正常", overallFeedback: "整體良好" }; }
async function withMockFetch(mock, callback) { const original = globalThis.fetch; globalThis.fetch = mock; try { await callback(); } finally { globalThis.fetch = original; } }
function jsonResponse(data) { return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } }); }

function createStoredZip() {
  const entries = [["youngandroidproject/project.properties", "main=appinventor.ai.test.Screen1"], ["src/appinventor/ai/test/Screen1.scm", '#| $JSON {"Properties":{"$Name":"Screen1"}} |#'], ["src/appinventor/ai/test/Screen1.bky", '<xml><block type="component_event"></block></xml>']];
  const localParts = []; const centralParts = []; let localOffset = 0;
  for (const [name, content] of entries) {
    const nameBuffer = Buffer.from(name); const dataBuffer = Buffer.from(content); const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); localHeader.writeUInt16LE(20, 4); localHeader.writeUInt16LE(dataBuffer.length, 18); localHeader.writeUInt16LE(dataBuffer.length, 22); localHeader.writeUInt16LE(nameBuffer.length, 26); localParts.push(localHeader, nameBuffer, dataBuffer);
    const centralHeader = Buffer.alloc(46); centralHeader.writeUInt32LE(0x02014b50, 0); centralHeader.writeUInt16LE(20, 4); centralHeader.writeUInt16LE(20, 6); centralHeader.writeUInt32LE(dataBuffer.length, 20); centralHeader.writeUInt32LE(dataBuffer.length, 24); centralHeader.writeUInt16LE(nameBuffer.length, 28); centralHeader.writeUInt32LE(localOffset, 42); centralParts.push(centralHeader, nameBuffer); localOffset += localHeader.length + nameBuffer.length + dataBuffer.length;
  }
  const centralDirectory = Buffer.concat(centralParts); const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(centralDirectory.length, 12); eocd.writeUInt32LE(localOffset, 16); return Buffer.concat([...localParts, centralDirectory, eocd]);
}
