import sys, os
sys.path.append(os.path.dirname(__file__) + "/..")

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client

from backend.app.config import settings
from backend.app.routers import matches, predictions, teams, simulation, update
from backend.app.services.updater import fetch_and_update_results

logger = logging.getLogger("lavolva")


async def _auto_update_loop():
    """Actualiza resultados cada 5 minutos mientras el servidor está activo."""
    supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)

    # Primera actualización al arrancar (espera 10s para que todo inicie)
    await asyncio.sleep(10)
    try:
        result = fetch_and_update_results(supabase)
        if result.get("updated", 0) > 0:
            logger.info(f"Auto-update al arrancar: {result['updated']} partido(s) actualizado(s)")
    except Exception as e:
        logger.warning(f"Auto-update inicial falló: {e}")

    # Loop cada 5 minutos
    while True:
        await asyncio.sleep(300)
        try:
            result = fetch_and_update_results(supabase)
            if result.get("updated", 0) > 0:
                logger.info(f"Auto-update: {result['updated']} partido(s) · {result.get('newly_finished', 0)} terminado(s)")
        except Exception as e:
            logger.warning(f"Auto-update falló: {e}")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(_auto_update_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="La Völva API",
    description="Motor de predicciones para el Mundial 2026",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(matches.router)
app.include_router(predictions.router)
app.include_router(teams.router)
app.include_router(simulation.router)
app.include_router(update.router)


@app.get("/")
def root():
    return {"status": "ok", "mensaje": "La Völva API funcionando"}


@app.get("/health")
def health():
    return {"status": "ok"}
