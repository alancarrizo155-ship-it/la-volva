from fastapi import APIRouter
from supabase import create_client
from backend.app.config import settings
from backend.app.services.simulator import run_simulation

router   = APIRouter(prefix="/simulation", tags=["Simulación"])
supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)

_cache: dict = {}


@router.get("/")
def get_simulation(n: int = 5000):
    """
    Simula el Mundial 2026 n veces y devuelve probabilidades de
    campeón, finalista y semifinalista por equipo.
    Usa caché de 1 hora para no recalcular en cada request.
    """
    import time

    cache_key = f"sim_{n}"
    now       = time.time()

    if cache_key in _cache and now - _cache[cache_key]["ts"] < 3600:
        return _cache[cache_key]["data"]

    result = run_simulation(supabase, n=n)
    _cache[cache_key] = {"ts": now, "data": result}
    return result


@router.post("/refresh")
def refresh_simulation(n: int = 5000):
    """Fuerza el recálculo de la simulación (limpia caché)."""
    _cache.clear()
    result = run_simulation(supabase, n=n)
    import time
    _cache[f"sim_{n}"] = {"ts": time.time(), "data": result}
    return result
