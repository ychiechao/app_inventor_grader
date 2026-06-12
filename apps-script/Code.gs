const SCRIPT_TOKEN = PropertiesService.getScriptProperties().getProperty("APPS_SCRIPT_TOKEN");
const ROOT_FOLDER_ID = "1zBnc5cX_oVeuw1KDti3uGMX4Cpy9mdB6";
const REGISTRY_PROPERTY = "ASSIGNMENT_REGISTRY_SPREADSHEET_ID";
const REGISTRY_HEADERS = [
  "Public ID", "Title", "Description", "Base Status", "Open At", "Close At",
  "Spreadsheet ID", "Spreadsheet URL", "Sample URL", "Rubric JSON", "Created At", "Updated At",
];

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || "{}");
    if (!SCRIPT_TOKEN || payload.token !== SCRIPT_TOKEN) return json_({ ok: false, error: "Unauthorized" });

    const actions = {
      createAssignment: createAssignment_,
      getAssignment: getAssignment_,
      listPublicAssignments: listPublicAssignments_,
      listAdminAssignments: listAdminAssignments_,
      getAssignmentAdmin: getAssignmentAdmin_,
      updateAssignment: updateAssignment_,
      deleteAssignment: deleteAssignment_,
      checkSubmission: checkSubmission_,
      saveSubmission: saveSubmission_,
    };
    const handler = actions[payload.action];
    if (!handler) return json_({ ok: false, error: "Unknown action" });
    return json_({ ok: true, data: handler(payload) });
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function createAssignment_(payload) {
  const title = String(payload.title || "").trim();
  const description = String(payload.description || "").trim();
  const rubric = payload.rubric || [];
  if (!title || !description) throw new Error("Missing title or description");

  const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const spreadsheet = SpreadsheetApp.create("App Inventor Grading - " + title);
  moveFileToFolder_(spreadsheet.getId(), rootFolder);

  const submissions = spreadsheet.getSheets()[0];
  submissions.setName("submissions");
  submissions.getRange(1, 1, 1, 12).setValues([[
    "Time", "Email", "Class", "Seat Number", "File URL", "Interface Score",
    "Logic Score", "Correctness Score", "Total Score", "AI Feedback", "AIA Summary", "Assignment Description",
  ]]);
  submissions.setFrozenRows(1);

  const publicId = createPublicId_();
  const rubricSheet = spreadsheet.insertSheet("rubric");
  rubricSheet.getRange(1, 1, 2, 5).setValues([
    ["Assignment Description", "Rubric JSON", "Created At", "Assignment Title", "Public ID"],
    [description, JSON.stringify(rubric), new Date(), title, publicId],
  ]);

  let sampleFileUrl = "";
  if (payload.sampleFile && payload.sampleFile.base64) {
    sampleFileUrl = saveBase64File_(rootFolder, payload.sampleFile, "sample-" + publicId + "-").getUrl();
  }

  const now = new Date();
  const record = {
    id: publicId,
    title: title,
    description: description,
    baseStatus: normalizeBaseStatus_(payload.baseStatus),
    openAt: parseDate_(payload.openAt),
    closeAt: parseDate_(payload.closeAt),
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    sampleFileUrl: sampleFileUrl,
    rubric: rubric,
    createdAt: now,
    updatedAt: now,
  };
  appendRegistryRecord_(record);

  return {
    assignmentId: publicId,
    spreadsheetUrl: spreadsheet.getUrl(),
    sampleFileUrl: sampleFileUrl,
  };
}

function listPublicAssignments_() {
  return readRegistryRecords_()
    .map(publicAssignment_)
    .filter(function (item) { return item.baseStatus !== "draft"; })
    .sort(function (left, right) { return String(right.createdAt).localeCompare(String(left.createdAt)); });
}

function listAdminAssignments_() {
  return readRegistryRecords_()
    .map(function (record) {
      const assignment = publicAssignment_(record);
      assignment.spreadsheetUrl = record.spreadsheetUrl;
      assignment.sampleFileUrl = record.sampleFileUrl;
      assignment.submissionCount = getSubmissionCount_(record.spreadsheetId);
      return assignment;
    })
    .sort(function (left, right) { return String(right.createdAt).localeCompare(String(left.createdAt)); });
}

function getAssignment_(payload) {
  const resolved = resolveAssignment_(payload.assignmentId);
  return publicAssignment_(resolved.record);
}

