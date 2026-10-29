
import { useState, useEffect, useRef, lazy, Suspense } from "react";
import {
  ShieldCheck,
  ArrowUpRight,
  Sparkles as SparklesIcon,
  FileSearch,
  Activity,
  LockKeyhole,
  ChevronRight,
  Upload,
  BrainCircuit,
  CircleCheck,
  Menu,
  X,
  Trash2,
  Download,
  Send,
  RefreshCw,
  Plus,
  MessageSquare
} from "lucide-react";
import api, {
  checkBackend,
  createSession,
  getSessions,
  getSession,
  renameSession,
  deleteSession,
  uploadDocuments,
  getDocuments,
  askDocuments,
  runComplianceReview,
  exportReport,
} from "./api";
import "./App.css";

const Scene = lazy(() => import("./HeroScene"));
// const SESSION_ID = "complyai-local-demo";

const REVIEW_AREAS = [
  "Access control and user permissions",
  "Information security responsibilities",
  "Security policy review and approval",
  "Incident reporting and response",
  "Data protection and retention",
  "Supplier or third-party risk management",
  "Training and awareness",
  "Monitoring, logging, and audit evidence",
];


function renderInlineMarkdown(text, keyPrefix = "text") {
  const parts = String(text ?? "").split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${keyPrefix}-${index}`}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function FormattedResponse({ text }) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let bulletItems = [];

  const flushBullets = () => {
    if (bulletItems.length) {
      blocks.push(
        <ul key={`list-${blocks.length}`}>
          {bulletItems.map((item, index) => (
            <li key={`item-${index}`}>{renderInlineMarkdown(item, `bullet-${blocks.length}-${index}`)}</li>
          ))}
        </ul>
      );
      bulletItems = [];
    }
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushBullets();
      return;
    }

    const bulletMatch = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bulletMatch) {
      bulletItems.push(bulletMatch[1]);
      return;
    }

    flushBullets();

    const headingMatch = line.match(/^\*\*(.+?)\*\*:?\s*$/) ||
      line.match(/^(#{1,3})\s+(.+)$/);

    if (headingMatch) {
      const headingText = headingMatch[2] || headingMatch[1];
      blocks.push(
        <h4 key={`heading-${index}`}>{renderInlineMarkdown(headingText, `heading-${index}`)}</h4>
      );
      return;
    }

    blocks.push(
      <p key={`paragraph-${index}`}>{renderInlineMarkdown(line, `paragraph-${index}`)}</p>
    );
  });

  flushBullets();

  return <div className="formatted-response">{blocks}</div>;
}

// --------------------------------------------------
// DASHBOARD
// --------------------------------------------------

function Dashboard({ onBack }) {

  const [activeTab, setActiveTab] = useState("Overview");
  const initializationStarted = useRef(false);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [savedSessions, setSavedSessions] = useState([]);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [serverDocuments, setServerDocuments] = useState([]);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [backendOnline, setBackendOnline] = useState(false);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");
  const [selectedQuestionDocs, setSelectedQuestionDocs] = useState([]);

  const [selectedReviewAreas, setSelectedReviewAreas] = useState(
    REVIEW_AREAS.slice(0, 5)
  );
  const [selectedReviewDocs, setSelectedReviewDocs] = useState([]);
  const [review, setReview] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");

  const [reportStatus, setReportStatus] = useState("");

  const navItems = [
    { name: "Overview", icon: Activity },
    { name: "Documents", icon: FileSearch },
    { name: "AI Analysis", icon: BrainCircuit },
    { name: "Findings", icon: ShieldCheck },
  ];

  const readableDocuments = serverDocuments.filter(
    (doc) => doc.has_text
  );
async function refreshDocuments(sessionId = activeSessionId) {
  if (!sessionId) {
    setServerDocuments([]);
    return [];
  }

  try {
    const result = await getDocuments(sessionId);
    const docs = result.documents || [];

    setServerDocuments(docs);

    setSelectedQuestionDocs((previous) =>
      previous.length
        ? previous.filter((name) =>
            docs.some((doc) => doc.name === name && doc.has_text)
          )
        : docs.filter((doc) => doc.has_text).map((doc) => doc.name)
    );

    setSelectedReviewDocs((previous) =>
      previous.length
        ? previous.filter((name) =>
            docs.some((doc) => doc.name === name && doc.has_text)
          )
        : docs.filter((doc) => doc.has_text).map((doc) => doc.name)
    );

    return docs;
  } catch (error) {
    setBackendOnline(false);
    return [];
  }
}
async function openExistingSession(sessionId) {
  try {
    setSessionError("");

    const result = await getSession(sessionId);

    setActiveSessionId(sessionId);

    const history = result.history || [];
    setSessionHistory(history);

    setReview(
      [...history]
        .reverse()
        .find((item) => item.kind === "review")
        ?.payload?.review || ""
    );

    setQuestion("");
    // setReview("");

    await refreshDocuments(sessionId);
  } catch (error) {
    setSessionError("Could not open this session. Please try again.");
  }
}

async function handleNewSession() {
  try {
    setSessionError("");

    const newSession = await createSession();

    setActiveSessionId(newSession.id);

    setSavedSessions((previous) => [
      newSession,
      ...previous.filter(
        (session) => session.id !== newSession.id
      ),
    ]);

    setSessionHistory([]);
    setServerDocuments([]);
    setQuestion("");
    setReview("");

    setSelectedQuestionDocs([]);
    setSelectedReviewDocs([]);

    setActiveTab("Overview");
  } catch (error) {
    setSessionError("Could not create a new session. Please try again.");
  }
}

useEffect(() => {
  if (initializationStarted.current) return;
  initializationStarted.current = true;

  async function initializeWorkspace() {
    try {
      await checkBackend();
      setBackendOnline(true);

      setSessionsLoading(true);
      setSessionError("");

      const result = await getSessions();
      const sessions = result.sessions || [];

      setSavedSessions(sessions);

      if (sessions.length > 0) {
        // Reopen the most recently updated session.
        const latestSession = sessions[0];
        const sessionData = await getSession(latestSession.id);

        setActiveSessionId(latestSession.id);
        setSessionHistory(sessionData.history || []);
        setServerDocuments(sessionData.documents || []);

        const latestReview = [...(sessionData.history || [])]
          .reverse()
          .find((item) => item.kind === "review");

        setReview(latestReview?.payload?.review || "");
      } else {
        // Create a session only if none exist.
        const newSession = await createSession();

        setActiveSessionId(newSession.id);
        setSavedSessions([newSession]);
        setSessionHistory([]);
        setServerDocuments([]);
      }
    } catch (error) {
      setBackendOnline(false);
      setSessionError(
        "Could not load sessions. Please check that the backend is running."
      );
    } finally {
      setSessionsLoading(false);
    }
  }

  initializeWorkspace();
}, []);


async function handleFileChange(event) {
  const selectedFiles = Array.from(event.target.files || []);

  if (!selectedFiles.length) return;

  setUploading(true);
  setUploadStatus("Uploading and checking for duplicates...");
  setUploadError("");

  try {
    const result = await uploadDocuments(activeSessionId, selectedFiles);
    const results = result.documents || [];

    const successful = results.filter(
      (item) => item.status === "success"
    );

    const duplicates = results.filter(
      (item) => item.status === "duplicate"
    );

    const failed = results.filter(
      (item) =>
        item.status !== "success" && item.status !== "duplicate"
    );

    setUploadStatus(
      `${successful.length} uploaded, ${duplicates.length} duplicate(s), ${failed.length} failed.`
    );

    if (duplicates.length || failed.length) {
      setUploadError(
        [...duplicates, ...failed]
          .map((item) => `${item.filename}: ${item.message}`)
          .join("\n")
      );
    }

    await refreshDocuments(activeSessionId);

    const updatedSessions = await getSessions();
    setSavedSessions(updatedSessions.sessions || []);

    setBackendOnline(true);
  } catch (error) {
    setUploadStatus("");
    setUploadError(
      error.response?.data?.detail ||
        "Upload failed. Check whether the Python backend is running."
    );
  } finally {
    setUploading(false);
    event.target.value = "";
  }
}


  async function handleAsk() {
    const submittedQuestion = question.trim();

    if (!submittedQuestion) {
      setAskError("Enter a question first.");
      return;
    }

    if (!activeSessionId) {
      setAskError("A workspace session is not ready yet. Please try again.");
      return;
    }

    setAsking(true);
    setAskError("");

    try {
      const documentNames = selectedQuestionDocs.filter((name) =>
        readableDocuments.some((doc) => doc.name === name)
      );
      const result = await askDocuments(
        activeSessionId,
        submittedQuestion,
        documentNames
      );

      const historyItem = {
        id: result.id,
        kind: "qa",
        created_at: result.created_at,
        payload: {
          question: result.question ?? submittedQuestion,
          answer: result.answer,
          document_names: result.document_names ?? documentNames,
        },
      };

      setSessionHistory((previous) => [...previous, historyItem]);
      setQuestion("");
    } catch (error) {
      setAskError(
        error.response?.data?.detail ||
          "The question could not be processed. Check the backend terminal for details."
      );
    } finally {
      setAsking(false);
    }
  }

  async function handleReview() {
    if (!selectedReviewAreas.length) {
      setReviewError("Select at least one review area.");
      return;
    }

    if (!readableDocuments.length) {
      setReviewError("Upload a document with extractable text first.");
      return;
    }

    setReviewing(true);
    setReviewError("");
    setReview("");

    try {
    const result = await runComplianceReview(
        activeSessionId,
        selectedReviewAreas,
        selectedReviewDocs
      );

      setReview(result.review);
setSessionHistory((previous) => [
  ...previous,
  {
    id: result.id,
    kind: "review",
    created_at: result.created_at,
    payload: {
      review: result.review,
      review_areas: selectedReviewAreas,
      document_names: selectedReviewDocs,
      disclaimer:
        "Preliminary AI findings require human verification and are not legal advice.",
    },
  },
]);
      setActiveTab("Findings");
    } catch (error) {
      setReviewError(
        error.response?.data?.detail ||
          "The compliance review could not be completed."
      );
    } finally {
      setReviewing(false);
    }
  }

  async function handleExport() {
    setReportStatus("");

    try {
      const report = await exportReport(activeSessionId);
      const blob = new Blob(
        [JSON.stringify(report, null, 2)],
        { type: "application/json" }
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "complyai-session-report.json";
      link.click();

      URL.revokeObjectURL(url);
      setReportStatus("Report downloaded.");
    } catch (error) {
      setReportStatus(
        error.response?.data?.detail || "Report export failed."
      );
    }
  }


async function handleClearDocuments() {
  if (!window.confirm("Clear all documents in this demo session?")) {
    return;
  }

  try {
    await api.delete(`/documents/${activeSessionId}`);

    setServerDocuments([]);
    setSelectedQuestionDocs([]);
    setSelectedReviewDocs([]);
    setReview("");
    setUploadStatus("All session documents cleared.");
    setUploadError("");
  } catch (error) {
    setUploadError(
      error.response?.data?.detail ||
        "Could not clear the session documents."
    );
  }
}


  function toggleItem(item, selected, setSelected) {
    setSelected((previous) =>
      previous.includes(item)
        ? previous.filter((value) => value !== item)
        : [...previous, item]
    );
  }

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <button className="brand" onClick={onBack}>
          <span className="brand-icon"><ShieldCheck /></span>
          <span>
            COMPLY<span className="brand-light">AI</span>
          </span>
        </button>

        <div className="side-label">WORKSPACE</div>

        {navItems.map(({ name, icon: Icon }) => (
          <button
            key={name}
            className={`nav-link ${activeTab === name ? "active" : ""}`}
            onClick={() => setActiveTab(name)}
          >
            <Icon size={18} />
            {name}
            {name === "Findings" && review && (
              <span className="nav-dot" />
            )}
          </button>
        ))}
              <div className="session-history">
          <div className="session-history-heading">
            <span>YOUR SESSIONS</span>
            <button
              type="button"
              className="new-session-button"
              onClick={handleNewSession}
              title="Start a new session"
            >
              <Plus size={16} />
            </button>
          </div>

          {sessionsLoading ? (
            <p className="session-empty">Loading sessions...</p>
          ) : savedSessions.length === 0 ? (
            <p className="session-empty">No previous sessions</p>
          ) : (
            <div className="session-list">
              {savedSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`session-item ${
                    activeSessionId === session.id ? "active" : ""
                  }`}
                  onClick={() => openExistingSession(session.id)}
                  title={session.title || "Untitled session"}
                >
                  <MessageSquare size={16} />
                  <span>
                    {session.title || "New session"}
                  </span>
                </button>
              ))}
            </div>
          )}

          {sessionError && (
            <p className="session-error" role="alert">
              {sessionError}
            </p>
          )}
        </div>

        <div className="sidebar-bottom">
          <div className="secure-card">
            <LockKeyhole size={19} />
            <strong>Security first</strong>
            <p>AI-assisted reviews with human oversight.</p>
          </div>
          <button className="nav-link" onClick={onBack}>
            <ArrowUpRight size={18} />
            Back to home
          </button>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="dash-header">
          <div>
            <div className="eyebrow">
              YOUR WORKSPACE / {activeTab.toUpperCase()}
            </div>
            <h1>
              {activeTab === "Overview"
                ? "Good to see you."
                : activeTab}
            </h1>
            <p className="muted">
              {activeTab === "Overview"
                ? "Your compliance intelligence, all in one place."
                : `Explore your ${activeTab.toLowerCase()} workspace.`}
            </p>
          </div>

          <div className="connected-pill">
            <span className="live-dot" />
            {backendOnline ? "Backend connected" : "Backend offline"}
          </div>
        </header>

        {activeTab === "Overview" && (
          <>
            <section className="metric-grid">
              {[
                {
                  label: "Documents",
                  value: serverDocuments.length,
                  icon: FileSearch,
                },
                {
                  label: "Documents with text",
                  value: readableDocuments.length,
                  icon: CircleCheck,
                },
                {
                  label: "Reviews completed",
                  value: review ? 1 : 0,
                  icon: ShieldCheck,
                },
                {
                  label: "Potential gaps",
                  value: "Not parsed",
                  icon: Activity,
                },
              ].map(({ label, value, icon: Icon }) => (
                <div className="metric-card" key={label}>
                  <div className="metric-top">
                    <span>{label}</span>
                    <Icon size={19} />
                  </div>
                  <strong>{value}</strong>
                  <small>Current demo session</small>
                </div>
              ))}
            </section>

            <section className="workspace-grid">
              <div className="panel upload-panel">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">EVIDENCE MANAGEMENT</div>
                    <h2>Your documents</h2>
                  </div>
                  <FileSearch className="panel-icon" />
                </div>

                <label className="dropzone">
                  <span className="upload-icon"><Upload /></span>
                  <strong>Bring your evidence in</strong>
                  <span>Choose PDF, DOCX or XLSX files</span>

                  <input
                    type="file"
                    accept=".pdf,.docx,.xlsx"
                    multiple
                    disabled={uploading}
                    onChange={handleFileChange}
                  />

                  <span className="upload-button">
                    {uploading ? "Uploading..." : "Choose documents"}
                  </span>
                </label>

                {uploadStatus && (
                  <p role="status" className="upload-status">
                    {uploadStatus}
                  </p>
                )}

                {uploadError && (
                  <pre role="alert" className="upload-error">
                    {uploadError}
                  </pre>
                )}

                {serverDocuments.length > 0 && (
                  <div className="file-list">
                    {serverDocuments.map((doc) => (
                      <div className="file-row" key={doc.name}>
                        <FileSearch size={17} />
                        <span>
                          {doc.name} — {doc.extraction_status}
                        </span>
                        {doc.has_text ? (
                          <CircleCheck size={17} />
                        ) : (
                          <Activity size={17} />
                        )}
                      </div>
                    ))}

                    <button
                      className="secondary-link"
                      onClick={handleClearDocuments}
                    >
                      <Trash2 size={15} />
                      Clear session documents
                    </button>
                  </div>
                )}

                <button
                  className="secondary-link"
                  onClick={refreshDocuments}
                >
                  <RefreshCw size={15} />
                  Refresh document library
                </button>
              </div>

              <div className="panel ai-panel">
                <div className="ai-orb-small">
                  <BrainCircuit size={30} />
                </div>
                <div className="eyebrow">INTELLIGENCE ENGINE</div>
                <h2>Your AI workspace</h2>
                <p>
                  Turn compliance evidence into structured insights,
                  traceable findings, and actionable next steps.
                </p>
                <button
                  className="primary-button"
                  onClick={() => setActiveTab("AI Analysis")}
                >
                  Explore AI analysis <ChevronRight size={17} />
                </button>
                <div className="ai-footnote">
                  <span className="live-dot" />
                  Human review always matters
                </div>
              </div>
            </section>
          </>
        )}

        {activeTab === "Documents" && (
          <section className="panel content-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">EVIDENCE LIBRARY</div>
                <h2>Document library</h2>
              </div>
              <button
                className="secondary-link"
                onClick={refreshDocuments}
              >
                <RefreshCw size={15} /> Refresh
              </button>
            </div>

            <p className="muted">
              Documents currently stored in your backend demo session.
            </p>

            {serverDocuments.length === 0 ? (
              <p>No documents uploaded yet. Start in Overview.</p>
            ) : (
              serverDocuments.map((doc) => (
                <div className="file-row" key={doc.name}>
                  <FileSearch size={17} />
                  <span>
                    <strong>{doc.name}</strong>
                    {" — "}
                    {doc.extraction_status}
                    {" · "}
                    {Math.max(1, Math.round(doc.size_bytes / 1024))} KB
                  </span>
                </div>
              ))
            )}
          </section>
        )}

        {activeTab === "AI Analysis" && (
          <section className="panel content-panel">
            <div className="ai-orb-small">
              <BrainCircuit size={30} />
            </div>
            <div className="eyebrow">GEMINI-POWERED QUESTION ANSWERING</div>
            <h2>Ask your evidence</h2>
            <p className="muted">
              Ask about your selected documents or start with a general question.
              Evidence-based answers should always be checked against the source.
            </p>

<section className="conversation-shell" aria-label="Gemini conversation">
              <div className="conversation-header">
                <div>
                  <div className="eyebrow">YOUR AI ASSISTANT</div>
                  <h3>Conversation</h3>
                  <p>Ask follow-up questions about your evidence or general compliance topics.</p>
                </div>
                <span className="conversation-status"><span /> Gemini</span>
              </div>

              <div className="session-conversation-history" aria-live="polite">
                {sessionHistory.filter((item) => item.kind === "qa").length === 0 && !asking ? (
                  <div className="conversation-empty">
                    <span className="conversation-empty-icon"><SparklesIcon size={22} /></span>
                    <strong>Your conversation starts here</strong>
                    <p>Ask a question to get a clear answer, with evidence when documents are selected.</p>
                  </div>
                ) : (
                  sessionHistory
                    .filter((item) => item.kind === "qa")
                    .map((item, index) => (
                      <div className="chat-exchange" key={item.id ?? `${item.created_at ?? "qa"}-${index}`}>
                        <div className="chat-message user-message">
                          <span className="chat-avatar user-avatar">You</span>
                          <div className="chat-bubble user-bubble">
                            <p>{item.payload?.question || "(Question unavailable)"}</p>
                          </div>
                        </div>
                        <div className="chat-message assistant-message">
                          <span className="chat-avatar assistant-avatar"><SparklesIcon size={16} /></span>
                          <div className="assistant-content">
                            <div className="assistant-heading">
                              <strong>Gemini</strong>
                              <span>AI response</span>
                            </div>
                            <div className="chat-bubble assistant-bubble">
                              <FormattedResponse text={item.payload?.answer || "No response was saved for this question."} />
                              {Array.isArray(item.payload?.document_names) && item.payload.document_names.length > 0 && (
                                <div className="evidence-chips">
                                  {item.payload.document_names.map((name) => (
                                    <span className="evidence-chip" key={name}><FileSearch size={13} /> {name}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                )}

                {asking && (
                  <div className="chat-message assistant-message typing-row" role="status">
                    <span className="chat-avatar assistant-avatar"><SparklesIcon size={16} /></span>
                    <div className="chat-bubble assistant-bubble typing-indicator">
                      <span /><span /><span />
                      <span className="typing-label">Gemini is thinking…</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="chat-composer">
                <div className="chat-composer-documents">
                  <details className="chat-evidence-picker">
                    <summary>
                      <FileSearch size={15} />
                      <span>Select evidence</span>
                      <span className="selected-doc-count">
                        {selectedQuestionDocs.filter((name) => readableDocuments.some((doc) => doc.name === name)).length} selected
                      </span>
                    </summary>
                    <div className="chat-evidence-options">
                      {readableDocuments.length === 0 ? (
                        <p className="muted">No readable documents yet. You can still ask general questions.</p>
                      ) : (
                        readableDocuments.map((doc) => (
                          <label key={doc.name} className="selection-item">
                            <input
                              type="checkbox"
                              checked={selectedQuestionDocs.includes(doc.name)}
                              onChange={() => toggleItem(doc.name, selectedQuestionDocs, setSelectedQuestionDocs)}
                            />
                            {doc.name}
                          </label>
                        ))
                      )}
                    </div>
                  </details>
                </div>

                <div className="chat-input-row">
                  <label className="visually-hidden" htmlFor="evidence-question">Message Gemini</label>
                  <textarea
                    id="evidence-question"
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (!asking && activeSessionId && question.trim()) handleAsk();
                      }
                    }}
                    placeholder="Message Gemini… (Enter to send, Shift+Enter for a new line)"
                    rows={2}
                    disabled={asking || !activeSessionId}
                  />
                  <button
                    className="chat-send-button"
                    type="button"
                    onClick={handleAsk}
                    disabled={asking || !activeSessionId || !question.trim()}
                    aria-label={asking ? "Gemini is responding" : "Send message"}
                    title="Send message"
                  >
                    {asking ? <RefreshCw size={18} className="spin-icon" /> : <Send size={18} />}
                  </button>
                </div>
                {askError && <pre role="alert" className="upload-error chat-error">{askError}</pre>}
                <p className="conversation-disclaimer">AI can make mistakes. Verify document-based claims against the original evidence. Not legal advice.</p>
              </div>
            </section>

            <div className="divider-space" />

            <div className="eyebrow">PRELIMINARY EVIDENCE REVIEW</div>
            <h2>Compliance review</h2>
            <p className="muted">
              Choose review areas and ask the AI to identify supporting
              evidence, potential gaps, and recommended follow-up.
            </p>

            <div className="selection-list">
              {REVIEW_AREAS.map((area) => (
                <label key={area} className="selection-item">
                  <input
                    type="checkbox"
                    checked={selectedReviewAreas.includes(area)}
                    onChange={() =>
                      toggleItem(
                        area,
                        selectedReviewAreas,
                        setSelectedReviewAreas
                      )
                    }
                  />
                  {area}
                </label>
              ))}
            </div>

            <div className="selection-list">
              <strong>Documents to review</strong>
              {readableDocuments.map((doc) => (
                <label key={doc.name} className="selection-item">
                  <input
                    type="checkbox"
                    checked={selectedReviewDocs.includes(doc.name)}
                    onChange={() =>
                      toggleItem(
                        doc.name,
                        selectedReviewDocs,
                        setSelectedReviewDocs
                      )
                    }
                  />
                  {doc.name}
                </label>
              ))}
            </div>

            <button
              className="primary-button"
              onClick={handleReview}
              disabled={reviewing}
            >
              {reviewing ? "Reviewing evidence..." : "Run compliance review"}
              <ChevronRight size={17} />
            </button>

            {reviewError && (
              <pre role="alert" className="upload-error">
                {reviewError}
              </pre>
            )}
          </section>
        )}

        {activeTab === "Findings" && (
          <section className="panel content-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">HUMAN-REVIEWED INSIGHTS</div>
                <h2>Findings &amp; actions</h2>
              </div>
              <ShieldCheck className="panel-icon" />
            </div>

            
            {sessionHistory.filter((item) => item.kind === "review").length === 0 && !review ? (
              <>
                <p className="muted">
                  No review has been generated in this session yet.
                </p>
                <button
                  className="primary-button"
                  onClick={() => setActiveTab("AI Analysis")}
                >
                  Start a review <ChevronRight size={17} />
                </button>
              </>
            ) : (
              <>
                {sessionHistory
                  .filter((item) => item.kind === "review")
                  .map((item) => (
                    <div className="ai-answer" key={item.id}>
                      <p className="muted">
                        {item.created_at
                          ? new Date(item.created_at).toLocaleString()
                          : ""}
                      </p>
                      <pre className="response-text">
                        {item.payload?.review}
                      </pre>
                      <div className="notice">
                        <ShieldCheck size={18} />
                        Preliminary AI findings require human verification.
                      </div>
                    </div>
                  ))}

                {review && sessionHistory.filter((item) => item.kind === "review").length === 0 && (
                  <>
                    <pre className="response-text">{review}</pre>
                    <div className="notice">
                      <ShieldCheck size={18} />
                      Preliminary AI findings require human verification.
                    </div>
                  </>
                )}
              </>
            )}

          </section>
        )}
        <section className="panel report-panel">
          <div>
            <div className="eyebrow">EXPORT</div>
            <h2>Session report</h2>
            <p className="muted">
              Download the current document inventory as a JSON report.
            </p>
          </div>
          <button className="primary-button" onClick={handleExport}>
            Download report <Download size={17} />
          </button>
          {reportStatus && (
            <p role="status" className="muted">{reportStatus}</p>
          )}
        </section>

        <p className="muted disclaimer">
          Prototype only. Do not upload confidential company data.
          AI output is preliminary and is not legal advice.
        </p>
      </main>
    </div>
  );
}

// --------------------------------------------------
// LANDING PAGE
// --------------------------------------------------

export default function App() {
  const [workspace, setWorkspace] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [backendStatus, setBackendStatus] = useState(
    "Checking backend..."
  );

  useEffect(() => {
    checkBackend()
      .then(() => setBackendStatus("Backend connected"))
      .catch(() => setBackendStatus("Backend offline"));
  }, []);

  if (workspace) {
    return <Dashboard onBack={() => setWorkspace(false)} />;
  }

  return (
    <main className="landing">
      <p className="backend-status">{backendStatus}</p>

      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <nav className="topbar">
        <button className="brand" onClick={() => setWorkspace(false)}>
          <span className="brand-icon"><ShieldCheck /></span>
          <span>
            COMPLY<span className="brand-light">AI</span>
          </span>
        </button>

        <div className={`top-links ${menuOpen ? "show-menu" : ""}`}>
          <a href="#platform" onClick={() => setMenuOpen(false)}>
            Platform
          </a>
          <a href="#intelligence" onClick={() => setMenuOpen(false)}>
            Intelligence
          </a>
          <a href="#security" onClick={() => setMenuOpen(false)}>
            Security
          </a>
        </div>

        <button
          className="nav-cta"
          onClick={() => setWorkspace(true)}
        >
          Open workspace <ArrowUpRight size={16} />
        </button>

        <button
          className="mobile-menu"
          aria-label="Toggle navigation"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
      </nav>

      <section className="hero" id="platform">
        <div className="hero-copy">
          <div className="status-label">
            <span className="live-dot" />
            INTELLIGENCE, WITH INTEGRITY
          </div>

          <h1>
            Compliance,
            <br />
            <span className="gradient-text">reimagined.</span>
          </h1>

          <p className="hero-description">
            Bring your evidence together. Discover potential gaps.
            Turn complex compliance documents into clarity with
            AI-assisted analysis and human oversight.
          </p>

          <div className="hero-actions">
            <button
              className="primary-button"
              onClick={() => setWorkspace(true)}
            >
              Enter workspace <ArrowUpRight size={18} />
            </button>
            <a className="secondary-link" href="#intelligence">
              Explore the platform <span>↓</span>
            </a>
          </div>

          <div className="hero-trust">
            <div className="trust-icon">
              <LockKeyhole size={17} />
            </div>
            <div>
              <strong>Evidence-led. Human-reviewed.</strong>
              <span>
                AI-assisted insights, not automated legal decisions.
              </span>
            </div>
          </div>
        </div>

        <div
          className="hero-visual"
          aria-label="Animated 3D holographic AI core"
        >
          <div className="visual-glow" />
          <div className="visual-ring ring-a" />
          <div className="visual-ring ring-b" />
          <div className="visual-ring ring-c" />
          <Suspense fallback={<div className="scene-loading" />}>
           <Scene />
          </Suspense>
          <div className="floating-tag tag-top">
            <span className="tag-pulse" />
            AI EVIDENCE ENGINE
          </div>
          <div className="floating-tag tag-bottom">
            <ShieldCheck size={17} />
            TRUST, BUILT ON EVIDENCE
          </div>
          <div className="visual-caption">INTELLIGENCE / 001</div>
        </div>
      </section>

      <section className="feature-strip" id="intelligence">
        <div className="feature-intro">
          <div className="eyebrow">ONE WORKSPACE. CLEARER DECISIONS.</div>
          <h2>
            From documents
            <br />
            to direction.
          </h2>
        </div>

        <article className="feature-card">
          <div className="feature-icon"><FileSearch /></div>
          <span className="feature-number">01 / EVIDENCE</span>
          <h3>Evidence, connected.</h3>
          <p>
            Bring policy documents and compliance evidence into one
            organized workspace.
          </p>
        </article>

        <article className="feature-card">
          <div className="feature-icon"><SparklesIcon /></div>
          <span className="feature-number">02 / INTELLIGENCE</span>
          <h3>AI with context.</h3>
          <p>
            Explore evidence with document-grounded questions and
            preliminary reviews.
          </p>
        </article>

        <article className="feature-card" id="security">
          <div className="feature-icon"><ShieldCheck /></div>
          <span className="feature-number">03 / OVERSIGHT</span>
          <h3>Clarity with control.</h3>
          <p>
            Keep findings transparent and recommendations subject
            to human verification.
          </p>
        </article>
      </section>

      <footer className="footer">
        <span>© 2026 COMPLYAI · PORTFOLIO PROTOTYPE</span>
        <span>BUILT FOR EVIDENCE-LED COMPLIANCE</span>
      </footer>
    </main>
  );
}
