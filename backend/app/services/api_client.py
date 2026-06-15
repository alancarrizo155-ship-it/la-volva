import httpx
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
from backend.app.config import settings

HEADERS = {"X-Auth-Token": settings.football_data_key}
BASE    = settings.football_data_base_url
WC_CODE = "WC"   # código del Mundial en football-data.org


def get(endpoint: str, params: dict = {}) -> dict:
    with httpx.Client(timeout=30) as client:
        r = client.get(f"{BASE}/{endpoint}", headers=HEADERS, params=params)
        r.raise_for_status()
        return r.json()


def get_teams() -> list:
    data = get(f"competitions/{WC_CODE}/teams")
    return data.get("teams", [])


def get_fixtures() -> list:
    data = get(f"competitions/{WC_CODE}/matches")
    return data.get("matches", [])


def get_standings() -> list:
    data = get(f"competitions/{WC_CODE}/standings")
    return data.get("standings", [])


def get_competition() -> dict:
    return get(f"competitions/{WC_CODE}")
