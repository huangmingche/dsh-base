import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import test from 'node:test'
import { countGroup } from '../src/client/counts.ts'
import { COUNT_LOCALES, NS } from '../src/client/locales.ts'

// The production resolver reads local plugin metadata. Tests resolve only the
// two runtime dependencies from the application's installed dependency graph.
// Browser acceptance loads and measures the real CSS module; SSR needs its token.
const app = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))
const dependencies = new Map(['react', 'zod'].map(name => [name, app.resolve(name)]))
registerHooks({
  resolve(specifier, context, next) {
    return next(dependencies.get(specifier) ?? specifier, context)
  },
  load(url, context, next) {
    if (url === new URL('../src/client/PluginGroupCount.module.css', import.meta.url).href) {
      return { format: 'module', source: 'export default { summary: "plugin-count-summary" }', shortCircuit: true }
    }
    return next(url, context)
  },
})
const { PluginGroupCount, apply, Config, name, inject } = await import('../src/client/index.ts')
const { renderToStaticMarkup } = app('react-dom/server')
const { createElement } = app('react')
const translate = (locale: keyof typeof COUNT_LOCALES) => (key: keyof typeof COUNT_LOCALES.en, values: Record<string, string> = {}) =>
  COUNT_LOCALES[locale][key].replace(/\{(\w+)\}/gu, (_, name: string) => values[name] ?? `{${name}}`)
const props = (group = 'bundles', entries = [{ key: 'example', components: ['first'] }], locale = 'en', status = 'ready') => ({
  group, entries, status, className: 'official-section-count', t: translate(locale as keyof typeof COUNT_LOCALES),
}) as never
const render = (...args: Parameters<typeof props>) => renderToStaticMarkup(createElement(PluginGroupCount, props(...args)))

test('bundle and component identities are counted separately and duplicate rows are not inflated', () => {
  const entries = Object.freeze([
    Object.freeze({ key: 'first', components: Object.freeze(['one', 'one', 'two']) }),
    Object.freeze({ key: 'first', components: Object.freeze(['two', 'three']) }),
    Object.freeze({ key: 'second', components: Object.freeze(['one']) }),
    Object.freeze({ key: 'empty', components: Object.freeze([]) }),
  ])
  assert.deepEqual(countGroup(entries), { count: 3, components: 4 })
  assert.deepEqual(countGroup([]), { count: 0, components: 0 })
})

test('categories are independent snapshots, including More overlap and subsequent changes', () => {
  const main = [{ key: 'shared', components: [] }, { key: 'second', components: [] }]
  const more = [...main, { key: 'extra', components: [] }]
  assert.deepEqual(countGroup(main), { count: 2, components: 0 })
  assert.deepEqual(countGroup(more), { count: 3, components: 0 })
  assert.deepEqual(countGroup(main.slice(1)), { count: 1, components: 0 })
  assert.deepEqual(countGroup(more), { count: 3, components: 0 }, 'another category cannot leave accumulated totals behind')
})

test('all unready states omit the count; a successfully read empty category displays zero', () => {
  for (const status of ['idle', 'loading', 'error', 'unavailable']) {
    for (const group of ['basic', 'extensions', 'bundles', 'more']) {
      assert.equal(render(group, [], 'en', status), '')
      assert.equal(render(group, [{ key: 'cached', components: ['first'] }], 'en', status), '')
    }
  }
  assert.match(render('extensions', []), /aria-label="0 plugins">0<\/span>/u)
  assert.match(render('bundles', []), />0 bundles · 0 components<\/span>/u)
})

test('read-only rendering retains official typography and exact en/zh count units', () => {
  const installed = render('bundles', [
    { key: 'required', components: ['one', 'two'] },
    { key: 'unavailable', components: ['three'] },
  ])
  assert.equal(installed, '<span class="official-section-count plugin-count-summary" data-plugin-category-count="bundles" data-count="2" data-component-count="3" aria-label="2 bundles · 3 components">2 bundles · 3 components</span>')
  assert.equal(render('bundles'), '<span class="official-section-count plugin-count-summary" data-plugin-category-count="bundles" data-count="1" data-component-count="1" aria-label="1 bundle · 1 component">1 bundle · 1 component</span>')
  assert.match(render('basic'), /aria-label="1 configuration entry">1<\/span>/u)
  assert.match(render('more'), /aria-label="1 plugin">1<\/span>/u)
  assert.match(render('bundles', [{ key: 'required', components: ['one', 'two'] }], 'zh'), /aria-label="1 个插件包 · 2 个组件">1 个插件包 · 2 个组件<\/span>/u)
  assert.match(render('basic', [], 'zh'), /aria-label="0 项配置">0<\/span>/u)
  assert.match(render('extensions', [], 'zh'), /aria-label="0 个插件">0<\/span>/u)
  assert.ok(!/button|input|style=|role="switch"/u.test(installed), 'the summary cannot introduce controls or replace official styling')
})

test('every supported language has complete usable count and accessible-label copy', () => {
  assert.deepEqual(Object.keys(COUNT_LOCALES).sort(), ['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'])
  for (const locale of Object.keys(COUNT_LOCALES) as (keyof typeof COUNT_LOCALES)[]) {
    assert.deepEqual(Object.keys(COUNT_LOCALES[locale]).sort(), Object.keys(COUNT_LOCALES.en).sort())
    for (const group of ['basic', 'extensions', 'bundles', 'more']) {
      const result = render(group, [{ key: 'example', components: ['row'] }], locale)
      assert.match(result, /aria-label="[^"]*1/u)
      assert.ok(!/[{}]/u.test(result), `${locale}: no unresolved translation placeholders`)
    }
  }
})

test('registration is scoped to the optional inline slot and cleans up with its context', () => {
  const cleanups: (() => void)[] = []
  const dictionaries = new Map<string, unknown>()
  const registrations = new Map<string, { options: object; component: unknown }>()
  const ctx = {
    effect(callback: () => () => void) { cleanups.push(callback()) },
    locale: {
      register(namespace: string, dictionary: unknown) {
        assert.equal(dictionaries.has(namespace), false)
        dictionaries.set(namespace, dictionary)
        return () => { dictionaries.delete(namespace) }
      },
    },
    slots: {
      inject(slot: string, callback: () => () => void) {
        assert.equal(slot, 'dsh-base.plugins.group.summary')
        cleanups.push(callback())
      },
      register(options: { name: string; locale: string }, component: unknown) {
        assert.equal(registrations.has(options.name), false)
        registrations.set(options.name, { options, component })
        return () => { registrations.delete(options.name) }
      },
    },
  }
  assert.equal(name, '@dsh-base/client-plugin-counts')
  assert.deepEqual(inject, ['slots', 'locale'])
  assert.deepEqual(Config.parse(undefined), {})
  for (let mount = 0; mount < 2; mount += 1) {
    apply(ctx as never)
    assert.equal(dictionaries.get(NS), COUNT_LOCALES)
    assert.deepEqual(registrations.get('dsh-base.plugins.group.summary'), {
      options: { name: 'dsh-base.plugins.group.summary', locale: NS }, component: PluginGroupCount,
    })
    for (const dispose of cleanups.splice(0).reverse()) dispose()
    assert.equal(registrations.size, 0)
    assert.equal(dictionaries.size, 0)
  }
})
