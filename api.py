import hashlib
import io
import json
import os
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
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
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)

SUPPORTED_TYPES = {"pdf", "docx", "xlsx"}
MAX_FILE_SIZE = 20 * 1024 * 1024
MAX_CONTEXT_CHARS = 45000

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "compliance_workbench.db"

# In-memory cache of extracted document text.
# SQLite is the persistent store.
sessions = {}
sessions_lock = Lock()


def get_db_connection():
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    return connection


def now_iso():
    return datetime.now().isoformat(timespec="seconds")


def initialize_database():
    """Create the database tables if they do not already exist."""
    with get_db_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT 'New Compliance Review',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active'
            )
        """)

        connection.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                session_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                document_json TEXT NOT NULL,
                PRIMARY KEY (session_id, filename)
            )
        """)

        connection.execute("""
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                created_at TEXT NOT NULL,
                payload_json TEXT NOT NULL
            )
        """)


def load_saved_documents():
    """Load persisted documents into the in-memory cache at startup."""
    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT session_id, filename, document_json
            FROM documents
            """
        ).fetchall()

    with sessions_lock:
        for row in rows:
            session_documents = sessions.setdefault(
                row["session_id"], {}
            )

            session_documents[row["filename"]] = json.loads(
                row["document_json"]
            )


def get_documents(session_id):
    with sessions_lock:
        return sessions.setdefault(session_id, {})


def ensure_session_exists(session_id):
    with get_db_connection() as connection:
        row = connection.execute(
            "SELECT id FROM sessions WHERE id = ?",
            (session_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Session not found.",
        )


def save_session_documents(session_id):
    """Persist the documents belonging to one session."""
    with sessions_lock:
        documents = dict(sessions.get(session_id, {}))

    with get_db_connection() as connection:
        connection.execute(
            "DELETE FROM documents WHERE session_id = ?",
            (session_id,),
        )

        connection.executemany(
            """
            INSERT INTO documents (
                session_id,
                filename,
                document_json
            )
            VALUES (?, ?, ?)
            """,
            [
                (
                    session_id,
                    filename,
                    json.dumps(document, ensure_ascii=False),
                )
                for filename, document in documents.items()
            ],
        )

        connection.execute(
            """
            UPDATE sessions
            SET updated_at = ?
            WHERE id = ?
            """,
            (now_iso(), session_id),
        )


def save_history(session_id, kind, payload):
    """Save a question, answer, or compliance review."""
    created_at = now_iso()

    with get_db_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO history (
                session_id,
                kind,
                created_at,
                payload_json
            )
            VALUES (?, ?, ?, ?)
            """,
            (
                session_id,
                kind,
                created_at,
                json.dumps(payload, ensure_ascii=False),
            ),
        )

        connection.execute(
            """
            UPDATE sessions
            SET updated_at = ?
            WHERE id = ?
            """,
            (created_at, session_id),
        )

        return {
            "id": cursor.lastrowid,
            "created_at": created_at,
        }


