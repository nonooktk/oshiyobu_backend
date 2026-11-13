export interface SecretFinding {
  readonly path: string;
  /** 1 から数えた行番号。ファイルの名前そのものが問題のときは 0。 */
  readonly line: number;
  /** 問題の種類（値は含めない）。 */
  readonly reason: string;
}
export function findSecretAssignments(
  files: readonly { readonly path: string; readonly text: string }[],
): SecretFinding[];
