import { useState } from "react";
import type { NativeView } from "./views.js";
export function BossWorkbench({view,busy,run,open}:{view:Extract<NativeView,{kind:"boss"}>;busy:boolean;run:(input:any)=>Promise<unknown>;open?:(input:any)=>void}) {
  const [link,setLink]=useState(""),[query,setQuery]=useState(""),[resumeId,setResume]=useState(view.resumes[0]?.id??"");
  const scan=view.scans[0];
  return <section aria-label="BOSS 投递"><h3>BOSS 投递</h3>
    <p>启动网页项目的 npm run boss:ego，粘贴终端输出的完整工作台链接。连接码仅留在当前宿主内存，重启后重新连接。</p>
    <label>本次服务链接<input type="password" autoComplete="off" value={link} disabled={busy} onChange={e=>setLink(e.target.value)} /></label>
    <button disabled={busy||!link} onClick={()=>void run({action:"boss-link",link}).then(()=>setLink(""))}>接入本机服务</button>
    <p>{view.connected?"已接入本机服务；浏览器登录状态请在 ego 中检查。":"尚未接入本机服务"}</p>
    {view.connected&&<><button disabled={busy} onClick={()=>void run({action:"boss-connect"})}>连接浏览器</button><button disabled={busy} onClick={()=>void run({action:"boss-unlink"})}>解除插件连接</button>
      <label>岗位方向<input value={query} disabled={busy} onChange={e=>setQuery(e.target.value)} /></label><button disabled={busy||!query.trim()} onClick={()=>void run({action:"boss-search",query})}>搜索</button><button disabled={busy} onClick={()=>void run({action:"boss-read"})}>读取当前列表</button></>}
    <label>用于核对的简历<select disabled={busy} value={resumeId} onChange={e=>setResume(e.target.value)}><option value="">选择简历</option>{view.resumes.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    {scan&&<><p>{new Date(scan.createdAt).toLocaleString()} · {scan.jobs.length} 个岗位（当前页）</p>{scan.blocked?<p role="alert">{scan.blocked}</p>:scan.jobs.map(job=><article key={job.url}><h4>{job.company} · {job.title}</h4><p>{job.salary}</p><p>{job.description}</p><button disabled={busy||!view.connected} onClick={()=>{const action={action:"boss-detail",scanId:scan.id,url:job.url,...(resumeId?{resumeId}:{})};open?open(action):void run(action);}}>读取完整 JD{resumeId?"并核对简历":""}</button></article>)}</>}
    {view.runs.map(r=><article key={r.id}><h4>批次 · {r.state}</h4>{r.tasks.map(t=><p key={t.url}>{t.company} · {t.title} · {t.state}{t.error?`：${t.error}`:""}</p>)}<button disabled={busy||!view.connected} onClick={()=>void run({action:"boss-refresh",id:r.id})}>更新回执</button>{r.state==="running"&&<button disabled={busy||!view.connected} onClick={()=>void run({action:"boss-pause",id:r.id})}>完成当前步骤后暂停</button>}</article>)}
  </section>;
}
