/**
 * PermissionRulesList — Read-only list with toggle/delete.
 * PermissionRulesEditor — Full CRUD editor with inline create/edit form.
 */

import React, { memo, useState, useCallback } from 'react';
import { Trash2, Shield, ShieldCheck, ShieldX, ShieldQuestion, Plus, Pencil, X, Save, ChevronDown } from 'lucide-react';
import type {
  IPermissionRulesListProps,
  IPermissionRulesEditorProps,
  IPermissionRuleInfo,
  INewPermissionRule,
  IConditionFormData,
} from './types.js';

// ============================================================
// Constants
// ============================================================

const ACTION_CONFIG: Record<string, { icon: typeof ShieldCheck; color: string; label: string }> = {
  allow: { icon: ShieldCheck, color: '#10b981', label: 'Allow' },
  deny: { icon: ShieldX, color: '#ef4444', label: 'Deny' },
  ask: { icon: ShieldQuestion, color: '#f59e0b', label: 'Ask' },
};

const OPERATORS: Array<{ value: string; label: string }> = [
  { value: 'starts_with', label: 'starts with' },
  { value: 'not_starts_with', label: 'does not start with' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'matches', label: 'matches regex' },
  { value: 'not_matches', label: 'does not match regex' },
];

/** Common arg names per tool for the dropdown */
const TOOL_ARG_HINTS: Record<string, string[]> = {
  bash: ['command'],
  write_file: ['path', 'content'],
  edit_file: ['path', 'old_string', 'new_string'],
  read_file: ['path'],
  glob: ['pattern', 'path'],
  grep: ['pattern', 'path'],
  list_directory: ['path'],
  web_fetch: ['url'],
  execute_javascript: ['code'],
  custom_tool_test: ['code'],
  '*': ['__toolCategory', '__toolSource', '__toolNamespace'],
};

// ============================================================
// Helpers
// ============================================================

