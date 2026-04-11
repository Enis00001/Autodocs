import { Link } from "react-router-dom";
import type { PdfTemplateRow } from "@/utils/pdfTemplates";

type TemplateSelectorProps = {
  templates: PdfTemplateRow[];
  loading: boolean;
  selectedTemplateId: string;
  onChangeTemplate: (id: string) => void;
  /** Des entrées existent dans la table `templates`, mais aucun PDF analysé (`pdf_templates`). */
  libraryEntriesButNoAnalyzedPdf?: boolean;
};

const TemplateSelector = ({
  templates,
  loading,
  selectedTemplateId,
  onChangeTemplate,
  libraryEntriesButNoAnalyzedPdf = false,
}: TemplateSelectorProps) => {
  if (loading) {
    return (
      <div className="card-autodocs col-span-2">
        <div className="mb-4">
          <span className="card-title-autodocs">📄 Template bon de commande</span>
        </div>
        <p className="text-sm text-muted-foreground">Chargement des templates…</p>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="card-autodocs col-span-2">
        <div className="mb-4">
          <span className="card-title-autodocs">📄 Template bon de commande</span>
        </div>
        <div className="text-sm text-destructive/90 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 space-y-2">
          {libraryEntriesButNoAnalyzedPdf ? (
            <>
              <p>
                Des fiches apparaissent dans <strong>Templates</strong>, mais la génération du bon
                utilise uniquement les PDF <strong>analysés</strong> (table{" "}
                <code className="text-xs opacity-90">pdf_templates</code>
                ). Les modèles d’exemple ou les fichiers Word ne suffisent pas.
              </p>
              <p>
                Si l’erreur indique <code className="text-xs opacity-90">pdf_templates</code>{" "}
                introuvable : exécutez{" "}
                <code className="text-xs opacity-90">src/lib/sql_create_pdf_templates.sql</code> dans
                Supabase → SQL Editor. Si « Bucket not found » : section Storage dans{" "}
                <code className="text-xs opacity-90">src/lib/schema.sql</code>.
              </p>
              <p>
                Ensuite importez un <strong>.pdf</strong> depuis{" "}
                <Link to="/templates" className="underline font-medium text-primary hover:text-primary/90">
                  Templates
                </Link>{" "}
                et attendez la fin de l’analyse.
              </p>
            </>
          ) : (
            <p>
              Aucun template PDF analysé — uploader un fichier <strong>.pdf</strong> dans la section{" "}
              <Link to="/templates" className="underline font-medium text-primary hover:text-primary/90">
                Templates
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card-autodocs col-span-2">
      <div className="mb-4">
        <span className="card-title-autodocs">📄 Template bon de commande</span>
      </div>

      <div className="flex flex-wrap gap-3">
        {templates.map((t) => (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            onClick={() => onChangeTemplate(t.id)}
            onKeyDown={(e) => e.key === "Enter" && onChangeTemplate(t.id)}
            className={`flex-1 min-w-[140px] p-3.5 border-2 rounded-[10px] cursor-pointer transition-all duration-150 flex items-center gap-3 ${
              selectedTemplateId === t.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground"
            }`}
          >
            <div className="w-9 h-11 bg-secondary rounded border border-border flex items-center justify-center text-lg shrink-0">
              📋
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold truncate">{t.template_name}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                PDF analysé
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

        <Link
          to="/templates"
          className="flex-1 min-w-[140px] p-3.5 border-2 border-dashed border-border rounded-[10px] cursor-pointer hover:border-muted-foreground transition-colors flex flex-col items-center justify-center gap-1.5 text-muted-foreground no-underline"
        >
          <span className="text-[22px]">＋</span>
          <span className="text-xs text-center">Ajouter un template (page Templates)</span>
        </Link>
      </div>
    </div>
  );
};

export default TemplateSelector;
