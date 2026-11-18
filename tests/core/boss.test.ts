import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Boss } from "../../src/core/boss.js";
import { BossGateway } from "../../src/infrastructure/boss-gateway.js";
import { Store } from "../../src/infrastructure/sqlite-store.js";
import { Workspace } from "../../src/core/workspace.js";
import { operations } from "../../src/core/operations.js";
import { humanAction,cardAction } from "../../src/adapters/dsh/actions.js";

export async function fixture(t:any) {
 const home=await mkdtemp(join(tmpdir(),"boss-agent-test-")),store=new Store(home),workspace=new Workspace(store),requests:string[]=[];
 const url="https://www.zhipin.com/job_detail/test.html", id="10000000-0000-4000-8000-000000000001";
 const state:any={detail:{kind:"detail",url,title:"Go开发",company:"演示",description:"开发 Go 服务",truncated:false,matched:true,blockers:[]},run:{id,mode:"boss",state:"finished",createdAt:1,updatedAt:2,tasks:[]}};
 const server=createServer(async(req,res)=>{requests.push(req.url!);let body="";for await(const c of req)body+=c; if(req.headers.authorization!==`Bearer ${"a".repeat(48)}`){res.writeHead(401);res.end('{}');return;}
 let result:any={}; if(req.url==="/status")result={ready:true,phase:"connected",backend:"ego"};
 if(req.url==="/jobs")result={readId:"snapshot",jobs:[{url,title:"Go开发",company:"演示"}],needsLogin:false,needsVerification:false};
 if(req.url==="/inspect-job")result=state.detail;
 if(req.url===`/boss-batch/${id}`)result=state.run;
 if(req.url==="/boss-batches")result=[];
 if(req.url==="/boss-batch/preview"){state.preview=JSON.parse(body);result={id:"preview",batchId:state.preview.id,expiresAt:Date.now()+120000,greetingMode:"platform",jobs:state.preview.jobs,images:state.preview.images.map(({base64,...i}:any)=>i),skipped:[]};}
 if(req.url==="/boss-batch/confirm"){state.confirmations=(state.confirmations??0)+1;result={...state.run,id:state.preview.id,state:"running",tasks:state.preview.jobs.map((j:any)=>({...j,state:"queued",steps:[]}))};}
 res.setHeader("Content-Type","application/json");res.end(JSON.stringify(result));});
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as any).port;
 const link=`http://localhost:3000/boss#boss-origin=${encodeURIComponent(`http://127.0.0.1:${port}`)}&boss-token=${"a".repeat(48)}`;
 t.after(async()=>{await new Promise<void>(r=>server.close(()=>r()));store.close();await rm(home,{recursive:true,force:true});});
 return {home,store,workspace,boss:new Boss(workspace),link,requests,state,url,id};
}
test("BOSS 接口限制本机来源，凭据仅在内存，读取真实快照核对身份",async t=>{
 const f=await fixture(t);for(const origin of ["https://example.com","http://127.0.0.1.evil:4327","http://user:pass@127.0.0.1:4327"]){assert.throws(()=>BossGateway.fromLink(`http://localhost/#boss-origin=${encodeURIComponent(origin)}&boss-token=${"a".repeat(48)}`));}
 await assert.rejects(f.boss.status(),/先在/);await humanAction(f.workspace,{action:"boss-link",link:f.link});assert.equal((await f.boss.status()).ready,true);
 const scan=await f.boss.read(),job=await f.boss.detail(scan.id,f.url);assert.equal(job.jd,"开发 Go 服务");
 f.state.detail.company="其他公司";await assert.rejects(f.boss.detail(scan.id,f.url),/未核对/);
 assert.equal(JSON.stringify(f.store.list("boss-scan")).includes("a".repeat(48)),false);
 const restored=await cardAction(f.workspace,"session","card",{action:"restore",reference:{action:"boss"}});assert.equal(restored?.kind,"boss");
 assert.ok(!operations(f.workspace).some(o=>/boss.*confirm|boss.*connect/.test(o.name)));
 f.boss.disconnect();await assert.rejects(f.boss.status(),/先在/);
});
test("恢复和暂停只读回执，不重新确认或发送",async t=>{
 const f=await fixture(t);f.boss.connect(f.link);await f.boss.refresh(f.id);await f.boss.pause(f.id);assert.equal(f.store.list("boss-run").length,1);assert.equal(f.requests.includes("/boss-batch/confirm"),false);
 await assert.rejects(f.boss.gateway().request("/fill-draft",{}),/不支持/);
});
