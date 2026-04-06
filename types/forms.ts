/**
 * Form configuration type definitions
 * Provides type safety for form fields and configurations
 */

// Field types supported by the form system
export type FieldType = 'text' | 'email' | 'number' | 'date' | 'textarea' | 'select' | 'rich-select';

// Rich select configuration
export interface RichSelectConfig {
  labelKey: string;
  valueKey: string;
  subLabelKey?: string;
}

// Select option structure
export interface SelectOption {
  val: string | number;
  txt: string;
}

// Base field configuration
export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  req?: boolean; // required
  placeholder?: string;
  default?: string | number;
  suggestions?: string[];
  options?: readonly string[] | SelectOption[] | any[]; // for select/rich-select
  config?: RichSelectConfig; // for rich-select
  width?: string; // for batch forms (tailwind class)
}

// Form props for SimpleForm
export interface SimpleFormProps {
  title: string;
  fields: FieldConfig[];
  onSubmit: (data: Record<string, any>) => void;
  loading: boolean;
  /** Called on every field change; return a partial record of fields to auto-update. */
  onFieldChange?: (name: string, value: any, current: Record<string, any>) => Partial<Record<string, any>>;
}

// Parent field configuration for BatchLineItemsForm
export interface ParentFieldConfig {
  name: string;
  label: string;
  options: SelectOption[];
}

// Batch form props
export interface BatchLineItemsFormProps {
  title: string;
  parentField?: ParentFieldConfig;
  itemFields: FieldConfig[];
  stickyFields?: string[];
  onSubmit: (items: Record<string, any>[]) => void;
  loading: boolean;
  formId?: string;
  enablePdfUpload?: boolean;
  enableQuoteImport?: boolean;
  allQuoteItems?: any[];
  allQuotes?: any[];
  allPurchases?: any[];
  components?: any[];
  gridLayout?: boolean;
  /** Called whenever the parent (e.g. PO) selection changes. */
  onParentChange?: (id: string) => void;
}

// Field renderer props
export interface FieldRendererProps {
  field: FieldConfig;
  value: any;
  onChange: (name: string, value: any) => void;
  formId?: string;
}

// Table column configuration
export interface TableColumn<T = any> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode | string;
}

// Searchable table props
export interface SearchableTableProps<T = any> {
  title: string;
  data: T[];
  columns: TableColumn<T>[];
  isLoading?: boolean;
}

// Toast notification types
export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // in milliseconds
}

// Tab types
export type Tab = 'catalog' | 'quoting' | 'ordering' | 'financials' | 'history' | 'database' | 'market-intel' | 'lookup' | 'quote-lookup';

// Menu item configuration
export interface MenuItem {
  id: Tab;
  label: string;
  icon: string;
  color?: string;
  activeColor?: string;
}
