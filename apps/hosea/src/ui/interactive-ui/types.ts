/**
 * Types for the Interactive UI system.
 *
 * LLMs produce JSON matching UISchema inside ```ui fenced code blocks.
 * The renderer converts this to Bootstrap-styled form components.
 */

// ============================================================================
// Component types
// ============================================================================

export interface UIInputComponent {
  type: 'input';
  id: string;
  label?: string;
  placeholder?: string;
  inputType?: 'text' | 'number' | 'email' | 'password' | 'url' | 'tel';
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
  helpText?: string;
}

export interface UITextareaComponent {
  type: 'textarea';
  id: string;
  label?: string;
  placeholder?: string;
  rows?: number;
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
  helpText?: string;
}

export interface UISelectComponent {
  type: 'select';
  id: string;
  label?: string;
  options: string[] | Array<{ label: string; value: string }>;
  defaultValue?: string;
  multiple?: boolean;
  required?: boolean;
  disabled?: boolean;
  helpText?: string;
}

export interface UICheckboxComponent {
  type: 'checkbox';
  id: string;
  label: string;
  defaultChecked?: boolean;
  disabled?: boolean;
}

export interface UIRadioComponent {
  type: 'radio';
  id: string;
  label?: string;
  options: string[] | Array<{ label: string; value: string }>;
  defaultValue?: string;
  disabled?: boolean;
}

export interface UIButtonComponent {
  type: 'button';
  label: string;
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'outline-primary' | 'outline-secondary' | 'link';
  action: string;
  size?: 'sm' | 'lg';
  disabled?: boolean;
}

export interface UIAlertComponent {
  type: 'alert';
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info';
  text: string;
  dismissible?: boolean;
}

export interface UIProgressComponent {
  type: 'progress';
  now: number;
  min?: number;
  max?: number;
  label?: string;
  variant?: 'success' | 'info' | 'warning' | 'danger';
  striped?: boolean;
  animated?: boolean;
}

export interface UITextComponent {
  type: 'text';
  content: string;
  variant?: 'muted' | 'primary' | 'success' | 'danger' | 'warning' | 'info';
  size?: 'sm' | 'lg';
}

// ============================================================================
// Layout types
// ============================================================================

export interface UIRow {
  type: 'row';
  children: UILayoutChild[];
  className?: string;
}

export interface UICol {
  type: 'col';
  width?: number; // 1-12 (Bootstrap grid)
  children: UILayoutChild[];
  className?: string;
}

export type UIFormComponent =
  | UIInputComponent
  | UITextareaComponent
  | UISelectComponent
  | UICheckboxComponent
  | UIRadioComponent;

export type UIActionComponent = UIButtonComponent;

export type UIDisplayComponent =
  | UIAlertComponent
  | UIProgressComponent
  | UITextComponent;

export type UIComponent =
  | UIFormComponent
  | UIActionComponent
  | UIDisplayComponent;

export type UILayoutChild = UIRow | UICol | UIComponent;

// ============================================================================
// Schema
// ============================================================================

export interface UISchema {
  /** Layout tree of rows, columns, and components */
  layout: UILayoutChild[];
  /** Action buttons (rendered at the bottom if not placed in layout) */
  actions?: UIButtonComponent[];
}

// ============================================================================
// Action callback
// ============================================================================

export interface InteractiveUIAction {
  /** The action string from the button that was pressed */
  actionId: string;
  /** Collected form values: { componentId: value } */
  formData: Record<string, unknown>;
}

/** Callback type for interactive UI actions */
export type OnInteractiveAction = (action: InteractiveUIAction) => void;

// ============================================================================
// Component props
// ============================================================================

export interface InteractiveUIBlockProps {
  /** Raw JSON string from the ```ui code block */
  code: string;
  /** Callback when user triggers an action (button press, form submit) */
  onAction?: OnInteractiveAction;
  /** Whether the parent markdown is streaming */
  isStreaming?: boolean;
  /** Callback when parsing/rendering fails */
  onError?: (error: Error) => void;
}
