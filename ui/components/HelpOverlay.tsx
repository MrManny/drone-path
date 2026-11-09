'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { MouseEvent } from 'react';

import type { ManualBundle } from '../../src/manual/model.js';
import { DialogClose } from './DialogClose.js';

export interface HelpOverlayProps {
  bundle: ManualBundle;
  onClose: () => void;
}

export function HelpOverlay({ bundle, onClose }: HelpOverlayProps) {
  const startSlug = bundle.pages['index'] ? 'index' : (bundle.nav[0]?.slug ?? '');
  const [slug, setSlug] = useState(startSlug);
  const [anchor, setAnchor] = useState<{ id: string } | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const page = bundle.pages[slug];

  useEffect(() => {
    if (anchor === null) return;
    const target = [...(articleRef.current?.querySelectorAll('[id]') ?? [])].find(
      (node) => node.id === anchor.id,
    );
    target?.scrollIntoView?.({ block: 'start' });
  }, [anchor, slug]);

  const onContentClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const link = (event.target as HTMLElement).closest('a');
      const target = link?.dataset['manualSlug'];
      if (target === undefined) return;
      event.preventDefault();
      if (target in bundle.pages) {
        const id = link?.dataset['manualAnchor'];
        setAnchor(id === undefined ? null : { id });
        setSlug(target);
      }
    },
    [bundle.pages],
  );

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel help-panel"
        role="dialog"
        aria-label="Help"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>Help</h2>
          <DialogClose onClose={onClose} />
        </div>
        <div className="help-body">
          <nav className="help-nav" aria-label="Manual pages">
            {bundle.nav.map((entry) => (
              <a
                key={entry.slug}
                href={`#manual/${entry.slug}`}
                aria-current={entry.slug === slug ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setAnchor(null);
                  setSlug(entry.slug);
                }}
              >
                {entry.label}
              </a>
            ))}
          </nav>
          <article
            ref={articleRef}
            className="help-content"
            onClick={onContentClick}
            dangerouslySetInnerHTML={{ __html: page?.html ?? '' }}
          />
        </div>
      </div>
    </div>
  );
}