def get_session_history(session_id):
    ensure_session_exists(session_id)

    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, kind, created_at, payload_json
            FROM history
            WHERE session_id = ?
            ORDER BY id ASC
            """,
            (session_id,),
        ).fetchall()

    history = []

    for row in rows:
        try:
            payload = json.loads(row["payload_json"])
        except json.JSONDecodeError:
            payload = {}

        history.append({
            "id": row["id"],
            "kind": row["kind"],
            "created_at": row["created_at"],
            "payload": payload,
        })

    return history


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
                "has_text": bool(
                    item.get("text", "").strip()
                ),
            }
            for item in documents.values()
        ]
    }


def extract_document(filename, file_bytes):
    stream = io.BytesIO(file_bytes)
    name = filename.lower()

    # Extract text from PDF files.
    if name.endswith(".pdf"):
        reader = PdfReader(stream)
        pages = []

        for number, page in enumerate(
            reader.pages,
            start=1,
        ):
            text = page.extract_text() or ""

            if text.strip():
                pages.append(
                    f"[Page {number}]\n{text}"
                )

        return "\n\n".join(pages)

    # Extract text from Word documents.
    if name.endswith(".docx"):
        document = Document(stream)

        parts = [
            paragraph.text
            for paragraph in document.paragraphs
            if paragraph.text.strip()
        ]

        for index, table in enumerate(
            document.tables,
            start=1,
        ):
            rows = [
                " | ".join(
                    cell.text.strip()
                    for cell in row.cells
                )
                for row in table.rows
            ]

            parts.append(
                f"[Table {index}]\n"
                + "\n".join(rows)
            )

        return "\n\n".join(parts)

    # Extract text from Excel workbooks.
    if name.endswith(".xlsx"):
        workbook = load_workbook(
            stream,
            read_only=True,
            data_only=True,
        )

        parts = []

        try:
            for sheet in workbook.worksheets:
                parts.append(
                    f"[Sheet: {sheet.title}]"
                )

                for row in sheet.iter_rows(
                    values_only=True
                ):
                    values = [
                        "" if value is None else str(value)
                        for value in row
                    ]

                    if any(value.strip() for value in values):
                        parts.append(
                            " | ".join(values)
                        )

        finally:
            workbook.close()

        return "\n".join(parts)

    raise ValueError("Unsupported file type.")


def build_context(documents, selected_names=None):
    chunks = []

    for name, item in documents.items():
        if (
            selected_names is not None
            and name not in selected_names
        ):
            continue

        if item.get("text", "").strip():
            chunks.append(
                f"DOCUMENT: {name}\n{item['text']}"
            )

    return "\n\n---\n\n".join(chunks)[
        :MAX_CONTEXT_CHARS
    ]


def ask_ai(prompt, context, system_instruction):
    api_key = os.getenv(
        "GEMINI_API_KEY",
        "",
    ).strip()

    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Gemini is not configured on the server.",
        )

    if not context.strip():
        raise HTTPException(
            status_code=400,
            detail=(
                "No extractable text in the selected documents."
            ),
        )

    try:
        client = genai.Client(
            api_key=api_key
        )

        model = os.getenv(
            "GEMINI_MODEL",
            "gemini-3.5-flash-lite",
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
        # Do not expose API keys or internal exception details.
        raise HTTPException(
            status_code=502,
            detail=(
                "The AI request failed. "
                "Check the backend terminal."
            ),
        )


# Request models


class CreateSessionRequest(BaseModel):
    title: str | None = None


class RenameSessionRequest(BaseModel):
    title: str


class QuestionRequest(BaseModel):
    session_id: str
    question: str
    document_names: list[str] | None = None


class ReviewRequest(BaseModel):
    session_id: str
    review_areas: list[str]
    document_names: list[str] | None = None


# Initialize persistent storage when the API starts.
initialize_database()
load_saved_documents()


# Health check


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "AI Compliance Workbench API",
        "gemini_configured": bool(
            os.getenv("GEMINI_API_KEY", "").strip()
        ),
    }


# Session endpoints


@app.post("/sessions")
def create_session(
    request: CreateSessionRequest,
):
    session_id = str(uuid.uuid4())
    timestamp = now_iso()

    title = (
        (request.title or "").strip()
        or "New Compliance Review"
    )
    title = title[:120]

    with get_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO sessions (
                id,
                title,
                created_at,
                updated_at,
                status
            )
            VALUES (?, ?, ?, ?, 'active')
            """,
            (
                session_id,
                title,
                timestamp,
                timestamp,
            ),
        )

    with sessions_lock:
        sessions.setdefault(session_id, {})

    return {
        "id": session_id,
        "title": title,
        "created_at": timestamp,
        "updated_at": timestamp,
        "status": "active",
    }


