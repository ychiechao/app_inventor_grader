const app = document.querySelector("#app");
const TEACHER_KEY_STORAGE = "app-inventor-teacher-key";

route();
window.addEventListener("popstate", route);

async function route() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/teacher") return renderTeacherDashboard();
  if (path === "/teacher/assignment") return renderTeacherAssignment();
  if (path === "/submit") return renderSubmissionPage();
  return renderHome();
}

async function renderHome() {
  setPageTitle("超哥 App Inventor 學習幫手");
  app.innerHTML = `
    <section class="page-heading">
      <div><h1>App Inventor 作業</h1><p>選擇老師發布的作業，進行 AI 初評或正式繳交。</p></div>
      <button class="icon-button" id="refresh-assignments" type="button" title="重新整理" aria-label="重新整理">↻</button>
    </section>
    <section id="assignment-list" class="assignment-list"><p class="loading-state">正在讀取作業...</p></section>
  `;
  document.querySelector("#refresh-assignments").addEventListener("click", loadPublicAssignments);
  await loadPublicAssignments();
}

async function loadPublicAssignments() {
  const container = document.querySelector("#assignment-list");
  container.innerHTML = '<p class="loading-state">正在讀取作業...</p>';
  try {
    const response = await fetch("/api/assignments");
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "讀取作業失敗");
    const assignments = Array.isArray(data.assignments) ? data.assignments : [];
    if (!assignments.length) {
      container.innerHTML = '<div class="empty-state"><strong>目前沒有已發布的作業</strong><p>老師發布後，作業會顯示在這裡。</p></div>';
      return;
    }
    container.innerHTML = assignments.map(assignmentCard).join("");
  } catch (error) {
    container.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
  }
}

function assignmentCard(item) {
  const canSubmit = item.canSubmit === true;
  return `
    <article class="assignment-card">
      <div class="assignment-card-main">
        <div class="status-line"><span class="status ${escapeAttribute(item.status)}">${statusLabel(item.status)}</span>${formatSchedule(item)}</div>
        <h2>${escapeHtml(item.title)}</h2>
        <p>${escapeHtml(item.description)}</p>
      </div>
      <div class="assignment-card-action">
        ${
          canSubmit
            ? `<a class="primary-button" href="/submit?id=${encodeURIComponent(item.id)}">繳交作業</a>`
            : `<button class="disabled-button" type="button" disabled>${item.status === "scheduled" ? "尚未開放" : "已停止繳交"}</button>`
        }
      </div>
    </article>
  `;
}

async function renderSubmissionPage() {
  const assignmentId = new URLSearchParams(window.location.search).get("id")?.trim();
  setPageTitle("學生繳交作業");
  if (!assignmentId) {
    app.innerHTML = '<div class="empty-state"><strong>缺少作業連結</strong><p>請回到作業列表重新選擇。</p><a class="primary-button" href="/">返回作業列表</a></div>';
    return;
  }

  app.innerHTML = `
    <section class="page-heading"><div><a class="back-link" href="/">← 返回作業列表</a><h1 id="submit-title">讀取作業中...</h1><p id="submit-description"></p></div></section>
    <section class="two-panel-layout">
      <form class="panel form-stack" id="student-form">
        <input type="hidden" name="assignmentId" value="${escapeAttribute(assignmentId)}" />
        <label>作業 .aia<input name="homeworkAia" type="file" accept=".aia" required /></label>
        <fieldset class="mode-control">
          <legend>選擇方式</legend>
          <label class="mode-item selected"><input type="radio" name="submissionMode" value="preview" checked /><span><strong>AI 初評</strong><small>不記名、不儲存作業</small></span></label>
          <label class="mode-item"><input type="radio" name="submissionMode" value="final" /><span><strong>正式繳交</strong><small>儲存檔案與評分紀錄</small></span></label>
        </fieldset>
        <fieldset id="student-identity" class="identity-fields" hidden>
          <legend>正式繳交資料</legend>
          <label>電子郵件<input name="email" type="email" placeholder="student@example.com" /></label>
          <div class="field-row"><label>班級<input name="className" placeholder="801" /></label><label>座號<input name="seatNumber" placeholder="12" /></label></div>
          <p>同班級、同座號重新繳交時，會取代先前檔案並更新評分。</p>
        </fieldset>
        <button class="primary-button full-width" id="student-submit" type="submit">取得 AI 初評</button>
        <p class="form-error" id="student-error"></p>
      </form>
      <aside class="panel result-panel"><h2>評分結果</h2><div id="student-result" class="empty-result">上傳作業後，這裡會分段顯示三項評分。</div></aside>
    </section>
  `;

  const form = document.querySelector("#student-form");
  form.elements.submissionMode.forEach((input) => input.addEventListener("change", updateSubmissionMode));
  form.addEventListener("submit", submitStudent);

  try {
    const response = await fetch(`/api/get-assignment?assignment=${encodeURIComponent(assignmentId)}`);
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "讀取作業失敗");
    document.querySelector("#submit-title").textContent = data.title;
    document.querySelector("#submit-description").textContent = data.description;
    if (!data.canSubmit) {
      form.querySelectorAll("input, button").forEach((control) => (control.disabled = true));
      document.querySelector("#student-error").textContent = data.status === "scheduled" ? "作業尚未開放繳交。" : "作業已停止繳交。";
    }
  } catch (error) {
    document.querySelector("#submit-title").textContent = "無法讀取作業";
    document.querySelector("#student-error").textContent = error.message;
  }
}

