// M6 互转 demo 子助手：从 stdin 读 SysML v2 文本，跑前端 parser + validator，
// 把结果以单行带标记 JSON 打到 stdout，供 import-e2e.mjs 收集。
//
// 单独抽成文件（而不是 `node -e` 拼字符串）是为了：
//   1. 源码走 stdin —— 规避 Windows CreateProcess 命令行长度上限（~32KB），
//      真实 Papyrus/Capella 模型可能远超该限制；
//   2. 规避 JSON/反引号/CRLF 多层转义把模型内容改坏；
//   3. 直接 import .ts，和 App 运行时走的是同一份 parser/validator。
//
// 用法：
//   echo "package P { part def X; }" | node --import tsx backend/scripts/parse-check.ts
//
// 输出（单行）：
//   ___RESULT___{...json...}___END___

import { parse } from '../../parser/parser';
import { validate } from '../../validator/validator';

function emit(payload: unknown): never {
  process.stdout.write('___RESULT___' + JSON.stringify(payload) + '___END___\n');
  process.exit(0);
}

let source = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  source += chunk;
});
process.stdin.on('end', () => {
  const r = parse(source);
  if (!r.ok) {
    emit({
      parseOk: false,
      parseErrors: r.errors,
      validateOk: false,
      validateIssues: [],
      packageCount: 0,
    });
    return;
  }
  const v = validate(r.model);
  emit({
    parseOk: true,
    parseErrors: [],
    validateOk: v.ok,
    validateIssues: v.issues,
    packageCount: r.model.packages.length,
  });
});
process.stdin.on('error', (err) => {
  process.stderr.write('parse-check stdin error: ' + err.message + '\n');
  process.exit(1);
});
