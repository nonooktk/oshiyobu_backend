// 合言葉の値を、リポジトリに書いていないことの検査（設計 D-30・テスト設計 I-45）。
// 見るのは「合言葉の環境変数の名前に、値を代入している行」と「.env 系のファイルを追跡していること」。
// 見つけた場所（ファイル・行・理由）だけを返し、値そのものは、返さない・出さない。
// Public のリポジトリで、秘密をコミットしてしまう事故を、CI で止めるための検査。

// 名前を 2 つに割って持つ（この検査の道具そのものが、検査に引っかからないように）。
const NAME = ['PRESENTER', 'PASSPHRASE'].join('_');
// 名前のあとに（引用符と空白をはさんで）: か = が続く行。右辺（値の側）を取り出す。
const ASSIGNMENT = new RegExp(`${NAME}["']?\\s*[:=]\\s*(.*)$`);
const CODE_FILE = /\.(ts|tsx|js|mjs|cjs)$/;

/** 値の置き換え・参照とみなす書き方（シェルの変数・Actions の secret・説明用の <...>・省略）。 */
function isReferenceOrPlaceholder(value) {
  return (
    value === '' ||
    value.startsWith('$') ||
    value.startsWith('<') ||
    value.startsWith('…') ||
    value.startsWith('...') ||
    value.startsWith('(') ||
    value.startsWith('{{') ||
    value.startsWith('process.env')
  );
}

function basename(path) {
  return path.split('/').pop() ?? path;
}

/**
 * @param {readonly { path: string, text: string }[]} files
 * @returns {{ path: string, line: number, reason: string }[]}
 */
export function findSecretAssignments(files) {
  const findings = [];
  for (const { path, text } of files) {
    const name = basename(path);
    if (/^\.env(\..+)?$/.test(name) && name !== '.env.example') {
      findings.push({
        path,
        line: 0,
        reason: '.env 系のファイルを追跡しています（コミットしない）',
      });
    }
    const lines = text.split('\n');
    for (const [index, line] of lines.entries()) {
      const match = ASSIGNMENT.exec(line);
      if (match === null) continue;
      const right = (match[1] ?? '').trim();
      // 右辺の頭が文字列リテラル（'…'・"…"・`…`）なら、その中身と、後ろに残る部分を分ける。
      const literal = /^(["'`])((?:\\.|(?!\1).)*)\1(.*)$/.exec(right);
      let bad;
      if (name === '.env.example') {
        bad = (literal === null ? right.replace(/\s+#.*$/, '') : (literal[2] ?? '')) !== '';
      } else if (CODE_FILE.test(name)) {
        // コードでは、文字列リテラルが単独で値になっているときだけ（'あ'.repeat(12) のような式は、値ではない）。
        bad =
          literal !== null &&
          (literal[2] ?? '') !== '' &&
          /^\s*[,;})\]]*\s*(\/\/.*)?$/.test(literal[3] ?? '') &&
          !isReferenceOrPlaceholder(literal[2] ?? '');
      } else {
        const value = (
          literal === null ? right.replace(/\s+#.*$/, '').replace(/[,;]+$/, '') : (literal[2] ?? '')
        ).trim();
        bad = !isReferenceOrPlaceholder(value);
      }
      if (bad) {
        findings.push({ path, line: index + 1, reason: '合言葉の環境変数に、値を書いています' });
      }
    }
  }
  return findings;
}
