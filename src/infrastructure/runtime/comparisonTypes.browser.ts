import predicates from 'util/support/types.js';
const tag = (value: unknown): string => Object.prototype.toString.call(value);
export const types = {
  ...predicates,
  isDate: (value: unknown): boolean => tag(value) === '[object Date]',
  isRegExp: (value: unknown): boolean => tag(value) === '[object RegExp]',
  isNativeError: (value: unknown): boolean => tag(value) === '[object Error]' || value instanceof Error,
};
