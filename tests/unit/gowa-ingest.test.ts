import { describe, expect, it } from "vitest";
import { parseChatIdGowa } from "@/lib/gowa/ingest";

describe("parseChatIdGowa", () => {
  it("identifica chatId de número comum", () => {
    const res = parseChatIdGowa("5511999999999@s.whatsapp.net");
    expect(res.kind).toBe("phone");
    if (res.kind === "phone") {
      expect(res.phone).toBe("+5511999999999");
    }
  });

  it("identifica chatId no formato legado @c.us", () => {
    const res = parseChatIdGowa("5511999999999@c.us");
    expect(res.kind).toBe("phone");
    if (res.kind === "phone") {
      expect(res.phone).toBe("+5511999999999");
    }
  });

  it("identifica LID", () => {
    const res = parseChatIdGowa("1234567890@lid");
    expect(res.kind).toBe("lid");
    if (res.kind === "lid") {
      expect(res.lid).toBe("1234567890");
    }
  });

  it("identifica grupos", () => {
    const res = parseChatIdGowa("1203630248472910@g.us");
    expect(res.kind).toBe("group");
  });

  it("identifica chats desconhecidos / inválidos", () => {
    const res = parseChatIdGowa("invalid_format");
    expect(res.kind).toBe("unknown");
  });
});
