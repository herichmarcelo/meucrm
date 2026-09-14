"use client";

import { useState } from "react";

interface CsatVoteClientProps {
  token: string;
  marcaNome: string;
  logoUrl: string | null;
  accentColor: string;
  accentFg: string;
  initialStatus: string;
  initialScore: number;
  initialComment: string;
}

const STAR_LABELS: Record<number, string> = {
  1: "Péssimo",
  2: "Ruim",
  3: "Regular",
  4: "Bom",
  5: "Excelente",
};

export default function CsatVoteClient({
  token,
  marcaNome,
  logoUrl,
  accentColor,
  accentFg,
  initialStatus,
  initialScore,
  initialComment,
}: CsatVoteClientProps) {
  const [score, setScore] = useState<number>(initialScore);
  const [comment, setComment] = useState<string>(initialComment);
  const [submitted, setSubmitted] = useState<boolean>(initialStatus === "completed");
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/v1/csat/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          score,
          comment: comment.trim() || null,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Falha ao enviar avaliação");
      }

      setSubmitted(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro inesperado ao enviar.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 p-8 text-center transition-all">
        {logoUrl && (
          <div className="mb-6 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt={marcaNome} className="h-10 max-w-[200px] object-contain" />
          </div>
        )}

        <h2 className="text-xl font-bold text-slate-800 mb-1">{marcaNome}</h2>
        <p className="text-sm text-slate-500 mb-6">Pesquisa de Satisfação</p>

        {submitted ? (
          <div className="py-8 animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Avaliação Registrada!</h3>
            <p className="text-sm text-slate-600">
              Agradecemos imensamente por dedicar seu tempo. Sua opinião nos ajuda a construir uma experiência cada vez melhor.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="text-left">
              <label className="block text-sm font-medium text-slate-700 mb-3 text-center">
                Como você avalia o atendimento que recebeu?
              </label>

              <div className="flex justify-center items-center gap-2 mb-2">
                {[1, 2, 3, 4, 5].map((star) => {
                  const isSelected = star <= score;
                  return (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setScore(star)}
                      className="p-1.5 focus:outline-none transition-transform active:scale-90 hover:scale-110"
                      aria-label={`${star} estrela${star > 1 ? "s" : ""}`}
                    >
                      <svg
                        className={`w-9 h-9 transition-colors ${
                          isSelected ? "text-amber-400 fill-amber-400" : "text-slate-300 fill-slate-100"
                        }`}
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                        />
                      </svg>
                    </button>
                  );
                })}
              </div>

              <div className="text-center font-medium text-sm text-slate-600 mb-4 h-5">
                {STAR_LABELS[score] || ""}
              </div>
            </div>

            <div className="text-left">
              <label htmlFor="csat-comment" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Comentário ou sugestão (opcional)
              </label>
              <textarea
                id="csat-comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Conte-nos o que você achou do atendimento..."
                className="w-full text-sm border border-slate-200 rounded-xl p-3 focus:ring-2 focus:ring-slate-300 focus:outline-none transition resize-none text-slate-800"
              />
            </div>

            {errorMsg && (
              <div className="text-xs text-rose-600 bg-rose-50 p-2.5 rounded-lg text-left">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ backgroundColor: accentColor, color: accentFg }}
              className="w-full font-semibold py-3 px-4 rounded-xl shadow hover:opacity-95 active:scale-[0.99] transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                "Enviar Avaliação"
              )}
            </button>
          </form>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-6">Sua avaliação é anônima perante terceiros e protegida por sigilo.</p>
    </div>
  );
}
