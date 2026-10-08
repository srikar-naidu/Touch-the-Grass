from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Touch Grass TabPFN Scorer")

class Candidate(BaseModel):
    category: int
    difficulty: int
    social_level: int
    hour_of_day: int
    day_of_week: int
    weather_encoded: int

class UserHistory(BaseModel):
    streak_days: int
    recent_skips: int
    category_completion_rate: float
    avg_difficulty_completed: float
    days_since_last_activity: int

class ScoreRequest(BaseModel):
    candidates: List[Candidate]
    history: UserHistory

class ScoreResponse(BaseModel):
    probabilities: List[float]
    scorer_used: str

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/score", response_model=ScoreResponse)
def score_candidates(req: ScoreRequest):
    # TODO: Implement TabPFN client and heuristic fallback
    # For now, return a heuristic fallback
    from heuristic import heuristic_score
    probs = [heuristic_score(c, req.history) for c in req.candidates]
    return ScoreResponse(probabilities=probs, scorer_used="heuristic")
