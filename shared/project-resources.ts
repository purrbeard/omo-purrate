export const RESOURCE_KINDS = ["packages", "extensions", "skills", "prompts", "themes"] as const;
export type ResourceKind = typeof RESOURCE_KINDS[number];
export type ResourceFilterKind = Exclude<ResourceKind, "packages">;
export type DeclaredPackage = string | {
  source: string;
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
};
export type DeclaredResources = {
  packages: DeclaredPackage[];
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
};
export type ResourceSource = {
  path: string;
  scope: "global" | "project";
  exists: boolean;
  declarations: DeclaredResources;
};
export type ProjectTrustEvidence = {
  kind: "direct" | "ancestor" | "default";
  trusted: boolean | null;
  path: string;
  matchedDirectory: string | null;
  defaultValue: "ask" | "always" | "never" | null;
};
export type ProjectResources = {
  cwd: string;
  trust: ProjectTrustEvidence;
  sources: ResourceSource[];
};