@app.get("/sessions")
def list_sessions():
    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                s.id,
                s.title,
                s.created_at,
                s.updated_at,
                s.status,
                COUNT(DISTINCT d.filename) AS document_count,
                COUNT(DISTINCT h.id) AS history_count
            FROM sessions s
            LEFT JOIN documents d
                ON d.session_id = s.id
            LEFT JOIN history h
                ON h.session_id = s.id
            GROUP BY s.id
            ORDER BY
                s.updated_at DESC,
                s.created_at DESC
            """
        ).fetchall()

    return {
        "sessions": [
            dict(row)
            for row in rows
        ]
    }


@app.get("/sessions/{session_id}")
def get_session(session_id: str):
    ensure_session_exists(session_id)

    with get_db_connection() as connection:
        row = connection.execute(
            """
            SELECT
                id,
                title,
                created_at,
                updated_at,
                status
            FROM sessions
            WHERE id = ?
            """,
            (session_id,),
        ).fetchone()

    return {
        **dict(row),
        **list_documents(session_id),
        "history": get_session_history(session_id),
    }


@app.patch("/sessions/{session_id}")
def rename_session(
    session_id: str,
    request: RenameSessionRequest,
):
    title = request.title.strip()

    if not title:
        raise HTTPException(
            status_code=400,
            detail="Session title cannot be empty.",
        )

    title = title[:120]
    ensure_session_exists(session_id)
    updated_at = now_iso()

    with get_db_connection() as connection:
        connection.execute(
            """
            UPDATE sessions
            SET title = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                title,
                updated_at,
                session_id,
            ),
        )

    return {
        "id": session_id,
        "title": title,
        "updated_at": updated_at,
    }


@app.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    ensure_session_exists(session_id)

    with sessions_lock:
        sessions.pop(session_id, None)

    with get_db_connection() as connection:
        connection.execute(
            "DELETE FROM documents WHERE session_id = ?",
            (session_id,),
        )

        connection.execute(
            "DELETE FROM history WHERE session_id = ?",
            (session_id,),
        )

        connection.execute(
            "DELETE FROM sessions WHERE id = ?",
            (session_id,),
        )

    return {
        "message": "Session and its saved data deleted."
    }


# Document endpoints


@app.post("/documents")
async def upload_documents(
    session_id: str = Form(...),
    files: list[UploadFile] = File(...),
):
    if not session_id.strip():
        raise HTTPException(
            status_code=400,
            detail="Session ID required.",
        )

    ensure_session_exists(session_id)

    if not files:
        raise HTTPException(
            status_code=400,
            detail="Choose files to upload.",
        )

    documents = get_documents(session_id)
    results = []

    for uploaded in files:
        filename = os.path.basename(
            uploaded.filename or ""
        ).strip()

        if not filename or "." not in filename:
            results.append({
                "filename": filename or "unknown",
                "status": "failed",
                "message": "Invalid filename.",
            })
            continue

        extension = filename.rsplit(
            ".",
            1,
        )[-1].lower()

        if extension not in SUPPORTED_TYPES:
            results.append({
                "filename": filename,
                "status": "failed",
                "message": (
                    "Supported formats: PDF, DOCX, XLSX."
                ),
            })
            continue

        file_bytes = await uploaded.read()

        if len(file_bytes) > MAX_FILE_SIZE:
            results.append({
                "filename": filename,
                "status": "failed",
                "message": (
                    "File exceeds the 20 MB limit."
                ),
            })
            continue

        file_hash = hashlib.sha256(
            file_bytes
        ).hexdigest()

        # Avoid overwriting an existing filename.
        if filename in documents:
            existing_hash = documents[
                filename
            ].get("sha256")

            if existing_hash == file_hash:
                message = (
                    "This document has already been uploaded."
                )
            else:
                message = (
                    "A document with this filename already exists. "
                    "Rename the new file if it is a different document."
                )

            results.append({
                "filename": filename,
                "status": "duplicate",
                "message": message,
            })
            continue

        # Avoid uploading identical content under another filename.
        duplicate = next(
            (
                doc
                for doc in documents.values()
                if doc.get("sha256") == file_hash
            ),
            None,
        )

        if duplicate:
            results.append({
                "filename": filename,
                "status": "duplicate",
                "message": (
                    f"This file has the same content as "
                    f"'{duplicate['name']}', which is already uploaded."
                ),
            })
            continue

        try:
            extracted = extract_document(
                filename,
                file_bytes,
            )

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
                "sha256": file_hash,
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

    save_session_documents(session_id)

    return {
        "documents": results,
        "library": list_documents(session_id)["documents"],
    }