function getAssignmentAdmin_(payload) {
  const resolved = resolveAssignment_(payload.assignmentId);
  const assignment = publicAssignment_(resolved.record);
  assignment.spreadsheetUrl = resolved.record.spreadsheetUrl;
  assignment.sampleFileUrl = resolved.record.sampleFileUrl;
  return { assignment: assignment, submissions: readSubmissions_(resolved.spreadsheet) };
}

function updateAssignment_(payload) {
  const id = String(payload.assignmentId || "").trim();
  const registry = getRegistry_();
  const sheet = registry.getSheets()[0];
  const found = findRegistryRow_(sheet, id);
  if (!found) throw new Error("Assignment not found");

  const title = String(payload.title || "").trim();
  const description = String(payload.description || "").trim();
  if (!title || !description) throw new Error("Missing title or description");

  const row = found.row;
  sheet.getRange(row, 2, 1, 5).setValues([[
    title,
    description,
    normalizeBaseStatus_(payload.baseStatus),
    parseDate_(payload.openAt) || "",
    parseDate_(payload.closeAt) || "",
  ]]);
  sheet.getRange(row, 12).setValue(new Date());

  const record = registryRowToRecord_(sheet.getRange(row, 1, 1, REGISTRY_HEADERS.length).getValues()[0]);
  const spreadsheet = SpreadsheetApp.openById(record.spreadsheetId);
  spreadsheet.rename("App Inventor Grading - " + title);
  const rubricSheet = spreadsheet.getSheetByName("rubric");
  if (rubricSheet) rubricSheet.getRange(2, 1, 1, 2).setValues([[description, JSON.stringify(record.rubric)]]);
  if (rubricSheet && rubricSheet.getLastColumn() >= 4) rubricSheet.getRange(2, 4).setValue(title);

  return publicAssignment_(record);
}

function deleteAssignment_(payload) {
  const id = String(payload.assignmentId || "").trim();
  const registry = getRegistry_();
  const sheet = registry.getSheets()[0];
  const found = findRegistryRow_(sheet, id);
  if (!found) throw new Error("Assignment not found");

  const record = registryRowToRecord_(sheet.getRange(found.row, 1, 1, REGISTRY_HEADERS.length).getValues()[0]);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    trashAssignmentFiles_(record);
    sheet.deleteRow(found.row);
    return { deleted: true, assignmentId: id };
  } finally {
    lock.releaseLock();
  }
}

function trashAssignmentFiles_(record) {
  try {
    const spreadsheet = SpreadsheetApp.openById(record.spreadsheetId);
    const submissions = spreadsheet.getSheetByName("submissions");
    if (submissions && submissions.getLastRow() >= 2) {
      submissions.getRange(2, 5, submissions.getLastRow() - 1, 1).getDisplayValues().forEach(function (row) {
        trashFileFromUrl_(row[0], "");
      });
    }
  } catch (error) {
    console.warn("Unable to inspect assignment submissions before deletion", error);
  }
  trashFileFromUrl_(record.sampleFileUrl, "");
  trashFileById_(record.spreadsheetId);
}

function checkSubmission_(payload) {
  const resolved = resolveAssignment_(payload.assignmentId);
  const submissions = resolved.spreadsheet.getSheetByName("submissions");
  const row = findSubmissionRowByEmail_(submissions, payload.email);
  if (!row) return { exists: false };
  const values = submissions.getRange(row, 1, 1, 4).getDisplayValues()[0];
  return {
    exists: true,
    submittedAt: values[0] || "",
    className: values[2] || "",
    seatNumber: values[3] || "",
  };
}

