import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WeightBar } from './WeightBar';

const widths = (el: HTMLElement) =>
  Object.fromEntries([...el.querySelectorAll<HTMLElement>('.fill')].map((f) => [f.className.replace('fill ', ''), f.style.width]));

describe('WeightBar', () => {
  it('shows a weight that grows as a light extension', () => {
    const { container } = render(<WeightBar current={60} after={65} target={70} />);
    expect(widths(container)).toEqual({ after: '65%', before: '60%' });
  });

  it('shows a weight that drops as a hatched part beyond the new weight', () => {
    const { container } = render(<WeightBar current={70} after={65} target={60} />);
    expect(widths(container)).toEqual({ dropped: '70%', before: '65%' });
  });
});
