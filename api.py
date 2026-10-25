
import io
import os
import json
from datetime import datetime
from threading import Lock

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pypdf import PdfReader
from docx import Document
from openpyxl import load_workbook
from google import genai
from google.genai import types

load_dotenv()

app = FastAPI(title="AI Compliance Workbench API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)

SUPPORTED_TYPES = {"pdf", "docx", "xlsx"}
MAX_FILE_SIZE = 20 * 1024 * 1024
MAX_CONTEXT_CHARS = 45000

# Prototype storage: documents exist only while this API process runs.
sessions = {}
sessions_lock = Lock()


def get_documents(session_id):
    with sessions_lock:
        return sessions.setdefault(session_id, {})


def extract_document(filename, file_bytes):
    name = filename.lower()
    stream = io.BytesIO(file_bytes)

    if name.endswith(".pdf"):
        reader = PdfReader(stream)
        pages = []

        for number, page in enumerate(reader.pages, start=1):
            text = page.extract_text() or ""
            if text.strip():
                pages.append(f"[Page {number}]\n{text}")

        return "\n\n".join(pages)

    if name.endswith(".docx"):
        document = Document(stream)
        parts = [
            paragraph.text
            for paragraph in document.paragraphs
            if paragraph.text.strip()
        ]

        for index, table in enumerate(document.tables, start=1):
            rows = [
                " | ".join(cell.text.strip() for cell in row.cells)
                for row in table.rows
            ]
            parts.append(f"[Table {index}]\n" + "\n".join(rows))

        return "\n\n".join(parts)

    if name.endswith(".xlsx"):
        workbook = load_workbook(
            stream, read_only=True, data_only=True
        )
        parts = []

        try:
            for sheet in workbook.worksheets:
                parts.append(f"[Sheet: {sheet.title}]")

                for row in sheet.iter_rows(values_only=True):
                    values = [
                        "" if value is None else str(value)
                        for value in row
                    ]
                    if any(value.strip() for value in values):
                        parts.append(" | ".join(values))
        finally:
            workbook.close()

        return "\n".join(parts)

    raise ValueError("Unsupported file type.")


def build_context(documents, selected_names=None):
    chunks = []

    for name, item in documents.items():
        if selected_names is not None and name not in selected_names:
            continue

        if item["text"].strip():
            chunks.append(f"DOCUMENT: {name}\n{item['text']}")

    return "\n\n---\n\n".join(chunks)[:MAX_CONTEXT_CHARS]


def ask_ai(prompt, context, system_instruction):
    api_key = os.getenv("GEMINI_API_KEY", "").strip()

    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Gemini is not configured on the server.",
        )

    if not context.strip():
        raise HTTPException(
            status_code=400,
            detail="No extractable text in the selected documents.",
        )

    try:
        client = genai.Client(api_key=api_key)
        model = os.getenv(
            "GEMINI_MODEL", "gemini-3.5-flash-lite"
        )

        response = client.models.generate_content(
            model=model,
            contents=(
                f"DOCUMENT EVIDENCE:\n{context}\n\n"
                f"REQUEST:\n{prompt}"
            ),
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.1,
            ),
        )

        if not response.text:
            raise HTTPException(
                status_code=502,
                detail="Gemini returned an empty response.",
            )

        return response.text

    except HTTPException:
        raise
    except Exception:
        # Keep API keys and internal exception details out of responses.
        raise HTTPException(
            status_code=502,
            detail="The AI request failed. Check the backend terminal.",
        )


class QuestionRequest(BaseModel):
    session_id: str
    question: str
    document_names: list[str] | None = None


class ReviewRequest(BaseModel):
    session_id: str
    review_areas: list[str]
    document_names: list[str] | None = None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "AI Compliance Workbench API",
        "gemini_configured": bool(
            os.getenv("GEMINI_API_KEY", "").strip()
        ),
    }


