import type { NamingStrategy } from './types.js';

export function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

export function applyNaming(name: string, strategy: NamingStrategy): string {
  return strategy === 'snake_case' ? toSnakeCase(name) : name;
}
