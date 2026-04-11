import { useEffect, useRef, useState } from "react";
import TopBar from "@/components/layout/TopBar";
import { Trash2 } from "lucide-react";
import type { Template } from "@/utils/templates";
import {
  loadTemplates,
  deleteTemplate,
  seedTemplatesIfEmpty,
  createTemplate,
  openTemplateInNewTab,
} from "@/utils/templates";
import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/auth";

const ACCEPT_IMPORT =
  ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const PDF_STORAGE_BUCKET = "pdf-templates";

type BannerState = { variant: "info" | "success" | "error"; text: string } | null;

const TemplatesPage = () => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [banner, setBanner] = useState<BannerState>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    seedTemplatesIfEmpty().then(setTemplates);
  }, []);

  const openImportDialog = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const dateStr = new Date().toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const [header, base64] = dataUrl.split(",");
        const mimeType = header.replace("data:", "").replace(";base64", "").trim();
        await createTemplate(file.name, dateStr, base64 ?? "", mimeType);
        setTemplates(await loadTemplates());
        setBanner(null);
      };
      reader.readAsDataURL(file);
      return;
    }

    const userId = await getCurrentUserId();
    if (!userId) {
      setBanner({ variant: "error", text: "Vous devez être connecté pour importer un PDF." });
      return;
    }

    const displayName = (
      templateName.trim() ||
      file.name.replace(/\.pdf$/i, "") ||
      file.name
    ).trim();

    setBanner({ variant: "info", text: "Analyse en cours..." });

    try {
      const objectPath = `${userId}/${crypto.randomUUID()}.pdf`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(PDF_STORAGE_BUCKET)
        .upload(objectPath, file, {
          contentType: "application/pdf",
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        const raw = uploadError.message ?? "";
        const low = raw.toLowerCase();
        if (
          low.includes("bucket") ||
          low.includes("not found") ||
          raw.includes("introuvable")
        ) {
          throw new Error(
            'Bucket Storage « pdf-templates » absent. Dans Supabase → SQL Editor, exécutez la section Storage du fichier src/lib/schema.sql (création du bucket + politiques), ou créez manuellement un bucket privé nommé exactement pdf-templates puis réessayez.'
          );
        }
        throw new Error(raw);
      }

      const storagePath = uploadData?.path ?? objectPath;

      const res = await fetch("/api/analyze-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealer_id: userId,
          template_name: displayName,
          storage_path: storagePath,
          pdf_field_names: null,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        row?: { id?: string };
      };
      if (!res.ok) {
        throw new Error(json.error || `Erreur ${res.status}`);
      }

      const pdfTemplateId = json.row?.id;

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error("Lecture du fichier impossible"));
        r.readAsDataURL(file);
      });
      const base64 = dataUrl.split(",")[1] ?? "";

      setBanner({ variant: "success", text: "Template analysé et sauvegardé" });
      await createTemplate(displayName, dateStr, base64, "application/pdf", pdfTemplateId);
      setTemplates(await loadTemplates());
    } catch (err: unknown) {
      setBanner({
        variant: "error",
        text: err instanceof Error ? err.message : "Erreur inconnue",
      });
    }
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
      <div className="flex-1 overflow-y-auto p-4 pb-6 md:p-7 md:pb-7">
        <div className="flex flex-col gap-3 mb-5 max-w-xl">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">Nom du template (PDF)</span>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Ex. Bon de commande concession X"
              className="field-input"
            />
          </label>
          {banner && (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                banner.variant === "info"
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : banner.variant === "success"
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
              role="status"
            >
              {banner.text}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
