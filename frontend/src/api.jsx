import axios from "axios";

const api = axios.create({
  baseURL: "http://127.0.0.1:8000",
  timeout: 120000,
});

export async function checkBackend() {
  const response = await api.get("/health");
  return response.data;
}

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

export async function askDocuments(sessionId, question, documentNames = null) {
  const response = await api.post("/ask", {
    session_id: sessionId,
    question,
    document_names: documentNames,
  });

  return response.data;
}

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

export async function exportReport(sessionId) {
  const response = await api.get(`/report/${sessionId}`);
  return response.data;
}

export default api;
