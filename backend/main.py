import io
import os
import sqlite3
import json
import base64
import hashlib
import secrets
import uuid
import shutil
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Depends, Request, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, FileResponse
from concurrent.futures import ThreadPoolExecutor
import threading
from pydantic import BaseModel
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
import tempfile
import httpx
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from dotenv import load_dotenv

load_dotenv()


FONT_EXTENSIONS = {".otf", ".ttf", ".ttc", ".woff", ".woff2"}
DEFAULT_FONT_DIR = Path(os.getenv("FONT_DIR", "./fonts")).resolve()
PREVIEW_DIR = DEFAULT_FONT_DIR / "preview"
PREVIEW_TEXT = "Custom fonts"
PREVIEW_SIZE = 96
PREVIEW_WIDTH = 1200
PREVIEW_HEIGHT = 360
PREVIEW_PADDING = 40

# Database configuration
BACKEND_DIR = Path(__file__).parent
DB_PATH = BACKEND_DIR / "projects.db"
FILES_DIR = BACKEND_DIR / "db" / "files"
LOGOS_DIR = BACKEND_DIR / "db" / "logos"

# Auth configuration
ACCESS_TOKEN_TTL_MINUTES = int(os.getenv("ACCESS_TOKEN_TTL_MINUTES", "15"))
REFRESH_TOKEN_TTL_DAYS = int(os.getenv("REFRESH_TOKEN_TTL_DAYS", "14"))
JWT_ALGORITHM = "HS256"
JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
  JWT_SECRET = secrets.token_urlsafe(48)
  print("[warn] JWT_SECRET not set. Generated a temporary secret; tokens will reset on restart.")

REFRESH_COOKIE_NAME = "refresh_token"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax")
FRONTEND_ORIGINS = [
  origin.strip() for origin in os.getenv(
    "FRONTEND_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"
  ).split(",")
  if origin.strip()
]

POLO_API_URL = os.getenv("POLO_API_URL", "https://work.poloapi.com/v1/chat/completions")
POLO_API_KEY = os.getenv("POLO_API_KEY", "")
POLO_TIMEOUT_SECONDS = int(os.getenv("POLO_TIMEOUT_SECONDS", "180"))

password_hasher = PasswordHasher()


class PreviewRequest(BaseModel):
  font: str
  text: str = "The quick brown fox jumps over the lazy dog 0123456789"
  size: int = 64
  width: int = 1200
  height: int = 600
  padding: int = 40
  color: str = "#111827"
  background: str = "#ffffff"
  format: str = "png"


class TextBoxPayload(BaseModel):
  x: float
  y: float
  width: float
  height: float


class TextStylePayload(BaseModel):
  fontSize: int
  color: str = "#ffffff"
  fontWeight: int = 600
  fontStyle: str = "normal"
  textDecoration: str = "none"
  textAlign: str = "left"


class TextBlockPayload(BaseModel):
  key: str
  text: str
  box: TextBoxPayload
  style: TextStylePayload


class LayoutRequest(BaseModel):
  font: str
  width: int
  height: int
  background: str = "#000000"
  format: str = "webp"
  blocks: list[TextBlockPayload]
  respectLineBreaks: bool = False


class ProjectSaveRequest(BaseModel):
  projectId: str
  projectData: Dict[str, Any]


class AuthRequest(BaseModel):
  username: str
  password: str


class ChangePasswordRequest(BaseModel):
  currentPassword: str
  newPassword: str


class AdminRowPayload(BaseModel):
  values: Dict[str, Any]
  primaryKey: Optional[Dict[str, Any]] = None
  rowId: Optional[int] = None


class AdminDeletePayload(BaseModel):
  primaryKey: Optional[Dict[str, Any]] = None
  rowId: Optional[int] = None


class AuthResponse(BaseModel):
  accessToken: str
  user: Dict[str, Any]


class DesignGuidanceCreateRequest(BaseModel):
  description: str
  source: str = "text"


class DesignGuidanceUpdateRequest(BaseModel):
  description: str


class AITaskSubmitRequest(BaseModel):
  taskType: str  # 'chat' for AI chat requests
  payload: Dict[str, Any]


class AITaskStatusResponse(BaseModel):
  taskId: str
  status: str  # 'pending', 'running', 'completed', 'error'
  result: Optional[Dict[str, Any]] = None
  error: Optional[str] = None
  createdAt: str
  startedAt: Optional[str] = None
  completedAt: Optional[str] = None


# Thread pool for background AI tasks
ai_task_executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix="ai_task_")


app = FastAPI(title="Font Preview Service")
app.add_middleware(
  CORSMiddleware,
  allow_origins=FRONTEND_ORIGINS or ["http://localhost:5173"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"]
)


def init_database():
  """Initialize SQLite database and create tables if they don't exist."""
  # Create files directory for storing images
  FILES_DIR.mkdir(parents=True, exist_ok=True)
  LOGOS_DIR.mkdir(parents=True, exist_ok=True)

  conn = sqlite3.connect(str(DB_PATH))
  cursor = conn.cursor()

  # Create users table
  cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      password_changed INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login_at TIMESTAMP
    )
  """)

  # Create refresh tokens table
  cursor.execute("""
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      revoked_at TIMESTAMP,
      user_agent TEXT,
      ip TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  """)

  cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
    ON refresh_tokens(user_id)
  """)
  cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash
    ON refresh_tokens(token_hash)
  """)

  # Create projects table
  cursor.execute("""
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  """)

  # Create index on updated_at for faster queries
  cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_projects_updated_at
    ON projects(updated_at DESC)
  """)

  # Migrate legacy projects table to include user_id if missing
  cursor.execute("PRAGMA table_info(projects)")
  columns = [row[1] for row in cursor.fetchall()]
  if "user_id" not in columns:
    cursor.execute("ALTER TABLE projects ADD COLUMN user_id TEXT")
    cursor.execute("PRAGMA table_info(projects)")
    columns = [row[1] for row in cursor.fetchall()]

  if "user_id" in columns:
    cursor.execute("""
      CREATE INDEX IF NOT EXISTS idx_projects_user_id
      ON projects(user_id)
    """)

  # Migrate legacy users table to include is_admin if missing
  cursor.execute("PRAGMA table_info(users)")
  user_columns = [row[1] for row in cursor.fetchall()]
  if "is_admin" not in user_columns:
    cursor.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0")
  cursor.execute("PRAGMA table_info(users)")
  user_columns = [row[1] for row in cursor.fetchall()]
  if "password_changed" not in user_columns:
    cursor.execute("ALTER TABLE users ADD COLUMN password_changed INTEGER DEFAULT 1")
  cursor.execute("UPDATE users SET password_changed = 1 WHERE password_changed IS NULL")

  # Create ai_tasks table for async task tracking
  cursor.execute("""
    CREATE TABLE IF NOT EXISTS ai_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload TEXT NOT NULL,
      result TEXT,
      error TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  """)

  cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_ai_tasks_user_id
    ON ai_tasks(user_id)
  """)
  cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_ai_tasks_status
    ON ai_tasks(status)
  """)

  # Create design_guidance table for user guidance entries
  cursor.execute("""
    CREATE TABLE IF NOT EXISTS design_guidance (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      description TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'text',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  """)
  cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_design_guidance_user_id
    ON design_guidance(user_id)
  """)
  cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_design_guidance_created_at
    ON design_guidance(created_at DESC)
  """)

  conn.commit()
  conn.close()
  print(f"[info] Database initialized at {DB_PATH}")
  print(f"[info] Files directory at {FILES_DIR}")
  print(f"[info] Logos directory at {LOGOS_DIR}")


