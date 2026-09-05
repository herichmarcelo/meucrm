"use client";
import { useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { MediaUnavailable } from "./MediaUnavailable";
import { mediaSrc } from "./media-utils";

/** Vídeo inline com controles nativos (padrão WhatsApp Web) ou loop silencioso se GIF. */
export function VideoMedia({
  messageId,
  isGifPlayback = false,
}: {
  messageId: string;
  isGifPlayback?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative w-full max-w-sm aspect-video overflow-hidden rounded-lg bg-black/5">
      {failed ? (
        <MediaUnavailable kind={isGifPlayback ? "GIF" : "Vídeo"} className="h-full w-full" />
      ) : (
        <>
          {!ready && <Skeleton className="absolute inset-0 h-full w-full" />}
          {isGifPlayback ? (
            <video
              src={mediaSrc(messageId)}
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              onLoadedData={() => setReady(true)}
              onLoadedMetadata={() => setReady(true)}
              onError={() => setFailed(true)}
              className="h-full w-full object-contain"
            />
          ) : (
            <video
              src={mediaSrc(messageId)}
              controls
              preload="metadata"
              onLoadedMetadata={() => setReady(true)}
              onError={() => setFailed(true)}
              className="h-full w-full object-contain"
            />
          )}
        </>
      )}
    </div>
  );
}
