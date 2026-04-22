interface TopBarProps {
  title: string;
  /** Sous-titre optionnel (desktop). */
  subtitle?: string;
  actions?: React.ReactNode;
}

const TopBar = ({ title, subtitle, actions }: TopBarProps) => {
  return (
    <div className="sticky top-0 z-30 flex h-[64px] shrink-0 items-center justify-between border-b border-border/60 px-4 md:px-7 glass-surface">
      <div className="min-w-0 md:pl-0">
        <h1 className="font-display text-base font-bold tracking-tight text-foreground md:text-[17px]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{subtitle}</p>
        ) : null}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
};

export default TopBar;
