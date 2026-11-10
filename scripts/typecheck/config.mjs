/** Generate separate source resolution projects without writing into the pinned dependency. */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { clientRows, localPackages, officialPackages } from '../conformance/lib.mjs';
import { buildContext, cliProductRoot } from '../build/product-paths.mjs';
import { createTypecheckProgram } from './compiler.mjs';
import { serverPackageNames, serverPackageDirectory } from '../../packages/build/dsh-base-build-server-dependencies/src/resolution.mjs';
const context=buildContext(cliProductRoot());
const { productRoot: repoRoot, baseRoot, appRoot: app, upstreamRoot: source, typecheckRoot: output }=context;
const packages=localPackages(repoRoot), official=officialPackages(repoRoot);
const appRequire=createRequire(join(app,'package.json'));
const ts=appRequire("typescript");
const uncomment=source=>source.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g,(m,s)=>s??m.replace(/[^\n]/g,' ')).replace(/,\s*([}\]])/g,'$1');
const paths={};
const upstream=JSON.parse(uncomment(readFileSync(join(source,'tsconfig.base.json'),'utf8')));
for(const [key,values]of Object.entries(upstream.compilerOptions.paths))paths[key]=values.map(value=>resolve(source,value));
for(const [name,p]of official){if(p.manifest.exports?.['./src/*'])paths[name+'/src/*']=[join(p.directoryPath,'src/*')];if(p.manifest.exports?.['./locale/*.json'])paths[name+'/locale/*.json']=[join(p.directoryPath,'locale/*.json')];}
function typeTarget(value){if(typeof value==='string')return value;if(Array.isArray(value))return value.map(typeTarget).find(Boolean);if(value&&typeof value==='object'){for(const key of ['types','import','default','node','require'])if(value[key]!==undefined){const result=typeTarget(value[key]);if(result)return result;}}}
function installedTypeFile(directory,target){const file=resolve(directory,target);return [file.replace(/\.mjs$/,".d.mts").replace(/\.cjs$/,".d.cts").replace(/\.js$/,".d.ts"),file].find(candidate=>existsSync(candidate))??file;}
function register(manifest,directory){const exports=manifest.exports;if(exports&&typeof exports==='object'&&Object.keys(exports).some(key=>key.startsWith('.'))){for(const [key,value]of Object.entries(exports)){const target=typeTarget(value);if(target)paths[manifest.name+(key==='.'?'':key.slice(1))]=[installedTypeFile(directory,target)];}}else{const target=manifest.types??manifest.typings??typeTarget(exports)??manifest.main;if(target)paths[manifest.name]=[installedTypeFile(directory,target)];}}
for(const [name,p] of official) for(const [key,value] of Object.entries(p.manifest.exports??{})) {
  if(key.includes("*")||!key.startsWith("."))continue;
  const target=typeTarget(value);
  if(!target?.startsWith("./lib/types/"))continue;
  const candidate=join(p.directoryPath,target.replace("./lib/types/","src/").replace(/\.d\.ts$/,".ts"));
  const candidates=[candidate,candidate.replace(/\.ts$/,".tsx")];
  const actual=candidates.find(file=>existsSync(file));
  if(actual)paths[name+(key==="."?"":key.slice(1))]=[actual];
}
for(const p of packages)register(p.manifest,p.directoryPath);
const appManifest=JSON.parse(readFileSync(join(app,'package.json'),'utf8'));
for(const name of Object.keys({...appManifest.dependencies,...appManifest.devDependencies})){const directory=join(app,'node_modules',name);register(JSON.parse(readFileSync(join(directory,'package.json'),'utf8')),directory);}
for(const name of serverPackageNames){const directory=serverPackageDirectory(name, repoRoot);register(JSON.parse(readFileSync(join(directory,'package.json'),'utf8')),directory);}
for(const name of ['react','react-dom','big.js']){const directory=join(app,'node_modules/@types',name);register({...JSON.parse(readFileSync(join(directory,'package.json'),'utf8')),name},directory);paths[name]=[join(directory,'index.d.ts')];paths[name+'/*']=[join(directory,'*')];}
const nodeTypes=dirname(appRequire.resolve('@types/node/package.json'));
// Rebuild the validated consumer directory so stale declarations and nested
// symlinks cannot redirect compiler writes into either read-only dependency.
if(context.isolated)rmSync(output,{recursive:true,force:true});
mkdirSync(output,{recursive:true});
// Preserve official dependency project options (Cordis intentionally permits dynamic services),
// emitting only declarations outside the read-only checkout before checking strict owned code.
for (const name of ["@deepseek-ai/cosmokit", "@deepseek-ai/cordis", "@deepseek-ai/schemastery", "@deepseek-ai/dsh-util-crypto"]) {
  const pkg=official.get(name);
  if(!pkg)throw new Error(`missing pinned dependency ${name}`);
  const configPath=join(pkg.directoryPath,"tsconfig.json");
  const read=ts.readConfigFile(configPath,ts.sys.readFile);
  const parsed=ts.parseJsonConfigFileContent(read.config,ts.sys,pkg.directoryPath);
  const outDir=join(output,"official",name.slice("@deepseek-ai/".length));
  const options={...parsed.options,paths:{...paths},typeRoots:[join(app,"node_modules/@types")],types:["node"],rootDir:join(pkg.directoryPath,"src"),outDir,composite:false,incremental:false,noEmit:false,declaration:true,declarationMap:false,sourceMap:false,emitDeclarationOnly:true};
  const program=createTypecheckProgram(ts,{rootNames:parsed.fileNames,options},context);
  const diagnostics=ts.getPreEmitDiagnostics(program);
  if(diagnostics.length){console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>repoRoot,getNewLine:()=>"\n"}));process.exit(1);}
  const emitted=program.emit();if(emitted.emitSkipped)throw new Error(`declaration emission failed: ${name}`);
  paths[name]=[join(outDir,"index.d.ts")];
}
const base={target:'ES2024',module:'ESNext',moduleResolution:'Bundler',lib:['ES2024','ESNext.Disposable'],strict:true,skipLibCheck:true,noEmit:true,allowImportingTsExtensions:true,resolveJsonModule:true,esModuleInterop:true,types:[],paths};
const sourcePatterns=groups=>packages.filter(pkg=>groups.includes(pkg.group)).flatMap(pkg=>['ts','tsx','mts','cts'].map(extension=>join(pkg.directoryPath,`src/**/*.${extension}`)));
const runtimeRoots=[...new Set([join(baseRoot,'apps/web'),app])];
const worker={compilerOptions:base,files:[join(app,'node_modules/@cloudflare/workers-types/index.d.ts'),join(nodeTypes,'index.d.ts')],include:[...sourcePatterns(['cloudflare-worker','cloudflare-think']),...runtimeRoots.flatMap(root=>[join(root,'src/server.ts'),join(root,'src/worker/**/*.ts'),join(root,'src/agent/**/*.ts')]),...(context.isolated?[join(context.generatedRoot,context.appPath,'src/worker/**/*.ts'),join(context.generatedRoot,context.appPath,'src/agent/**/*.ts')]:[])]};
writeFileSync(join(output,'worker.json'),JSON.stringify(worker,null,2)+'\n');
const activeEntries=clientRows(repoRoot,{app:context.appId}).filter(row=>row.disabled!==true).map(row=>ts.resolveModuleName(row.module??row.name,join(app,"src/client/main.tsx"),{moduleResolution:ts.ModuleResolutionKind.Bundler,paths},ts.sys).resolvedModule?.resolvedFileName).filter(Boolean);
const browserSupportSources=packages.filter(pkg=>pkg.group==="boot"&&pkg.manifest.dshBase?.boot?.kind==="browser-support").flatMap(pkg=>["ts","tsx","mts","cts"].map(extension=>join(pkg.directoryPath,`src/**/*.${extension}`)));
const client={compilerOptions:{...base,lib:["ES2024","ESNext.Disposable","DOM","DOM.Iterable"],jsx:"react-jsx",paths:{...paths,...(existsSync(join(output,"remote-paths.json"))?JSON.parse(readFileSync(join(output,"remote-paths.json"),"utf8")):{})}},files:[...activeEntries,join(source,"scripts/types/client-build-environment/index.d.ts"),join(source,"scripts/types/client-assets/index.d.ts")],include:[...sourcePatterns(["client"]),...browserSupportSources,...runtimeRoots.flatMap(root=>[join(root,"src/client/**/*.ts"),join(root,"src/client/**/*.tsx"),join(root,"src/virtual.d.ts")]),join(source,"packages/client/*/src/**/*.d.ts")]};
writeFileSync(join(output,"client.json"),JSON.stringify(client,null,2)+"\n");
const build={compilerOptions:{...base,allowJs:true,checkJs:false,types:["node"],typeRoots:[join(app,"node_modules/@types")]},files:[join(nodeTypes,"index.d.ts"),...[join(app,"vite.config.ts"),join(app,"vite.parity.config.ts")].filter(existsSync)]};
writeFileSync(join(output,"build.json"),JSON.stringify(build,null,2)+"\n");
console.log(`Generated separate Worker, Client and build configuration projects in ${output}`);
