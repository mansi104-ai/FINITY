from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:
    from orchestrator.crew import FinanceCrew
except ModuleNotFoundError:
    from python_agents.orchestrator.crew import FinanceCrew


class QueryRequest(BaseModel):
    query: str = Field(min_length=4)
    ticker: str = Field(min_length=1, max_length=15)
    budget: float = Field(gt=0)
    risk_profile: str = Field(default="medium")
    version: int = Field(default=4, ge=1, le=4)


app = FastAPI(title="Finance Orchestrator API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

crew = FinanceCrew()


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "python-agents"}


@app.post("/run")
async def run_agents(payload: QueryRequest) -> dict:
    return crew.run(payload.model_dump())
