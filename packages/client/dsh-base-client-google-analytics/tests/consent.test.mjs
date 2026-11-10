import assert from 'node:assert/strict';
import test from 'node:test';
import {ConversionConsent,conversionConsentSnapshot,conversionConsentHeaders} from '../src/client/consent.ts';
const available = {google:{measurementId:'G-TEST1234',ready:true}, conversions:{mode:'google',campaigns:['launch']}};
test('consent is explicit, memory-only, scope-bound, revocable and reset when destination disappears',()=>{
 const controller=new ConversionConsent(()=>new URL('https://app.test/?utm_campaign=launch&email=private@example.test#private'));
 assert.deepEqual(conversionConsentSnapshot(),{consent:false});const unmount=controller.mount();
 controller.setConsent(true);assert.equal(controller.getSnapshot().consent,false);
 controller.configure(available);assert.equal(controller.getSnapshot().available,true);assert.deepEqual(conversionConsentHeaders(),{});
 controller.setConsent(true);assert.deepEqual(conversionConsentSnapshot(),{consent:true,campaign:'launch'});
 assert.deepEqual(conversionConsentHeaders(),{'x-dsh-analytics-consent':'granted','x-dsh-analytics-campaign':'launch'});
 controller.configure({...available,conversions:{mode:'google',campaigns:[]}});assert.deepEqual(conversionConsentSnapshot(),{consent:true});
 controller.setConsent(false);assert.deepEqual(conversionConsentHeaders(),{});
 controller.configure(available);controller.setConsent(true);controller.configure({...available,conversions:{mode:'aggregate'}});assert.deepEqual(conversionConsentSnapshot(),{consent:false});
 controller.configure(available);controller.setConsent(true);unmount();assert.deepEqual(conversionConsentSnapshot(),{consent:false});
 const reloaded=new ConversionConsent(()=>new URL('https://app.test/'));reloaded.configure(available);assert.equal(reloaded.getSnapshot().consent,false);
});
test('unapproved or ambiguous campaign queries never become attribution labels',()=>{
 for(const query of ['?utm_campaign=private@example.test','?utm_campaign=launch&utm_campaign=launch','?email=launch']){
 const controller=new ConversionConsent(()=>new URL('https://app.test/'+query));controller.configure(available);const stop=controller.mount();controller.setConsent(true);
 assert.deepEqual(conversionConsentSnapshot(),{consent:true});stop();
 }
});
