"""Configuración central. Todo se puede ajustar por variables de entorno."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).parent

# --- Credenciales (nunca van en el código) ---
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# --- Modelos, en orden de preferencia. Cada modelo tiene su propia cuota gratuita por día:
# si uno se agota o no existe, el agente pasa al siguiente. Se puede cambiar con GEMINI_MODELS
# (separados por coma). Ver los disponibles en aistudio.google.com.
_DEFAULT_MODELS = "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite"
GEMINI_MODELS = [
    m.strip()
    for m in (os.getenv("GEMINI_MODELS") or os.getenv("GEMINI_MODEL") or _DEFAULT_MODELS).split(",")
    if m.strip()
]

# --- Recolección ---
USER_AGENT = os.getenv(
    "USER_AGENT",
    "GanaderiaMonitorBot/0.1 (trabajo practico universitario; contacto: ver repositorio)",
)
HTTP_TIMEOUT = int(os.getenv("HTTP_TIMEOUT", "20"))
REQUEST_DELAY = float(os.getenv("REQUEST_DELAY", "1.0"))   # segundos entre pedidos (cortesía)
MAX_PRIORITY = int(os.getenv("MAX_PRIORITY", "1"))         # 1 = solo fuentes prioritarias
MAX_LINKS_PER_SOURCE = int(os.getenv("MAX_LINKS_PER_SOURCE", "6"))
MAX_PDF_PAGES = int(os.getenv("MAX_PDF_PAGES", "25"))
MIN_DOC_CHARS = int(os.getenv("MIN_DOC_CHARS", "400"))
MAX_DOC_CHARS = int(os.getenv("MAX_DOC_CHARS", "40000"))   # lo que se guarda por documento
MIN_RELEVANCE_HITS = int(os.getenv("MIN_RELEVANCE_HITS", "2"))

# --- Análisis con LLM (cuota gratuita: ir de a poco) ---
ANALYZE_CHARS = int(os.getenv("ANALYZE_CHARS", "15000"))   # lo que se le manda al modelo
MAX_ANALYZE_PER_RUN = int(os.getenv("MAX_ANALYZE_PER_RUN", "40"))
LLM_SLEEP_SECONDS = float(os.getenv("LLM_SLEEP_SECONDS", "13"))   # el tier gratuito permite ~5 pedidos/minuto
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "4"))
LLM_TIMEOUT_SECONDS = int(os.getenv("LLM_TIMEOUT_SECONDS", "120"))   # un pedido colgado no frena la corrida
THINKING_LEVEL = os.getenv("THINKING_LEVEL", "low")                 # razonamiento acotado: más rápido y barato; "" = por defecto del modelo
MAX_RUNTIME_MINUTES = int(os.getenv("MAX_RUNTIME_MINUTES", "40"))   # tope total antes de armar el resumen (GitHub corta a los 60)

# --- Snapshot ---
WINDOW_DAYS = int(os.getenv("WINDOW_DAYS", "365"))         # documentos más viejos no cuentan
MIN_REFERENCE_CONFIDENCE = float(os.getenv("MIN_REFERENCE_CONFIDENCE", "0.4"))

HOME_COUNTRY = "AR"