def get_db_connection():
  """Get a database connection."""
  conn = sqlite3.connect(str(DB_PATH))
  conn.row_factory = sqlite3.Row
  return conn


def list_db_tables() -> list[str]:
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("""
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  """)
  rows = cursor.fetchall()
  conn.close()
  return [row[0] for row in rows]


def get_table_schema(table: str) -> list[sqlite3.Row]:
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute(f'PRAGMA table_info("{table}")')
  rows = cursor.fetchall()
  conn.close()
  return rows


def table_has_rowid(table: str) -> bool:
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("""
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = ?
  """, (table,))
  row = cursor.fetchone()
  conn.close()
  if not row or not row[0]:
    return True
  return "WITHOUT ROWID" not in str(row[0]).upper()


def normalize_table_name(table: str) -> str:
  if table not in list_db_tables():
    raise HTTPException(status_code=404, detail="Table not found")
  return table


def normalize_columns(table: str, values: Dict[str, Any]) -> Dict[str, Any]:
  schema = get_table_schema(table)
  allowed = {row["name"] for row in schema}
  unknown = [key for key in values.keys() if key not in allowed]
  if unknown:
    raise HTTPException(status_code=400, detail=f"Unknown columns: {', '.join(unknown)}")
  return values


def save_base64_image(base64_data: str, project_id: str, image_type: str) -> str:
  """
  Save a base64 image to files directory and return the relative path.

  Args:
    base64_data: Base64 encoded image data (with or without data URI prefix)
    project_id: Project ID for organizing files
    image_type: Type of image (e.g., 'poster', 'asset', 'logo')

  Returns:
    Relative path to the saved file (e.g., 'db/files/project-id/hash.png')
  """
  # Remove data URI prefix if present
  if base64_data.startswith('data:'):
    base64_data = base64_data.split(',', 1)[1]

  # Decode base64
  image_bytes = base64.b64decode(base64_data)

  # Generate hash for deduplication
  file_hash = hashlib.sha256(image_bytes).hexdigest()[:16]

  # Detect image format
  image_format = 'png'
  if image_bytes.startswith(b'\xff\xd8\xff'):
    image_format = 'jpg'
  elif image_bytes.startswith(b'RIFF') and b'WEBP' in image_bytes[:12]:
    image_format = 'webp'

  # Create project directory
  project_dir = FILES_DIR / project_id
  project_dir.mkdir(parents=True, exist_ok=True)

  # Save file
  filename = f"{image_type}_{file_hash}.{image_format}"
  file_path = project_dir / filename

  with open(file_path, 'wb') as f:
    f.write(image_bytes)

  # Return relative path
  return f"db/files/{project_id}/{filename}"


def sanitize_user_id(user_id: str) -> str:
  cleaned = "".join(ch for ch in user_id if ch.isalnum() or ch in ("_", "-"))
  return cleaned or "user"


def save_logo_files(file: UploadFile, user_id: str) -> Dict[str, str]:
  if not file.filename:
    raise HTTPException(status_code=400, detail="Missing filename")
  ext = Path(file.filename).suffix.lower()
  if ext not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}:
    raise HTTPException(status_code=400, detail="Unsupported image type")

  safe_user_id = sanitize_user_id(user_id)
  user_dir = (LOGOS_DIR / safe_user_id).resolve()
  if not str(user_dir).startswith(str(LOGOS_DIR.resolve())):
    raise HTTPException(status_code=400, detail="Invalid logo path")
  user_dir.mkdir(parents=True, exist_ok=True)

  content = file.file.read()
  if not content:
    raise HTTPException(status_code=400, detail="Empty file")

  logo_id = str(uuid.uuid4())
  original_name = f"{logo_id}{ext}"
  original_path = user_dir / original_name
  with open(original_path, "wb") as f:
    f.write(content)

  try:
    image = Image.open(io.BytesIO(content))
  except Exception:
    raise HTTPException(status_code=400, detail="Invalid image file")

  if image.mode not in ("RGB", "RGBA"):
    if "A" in image.getbands():
      image = image.convert("RGBA")
    else:
      image = image.convert("RGB")

  thumb = image.copy()
  thumb.thumbnail((512, 512))
  webp_name = f"{logo_id}.webp"
  webp_path = user_dir / webp_name
  thumb.save(webp_path, format="WEBP", quality=82, method=6)

  return {
    "original": f"{safe_user_id}/{original_name}",
    "webp": f"{safe_user_id}/{webp_name}"
  }


def process_project_images(project_data: Dict[str, Any]) -> Dict[str, Any]:
  """
  Process all base64 images in project data and convert them to file paths.

  Args:
    project_data: Project data containing base64 images

  Returns:
    Modified project data with file paths instead of base64
  """
  project_id = project_data.get('id', 'unknown')

  # Process project-level style/logo images
  if isinstance(project_data.get('styleImages'), list):
    updated_styles = []
    for idx, image in enumerate(project_data.get('styleImages', [])):
      if isinstance(image, str) and image.startswith('data:'):
        try:
          file_path = save_base64_image(image, project_id, f'style_{idx}')
          updated_styles.append(f"file://{file_path}")
        except Exception as e:
          print(f"[warn] Failed to save style image {idx}: {e}")
          updated_styles.append(image)
      else:
        updated_styles.append(image)
    project_data['styleImages'] = updated_styles

  logo_image = project_data.get('logoImage')
  if isinstance(logo_image, str) and logo_image.startswith('data:'):
    try:
      file_path = save_base64_image(logo_image, project_id, 'logo')
      project_data['logoImage'] = f"file://{file_path}"
    except Exception as e:
      print(f"[warn] Failed to save project logo: {e}")

  # Process artboards
  if 'artboards' in project_data:
    for artboard in project_data['artboards']:
      artboard_id = artboard.get('id', 'unknown')

      # Process assets
      if 'assets' in artboard:
        for i, asset in enumerate(artboard['assets']):
          if asset.get('type') == 'image' and asset.get('content', '').startswith('data:'):
            try:
              file_path = save_base64_image(asset['content'], project_id, f'asset_{artboard_id}_{i}')
              asset['content'] = f"file://{file_path}"
            except Exception as e:
              print(f"[warn] Failed to save asset image: {e}")

      # Process poster data
      if 'posterData' in artboard:
        poster = artboard['posterData']

        # Process various poster images
        image_fields = ['imageUrl', 'imageUrlNoText', 'imageUrlMerged', 'logoUrl']
        for field in image_fields:
          if field in poster and isinstance(poster[field], str) and poster[field].startswith('data:'):
            try:
              file_path = save_base64_image(poster[field], project_id, f'{field}_{artboard_id}')
              poster[field] = f"file://{file_path}"
            except Exception as e:
              print(f"[warn] Failed to save {field}: {e}")

  # Process canvas assets (e.g., images placed on the canvas outside artboards)
  if 'canvasAssets' in project_data:
    for i, asset in enumerate(project_data.get('canvasAssets', [])):
      if asset.get('type') == 'image' and asset.get('content', '').startswith('data:'):
        try:
          file_path = save_base64_image(asset['content'], project_id, f'canvas_asset_{i}')
          asset['content'] = f"file://{file_path}"
        except Exception as e:
          print(f"[warn] Failed to save canvas asset image: {e}")

  return project_data