function saveSubmission_(payload) {
  const resolved = resolveAssignment_(payload.assignmentId);
  const assignment = publicAssignment_(resolved.record);
  if (!assignment.canSubmit) throw new Error(assignment.status === "scheduled" ? "作業尚未開放繳交" : "作業已停止繳交");
  if (Number(payload.submissionVersion || 0) !== 2) return saveSubmissionLegacy_(payload, resolved.spreadsheet);

  const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const submissions = resolved.spreadsheet.getSheetByName("submissions");
  const homeworkFile = payload.homeworkFile;
  const email = String(payload.email || "").trim();
  const className = String(payload.className || "").trim();
  const seatNumber = String(payload.seatNumber || "").trim();
  if (!homeworkFile || !homeworkFile.base64 || !email || !className || !seatNumber) throw new Error("正式繳交資料不完整");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const submittedAt = new Date();
    const datePart = Utilities.formatDate(submittedAt, "Asia/Taipei", "yyyyMMdd");
    const originalBaseName = String(homeworkFile.name || "project.aia").replace(/\.aia$/i, "");
    const fileName = [safeFilePart_(originalBaseName, "project"), datePart, safeFilePart_(className, "class"), safeFilePart_(seatNumber, "seat")].join("_") + ".aia";
    const existingRow = findSubmissionRowByEmail_(submissions, email);
    if (existingRow && payload.overwriteConfirmed !== true) throw new Error("此電子郵件已繳交過，尚未確認覆蓋");
    const oldFileUrl = existingRow ? String(submissions.getRange(existingRow, 5).getDisplayValue() || "") : "";
    const file = saveBase64FileAs_(rootFolder, homeworkFile, fileName);
    const row = existingRow || Math.max(2, submissions.getLastRow() + 1);
    const values = [[submittedAt, email, className, seatNumber, file.getUrl(), payload.grade.interfaceScore, payload.grade.logicScore, payload.grade.correctnessScore, payload.grade.totalScore, payload.grade.feedback, payload.aiaSummary || "", payload.assignmentDescription || ""]];
    submissions.getRange(row, 2, 1, 3).setNumberFormat("@");
    submissions.getRange(row, 1, 1, values[0].length).setValues(values);
    if (oldFileUrl) trashFileFromUrl_(oldFileUrl, file.getId());
    return { spreadsheetUrl: resolved.spreadsheet.getUrl(), fileUrl: file.getUrl(), fileName: fileName, replaced: Boolean(existingRow), submittedAt: submittedAt.toISOString() };
  } finally {
    lock.releaseLock();
  }
}

function saveSubmissionLegacy_(payload, spreadsheet) {
  const folder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const submissions = spreadsheet.getSheetByName("submissions");
  let fileUrl = "";
  if (payload.homeworkFile && payload.homeworkFile.base64) {
    const prefix = String(payload.className || "class") + "-" + String(payload.seatNumber || "seat") + "-" + Date.now() + "-";
    fileUrl = saveBase64File_(folder, payload.homeworkFile, prefix).getUrl();
  }
  submissions.appendRow([new Date(), payload.email || "", payload.className || "", payload.seatNumber || "", fileUrl, payload.grade.interfaceScore, payload.grade.logicScore, payload.grade.correctnessScore, payload.grade.totalScore, payload.grade.feedback, payload.aiaSummary || "", payload.assignmentDescription || ""]);
  return { spreadsheetUrl: spreadsheet.getUrl(), fileUrl: fileUrl };
}

function getRegistry_() {
  const properties = PropertiesService.getScriptProperties();
  const existingId = properties.getProperty(REGISTRY_PROPERTY);
  if (existingId) {
    try { return SpreadsheetApp.openById(existingId); } catch (error) { console.warn("Registry missing; rebuilding", error); }
  }
  const spreadsheet = SpreadsheetApp.create("App Inventor Assignment Registry");
  moveFileToFolder_(spreadsheet.getId(), DriveApp.getFolderById(ROOT_FOLDER_ID));
  const sheet = spreadsheet.getSheets()[0];
  sheet.setName("assignments");
  sheet.getRange(1, 1, 1, REGISTRY_HEADERS.length).setValues([REGISTRY_HEADERS]);
  sheet.setFrozenRows(1);
  properties.setProperty(REGISTRY_PROPERTY, spreadsheet.getId());
  migrateLegacyAssignments_(sheet, spreadsheet.getId());
  return spreadsheet;
}

