"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getMatches, updateResults } from "@/lib/api";
import {
  getConfidence,
  getFavoriteLabel,
  getPickScore,
  getRecommendations,
  type Pred,
} from "@/lib/predictions";

type Match = {
  id: number;
  match_date: string;
  stage: string;
  status: string;
  home_goals: number | null;
  away_goals: number | null;
  home_team: { name: string; country_code: string; elo_rating: number } | null;
  away_team: { name: string; country_code: string; elo_rating: number } | null;
  prediction: Pred | null;
};

const STATUS_LABEL: Record<string, string> = {
  finished: "Finalizado", live: "EN VIVO", scheduled: "Programado",
};
const STATUS_COLOR: Record<string, string> = {
  finished:  "bg-gray-700 text-gray-300",
  live:      "bg-green-600 text-white animate-pulse",
  scheduled: "bg-blue-900 text-blue-200",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function isToday(iso: string) {
  const d   = new Date(iso);
  const now = new Date();
  return (
    d.getDate()     === now.getDate()     &&
    d.getMonth()    === now.getMonth()    &&
    d.getFullYear() === now.getFullYear()
  );
}

function isFuture(iso: string) {
  return new Date(iso) > new Date();
}

export default function Home() {
  const [matches, setMatches]     = useState<Match[]>([]);
  const [filter, setFilter]       = useState("all");
  const [loading, setLoading]     = useState(true);
  const [updating, setUpdating]   = useState(false);
  const [updateMsg, setUpdateMsg] = useState("");
  const [lastRefresh, setLastRefresh] = useState(new Date());

  function loadMatches(status?: string) {
    getMatches(status).then((data) => {
      setMatches(Array.isArray(data) ? data : []);
      setLoading(false);
      setLastRefresh(new Date());
    });
  }

  useEffect(() => {
    const status = filter === "all" ? undefined : filter;
    loadMatches(status);
  }, [filter]);

  async function handleUpdate() {
    setUpdating(true);
    setUpdateMsg("");
    const r = await updateResults();
    if (r?.error) {
      setUpdateMsg(`Error: ${r.error}`);
    } else if (r) {
      const msg = r.updated > 0
        ? `${r.updated} partido(s) actualizado(s)${r.newly_finished > 0 ? ` · ${r.newly_finished} recién terminado(s) · ELOs recalculados` : ""}`
        : "Todo al día, sin cambios";
      setUpdateMsg(msg);
      if (r.updated > 0) {
        setLoading(true);
        getMatches(filter === "all" ? undefined : filter).then((d) => {
          setMatches(Array.isArray(d) ? d : []);
          setLoading(false);
        });
      }
    }
    setUpdating(false);
    setTimeout(() => setUpdateMsg(""), 5000);
  }

  const todayMatches   = matches.filter((m) => isToday(m.match_date));
  const upcomingToday  = todayMatches.filter((m) => m.status === "scheduled" || m.status === "live");

  // Picks del día — solo confianza Alta (≥70%) o Muy alta (≥80%).
  // Si no hay ninguno, la sección se oculta por completo.
  const HIGH_CONF = 0.70;
  const pickCandidates = upcomingToday.length > 0
    ? upcomingToday
    : matches.filter((m) => m.status === "scheduled").slice(0, 5);
  const picks = pickCandidates
    .filter((m) => {
      if (!m.prediction) return false;
      const recs = getRecommendations(
        m.prediction,
        m.home_team?.name ?? "Local",
        m.away_team?.name ?? "Visitante",
      );
      return recs.length > 0 && recs[0].prob >= HIGH_CONF;
    })
    .sort((a, b) => getPickScore(b.prediction!) - getPickScore(a.prediction!))
    .slice(0, 3);

  const grouped = matches.reduce((acc: Record<string, Match[]>, m) => {
    const key = m.stage || "Fase de grupos";
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

  return (
    <div>
      {/* ── Picks del día ─────────────────────────────────── */}
      {!loading && picks.length > 0 && filter === "all" && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            🎯 Picks del día
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {picks.map((m) => {
              const pred  = m.prediction!;
              const recs  = getRecommendations(pred, m.home_team?.name ?? "Local", m.away_team?.name ?? "Visitante");
              const top   = recs[0];
              const conf  = getConfidence(pred);
              return (
                <Link key={m.id} href={`/matches/${m.id}`}>
                  <div className={`bg-gray-900 border rounded-xl p-4 hover:border-blue-500 transition-colors cursor-pointer h-full ${
                    conf.color === "green" ? "border-green-700" :
                    conf.color === "yellow" ? "border-yellow-700" : "border-red-700"
                  }`}>
                    <p className="text-xs text-gray-400 mb-2">
                      {m.home_team?.name} vs {m.away_team?.name}
                    </p>
                    {top && (
                      <>
                        <p className="font-bold text-white text-sm">{top.label}</p>
                        <p className="text-2xl font-black mt-1 text-blue-300">
                          {(top.prob * 100).toFixed(0)}%
                        </p>
                        <p className="text-xs text-gray-500 mt-1">{top.reason}</p>
                      </>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Partidos de hoy ───────────────────────────────── */}
      {!loading && todayMatches.length > 0 && filter === "all" && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            📅 Hoy
          </h2>
          <MatchList matches={todayMatches} />
        </section>
      )}

      {/* ── Filtros y fixture completo ─────────────────────── */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">
            {filter === "all" ? "Fixture completo" : STATUS_LABEL[filter]}
          </h2>
          {updateMsg && (
            <span className="text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded-full">
              {updateMsg}
            </span>
          )}
        </div>
        <div className="flex gap-1.5 items-center">
          <span className="text-xs text-gray-600 hidden sm:inline">
            Actualizado {lastRefresh.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <button
            onClick={handleUpdate}
            disabled={updating}
            className="px-3 py-1 rounded-full text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {updating ? "Actualizando..." : "🔄 Actualizar"}
          </button>
          {["all", "finished", "live", "scheduled"].map((s) => (
            <button
              key={s}
              onClick={() => { setLoading(true); setFilter(s); }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === s ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {s === "all" ? "Todos" : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-20">Cargando partidos...</div>
      ) : (
        Object.entries(grouped).map(([stage, stageMatches]) => (
          <div key={stage} className="mb-8">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 pl-1">
              {stage.replace(/_/g, " ")}
            </h3>
            <MatchList matches={stageMatches} />
          </div>
        ))
      )}
    </div>
  );
}

function MatchList({ matches }: { matches: Match[] }) {
  return (
    <div className="grid gap-2">
      {matches.map((m) => {
        const pred     = m.prediction;
        const homeName = m.home_team?.name ?? "Local";
        const awayName = m.away_team?.name ?? "Visitante";
        const conf     = pred ? getConfidence(pred) : null;
        const favLabel = pred ? getFavoriteLabel(pred, homeName, awayName) : null;

        return (
          <Link key={m.id} href={`/matches/${m.id}`}>
            <div className={`bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-600 transition-colors cursor-pointer border-l-4 ${
              conf ? conf.borderClass : "border-l-gray-700"
            }`}>
              <div className="flex items-center gap-3">
                {/* Semáforo */}
                <span className="text-base flex-none w-5 text-center">
                  {conf ? conf.dot : "⚪"}
                </span>

                {/* Equipo local */}
                <div className="flex-1 text-right min-w-0">
                  <p className="font-semibold text-white truncate">{homeName}</p>
                  <p className="text-xs text-gray-500">{m.home_team?.country_code}</p>
                </div>

                {/* Marcador / vs */}
                <div className="text-center flex-none w-20">
                  {m.status === "finished" ? (
                    <p className="text-xl font-black">
                      {m.home_goals} <span className="text-gray-500">-</span> {m.away_goals}
                    </p>
                  ) : (
                    <p className="text-sm font-bold text-gray-500">vs</p>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full inline-block mt-0.5 ${STATUS_COLOR[m.status]}`}>
                    {STATUS_LABEL[m.status]}
                  </span>
                </div>

                {/* Equipo visitante */}
                <div className="flex-1 text-left min-w-0">
                  <p className="font-semibold text-white truncate">{awayName}</p>
                  <p className="text-xs text-gray-500">{m.away_team?.country_code}</p>
                </div>

                {/* Info derecha */}
                <div className="text-right flex-none ml-1 hidden sm:block">
                  <p className="text-xs text-gray-500">
                    {m.match_date ? formatDate(m.match_date) : "—"}
                  </p>
                  {conf && (
                    <p className={`text-xs mt-1 px-2 py-0.5 rounded-full border inline-block ${conf.badgeClass}`}>
                      {favLabel || conf.label}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