function updateSubmissionMode() {
  const form = document.querySelector("#student-form");
  const isFinal = form.elements.submissionMode.value === "final";
  document.querySelector("#student-identity").hidden = !isFinal;
  document.querySelector("#student-submit").textContent = isFinal ? "正式繳交作業" : "取得 AI 初評";
  document.querySelectorAll(".mode-item").forEach((item) => item.classList.toggle("selected", item.querySelector("input").checked));
}

async function submitStudent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const mode = form.elements.submissionMode.value;
  const errorElement = document.querySelector("#student-error");
  const resultElement = document.querySelector("#student-result");
  errorElement.textContent = "";

  if (!form.elements.homeworkAia.files?.[0]) return setFormError(errorElement, "請選擇 .aia 檔案。", form.elements.homeworkAia);
  if (mode === "final") {
    const required = [form.elements.email, form.elements.className, form.elements.seatNumber];
    required.forEach((field) => (field.required = true));
    const valid = form.reportValidity();
    required.forEach((field) => (field.required = false));
    if (!valid) return (errorElement.textContent = "正式繳交請填寫電子郵件、班級與座號。 ");
  }

  resultElement.innerHTML = `<p class="loading-state">${mode === "final" ? "正在評分並正式繳交..." : "正在進行 AI 初評..."}</p>`;
  setFormBusy(form, true);
  try {
    const response = await fetch("/api/submit-homework", { method: "POST", body: new FormData(form) });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "評分失敗");
    renderGradeResult(resultElement, data);
  } catch (error) {
    errorElement.textContent = error.message;
    resultElement.innerHTML = '<div class="empty-result">請確認資料後重新上傳。</div>';
  } finally {
    setFormBusy(form, false);
  }
}

function renderGradeResult(container, data) {
  const isFinal = data.submissionMode === "final";
  container.innerHTML = `
    <div class="submission-result ${isFinal ? "final" : "preview"}"><strong>${isFinal ? (data.replaced ? "重新繳交完成" : "正式繳交完成") : "AI 初評完成"}</strong><span>${isFinal ? "作業與分數已寫入老師的紀錄。" : "本次初評不會儲存個人資料與檔案。"}</span></div>
    <div class="total-score"><span>總分</span><strong>${escapeHtml(data.totalScore)}<small>/100</small></strong></div>
    <div class="grade-sections">
      ${gradeSection("功能介面需求", data.interfaceScore, 20, data.interfaceFeedback)}
      ${gradeSection("程式邏輯完成度", data.logicScore, 50, data.logicFeedback)}
      ${gradeSection("目標功能正確性", data.correctnessScore, 30, data.correctnessFeedback)}
    </div>
    <section class="overall-feedback"><strong>整體評語</strong><p>${escapeHtml(data.overallFeedback || "未提供整體評語")}</p></section>
    ${isFinal && data.fileName ? `<p class="saved-name">儲存檔名：<strong>${escapeHtml(data.fileName)}</strong></p>` : ""}
  `;
}

function gradeSection(title, score, max, feedback) {
  const percent = Math.max(0, Math.min(100, (Number(score) / max) * 100));
  return `<section class="grade-section"><header><strong>${escapeHtml(title)}</strong><span>${escapeHtml(score)} / ${max} 分</span></header><div class="score-bar"><i style="width:${percent}%"></i></div><p>${escapeHtml(feedback || "未提供此項評語")}</p></section>`;
}

