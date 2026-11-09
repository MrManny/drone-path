// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AboutDialog } from '../../ui/components/AboutDialog.js';
import { aboutContent } from '../../ui/lib/abouttext.js';

afterEach(cleanup);

describe('AboutDialog', () => {
  it('shows the brand lockup, version, license and repository link', () => {
    render(<AboutDialog content={aboutContent('0.8.1', null)} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'About' })).toBeTruthy();
    const body = document.querySelector('.about-body') as HTMLElement;
    expect(body.querySelector('.brand')?.textContent).toBe('drone / path');
    expect(body.querySelector('.about-version')?.textContent).toBe('Version 0.8.1');
    expect(body.querySelector('.about-license')?.textContent).toBe('MIT license');
    const link = screen.getByRole('link', { name: 'MrManny/drone-path' });
    expect(link.getAttribute('href')).toBe('https://github.com/MrManny/drone-path');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.querySelector('svg')).toBeTruthy();
  });

  it('shows the build version of an untagged build', () => {
    render(
      <AboutDialog
        content={aboutContent('0.8.1', { tagged: false, commit: 'cb40df32' })}
        onClose={() => {}}
      />,
    );
    expect(document.querySelector('.about-version')?.textContent).toBe('Version 0.8.1+cb40df32');
  });

  it('closes from the Close control and the backdrop', () => {
    const onClose = vi.fn();
    const { container } = render(
      <AboutDialog content={aboutContent('0.8.1', null)} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.settings-overlay') as Element);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
