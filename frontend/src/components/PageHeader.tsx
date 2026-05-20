/**
 * WMS Kiwkiw - PageHeader
 * Cabeçalho padronizado para todas as páginas internas.
 */

import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, icon, actions }: PageHeaderProps) {
  return (
    <div
      className="flex items-center justify-between flex-wrap gap-3 px-6 pt-6 pb-4 border-b"
      style={{ borderColor: 'rgba(255,255,255,0.06)' }}
    >
      <div className="flex items-center gap-3">
        {icon && (
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(123,99,232,0.15)', border: '1px solid rgba(123,99,232,0.20)' }}
          >
            <span style={{ color: '#9B87F0' }}>{icon}</span>
          </div>
        )}
        <div>
          <h1 className="text-lg font-bold text-white leading-tight">{title}</h1>
          {subtitle && (
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.40)' }}>{subtitle}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-wrap">{actions}</div>
      )}
    </div>
  );
}
