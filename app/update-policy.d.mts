export interface UpdateGateInput {
  packaged: boolean;
  hasUpdateMetadata: boolean;
}

export declare function shouldCheckForUpdates(input: UpdateGateInput): boolean;
