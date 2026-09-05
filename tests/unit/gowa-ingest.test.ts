import { describe, expect, it } from "vitest";
import { parseChatIdGowa, dispatchGowaEvent } from "@/lib/gowa/ingest";

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

describe("dispatchGowaEvent - filtros de grupo e broadcast", () => {
  const session = {
    id: "sess_1",
    organization_id: "org_1",
    gowa_device_id: "dev_1",
  };

  const dummyAdmin = {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: () => ({
      insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
  } as unknown as Parameters<typeof dispatchGowaEvent>[0];

  it("descarta mensagem de grupo onde chat_id é @g.us e from é o autor individual", async () => {
    const envelope = {
      event: "message",
      payload: {
        id: "MSG_GROUP_1",
        chat_id: "1203630248472910@g.us",
        from: "5511999998888@s.whatsapp.net",
        from_name: "Participante",
        body: "Oi grupo",
        is_from_me: false,
      },
    };

    const res = await dispatchGowaEvent(dummyAdmin, session, envelope, "req-1");
    expect(res.processed).toBe(false);
    expect(res.reason).toBe("group_message_ignored");
  });

  it("descarta mensagem quando is_group é true", async () => {
    const envelope = {
      event: "message",
      payload: {
        id: "MSG_GROUP_2",
        is_group: true,
        from: "5511999998888@s.whatsapp.net",
        body: "Mensagem em grupo",
        is_from_me: false,
      },
    };

    const res = await dispatchGowaEvent(dummyAdmin, session, envelope, "req-2");
    expect(res.processed).toBe(false);
    expect(res.reason).toBe("group_message_ignored");
  });

  it("descarta transmissões e newsletters (@broadcast e @newsletter)", async () => {
    const envelopeBroadcast = {
      event: "message",
      payload: {
        id: "MSG_BC_1",
        chat_id: "status@broadcast",
        from: "5511999998888@s.whatsapp.net",
        body: "Status",
        is_from_me: false,
      },
    };

    const resBc = await dispatchGowaEvent(dummyAdmin, session, envelopeBroadcast, "req-3");
    expect(resBc.processed).toBe(false);
    expect(resBc.reason).toBe("broadcast_ignored");

    const envelopeNewsletter = {
      event: "message",
      payload: {
        id: "MSG_NL_1",
        chat_id: "120363123456789@newsletter",
        from: "5511999998888@s.whatsapp.net",
        body: "Canal",
        is_from_me: false,
      },
    };

    const resNl = await dispatchGowaEvent(dummyAdmin, session, envelopeNewsletter, "req-4");
    expect(resNl.processed).toBe(false);
    expect(resNl.reason).toBe("broadcast_ignored");
  });
});
