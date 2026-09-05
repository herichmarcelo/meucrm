"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";

import { Robot } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useUser } from "@/hooks/auth/AuthProvider";
import type { Message } from "@/lib/types/messaging";

import { MediaUnavailable } from "./MediaUnavailable";
import { mediaSrc } from "./media-utils";
import {
  notifyAudioEnded,
  notifyAudioStarted,
  registerAudioPlayer,
} from "./audioCoordinator";

const RATES = [1, 1.5, 2] as const;

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface Props {
  messageId: string;
  isOutbound: boolean;
  message?: Message;
}

/** Player de voz estilo WhatsApp: play/pause nativo, avatar do remetente com microfone, alternância dinâmica para velocidade e reprodução sequencial. */
export function AudioPlayer({ messageId, isOutbound, message }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const user = useUser();
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [rateIdx, setRateIdx] = useState(0);
  const [failed, setFailed] = useState(false);

  const contactId = message?.contact_id;
  const sentVia = message?.sent_via;

  // Registro no coordenador para pausar outros áudios e autoplay sequencial
  useEffect(() => {
    return registerAudioPlayer(messageId, {
      play: () => {
        if (audioRef.current) {
          void audioRef.current.play();
          setPlaying(true);
        }
      },
      pause: () => {
        if (audioRef.current) {
          audioRef.current.pause();
          setPlaying(false);
        }
      },
    });
  }, [messageId]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => {
      setDuration(el.duration);
      setLoading(false);
    };
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    const onEnded = () => {
      setPlaying(false);
      notifyAudioEnded(messageId);
    };
    const onError = () => {
      setFailed(true);
      setLoading(false);
    };

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);

    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
    };
  }, [messageId]);

  if (failed) return <MediaUnavailable kind="Áudio" className="h-12 w-60" />;

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      notifyAudioStarted(messageId);
      void el.play();
      setPlaying(true);
    }
  };

  const cycleRate = () => {
    const next = (rateIdx + 1) % RATES.length;
    setRateIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = RATES[next]!;
  };

  const seek = (value: number) => {
    if (audioRef.current) audioRef.current.currentTime = value;
    setCurrent(value);
  };

  return (
    <div className="flex w-full min-w-[250px] max-w-[320px] items-center gap-2.5 py-1 select-none">
      <audio ref={audioRef} src={mediaSrc(messageId)} preload="metadata" />

      {/* Botão de Play / Pause / Carregando */}
      <button
        type="button"
        aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
        onClick={toggle}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95",
          isOutbound
            ? "hover:opacity-90"
            : "hover:opacity-90",
        )}
      >
        {loading ? (
          <Image src="/loading.svg" alt="Carregando" width={24} height={24} className="animate-spin opacity-80" />
        ) : playing ? (
          <Image src="/pause.svg" alt="Pausar" width={22} height={24} />
        ) : (
          <Image src="/play.svg" alt="Play" width={22} height={24} className="ml-0.5" />
        )}
      </button>

      {/* Linha do tempo e tempos formatados */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          type="range"
          aria-label="Progresso do áudio"
          aria-valuetext={`${fmt(current)} de ${fmt(safeDuration)}`}
          min="0"
          max={String(safeDuration || 1)}
          step="0.1"
          value={current}
          onChange={(e) => seek(Number(e.target.value))}
          className="h-1 w-full cursor-pointer accent-current opacity-80 hover:opacity-100 transition-opacity"
        />
        <div className="flex items-center justify-between text-[10px] tabular-nums font-medium opacity-75 px-0.5">
          <span>{fmt(current)}</span>
          <span>{fmt(safeDuration)}</span>
        </div>
      </div>

      {/* Bloco do Usuário: Avatar com Microfone OU Controle de Velocidade dinâmico */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center">
        {playing ? (
          <button
            type="button"
            aria-label={`Velocidade de reprodução: ${RATES[rateIdx]}x`}
            onClick={cycleRate}
            className={cn(
              "flex h-7 px-2 items-center justify-center rounded-full text-[11px] font-bold tabular-nums transition-all shadow-sm animate-in fade-in zoom-in-90 duration-150",
              isOutbound
                ? "bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30 border border-primary-foreground/30"
                : "bg-foreground/10 text-foreground hover:bg-foreground/20 border border-foreground/20",
            )}
          >
            {(RATES[rateIdx] ?? 1).toFixed(1).replace(".0", "")}x
          </button>
        ) : (
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
            {isOutbound ? (
              sentVia === "ai" ? (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600/90 text-white shadow-sm ring-1 ring-white/20">
                  <Robot size={20} weight="duotone" aria-hidden />
                </div>
              ) : (
                <Avatar className="h-10 w-10 shrink-0 ring-1 ring-border/50">
                  {user?.avatar_url && (
                    <AvatarImage src={user.avatar_url} alt="" className="object-cover" />
                  )}
                  <AvatarFallback className="text-[11px] font-semibold">
                    {user?.full_name ? user.full_name.slice(0, 2).toUpperCase() : "EU"}
                  </AvatarFallback>
                </Avatar>
              )
            ) : (
              <Avatar className="h-10 w-10 shrink-0 ring-1 ring-border/50">
                {contactId && (
                  <AvatarImage
                    src={`/api/v1/contacts/${contactId}/avatar`}
                    alt=""
                    className="object-cover"
                  />
                )}
                <AvatarFallback className="bg-muted-foreground/20 text-[11px] font-semibold">
                  WA
                </AvatarFallback>
              </Avatar>
            )}

            {/* Ícone de Microfone sobreposto */}
            <Image
              src="/microfone.svg"
              alt=""
              width={14}
              height={18}
              aria-hidden
              className="absolute -bottom-1 -left-1 drop-shadow pointer-events-none select-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}

