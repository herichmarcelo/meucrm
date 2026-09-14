"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Palette } from "@/lib/ui/icons";
import {
  useUpdateConversationTags,
  useConversationTagVocabulary,
} from "@/hooks/inbox/useConversationTags";
import { useOrganizationTags, useUpsertTag } from "@/hooks/inbox/useTags";
import { TagChip } from "@/components/tags/TagChip";
import { TagColorSelector } from "@/components/tags/TagColorSelector";

interface Props {
  conversationId: string;
  orgId: string;
  tags: string[];
}

/** G3-05: aplica/remove tags de atendimento na conversa, com sugestão canônica e cores por definição. */
export function ConversationTagsEditor({ conversationId, orgId, tags }: Props) {
  const [draft, setDraft] = useState("");
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [editingTag, setEditingTag] = useState<string | null>(null);

  const mutation = useUpdateConversationTags();
  const upsertTag = useUpsertTag();
  const { data: vocabulary } = useConversationTagVocabulary(orgId);
  const { getTagColor } = useOrganizationTags(orgId);

  // Normalização espelha o Zod do PATCH (trim+lowercase); dedup no set.
  function apply(next: string[]) {
    mutation.mutate({ conversation_id: conversationId, tags: next });
  }

  function add(raw: string) {
    const tag = raw.trim().toLowerCase().slice(0, 40);
    if (!tag || tags.includes(tag) || tags.length >= 20) return;

    // Se uma cor foi escolhida para a tag, persiste a definição para a organização
    if (selectedColor) {
      upsertTag.mutate({ name: tag, color: selectedColor });
    }

    apply([...tags, tag]);
    setDraft("");
    setSelectedColor(null);
    setShowColorPicker(false);
  }

  function remove(tag: string) {
    apply(tags.filter((t) => t !== tag));
    if (editingTag === tag) setEditingTag(null);
  }

  function handleUpdateTagColor(tag: string, newColor: string | null) {
    upsertTag.mutate({ name: tag, color: newColor });
    setEditingTag(null);
  }

  const suggestions = (vocabulary ?? []).filter((t) => !tags.includes(t)).slice(0, 8);

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tags da conversa
        </h3>
        {editingTag && (
          <button
            type="button"
            onClick={() => setEditingTag(null)}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Cancelar edição de cor
          </button>
        )}
      </div>

      {/* Editor de cor de tag existente */}
      {editingTag && (
        <div className="mt-2 rounded-md border border-border bg-muted/30 p-2">
          <p className="text-[11px] font-medium text-foreground">
            Alterar cor de: <span className="font-semibold">{editingTag}</span>
          </p>
          <TagColorSelector
            selectedColor={getTagColor(editingTag)}
            onSelectColor={(color) => handleUpdateTagColor(editingTag, color)}
            disabled={upsertTag.isPending}
            className="mt-1"
          />
        </div>
      )}

      {/* Lista de chips da conversa */}
      <div className="mt-2 flex flex-wrap gap-1">
        {tags.length > 0 ? (
          tags.map((t) => (
            <div
              key={t}
              className="inline-flex items-center"
              onDoubleClick={() => setEditingTag(t)}
              title="Dê duplo clique para editar a cor da tag"
            >
              <TagChip
                tag={t}
                color={getTagColor(t)}
                size="md"
                onRemove={() => remove(t)}
                disabled={mutation.isPending}
              />
            </div>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">Sem tags.</span>
        )}
      </div>

      {/* Seletor visual de cor para a nova tag */}
      {showColorPicker && (
        <div className="mt-2 rounded-md border border-border bg-muted/20 p-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Escolha a cor da nova tag:</span>
            <button
              type="button"
              onClick={() => setShowColorPicker(false)}
              className="text-[10px] hover:text-foreground"
            >
              Fechar
            </button>
          </div>
          <TagColorSelector
            selectedColor={selectedColor}
            onSelectColor={setSelectedColor}
            className="mt-1"
          />
        </div>
      )}

      {/* Campo Nova tag... */}
      <div className="mt-2 flex gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
          }}
          placeholder="Nova tag…"
          maxLength={40}
          disabled={mutation.isPending || tags.length >= 20}
          className="h-7 text-xs"
          aria-label="Adicionar tag à conversa"
        />
        <Button
          type="button"
          size="sm"
          variant={showColorPicker ? "secondary" : "outline"}
          className="h-7 px-2"
          onClick={() => setShowColorPicker((prev) => !prev)}
          title="Escolher cor da tag"
          aria-label="Escolher cor da tag"
        >
          <Palette size={12} weight="regular" aria-hidden />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() => add(draft)}
          disabled={mutation.isPending || !draft.trim() || tags.length >= 20}
          aria-label="Adicionar tag"
        >
          <Plus size={12} weight="regular" aria-hidden />
        </Button>
      </div>

      {/* Sugestões canônicas */}
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {suggestions.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => add(t)}
              disabled={mutation.isPending || tags.length >= 20}
              className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-solid hover:text-foreground disabled:opacity-50"
            >
              + {t}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
