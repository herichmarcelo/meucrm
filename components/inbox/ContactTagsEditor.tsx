"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Palette } from "@/lib/ui/icons";
import { useUpdateContact } from "@/hooks/contacts/useUpdateContact";
import { useOrganizationTags, useUpsertTag } from "@/hooks/inbox/useTags";
import { TagChip } from "@/components/tags/TagChip";
import { TagColorSelector } from "@/components/tags/TagColorSelector";

interface Props {
  contactId: string;
  tags: string[];
}

/** Edita as tags do CONTATO (distinto de ConversationTagsEditor, que edita as
 * tags da conversa) — aberto pelo botão "Tag" do painel do Inbox. */
export function ContactTagsEditor({ contactId, tags }: Props) {
  const [draft, setDraft] = useState("");
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [editingTag, setEditingTag] = useState<string | null>(null);

  const mutation = useUpdateContact(contactId);
  const upsertTag = useUpsertTag();
  const { getTagColor } = useOrganizationTags();

  function apply(next: string[]) {
    mutation.mutate({ tags: next });
  }

  function add(raw: string) {
    const tag = raw.trim().toLowerCase().slice(0, 40);
    if (!tag || tags.includes(tag) || tags.length >= 20) return;

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

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border p-2">
      {/* Edição de cor de tag existente */}
      {editingTag && (
        <div className="rounded-md border border-border bg-muted/30 p-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-foreground">
              Alterar cor de: <span className="font-semibold">{editingTag}</span>
            </p>
            <button
              type="button"
              onClick={() => setEditingTag(null)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Fechar
            </button>
          </div>
          <TagColorSelector
            selectedColor={getTagColor(editingTag)}
            onSelectColor={(color) => handleUpdateTagColor(editingTag, color)}
            disabled={upsertTag.isPending}
            className="mt-1"
          />
        </div>
      )}

      {/* Lista de tags do contato */}
      <div className="flex flex-wrap gap-1">
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
          <span className="text-xs text-muted-foreground">Sem tags no contato.</span>
        )}
      </div>

      {/* Seletor visual de cor para a nova tag */}
      {showColorPicker && (
        <div className="rounded-md border border-border bg-muted/20 p-2">
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

      <div className="flex gap-1">
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
          aria-label="Adicionar tag ao contato"
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
    </div>
  );
}
