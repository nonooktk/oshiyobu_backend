export function bundleServer(options: {
  outDir: string;
  entry?: string;
}): Promise<{ file: string; bytes: number; inputs: string[] }>;
