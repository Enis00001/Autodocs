interface TopBarProps {
  title: string;
  actions?: React.ReactNode;
}

const TopBar = ({ title, actions }: TopBarProps) => {
  return (
    <div className="h-[64px] border-b border-border/70 flex items-center justify-between px-5 md:px-7 glass-surface shrink-0 sticky top-0 z-30">
      <h1 className="font-display text-base md:text-[17px] font-bold tracking-tight">{title}</h1>
      {actions && <div className="flex gap-2.5 items-center">{actions}</div>}
    </div>
  );
};

export default TopBar;
