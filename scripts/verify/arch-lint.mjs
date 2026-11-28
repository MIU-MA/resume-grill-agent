import { readdir, readFile } from "node:fs/promises";
import { dirname, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const srcDir = resolve(root, "src");

const FORBIDDEN_DOMAIN_MODULES = new Set([
  "fs",
  "fs/promises",
  "http",
  "https",
  "net",
  "dns",
  "dns/promises",
  "sqlite",
  "child_process",
  "os",
  "zlib",
  "stream",
  "node:fs",
  "node:fs/promises",
  "node:http",
  "node:https",
  "node:net",
  "node:dns",
  "node:dns/promises",
  "node:sqlite",
  "node:child_process",
  "node:os",
  "node:zlib",
  "node:stream",
  "nodemailer",
  "playwright-core",
  "pdf-lib",
  "pdfjs-dist",
  "mammoth",
  "@napi-rs/canvas",
]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function isTypeOnlyImport(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    if (
      !clause.name &&
      clause.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.length > 0 &&
      clause.namedBindings.elements.every((el) => el.isTypeOnly)
    ) {
      return true;
    }
    return false;
  }
  if (ts.isExportDeclaration(node)) {
    return Boolean(node.isTypeOnly);
  }
  return false;
}

function extractSpecifiers(filePath, content) {
  const source = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specs = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push({
        spec: node.moduleSpecifier.text,
        typeOnly: isTypeOnlyImport(node),
      });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push({ spec: node.arguments[0].text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specs;
}

function toPosix(p) {
  return p.replaceAll("\\", "/");
}

function resolveRelativeToSrc(filePath, specifier) {
  const resolved = resolve(dirname(filePath), specifier).replace(/\.(?:js|mjs|cjs)$/, "");
  return toPosix(relative(srcDir, resolved));
}

const files = await walk(srcDir);
const violations = [];

for (const file of files) {
  const rel = toPosix(relative(srcDir, file));
  const content = await readFile(file, "utf8");
  const specifiers = extractSpecifiers(file, content);

  for (const { spec, typeOnly } of specifiers) {
    const isRelative = spec.startsWith(".");
    const target = isRelative ? resolveRelativeToSrc(file, spec) : spec;

    // Rule 1: Pure domain layer must not depend on core, infrastructure, adapters, or Node I/O.
    if (rel.startsWith("domain/")) {
      if (
        isRelative &&
        (target.startsWith("core/") ||
          target.startsWith("infrastructure/") ||
          target.startsWith("adapters/"))
      ) {
        violations.push(`${rel} -> ${spec} (domain 禁止依赖 ${target.split("/")[0]})`);
      }
      if (!isRelative && FORBIDDEN_DOMAIN_MODULES.has(spec)) {
        violations.push(`${rel} -> ${spec} (domain 禁止导入 I/O 模块)`);
      }
    }

    // Rule 2: Core layer must never depend on adapters.
    if (rel.startsWith("core/") && isRelative && target.startsWith("adapters/")) {
      violations.push(`${rel} -> ${spec} (core 禁止反向依赖 adapters)`);
    }

    // Rule 3: UI adapters (dsh / panel) must never import each other.
    if (
      rel.startsWith("adapters/dsh/") &&
      isRelative &&
      target.startsWith("adapters/panel/")
    ) {
      violations.push(`${rel} -> ${spec} (dsh 适配器禁止导入 panel 适配器)`);
    }
    if (
      rel.startsWith("adapters/panel/") &&
      isRelative &&
      target.startsWith("adapters/dsh/")
    ) {
      violations.push(`${rel} -> ${spec} (panel 适配器禁止导入 dsh 适配器)`);
    }

    // Rule 4: Browser-only UI modules must never have runtime imports of Node built-ins, infrastructure, or core.
    const isBrowserUi =
      rel.startsWith("adapters/panel/ui/") ||
      rel.startsWith("shared/ui/") ||
      (rel.startsWith("adapters/dsh/") && rel.endsWith(".tsx"));
    if (!typeOnly && isBrowserUi) {
      if (!isRelative && spec.startsWith("node:")) {
        violations.push(`${rel} -> ${spec} (浏览器 UI 禁止运行时导入 Node 内置模块)`);
      }
      if (
        isRelative &&
        (target.startsWith("infrastructure/") || target.startsWith("core/"))
      ) {
        violations.push(`${rel} -> ${spec} (浏览器 UI 禁止运行时导入服务端模块 ${posix.dirname(target)})`);
      }
    }
  }
}

if (violations.length) {
  console.error("架构分层依赖检查失败：");
  for (const item of violations) console.error(`  - ${item}`);
  process.exit(1);
}

console.log(`架构分层依赖检查通过：共扫描 ${files.length} 个源码文件，0 处跨层违规。`);
