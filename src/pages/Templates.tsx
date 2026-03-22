import { useEffect, useRef, useState } from "react";
import TopBar from "@/components/layout/TopBar";
import { Trash2 } from "lucide-react";
import type { Template } from "@/utils/templates";
import { loadTemplates, deleteTemplate, seedTemplatesIfEmpty, createTemplate, openTemplateInNewTab } from "@/utils/templates";

const ACCEPT_IMPORT = ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const TemplatesPage = () => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    seedTemplatesIfEmpty().then(setTemplates);
  }, []);

  const openImportDialog = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name;
    const dateStr = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const [header, base64] = dataUrl.split(",");
      const mimeType = header.replace("data:", "").replace(";base64", "").trim();
      await createTemplate(name, dateStr, base64 ?? "", mimeType);
      setTemplates(await loadTemplates());
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Supprimer ce template ?")) return;
    await deleteTemplate(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_IMPORT}
        className="hidden"
        onChange={handleFileChange}
      />
      <TopBar
        title="Templates"
        actions={
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0"
            style={{ boxShadow: "0 0 20px hsla(228,91%,64%,0.25)" }}
            onClick={openImportDialog}
          >
            + Importer un template
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-7">
        <div className="grid grid-cols-3 gap-5">
          {templates.map((t) => (
            <div
              key={t.id}
              role={t.contentBase64 ? "button" : undefined}
              tabIndex={t.contentBase64 ? 0 : undefined}
              className={`card-autodocs flex flex-col gap-3 ${t.contentBase64 ? "cursor-pointer hover:border-primary/50 transition-colors" : ""}`}
              onClick={() => t.contentBase64 && openTemplateInNewTab(t)}
              onKeyDown={(e) => t.contentBase64 && e.key === "Enter" && openTemplateInNewTab(t)}
            >
              <div className="w-full h-24 bg-secondary rounded-lg border border-border flex items-center justify-center text-3xl">
                📋
              </div>
              <div>
                <div className="text-sm font-semibold">{t.name}</div>
                <div className="text-[11px] text-muted-foreground mt-1">Importé le {t.date}</div>
              </div>
              <button
                type="button"
                className="mt-auto flex items-center gap-1.5 text-xs text-destructive hover:text-destructive/80 transition-colors self-start cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(t.id);
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Supprimer
              </button>
            </div>
          ))}

          {/* Add template */}
          <div
            role="button"
            tabIndex={0}
            className="card-autodocs border-dashed flex flex-col items-center justify-center gap-2 text-muted-foreground cursor-pointer hover:border-muted-foreground transition-colors min-h-[200px]"
            onClick={openImportDialog}
            onKeyDown={(e) => e.key === "Enter" && openImportDialog()}
          >
            <span className="text-3xl">＋</span>
            <span className="text-sm">Importer un template</span>
          </div>
        </div>
      </div>
    </>
  );
};

export default TemplatesPage;
