/** Lower source decorators without confusing DSH's standard ABI with agents' legacy ABI. */
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** @returns {import('vite').Plugin} */
export function sourceDecorators({ appRoot }) {
  const require = createRequire(join(appRoot, 'package.json'));
  const ts = require('typescript');
  const { transformSync } = require('esbuild');
  return {
    name: 'dsh-base:source-decorators',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.[cm]?tsx?$/u.test(id) || !code.includes('@')) return null;
      const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, false,
        id.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const legacyNames = new Set();
      for (const node of source.statements) {
        if (!ts.isImportDeclaration(node) || node.moduleSpecifier.text !== 'agents') continue;
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
          if ((binding.propertyName ?? binding.name).text === 'callable') legacyNames.add(binding.name.text);
        }
      }
      let legacy = false, standard = false;
      const visit = node => {
        for (const decorator of ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : []) {
          const expression = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
          if (ts.isIdentifier(expression) && legacyNames.has(expression.text)) legacy = true;
          else standard = true;
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (!legacy && !standard) return null;
      if (legacy && standard) throw new Error(`Cannot mix agents legacy and standard decorators in one source module: ${id}`);
      return transformSync(code, {
        loader: id.endsWith('x') ? 'tsx' : 'ts',
        target: 'es2022', sourcefile: id, sourcemap: true,
        supported: { decorators: false },
        // @Remote uses the standard addInitializer context. @callable from
        // agents uses (prototype, key, descriptor), including imported aliases.
        tsconfigRaw: { compilerOptions: { experimentalDecorators: legacy, useDefineForClassFields: !legacy } },
      });
    },
  };
}
