import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "La Völva — Predicciones Mundial 2026",
  description: "Motor de predicciones estadísticas para el Mundial 2026",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-gray-950 text-white min-h-screen">
        <header className="border-b border-gray-800 bg-gray-900 sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <span className="text-2xl">🔮</span>
              <div>
                <h1 className="text-lg font-bold text-white leading-none">La Völva</h1>
                <p className="text-xs text-gray-400 leading-none mt-0.5">Mundial 2026</p>
              </div>
            </Link>
            <nav className="flex items-center gap-1">
              <Link
              href="/analizar"
              className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 transition-colors flex items-center gap-1.5"
            >
              🎯 ¿Qué apostar?
            </Link>
            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
            >
              Fixture
            </Link>
              <Link
              href="/simulacion"
              className="px-3 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors flex items-center gap-1.5"
            >
              <span>🎲</span> Simulación
            </Link>
            <Link
              href="/mis-apuestas"
              className="px-3 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors flex items-center gap-1.5"
            >
              <span>💰</span> Mis apuestas
            </Link>
            </nav>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
