import {spawn,execFile} from 'node:child_process';
import {createInterface} from 'node:readline';
import {promisify} from 'node:util';
import {access,mkdir,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {launchEnvironment,findProgram} from './launch-env.mjs';
const exec=promisify(execFile);
export function codexEnvironment(source=process.env,{platform=process.platform,home=homedir()}={}){
  return launchEnvironment(source,{platform,home,
    unixKeys:['HOME','USER','LOGNAME','SHELL','TMPDIR','LANG','LC_ALL','LC_CTYPE','CODEX_HOME','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS'],
    windowsKeys:['LANG','CODEX_HOME','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS']});
}
export async function findCodexExecutable(env=codexEnvironment(),{platform=process.platform,check}={}){
  // The Codex desktop app on Windows keeps its program here rather than on PATH.
  const extraFolders=platform==='win32'&&env.LOCALAPPDATA?[join(env.LOCALAPPDATA,'Programs','OpenAI','Codex','bin')]:[];
  const found=await findProgram('codex',env,{platform,extraFolders,...(check?{check}:{})});
  if(found)return found;
  throw new Error('Install Codex, run “codex login” in Terminal, then check the connection again.');
}
// macOS and Linux start Codex through a small shell script that adds the isolation flags. Windows cannot,
// so there the backend runs Codex directly (see codex-direct-exec.mjs).
export const codexNeedsDirectRun=(platform=process.platform)=>platform==='win32';
// An app-owned launcher keeps SDK runs independent of personal config, MCPs,
// hooks and rules, while authentication stays with the installed Codex client.
export async function codexLauncher(directory,executable,{ephemeral=false,platform=process.platform}={}){
  if(codexNeedsDirectRun(platform))return executable;
  await mkdir(directory,{recursive:true,mode:0o700});const file=join(directory,'codex-launcher');
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  await writeFile(file,`#!/bin/sh\nif [ "$1" = exec ]; then\n  shift\n  exec ${quote(executable)} exec --ignore-user-config --ignore-rules${ephemeral?' --ephemeral':''} "$@"\nfi\nexec ${quote(executable)} "$@"\n`,{mode:0o700});return file;
}
export async function getCodexStatus(){
  let installed=false;
  try{
    const env=codexEnvironment(),executable=await findCodexExecutable(env);installed=true;
    const {stdout,stderr}=await exec(executable,['login','status'],{env,timeout:15000,maxBuffer:64000,windowsHide:true});
    const signedIn=/logged in using chatgpt/i.test(stdout+'\n'+stderr);
    return {installed,signedIn,message:signedIn?'Connected to your ChatGPT subscription. Codex plan limits apply.':'Run “codex login” in Terminal and sign in with ChatGPT, then check again.'};
  }catch(error){return {installed,signedIn:false,message:installed?'Run “codex login” in Terminal, then check again.':error.message};}
}
export async function getCodexModels(){
  const env=codexEnvironment(),executable=await findCodexExecutable(env);
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,['app-server','--listen','stdio://','-c','model_provider="openai"'],{env,stdio:['pipe','pipe','pipe'],windowsHide:true});
    const lines=createInterface({input:child.stdout});let settled=false;let models=[],cursor=null;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);lines.close();child.stdin.end();child.kill();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(new Error('Codex model list timed out. Check your connection and try again.')),25000);
    const send=(id,method,params)=>child.stdin.write(JSON.stringify({id,method,params})+'\n');
    child.on('error',error=>finish(error));child.on('exit',()=>{if(!settled)finish(new Error('Codex closed before returning its models.'));});child.stderr.resume();
    lines.on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}if(m.error)return finish(new Error(m.error.message));
      if(m.id===1){child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');send(2,'model/list',{limit:100,includeHidden:false});}
      if(m.id===2){models.push(...(m.result?.data||[]));cursor=m.result?.nextCursor;if(cursor)send(2,'model/list',{limit:100,includeHidden:false,cursor});else finish(null,models.filter(m=>!m.hidden).map(m=>({id:m.model||m.id,name:m.displayName||m.model||m.id,isDefault:!!m.isDefault,defaultEffort:m.defaultReasoningEffort||'medium',efforts:(m.supportedReasoningEfforts||[]).map(e=>e.reasoningEffort)})));}
    });
    send(1,'initialize',{clientInfo:{name:'gratis_desktop',title:'Gratis',version:'0.8.0'}});
  });
}