def save_project_to_db(project_id: str, project_data: Dict[str, Any], user_id: str):
  """Save or update a project in the database."""
  # Process images before saving
  processed_data = process_project_images(project_data)

  conn = get_db_connection()
  cursor = conn.cursor()

  title = processed_data.get("title", "Untitled Project")
  data_json = json.dumps(processed_data)
  now = datetime.now().isoformat()

  # Insert or update
  cursor.execute("""
    INSERT INTO projects (id, user_id, title, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      title = excluded.title,
      data = excluded.data,
      updated_at = excluded.updated_at
  """, (project_id, user_id, title, data_json, now, now))

  conn.commit()
  conn.close()


def get_project_from_db(project_id: str, user_id: str) -> Optional[Dict[str, Any]]:
  """Retrieve a project from the database."""
  conn = get_db_connection()
  cursor = conn.cursor()

  cursor.execute("""
    SELECT data FROM projects WHERE id = ? AND user_id = ?
  """, (project_id, user_id))

  row = cursor.fetchone()
  conn.close()

  if row:
    return json.loads(row[0])
  return None


def get_all_projects_from_db(user_id: str) -> List[Dict[str, Any]]:
  """Retrieve all projects from the database."""
  conn = get_db_connection()
  cursor = conn.cursor()

  cursor.execute("""
    SELECT data FROM projects WHERE user_id = ? ORDER BY updated_at DESC
  """, (user_id,))

  rows = cursor.fetchall()
  conn.close()

  return [json.loads(row[0]) for row in rows]


def delete_project_from_db(project_id: str, user_id: str):
  """Delete a project from the database."""
  conn = get_db_connection()
  cursor = conn.cursor()

  cursor.execute("""
    DELETE FROM projects WHERE id = ? AND user_id = ?
  """, (project_id, user_id))

  conn.commit()
  conn.close()


def delete_project_files(project_id: str):
  """Delete all files for a project from the files directory."""
  project_dir = FILES_DIR / project_id
  if project_dir.exists():
    shutil.rmtree(project_dir, ignore_errors=True)


def hash_refresh_token(token: str) -> str:
  return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_access_token(user_id: str) -> str:
  now = datetime.now(timezone.utc)
  payload = {
    "sub": user_id,
    "iat": int(now.timestamp()),
    "exp": int((now + timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES)).timestamp()),
    "jti": uuid.uuid4().hex
  }
  return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
  try:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
  except jwt.ExpiredSignatureError:
    raise HTTPException(status_code=401, detail="Access token expired")
  except jwt.InvalidTokenError:
    raise HTTPException(status_code=401, detail="Invalid access token")


def get_user_by_username(username: str) -> Optional[sqlite3.Row]:
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
  row = cursor.fetchone()
  conn.close()
  return row


def get_user_by_id(user_id: str) -> Optional[sqlite3.Row]:
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
  row = cursor.fetchone()
  conn.close()
  return row


def create_user(username: str, password: str, is_admin: int = 0, password_changed: int = 1) -> sqlite3.Row:
  user_id = uuid.uuid4().hex
  password_hash = password_hasher.hash(password)
  now = datetime.now(timezone.utc).isoformat()
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("""
    INSERT INTO users (id, username, password_hash, is_admin, password_changed, created_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  """, (user_id, username, password_hash, is_admin, password_changed, now, now))
  conn.commit()
  conn.close()
  return get_user_by_id(user_id)


def update_last_login(user_id: str):
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (
    datetime.now(timezone.utc).isoformat(),
    user_id
  ))
  conn.commit()
  conn.close()


def create_refresh_token_record(user_id: str, user_agent: str, ip: str) -> tuple[str, str]:
  token = secrets.token_urlsafe(64)
  token_hash = hash_refresh_token(token)
  now = datetime.now(timezone.utc)
  expires_at = now + timedelta(days=REFRESH_TOKEN_TTL_DAYS)
  token_id = uuid.uuid4().hex

  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("""
    INSERT INTO refresh_tokens (id, user_id, token_hash, created_at, expires_at, revoked_at, user_agent, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  """, (
    token_id,
    user_id,
    token_hash,
    now.isoformat(),
    expires_at.isoformat(),
    None,
    user_agent,
    ip
  ))
  conn.commit()
  conn.close()
  return token, token_hash


def revoke_refresh_token(token_hash: str):
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("""
    UPDATE refresh_tokens
    SET revoked_at = ?
    WHERE token_hash = ? AND revoked_at IS NULL
  """, (datetime.now(timezone.utc).isoformat(), token_hash))
  conn.commit()
  conn.close()


def revoke_refresh_tokens_for_user(user_id: str):
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("""
    UPDATE refresh_tokens
    SET revoked_at = ?
    WHERE user_id = ? AND revoked_at IS NULL
  """, (datetime.now(timezone.utc).isoformat(), user_id))
  conn.commit()
  conn.close()


def get_refresh_token_record(token_hash: str) -> Optional[sqlite3.Row]:
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("""
    SELECT * FROM refresh_tokens
    WHERE token_hash = ?
  """, (token_hash,))
  row = cursor.fetchone()
  conn.close()
  return row


def require_current_user(request: Request) -> sqlite3.Row:
  auth_header = request.headers.get("Authorization", "")
  if not auth_header.startswith("Bearer "):
    raise HTTPException(status_code=401, detail="Missing access token")
  token = auth_header.replace("Bearer ", "", 1).strip()
  payload = decode_access_token(token)
  user_id = payload.get("sub")
  if not user_id:
    raise HTTPException(status_code=401, detail="Invalid access token")
  user = get_user_by_id(user_id)
  if not user:
    raise HTTPException(status_code=401, detail="User not found")
  return user


def require_admin_user(user: sqlite3.Row = Depends(require_current_user)) -> sqlite3.Row:
  if not bool(user["is_admin"]):
    raise HTTPException(status_code=403, detail="Admin access required")
  return user


def set_refresh_cookie(response: Response, token: str):
  response.set_cookie(
    key=REFRESH_COOKIE_NAME,
    value=token,
    httponly=True,
    secure=COOKIE_SECURE,
    samesite=COOKIE_SAMESITE,
    max_age=int(timedelta(days=REFRESH_TOKEN_TTL_DAYS).total_seconds()),
    path="/"
  )


def clear_refresh_cookie(response: Response):
  response.delete_cookie(
    key=REFRESH_COOKIE_NAME,
    path="/"
  )

@app.on_event("startup")
def on_startup():
  init_database()
  ensure_font_previews()


def list_font_files() -> list[str]:
  if not DEFAULT_FONT_DIR.exists():
    return []
  fonts = []
  for item in DEFAULT_FONT_DIR.iterdir():
    if item.name.startswith("._"):
      continue
    if item.is_file() and item.suffix.lower() in FONT_EXTENSIONS:
      fonts.append(item.name)
  return sorted(fonts)


