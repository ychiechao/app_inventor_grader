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

teacherTab.addEventListener("click", () => setTab("teacher"));
studentTab.addEventListener("click", () => setTab("student"));
teacherForm.addEventListener("submit", submitTeacher);
studentForm.addEventListener("submit", submitStudent);

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
  studentError.textContent = "";
  studentResult.innerHTML = `<p class="empty-state">正在上傳並進行初評...</p>`;
  setBusy(studentForm, true);

  try {
    const response = await fetch("/api/submit-homework", {
      method: "POST",
      body: new FormData(studentForm),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "上傳作業失敗");
    renderStudentResult(data);
  } catch (error) {
    studentError.textContent = error.message || "上傳作業失敗";
    studentResult.innerHTML = `<p class="empty-state">上傳後會看到 AI 初評與試算表紀錄連結。</p>`;
  } finally {
    setBusy(studentForm, false);
  }
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
  teacherResult.innerHTML = `
    <div class="code-box">
      <span>作業代碼</span>
      <strong>${escapeHtml(data.assignmentId)}</strong>
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
}

function renderStudentResult(data) {
  studentResult.innerHTML = `
    <div class="score-grid">
      ${score("功能介面", data.interfaceScore, 20)}
      ${score("程式邏輯", data.logicScore, 50)}
      ${score("目標正確", data.correctnessScore, 30)}
      ${score("總分", data.totalScore, 100)}
    </div>
    <p class="feedback">${escapeHtml(data.feedback)}</p>
    <a class="link-button" href="${escapeAttribute(data.spreadsheetUrl)}" target="_blank" rel="noreferrer">查看紀錄</a>
    ${
      data.fileUrl
        ? `<a class="link-button secondary" href="${escapeAttribute(data.fileUrl)}" target="_blank" rel="noreferrer">查看上傳檔案</a>`
        : ""
    }
  `;
}

function score(label, value, max) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}<small>/${escapeHtml(max)}</small></strong></div>`;
}

function setBusy(form, busy) {
  const button = form.querySelector("button");
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? "處理中..." : button.dataset.label || button.textContent;
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
