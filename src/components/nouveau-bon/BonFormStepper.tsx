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
    <>
      {/* -------- Mobile : version compacte (numéros + points + lignes) -------- */}
      <div
        className={cn(
          "flex w-full items-center gap-2 rounded-card border border-border/60 bg-card/80 px-3 py-3 shadow-sm md:hidden",
          className,
        )}
        role="navigation"
        aria-label="Progression du bon de commande"
      >
        {STEPS.map((s, i) => {
          const isActive = current === s.id;
          const isDone = current > s.id;
          const isLast = i === STEPS.length - 1;
          return (
            <div key={s.id} className="flex min-w-0 flex-1 items-center">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-xs font-bold transition-colors duration-200",
                  isDone && "bg-success/20 text-success",
                  isActive && "bg-primary text-primary-foreground shadow-indigo",
                  !isActive && !isDone && "bg-secondary text-muted-foreground",
                )}
                aria-current={isActive ? "step" : undefined}
                aria-label={`Étape ${s.short} : ${s.label}`}
              >
                {isDone ? "✓" : s.short}
              </div>
              {!isLast && (
                <span
                  className={cn(
                    "mx-1 h-px flex-1 transition-colors duration-200",
                    isDone ? "bg-success/50" : "bg-border",
                  )}
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>

      {/* -------- Desktop : version complète avec labels -------- */}
      <div
        className={cn(
          "hidden w-full rounded-card border border-border/60 bg-card/80 p-3 shadow-sm md:flex md:items-stretch",
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
                  "flex w-full min-w-0 items-center gap-2 rounded-input px-3 py-2.5 transition-all duration-200",
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
              {!isLast && (
                <span
                  className="mx-2 h-px w-3 shrink-0 self-center bg-border lg:w-6"
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
