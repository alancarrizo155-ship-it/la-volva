"use client";
import { useEffect, useState } from "react";
import { getSimulation, refreshSimulation } from "@/lib/api";

type TeamSim = {
  team: string;
  country_code: string;
  elo_rating: number;
  champion_prob: number;
  finalist_prob: number;
  semifinal_prob: number;
};

type SimResult = {
  simulations: number;
  teams: TeamSim[];
};

const FLAG: Record<string, string> = {
  BRA: "🇧🇷", ARG: "🇦🇷", FRA: "🇫🇷", ENG: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", ESP: "🇪🇸", POR: "🇵🇹",
  NED: "🇳🇱", GER: "🇩🇪", BEL: "🇧🇪", URY: "🇺🇾", USA: "🇺🇸", MEX: "🇲🇽",
  COL: "🇨🇴", CHI: "🇨🇱", ECU: "🇪🇨", PER: "🇵🇪", VEN: "🇻🇪", PAR: "🇵🇾",
  BOL: "🇧🇴", CRC: "🇨🇷", PAN: "🇵🇦", HND: "🇭🇳", JAM: "🇯🇲", SLV: "🇸🇻",
  TTO: "🇹🇹", CUB: "🇨🇺", CAN: "🇨🇦", MAR: "🇲🇦", SEN: "🇸🇳", CMR: "🇨🇲",
  NGA: "🇳🇬", CIV: "🇨🇮", GHA: "🇬🇭", EGY: "🇪🇬", TUN: "🇹🇳", RSA: "🇿🇦",
  ALG: "🇩🇿", KOR: "🇰🇷", JPN: "🇯🇵", AUS: "🇦🇺", IRN: "🇮🇷", SAU: "🇸🇦",
  KSA: "🇸🇦", QAT: "🇶🇦", IRQ: "🇮🇶", CHN: "🇨🇳", UZB: "🇺🇿", CZE: "🇨🇿",
  SUI: "🇨🇭", AUT: "🇦🇹", DEN: "🇩🇰", POL: "🇵🇱", CRO: "🇭🇷", SRB: "🇷🇸",
  ROU: "🇷🇴", UKR: "🇺🇦", TUR: "🇹🇷", SVK: "🇸🇰", HUN: "🇭🇺", GRE: "🇬🇷",
  NOR: "🇳🇴", SWE: "🇸🇪", FIN: "🇫🇮",
};

function ProbBar({ value, max, color }: { value: number; max: number; color: string }) {
  const width = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export default function SimulacionPage() {
  const [data, setData]         = useState<SimResult | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView]         = useState<"champion" | "finalist" | "semifinal">("champion");

  useEffect(() => {
    getSimulation().then((d) => { setData(d); setLoading(false); });
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    const d = await refreshSimulation();
    if (d) setData(d);
    setRefreshing(false);
  }

  const sorted = data?.teams
    .filter((t) => t[`${view}_prob` as keyof TeamSim] as number > 0)
    .sort((a, b) => (b[`${view}_prob` as keyof TeamSim] as number) - (a[`${view}_prob` as keyof TeamSim] as number))
    ?? [];

  const maxProb = sorted[0]?.[`${view}_prob` as keyof TeamSim] as number ?? 1;

  const VIEW_LABEL = { champion: "Campeón", finalist: "Finalista", semifinal: "Semifinal" };
  const VIEW_COLOR = { champion: "bg-yellow-400", finalist: "bg-blue-400", semifinal: "bg-purple-400" };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Simulación del Mundial</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {data ? `${data.simulations.toLocaleString()} simulaciones · resultados en probabilidad` : "Cargando..."}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-sm font-medium rounded-xl transition-colors"
        >
          {refreshing ? "Simulando..." : "🔄 Recalcular"}
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 mb-6">
        {(["champion", "finalist", "semifinal"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              view === v ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>

      {/* Podio top 3 */}
      {!loading && sorted.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[sorted[1], sorted[0], sorted[2]].map((t, i) => {
            if (!t) return <div key={i} />;
            const prob  = t[`${view}_prob` as keyof TeamSim] as number;
            const rank  = i === 1 ? 1 : i === 0 ? 2 : 3;
            const sizes = ["text-4xl", "text-5xl", "text-3xl"];
            const heights = ["h-28", "h-36", "h-24"];
            return (
              <div key={t.country_code} className={`bg-gray-900 border border-gray-800 rounded-2xl p-4 text-center flex flex-col justify-end ${heights[i]}`}>
                <p className={sizes[i]}>{FLAG[t.country_code] ?? "🏳"}</p>
                <p className="font-bold text-sm mt-1 truncate">{t.team}</p>
                <p className={`font-black text-xl mt-0.5 ${rank === 1 ? "text-yellow-400" : rank === 2 ? "text-gray-300" : "text-amber-600"}`}>
                  {(prob * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-gray-500">#{rank}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Lista completa */}
      {loading ? (
        <div className="text-center py-16">
          <p className="text-gray-400 mb-2">Simulando {(5000).toLocaleString()} torneos...</p>
          <p className="text-xs text-gray-600">Esto puede tardar unos segundos</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-gray-500">No hay datos de simulación.</div>
      ) : (
        <div className="space-y-2">
          {sorted.map((t, idx) => {
            const prob = t[`${view}_prob` as keyof TeamSim] as number;
            return (
              <div key={t.country_code} className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex items-center gap-3">
                <span className="text-xs text-gray-600 w-5 text-right flex-none">{idx + 1}</span>
                <span className="text-xl flex-none">{FLAG[t.country_code] ?? "🏳"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-semibold text-sm truncate">{t.team}</p>
                    <p className="font-black text-sm ml-3 flex-none">
                      {(prob * 100).toFixed(1)}%
                    </p>
                  </div>
                  <ProbBar value={prob} max={maxProb} color={VIEW_COLOR[view]} />
                  <div className="flex gap-3 mt-1">
                    <p className="text-xs text-gray-600">ELO {t.elo_rating.toFixed(0)}</p>
                    {view !== "semifinal" && (
                      <p className="text-xs text-gray-600">SF: {(t.semifinal_prob * 100).toFixed(0)}%</p>
                    )}
                    {view === "champion" && (
                      <p className="text-xs text-gray-600">Final: {(t.finalist_prob * 100).toFixed(0)}%</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-700 text-center mt-6">
        Simulación basada en ratings ELO y modelo de Poisson. No garantiza resultados reales.
      </p>
    </div>
  );
}