async function renderTeacherDashboard() {
  setPageTitle("教師管理中心");
  const key = sessionStorage.getItem(TEACHER_KEY_STORAGE);
  if (!key) return renderTeacherLogin();

  app.innerHTML = `
    <section class="page-heading"><div><h1>教師管理中心</h1><p>建立、排程與管理所有 App Inventor 作業。</p></div><div class="heading-actions"><button class="secondary-button" id="teacher-logout" type="button">登出</button><button class="primary-button" id="new-assignment" type="button">＋ 建立作業</button></div></section>
    <section class="teacher-stats" id="teacher-stats"></section>
    <section class="management-table-wrap"><table class="management-table"><thead><tr><th>作業</th><th>狀態</th><th>開放時間</th><th>截止時間</th><th>繳交</th><th></th></tr></thead><tbody id="teacher-assignment-list"><tr><td colspan="6">正在讀取...</td></tr></tbody></table></section>
    <dialog id="assignment-dialog"><form method="dialog" class="dialog-form" id="assignment-form"><div class="dialog-heading"><h2 id="dialog-title">建立作業</h2><button class="icon-button" value="cancel" type="submit" aria-label="關閉">×</button></div><input type="hidden" name="id" /><label>作業名稱<input name="title" required /></label><label>專案描述<textarea name="description" rows="6" required></textarea></label><label id="sample-file-field">範例 .aia（選填）<input name="sampleAia" type="file" accept=".aia" /></label><div class="field-row"><label>發布狀態<select name="baseStatus"><option value="draft">草稿</option><option value="open">開放</option><option value="closed">關閉</option></select></label><label>開放時間<input name="openAt" type="datetime-local" /></label></div><label>截止時間<input name="closeAt" type="datetime-local" /></label><p class="form-error" id="assignment-form-error"></p><div class="dialog-actions"><button class="secondary-button" value="cancel" type="submit">取消</button><button class="primary-button" id="save-assignment" value="default" type="submit">儲存作業</button></div></form></dialog>
  `;
  document.querySelector("#teacher-logout").addEventListener("click", teacherLogout);
  document.querySelector("#new-assignment").addEventListener("click", () => openAssignmentDialog());
  document.querySelector("#assignment-form").addEventListener("submit", saveAssignment);
  await loadTeacherAssignments();
}

function renderTeacherLogin(message = "") {
  app.innerHTML = `<section class="login-panel"><h1>教師管理</h1><p>請輸入教師管理密碼。</p><form id="teacher-login" class="form-stack"><label>管理密碼<input name="key" type="password" autocomplete="current-password" required /></label><button class="primary-button" type="submit">進入管理中心</button><p class="form-error">${escapeHtml(message)}</p></form></section>`;
  document.querySelector("#teacher-login").addEventListener("submit", async (event) => {
    event.preventDefault();
    const key = event.currentTarget.elements.key.value;
    try {
      const response = await teacherFetch("/api/teacher?action=list", {}, key);
      if (!response.ok) throw new Error((await readJsonResponse(response)).error || "驗證失敗");
      sessionStorage.setItem(TEACHER_KEY_STORAGE, key);
      renderTeacherDashboard();
    } catch (error) {
      renderTeacherLogin(error.message);
    }
  });
}

async function loadTeacherAssignments() {
  try {
    const response = await teacherFetch("/api/teacher?action=list");
    const data = await readJsonResponse(response);
    if (response.status === 401) return teacherLogout();
    if (!response.ok) throw new Error(data.error || "讀取作業失敗");
    const items = data.assignments || [];
    document.querySelector("#teacher-stats").innerHTML = statBlock("全部作業", items.length) + statBlock("開放中", items.filter((x) => x.status === "open").length) + statBlock("已繳交", items.reduce((sum, x) => sum + Number(x.submissionCount || 0), 0));
    const tbody = document.querySelector("#teacher-assignment-list");
    tbody.innerHTML = items.length ? items.map(teacherAssignmentRow).join("") : '<tr><td colspan="6">尚未建立作業。</td></tr>';
    tbody.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => openAssignmentDialog(items.find((item) => item.id === button.dataset.edit))));
    tbody.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", async () => { await copyText(submissionUrl(button.dataset.copy)); button.textContent = "已複製"; }));
    tbody.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => deleteAssignment(items.find((item) => item.id === button.dataset.delete), button)));
  } catch (error) {
    document.querySelector("#teacher-assignment-list").innerHTML = `<tr><td colspan="6"><span class="form-error">${escapeHtml(error.message)}</span></td></tr>`;
  }
}

