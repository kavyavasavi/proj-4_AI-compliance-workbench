
import { useState, useRef, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Stars, Sparkles } from "@react-three/drei";
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
} from "lucide-react";
import * as THREE from "three";
import {
  checkBackend,
  uploadDocuments,
  getDocuments,
  askDocuments,
  runComplianceReview,
  exportReport,
} from "./api";
import "./App.css";

const SESSION_ID = "complyai-local-demo";

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

// --------------------------------------------------
// 3D HOLOGRAPHIC CORE
// --------------------------------------------------

function HolographicCore() {
  const core = useRef();
  const ring1 = useRef();
  const ring2 = useRef();

  useFrame((state, delta) => {
    if (core.current) {
      core.current.rotation.y += delta * 0.18;
      core.current.rotation.x =
        Math.sin(state.clock.elapsedTime * 0.3) * 0.12;
    }

    if (ring1.current) {
      ring1.current.rotation.x += delta * 0.12;
      ring1.current.rotation.y += delta * 0.2;
    }

    if (ring2.current) {
      ring2.current.rotation.x -= delta * 0.16;
      ring2.current.rotation.z += delta * 0.12;
    }
  });

  return (
    <group>
      <Float
        speed={1.5}
        rotationIntensity={0.18}
        floatIntensity={0.45}
      >
        <mesh ref={core}>
          <icosahedronGeometry args={[1.12, 3]} />
          <meshPhysicalMaterial
            color="#168cff"
            emissive="#063eac"
            emissiveIntensity={1.3}
            metalness={0.35}
            roughness={0.17}
            transmission={0.2}
            thickness={1.4}
            clearcoat={1}
            clearcoatRoughness={0.08}
            flatShading
          />
        </mesh>

        <mesh scale={0.77}>
          <icosahedronGeometry args={[1.12, 2]} />
          <meshBasicMaterial
            color="#80f4ff"
            wireframe
            transparent
            opacity={0.48}
          />
        </mesh>
      </Float>

      <mesh ref={ring1} rotation={[0.8, 0.25, 0.3]}>
        <torusGeometry args={[1.62, 0.009, 12, 180]} />
        <meshBasicMaterial color="#4be7ff" />
      </mesh>

      <mesh ref={ring2} rotation={[1.3, 0.8, 0.1]}>
        <torusGeometry args={[1.85, 0.006, 12, 180]} />
        <meshBasicMaterial
          color="#3478ff"
          transparent
          opacity={0.8}
        />
      </mesh>

      <mesh position={[1.2, 0.8, 0.5]}>
        <sphereGeometry args={[0.065, 20, 20]} />
        <meshBasicMaterial color="#b9fbff" />
      </mesh>

      <mesh position={[-1.5, -0.4, 0.4]}>
        <sphereGeometry args={[0.045, 20, 20]} />
        <meshBasicMaterial color="#66aaff" />
      </mesh>

      <pointLight color="#087cff" intensity={16} distance={8} />
      <pointLight
        position={[2, 2, 2]}
        color="#54eaff"
        intensity={10}
        distance={6}
      />
    </group>
  );
}

function Scene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 5.5], fov: 42 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={1.2} />
      <pointLight
        position={[-3, 2, 3]}
        intensity={3}
        color="#155eef"
      />
      <Stars
        radius={65}
        depth={35}
        count={1100}
        factor={2}
        fade
        speed={0.6}
      />
      <Sparkles
        count={90}
        scale={5}
        size={2.5}
        speed={0.3}
        color="#71dfff"
      />
      <HolographicCore />
    </Canvas>
  );
}

// --------------------------------------------------
// DASHBOARD
// --------------------------------------------------

