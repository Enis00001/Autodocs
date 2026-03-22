import { useRef, useState, useEffect } from "react";
import { loadTemplates, seedTemplatesIfEmpty, createTemplate } from "@/utils/templates";
import type { Template } from "@/utils/templates";

const ACCEPT_IMPORT =
  ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type TemplateSelectorProps = {
  selectedTemplateId: string;
  onChangeTemplate: (id: string) => void;
};

const TemplateSelector = ({ selectedTemplateId, onChangeTemplate }: TemplateSelectorProps) => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    seedTemplatesIfEmpty().then(setTemplates);
  }, []);

  // Si l’ID sélectionné n’existe plus dans la liste (ex. ancien "1"), sélectionner le premier template
  useEffect(() => {
    if (
      templates.length > 0 &&
      !templates.some((t) => t.id === selectedTemplateId)
    ) {
      onChangeTemplate(templates[0].id);
    }
  }, [templates, selectedTemplateId, onChangeTemplate]);

  const openImportDialog = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name;
    const dateStr = new Date().toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const [header, base64] = dataUrl.split(",");
      const mimeType = header.replace("data:", "").replace(";base64", "").trim();
      const created = await createTemplate(name, dateStr, base64 ?? "", mimeType);
      setTemplates(await loadTemplates());
      onChangeTemplate(created.id);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="card-autodocs col-span-2">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_IMPORT}
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="mb-4">
        <span className="card-title-autodocs">📄 Template bon de commande</span>
      </div>

      <div className="flex gap-3">
        {templates.map((t) => (
          <div
            key={t.id}
            onClick={() => onChangeTemplate(t.id)}
            className={`flex-1 p-3.5 border-2 rounded-[10px] cursor-pointer transition-all duration-150 flex items-center gap-3 ${
              selectedTemplateId === t.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground"
            }`}
          >
            <div className="w-9 h-11 bg-secondary rounded border border-border flex items-center justify-center text-lg shrink-0">
              📋
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold">{t.name}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {t.contentBase64 ? `Importé le ${t.date}` : `Template par défaut · ${t.date}`}
              </div>
            </div>
            <div
              className={`w-4 h-4 rounded-full border-2 shrink-0 transition-all ${
                selectedTemplateId === t.id
                  ? "border-primary bg-primary shadow-[0_0_8px_hsla(228,91%,64%,0.5)]"
                  : "border-border"
              }`}
            />
          </div>
        ))}

        {/* Add template card */}
        <div
          role="button"
          tabIndex={0}
          className="flex-1 p-3.5 border-2 border-dashed border-border rounded-[10px] cursor-pointer hover:border-muted-foreground transition-colors flex flex-col items-center justify-center gap-1.5 text-muted-foreground"
          onClick={openImportDialog}
          onKeyDown={(e) => e.key === "Enter" && openImportDialog()}
        >
          <span className="text-[22px]">＋</span>
          <span className="text-xs">Importer un template</span>
        </div>
      </div>
    </div>
  );
};

export default TemplateSelector;