def resolve_font_path(file_name: str) -> Path:
  if file_name.startswith("._"):
    raise HTTPException(status_code=400, detail="Unsupported font file.")
  candidate = (DEFAULT_FONT_DIR / file_name).resolve()
  if not str(candidate).startswith(str(DEFAULT_FONT_DIR)):
    raise HTTPException(status_code=400, detail="Invalid font path.")
  if not candidate.exists() or candidate.suffix.lower() not in FONT_EXTENSIONS:
    raise HTTPException(status_code=404, detail="Font not found.")
  return candidate


def load_font(font_path: Path, size: int) -> ImageFont.FreeTypeFont:
  try:
    return ImageFont.truetype(str(font_path), size)
  except OSError:
    # Fallback: re-save through fontTools for better compatibility (e.g., some OTFs).
    try:
      with tempfile.NamedTemporaryFile(suffix=".ttf", delete=False) as temp_file:
        temp_path = Path(temp_file.name)
      tt_font = TTFont(str(font_path), lazy=False)
      tt_font.save(str(temp_path))
      return ImageFont.truetype(str(temp_path), size)
    except Exception as exc:
      raise HTTPException(status_code=400, detail=f"Failed to load font: {exc}") from exc


def draw_text_preview(
  font_path: Path,
  text: str,
  size: int,
  width: int,
  height: int,
  padding: int,
  color: str,
  background: str,
  image_format: str
) -> bytes:
  if image_format.lower() == "png":
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
  else:
    image = Image.new("RGB", (width, height), background)
  draw = ImageDraw.Draw(image)
  font = load_font(font_path, size)

  bbox = draw.multiline_textbbox((0, 0), text, font=font)
  text_width = bbox[2] - bbox[0]
  text_height = bbox[3] - bbox[1]
  x = max(padding, (width - text_width) // 2)
  y = max(padding, (height - text_height) // 2)
  draw.multiline_text((x, y), text, fill=color, font=font, align="center")

  buffer = io.BytesIO()
  image.save(buffer, format=image_format.upper())
  return buffer.getvalue()


def measure_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> float:
  return draw.textlength(text, font=font)


def wrap_text_lines(draw: ImageDraw.ImageDraw, text: str, max_width: float, font: ImageFont.FreeTypeFont) -> list[str]:
  if not text:
    return [""]
  if not any(ch.isspace() for ch in text):
    lines = []
    current = ""
    for ch in text:
      test = current + ch
      if measure_text(draw, test, font) <= max_width or not current:
        current = test
      else:
        lines.append(current)
        current = ch
    if current:
      lines.append(current)
    return lines

  words = text.split()
  lines = []
  current = ""
  for word in words:
    test = f"{current} {word}".strip()
    if measure_text(draw, test, font) <= max_width:
      current = test
      continue
    if current:
      lines.append(current)
    if measure_text(draw, word, font) <= max_width:
      current = word
      continue
    chunk = ""
    for ch in word:
      test_chunk = chunk + ch
      if measure_text(draw, test_chunk, font) <= max_width or not chunk:
        chunk = test_chunk
      else:
        lines.append(chunk)
        chunk = ch
    current = chunk
  if current:
    lines.append(current)
  return lines


def draw_line_with_style(
  base: Image.Image,
  draw: ImageDraw.ImageDraw,
  text: str,
  x: float,
  y: float,
  font: ImageFont.FreeTypeFont,
  color: str,
  underline: bool,
  bold: bool,
  italic: bool,
  line_height: float
):
  if italic:
    text_width = int(measure_text(draw, text, font)) + 20
    temp_height = int(line_height * 1.2)
    temp = Image.new("RGBA", (text_width, temp_height), (0, 0, 0, 0))
    temp_draw = ImageDraw.Draw(temp)
    offsets = [(0, 0), (1, 0), (0, 1)] if bold else [(0, 0)]
    for dx, dy in offsets:
      temp_draw.text((dx, dy), text, font=font, fill=color)
    shear = -0.25
    transformed = temp.transform(
      (temp.width + int(temp.height * abs(shear)), temp.height),
      Image.AFFINE,
      (1, shear, 0, 0, 1, 0),
      resample=Image.BICUBIC
    )
    base.paste(transformed, (int(x), int(y)), transformed)
  else:
    offsets = [(0, 0), (1, 0), (0, 1)] if bold else [(0, 0)]
    for dx, dy in offsets:
      draw.text((x + dx, y + dy), text, font=font, fill=color)

  if underline:
    text_width = measure_text(draw, text, font)
    underline_y = y + line_height * 0.85
    draw.line((x, underline_y, x + text_width, underline_y), fill=color, width=max(1, int(line_height * 0.06)))


def draw_layout_text(
  image: Image.Image,
  block: TextBlockPayload,
  font_path: Path,
  respect_line_breaks: bool
):
  draw = ImageDraw.Draw(image)
  font = load_font(font_path, block.style.fontSize)
  bold = block.style.fontWeight >= 700
  italic = block.style.fontStyle == "italic"
  underline = block.style.textDecoration == "underline"
  line_height = block.style.fontSize * 1.2

  x = block.box.x * image.width
  y = block.box.y * image.height
  w = block.box.width * image.width
  h = block.box.height * image.height

  cursor_y = y
  align = block.style.textAlign or "left"
  paragraphs = (block.text or "").split("\n")
  if respect_line_breaks:
    lines = paragraphs
    for line in lines:
      if cursor_y + line_height > y + h:
        return
      line_width = measure_text(draw, line, font)
      draw_x = x
      if align == "center":
        draw_x = x + (w - line_width) / 2
      elif align == "right":
        draw_x = x + (w - line_width)
      draw_line_with_style(image, draw, line, draw_x, cursor_y, font, block.style.color, underline, bold, italic, line_height)
      cursor_y += line_height
    return

  for idx, paragraph in enumerate(paragraphs):
    lines = wrap_text_lines(draw, paragraph, w, font)
    for line in lines:
      if cursor_y + line_height > y + h:
        return
      line_width = measure_text(draw, line, font)
      draw_x = x
      if align == "center":
        draw_x = x + (w - line_width) / 2
      elif align == "right":
        draw_x = x + (w - line_width)
      draw_line_with_style(image, draw, line, draw_x, cursor_y, font, block.style.color, underline, bold, italic, line_height)
      cursor_y += line_height
    if idx < len(paragraphs) - 1:
      cursor_y += line_height * 0.2


def ensure_font_previews():
  PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
  fonts = list_font_files()
  for font_name in fonts:
    target_name = f"{Path(font_name).stem}.webp"
    target_path = PREVIEW_DIR / target_name
    if target_path.exists():
      continue
    try:
      font_path = resolve_font_path(font_name)
      image_bytes = draw_text_preview(
        font_path=font_path,
        text=PREVIEW_TEXT,
        size=PREVIEW_SIZE,
        width=PREVIEW_WIDTH,
        height=PREVIEW_HEIGHT,
        padding=PREVIEW_PADDING,
        color="#111827",
        background="#ffffff",
        image_format="webp"
      )
      target_path.write_bytes(image_bytes)
    except Exception as exc:
      print(f"[warn] Failed to generate preview for {font_name}: {exc}")


@app.get("/health")
def health_check():
  return {"status": "ok"}


@app.get("/fonts")
def fonts_list():
  return JSONResponse({"fonts": list_font_files()})


@app.post("/fonts/preview")
def fonts_preview(payload: PreviewRequest):
  font_path = resolve_font_path(payload.font)
  if payload.size <= 0 or payload.width <= 0 or payload.height <= 0:
    raise HTTPException(status_code=400, detail="Size and dimensions must be positive.")
  image_format = payload.format.lower()
  if image_format not in {"png", "webp"}:
    raise HTTPException(status_code=400, detail="Unsupported format.")

  image_bytes = draw_text_preview(
    font_path=font_path,
    text=payload.text,
    size=payload.size,
    width=payload.width,
    height=payload.height,
    padding=payload.padding,
    color=payload.color,
    background=payload.background,
    image_format=image_format
  )
  media_type = "image/webp" if image_format == "webp" else "image/png"
  return Response(content=image_bytes, media_type=media_type)


@app.get("/fonts/preview")
def fonts_preview_get(
  font: str,
  text: Optional[str] = None,
  size: int = 64,
  width: int = 1200,
  height: int = 600,
  padding: int = 40,
  color: str = "#111827",
  background: str = "#ffffff",
  format: str = "png"
):
  font_path = resolve_font_path(font)
  if size <= 0 or width <= 0 or height <= 0:
    raise HTTPException(status_code=400, detail="Size and dimensions must be positive.")
  image_format = format.lower()
  if image_format not in {"png", "webp"}:
    raise HTTPException(status_code=400, detail="Unsupported format.")
  preview_text = text or "The quick brown fox jumps over the lazy dog 0123456789"
  image_bytes = draw_text_preview(
    font_path=font_path,
    text=preview_text,
    size=size,
    width=width,
    height=height,
    padding=padding,
    color=color,
    background=background,
    image_format=image_format
  )
  media_type = "image/webp" if image_format == "webp" else "image/png"
  return Response(content=image_bytes, media_type=media_type)


@app.post("/fonts/layout")
def fonts_layout(payload: LayoutRequest):
  font_path = resolve_font_path(payload.font)
  if payload.width <= 0 or payload.height <= 0:
    raise HTTPException(status_code=400, detail="Invalid layout dimensions.")
  image_format = payload.format.lower()
  if image_format not in {"webp", "png"}:
    raise HTTPException(status_code=400, detail="Unsupported format.")

  mode = "RGBA" if image_format == "png" else "RGB"
  background = payload.background or "#000000"
  if isinstance(background, str) and background.lower() == "transparent":
    background = (0, 0, 0, 0)
  image = Image.new(mode, (payload.width, payload.height), background)
  for block in payload.blocks:
    draw_layout_text(image, block, font_path, payload.respectLineBreaks)

  buffer = io.BytesIO()
  image.save(buffer, format=image_format.upper())
  media_type = "image/webp" if image_format == "webp" else "image/png"
  return Response(content=buffer.getvalue(), media_type=media_type)


@app.post("/auth/register", response_model=AuthResponse)
def register(payload: AuthRequest, request: Request):
  username = payload.username.strip()
  password = payload.password.strip()
  if not username or not password:
    raise HTTPException(status_code=400, detail="Username and password are required")
  if get_user_by_username(username):
    raise HTTPException(status_code=409, detail="Username already exists")
  user = create_user(username, password)
  access_token = create_access_token(user["id"])
  user_agent = request.headers.get("user-agent", "")
  ip = request.client.host if request.client else ""
  revoke_refresh_tokens_for_user(user["id"])
  refresh_token, _ = create_refresh_token_record(user["id"], user_agent, ip)
  response = JSONResponse({
    "accessToken": access_token,
    "user": {
      "id": user["id"],
      "username": user["username"],
      "is_admin": bool(user["is_admin"]),
      "must_change_password": not bool(user["password_changed"])
    }
  })
  set_refresh_cookie(response, refresh_token)
  return response


@app.post("/auth/login", response_model=AuthResponse)
def login(payload: AuthRequest, request: Request):
  username = payload.username.strip()
  password = payload.password.strip()
  if not username or not password:
    raise HTTPException(status_code=400, detail="Username and password are required")
  user = get_user_by_username(username)
  if not user:
    raise HTTPException(status_code=401, detail="Invalid username or password")
  try:
    password_hasher.verify(user["password_hash"], password)
  except VerifyMismatchError:
    raise HTTPException(status_code=401, detail="Invalid username or password")

  update_last_login(user["id"])
  revoke_refresh_tokens_for_user(user["id"])

  access_token = create_access_token(user["id"])
  user_agent = request.headers.get("user-agent", "")
  ip = request.client.host if request.client else ""
  refresh_token, _ = create_refresh_token_record(user["id"], user_agent, ip)
  response = JSONResponse({
    "accessToken": access_token,
    "user": {
      "id": user["id"],
      "username": user["username"],
      "is_admin": bool(user["is_admin"]),
      "must_change_password": not bool(user["password_changed"])
    }
  })
  set_refresh_cookie(response, refresh_token)
  return response


@app.post("/auth/refresh", response_model=AuthResponse)
def refresh(request: Request):
  raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
  if not raw_token:
    raise HTTPException(status_code=401, detail="Missing refresh token")
  token_hash = hash_refresh_token(raw_token)
  record = get_refresh_token_record(token_hash)
  if not record:
    raise HTTPException(status_code=401, detail="Invalid refresh token")
  if record["revoked_at"]:
    raise HTTPException(status_code=401, detail="Refresh token revoked")
  expires_at = datetime.fromisoformat(record["expires_at"])
  if expires_at.tzinfo is None:
    expires_at = expires_at.replace(tzinfo=timezone.utc)
  if datetime.now(timezone.utc) >= expires_at:
    raise HTTPException(status_code=401, detail="Refresh token expired")

  user = get_user_by_id(record["user_id"])
  if not user:
    raise HTTPException(status_code=401, detail="User not found")

  revoke_refresh_tokens_for_user(user["id"])
  user_agent = request.headers.get("user-agent", "")
  ip = request.client.host if request.client else ""
  new_refresh_token, _ = create_refresh_token_record(user["id"], user_agent, ip)
  access_token = create_access_token(user["id"])

  response = JSONResponse({
    "accessToken": access_token,
    "user": {
      "id": user["id"],
      "username": user["username"],
      "is_admin": bool(user["is_admin"]),
      "must_change_password": not bool(user["password_changed"])
    }
  })
  set_refresh_cookie(response, new_refresh_token)
  return response


@app.post("/auth/logout")
def logout(request: Request):
  raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
  if raw_token:
    token_hash = hash_refresh_token(raw_token)
    record = get_refresh_token_record(token_hash)
    if record:
      revoke_refresh_tokens_for_user(record["user_id"])
  response = JSONResponse({"success": True})
  clear_refresh_cookie(response)
  return response


@app.post("/auth/change-password")
def change_password(payload: ChangePasswordRequest, user: sqlite3.Row = Depends(require_current_user)):
  current_password = payload.currentPassword.strip()
  new_password = payload.newPassword.strip()
  if not current_password or not new_password:
    raise HTTPException(status_code=400, detail="Current and new password are required")
  try:
    password_hasher.verify(user["password_hash"], current_password)
  except VerifyMismatchError:
    raise HTTPException(status_code=401, detail="Current password is incorrect")
  new_hash = password_hasher.hash(new_password)
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("""
    UPDATE users SET password_hash = ?, password_changed = 1 WHERE id = ?
  """, (new_hash, user["id"]))
  conn.commit()
  conn.close()
  return JSONResponse({"success": True})


@app.get("/admin/db/tables")
def admin_db_tables(_: sqlite3.Row = Depends(require_admin_user)):
  return JSONResponse({"tables": list_db_tables()})


@app.get("/admin/db/schema/{table}")
def admin_db_schema(table: str, _: sqlite3.Row = Depends(require_admin_user)):
  table_name = normalize_table_name(table)
  schema_rows = get_table_schema(table_name)
  columns = [
    {
      "name": row["name"],
      "type": row["type"],
      "notnull": bool(row["notnull"]),
      "default": row["dflt_value"],
      "pk": row["pk"]
    }
    for row in schema_rows
  ]
  primary_key = [row["name"] for row in schema_rows if row["pk"]]
  return JSONResponse({
    "table": table_name,
    "columns": columns,
    "primaryKey": primary_key,
    "hasRowid": table_has_rowid(table_name)
  })


@app.get("/admin/db/rows/{table}")
def admin_db_rows(
  table: str,
  limit: int = 50,
  offset: int = 0,
  _: sqlite3.Row = Depends(require_admin_user)
):
  table_name = normalize_table_name(table)
  has_rowid = table_has_rowid(table_name)
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute(f'SELECT COUNT(*) FROM "{table_name}"')
  total = cursor.fetchone()[0]
  if has_rowid:
    cursor.execute(
      f'SELECT rowid as _rowid, * FROM "{table_name}" ORDER BY rowid DESC LIMIT ? OFFSET ?',
      (limit, offset)
    )
  else:
    cursor.execute(
      f'SELECT * FROM "{table_name}" LIMIT ? OFFSET ?',
      (limit, offset)
    )
  rows = cursor.fetchall()
  conn.close()
  return JSONResponse({
    "table": table_name,
    "rows": [dict(row) for row in rows],
    "total": total,
    "limit": limit,
    "offset": offset,
    "hasRowid": has_rowid
  })


@app.post("/admin/db/rows/{table}")
def admin_db_insert(
  table: str,
  payload: AdminRowPayload,
  _: sqlite3.Row = Depends(require_admin_user)
):
  table_name = normalize_table_name(table)
  values = normalize_columns(table_name, payload.values or {})
  if not values:
    raise HTTPException(status_code=400, detail="No values provided")
  columns = list(values.keys())
  placeholders = ", ".join(["?"] * len(columns))
  column_sql = ", ".join([f'"{col}"' for col in columns])
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute(
    f'INSERT INTO "{table_name}" ({column_sql}) VALUES ({placeholders})',
    [values[col] for col in columns]
  )
  conn.commit()
  conn.close()
  return JSONResponse({"success": True})


@app.put("/admin/db/rows/{table}")
def admin_db_update(
  table: str,
  payload: AdminRowPayload,
  _: sqlite3.Row = Depends(require_admin_user)
):
  table_name = normalize_table_name(table)
  values = normalize_columns(table_name, payload.values or {})
  if not values:
    raise HTTPException(status_code=400, detail="No values provided")
  schema_rows = get_table_schema(table_name)
  primary_key = [row["name"] for row in schema_rows if row["pk"]]
  has_rowid = table_has_rowid(table_name)
  where_clauses = []
  where_values: list[Any] = []
  if primary_key and payload.primaryKey:
    payload_pk = normalize_columns(table_name, payload.primaryKey)
    for key in primary_key:
      if key not in payload_pk:
        raise HTTPException(status_code=400, detail=f"Missing primary key field: {key}")
      where_clauses.append(f'"{key}" = ?')
      where_values.append(payload_pk[key])
  elif has_rowid and payload.rowId is not None:
    where_clauses.append('"rowid" = ?')
    where_values.append(payload.rowId)
  else:
    raise HTTPException(status_code=400, detail="Primary key or rowId required")

  set_clauses = []
  set_values: list[Any] = []
  for key, value in values.items():
    set_clauses.append(f'"{key}" = ?')
    set_values.append(value)

  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute(
    f'UPDATE "{table_name}" SET {", ".join(set_clauses)} WHERE {" AND ".join(where_clauses)}',
    set_values + where_values
  )
  conn.commit()
  conn.close()
  return JSONResponse({"success": True})


@app.delete("/admin/db/rows/{table}")
def admin_db_delete(
  table: str,
  payload: AdminDeletePayload,
  _: sqlite3.Row = Depends(require_admin_user)
):
  table_name = normalize_table_name(table)
  schema_rows = get_table_schema(table_name)
  primary_key = [row["name"] for row in schema_rows if row["pk"]]
  has_rowid = table_has_rowid(table_name)
  where_clauses = []
  where_values: list[Any] = []
  if primary_key and payload.primaryKey:
    payload_pk = normalize_columns(table_name, payload.primaryKey)
    for key in primary_key:
      if key not in payload_pk:
        raise HTTPException(status_code=400, detail=f"Missing primary key field: {key}")
      where_clauses.append(f'"{key}" = ?')
      where_values.append(payload_pk[key])
  elif has_rowid and payload.rowId is not None:
    where_clauses.append('"rowid" = ?')
    where_values.append(payload.rowId)
  else:
    raise HTTPException(status_code=400, detail="Primary key or rowId required")

  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute(
    f'DELETE FROM "{table_name}" WHERE {" AND ".join(where_clauses)}',
    where_values
  )
  conn.commit()
  conn.close()
  return JSONResponse({"success": True})


@app.post("/admin/register")
def admin_register(payload: Dict[str, Any], user: sqlite3.Row = Depends(require_current_user)):
  if not bool(user["is_admin"]):
    raise HTTPException(status_code=403, detail="Admin access required")
  username = str(payload.get("username", "")).strip()
  if not username:
    raise HTTPException(status_code=400, detail="Username is required")
  if get_user_by_username(username):
    raise HTTPException(status_code=409, detail="Username already exists")
  password = secrets.token_urlsafe(10)
  created = create_user(username, password, is_admin=0, password_changed=0)
  return JSONResponse({
    "username": created["username"],
    "password": password
  })


@app.post("/ai/chat")
def ai_chat(payload: Dict[str, Any], user: sqlite3.Row = Depends(require_current_user)):
  if not POLO_API_KEY:
    raise HTTPException(status_code=500, detail="POLO_API_KEY not configured on server")
  auth_value = POLO_API_KEY.strip()
  if auth_value and not auth_value.lower().startswith("bearer "):
    auth_value = f"Bearer {auth_value}"
  timeout = httpx.Timeout(POLO_TIMEOUT_SECONDS)
  attempts = 2
  last_exc: Exception | None = None
  for attempt in range(1, attempts + 1):
    try:
      response = httpx.post(
        POLO_API_URL,
        json=payload,
        headers={
          "Authorization": auth_value,
          "Content-Type": "application/json"
        },
        timeout=timeout
      )
      last_exc = None
      break
    except httpx.ReadTimeout as exc:
      last_exc = exc
      print(f"[warn] Polo API read timeout (attempt {attempt}/{attempts})")
    except httpx.RequestError as exc:
      last_exc = exc
      print(f"[error] Polo API request failed: {exc}")
      break

  if last_exc:
    raise HTTPException(status_code=502, detail=f"Polo API request failed: {last_exc}")

  try:
    data = response.json()
  except ValueError:
    data = {"error": response.text}

  if response.status_code >= 400:
    return JSONResponse(status_code=response.status_code, content=data)
  return JSONResponse(content=data)


def execute_ai_task(task_id: str):
  """Background worker function to execute an AI task."""
  conn = get_db_connection()
  cursor = conn.cursor()

  try:
    # Get task details
    cursor.execute("SELECT * FROM ai_tasks WHERE id = ?", (task_id,))
    task = cursor.fetchone()
    if not task:
      print(f"[error] AI task {task_id} not found")
      return

    # Update status to running
    cursor.execute(
      "UPDATE ai_tasks SET status = 'running', started_at = ? WHERE id = ?",
      (datetime.now(timezone.utc).isoformat(), task_id)
    )
    conn.commit()

    # Parse payload and execute
    payload = json.loads(task["payload"])

    if not POLO_API_KEY:
      raise Exception("POLO_API_KEY not configured on server")

    auth_value = POLO_API_KEY.strip()
    if auth_value and not auth_value.lower().startswith("bearer "):
      auth_value = f"Bearer {auth_value}"

    timeout = httpx.Timeout(POLO_TIMEOUT_SECONDS)
    attempts = 2
    last_exc: Exception | None = None
    response = None

    for attempt in range(1, attempts + 1):
      try:
        response = httpx.post(
          POLO_API_URL,
          json=payload,
          headers={
            "Authorization": auth_value,
            "Content-Type": "application/json"
          },
          timeout=timeout
        )
        last_exc = None
        break
      except httpx.ReadTimeout as exc:
        last_exc = exc
        print(f"[warn] AI task {task_id}: Polo API read timeout (attempt {attempt}/{attempts})")
      except httpx.RequestError as exc:
        last_exc = exc
        print(f"[error] AI task {task_id}: Polo API request failed: {exc}")
        break

    if last_exc:
      raise Exception(f"Polo API request failed: {last_exc}")

    try:
      data = response.json()
    except ValueError:
      data = {"error": response.text}

    if response.status_code >= 400:
      raise Exception(f"Polo API error ({response.status_code}): {json.dumps(data)}")

    # Update task as completed with result
    cursor.execute(
      "UPDATE ai_tasks SET status = 'completed', result = ?, completed_at = ? WHERE id = ?",
      (json.dumps(data), datetime.now(timezone.utc).isoformat(), task_id)
    )
    conn.commit()
    print(f"[info] AI task {task_id} completed successfully")

  except Exception as e:
    # Update task as error
    cursor.execute(
      "UPDATE ai_tasks SET status = 'error', error = ?, completed_at = ? WHERE id = ?",
      (str(e), datetime.now(timezone.utc).isoformat(), task_id)
    )
    conn.commit()
    print(f"[error] AI task {task_id} failed: {e}")
  finally:
    conn.close()


@app.post("/ai/task/submit")
def submit_ai_task(request: AITaskSubmitRequest, user: sqlite3.Row = Depends(require_current_user)):
  """Submit an AI task for background execution. Returns immediately with task_id."""
  task_id = str(uuid.uuid4())
  user_id = user["id"]

  conn = get_db_connection()
  cursor = conn.cursor()

  try:
    cursor.execute(
      """INSERT INTO ai_tasks (id, user_id, task_type, status, payload, created_at)
         VALUES (?, ?, ?, 'pending', ?, ?)""",
      (task_id, user_id, request.taskType, json.dumps(request.payload), datetime.now(timezone.utc).isoformat())
    )
    conn.commit()
  finally:
    conn.close()

  # Submit to thread pool for background execution
  ai_task_executor.submit(execute_ai_task, task_id)

  return JSONResponse({
    "taskId": task_id,
    "status": "pending"
  })


@app.get("/ai/task/{task_id}/status")
def get_ai_task_status(task_id: str, user: sqlite3.Row = Depends(require_current_user)):
  """Get the status and result of an AI task."""
  conn = get_db_connection()
  cursor = conn.cursor()

  try:
    cursor.execute(
      "SELECT * FROM ai_tasks WHERE id = ? AND user_id = ?",
      (task_id, user["id"])
    )
    task = cursor.fetchone()

    if not task:
      raise HTTPException(status_code=404, detail="Task not found")

    result = None
    if task["result"]:
      try:
        result = json.loads(task["result"])
      except:
        result = {"raw": task["result"]}

    return JSONResponse({
      "taskId": task["id"],
      "status": task["status"],
      "result": result,
      "error": task["error"],
      "createdAt": task["created_at"],
      "startedAt": task["started_at"],
      "completedAt": task["completed_at"]
    })
  finally:
    conn.close()


@app.get("/ai/tasks/pending")
def get_pending_ai_tasks(user: sqlite3.Row = Depends(require_current_user)):
  """Get all pending/running AI tasks for the current user."""
  conn = get_db_connection()
  cursor = conn.cursor()

  try:
    cursor.execute(
      """SELECT id, task_type, status, created_at, started_at
         FROM ai_tasks
         WHERE user_id = ? AND status IN ('pending', 'running')
         ORDER BY created_at DESC""",
      (user["id"],)
    )
    tasks = cursor.fetchall()

    return JSONResponse({
      "tasks": [
        {
          "taskId": t["id"],
          "taskType": t["task_type"],
          "status": t["status"],
          "createdAt": t["created_at"],
          "startedAt": t["started_at"]
        }
        for t in tasks
      ]
    })
  finally:
    conn.close()


@app.get("/design-guidance")
def list_design_guidance(user: sqlite3.Row = Depends(require_current_user)):
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("""
    SELECT id, description, source, created_at
    FROM design_guidance
    WHERE user_id = ?
    ORDER BY created_at DESC
  """, (user["id"],))
  rows = cursor.fetchall()
  conn.close()
  return JSONResponse({"items": [dict(row) for row in rows]})


@app.post("/design-guidance")
def create_design_guidance(
  payload: DesignGuidanceCreateRequest,
  user: sqlite3.Row = Depends(require_current_user)
):
  description = payload.description.strip()
  if not description:
    raise HTTPException(status_code=400, detail="Description is required")
  if len(description) > 2000:
    raise HTTPException(status_code=400, detail="Description is too long")
  source = (payload.source or "text").strip().lower()
  if source not in {"text", "pdf", "import"}:
    raise HTTPException(status_code=400, detail="Invalid source")

  guidance_id = str(uuid.uuid4())
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("""
    INSERT INTO design_guidance (id, user_id, description, source)
    VALUES (?, ?, ?, ?)
  """, (guidance_id, user["id"], description, source))
  conn.commit()
  cursor.execute("""
    SELECT id, description, source, created_at
    FROM design_guidance
    WHERE id = ?
  """, (guidance_id,))
  row = cursor.fetchone()
  conn.close()
  return JSONResponse({"item": dict(row)})


@app.put("/design-guidance/{guidance_id}")
def update_design_guidance(
  guidance_id: str,
  payload: DesignGuidanceUpdateRequest,
  user: sqlite3.Row = Depends(require_current_user)
):
  description = payload.description.strip()
  if not description:
    raise HTTPException(status_code=400, detail="Description is required")
  if len(description) > 2000:
    raise HTTPException(status_code=400, detail="Description is too long")
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("""
    SELECT id FROM design_guidance WHERE id = ? AND user_id = ?
  """, (guidance_id, user["id"]))
  row = cursor.fetchone()
  if not row:
    conn.close()
    raise HTTPException(status_code=404, detail="Design guidance not found")
  cursor.execute("""
    UPDATE design_guidance
    SET description = ?
    WHERE id = ? AND user_id = ?
  """, (description, guidance_id, user["id"]))
  conn.commit()
  cursor.execute("""
    SELECT id, description, source, created_at
    FROM design_guidance
    WHERE id = ?
  """, (guidance_id,))
  updated = cursor.fetchone()
  conn.close()
  return JSONResponse({"item": dict(updated)})


@app.delete("/design-guidance/{guidance_id}")
def delete_design_guidance(
  guidance_id: str,
  user: sqlite3.Row = Depends(require_current_user)
):
  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("""
    SELECT id FROM design_guidance WHERE id = ? AND user_id = ?
  """, (guidance_id, user["id"]))
  row = cursor.fetchone()
  if not row:
    conn.close()
    raise HTTPException(status_code=404, detail="Design guidance not found")
  cursor.execute("""
    DELETE FROM design_guidance WHERE id = ? AND user_id = ?
  """, (guidance_id, user["id"]))
  conn.commit()
  conn.close()
  return JSONResponse({"ok": True})


# Project management endpoints
@app.post("/projects/save")
def save_project(payload: ProjectSaveRequest, user: sqlite3.Row = Depends(require_current_user)):
  """Save or update a project."""
  try:
    save_project_to_db(payload.projectId, payload.projectData, user["id"])
    return JSONResponse({"success": True, "projectId": payload.projectId})
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Failed to save project: {str(e)}")


@app.get("/projects/{project_id}")
def get_project(project_id: str, user: sqlite3.Row = Depends(require_current_user)):
  """Retrieve a project by ID."""
  project = get_project_from_db(project_id, user["id"])
  if not project:
    raise HTTPException(status_code=404, detail="Project not found")
  return JSONResponse(project)


@app.get("/projects")
def list_projects(user: sqlite3.Row = Depends(require_current_user)):
  """List all projects."""
  projects = get_all_projects_from_db(user["id"])
  return JSONResponse({"projects": projects})


@app.delete("/projects/{project_id}")
def delete_project(project_id: str, user: sqlite3.Row = Depends(require_current_user)):
  """Delete a project by ID."""
  try:
    delete_project_from_db(project_id, user["id"])
    delete_project_files(project_id)
    return JSONResponse({"success": True, "projectId": project_id})
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Failed to delete project: {str(e)}")


@app.get("/logos")
def list_logos(user: sqlite3.Row = Depends(require_current_user)):
  safe_user_id = sanitize_user_id(user["id"])
  user_dir = LOGOS_DIR / safe_user_id
  if not user_dir.exists():
    return JSONResponse({"logos": []})
  entries = []
  for entry in user_dir.iterdir():
    if not entry.is_file():
      continue
    if entry.suffix.lower() != ".webp":
      continue
    entries.append({
      "webp": f"/logos/{safe_user_id}/{entry.name}",
      "filename": entry.name,
      "mtime": entry.stat().st_mtime
    })
  entries.sort(key=lambda item: item["mtime"], reverse=True)
  return JSONResponse({"logos": entries})


@app.post("/logos/upload")
def upload_logo(file: UploadFile = File(...), user: sqlite3.Row = Depends(require_current_user)):
  saved = save_logo_files(file, user["id"])
  return JSONResponse({
    "original": f"/logos/{saved['original']}",
    "webp": f"/logos/{saved['webp']}"
  })


@app.delete("/logos/{filename}")
def delete_logo(filename: str, user: sqlite3.Row = Depends(require_current_user)):
  safe_user_id = sanitize_user_id(user["id"])
  user_dir = (LOGOS_DIR / safe_user_id).resolve()
  if not str(user_dir).startswith(str(LOGOS_DIR.resolve())):
    raise HTTPException(status_code=400, detail="Invalid logo path")
  if "/" in filename or "\\" in filename:
    raise HTTPException(status_code=400, detail="Invalid filename")
  file_path = (user_dir / filename).resolve()
  if not str(file_path).startswith(str(user_dir)):
    raise HTTPException(status_code=400, detail="Invalid logo path")
  if not file_path.exists() or not file_path.is_file():
    raise HTTPException(status_code=404, detail="Logo not found")
  if file_path.suffix.lower() != ".webp":
    raise HTTPException(status_code=400, detail="Invalid logo type")
  original_name = file_path.stem
  original_files = list(user_dir.glob(f"{original_name}.*"))
  try:
    file_path.unlink()
  except OSError:
    raise HTTPException(status_code=500, detail="Failed to delete logo")
  for item in original_files:
    try:
      if item.exists() and item.is_file():
        item.unlink()
    except OSError:
      continue
  return JSONResponse({"success": True})


@app.get("/logos/{username}/{filename}")
def get_logo(username: str, filename: str):
  safe_username = sanitize_user_id(username)
  if safe_username != username:
    raise HTTPException(status_code=404, detail="Logo not found")
  file_path = (LOGOS_DIR / safe_username / filename).resolve()
  if not str(file_path).startswith(str(LOGOS_DIR.resolve())):
    raise HTTPException(status_code=400, detail="Invalid logo path")
  if not file_path.exists() or not file_path.is_file():
    raise HTTPException(status_code=404, detail="Logo not found")
  return FileResponse(file_path)


@app.get("/files/list/{project_id}")
def list_project_files(project_id: str, user: sqlite3.Row = Depends(require_current_user)):
  """List files for a project."""
  project_dir = FILES_DIR / project_id
  if not project_dir.exists():
    return JSONResponse({"files": []})
  entries = []
  for entry in project_dir.iterdir():
    if not entry.is_file():
      continue
    entries.append({
      "name": entry.name,
      "mtime": entry.stat().st_mtime
    })
  entries.sort(key=lambda item: item["mtime"], reverse=True)
  return JSONResponse({"files": [item["name"] for item in entries]})


@app.get("/files/{project_id}/{filename}")
def get_file(project_id: str, filename: str):
  """Serve a file from the files directory."""
  file_path = FILES_DIR / project_id / filename

  if not file_path.exists():
    raise HTTPException(status_code=404, detail="File not found")

  # Security check: ensure file is within FILES_DIR
  if not str(file_path.resolve()).startswith(str(FILES_DIR.resolve())):
    raise HTTPException(status_code=403, detail="Access denied")

  return FileResponse(
    file_path,
    headers={
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  )


@app.options("/files/{project_id}/{filename}")
def get_file_options(project_id: str, filename: str):
  """CORS preflight for file access."""
  return Response(
    status_code=204,
    headers={
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  )


if __name__ == "__main__":
  import uvicorn

  uvicorn.run(app, host="0.0.0.0", port=8001)
