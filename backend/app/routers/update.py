from fastapi import APIRouter, BackgroundTasks
from supabase import create_client
from backend.app.config import settings
from backend.app.services.updater import fetch_and_update_results

router   = APIRouter(prefix="/update", tags=["Actualización"])
supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)


@router.post("/results")
def update_results(background_tasks: BackgroundTasks):
    """
    Descarga los últimos resultados de football-data.org,
    actualiza la base de datos y recalcula ELOs si hay partidos nuevos terminados.
    """
    background_tasks.add_task(fetch_and_update_results, supabase)
    return {"message": "Actualizando resultados en segundo plano..."}


@router.post("/results/now")
def update_results_sync():
    """Igual que /results pero espera el resultado (útil para debug)."""
    result = fetch_and_update_results(supabase)
    return result
