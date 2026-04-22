import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

type ErrorBoundaryProps = {
  children: ReactNode;
  /** Fallback personnalisé. Si absent, utilise la page d'erreur par défaut. */
  fallback?: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

/**
 * Error Boundary racine de l'application. Capture les erreurs JS non gérées
 * dans les enfants et affiche une page "Quelque chose s'est mal passé" avec
 * un bouton "Recharger". En dev, on laisse les erreurs remonter dans la
 * console pour faciliter le debug.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // On log en console pour l'observabilité. On pourrait brancher un service
    // externe (Sentry…) ici.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.assign("/");
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-[#0F1117] p-4 text-[#F1F5F9]">
        <div className="w-full max-w-md rounded-card border border-white/[0.08] bg-[#1A1D27] p-6 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <AlertTriangle className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="font-display text-lg font-bold">Quelque chose s'est mal passé</h1>
          <p className="mt-2 text-sm text-[#94A3B8]">
            Une erreur inattendue est survenue. Essayez de recharger la page.
          </p>
          {this.state.error?.message && (
            <pre className="mt-4 max-h-32 overflow-auto rounded-input border border-white/[0.06] bg-[#0F1117] p-3 text-left text-[11px] text-[#94A3B8]">
              {this.state.error.message}
            </pre>
          )}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              className="btn-primary w-full cursor-pointer sm:w-auto"
              onClick={this.handleReload}
            >
              <RefreshCw className="h-4 w-4" />
              Recharger
            </button>
            <button
              type="button"
              className="btn-secondary w-full cursor-pointer sm:w-auto"
              onClick={this.handleGoHome}
            >
              Retour à l'accueil
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
