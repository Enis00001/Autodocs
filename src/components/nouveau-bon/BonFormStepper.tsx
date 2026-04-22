import { User, Car, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: 1 as const, label: "Client", short: "1", icon: User },
  { id: 2 as const, label: "Véhicule", short: "2", icon: Car },
  { id: 3 as const, label: "Règlement", short: "3", icon: Wallet },
];

export function computeBonStep(form: {
  clientNom: string;
  clientPrenom: string;
  clientAdresse: string;
  stockColonnes: string[] | undefined;
}): 1 | 2 | 3 {
  const clientOk =
    Boolean(form.clientNom?.trim()) &&
    Boolean(form.clientPrenom?.trim()) &&
    Boolean(form.clientAdresse?.trim());
  if (!clientOk) return 1;
  const hasVeh = Array.isArray(form.stockColonnes) && form.stockColonnes.length > 0;
  if (!hasVeh) return 2;
  return 3;
}

type BonFormStepperProps = {
  current: 1 | 2 | 3;
  className?: string;
};

export function BonFormStepper({ current, className }: BonFormStepperProps) {
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-2 rounded-card border border-border/60 bg-card/80 p-3 shadow-sm sm:flex-row sm:items-stretch sm:gap-0",
        className,
      )}
      role="navigation"
      aria-label="Progression du bon de commande"
    >
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const isActive = current === s.id;
        const isDone = current > s.id;
        const isLast = i === STEPS.length - 1;
        return (
          <div key={s.id} className="relative flex min-w-0 flex-1 items-center">
            <div
              className={cn(
                "flex w-full min-w-0 items-center gap-2 rounded-input px-2 py-2.5 transition-all duration-200 sm:px-3",
                isActive && "bg-primary/12 ring-1 ring-primary/25",
              )}
            >
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-input font-display text-xs font-bold transition-colors duration-200",
                  isDone && "bg-success/20 text-success",
                  isActive && "bg-primary text-primary-foreground shadow-indigo",
                  !isActive && !isDone && "bg-secondary text-muted-foreground",
                )}
              >
                {isDone ? "✓" : <Icon className="h-4 w-4" aria-hidden />}
              </div>
              <div className="min-w-0 text-left">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Étape {s.short}
                </div>
                <div
                  className={cn(
                    "truncate text-sm font-semibold",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </div>
              </div>
            </div>

            {/* Séparateur : vertical sur mobile, horizontal en ligne dès sm. */}
            {!isLast && (
              <>
                <span
                  className="absolute left-[22px] top-full block h-2 w-px bg-border sm:hidden"
                  aria-hidden
                />
                <span
                  className="mx-1 hidden h-px w-2 shrink-0 self-center bg-border sm:block md:mx-2 md:w-3 lg:w-6"
                  aria-hidden
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
