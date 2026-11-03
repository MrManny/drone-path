// The manual's shared data model: what the build-time compiler produces and
// the help UI consumes. Pure types only, so the UI can import them without
// pulling any compiler code into the bundle.

export interface ManualHeading {
  /** GitHub-compatible heading anchor, unique within the page. */
  id: string;
  text: string;
  level: number;
}

export interface ManualPage {
  /** File base name ("keyboard-shortcuts"); README.md becomes "index". */
  slug: string;
  /** The first level-1 heading. */
  title: string;
  headings: ManualHeading[];
  /** Sanitized rendered HTML with rewritten links and images. */
  html: string;
}

export interface ManualNavEntry {
  slug: string;
  label: string;
}

export interface ManualBundle {
  nav: ManualNavEntry[];
  pages: Record<string, ManualPage>;
}
