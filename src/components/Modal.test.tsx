import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

function open() {
  const onClose = vi.fn();
  render(
    <Modal title="Edit" onClose={onClose}>
      <input aria-label="Name" />
    </Modal>,
  );
  const dialog = screen.getByRole('dialog');
  return { onClose, dialog, backdrop: dialog.parentElement! };
}

describe('Modal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('closes on a click outside the dialog and on Escape', () => {
    const { onClose, backdrop } = open();
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('stays open when dragging the scrollbar of a tall dialog', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
    const { onClose, backdrop } = open();
    fireEvent.mouseDown(backdrop, { clientX: 1005, clientY: 300 });
    fireEvent.mouseUp(backdrop, { clientX: 1005, clientY: 500 });
    fireEvent.click(backdrop, { clientX: 1005, clientY: 500 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open when a press starts inside the dialog and ends outside, or the other way round', () => {
    const { onClose, dialog, backdrop } = open();
    const input = screen.getByLabelText('Name');
    // Selecting text in a field and letting go outside: the browser clicks their common parent.
    fireEvent.mouseDown(input);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(dialog);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });
});
