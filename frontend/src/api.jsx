
import axios from "axios";

const api = axios.create({
  baseURL: "http://127.0.0.1:8000",
  timeout: 120000,
});

// Check backend connection
export async function checkBackend() {
  const response = await api.get("/health");
  return response.data;
}

// --------------------
// SESSION MANAGEMENT
// --------------------

export async function createSession(title = null) {
  const response = await api.post("/sessions", { title });
  return response.data;
}

export async function getSessions() {
  const response = await api.get("/sessions");
  return response.data;
}

export async function getSession(sessionId) {
  const response = await api.get(`/sessions/${sessionId}`);
  return response.data;
}

export async function renameSession(sessionId, title) {
  const response = await api.patch(`/sessions/${sessionId}`, { title });
  return response.data;
}

export async function deleteSession(sessionId) {
  const response = await api.delete(`/sessions/${sessionId}`);
  return response.data;
}

// --------------------
// DOCUMENT MANAGEMENT
// --------------------

export async function uploadDocuments(sessionId, files) {
  const formData = new FormData();
  formData.append("session_id", sessionId);

  for (const file of files) {
    formData.append("files", file);
  }

  const response = await api.post("/documents", formData);
  return response.data;
}

export async function getDocuments(sessionId) {
  const response = await api.get(`/documents/${sessionId}`);
  return response.data;
}

// --------------------
// AI QUESTION & ANSWER
// --------------------

export async function askDocuments(
  sessionId,
  question,
  documentNames = null
) {
  const response = await api.post("/ask", {
    session_id: sessionId,
    question,
    document_names: documentNames,
  });

  return response.data;
}

// --------------------
// COMPLIANCE REVIEW
// --------------------

export async function runComplianceReview(
  sessionId,
  reviewAreas,
  documentNames = null
) {
  const response = await api.post("/review", {
    session_id: sessionId,
    review_areas: reviewAreas,
    document_names: documentNames,
  });

  return response.data;
}

// --------------------
// REPORT EXPORT
// --------------------

export async function exportReport(sessionId) {
  const response = await api.get(`/report/${sessionId}`);
  return response.data;
}

export default api;
