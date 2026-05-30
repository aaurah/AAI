// Before
export function formatDate(date: Date): string {
  // ...
}

export function formatString(str: string): string {
  // ...
}

// After
// utils/formatDate.ts
export function formatDate(date: Date): string {
  // ...
}

// utils/formatString.ts
export function formatString(str: string): string {
  // ...
}

// utils/index.ts
import { formatDate } from './formatDate';
import { formatString } from './formatString';

export { formatDate, formatString };