function migrateLegacyAssignments_(registrySheet, registrySpreadsheetId) {
  const files = DriveApp.getFolderById(ROOT_FOLDER_ID).getFilesByType(MimeType.GOOGLE_SHEETS);
  while (files.hasNext()) {
    const file = files.next();
    if (file.getId() === registrySpreadsheetId || file.getName().indexOf("App Inventor Grading - ") !== 0) continue;
    try {
      const spreadsheet = SpreadsheetApp.openById(file.getId());
      const rubricSheet = spreadsheet.getSheetByName("rubric");
      if (!rubricSheet || rubricSheet.getLastRow() < 2) continue;
      const row = rubricSheet.getRange(2, 1, 1, Math.max(5, rubricSheet.getLastColumn())).getValues()[0];
      const publicId = String(row[4] || createPublicId_());
      if (!row[4]) rubricSheet.getRange(2, 5).setValue(publicId);
      registrySheet.appendRow(recordToRegistryRow_({
        id: publicId,
        title: String(row[3] || file.getName().replace(/^App Inventor Grading - /, "")),
        description: String(row[0] || ""),
        baseStatus: "open",
        openAt: null,
        closeAt: null,
        spreadsheetId: file.getId(),
        spreadsheetUrl: spreadsheet.getUrl(),
        sampleFileUrl: "",
        rubric: JSON.parse(String(row[1] || "[]")),
        createdAt: file.getDateCreated(),
        updatedAt: file.getLastUpdated(),
      }));
    } catch (error) {
      console.warn("Unable to migrate assignment " + file.getName(), error);
    }
  }
}

function appendRegistryRecord_(record) {
  getRegistry_().getSheets()[0].appendRow(recordToRegistryRow_(record));
}

function readRegistryRecords_() {
  const sheet = getRegistry_().getSheets()[0];
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, REGISTRY_HEADERS.length).getValues().map(registryRowToRecord_);
}