function formatCondition(c: { argName: string; operator: string; value: string }): string {
  const op = c.operator.replace(/_/g, ' ');
  return `${c.argName} ${op} "${c.value}"`;
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ============================================================
// RuleItem — Single rule display row
// ============================================================

const RuleItem: React.FC<{
  rule: IPermissionRuleInfo;
  onToggle?: (ruleId: string, enabled: boolean) => void;
  onDelete?: (ruleId: string) => void;
  onEdit?: (rule: IPermissionRuleInfo) => void;
}> = memo(({ rule, onToggle, onDelete, onEdit }) => {
  const config = ACTION_CONFIG[rule.action] || ACTION_CONFIG.ask;
  const ActionIcon = config.icon;

  return (
    <div className={`permission-rule ${rule.enabled ? '' : 'permission-rule--disabled'}`}>
      <div className="permission-rule__header">
        <label className="permission-rule__toggle">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={() => onToggle?.(rule.id, !rule.enabled)}
            disabled={!onToggle}
          />
        </label>

        <ActionIcon size={14} className="permission-rule__action-icon" color={config.color} />

        <span className="permission-rule__tool-name">{rule.toolName === '*' ? 'All tools' : rule.toolName}</span>
        <span className="permission-rule__arrow">&rarr;</span>
        <span className="permission-rule__action" style={{ color: config.color }}>
          {config.label}
        </span>
        {rule.unconditional && (
          <span className="permission-rule__badge">unconditional</span>
        )}

        <div className="permission-rule__actions">
          {onEdit && (
            <button
              className="permission-rule__edit"
              onClick={() => onEdit(rule)}
              title="Edit rule"
            >
              <Pencil size={13} />
            </button>
          )}
          {onDelete && (
            <button
              className="permission-rule__delete"
              onClick={() => onDelete(rule.id)}
              title="Delete rule"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {rule.conditions && rule.conditions.length > 0 && (
        <div className="permission-rule__conditions">
          <span className="permission-rule__conditions-label">When:</span>
          {rule.conditions.map((c, i) => (
            <span key={i} className="permission-rule__condition">
              {formatCondition(c)}
            </span>
          ))}
        </div>
      )}

      <div className="permission-rule__meta">
        {rule.description && (
          <span className="permission-rule__description">{rule.description}</span>
        )}
        <span className="permission-rule__created">
          {rule.createdBy === 'approval_dialog' ? 'via approval' : rule.createdBy}
          {' \u00B7 '}
          {formatTimeAgo(rule.updatedAt)}
        </span>
      </div>
    </div>
  );
});

RuleItem.displayName = 'RuleItem';

// ============================================================
// RuleForm — Inline create/edit form
// ============================================================

interface RuleFormProps {
  availableTools: string[];
  initial?: IPermissionRuleInfo | null;
  onSave: (data: INewPermissionRule) => void;
  onCancel: () => void;
}

function RuleForm({ availableTools, initial, onSave, onCancel }: RuleFormProps): React.ReactElement {
  const [toolName, setToolName] = useState(initial?.toolName ?? '');
  const [action, setAction] = useState<'allow' | 'deny' | 'ask'>(initial?.action ?? 'allow');
  const [unconditional, setUnconditional] = useState(initial?.unconditional ?? false);
  const [conditions, setConditions] = useState<IConditionFormData[]>(
    initial?.conditions?.map(c => ({ argName: c.argName, operator: c.operator, value: c.value })) ?? []
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [expiresAt, setExpiresAt] = useState<string>(initial?.expiresAt ?? '');

  // Arg hints for the selected tool
  const argHints = TOOL_ARG_HINTS[toolName] || TOOL_ARG_HINTS['*'] || [];
  const allArgOptions = [...new Set([...argHints, ...TOOL_ARG_HINTS['*'] || []])];

  const addCondition = useCallback(() => {
    setConditions(prev => [...prev, { argName: argHints[0] || '', operator: 'contains', value: '' }]);
  }, [argHints]);

  const removeCondition = useCallback((index: number) => {
    setConditions(prev => prev.filter((_, i) => i !== index));
  }, []);

  const updateCondition = useCallback((index: number, field: keyof IConditionFormData, value: string) => {
    setConditions(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
  }, []);

  const handleSave = useCallback(() => {
    if (!toolName) return;
    const validConditions = conditions.filter(c => c.argName && c.value);
    onSave({
      toolName,
      action,
      unconditional,
      conditions: validConditions.length > 0 ? validConditions : undefined,
      enabled: initial?.enabled ?? true,
      description: description || undefined,
      expiresAt: expiresAt || null,
    });
  }, [toolName, action, unconditional, conditions, description, expiresAt, initial, onSave]);

  return (
    <div className="permission-rule-form">
      <div className="permission-rule-form__title">
        {initial ? 'Edit Rule' : 'New Permission Rule'}
      </div>

      {/* Tool selector */}
      <div className="permission-rule-form__row">
        <label className="permission-rule-form__label">Tool</label>
        <div className="permission-rule-form__select-wrap">
          <select
            className="permission-rule-form__select"
            value={toolName}
            onChange={e => setToolName(e.target.value)}
          >
            <option value="">Select a tool...</option>
            <option value="*">* (All tools)</option>
            {availableTools.filter(t => t !== '*').sort().map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <ChevronDown size={12} className="permission-rule-form__select-icon" />
        </div>
      </div>

      {/* Action selector */}
      <div className="permission-rule-form__row">
        <label className="permission-rule-form__label">Action</label>
        <div className="permission-rule-form__actions-group">
          {(['allow', 'deny', 'ask'] as const).map(a => {
            const cfg = ACTION_CONFIG[a];
            return (
              <button
                key={a}
                className={`permission-rule-form__action-btn ${action === a ? 'permission-rule-form__action-btn--active' : ''}`}
                style={action === a ? { borderColor: cfg.color, color: cfg.color } : undefined}
                onClick={() => setAction(a)}
                type="button"
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Unconditional */}
      <div className="permission-rule-form__row">
        <label className="permission-rule-form__checkbox">
          <input
            type="checkbox"
            checked={unconditional}
            onChange={e => setUnconditional(e.target.checked)}
          />
          <span>Unconditional</span>
          <span className="permission-rule-form__hint">(cannot be overridden by more specific rules)</span>
        </label>
      </div>

      {/* Conditions */}
      <div className="permission-rule-form__section">
        <div className="permission-rule-form__section-header">
          <span className="permission-rule-form__label">Conditions</span>
          <span className="permission-rule-form__hint">(all must match)</span>
          <button
            className="permission-rule-form__add-btn"
            onClick={addCondition}
            type="button"
          >
            <Plus size={12} /> Add Condition
          </button>
        </div>

        {conditions.length === 0 && (
          <div className="permission-rule-form__empty-conditions">
            No conditions — rule applies to all calls of this tool.
          </div>
        )}

        {conditions.map((cond, idx) => (
          <div key={idx} className="permission-rule-form__condition-row">
            <div className="permission-rule-form__condition-field">
              <select
                className="permission-rule-form__input permission-rule-form__input--sm"
                value={cond.argName}
                onChange={e => updateCondition(idx, 'argName', e.target.value)}
              >
                <option value="">arg...</option>
                {allArgOptions.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div className="permission-rule-form__condition-field">
              <select
                className="permission-rule-form__input permission-rule-form__input--sm"
                value={cond.operator}
                onChange={e => updateCondition(idx, 'operator', e.target.value)}
              >
                {OPERATORS.map(op => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
            </div>
            <div className="permission-rule-form__condition-field permission-rule-form__condition-field--value">
              <input
                type="text"
                className="permission-rule-form__input"
                placeholder="value..."
                value={cond.value}
                onChange={e => updateCondition(idx, 'value', e.target.value)}
              />
            </div>
            <button
              className="permission-rule-form__condition-remove"
              onClick={() => removeCondition(idx)}
              type="button"
              title="Remove condition"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Description */}
      <div className="permission-rule-form__row">
        <label className="permission-rule-form__label">Description</label>
        <input
          type="text"
          className="permission-rule-form__input"
          placeholder="e.g., Block destructive rm commands"
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>

      {/* Buttons */}
      <div className="permission-rule-form__buttons">
        <button className="permission-rule-form__btn permission-rule-form__btn--cancel" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="permission-rule-form__btn permission-rule-form__btn--save"
          onClick={handleSave}
          disabled={!toolName}
          type="button"
        >
          <Save size={14} />
          {initial ? 'Update Rule' : 'Save Rule'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// PermissionRulesList — Read-only (backward compat)
// ============================================================

export const PermissionRulesList: React.FC<IPermissionRulesListProps> = memo(
  ({ rules, onToggleRule, onDeleteRule, onClearSession, className = '' }) => {
    return (
      <div className={`permission-rules ${className}`}>
        <div className="permission-rules__header">
          <Shield size={14} />
          <span className="permission-rules__title">Permission Rules</span>
          <span className="permission-rules__count">{rules.length}</span>
          {onClearSession && (
            <button className="permission-rules__clear-btn" onClick={onClearSession}>
              Clear session cache
            </button>
          )}
        </div>
        {rules.length === 0 ? (
          <div className="permission-rules__empty">
            No permission rules configured.
          </div>
        ) : (
          <div className="permission-rules__list">
            {rules.map(rule => (
              <RuleItem key={rule.id} rule={rule} onToggle={onToggleRule} onDelete={onDeleteRule} />
            ))}
          </div>
        )}
      </div>
    );
  },
);
PermissionRulesList.displayName = 'PermissionRulesList';

// ============================================================
// PermissionRulesEditor — Full CRUD
// ============================================================

export const PermissionRulesEditor: React.FC<IPermissionRulesEditorProps> = memo(
  ({ rules, availableTools, onAddRule, onUpdateRule, onToggleRule, onDeleteRule, onClearSession, className = '' }) => {
    const [showForm, setShowForm] = useState(false);
    const [editingRule, setEditingRule] = useState<IPermissionRuleInfo | null>(null);

    const handleEdit = useCallback((rule: IPermissionRuleInfo) => {
      setEditingRule(rule);
      setShowForm(true);
    }, []);

    const handleSave = useCallback((data: INewPermissionRule) => {
      if (editingRule) {
        onUpdateRule?.(editingRule.id, data);
      } else {
        onAddRule?.(data);
      }
      setShowForm(false);
      setEditingRule(null);
    }, [editingRule, onAddRule, onUpdateRule]);

    const handleCancel = useCallback(() => {
      setShowForm(false);
      setEditingRule(null);
    }, []);

    const handleAdd = useCallback(() => {
      setEditingRule(null);
      setShowForm(true);
    }, []);

    return (
      <div className={`permission-rules ${className}`}>
        <div className="permission-rules__header">
          <Shield size={14} />
          <span className="permission-rules__title">Permission Rules</span>
          <span className="permission-rules__count">{rules.length}</span>
          {onClearSession && (
            <button className="permission-rules__clear-btn" onClick={onClearSession}>
              Clear session cache
            </button>
          )}
          {onAddRule && !showForm && (
            <button className="permission-rules__add-btn" onClick={handleAdd}>
              <Plus size={12} /> Add Rule
            </button>
          )}
        </div>

        {/* Inline form (create or edit) */}
        {showForm && (
          <RuleForm
            availableTools={availableTools}
            initial={editingRule}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        )}

        {/* Rules list */}
        {rules.length === 0 && !showForm ? (
          <div className="permission-rules__empty">
            No permission rules configured. Click "Add Rule" to create one, or rules are created automatically when you approve/deny tool execution with "Always" scope.
          </div>
        ) : (
          <div className="permission-rules__list">
            {rules.map(rule => (
              <RuleItem
                key={rule.id}
                rule={rule}
                onToggle={onToggleRule}
                onDelete={onDeleteRule}
                onEdit={onUpdateRule ? handleEdit : undefined}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
);
PermissionRulesEditor.displayName = 'PermissionRulesEditor';

export default PermissionRulesList;