function teacherAssignmentRow(item) {
  return `<tr><td><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description)}</small></td><td><span class="status ${escapeAttribute(item.status)}">${statusLabel(item.status)}</span></td><td>${formatDateTime(item.openAt)}</td><td>${formatDateTime(item.closeAt)}</td><td>${escapeHtml(item.submissionCount || 0)}</td><td><div class="row-actions"><a class="icon-button" href="/teacher/assignment?id=${encodeURIComponent(item.id)}" title="查看繳交" aria-label="查看繳交">›</a><button class="icon-button" data-copy="${escapeAttribute(item.id)}" type="button" title="複製學生連結" aria-label="複製學生連結">⧉</button><button class="icon-button" data-edit="${escapeAttribute(item.id)}" type="button" title="編輯作業" aria-label="編輯作業">✎</button><button class="icon-button danger-icon-button" data-delete="${escapeAttribute(item.id)}" type="button" title="刪除作業" aria-label="刪除作業">⌫</button></div></td></tr>`;
}

async function deleteAssignment(item, button) {
  if (!item) return;
  const submissionNote = Number(item.submissionCount || 0) > 0 ? `\n目前有 ${item.submissionCount} 筆學生繳交紀錄。` : "";
  const confirmed = window.confirm(`確定刪除「${item.title}」嗎？${submissionNote}\n\n評分試算表、範例檔與學生作業檔都會移到 Google 雲端硬碟垃圾桶。`);
  if (!confirmed) return;
  button.disabled = true;
  try {
    const response = await teacherFetch("/api/teacher", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id: item.id }),
    });
    const data = await readJsonResponse(response);
    if (response.status === 401) return teacherLogout();
    if (!response.ok) throw new Error(data.error || "刪除作業失敗");
    await loadTeacherAssignments();
  } catch (error) {
    window.alert(error.message);
    button.disabled = false;
  }
}

function openAssignmentDialog(item = null) {
  const dialog = document.querySelector("#assignment-dialog");
  const form = document.querySelector("#assignment-form");
  form.reset();
  form.elements.id.value = item?.id || "";
  form.elements.title.value = item?.title || "";
  form.elements.description.value = item?.description || "";
  form.elements.baseStatus.value = item?.baseStatus || "draft";
  form.elements.openAt.value = toDateTimeLocal(item?.openAt);
  form.elements.closeAt.value = toDateTimeLocal(item?.closeAt);
  document.querySelector("#dialog-title").textContent = item ? "編輯作業" : "建立作業";
  document.querySelector("#sample-file-field").hidden = Boolean(item);
  document.querySelector("#assignment-form-error").textContent = "";
  dialog.showModal();
}

async function saveAssignment(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return document.querySelector("#assignment-dialog").close();
  const form = event.currentTarget;
  const id = form.elements.id.value;
  const errorElement = document.querySelector("#assignment-form-error");
  errorElement.textContent = "";
  setFormBusy(form, true);
  try {
    const endpoint = id ? "/api/teacher" : "/api/create-assignment";
    let response;
    if (id) {
      response = await teacherFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", id, title: form.elements.title.value, description: form.elements.description.value, baseStatus: form.elements.baseStatus.value, openAt: localToIso(form.elements.openAt.value), closeAt: localToIso(form.elements.closeAt.value) }) });
    } else {
      const formData = new FormData(form);
      formData.set("openAt", localToIso(form.elements.openAt.value));
      formData.set("closeAt", localToIso(form.elements.closeAt.value));
      response = await teacherFetch(endpoint, { method: "POST", body: formData });
    }
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "儲存作業失敗");
    document.querySelector("#assignment-dialog").close();
    await loadTeacherAssignments();
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    setFormBusy(form, false);
  }
}

