import { StrictMode, type FormEvent, useState } from "react";
import { createRoot } from "react-dom/client";
import { BookOpenCheck, FileArchive, GraduationCap, Loader2, UploadCloud } from "lucide-react";
import "./styles.css";

type RubricItem = {
  name: string;
  points: number;
  description: string;
};

type AssignmentResult = {
  assignmentId: string;
  spreadsheetUrl: string;
  sampleFileUrl?: string;
  rubric: RubricItem[];
};

type SubmissionResult = {
  totalScore: number;
  interfaceScore: number;
  logicScore: number;
  correctnessScore: number;
  feedback: string;
  spreadsheetUrl: string;
  fileUrl?: string;
};

function App() {
  const [activeTab, setActiveTab] = useState<"teacher" | "student">("teacher");

  return (
    <main className="app-shell">
      <section className="topbar">
        <div className="brand-mark">
          <BookOpenCheck size={28} />
        </div>
        <div>
          <h1>App Inventor 作業評分助手</h1>
          <p>建立作業、收件、初步評分與試算表紀錄</p>
        </div>
      </section>

      <nav className="tabs" aria-label="頁面切換">
        <button className={activeTab === "teacher" ? "active" : ""} onClick={() => setActiveTab("teacher")}>
          <GraduationCap size={18} />
          老師建立作業
        </button>
        <button className={activeTab === "student" ? "active" : ""} onClick={() => setActiveTab("student")}>
          <FileArchive size={18} />
          學生上傳作業
        </button>
      </nav>

      {activeTab === "teacher" ? <TeacherPanel /> : <StudentPanel />}
    </main>
  );
}

function TeacherPanel() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AssignmentResult | null>(null);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    const formData = new FormData();
    formData.set("title", title);
    formData.set("description", description);
    if (file) formData.set("sampleAia", file);

    try {
      const response = await fetch("/api/create-assignment", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "建立作業失敗");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立作業失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="workspace-grid">
      <form className="panel" onSubmit={submit}>
        <h2>老師端</h2>
        <label>
          作業名稱
          <input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="例如：BMI 計算器" />
        </label>
        <label>
          專案描述
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
            rows={7}
            placeholder="描述學生要完成的 App 功能、畫面與操作流程。"
          />
        </label>
        <label>
          範例 .aia
          <input type="file" accept=".aia" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <button className="primary-action" disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <UploadCloud size={18} />}
          建立作業與評分規準
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>

      <aside className="panel result-panel">
        <h2>建立結果</h2>
        {!result && <p className="empty-state">建立完成後，這裡會出現作業代碼、試算表連結與 AI 評分規準。</p>}
        {result && (
          <>
            <div className="code-box">
              <span>作業代碼</span>
              <strong>{result.assignmentId}</strong>
            </div>
            <a className="link-button" href={result.spreadsheetUrl} target="_blank" rel="noreferrer">
              開啟 Google 試算表
            </a>
            {result.sampleFileUrl && (
              <a className="link-button secondary" href={result.sampleFileUrl} target="_blank" rel="noreferrer">
                查看範例檔案
              </a>
            )}
            <div className="rubric-list">
              {result.rubric.map((item) => (
                <article key={item.name}>
                  <strong>
                    {item.name}：{item.points} 分
                  </strong>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>
          </>
        )}
      </aside>
    </section>
  );
}

function StudentPanel() {
  const [assignmentId, setAssignmentId] = useState("");
  const [email, setEmail] = useState("");
  const [className, setClassName] = useState("");
  const [seatNumber, setSeatNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("請選擇 .aia 檔案");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);

    const formData = new FormData();
    formData.set("assignmentId", assignmentId);
    formData.set("email", email);
    formData.set("className", className);
    formData.set("seatNumber", seatNumber);
    formData.set("homeworkAia", file);

    try {
      const response = await fetch("/api/submit-homework", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "上傳作業失敗");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上傳作業失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="workspace-grid">
      <form className="panel" onSubmit={submit}>
        <h2>學生端</h2>
        <label>
          作業代碼
          <input value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)} required placeholder="老師提供的作業代碼" />
        </label>
        <label>
          電子郵件
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="student@example.com" />
        </label>
        <div className="two-columns">
          <label>
            班級
            <input value={className} onChange={(event) => setClassName(event.target.value)} required placeholder="801" />
          </label>
          <label>
            座號
            <input value={seatNumber} onChange={(event) => setSeatNumber(event.target.value)} required placeholder="12" />
          </label>
        </div>
        <label>
          作業 .aia
          <input type="file" accept=".aia" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required />
        </label>
        <button className="primary-action" disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <UploadCloud size={18} />}
          上傳並取得初評
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>

      <aside className="panel result-panel">
        <h2>評分結果</h2>
        {!result && <p className="empty-state">上傳後會看到 AI 初評與試算表紀錄連結。</p>}
        {result && (
          <>
            <div className="score-grid">
              <Score label="介面" value={result.interfaceScore} />
              <Score label="邏輯" value={result.logicScore} />
              <Score label="正確度" value={result.correctnessScore} />
              <Score label="總分" value={result.totalScore} />
            </div>
            <p className="feedback">{result.feedback}</p>
            <a className="link-button" href={result.spreadsheetUrl} target="_blank" rel="noreferrer">
              查看紀錄
            </a>
            {result.fileUrl && (
              <a className="link-button secondary" href={result.fileUrl} target="_blank" rel="noreferrer">
                查看上傳檔案
              </a>
            )}
          </>
        )}
      </aside>
    </section>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
