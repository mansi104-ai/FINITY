from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from orchestrator.crew import FinanceCrew

app = FastAPI(title="Finance Orchestrator API")

app.add_middleware(CORSMiddleware, allow_origins=["*"],
    allow_methods=["*"], allow_headers=["*"])

class QueryRequest(BaseModel):
    ticker: str
    budget: float
    risk_profile: str  # "conservative" | "moderate" | "aggressive"

@app.post("/run")
async def run_agents(query: QueryRequest):
    crew = FinanceCrew()
    report = crew.run(query.dict())
    return report

@app.get("/health")
async def health():
    return {"status": "ok"}