@app.post("/documents")
async def upload_documents(
    session_id: str = Form(...),
    files: list[UploadFile] = File(...),
):
    if not session_id.strip():
        raise HTTPException(status_code=400, detail="Session ID required.")

    if not files:
        raise HTTPException(status_code=400, detail="Choose files to upload.")

    documents = get_documents(session_id)
    results = []

    for uploaded in files:
        filename = os.path.basename(uploaded.filename or "").strip()

        if not filename or "." not in filename:
            results.append({
                "filename": filename or "unknown",
                "status": "failed",
                "message": "Invalid filename.",
            })
            continue

        extension = filename.rsplit(".", 1)[-1].lower()

        if extension not in SUPPORTED_TYPES:
            results.append({
                "filename": filename,
                "status": "failed",
                "message": "Supported formats: PDF, DOCX, XLSX.",
            })
            continue

        file_bytes = await uploaded.read()

        if len(file_bytes) > MAX_FILE_SIZE:
            results.append({
                "filename": filename,
                "status": "failed",
                "message": "File exceeds the 20 MB limit.",
            })
            continue

        try:
            extracted = extract_document(filename, file_bytes)
            status = (
                "Text extracted"
                if extracted.strip()
                else "No extractable text found"
            )

            documents[filename] = {
                "name": filename,
                "type": extension,
                "size": len(file_bytes),
                "text": extracted,
                "uploaded_at": datetime.now().isoformat(
                    timespec="minutes"
                ),
                "extraction_status": status,
            }

            results.append({
                "filename": filename,
                "status": "success",
                "extraction_status": status,
                "size_bytes": len(file_bytes),
            })

        except Exception:
            results.append({
                "filename": filename,
                "status": "failed",
                "message": (
                    "Could not read this file. "
                    "Check its format and contents."
                ),
            })

    return {
        "documents": results,
        "library": list_documents(session_id)["documents"],
    }


def list_documents(session_id):
    documents = get_documents(session_id)
    return {
        "documents": [
            {
                "name": item["name"],
                "type": item["type"],
                "size_bytes": item["size"],
                "uploaded_at": item["uploaded_at"],
                "extraction_status": item["extraction_status"],
                "has_text": bool(item["text"].strip()),
            }
            for item in documents.values()
        ]
    }


@app.get("/documents/{session_id}")
def get_document_library(session_id: str):
    return list_documents(session_id)


@app.delete("/documents/{session_id}")
def clear_documents(session_id: str):
    with sessions_lock:
        sessions.pop(session_id, None)
    return {"message": "Session documents cleared."}


@app.post("/ask")
def ask_documents(request: QuestionRequest):
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Enter a question.")

    documents = get_documents(request.session_id)

    if request.document_names is not None:
        missing = set(request.document_names) - set(documents)
        if missing:
            raise HTTPException(
                status_code=404,
                detail="One or more selected documents were not found.",
            )

    context = build_context(documents, request.document_names)

    answer = ask_ai(
        request.question,
        context,
        (
            "You are a careful compliance document assistant. "
            "Answer only from supplied evidence. If the answer is absent, "
            "say so. Cite filenames and page labels when available. "
            "Separate evidence from interpretation. Do not claim legal "
            "compliance or provide legal advice."
        ),
    )

    return {"question": request.question, "answer": answer}


@app.post("/review")
def compliance_review(request: ReviewRequest):
    if not request.review_areas:
        raise HTTPException(
            status_code=400,
            detail="Select at least one review area.",
        )

    documents = get_documents(request.session_id)

    if request.document_names is not None:
        missing = set(request.document_names) - set(documents)
        if missing:
            raise HTTPException(
                status_code=404,
                detail="One or more selected documents were not found.",
            )

    context = build_context(documents, request.document_names)

    prompt = (
        "Review the supplied document evidence against these areas:\n"
        + "\n".join(f"- {area}" for area in request.review_areas)
        + "\n\nFor each area, provide:\n"
        "- Area\n"
        "- Status: Evidence found, Potential gap, or Not enough information\n"
        "- Supporting evidence with filename and page when available\n"
        "- Rationale\n"
        "- Recommended follow-up\n"
        "- Confidence: Low, Medium, or High\n\n"
        "Missing evidence does not prove non-compliance. "
        "Do not invent quotations, page numbers, or obligations."
    )

    review = ask_ai(
        prompt,
        context,
        (
            "You are an evidence-focused compliance analyst. "
            "Be cautious, transparent, and specific. Do not provide "
            "legal advice. Never invent evidence or claim compliance "
            "without supporting evidence."
        ),
    )

    return {
        "review": review,
        "review_areas": request.review_areas,
        "disclaimer": (
            "Preliminary AI findings require human verification "
            "and are not legal advice."
        ),
    }


@app.get("/report/{session_id}")
def export_report(session_id: str):
    documents = get_documents(session_id)

    report = {
        "project": "AI Compliance Workbench",
        "generated_at": datetime.now().isoformat(timespec="minutes"),
        "documents": [
            {
                "filename": item["name"],
                "type": item["type"],
                "size_bytes": item["size"],
                "text_extraction": item["extraction_status"],
            }
            for item in documents.values()
        ],
        "disclaimer": (
            "AI-generated notes are preliminary, require human "
            "verification, and are not legal advice."
        ),
    }

    return JSONResponse(content=report)
