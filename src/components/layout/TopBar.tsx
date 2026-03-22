interface TopBarProps {
  title: string;
  actions?: React.ReactNode;
}

const TopBar = ({ title, actions }: TopBarProps) => {
  return (
    <div className="h-[60px] border-b border-border flex items-center justify-between px-7 bg-card shrink-0">
      <h1 className="font-display text-base font-bold">{title}</h1>
      {actions && <div className="flex gap-2.5 items-center">{actions}</div>}
    </div>
  );
};

export default TopBar;
