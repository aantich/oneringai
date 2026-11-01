/**
 * InteractiveUIBlock — Renders a ```ui JSON schema as Bootstrap-styled
 * interactive form components.
 *
 * Uses plain HTML with Bootstrap CSS classes (no react-bootstrap import needed).
 * Consuming apps already load Bootstrap CSS via react-bootstrap.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { useFormState } from './useFormState.js';
import type {
  UISchema,
  UILayoutChild,
  UIComponent,
  UIRow,
  UICol,
  UIInputComponent,
  UITextareaComponent,
  UISelectComponent,
  UICheckboxComponent,
  UIRadioComponent,
  UIButtonComponent,
  UIAlertComponent,
  UIProgressComponent,
  UITextComponent,
  InteractiveUIBlockProps,
  OnInteractiveAction,
} from './types.js';
import type { FormState } from './useFormState.js';

// ============================================================================
// Schema parser
// ============================================================================

function parseSchema(code: string): UISchema {
  const parsed = JSON.parse(code);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Interactive UI schema must be a JSON object');
  }
  if (!Array.isArray(parsed.layout)) {
    throw new Error('Interactive UI schema must have a "layout" array');
  }
  return parsed as UISchema;
}

// ============================================================================
// Component renderers
// ============================================================================

function isLayoutNode(node: UILayoutChild): node is UIRow | UICol {
  return node.type === 'row' || node.type === 'col';
}

function renderInput(comp: UIInputComponent, form: FormState) {
  const inputId = `iui-${comp.id}`;
  return (
    <div className="mb-3" key={comp.id}>
      {comp.label && <label htmlFor={inputId} className="form-label">{comp.label}</label>}
      <input
        id={inputId}
        type={comp.inputType || 'text'}
        className="form-control"
        placeholder={comp.placeholder}
        value={(form.values[comp.id] as string) ?? ''}
        onChange={(e) => form.setValue(comp.id, e.target.value)}
        required={comp.required}
        disabled={comp.disabled}
      />
      {comp.helpText && <div className="form-text">{comp.helpText}</div>}
    </div>
  );
}

function renderTextarea(comp: UITextareaComponent, form: FormState) {
  const inputId = `iui-${comp.id}`;
  return (
    <div className="mb-3" key={comp.id}>
      {comp.label && <label htmlFor={inputId} className="form-label">{comp.label}</label>}
      <textarea
        id={inputId}
        className="form-control"
        placeholder={comp.placeholder}
        rows={comp.rows ?? 3}
        value={(form.values[comp.id] as string) ?? ''}
        onChange={(e) => form.setValue(comp.id, e.target.value)}
        required={comp.required}
        disabled={comp.disabled}
      />
      {comp.helpText && <div className="form-text">{comp.helpText}</div>}
    </div>
  );
}

function normalizeOptions(options: string[] | Array<{ label: string; value: string }>): Array<{ label: string; value: string }> {
  return options.map((opt) =>
    typeof opt === 'string' ? { label: opt, value: opt } : opt,
  );
}

function renderSelect(comp: UISelectComponent, form: FormState) {
  const inputId = `iui-${comp.id}`;
  const opts = normalizeOptions(comp.options);
  return (
    <div className="mb-3" key={comp.id}>
      {comp.label && <label htmlFor={inputId} className="form-label">{comp.label}</label>}
      <select
        id={inputId}
        className="form-select"
        value={(form.values[comp.id] as string) ?? ''}
        onChange={(e) => {
          if (comp.multiple) {
            const selected = Array.from(e.target.selectedOptions, (o) => o.value);
            form.setValue(comp.id, selected);
          } else {
            form.setValue(comp.id, e.target.value);
          }
        }}
        multiple={comp.multiple}
        required={comp.required}
        disabled={comp.disabled}
      >
        {!comp.multiple && !comp.defaultValue && (
          <option value="">Select...</option>
        )}
        {opts.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {comp.helpText && <div className="form-text">{comp.helpText}</div>}
    </div>
  );
}

function renderCheckbox(comp: UICheckboxComponent, form: FormState) {
  const inputId = `iui-${comp.id}`;
  return (
    <div className="mb-3 form-check" key={comp.id}>
      <input
        id={inputId}
        type="checkbox"
        className="form-check-input"
        checked={(form.values[comp.id] as boolean) ?? false}
        onChange={(e) => form.setValue(comp.id, e.target.checked)}
        disabled={comp.disabled}
      />
      <label htmlFor={inputId} className="form-check-label">{comp.label}</label>
    </div>
  );
}

function renderRadio(comp: UIRadioComponent, form: FormState) {
  const opts = normalizeOptions(comp.options);
  return (
    <div className="mb-3" key={comp.id}>
      {comp.label && <label className="form-label d-block">{comp.label}</label>}
      {opts.map((opt) => {
        const radioId = `iui-${comp.id}-${opt.value}`;
        return (
          <div className="form-check" key={opt.value}>
            <input
              id={radioId}
              type="radio"
              className="form-check-input"
              name={comp.id}
              value={opt.value}
              checked={(form.values[comp.id] as string) === opt.value}
              onChange={() => form.setValue(comp.id, opt.value)}
              disabled={comp.disabled}
            />
            <label htmlFor={radioId} className="form-check-label">{opt.label}</label>
          </div>
        );
      })}
    </div>
  );
}

function renderButton(
  comp: UIButtonComponent,
  form: FormState,
  onAction?: OnInteractiveAction,
  keyPrefix = '',
) {
  const variant = comp.variant || 'primary';
  const size = comp.size ? `btn-${comp.size}` : '';
  return (
    <button
      key={`${keyPrefix}${comp.action}`}
      type="button"
      className={`btn btn-${variant} ${size} me-2 mb-2`.trim()}
      disabled={comp.disabled}
      onClick={() => {
        onAction?.({
          actionId: comp.action,
          formData: form.getValues(),
        });
      }}
    >
      {comp.label}
    </button>
  );
}

function renderAlert(comp: UIAlertComponent) {
  const variant = comp.variant || 'info';
  return (
    <div
      key={`alert-${comp.text.slice(0, 20)}`}
      className={`alert alert-${variant} ${comp.dismissible ? 'alert-dismissible' : ''} mb-3`}
      role="alert"
    >
      {comp.text}
    </div>
  );
}

function renderProgress(comp: UIProgressComponent) {
  const min = comp.min ?? 0;
  const max = comp.max ?? 100;
  const pct = ((comp.now - min) / (max - min)) * 100;
  const variant = comp.variant ? `bg-${comp.variant}` : '';
  const striped = comp.striped || comp.animated ? 'progress-bar-striped' : '';
  const animated = comp.animated ? 'progress-bar-animated' : '';
  return (
    <div className="mb-3" key={`progress-${comp.now}`}>
      {comp.label && <label className="form-label">{comp.label}</label>}
      <div className="progress">
        <div
          className={`progress-bar ${variant} ${striped} ${animated}`.trim()}
          role="progressbar"
          style={{ width: `${pct}%` }}
          aria-valuenow={comp.now}
          aria-valuemin={min}
          aria-valuemax={max}
        >
          {Math.round(pct)}%
        </div>
      </div>
    </div>
  );
}

function renderText(comp: UITextComponent) {
  const colorClass = comp.variant ? `text-${comp.variant}` : '';
  const sizeClass = comp.size === 'sm' ? 'small' : comp.size === 'lg' ? 'fs-5' : '';
  return (
    <p
      key={`text-${comp.content.slice(0, 20)}`}
      className={`${colorClass} ${sizeClass} mb-2`.trim()}
    >
      {comp.content}
    </p>
  );
}

// ============================================================================
// Recursive layout renderer
// ============================================================================

function renderComponent(
  node: UIComponent,
  form: FormState,
  onAction?: OnInteractiveAction,
): React.ReactNode {
  switch (node.type) {
    case 'input': return renderInput(node, form);
    case 'textarea': return renderTextarea(node, form);
    case 'select': return renderSelect(node, form);
    case 'checkbox': return renderCheckbox(node, form);
    case 'radio': return renderRadio(node, form);
    case 'button': return renderButton(node, form, onAction);
    case 'alert': return renderAlert(node);
    case 'progress': return renderProgress(node);
    case 'text': return renderText(node);
    default: return null;
  }
}

function renderLayoutNode(
  node: UILayoutChild,
  form: FormState,
  onAction?: OnInteractiveAction,
  index = 0,
): React.ReactNode {
  if (!isLayoutNode(node)) {
    return renderComponent(node as UIComponent, form, onAction);
  }

  if (node.type === 'row') {
    return (
      <div className={`row ${node.className ?? ''}`.trim()} key={`row-${index}`}>
        {node.children.map((child, i) => renderLayoutNode(child, form, onAction, i))}
      </div>
    );
  }

  // col
  const colClass = node.width ? `col-${node.width}` : 'col';
  return (
    <div className={`${colClass} ${node.className ?? ''}`.trim()} key={`col-${index}`}>
      {node.children.map((child, i) => renderLayoutNode(child, form, onAction, i))}
    </div>
  );
}

// ============================================================================
// Default registration
// ============================================================================

function collectDefaults(
  nodes: UILayoutChild[],
  register: (id: string, value: unknown) => void,
) {
  for (const node of nodes) {
    if (isLayoutNode(node)) {
      collectDefaults(node.children, register);
      continue;
    }
    const comp = node as UIComponent;
    switch (comp.type) {
      case 'input':
      case 'textarea':
        if (comp.defaultValue !== undefined) register(comp.id, comp.defaultValue);
        else register(comp.id, '');
        break;
      case 'select':
        if (comp.defaultValue !== undefined) register(comp.id, comp.defaultValue);
        else register(comp.id, '');
        break;
      case 'checkbox':
        register(comp.id, comp.defaultChecked ?? false);
        break;
      case 'radio':
        if (comp.defaultValue !== undefined) register(comp.id, comp.defaultValue);
        else register(comp.id, '');
        break;
    }
  }
}

// ============================================================================
// Main component
// ============================================================================

export function InteractiveUIBlock({
  code,
  onAction,
  isStreaming = false,
  onError,
}: InteractiveUIBlockProps): React.ReactElement {
  const form = useFormState();

  const schema = useMemo(() => {
    try {
      return parseSchema(code);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
      return null;
    }
  }, [code, onError]);

  // Register default values once when schema is parsed
  useEffect(() => {
    if (!schema) return;
    collectDefaults(schema.layout, form.registerDefault);
    if (schema.actions) {
      // Actions don't have defaults, but this future-proofs it
    }
  }, [schema]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isStreaming) {
    return (
      <div className="iui-block iui-block--streaming">
        <div className="iui-block__streaming-hint">
          Building interactive form...
        </div>
        <pre className="iui-block__preview">{code}</pre>
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="iui-block iui-block--error">
        <div className="iui-block__error-header">
          <AlertCircle size={16} />
          <span>Invalid Interactive UI Schema</span>
        </div>
        <pre className="iui-block__error-code">{code}</pre>
      </div>
    );
  }

  const handleAction = useCallback(
    (action: { actionId: string; formData: Record<string, unknown> }) => {
      if (!onAction) {
        console.warn('[InteractiveUIBlock] Button pressed but no onInteractiveAction handler provided. Action:', action.actionId);
        return;
      }
      onAction(action);
    },
    [onAction],
  );

  return (
    <div className="iui-block">
      <div className="iui-block__content">
        {schema.layout.map((node, i) => renderLayoutNode(node, form, handleAction, i))}
      </div>

      {/* Bottom actions (if any are defined outside layout) */}
      {schema.actions && schema.actions.length > 0 && (
        <div className="iui-block__actions">
          {schema.actions.map((btn, i) => renderButton(btn, form, handleAction, `bottom-${i}-`))}
        </div>
      )}
    </div>
  );
}

export default InteractiveUIBlock;
