from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class TeamOut(BaseModel):
    id: int
    name: str
    country_code: str
    elo_rating: float
    group_wc2026: Optional[str] = None


class MatchOut(BaseModel):
    id: int
    home_team: str
    away_team: str
    home_team_code: str
    away_team_code: str
    match_date: Optional[str] = None
    stage: Optional[str] = None
    home_goals: Optional[int] = None
    away_goals: Optional[int] = None
    status: str


class PredictionOut(BaseModel):
    match_id: int
    home_team: str
    away_team: str
    home_win_prob: float
    draw_prob: float
    away_win_prob: float
    predicted_home_goals: float
    predicted_away_goals: float
    over25_prob: float
    under25_prob: float
    btts_prob: float
    home_elo_used: float
    away_elo_used: float


class BetssonOddsIn(BaseModel):
    home: Optional[float] = None
    draw: Optional[float] = None
    away: Optional[float] = None
    over25: Optional[float] = None
    under25: Optional[float] = None
    over15: Optional[float] = None
    over35: Optional[float] = None
    btts: Optional[float] = None


class ValueBetResult(BaseModel):
    selection: str
    our_probability: float
    betsson_odds: float
    implied_prob: float
    expected_value: float
    is_value_bet: bool


class ValueBetOut(BaseModel):
    match_id: int
    home_team: str
    away_team: str
    markets: list[ValueBetResult]
