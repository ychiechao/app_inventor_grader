const SCRIPT_TOKEN = PropertiesService.getScriptProperties().getProperty("APPS_SCRIPT_TOKEN");
const ROOT_FOLDER_ID = "1zBnc5cX_oVeuw1KDti3uGMX4Cpy9mdB6";

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || "{}");
    if (payload.token !== SCRIPT_TOKEN) {
      return json_({ ok: false, error: "Unauthorized" });
    }

    if (payload.action === "createAssignment") {
      return json_({ ok: true, data: createAssignment_(payload) });
    }

    if (payload.action === "getAssignment") {
      return json_({ ok: true, data: getAssignment_(payload) });
    }

    if (payload.action === "saveSubmission") {
      return json_({ ok: true, data: saveSubmission_(payload) });
    }

    return json_({ ok: false, error: "Unknown action" });
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function createAssignment_(payload) {
  const folder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const title = String(payload.title || "").trim();
  const description = String(payload.description || "").trim();
  const rubric = payload.rubric || [];

  if (!title || !description) {
    throw new Error("Missing title or description");
  }

  const spreadsheet = SpreadsheetApp.create("App Inventor Grading - " + title);
  const file = DriveApp.getFileById(spreadsheet.getId());
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);

  const submissions = spreadsheet.getSheets()[0];
  submissions.setName("submissions");
  submissions.getRange(1, 1, 1, 12).setValues([[
    "Time",
    "Email",
    "Class",
    "Seat Number",
    "File URL",
    "Interface Score",
    "Logic Score",
    "Correctness Score",
    "Total Score",
    "AI Feedback",
    "AIA Summary",
    "Assignment Description",
  ]]);

  const rubricSheet = spreadsheet.insertSheet("rubric");
  rubricSheet.getRange(1, 1, 2, 3).setValues([
    ["Assignment Description", "Rubric JSON", "Created At"],
    [description, JSON.stringify(rubric), new Date()],
  ]);

  let sampleFileUrl = "";
  if (payload.sampleFile && payload.sampleFile.base64) {
    const sample = saveBase64File_(folder, payload.sampleFile, "sample-" + Date.now() + "-");
    sampleFileUrl = sample.getUrl();
  }

  return {
    assignmentId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    sampleFileUrl: sampleFileUrl,
  };
}

function getAssignment_(payload) {
  const spreadsheet = openSpreadsheet_(payload.assignmentId);
  const row = spreadsheet.getSheetByName("rubric").getRange(2, 1, 1, 2).getValues()[0];
  return {
    description: String(row[0] || ""),
    rubric: JSON.parse(String(row[1] || "[]")),
  };
}

function saveSubmission_(payload) {
  if (Number(payload.submissionVersion || 0) !== 2) {
    return saveSubmissionLegacy_(payload);
  }

  const spreadsheet = openSpreadsheet_(payload.assignmentId);
  const folder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const submissions = spreadsheet.getSheetByName("submissions");
  const homeworkFile = payload.homeworkFile;
  const className = String(payload.className || "").trim();
  const seatNumber = String(payload.seatNumber || "").trim();

  if (!homeworkFile || !homeworkFile.base64 || !className || !seatNumber) {
    throw new Error("正式繳交資料不完整");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const submittedAt = new Date();
    const datePart = Utilities.formatDate(submittedAt, "Asia/Taipei", "yyyyMMdd");
    const originalBaseName = String(homeworkFile.name || "project.aia").replace(/\.aia$/i, "");
    const fileName = [
      safeFilePart_(originalBaseName, "project"),
      datePart,
      safeFilePart_(className, "class"),
      safeFilePart_(seatNumber, "seat"),
    ].join("_") + ".aia";
    const existingRow = findSubmissionRow_(submissions, className, seatNumber);
    const oldFileUrl = existingRow ? String(submissions.getRange(existingRow, 5).getDisplayValue() || "") : "";
    const file = saveBase64FileAs_(folder, homeworkFile, fileName);
    const row = existingRow || Math.max(2, submissions.getLastRow() + 1);
    const values = [[
      submittedAt,
      payload.email || "",
      className,
      seatNumber,
      file.getUrl(),
      payload.grade.interfaceScore,
      payload.grade.logicScore,
      payload.grade.correctnessScore,
      payload.grade.totalScore,
      payload.grade.feedback,
      payload.aiaSummary || "",
      payload.assignmentDescription || "",
    ]];

    submissions.getRange(row, 2, 1, 3).setNumberFormat("@");
    submissions.getRange(row, 1, 1, values[0].length).setValues(values);
    if (oldFileUrl) trashFileFromUrl_(oldFileUrl, file.getId());

    return {
      spreadsheetUrl: spreadsheet.getUrl(),
      fileUrl: file.getUrl(),
      fileName: fileName,
      replaced: Boolean(existingRow),
      submittedAt: submittedAt.toISOString(),
    };
  } finally {
    lock.releaseLock();
  }
}

