import assert from "node:assert/strict";
import test from "node:test";
import { File } from "node:buffer";
import { onRequestPost as createAssignment } from "../functions/api/create-assignment.js";
import { onRequestPost as submitHomework } from "../functions/api/submit-homework.js";

const env = {
  APPS_SCRIPT_WEB_APP_URL: "https://example.test/apps-script",
  APPS_SCRIPT_TOKEN: "test-token",
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "test-model",
};

test("assignment creation returns a branch-aware student upload link", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "https://api.openai.com/v1/responses") {
      return jsonResponse({
        status: "completed",
        output_text: JSON.stringify({
          rubric: [
            { name: "功能介面需求", points: 20, description: "介面完整" },
            { name: "程式邏輯完成度", points: 50, description: "邏輯完整" },
            { name: "目標功能正確性", points: 30, description: "功能正確" },
          ],
        }),
      });
    }
    if (url === env.APPS_SCRIPT_WEB_APP_URL) {
      const payload = JSON.parse(init.body);
      assert.equal(payload.action, "createAssignment");
      return jsonResponse({
        ok: true,
        data: {
          assignmentId: "assignment-12345678901234567890",
          spreadsheetUrl: "https://example.test/sheet",
          sampleFileUrl: "",
        },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const form = new FormData();
    form.set("title", "BMI 計算器");
    form.set("description", "輸入身高體重並顯示 BMI");
    const response = await createAssignment({
      request: new Request("https://branch.pages.dev/api/create-assignment", { method: "POST", body: form }),
      env,
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(
      data.submissionUrl,
      "https://branch.pages.dev/?assignment=assignment-12345678901234567890#student",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preview grades without saving, while final submission requires and saves student data", async () => {
  const appsScriptActions = [];
  let openAiCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === env.APPS_SCRIPT_WEB_APP_URL) {
      const payload = JSON.parse(init.body);
      appsScriptActions.push(payload.action);
      if (payload.action === "getAssignment") {
        return jsonResponse({ ok: true, data: { description: "完成計算功能", rubric: [] } });
      }
      if (payload.action === "saveSubmission") {
        return jsonResponse({
          ok: true,
          data: {
            spreadsheetUrl: "https://example.test/sheet",
            fileUrl: "https://example.test/file",
            fileName: "student_20260611_801_12.aia",
            replaced: false,
          },
        });
      }
    }

    if (url === "https://api.openai.com/v1/responses") {
      openAiCalls += 1;
      return jsonResponse({
        status: "completed",
        output_text: JSON.stringify({
          interfaceScore: 18,
          logicScore: 42,
          correctnessScore: 26,
          interfaceFeedback: "介面元件大致完整。",
          logicFeedback: "主要事件與計算流程已建立。",
          correctnessFeedback: "核心功能可運作，仍缺少例外處理。",
          overallFeedback: "補上輸入檢查後即可正式繳交。",
        }),
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const preview = await submit({ submissionMode: "preview" });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.submissionMode, "preview");
    assert.equal(preview.data.totalScore, 86);
    assert.deepEqual(appsScriptActions, ["getAssignment"]);
    assert.equal(openAiCalls, 1);

    appsScriptActions.length = 0;
    const missingStudentData = await submit({ submissionMode: "final" });
    assert.equal(missingStudentData.status, 400);
    assert.deepEqual(appsScriptActions, []);
    assert.equal(openAiCalls, 1);

    const oversized = await submit({
      submissionMode: "final",
      email: "student@example.com",
      className: "801",
      seatNumber: "12",
      file: new File([Buffer.alloc(1_500_001)], "large.aia", { type: "application/octet-stream" }),
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(appsScriptActions, ["getAssignment"]);
    assert.equal(openAiCalls, 1);

    appsScriptActions.length = 0;
    const final = await submit({
      submissionMode: "final",
      email: "student@example.com",
      className: "801",
      seatNumber: "12",
    });
    assert.equal(final.status, 200);
    assert.equal(final.data.submissionMode, "final");
    assert.equal(final.data.fileName, "student_20260611_801_12.aia");
    assert.deepEqual(appsScriptActions, ["getAssignment", "saveSubmission"]);
    assert.equal(openAiCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function submit(fields) {
  const form = new FormData();
  form.set("assignmentId", "assignment-12345678901234567890");
  form.set("submissionMode", fields.submissionMode);
  form.set(
    "homeworkAia",
    fields.file || new File([createStoredZip()], "student.aia", { type: "application/octet-stream" }),
  );
  if (fields.email) form.set("email", fields.email);
  if (fields.className) form.set("className", fields.className);
  if (fields.seatNumber) form.set("seatNumber", fields.seatNumber);

  const response = await submitHomework({
    request: new Request("https://preview.example.test/api/submit-homework", { method: "POST", body: form }),
    env,
  });
  return { status: response.status, data: await response.json() };
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createStoredZip() {
  const entries = [
    ["youngandroidproject/project.properties", "main=appinventor.ai.test.Screen1"],
    ["src/appinventor/ai/test/Screen1.scm", "#| $JSON {\"Properties\":{\"$Name\":\"Screen1\"}} |#"],
    ["src/appinventor/ai/test/Screen1.bky", "<xml><block type=\"component_event\"></block></xml>"],
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
