import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readDeploymentConfig } from '../../../apps/web/scripts/deployment-config.mjs';
import { readSaasConfig, saasTextBindings } from '../../../apps/web/scripts/saas-config.mjs';
test('external SaaS providers default off, no credentials accepted in deployment JSON', () => {
  const value=readSaasConfig();
  for(const key of ['waffoEnabled','emailEnabled','googleEnabled','newsletterEnabled','contactEnabled','notificationsEnabled','crispEnabled','cacheEnabled'])assert.equal(value[key],false,key);
  for(const key of ['RESEND_API_KEY','GOOGLE_CLIENT_SECRET','WAFFO_PRIVATE_KEY','__proto__'])assert.throws(()=>readSaasConfig(JSON.parse(`{"${key}":"secret"}`)),/Unknown SaaS/);
  assert.throws(()=>readSaasConfig({emailEnabled:'true'}),/Invalid SaaS/);
  assert.throws(()=>readSaasConfig({cacheEnabled:true}),/existing cacheNamespaceId/);
  assert.throws(()=>readSaasConfig({waffoEnvironment:'sandbox'}),/test or prod/);
  assert.throws(()=>readSaasConfig({entitlementFeatures:[{id:'premium',planIds:['unknown']}]}),/reference/);
  assert.equal(saasTextBindings(value).WAFFO_ENABLED,'false');
  const config=readDeploymentConfig({DSH_SAAS_JSON:'{"emailEnabled":true,"emailProvider":"resend"}'},undefined,{});
  assert.equal(config.saas.emailEnabled,true);assert.equal(config.saas.emailProvider,'resend');
  value.waffoPlans.push({id:'local-test'});assert.deepEqual(readSaasConfig().waffoPlans,[]);
});