function saveSubmissionLegacy_(payload) {
  const spreadsheet = openSpreadsheet_(payload.assignmentId);
  const folder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const submissions = spreadsheet.getSheetByName("submissions");

  let fileUrl = "";
  if (payload.homeworkFile && payload.homeworkFile.base64) {
    const prefix = String(payload.className || "class") + "-" + String(payload.seatNumber || "seat") + "-" + Date.now() + "-";
    const file = saveBase64File_(folder, payload.homeworkFile, prefix);
    fileUrl = file.getUrl();
  }

  submissions.appendRow([
    new Date(),
    payload.email || "",
    payload.className || "",
    payload.seatNumber || "",
    fileUrl,
    payload.grade.interfaceScore,
    payload.grade.logicScore,
    payload.grade.correctnessScore,
    payload.grade.totalScore,
    payload.grade.feedback,
    payload.aiaSummary || "",
    payload.assignmentDescription || "",
  ]);

  return {
    spreadsheetUrl: spreadsheet.getUrl(),
    fileUrl: fileUrl,
  };
}

function openSpreadsheet_(assignmentIdOrUrl) {
  const id = extractSpreadsheetId_(assignmentIdOrUrl);
  if (!id) {
    throw new Error("Missing assignment spreadsheet ID");
  }

  try {
    return SpreadsheetApp.openById(id);
  } catch (error) {
    const file = DriveApp.getFileById(id);
    return SpreadsheetApp.open(file);
  }
}

function extractSpreadsheetId_(assignmentIdOrUrl) {
  const value = String(assignmentIdOrUrl || "").trim();
  if (!value) return "";

  const urlMatch = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];

  const keyMatch = value.match(/[?&]key=([a-zA-Z0-9_-]+)/);
  if (keyMatch) return keyMatch[1];

  const plainMatch = value.match(/[a-zA-Z0-9_-]{20,}/);
  return plainMatch ? plainMatch[0] : "";
}

function saveBase64File_(folder, filePayload, prefix) {
  return saveBase64FileAs_(folder, filePayload, prefix + (filePayload.name || "project.aia"));
}

function saveBase64FileAs_(folder, filePayload, fileName) {
  const bytes = Utilities.base64Decode(filePayload.base64);
  const blob = Utilities.newBlob(
    bytes,
    filePayload.mimeType || "application/octet-stream",
    fileName
  );
  return folder.createFile(blob);
}

function findSubmissionRow_(sheet, className, seatNumber) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const values = sheet.getRange(2, 3, lastRow - 1, 2).getDisplayValues();
  const expectedClass = comparableStudentValue_(className);
  const expectedSeat = comparableStudentValue_(seatNumber);

  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (
      comparableStudentValue_(values[index][0]) === expectedClass &&
      comparableStudentValue_(values[index][1]) === expectedSeat
    ) {
      return index + 2;
    }
  }
  return 0;
}

function comparableStudentValue_(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^\d+$/.test(text) ? String(Number(text)) : text;
}

function safeFilePart_(value, fallback) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[\\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return cleaned || fallback;
}

function trashFileFromUrl_(fileUrl, replacementFileId) {
  const match = String(fileUrl || "").match(/(?:\/d\/|[?&]id=)([a-zA-Z0-9_-]+)/);
  if (!match || match[1] === replacementFileId) return;

  try {
    DriveApp.getFileById(match[1]).setTrashed(true);
  } catch (error) {
    console.warn("Unable to trash replaced submission file", error);
  }
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
