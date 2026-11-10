import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renderNotice} from '../src/notices.ts';
import type {EmailConfig,NoticeEmail} from '../src/types.ts';
const config={origin:'https://app.example',from:'hello@example.test'} as EmailConfig;
const confirmation={kind:'newsletter-confirm',to:'alice@example.test',actionUrl:'https://app.example/?newsletterToken='+'a'.repeat(64),idempotencyKey:'fixture'} as const;
test('newsletter links require one token and notices validate locale before rendering',()=>{
 assert.ok(renderNotice({},config,confirmation).html.includes('newsletterToken'));
 assert.throws(()=>renderNotice({},config,{...confirmation,actionUrl:confirmation.actionUrl+'&newsletterToken='+'b'.repeat(64)}));
 assert.throws(()=>renderNotice({},config,{...confirmation,locale:{} as string}));
 assert.throws(()=>renderNotice({},config,{...confirmation,actionUrl:'https://other.example/?newsletterToken='+'a'.repeat(64)}));
});
test('contact content is escaped and recipient is deployment-owned',()=>{
 const input:NoticeEmail={kind:'contact-message',name:'<script>',email:'alice@example.test',message:'<img src=x onerror=alert(1)>',idempotencyKey:'fixture'};
 const rendered=renderNotice({CONTACT_SUPPORT_EMAIL:'support@example.test'},config,input);
 assert.equal(rendered.to,'support@example.test');assert.ok(!rendered.html.includes('<script>'));assert.ok(rendered.html.includes('&lt;img'));
});
