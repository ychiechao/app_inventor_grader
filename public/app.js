const teacherTab = document.querySelector("#teacher-tab");
const studentTab = document.querySelector("#student-tab");
const teacherPanel = document.querySelector("#teacher-panel");
const studentPanel = document.querySelector("#student-panel");
const teacherForm = document.querySelector("#teacher-form");
const studentForm = document.querySelector("#student-form");
const teacherResult = document.querySelector("#teacher-result");
const studentResult = document.querySelector("#student-result");
const teacherError = document.querySelector("#teacher-error");
const studentError = document.querySelector("#student-error");
const assignmentInput = studentForm.elements.assignmentId;
const assignmentIdField = document.querySelector("#assignment-id-field");
const assignmentContext = document.querySelector("#assignment-context");
const assignmentContextCode = document.querySelector("#assignment-context-code");

teacherTab.addEventListener("click", () => setTab("teacher"));
studentTab.addEventListener("click", () => setTab("student"));
teacherForm.addEventListener("submit", submitTeacher);
studentForm.addEventListener("submit", submitStudent);

loadAssignmentFromUrl();

function setTab(tab) {
  const isTeacher = tab === "teacher";
  teacherTab.classList.toggle("active", isTeacher);
  studentTab.classList.toggle("active", !isTeacher);
  teacherPanel.classList.toggle("hidden", !isTeacher);
  studentPanel.classList.toggle("hidden", isTeacher);
}

