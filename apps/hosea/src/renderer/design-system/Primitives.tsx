import React from 'react';
import { ArrowUpRight } from 'lucide-react';

export function Surface({ children, className = '', ...props }: React.HTMLAttributes<HTMLElement>): React.ReactElement {
  return <section className={`h-surface ${className}`} {...props}>{children}</section>;
}

export function ActionCard({ icon, title, description, onClick }: {
  icon: React.ReactNode; title: string; description: string; onClick: () => void;
}): React.ReactElement {
  return <button className="h-action-card" type="button" onClick={onClick}>
    <span className="h-action-card__icon">{icon}</span><ArrowUpRight size={15} className="h-action-card__arrow" />
    <strong>{title}</strong><span>{description}</span>
  </button>;
}

export function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }): React.ReactElement {
  return <div className="h-setting-row"><div><h3>{title}</h3><p>{description}</p></div><div className="h-setting-row__control">{children}</div></div>;
}