async function renderTeacherAssignment() {
  const key = sessionStorage.getItem(TEACHER_KEY_STORAGE);
  if (!key) return renderTeacherLogin("請先登入後查看作業。");
  const id = new URLSearchParams(window.location.search).get("id")?.trim();
  setPageTitle("作業繳交管理");
  app.innerHTML = `<section class="page-heading"><div><a class="back-link" href="/teacher">← 返回教師管理</a><h1 id="detail-title">作業繳交管理</h1><p id="detail-description"></p></div><button class="secondary-button" id="detail-copy" type="button">複製學生連結</button></section><section class="teacher-stats" id="detail-stats"></section><section class="management-table-wrap"><table class="management-table submissions-table"><thead><tr><th>班級</th><th>座號</th><th>電子郵件</th><th>繳交時間</th><th>介面</th><th>邏輯</th><th>正確性</th><th>總分</th><th>檔案</th></tr></thead><tbody id="submission-list"><tr><td colspan="9">正在讀取...</td></tr></tbody></table></section>`;
  document.querySelector("#detail-copy").addEventListener("click", async (event) => { await copyText(submissionUrl(id)); event.currentTarget.textContent = "已複製"; });
  try {
    const response = await teacherFetch(`/api/teacher?action=detail&id=${encodeURIComponent(id || "")}`);
    const data = await readJsonResponse(response);
    if (response.status === 401) return teacherLogout();
    if (!response.ok) throw new Error(data.error || "讀取作業失敗");
    document.querySelector("#detail-title").textContent = data.assignment.title;
    document.querySelector("#detail-description").textContent = data.assignment.description;
    document.querySelector("#detail-stats").innerHTML = statBlock("繳交人數", data.submissions.length) + statBlock("平均分數", average(data.submissions.map((x) => x.totalScore))) + statBlock("作業狀態", statusLabel(data.assignment.status));
    document.querySelector("#submission-list").innerHTML = data.submissions.length ? data.submissions.map(submissionRow).join("") : '<tr><td colspan="9">尚無學生正式繳交。</td></tr>';
  } catch (error) {
    document.querySelector("#submission-list").innerHTML = `<tr><td colspan="9"><span class="form-error">${escapeHtml(error.message)}</span></td></tr>`;
  }
}

function submissionRow(item) {
  return `<tr><td>${escapeHtml(item.className)}</td><td>${escapeHtml(item.seatNumber)}</td><td>${escapeHtml(item.email)}</td><td>${formatDateTime(item.submittedAt)}</td><td>${escapeHtml(item.interfaceScore)}/20</td><td>${escapeHtml(item.logicScore)}/50</td><td>${escapeHtml(item.correctnessScore)}/30</td><td><strong>${escapeHtml(item.totalScore)}</strong></td><td>${item.fileUrl ? `<a href="${escapeAttribute(item.fileUrl)}" target="_blank" rel="noreferrer">開啟</a>` : "-"}</td></tr>`;
}

function teacherLogout() {
  sessionStorage.removeItem(TEACHER_KEY_STORAGE);
  if (window.location.pathname !== "/teacher") history.replaceState(null, "", "/teacher");
  renderTeacherLogin();
}

function teacherFetch(url, options = {}, explicitKey = null) {
  const key = explicitKey || sessionStorage.getItem(TEACHER_KEY_STORAGE) || "";
  return fetch(url, { ...options, headers: { ...(options.headers || {}), "X-Teacher-Key": key } });
}

function statBlock(label, value) { return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`; }
function average(values) { if (!values.length) return "-"; return Math.round(values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length); }
function submissionUrl(id) { return new URL(`/submit?id=${encodeURIComponent(id)}`, window.location.origin).toString(); }
function statusLabel(status) { return ({ open: "開放中", scheduled: "排程中", closed: "已截止", draft: "草稿" })[status] || "未設定"; }
function formatSchedule(item) { const parts = []; if (item.openAt) parts.push(`開放：${formatDateTime(item.openAt)}`); if (item.closeAt) parts.push(`截止：${formatDateTime(item.closeAt)}`); return parts.length ? `<small>${parts.join("　")}</small>` : ""; }
function formatDateTime(value) { if (!value) return "未設定"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "未設定" : new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Taipei" }).format(date); }
function toDateTimeLocal(value) { if (!value) return ""; const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; const parts = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" }).format(date); return parts.replace(" ", "T"); }
function localToIso(value) { return value ? new Date(value).toISOString() : ""; }
function setPageTitle(title) { document.title = `${title} | 超哥 App Inventor 學習幫手`; }
function setFormError(element, message, field) { element.textContent = message; field?.focus(); }
function setFormBusy(form, busy) {
  form.querySelectorAll("button").forEach((button) => {
    if (busy) {
      button.dataset.restoreLabel = button.textContent;
      button.disabled = true;
      button.textContent = "處理中...";
    } else {
      button.disabled = false;
      button.textContent = button.dataset.restoreLabel || button.textContent;
      delete button.dataset.restoreLabel;
    }
  });
}
async function readJsonResponse(response) { const text = await response.text(); try { return JSON.parse(text); } catch { throw new Error(`伺服器回傳格式錯誤：${text.slice(0, 180) || response.status}`); } }
async function copyText(text) { try { await navigator.clipboard.writeText(text); } catch { const input = document.createElement("textarea"); input.value = text; document.body.appendChild(input); input.select(); document.execCommand("copy"); input.remove(); } }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function escapeAttribute(value) { return escapeHtml(value); }
