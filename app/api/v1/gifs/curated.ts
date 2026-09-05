import type { GiphyGifItem } from "./route";

export interface CuratedGif extends GiphyGifItem {
  tags: string[];
}

export const CURATED_GIFS: CuratedGif[] = [
  // Em Alta / Geral
  {
    id: "curated-1",
    title: "Minions Celebration",
    preview_url: "https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif",
    url: "https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["alta", "celebration", "comemoracao", "festa", "minions"],
  },
  {
    id: "curated-2",
    title: "Thumbs Up Kid",
    preview_url: "https://media.giphy.com/media/111ebonMs90YLu/giphy.gif",
    url: "https://media.giphy.com/media/111ebonMs90YLu/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["alta", "joinha", "thumbs up", "beleza", "ok", "show"],
  },
  {
    id: "curated-3",
    title: "Leonardo DiCaprio Cheers",
    preview_url: "https://media.giphy.com/media/GCLlQnV7dXZ2E/giphy.gif",
    url: "https://media.giphy.com/media/GCLlQnV7dXZ2E/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["alta", "cheers", "brinde", "parabens", "top"],
  },
  {
    id: "curated-4",
    title: "Clapping Applause",
    preview_url: "https://media.giphy.com/media/nbvFVPiEiJH6JOGIok/giphy.gif",
    url: "https://media.giphy.com/media/nbvFVPiEiJH6JOGIok/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["alta", "palmas", "applause", "parabens", "bravo"],
  },
  {
    id: "curated-5",
    title: "High Five",
    preview_url: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
    url: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["alta", "high five", "tamo junto", "parabens", "bora"],
  },
  {
    id: "curated-6",
    title: "Success Kid",
    preview_url: "https://media.giphy.com/media/nXxOjZrbnbRxS/giphy.gif",
    url: "https://media.giphy.com/media/nXxOjZrbnbRxS/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["alta", "sucesso", "yes", "consegui", "vitoria", "bora"],
  },
  {
    id: "curated-7",
    title: "Travolta Confused",
    preview_url: "https://media.giphy.com/media/g01ZnwAUvutuK8GIQn/giphy.gif",
    url: "https://media.giphy.com/media/g01ZnwAUvutuK8GIQn/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["alta", "confuso", "travolta", "cade", "duvida"],
  },
  {
    id: "curated-8",
    title: "Popcorn Watching",
    preview_url: "https://media.giphy.com/media/gl0mkIZOW6Nwc/giphy.gif",
    url: "https://media.giphy.com/media/gl0mkIZOW6Nwc/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["alta", "pipoca", "assistindo", "curioso"],
  },

  // Haha / Risada
  {
    id: "curated-9",
    title: "Laughing Out Loud",
    preview_url: "https://media.giphy.com/media/10JhviFuU2gWD6/giphy.gif",
    url: "https://media.giphy.com/media/10JhviFuU2gWD6/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["haha", "risada", "lol", "engracado", "rindo", "humor"],
  },
  {
    id: "curated-10",
    title: "Cat Laughing",
    preview_url: "https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif",
    url: "https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["haha", "gato", "cat", "risada", "fofo"],
  },
  {
    id: "curated-11",
    title: "Steve Carell Laughing",
    preview_url: "https://media.giphy.com/media/1d5Zn8FqmJqApu4hNU/giphy.gif",
    url: "https://media.giphy.com/media/1d5Zn8FqmJqApu4hNU/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["haha", "office", "steve carell", "gargalhada", "risada"],
  },
  {
    id: "curated-12",
    title: "Crying Laughing",
    preview_url: "https://media.giphy.com/media/lszAB3TzFtDxUOFgz0/giphy.gif",
    url: "https://media.giphy.com/media/lszAB3TzFtDxUOFgz0/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["haha", "rindo muito", "chorei de rir", "risos"],
  },

  // Obrigado / Thank You
  {
    id: "curated-13",
    title: "Thank You Very Much",
    preview_url: "https://media.giphy.com/media/osjgQPWRx3cac/giphy.gif",
    url: "https://media.giphy.com/media/osjgQPWRx3cac/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["obrigado", "thank you", "agradecido", "valeu", "gratidao"],
  },
  {
    id: "curated-14",
    title: "Thank You with Flowers",
    preview_url: "https://media.giphy.com/media/3oEdva9BUHPIs2SkGk/giphy.gif",
    url: "https://media.giphy.com/media/3oEdva9BUHPIs2SkGk/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["obrigado", "flores", "gentil", "valeu"],
  },
  {
    id: "curated-15",
    title: "Grateful Heart",
    preview_url: "https://media.giphy.com/media/26gsjCZpPolPr3sBy/giphy.gif",
    url: "https://media.giphy.com/media/26gsjCZpPolPr3sBy/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["obrigado", "gratidao", "muito obrigado", "valeu"],
  },

  // Parabéns / Celebration
  {
    id: "curated-16",
    title: "Happy Birthday / Parabens",
    preview_url: "https://media.giphy.com/media/qx8pi39Lwm9Xm2audb/giphy.gif",
    url: "https://media.giphy.com/media/qx8pi39Lwm9Xm2audb/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["parabens", "aniversario", "congrats", "felicidades"],
  },
  {
    id: "curated-17",
    title: "Celebration Dance",
    preview_url: "https://media.giphy.com/media/g5R9dok94mrIvplmZd/giphy.gif",
    url: "https://media.giphy.com/media/g5R9dok94mrIvplmZd/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["parabens", "vitoria", "comemorar", "festa"],
  },

  // Joinha / Thumbs Up
  {
    id: "curated-18",
    title: "Borat Great Success",
    preview_url: "https://media.giphy.com/media/Od0QRnzwRBYmDU3eEO/giphy.gif",
    url: "https://media.giphy.com/media/Od0QRnzwRBYmDU3eEO/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["joinha", "beleza", "aprovado", "otimo", "perfeito"],
  },
  {
    id: "curated-19",
    title: "Thumbs Up Cool",
    preview_url: "https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif",
    url: "https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["joinha", "positivo", "confirmado", "ok"],
  },

  // Bora / Let's Go
  {
    id: "curated-20",
    title: "Let's Go Bora",
    preview_url: "https://media.giphy.com/media/11sBLVxNs7v6WA/giphy.gif",
    url: "https://media.giphy.com/media/11sBLVxNs7v6WA/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["bora", "lets go", "animado", "vamos", "foco"],
  },
  {
    id: "curated-21",
    title: "Ready to Work",
    preview_url: "https://media.giphy.com/media/tZCkL6BsL2AAo/giphy.gif",
    url: "https://media.giphy.com/media/tZCkL6BsL2AAo/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["bora", "trabalho", "focado", "produzindo"],
  },

  // Coração / Amor
  {
    id: "curated-22",
    title: "Love Hearts",
    preview_url: "https://media.giphy.com/media/26BRv0ThflsHCqDrG/giphy.gif",
    url: "https://media.giphy.com/media/26BRv0ThflsHCqDrG/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["coracao", "amor", "love", "carinho", "amizade"],
  },
  {
    id: "curated-23",
    title: "Sending Love",
    preview_url: "https://media.giphy.com/media/l4pTdcifPZLpDjL1e/giphy.gif",
    url: "https://media.giphy.com/media/l4pTdcifPZLpDjL1e/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["coracao", "beijo", "abraco", "afeto"],
  },

  // Dança / Dance
  {
    id: "curated-24",
    title: "Carlton Dance",
    preview_url: "https://media.giphy.com/media/pa37AAGzKXoek/giphy.gif",
    url: "https://media.giphy.com/media/pa37AAGzKXoek/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["danca", "dance", "carlton", "alegria", "festa"],
  },
  {
    id: "curated-25",
    title: "Snoopy Dance",
    preview_url: "https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif",
    url: "https://media.giphy.com/media/blSTtZehjAZ8I/giphy.mp4",
    is_mp4: true,
    width: 200,
    height: 200,
    tags: ["danca", "snoopy", "feliz", "dancando"],
  },
];

export function searchCuratedGifs(query: string, limit = 24): GiphyGifItem[] {
  const cleanQ = query.trim().toLowerCase();
  if (!cleanQ) {
    return CURATED_GIFS.slice(0, limit);
  }

  const terms = cleanQ.split(/\s+/).filter(Boolean);
  const matched = CURATED_GIFS.filter((gif) => {
    const titleMatch = gif.title.toLowerCase().includes(cleanQ);
    const tagMatch = terms.some((term) =>
      gif.tags.some((t) => t.toLowerCase().includes(term)),
    );
    return titleMatch || tagMatch;
  });

  return (matched.length > 0 ? matched : CURATED_GIFS).slice(0, limit);
}
