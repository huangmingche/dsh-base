import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {AuthFace} from '@dsh-base/cloudflare-worker-auth';
import {createProfileHandler} from '../src/index.ts';
const request=(path:string,body:unknown)=>new Request('https://app.example/api/saas/account-profile'+path,{method:path? 'POST':'PUT',headers:{origin:'https://app.example','content-type':'application/json','content-length':'999'},body:JSON.stringify(body)});
test('password rotation preserves every new session cookie without returning the token',async()=>{
 let forwarded:Request|undefined;
 const auth={async session(){return{id:'alice'};},async handle(req:Request){forwarded=req;const response=Response.json({token:'must-not-leak'});response.headers.append('set-cookie','session=new; HttpOnly; Secure');response.headers.append('set-cookie','other=value; Secure');return response;}} as unknown as AuthFace;
 const handler=createProfileHandler(auth);
 const result=await handler(request('/password',{currentPassword:'old-password',newPassword:'new-password'}),{AUTH_DB:{withSession(){return{};}}});
 assert.equal(result!.status,200);assert.deepEqual(result!.headers.getSetCookie(),['session=new; HttpOnly; Secure','other=value; Secure']);
 assert.deepEqual(await result!.json(),{ok:true});assert.equal(forwarded!.headers.get('content-length'),null);
 assert.equal((await forwarded!.json() as {revokeOtherSessions:boolean}).revokeOtherSessions,true);
});
test('a file deleted after the avatar lookup cannot become the new profile image',async()=>{
 const auth={async session(){return{id:'alice'};}} as unknown as AuthFace;
 const db={withSession(){return {prepare(sql:string){return {bind(){return {async first(){return{id:'image-id'};},async run(){assert.ok(sql.includes('EXISTS'));return{meta:{changes:0}};}};}};}};}};
 const response=await createProfileHandler(auth)(request('',{name:'Alice',avatarFileId:'image-id'}),{AUTH_DB:db});
 assert.equal(response!.status,409);assert.deepEqual(await response!.json(),{error:'avatar_changed'});
});
