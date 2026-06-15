"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { loadBets, updateBetResult, deleteBet, type Bet } from "@/lib/predictions";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function MisApuestasPage() {
  const [bets, setBets]     = useState<Bet[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "won" | "lost">("all");

  useEffect(() => {
    setBets(loadBets());
  }, []);

  function handleResult(id: string, result: "won" | "lost") {
    updateBetResult(id, result);
    setBets(loadBets());
  }

  function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta apuesta?")) return;
    deleteBet(id);
    setBets(loadBets());
  }

  const filtered = bets.filter((b) => filter === "all" || b.result === filter);

  const totalInvested = bets.filter((b) => b.result !== "pending").reduce((s, b) => s + b.amount, 0);
  const totalWon      = bets.filter((b) => b.result === "won").reduce((s, b) => s + b.potentialWin, 0);
  const totalLost     = bets.filter((b) => b.result === "lost").reduce((s, b) => s + b.amount, 0);
  const profit        = totalWon - totalInvested;
  const pending       = bets.filter((b) => b.result === "pending").length;

  const RESULT_LABEL: Record<string, string> = {
    pending: "Pendiente", won: "Ganada", lost: "Perdida",
  };
  const RESULT_COLOR: Record<string, string> = {
    pending: "bg-blue-900 text-blue-200",
    won:     "bg-green-700 text-white",
    lost:    "bg-red-900 text-red-200",
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Mis apuestas</h1>
          <p className="text-sm text-gray-400 mt-0.5">Tu historial de apuestas registradas</p>
        </div>
        <Link href="/" className="text-blue-400 text-sm hover:underline">
          ← Fixture
        </Link>
      </div>

      {/* ── Stats generales ────────────────────────────────── */}
      {bets.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Apostado</p>
            <p className="text-lg font-bold">${totalInvested.toFixed(2)}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Ganado</p>
            <p className="text-lg font-bold text-green-400">${totalWon.toFixed(2)}</p>
          </div>
          <div className={`border rounded-xl p-3 text-center ${
            profit >= 0 ? "bg-green-900/20 border-green-700" : "bg-red-900/20 border-red-700"
          }`}>
            <p className="text-xs text-gray-400 mb-1">Ganancia neta</p>
            <p className={`text-lg font-bold ${profit >= 0 ? "text-green-400" : "text-red-400"}`}>
              {profit >= 0 ? "+" : ""}${profit.toFixed(2)}
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Pendientes</p>
            <p className="text-lg font-bold text-blue-300">{pending}</p>
          </div>
        </div>
      )}

      {/* ── Filtros ────────────────────────────────────────── */}
      {bets.length > 0 && (
        <div className="flex gap-2 mb-4">
          {(["all", "pending", "won", "lost"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {f === "all" ? "Todas" : RESULT_LABEL[f]}
              {f !== "all" && (
                <span className="ml-1 opacity-60">
                  ({bets.filter((b) => b.result === f).length})
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Lista de apuestas ──────────────────────────────── */}
      {bets.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-4xl mb-3">💰</p>
          <p className="font-semibold text-gray-400 mb-1">No tenés apuestas registradas</p>
          <p className="text-sm mb-4">Entrá a un partido y hacé clic en "Registrar apuesta"</p>
          <Link href="/" className="text-blue-400 hover:underline text-sm">
            Ver partidos →
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>No hay apuestas {RESULT_LABEL[filter].toLowerCase()}s.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((bet) => (
            <div
              key={bet.id}
              className={`bg-gray-900 border rounded-2xl p-4 ${
                bet.result === "won"  ? "border-green-700" :
                bet.result === "lost" ? "border-red-700" : "border-gray-800"
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-white text-sm">{bet.matchLabel}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{formatDate(bet.placedAt)}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${RESULT_COLOR[bet.result]}`}>
                  {RESULT_LABEL[bet.result]}
                </span>
              </div>

              {/* Detalle */}
              <div className="bg-gray-800 rounded-xl p-3 mb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Selección</p>
                    <p className="font-semibold text-white">{bet.selectionLabel}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-400 mb-0.5">Odds</p>
                    <p className="font-bold text-yellow-300">@{bet.odds}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400 mb-0.5">Apostado</p>
                    <p className="font-semibold">${bet.amount}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400 mb-0.5">Potencial</p>
                    <p className="font-bold text-green-400">${bet.potentialWin}</p>
                  </div>
                </div>
              </div>

              {/* Acciones */}
              <div className="flex gap-2">
                {bet.result === "pending" && (
                  <>
                    <button
                      onClick={() => handleResult(bet.id, "won")}
                      className="flex-1 bg-green-700 hover:bg-green-600 text-white text-sm font-semibold py-2 rounded-xl transition-colors"
                    >
                      Gané ✓
                    </button>
                    <button
                      onClick={() => handleResult(bet.id, "lost")}
                      className="flex-1 bg-red-900 hover:bg-red-800 text-white text-sm font-semibold py-2 rounded-xl transition-colors"
                    >
                      Perdí ✗
                    </button>
                  </>
                )}
                {bet.result !== "pending" && (
                  <button
                    onClick={() => handleResult(bet.id, bet.result === "won" ? "lost" : "won")}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm py-2 rounded-xl transition-colors"
                  >
                    Cambiar resultado
                  </button>
                )}
                <button
                  onClick={() => handleDelete(bet.id)}
                  className="px-4 bg-gray-800 hover:bg-gray-700 text-gray-500 text-sm rounded-xl transition-colors"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
