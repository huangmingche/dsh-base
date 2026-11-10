import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parsePlans,publicCatalogFromDeployment} from '../src/catalog.ts';
import {readSaasConfig,saasTextBindings} from '../../../../apps/web/scripts/saas-config.mjs';
const plan={id:'pro',name:'Pro',productId:'PROD_1234567890abcdefghijkl',type:'subscription',currency:'USD',price:{amount:'19.00',interval:'month',intervalCount:1}};
test('public prices and feature claims derive only from strict deployment declarations',()=>{
 const config=readSaasConfig({waffoPlans:[plan],entitlementFeatures:[{id:'ai',label:'Platform AI',planIds:['pro']}],entitlementOperations:{platform_ai:'ai'},platformAiMaxOutputTokens:128});
 const catalog=publicCatalogFromDeployment(config);assert.equal(catalog.ready,false);assert.equal(catalog.priceSource,'deployment');assert.equal(catalog.plans[0]!.price!.amount,'19.00');assert.deepEqual(catalog.plans[0]!.features,[{id:'ai',label:'Platform AI'}]);
 assert.deepEqual(publicCatalogFromDeployment({}).plans,[]);assert.deepEqual(publicCatalogFromDeployment({waffoPlans:[{...plan,price:undefined}]}).plans[0]!.price,undefined);
 const bindings=saasTextBindings(config);assert.equal(bindings.ENTITLEMENTS_OPERATIONS_JSON,'{"platform_ai":"ai"}');assert.equal(bindings.PLATFORM_AI_MAX_OUTPUT_TOKENS,'128');
 assert.equal(saasTextBindings(readSaasConfig()).ENTITLEMENTS_OPERATIONS_JSON,'{}');assert.equal(saasTextBindings(readSaasConfig()).PLATFORM_AI_MAX_OUTPUT_TOKENS,'');
});
test('configuration rejects invented precision, invalid periods and unbacked entitlement claims',()=>{
 for(const price of [{amount:'19.001',interval:'month',intervalCount:1},{amount:'1e2',interval:'year',intervalCount:1},{amount:'10',interval:'month',intervalCount:0},{amount:'10'}])assert.equal(parsePlans([{...plan,price}]),undefined);
 assert.equal(parsePlans([{...plan,type:'one_time'}]),undefined);assert.equal(parsePlans([{...plan,currency:'JPY',price:{amount:'19.50',interval:'month',intervalCount:1}}]),undefined);
 for(const change of [{entitlementOperations:{platform_ai:'undeclared'}},{entitlementOperations:null},{platformAiMaxOutputTokens:-1},{platformAiMaxOutputTokens:131073},{entitlementFeatures:[{id:'ai',planIds:['unknown']}]}])assert.throws(()=>readSaasConfig({waffoPlans:[plan],...change}));
});
