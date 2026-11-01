/**
 * ToolApprovalBanner — Fixed banner shown when a tool needs user permission.
 *
 * Displays tool name, args (with sensitive values masked), risk level,
 * and scope selection. Calls onApprove/onDeny with the user's decision.
 */

import React, { memo, useState, useCallback } from 'react';
import { ShieldAlert, Loader, ChevronDown } from 'lucide-react';
import type { IToolApprovalBannerProps, IToolApprovalDecision } from './types.js';

// Reuse category colors from ToolCallCard
const TOOL_CATEGORIES: Record<string, { category: string; color: string }> = {
  read_file: { category: 'File', color: '#3b82f6' },
  write_file: { category: 'File', color: '#3b82f6' },
  edit_file: { category: 'File', color: '#3b82f6' },
  glob: { category: 'File', color: '#3b82f6' },
  grep: { category: 'File', color: '#3b82f6' },
  list_directory: { category: 'File', color: '#3b82f6' },
  bash: { category: 'Shell', color: '#10b981' },
  execute_javascript: { category: 'Code', color: '#10b981' },
  web_search: { category: 'Web', color: '#8b5cf6' },
  web_scrape: { category: 'Web', color: '#8b5cf6' },
  web_fetch: { category: 'Web', color: '#8b5cf6' },
};

function getToolInfo(name: string): { category: string; color: string } {
  return TOOL_CATEGORIES[name] || { category: 'Tool', color: '#6b7280' };
}

const RISK_COLORS: Record<string, string> = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#f97316',
  critical: '#ef4444',
};

type ScopeOption = 'once' | 'session' | 'always' | 'never';

const SCOPE_OPTIONS: Array<{ value: ScopeOption; label: string }> = [
  { value: 'once', label: 'Just this once' },
  { value: 'session', label: 'For this session' },
  { value: 'always', label: 'Always allow' },
  { value: 'never', label: 'Always deny' },
];

function formatArgValue(value: unknown, isSensitive: boolean): string {
  if (isSensitive) return '\u25CF\u25CF\u25CF\u25CF';
  if (typeof value === 'string') {
    return value.length > 120 ? value.slice(0, 117) + '...' : value;
  }
  const str = JSON.stringify(value);
  return str.length > 120 ? str.slice(0, 117) + '...' : str;
}

export const ToolApprovalBanner: React.FC<IToolApprovalBannerProps> = memo(
  ({ request, onApprove, onDeny, isResponding = false, className = '' }) => {
    const [scope, setScope] = useState<ScopeOption>(
      request.suggestedScope === 'persistent' ? 'always' : request.suggestedScope === 'session' ? 'session' : 'once'
    );

    const { category, color } = getToolInfo(request.toolName);
    const riskColor = RISK_COLORS[request.riskLevel] || RISK_COLORS.low;
    const sensitiveSet = new Set(request.sensitiveArgs ?? []);

    const buildDecision = useCallback((approved: boolean): IToolApprovalDecision => ({
      requestId: request.requestId,
      approved,
      scope,
      remember: scope === 'always' || scope === 'never',
    }), [request.requestId, scope]);

    const handleApprove = useCallback(() => {
      onApprove(buildDecision(true));
    }, [onApprove, buildDecision]);

    const handleDeny = useCallback(() => {
      onDeny(buildDecision(false));
    }, [onDeny, buildDecision]);

    // Filter out empty or internal args
    const visibleArgs = Object.entries(request.args).filter(
      ([key]) => !key.startsWith('_')
    );

    return (
      <div className={`tool-approval-banner ${className}`}>
        <div className="tool-approval-banner__header">
          <div className="tool-approval-banner__icon" style={{ color: riskColor }}>
            <ShieldAlert size={18} />
          </div>
          <div className="tool-approval-banner__title">
            <span className="tool-approval-banner__category" style={{ color }}>
              {category}
            </span>
            <span className="tool-approval-banner__tool-name">
              {request.toolName}
            </span>
            <span className="tool-approval-banner__label">needs approval</span>
          </div>
          <span
            className="tool-approval-banner__risk-badge"
            style={{ backgroundColor: riskColor }}
          >
            {request.riskLevel}
          </span>
        </div>

        {request.approvalMessage && (
          <div className="tool-approval-banner__message">
            {request.approvalMessage}
          </div>
        )}

        {request.description && (
          <div className="tool-approval-banner__description">
            {request.description}
          </div>
        )}

        {visibleArgs.length > 0 && (
          <div className="tool-approval-banner__args">
            {visibleArgs.slice(0, 5).map(([key, value]) => (
              <div key={key} className="tool-approval-banner__arg">
                <span className="tool-approval-banner__arg-key">{key}:</span>
                <span className={`tool-approval-banner__arg-value${sensitiveSet.has(key) ? ' tool-approval-banner__arg-value--sensitive' : ''}`}>
                  {formatArgValue(value, sensitiveSet.has(key))}
                </span>
              </div>
            ))}
            {visibleArgs.length > 5 && (
              <div className="tool-approval-banner__arg tool-approval-banner__arg--more">
                +{visibleArgs.length - 5} more arguments
              </div>
            )}
          </div>
        )}

        <div className="tool-approval-banner__actions">
          <div className="tool-approval-banner__scope-select">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as ScopeOption)}
              disabled={isResponding}
              className="tool-approval-banner__scope-dropdown"
            >
              {SCOPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown size={12} className="tool-approval-banner__scope-chevron" />
          </div>

          <div className="tool-approval-banner__buttons">
            <button
              className="tool-approval-banner__btn tool-approval-banner__btn--deny"
              onClick={handleDeny}
              disabled={isResponding}
            >
              Deny
            </button>
            <button
              className="tool-approval-banner__btn tool-approval-banner__btn--allow"
              onClick={handleApprove}
              disabled={isResponding}
            >
              {isResponding ? (
                <Loader size={14} className="tool-approval-banner__spinner" />
              ) : null}
              Allow
            </button>
          </div>
        </div>
      </div>
    );
  },
);

ToolApprovalBanner.displayName = 'ToolApprovalBanner';

export default ToolApprovalBanner;
