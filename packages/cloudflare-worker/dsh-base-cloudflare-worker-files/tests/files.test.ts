import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFilesHandler} from '../src/index.ts';
test('an upload whose metadata vanished is cleaned up instead of returning success',async()=>{
 const operations:string[]=[];
 const db={withSession(){return {prepare(sql:string){return {bind(){return {async first(){operations.push('claim');return{id:'fixture'};},async run(){operations.push(sql.startsWith('DELETE')?'cleanup-row':'finalize');return{meta:{changes:0}};}};}};}};}};
 const bucket={async put(){operations.push('put');},async delete(){operations.push('delete');}};
 const handler=createFilesHandler({async session(){return{id:'alice',username:'alice',email:'alice@example.test'};}});
 const response=await handler(new Request('https://app.example/api/saas/files?name=test.txt',{method:'POST',headers:{origin:'https://app.example','content-type':'text/plain'},body:'hello'}),{FILES_ENABLED:'true',AUTH_DB:db,FILES:bucket});
 assert.equal(response!.status,409);assert.deepEqual(operations,['claim','put','finalize','delete','cleanup-row']);
});
