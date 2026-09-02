import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock do requireRole para autorizar a requisição
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn().mockResolvedValue({
    ok: true,
    user: { id: "user-1" },
    org: { orgId: "org-1" },
  }),
}));

// Mock do @giphy/js-fetch-api
const mockSearch = vi.fn();
const mockTrending = vi.fn();

vi.mock("@giphy/js-fetch-api", () => ({
  GiphyFetch: class {
    search = mockSearch;
    trending = mockTrending;
  },
}));

import { GET } from "@/app/api/v1/gifs/route";

describe("GET /api/v1/gifs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GIPHY_API_KEY;
  });

  it("retorna lista de GIFs curados em fallback quando GIPHY_API_KEY não está setada", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/gifs?limit=10");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toBeDefined();
    expect(json.data.length).toBeGreaterThan(0);
    expect(json.meta?.is_fallback).toBe(true);
  });

  it("executa busca no Giphy via SDK quando GIPHY_API_KEY está configurada", async () => {
    process.env.GIPHY_API_KEY = "test_key_123";

    mockSearch.mockResolvedValueOnce({
      data: [
        {
          id: "gif-2",
          title: "Dog Dance",
          images: {
            fixed_width: { url: "https://media.giphy.com/dog_thumb.webp", width: 200, height: 200 },
            fixed_width_downsampled: { url: "https://media.giphy.com/dog_thumb.webp" },
            original: { url: "https://media.giphy.com/dog_full.gif" },
          },
        },
      ],
      pagination: { total_count: 50, count: 1, offset: 0 },
    });

    const req = new NextRequest("http://localhost:3000/api/v1/gifs?q=dog&limit=15&offset=5");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toBeDefined();
    expect(json.data[0].id).toBe("gif-2");
    expect(json.meta?.is_fallback).toBe(false);
    expect(mockSearch).toHaveBeenCalledWith("dog", {
      limit: 15,
      offset: 5,
      lang: "pt",
      rating: "g",
      sort: "relevant",
    });
  });
});
