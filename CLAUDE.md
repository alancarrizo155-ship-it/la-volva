# La Völva — Guía del Proyecto

## Qué es este proyecto

La Völva es una herramienta personal de análisis estadístico de fútbol enfocada en el Mundial 2026. Su propósito es calcular probabilidades de resultado de partidos y compararlas contra las odds de Betsson para identificar apuestas con valor (value betting). El dinero de las apuestas es personal del usuario.

## Objetivo final

Generar predicciones estadísticas confiables para:
- Resultado del partido (1/X/2)
- Handicap
- Over/Under goles
- Otras mercados disponibles en Betsson

Y detectar automáticamente cuándo las odds de Betsson subestiman la probabilidad real calculada por el sistema (value bet).

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js (React) |
| Motor de predicción | Python + FastAPI |
| Base de datos | PostgreSQL vía Supabase |
| Fuente de datos | API-Football (free tier) |

## Arquitectura general

```
Datos (API-Football + scrapers)
        ↓
PostgreSQL (Supabase)
  - equipos, jugadores, partidos
  - estadísticas históricas
  - resultados Mundial 2026
        ↓
Motor de análisis (Python/FastAPI)
  - Ratings ELO
  - Modelo Poisson para goles
  - Expected Goals (xG)
  - Forma reciente (últimos N partidos)
  - Head-to-head histórico
  - Faltas, tarjetas, posesión, etc.
        ↓
API REST (FastAPI)
        ↓
Frontend Next.js
  - Dashboard de partidos del Mundial
  - Probabilidades calculadas
  - Ingreso manual de odds de Betsson
  - Detección de value bets resaltada visualmente
```

## Fases de desarrollo

### Fase 1 — Base de datos y datos
- Configurar Supabase (PostgreSQL)
- Conectar API-Football
- Poblar: equipos, grupos, partidos Mundial 2026, histórico mundiales anteriores
- Scripts de actualización automática cuando se juegan partidos

### Fase 2 — Motor de predicción
- Calcular ELO de cada selección
- Modelo Poisson para predicción de goles (y derivar 1/X/2, over/under)
- Calcular forma reciente
- Head-to-head
- Integrar xG cuando los datos lo permitan

### Fase 3 — API
- FastAPI exponiendo endpoints de predicción por partido
- Endpoint de value bet dado un odds externo

### Fase 4 — Frontend
- Dashboard con fixture del Mundial
- Vista de partido: probabilidades + mercados
- Ingreso de odds de Betsson → cálculo de value en tiempo real
- Historial de predicciones vs resultados reales (para evaluar el modelo)

## Decisiones clave

- **Uso personal**: no hay autenticación compleja, no hay multiusuario.
- **Odds de Betsson**: se ingresan manualmente por el usuario (no scraping de Betsson).
- **Value betting**: fórmula `EV = (probabilidad_propia × odds_betsson) - 1`. Si EV > 0, es value bet.
- **Datos históricos**: mundiales anteriores + partidos actuales del Mundial 2026.
- **Sin ML complejo por ahora**: modelos estadísticos clásicos (Poisson, ELO). ML puede agregarse en fases futuras.

## Contexto del usuario

- Experiencia técnica mínima — explicar decisiones, no asumir conocimiento previo.
- El usuario entiende fútbol y apuestas, pero no necesariamente código.
- Usar términos de fútbol/apuestas en la UI (no jerga técnica).

## Comandos útiles (se irán agregando)

```bash
# Backend — SIEMPRE desde la raíz del proyecto (necesita el .env que está en la raíz)
uvicorn backend.main:app --reload

# Frontend — desde la carpeta frontend
cd frontend
npm run dev

# Base de datos
# Administrar desde el dashboard de Supabase
```
