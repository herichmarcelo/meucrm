"use client";

interface AudioCoordinator {
  currentPlayingId: string | null;
  players: Map<string, { play: () => void; pause: () => void }>;
  orderedMessageIds: string[];
}

const coordinator: AudioCoordinator = {
  currentPlayingId: null,
  players: new Map(),
  orderedMessageIds: [],
};

export function registerAudioPlayer(
  messageId: string,
  handlers: { play: () => void; pause: () => void },
) {
  coordinator.players.set(messageId, handlers);
  return () => {
    coordinator.players.delete(messageId);
    if (coordinator.currentPlayingId === messageId) {
      coordinator.currentPlayingId = null;
    }
  };
}

export function notifyAudioStarted(messageId: string) {
  if (coordinator.currentPlayingId && coordinator.currentPlayingId !== messageId) {
    const prev = coordinator.players.get(coordinator.currentPlayingId);
    if (prev) {
      prev.pause();
    }
  }
  coordinator.currentPlayingId = messageId;
}

export function notifyAudioEnded(messageId: string) {
  if (coordinator.currentPlayingId === messageId) {
    coordinator.currentPlayingId = null;
    // Tenta encontrar o próximo áudio na ordem da conversa
    const idx = coordinator.orderedMessageIds.indexOf(messageId);
    if (idx !== -1 && idx + 1 < coordinator.orderedMessageIds.length) {
      const nextId = coordinator.orderedMessageIds[idx + 1];
      if (nextId) {
        const nextPlayer = coordinator.players.get(nextId);
        if (nextPlayer) {
          nextPlayer.play();
        }
      }
    }
  }
}

export function setOrderedAudioIds(ids: string[]) {
  coordinator.orderedMessageIds = ids;
}
