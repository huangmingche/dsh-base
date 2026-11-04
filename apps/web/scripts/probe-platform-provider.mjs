#!/usr/bin/env node
/** Local platform-enabled UI probe: independent provider cards, composer groups, explicit selection. No model claim/call. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { join, resolve } from 'node:path'
import { chromeExecutable, closeAcceptanceBrowser } from './acceptance-config.mjs'
import puppeteer from 'puppeteer-core'
const app = resolve(import.meta.dirname, '..')
const port = 5191
const base = `http://127.0.0.1:${port}`
const registrationToken = randomBytes(32).toString('base64url')
const platformState = process.argv[2] === 'disabled' ? 'disabled' : 'enabled'
const output = resolve(app, `../../.artifacts/acceptance/platform-provider-${platformState}`)
mkdirSync(output, { recursive: true })
const server = spawn(process.execPath, [join(app, 'scripts/serve-local.mjs')], {
  cwd: app,
  env: { ...process.env, DSH_LOCAL_PORT: String(port), DSH_LOCAL_REGISTRATION_TOKEN: registrationToken, DSH_LOCAL_FORBID_OUTBOUND: '1', DSH_LOCAL_PLATFORM_AI: platformState === 'enabled' ? '1' : '0', DSH_LOCAL_COMPATIBILITY_DATE: '2026-10-30' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout.on('data', chunk => { serverLog += String(chunk) })
server.stderr.on('data', chunk => { serverLog += String(chunk) })
const waitReady = () => new Promise((resolveReady, reject) => {
  const deadline = Date.now() + 120_000
  const poll = () => {
    httpRequest({ host: '127.0.0.1', port, path: '/api/health', method: 'GET' }, response => { response.resume(); resolveReady() }).on('error', () => {
      if (Date.now() > deadline) reject(new Error(`local Worker did not start: ${serverLog}`))
      else setTimeout(poll, 250)
    }).end()
  }
  poll()
})
let browser
try {
  await waitReady()
  await new Promise(resolve => setTimeout(resolve, 3_000))
  const account = { username: `platform${randomBytes(8).toString('hex')}`, name: 'Platform provider probe', email: `platform-${randomBytes(8).toString('hex')}@example.test`, password: randomBytes(32).toString('base64url') }
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-dsh-registration-token': registrationToken }, body: JSON.stringify(account) })
  assert.equal(signup.status, 200, await signup.clone().text())
  const cookie = signup.headers.getSetCookie().join('; ').match(/(better-auth\.session_token)=([^;]+)/u)
  const cookieHeader = `${cookie[1]}=${cookie[2]}`
  const hostCall = async (method, params = {}) => {
    const response = await fetch(`${base}/api/session-host`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie: cookieHeader }, body: JSON.stringify({ method, params }) })
    const body = await response.json()
    if (response.status !== 200) throw new Error(`${method}: ${JSON.stringify(body)}`)
    return body.result
  }
  const session = await hostCall('create', {})
  const sessionId = session.sessionId
  await hostCall('prompt', { sessionId, requestId: 'probe', text: 'provider probe' })
  await hostCall('cancel', { sessionId })
  browser = await puppeteer.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.setCookie({ name: cookie[1], value: cookie[2], url: base, httpOnly: true, sameSite: 'Lax' })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(`${base}/agent/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForSelector('[contenteditable="true"]', { timeout: 60_000 })
  const click = async pattern => {
    await page.waitForFunction(source => {
      const re = new RegExp(source, 'iu')
      return [...document.querySelectorAll('button,[role="button"],[role="menuitem"],a')].some(element => [element.textContent, element.getAttribute('aria-label')].some(label => re.test(label?.trim() ?? '')) && element.getBoundingClientRect().width > 0 && !element.matches(':disabled'))
    }, { timeout: 20_000 }, pattern)
    await page.evaluate(source => {
      const re = new RegExp(source, 'iu')
      ;[...document.querySelectorAll('button,[role="button"],[role="menuitem"],a')].find(element => [element.textContent, element.getAttribute('aria-label')].some(label => re.test(label?.trim() ?? '')) && element.getBoundingClientRect().width > 0 && !element.matches(':disabled'))?.click()
    }, pattern)
  }
  await click('account menu|账号菜单')
  await click('^settings\\b|^设置')
  await page.waitForSelector('[role="dialog"] nav button', { timeout: 20_000 })
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] nav button')].find(item => /^(Models|模型)$/u.test(item.textContent?.trim() ?? ''))?.click())
  await page.waitForSelector('[data-gateway-provider]', { timeout: 20_000 })
  assert.equal(await page.$eval('[data-gateway-provider]', el => el.getAttribute('data-gateway-provider')), platformState === 'enabled' ? 'available' : 'unavailable')
  const configuredDots = await page.$$eval('[data-gateway-row] [class*="credentialDot"]', nodes => nodes.length)
  assert.equal(configuredDots, platformState === 'enabled' ? 1 : 0, `${platformState}: green credential dot truthfulness`)
  assert.equal(await page.$$eval('[data-gateway-row] [class*="rowTag"]', nodes => nodes.length), 0, 'no custom status text pill')
  if (platformState === 'enabled') {
    const dot = await page.$eval('[data-gateway-row] [class*="credentialDot"]', element => ({ role: element.getAttribute('role'), title: element.getAttribute('title'), background: getComputedStyle(element).backgroundColor, width: getComputedStyle(element).width }))
    assert.equal(dot.role, 'img'); assert.ok(dot.title && dot.title.length > 0); assert.equal(dot.width, '8px')
  }
  const dialog = await page.$eval('[role="dialog"]', el => el.innerText)
  assert.match(dialog, /DeepSeek/u)
  assert.match(dialog, /Cloudflare AI Gateway/u)
  // The actual official DeepSeek row beside the Gateway row is the pinned
  // rendered reference for height/typography/actions, not a recreated markup.
  const rowGeometry = await page.evaluate(() => {
    const gateway = document.querySelector('[data-gateway-row]')
    const official = gateway?.previousElementSibling
    const inspect = row => {
      if (!row) return null
      const style = getComputedStyle(row)
      const button = row.querySelector('button')
      const buttonStyle = button === null ? null : getComputedStyle(button)
      return {
        height: row.getBoundingClientRect().height,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(' '),
        radius: style.borderRadius, border: style.borderTopWidth, gap: style.gap,
        buttonHeight: button?.getBoundingClientRect().height ?? null,
        buttonPadding: buttonStyle === null ? null : [buttonStyle.paddingTop, buttonStyle.paddingRight, buttonStyle.paddingBottom, buttonStyle.paddingLeft].join(' '),
        buttonFont: buttonStyle?.fontSize ?? null,
        buttonRadius: buttonStyle?.borderRadius ?? null,
      }
    }
    return { official: inspect(official), gateway: inspect(gateway) }
  })
  if (platformState === 'enabled') {
    assert.ok(rowGeometry.official && rowGeometry.gateway, 'official DeepSeek and Gateway rows both rendered')
    for (const key of ['height', 'padding', 'radius', 'border', 'gap', 'buttonHeight', 'buttonPadding', 'buttonFont', 'buttonRadius']) {
      assert.equal(rowGeometry.gateway[key], rowGeometry.official[key], `Gateway row/action ${key} must match official DeepSeek row`)
    }
  }
  await page.screenshot({ path: join(output, 'providers-platform-en.png') })
  let officialGap = null
  if (platformState === 'enabled') {
  // Default-collapsed details use the official compact-row disclosure.
  await page.evaluate(() => {
    const row = document.querySelector('[data-gateway-row]')
    const button = [...(row?.querySelectorAll('button') ?? [])].find(item => /^(Details|详情)$/u.test((item.textContent ?? '').trim()))
    button?.click()
  })
  await page.waitForFunction(() => document.querySelector('[data-gateway-row] [role="region"]')?.hasAttribute('hidden') === false, { timeout: 20_000 })
  const gatewayDetails = await page.$eval('[data-gateway-row] [role="region"]', element => element.innerText)
  assert.match(gatewayDetails, /cloudflare-ai-gateway/u)
  assert.match(gatewayDetails, /Status|状态/u)
  assert.match(gatewayDetails, /Authentication|认证/u)
  assert.match(gatewayDetails, /Models|模型/u)
  await page.screenshot({ path: join(output, 'gateway-details-en.png') })
  const clickRowButton = async (rowSelector, label) => page.evaluate(([row, text]) => {
    const button = [...(document.querySelector(row)?.querySelectorAll('button') ?? [])].find(item => (item.textContent ?? '').trim() === text)
    button?.click()
  }, [rowSelector, label])
  const clickOfficialButton = async label => page.evaluate(text => {
    const official = document.querySelector('[data-gateway-row]')?.previousElementSibling
    const button = [...(official?.querySelectorAll('button') ?? [])].find(item => (item.textContent ?? '').trim() === text)
    button?.click()
  }, label)
  // Gateway -> official DeepSeek: one card at a time.
  await clickOfficialButton('Edit')
  await page.waitForSelector('[role="dialog"] input[type="password"]', { timeout: 20_000 })
  const afterDeepSeek = await page.evaluate(() => ({
    gatewayExpanded: document.querySelector('[data-gateway-row] button[aria-expanded]')?.getAttribute('aria-expanded'),
    gatewayPanelHidden: document.querySelector('[data-gateway-row] [role="region"]')?.hasAttribute('hidden'),
  }))
  assert.equal(afterDeepSeek.gatewayExpanded, 'false', 'official DeepSeek Edit closes Gateway first')
  assert.equal(afterDeepSeek.gatewayPanelHidden, true, 'Gateway details stay closed while DeepSeek editor is open')
  officialGap = await page.evaluate(() => {
    const official = document.querySelector('[data-gateway-row]')?.previousElementSibling
    const head = official?.querySelector('[class*="rowHead"]')
    const editor = official?.querySelector('[class*="editor"]')
    return head && editor ? Math.round(editor.getBoundingClientRect().top - head.getBoundingClientRect().bottom) : null
  })
  assert.equal(officialGap, 12, 'official row/editor external gap is 12px')
  await clickOfficialButton('Cancel')
  await page.waitForFunction(() => !document.querySelector('[role="dialog"] input[type="password"]'), { timeout: 20_000 })
  // DeepSeek -> Gateway: opening Gateway closes the official editor too.
  await clickOfficialButton('Edit')
  await page.waitForSelector('[role="dialog"] input[type="password"]', { timeout: 20_000 })
  await clickRowButton('[data-gateway-row]', 'Details')
  await page.waitForFunction(() => document.querySelector('[data-gateway-row] [role="region"]')?.hasAttribute('hidden') === false, { timeout: 20_000 })
  const afterGateway = await page.evaluate(() => ({
    deepSeekEditor: document.querySelector('[data-gateway-row]')?.previousElementSibling?.querySelector('input[type="password"]') !== null,
    gatewayGap: (() => {
      const row = document.querySelector('[data-gateway-row]')
      const head = row?.querySelector('[class*="rowHead"]')
      const editor = row?.querySelector('[role="region"] [class*="editor"]')
      return head && editor ? Math.round(editor.getBoundingClientRect().top - head.getBoundingClientRect().bottom) : null
    })(),
  }))
  assert.equal(afterGateway.deepSeekEditor, false, 'Gateway Details closes the official DeepSeek editor')
  assert.equal(afterGateway.gatewayGap, officialGap, 'Gateway row/editor external gap matches official DeepSeek gap')
  await page.screenshot({ path: join(output, 'gateway-mutual-exclusion-en.png') })
  await page.keyboard.press('Escape')
  // Composer provider directory: both proven groups and explicit Gateway selection.
  const chooser = await page.evaluate(() => [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(button => /DeepSeek|Cloudflare/u.test(button.textContent ?? ''))?.textContent)
  assert.ok(chooser)
  await page.evaluate(() => [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(button => /DeepSeek|Cloudflare/u.test(button.textContent ?? ''))?.click())
  await page.waitForSelector('[role="menuitem"]', { timeout: 20_000 })
  const menu = await page.$$eval('[role="menuitem"]', items => items.map(item => item.textContent ?? ''))
  assert.ok(menu.some(text => /^Model|^模型/u.test(text.trim())), 'model picker row present')
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find(item => /^Model|^模型/u.test((item.textContent ?? '').trim()))?.click())
  await new Promise(resolveWait => setTimeout(resolveWait, 500))
  await page.screenshot({ path: join(output, 'composer-menu-en.png') })
  const pickerText = await page.evaluate(() => document.body.innerText)
  assert.match(pickerText, /Cloudflare AI Gateway/u, 'composer offers Cloudflare AI Gateway group')
  assert.match(pickerText, /DeepSeek/u, 'composer retains DeepSeek group')
  // Platform-enabled default is the selected Gateway model; the official
  // composer renders the independent DeepSeek, Gateway and legacy groups.
  assert.doesNotMatch(pickerText, /legacy compatibility/u, 'legacy is not offered as a new selectable provider')
  assert.match(pickerText, /DeepSeek-V4\.1-Flash/u)
  await page.keyboard.press('Escape')
  await new Promise(resolveWait => setTimeout(resolveWait, 1000))
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, platformState, sessionId, officialGap, screenshots: platformState === 'enabled' ? [join(output, 'providers-platform-en.png'), join(output, 'gateway-details-en.png'), join(output, 'gateway-mutual-exclusion-en.png')] : [join(output, 'providers-platform-en.png')] }))
} finally {
  await closeAcceptanceBrowser(browser).catch(() => undefined)
  server.kill('SIGTERM')
}