function Dashboard({ onBack }) {
  const [activeTab, setActiveTab] = useState("Overview");
  const [serverDocuments, setServerDocuments] = useState([]);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [backendOnline, setBackendOnline] = useState(false);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
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

  async function refreshDocuments() {
    try {
      const result = await getDocuments(SESSION_ID);
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
    } catch {
      setBackendOnline(false);
      return [];
    }
  }

  useEffect(() => {
    checkBackend()
      .then(() => {
        setBackendOnline(true);
        refreshDocuments();
      })
      .catch(() => setBackendOnline(false));
  }, []);

  async function handleFileChange(event) {
    const selectedFiles = Array.from(event.target.files || []);

    if (!selectedFiles.length) return;

    setUploading(true);
    setUploadStatus("Uploading and extracting document text...");
    setUploadError("");

    try {
      const result = await uploadDocuments(SESSION_ID, selectedFiles);
      const results = result.documents || [];
      const successful = results.filter(
        (item) => item.status === "success"
      );
      const failed = results.filter(
        (item) => item.status !== "success"
      );

      setUploadStatus(
        `${successful.length} of ${results.length} file(s) uploaded successfully.`
      );

      if (failed.length) {
        setUploadError(
          failed
            .map((item) => `${item.filename}: ${item.message}`)
            .join("\n")
        );
      }

      await refreshDocuments();
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
    if (!question.trim()) {
      setAskError("Enter a question first.");
      return;
    }

    if (!readableDocuments.length) {
      setAskError("Upload a document with extractable text first.");
      return;
    }

    setAsking(true);
    setAskError("");
    setAnswer("");

    try {
      const result = await askDocuments(
        SESSION_ID,
        question,
        selectedQuestionDocs
      );

      setAnswer(result.answer);
    } catch (error) {
      setAskError(
        error.response?.data?.detail ||
          "The question could not be processed."
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
        SESSION_ID,
        selectedReviewAreas,
        selectedReviewDocs
      );

      setReview(result.review);
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
      const report = await exportReport(SESSION_ID);
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
      const { default: api } = await import("./api");
      await api.delete(`/documents/${SESSION_ID}`);

      setServerDocuments([]);
      setSelectedQuestionDocs([]);
      setSelectedReviewDocs([]);
      setAnswer("");
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
                  value: "—",
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
              Ask questions about uploaded documents. Answers depend on
              extracted document text and may require human verification.
            </p>

<div className="question-field">
  <label className="field-label" htmlFor="evidence-question">
    Your question
  </label>

              <textarea
                id="evidence-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Example: What does the policy say about incident reporting?"
                rows={4}
              />
            </div>

            <div className="selection-list">
              <strong>Select evidence documents</strong>
              {readableDocuments.length === 0 && (
                <p className="muted">Upload readable documents first.</p>
              )}

              {readableDocuments.map((doc) => (
                <label key={doc.name} className="selection-item">
                  <input
                    type="checkbox"
                    checked={selectedQuestionDocs.includes(doc.name)}
                    onChange={() =>
                      toggleItem(
                        doc.name,
                        selectedQuestionDocs,
                        setSelectedQuestionDocs
                      )
                    }
                  />
                  {doc.name}
                </label>
              ))}
            </div>

            <button
              className="primary-button"
              onClick={handleAsk}
              disabled={asking}
            >
              {asking ? "Analyzing evidence..." : "Ask Gemini"}
              <Send size={16} />
            </button>

            {askError && <pre role="alert" className="upload-error">{askError}</pre>}

            {answer && (
              <div className="ai-answer">
                <h3>
                  <SparklesIcon size={18} /> AI response
                </h3>
                <pre className="response-text">{answer}</pre>
                <p className="muted">
                  Verify the answer against the original documents.
                  This is not legal advice.
                </p>
              </div>
            )}

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

            {!review ? (
              <>
                <p className="muted">
                  No review has been generated in this browser session yet.
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
                <pre className="response-text">{review}</pre>
                <div className="notice">
                  <ShieldCheck size={18} />
                  Preliminary AI findings. A human reviewer must verify
                  evidence and recommendations.
                </div>
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
          <Scene />
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
