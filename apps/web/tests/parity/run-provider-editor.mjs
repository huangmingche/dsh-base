#!/usr/bin/env node
/** Actual official DeepSeek provider editor with fake credential transport. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { acceptanceLaunchOptions } from '../../scripts/acceptance-config.mjs'
const app = resolve(import.meta.dirname, '../..')
const requireFromApp = createRequire(resolve(app, 'package.json'))
const puppeteer = requireFromApp('puppeteer-core').default
const vite = await import(requireFromApp.resolve('vite'))
const output = resolve(app, 'dist/parity-evidence/provider-editor')
let browser, server
try {
  await mkdir(output, { recursive: true })
  await vite.build({ configFile: resolve(app, 'vite.parity.config.ts'), logLevel: 'error' })
  server = await vite.preview({ configFile: resolve(app, 'vite.parity.config.ts'), logLevel: 'error', preview: { host: '127.0.0.1', port: 0, strictPort: true } })
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await puppeteer.launch(acceptanceLaunchOptions())
  const shots = []
  for (const locale of ['en', 'zh']) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 1000 })
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(`${origin}/?${new URLSearchParams({ surface: 'provider-editor', locale })}`, { waitUntil: 'networkidle0' })
    try { await page.waitForSelector('.provider-editor-fixture') } catch (error) { console.error('EDITOR DEBUG', JSON.stringify({ body: (await page.evaluate(() => document.body.innerText)).slice(0,1200), errors })); throw error }
    const applyLabel = locale === 'zh' ? '保存' : 'Apply'
    const clickApply = async () => page.evaluate(label => [...document.querySelectorAll('.provider-editor-fixture button')].find(button => button.textContent.trim() === label)?.click(), applyLabel)
    await page.type('input[type="password"]', 'fake-deepseek-key-1')
    await clickApply()
    await page.waitForFunction(() => document.querySelector('[data-testid="credential"]')?.textContent === 'fake-deepseek-key-1')
    const writesAfterSave = await page.$eval('[data-testid="writes"]', element => element.textContent)
    await clickApply()
    await new Promise(resolveWait => setTimeout(resolveWait, 200))
    assert.equal(await page.$eval('[data-testid="credential"]', element => element.textContent), 'fake-deepseek-key-1', `${locale}: blank save keeps key`)
    assert.equal(await page.$eval('[data-testid="writes"]', element => element.textContent), writesAfterSave, `${locale}: blank save does not rewrite settings`)
    await page.evaluate(() => window.__PROVIDER_EDITOR_FIXTURE__.failNext())
    await page.type('input[type="password"]', 'fake-deepseek-key-2')
    await clickApply()
    await page.waitForFunction(text => (document.querySelector('.provider-editor-fixture')?.textContent ?? '').includes(text), {}, 'fixture credential transport failure')
    const enabled = await page.evaluate(label => [...document.querySelectorAll('.provider-editor-fixture button')].some(button => button.textContent.trim() === label && !button.disabled), applyLabel)
    assert.equal(enabled, true, `${locale}: failed save releases busy for retry`)
    await clickApply()
    // Real settings operations: custom endpoint and catalog persist across remount.
    await page.evaluate(label => { const item = [...document.querySelectorAll('.provider-editor-fixture summary')].find(entry => entry.textContent.trim() === label); item?.click(); item?.parentElement?.setAttribute('open', '') }, locale === 'zh' ? '自定义设置' : 'Customized settings')
    const baseLabel = locale === 'zh' ? 'API 地址' : 'Base URL'
    const modelIdLabel = locale === 'zh' ? '模型 ID' : 'Model ID'
    try { await page.waitForSelector(`input[aria-label=${JSON.stringify(baseLabel)}]`, { timeout: 10000 }) } catch (error) { console.error('SETTINGS DEBUG', JSON.stringify(await page.evaluate(() => ({ body: document.querySelector('.provider-editor-fixture')?.innerHTML.slice(0, 3000), labels: [...document.querySelectorAll('input')].map(i => i.getAttribute('aria-label')) })))); throw error }
    await page.click(`input[aria-label=${JSON.stringify(baseLabel)}]`)
    await page.type(`input[aria-label=${JSON.stringify(baseLabel)}]`, 'https://owner.example/v1')
    const modelInput = await page.evaluate(label => {
      const input = [...document.querySelectorAll('input[aria-label]')].find(input => (input.getAttribute('aria-label') ?? '').startsWith(label))
      if (input === null) return false
      input.focus(); input.select(); return true
    }, modelIdLabel)
    assert.equal(modelInput, true, `${locale}: model id input present`)
    await page.keyboard.type('custom-model')
    await clickApply()
    await page.waitForFunction(() => document.querySelector('[data-testid="endpoint"]')?.textContent === 'https://owner.example/v1')
    assert.match(await page.$eval('[data-testid="catalog"]', element => element.textContent ?? ''), /custom-model/, `${locale}: custom model persisted`)
    await page.click('[data-testid="remount"]')
    await page.evaluate(label => { const item = [...document.querySelectorAll('.provider-editor-fixture summary')].find(entry => entry.textContent.trim() === label); if (item?.parentElement?.hasAttribute('open') === false) item.click(); item?.parentElement?.setAttribute('open', '') }, locale === 'zh' ? '自定义设置' : 'Customized settings')
    await page.waitForFunction(label => document.querySelector(`input[aria-label=${JSON.stringify(label)}]`)?.value === 'https://owner.example/v1', {}, baseLabel)
    const shot = resolve(output, `deepseek-editor-${locale}.png`)
    await page.screenshot({ path: shot, captureBeyondViewport: false }); shots.push(shot)
    assert.deepEqual(errors, [])
    await page.close()
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ ok: true, scope: 'actual official DeepSeek ProviderEditor, fake credential transport: save, blank keeps key, failure releases busy and retries', shots }, null, 2))
  console.log(JSON.stringify({ ok: true, screenshots: shots }))
} finally {
  await browser?.close().catch(() => undefined)
  await server?.close().catch(() => undefined)
}
