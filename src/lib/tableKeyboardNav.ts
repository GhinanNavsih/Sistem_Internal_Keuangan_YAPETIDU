import type { KeyboardEvent } from 'react';

const focusRowCell = (input: HTMLInputElement) => {
  input.focus();
  input.select();
};

export const focusCellInDirection = (input: HTMLInputElement, direction: 'left' | 'right' | 'up' | 'down') => {
  const row = input.closest('tr');
  if (!row) return;

  if (direction === 'left' || direction === 'right') {
    const rowInputs = Array.from(row.querySelectorAll<HTMLInputElement>('input:not([disabled])'));
    const idx = rowInputs.indexOf(input);
    if (idx === -1) return;
    const target = rowInputs[direction === 'left' ? idx - 1 : idx + 1];
    if (target) focusRowCell(target);
    return;
  }

  const table = input.closest('table');
  if (!table) return;
  const rowInputs = Array.from(row.querySelectorAll<HTMLInputElement>('input:not([disabled])'));
  const colIdx = rowInputs.indexOf(input);
  if (colIdx === -1) return;

  const allRows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'));
  const rowIdx = allRows.indexOf(row);
  const step = direction === 'up' ? -1 : 1;
  for (let i = rowIdx + step; i >= 0 && i < allRows.length; i += step) {
    const candidateInputs = Array.from(allRows[i].querySelectorAll<HTMLInputElement>('input:not([disabled])'));
    if (candidateInputs.length === 0) continue;
    focusRowCell(candidateInputs[Math.min(colIdx, candidateInputs.length - 1)]);
    return;
  }
};

/**
 * Spreadsheet-style keyboard nav for editable table rows:
 * Enter moves right, Shift+Enter fires `onShiftEnter` (typically "add row"),
 * arrow keys move to the adjacent cell (left/right only at the caret's edge).
 */
export const handleRowCellKeyDown = (event: KeyboardEvent<HTMLInputElement>, onShiftEnter?: () => void) => {
  const input = event.currentTarget;

  if (event.key === 'Enter') {
    event.preventDefault();
    if (event.shiftKey) {
      onShiftEnter?.();
    } else {
      focusCellInDirection(input, 'right');
    }
    return;
  }

  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    focusCellInDirection(input, event.key === 'ArrowUp' ? 'up' : 'down');
    return;
  }

  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    if (event.key === 'ArrowLeft' && atStart) {
      event.preventDefault();
      focusCellInDirection(input, 'left');
    } else if (event.key === 'ArrowRight' && atEnd) {
      event.preventDefault();
      focusCellInDirection(input, 'right');
    }
  }
};
