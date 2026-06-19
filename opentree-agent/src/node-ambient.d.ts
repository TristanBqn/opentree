declare module "node:path" {
  export function join(...paths: string[]): string;
  export function dirname(p: string): string;
  export function resolve(...paths: string[]): string;
}

declare module "node:os" {
  export function homedir(): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare var process: {
  env: Record<string, string | undefined>;
};