function resolveAssignment_(assignmentId) {
  const id = String(assignmentId || "").trim();
  if (!id) throw new Error("Missing assignment ID");
  const record = readRegistryRecords_().filter(function (item) { return item.id === id; })[0];
  if (record) return { record: record, spreadsheet: SpreadsheetApp.openById(record.spreadsheetId) };

  const legacyId = extractSpreadsheetId_(id);
  if (!legacyId) throw new Error("Assignment not found");
  const spreadsheet = SpreadsheetApp.openById(legacyId);
  const rubricSheet = spreadsheet.getSheetByName("rubric");
  const row = rubricSheet.getRange(2, 1, 1, Math.max(4, rubricSheet.getLastColumn())).getValues()[0];
  return {
    spreadsheet: spreadsheet,
    record: {
      id: legacyId,
      title: String(row[3] || spreadsheet.getName().replace(/^App Inventor Grading - /, "")),
      description: String(row[0] || ""),
      baseStatus: "open",
      openAt: null,
      closeAt: null,
      spreadsheetId: legacyId,
      spreadsheetUrl: spreadsheet.getUrl(),
      sampleFileUrl: "",
      rubric: JSON.parse(String(row[1] || "[]")),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

function publicAssignment_(record) {
  const state = computeStatus_(record);
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    baseStatus: record.baseStatus,
    status: state.status,
    canSubmit: state.canSubmit,
    openAt: isoDate_(record.openAt),
    closeAt: isoDate_(record.closeAt),
    rubric: record.rubric,
    createdAt: isoDate_(record.createdAt),
    updatedAt: isoDate_(record.updatedAt),
  };
}

function computeStatus_(record) {
  if (record.baseStatus === "draft") return { status: "draft", canSubmit: false };
  if (record.baseStatus === "closed") return { status: "closed", canSubmit: false };
  const now = new Date();
  if (record.openAt && new Date(record.openAt) > now) return { status: "scheduled", canSubmit: false };
  if (record.closeAt && new Date(record.closeAt) <= now) return { status: "closed", canSubmit: false };
  return { status: "open", canSubmit: true };
}

function readSubmissions_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName("submissions");
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues().map(function (row) {
    return { submittedAt: isoDate_(row[0]), email: String(row[1] || ""), className: String(row[2] || ""), seatNumber: String(row[3] || ""), fileUrl: String(row[4] || ""), interfaceScore: Number(row[5] || 0), logicScore: Number(row[6] || 0), correctnessScore: Number(row[7] || 0), totalScore: Number(row[8] || 0), feedback: String(row[9] || "") };
  }).sort(function (left, right) { return String(right.submittedAt).localeCompare(String(left.submittedAt)); });
}

function getSubmissionCount_(spreadsheetId) {
  try { const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName("submissions"); return Math.max(0, sheet.getLastRow() - 1); } catch (error) { return 0; }
}

function recordToRegistryRow_(record) {
  return [record.id, record.title, record.description, record.baseStatus, record.openAt || "", record.closeAt || "", record.spreadsheetId, record.spreadsheetUrl, record.sampleFileUrl || "", JSON.stringify(record.rubric || []), record.createdAt || new Date(), record.updatedAt || new Date()];
}

function registryRowToRecord_(row) {
  return { id: String(row[0] || ""), title: String(row[1] || ""), description: String(row[2] || ""), baseStatus: normalizeBaseStatus_(row[3]), openAt: validDateOrNull_(row[4]), closeAt: validDateOrNull_(row[5]), spreadsheetId: String(row[6] || ""), spreadsheetUrl: String(row[7] || ""), sampleFileUrl: String(row[8] || ""), rubric: JSON.parse(String(row[9] || "[]")), createdAt: validDateOrNull_(row[10]), updatedAt: validDateOrNull_(row[11]) };
}

function findRegistryRow_(sheet, id) {
  if (sheet.getLastRow() < 2) return null;
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  for (let index = 0; index < ids.length; index += 1) if (ids[index][0] === id) return { row: index + 2 };
  return null;
}

function createPublicId_() { return Utilities.getUuid().replace(/-/g, "").slice(0, 12); }
function normalizeBaseStatus_(value) { const status = String(value || "draft"); return ["draft", "open", "closed"].indexOf(status) >= 0 ? status : "draft"; }
function parseDate_(value) { if (!value) return null; const date = new Date(value); return isNaN(date.getTime()) ? null : date; }
function validDateOrNull_(value) { if (!value) return null; const date = value instanceof Date ? value : new Date(value); return isNaN(date.getTime()) ? null : date; }
function isoDate_(value) { const date = validDateOrNull_(value); return date ? date.toISOString() : ""; }
function moveFileToFolder_(fileId, folder) { const file = DriveApp.getFileById(fileId); folder.addFile(file); DriveApp.getRootFolder().removeFile(file); }
function extractSpreadsheetId_(value) { const text = String(value || "").trim(); const url = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/); if (url) return url[1]; const plain = text.match(/[a-zA-Z0-9_-]{20,}/); return plain ? plain[0] : ""; }
function saveBase64File_(folder, payload, prefix) { return saveBase64FileAs_(folder, payload, prefix + (payload.name || "project.aia")); }
function saveBase64FileAs_(folder, payload, name) { return folder.createFile(Utilities.newBlob(Utilities.base64Decode(payload.base64), payload.mimeType || "application/octet-stream", name)); }
function findSubmissionRow_(sheet, className, seatNumber) { const lastRow = sheet.getLastRow(); if (lastRow < 2) return 0; const values = sheet.getRange(2, 3, lastRow - 1, 2).getDisplayValues(); const expectedClass = comparableStudentValue_(className); const expectedSeat = comparableStudentValue_(seatNumber); for (let index = values.length - 1; index >= 0; index -= 1) if (comparableStudentValue_(values[index][0]) === expectedClass && comparableStudentValue_(values[index][1]) === expectedSeat) return index + 2; return 0; }
function findSubmissionRowByEmail_(sheet, email) { const lastRow = sheet.getLastRow(); if (lastRow < 2) return 0; const expected = String(email || "").trim().toLowerCase(); if (!expected) return 0; const values = sheet.getRange(2, 2, lastRow - 1, 1).getDisplayValues(); for (let index = values.length - 1; index >= 0; index -= 1) if (String(values[index][0] || "").trim().toLowerCase() === expected) return index + 2; return 0; }
function comparableStudentValue_(value) { const text = String(value || "").trim().toLowerCase(); return /^\d+$/.test(text) ? String(Number(text)) : text; }
function safeFilePart_(value, fallback) { const cleaned = String(value || "").trim().replace(/[\\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 80); return cleaned || fallback; }
function trashFileFromUrl_(url, replacementId) { const match = String(url || "").match(/(?:\/d\/|[?&]id=)([a-zA-Z0-9_-]+)/); if (!match || match[1] === replacementId) return; try { DriveApp.getFileById(match[1]).setTrashed(true); } catch (error) { console.warn("Unable to trash replaced file", error); } }
function trashFileById_(fileId) { if (!fileId) return; try { DriveApp.getFileById(fileId).setTrashed(true); } catch (error) { console.warn("Unable to trash assignment file", error); } }
function json_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
