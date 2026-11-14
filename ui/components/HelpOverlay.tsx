'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { MouseEvent } from 'react';

import type { ManualBundle } from '../../src/manual/model.js';
import { useModalFocus } from '../hooks/useModalFocus.js';
import { dropManualToc } from '../lib/helpindex.js';
import { DialogClose } from './DialogClose.js';

interface HelpOverlayProps {
  bundle: ManualBundle;
  onClose: () => void;
}

export function HelpOverlay({ bundle, onClose }: HelpOverlayProps) {
  const startSlug = bundle.pages['index'] ? 'index' : (bundle.nav[0]?.slug ?? '');
  const [slug, setSlug] = useState(startSlug);
  const [anchor, setAnchor] = useState<{ id: string } | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The overlay is modal like DialogShell: focus in on open, back to the
  // opener on close, Tab kept inside the panel.
  useModalFocus(panelRef);
  const page = bundle.pages[slug];
  const contentHtml = useMemo(() => {
    const html = page?.html ?? '';
    if (slug !== 'index') return html;
    return dropManualToc(html, bundle.nav.map((entry) => entry.slug));
  }, [page, slug, bundle.nav]);

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
        ref={panelRef}
        className="settings-panel help-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Help"
        tabIndex={-1}
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
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />
        </div>
      </div>
    </div>
  );
}
