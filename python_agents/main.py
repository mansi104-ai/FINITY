from pathlib import Path

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    def load_dotenv(*_args, **_kwargs):  # type: ignore[no-redef]
        return False
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Load environment variables from local and repo-root .env.local files.
CURRENT_DIR = Path(__file__).resolve().parent
ROOT_DIR = CURRENT_DIR.parent
load_dotenv(CURRENT_DIR / ".env.local")
load_dotenv(ROOT_DIR / ".env.local")

try:
    from .orchestrator.crew import FinanceCrew
except Exception:
    try:
        from orchestrator.crew import FinanceCrew
    except ModuleNotFoundError:
        from python_agents.orchestrator.crew import FinanceCrew


class QueryRequest(BaseModel):
    query: str = Field(min_length=4)
    ticker: str = Field(min_length=1, max_length=15)
    budget: float = Field(gt=0)
    risk_profile: str = Field(default="medium")
    version: int = Field(default=2, ge=1, le=4)


app = FastAPI(title="Finance Orchestrator API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

crew = FinanceCrew()

# v2 router: the agentic pipeline plus the forward-test record. Mounted
# fail-soft so a missing v2 dependency (torch, for instance) degrades to the
# v1 surface instead of preventing the service from binding at all -- the
# failure mode that took this deployment down before.
try:
    try:
        from .api_v2 import router as v2_router
    except ImportError:
        from api_v2 import router as v2_router  # type: ignore
    app.include_router(v2_router)
    V2_AVAILABLE = True
    V2_ERROR = ""
except Exception as _e:  # pragma: no cover
    V2_AVAILABLE = False
    V2_ERROR = f"{type(_e).__name__}: {_e}"


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "python-agents"}


@app.post("/run")
async def run_agents(payload: QueryRequest) -> dict:
    return crew.run(payload.model_dump())


@app.get("/reliability")
async def reliability() -> dict:
    """Transparency endpoint: dumps every agent's current reliability
    profile (per volatility-regime context), as tracked in
    services/reliability.py and used to adaptively weight each agent's
    contribution to the buy score in orchestrator/crew.py.
    """
    return {
        "agents": crew.reliability.snapshot(),
        "note": (
            "Scores are Bayesian-smoothed toward a 0.75 prior until an agent/context "
            "accumulates enough real observations to override it. On serverless "
            "deployments this resets on cold start (see services/reliability.py)."
        ),
    }

