export interface ManualHeading {
  id: string;
  text: string;
  level: number;
}

export interface ManualPage {
  /** File base name ("keyboard-shortcuts"); README.md becomes "index". */
  slug: string;
  title: string;
  headings: ManualHeading[];
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
