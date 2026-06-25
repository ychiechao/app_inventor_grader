import assert from "node:assert/strict";
import test from "node:test";
import { onRequestPost as batchGrading } from "../functions/api/batch-grading.js";

const env = {
  APPS_SCRIPT_WEB_APP_URL: "https://example.test/apps-script",
  APPS_SCRIPT_TOKEN: "script-token",
  OPENAI_API_KEY: "openai-key",
  OPENAI_MODEL: "test-model",
  TEACHER_ACCESS_KEY: "teacher-key",
};

test("batch grading falls back to the legacy Apps Script action", async () => {
  const actions = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input) === env.APPS_SCRIPT_WEB_APP_URL) {
      const payload = JSON.parse(init.body);
      actions.push(payload.action);
      if (payload.action === "getAssignment") {
        return response({ ok: true, data: { description: "完成按鈕功能", rubric: [] } });
      }
      if (payload.action === "getBatchFileSummary") {
        return response({ ok: false, error: "Unknown action" });
      }
      if (payload.action === "getBatchFile") {
        return response({ ok: true, data: {
          unchanged: false,
          fileId: "file1",
          name: "821_02_李珈銨.aia",
          fileUrl: "https://drive.test/file1",
          updatedAt: "2026-06-25T00:00:00.000Z",
          className: "821",
          seatNumber: "02",
          studentName: "李珈銨",
          base64: storedAia().toString("base64"),
        } });
      }
      if (payload.action === "saveBatchGrade") {
        return response({ ok: true, data: { replaced: false } });
      }
    }
    if (String(input) === "https://api.openai.com/v1/responses") {
      return response({ status: "completed", output_text: JSON.stringify({
        interfaceScore: 18,
        logicScore: 42,
        correctnessScore: 26,
        interfaceFeedback: "介面完成",
        logicFeedback: "邏輯大致完整",
        correctnessFeedback: "主要功能正確",
        overallFeedback: "可再補強邊界測試",
      }) });
    }
    throw new Error(`Unexpected fetch: ${input}`);
  };

  try {
    const request = new Request("https://example.test/api/batch-grading", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Teacher-Key": "teacher-key" },
      body: JSON.stringify({ action: "grade", assignmentId: "assignment1", fileId: "file1" }),
    });
    const result = await batchGrading({ request, env });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).totalScore, 86);
    assert.deepEqual(actions, ["getAssignment", "getBatchFileSummary", "getBatchFileSummary", "getBatchFile", "saveBatchGrade"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function response(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
}

function storedAia() {
  const entries = [
    ["youngandroidproject/project.properties", "main=appinventor.ai.test.Screen1"],
    ["src/appinventor/ai/test/Screen1.scm", '#| $JSON {"Properties":{"$Name":"Screen1"}} |#'],
    ["src/appinventor/ai/test/Screen1.bky", '<xml><block type="component_event"></block></xml>'],
  ];
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, content] of entries) {
    const nameBuffer = Buffer.from(name);
    const dataBuffer = Buffer.from(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(dataBuffer.length, 18);
    localHeader.writeUInt16LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(localHeader, nameBuffer, dataBuffer);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, nameBuffer);
    localOffset += localHeader.length + nameBuffer.length + dataBuffer.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}