async function submitTeacher(event) {
  event.preventDefault();
  teacherError.textContent = "";
  teacherResult.innerHTML = `<p class="empty-state">正在建立作業與評分規準...</p>`;
  setBusy(teacherForm, true);

  try {
    const response = await fetch("/api/create-assignment", {
      method: "POST",
      body: new FormData(teacherForm),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "建立作業失敗");
    renderTeacherResult(data);
  } catch (error) {
    teacherError.textContent = error.message || "建立作業失敗";
    teacherResult.innerHTML = `<p class="empty-state">建立完成後，這裡會出現作業代碼、試算表連結與 AI 評分規準。</p>`;
  } finally {
    setBusy(teacherForm, false);
  }
}

async function submitStudent(event) {
  event.preventDefault();
  const submissionMode = event.submitter?.dataset.mode === "final" ? "final" : "preview";
  studentError.textContent = "";
  if (!assignmentInput.value.trim()) {
    studentError.textContent = "缺少作業資訊，請重新開啟老師分享的連結。";
    assignmentInput.focus();
    return;
  }
  if (!studentForm.elements.homeworkAia.files?.[0]) {
    studentError.textContent = "請先選擇要評分的 .aia 檔案。";
    studentForm.elements.homeworkAia.focus();
    return;
  }
  if (submissionMode === "final" && !validateFormalFields()) return;

  studentResult.innerHTML = `<p class="empty-state">${
    submissionMode === "final" ? "正在進行正式繳交與評分..." : "正在讀取專案並進行初評..."
  }</p>`;
  setBusy(studentForm, true);

  try {
    const formData = new FormData(studentForm);
    formData.set("submissionMode", submissionMode);
    const response = await fetch("/api/submit-homework", {
      method: "POST",
      body: formData,
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || (submissionMode === "final" ? "正式繳交失敗" : "初評失敗"));
    renderStudentResult(data);
  } catch (error) {
    studentError.textContent = error.message || "處理作業失敗";
    studentResult.innerHTML = `<p class="empty-state">請確認檔案與資料後再試一次。</p>`;
  } finally {
    setBusy(studentForm, false);
  }
}

function loadAssignmentFromUrl() {
  const assignmentId = new URLSearchParams(window.location.search).get("assignment")?.trim();
  if (assignmentId) {
    assignmentInput.value = assignmentId;
    assignmentIdField.hidden = true;
    assignmentContext.hidden = false;
    assignmentContextCode.textContent = assignmentId;
    setTab("student");
    return;
  }

  if (window.location.hash === "#student") setTab("student");
}

function validateFormalFields() {
  const fields = [studentForm.elements.email, studentForm.elements.className, studentForm.elements.seatNumber];
  fields.forEach((field) => {
    field.required = true;
  });
  const valid = studentForm.reportValidity();
  fields.forEach((field) => {
    field.required = false;
  });
  if (!valid) studentError.textContent = "正式繳交請填寫電子郵件、班級與座號。";
  return valid;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.slice(0, 300) || `${response.status} ${response.statusText}`;
    throw new Error(`伺服器逾時或回傳格式錯誤：${preview}`);
  }
}

function renderTeacherResult(data) {
  const rubric = Array.isArray(data.rubric) ? data.rubric : [];
  const submissionUrl = data.submissionUrl || createSubmissionUrl(data.assignmentId);
  teacherResult.innerHTML = `
    <div class="code-box">
      <span>作業代碼</span>
      <strong>${escapeHtml(data.assignmentId)}</strong>
    </div>
    <div class="share-card">
      <span>學生上傳連結</span>
      <p>分享這個網址，學生開啟後會自動帶入作業，不需貼上代碼。</p>
      <input class="share-link" value="${escapeAttribute(submissionUrl)}" readonly aria-label="學生上傳連結" />
      <div class="share-actions">
        <button class="copy-button" type="button">複製上傳連結</button>
        <a class="link-button secondary compact" href="${escapeAttribute(submissionUrl)}" target="_blank" rel="noreferrer">開啟學生頁</a>
      </div>
    </div>
    <a class="link-button" href="${escapeAttribute(data.spreadsheetUrl)}" target="_blank" rel="noreferrer">開啟 Google 試算表</a>
    ${
      data.sampleFileUrl
        ? `<a class="link-button secondary" href="${escapeAttribute(data.sampleFileUrl)}" target="_blank" rel="noreferrer">查看範例檔案</a>`
        : ""
    }
    <div class="rubric-list">
      ${rubric
        .map(
          (item) => `
            <article>
              <strong>${escapeHtml(item.name)}：${escapeHtml(item.points)} 分</strong>
              <p>${escapeHtml(item.description)}</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;

  const copyButton = teacherResult.querySelector(".copy-button");
  copyButton.addEventListener("click", async () => {
    await copyText(submissionUrl);
    copyButton.textContent = "已複製連結";
  });
}

function renderStudentResult(data) {
  const isFinal = data.submissionMode === "final";
  studentResult.innerHTML = `
    <div class="result-status ${isFinal ? "final" : "preview"}">
      <strong>${isFinal ? (data.replaced ? "已更新正式繳交" : "正式繳交完成") : "AI 初評完成"}</strong>
      <span>${isFinal ? "本次結果與檔案已寫入老師的作業紀錄。" : "這次尚未留下正式繳交紀錄。"}</span>
    </div>
    <div class="score-grid">
      ${score("功能介面需求", data.interfaceScore, 20)}
      ${score("程式邏輯完成度", data.logicScore, 50)}
      ${score("目標功能正確性", data.correctnessScore, 30)}
      ${score("總分", data.totalScore, 100)}
    </div>
    <div class="grade-breakdown">
      ${gradeSection("功能介面需求", data.interfaceScore, 20, data.interfaceFeedback)}
      ${gradeSection("程式邏輯完成度", data.logicScore, 50, data.logicFeedback)}
      ${gradeSection("目標功能正確性", data.correctnessScore, 30, data.correctnessFeedback)}
    </div>
    <div class="overall-feedback">
      <strong>整體建議</strong>
      <p>${escapeHtml(data.overallFeedback || data.feedback || "已完成評分")}</p>
    </div>
    ${isFinal && data.fileName ? `<p class="saved-file-name">正式檔名：<strong>${escapeHtml(data.fileName)}</strong></p>` : ""}
    ${
      isFinal && data.fileUrl
        ? `<a class="link-button secondary" href="${escapeAttribute(data.fileUrl)}" target="_blank" rel="noreferrer">查看上傳檔案</a>`
        : ""
    }
  `;
}

function createSubmissionUrl(assignmentId) {
  const url = new URL("/", window.location.origin);
  url.searchParams.set("assignment", assignmentId);
  url.hash = "student";
  return url.toString();
}

function gradeSection(title, value, max, feedback) {
  return `
    <article>
      <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(value)} / ${escapeHtml(max)} 分</span></div>
      <p>${escapeHtml(feedback || "未提供此項說明")}</p>
    </article>
  `;
}

function score(label, value, max) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}<small>/${escapeHtml(max)}</small></strong></div>`;
}

function setBusy(form, busy) {
  form.querySelectorAll('button[type="submit"]').forEach((button) => {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? "處理中..." : button.dataset.label || button.textContent;
  });
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the selection-based copy method.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