@app.get("/documents/{session_id}")
def get_document_library(session_id: str):
    ensure_session_exists(session_id)
    return list_documents(session_id)


@app.delete("/documents/{session_id}")
def clear_documents(session_id: str):
    ensure_session_exists(session_id)

    with sessions_lock:
        sessions[session_id] = {}

    with get_db_connection() as connection:
        connection.execute(
            "DELETE FROM documents WHERE session_id = ?",
            (session_id,),
        )

        connection.execute(
            """
            UPDATE sessions
            SET updated_at = ?
            WHERE id = ?
            """,
            (
                now_iso(),
                session_id,
            ),
        )

    return {
        "message": "Session documents cleared."
    }


# AI question-and-answer endpoint


@app.post("/ask")
def ask_documents(
    request: QuestionRequest,
):
    if not request.question.strip():
        raise HTTPException(
            status_code=400,
            detail="Enter a question.",
        )

    ensure_session_exists(request.session_id)
    documents = get_documents(request.session_id)

    if request.document_names is not None:
        missing = (
            set(request.document_names)
            - set(documents)
        )

        if missing:
            raise HTTPException(
                status_code=404,
                detail=(
                    "One or more selected documents were not found."
                ),
            )

    context = build_context(
        documents,
        request.document_names,
    )

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

    payload = {
        "question": request.question,
        "answer": answer,
        "document_names": request.document_names,
    }

    record = save_history(
        request.session_id,
        "qa",
        payload,
    )

    return {
        "id": record["id"],
        "created_at": record["created_at"],
        **payload,
    }


# Compliance review endpoint


@app.post("/review")
def compliance_review(
    request: ReviewRequest,
):
    if not request.review_areas:
        raise HTTPException(
            status_code=400,
            detail="Select at least one review area.",
        )

    ensure_session_exists(request.session_id)
    documents = get_documents(request.session_id)

    if request.document_names is not None:
        missing = (
            set(request.document_names)
            - set(documents)
        )

        if missing:
            raise HTTPException(
                status_code=404,
                detail=(
                    "One or more selected documents were not found."
                ),
            )

    context = build_context(
        documents,
        request.document_names,
    )

    prompt = (
        "Review the supplied document evidence against these areas:\n"
        + "\n".join(
            f"- {area}"
            for area in request.review_areas
        )
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

    # Run the AI review once.
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

    payload = {
        "review": review,
        "review_areas": request.review_areas,
        "document_names": request.document_names,
        "disclaimer": (
            "Preliminary AI findings require human verification "
            "and are not legal advice."
        ),
    }

    record = save_history(
        request.session_id,
        "review",
        payload,
    )

    return {
        "id": record["id"],
        "created_at": record["created_at"],
        **payload,
    }


# Export report endpoint


@app.get("/report/{session_id}")
def export_report(session_id: str):
    ensure_session_exists(session_id)

    documents = get_documents(session_id)

    report = {
        "project": "AI Compliance Workbench",
        "generated_at": datetime.now().isoformat(
            timespec="minutes"
        ),
        "session_id": session_id,
        "documents": [
            {
                "filename": item["name"],
                "type": item["type"],
                "size_bytes": item["size"],
                "text_extraction": item["extraction_status"],
            }
            for item in documents.values()
        ],
        "history": get_session_history(session_id),
        "disclaimer": (
            "AI-generated notes are preliminary, require human "
            "verification, and are not legal advice."
        ),
    }

    return JSONResponse(
        content=report
    )