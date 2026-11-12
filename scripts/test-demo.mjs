import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import assert from 'node:assert/strict'
import { randomBytes, scryptSync } from 'node:crypto'
import Database from 'better-sqlite3'
const data = mkdtempSync(join(tmpdir(), 'unlar-test-'))
const cloud = process.env.TEST_CLOUD === '1'
const port = cloud ? 14982 : 14981
const password = cloud ? randomBytes(24).toString('base64url') : 'demo2026'
const hash = () => { const salt=randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,32).toString('hex')}` }
const hashes = Object.fromEntries(['teacher-marcelo','admin-academic','admin-library','admin-gym','demo-tools'].map(id=>[id,hash()]))
const server = spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts'], { env: {...process.env, DATA_DIR:data, PORT:String(port), APP_MODE:cloud?'cloud':'local', ACCESS_PASSWORD_HASHES:JSON.stringify(hashes)}, stdio:'pipe' })
let logs=''; server.stderr.on('data', b=>logs+=b)
let checks=0
async function call(path, token, body, expected=200) {
 const r=await fetch(`http://127.0.0.1:${port}${path}`, {method:body===undefined?'GET':'POST', headers:{'content-type':'application/json', ...(token?{authorization:`Bearer ${token}`}:{})}, ...(body===undefined?{}:{body:JSON.stringify(body)})})
 const text=await r.text(); assert.equal(r.status, expected, `${path}: ${text}`); checks++; return text.startsWith('{')||text.startsWith('[')?JSON.parse(text):text
}
try {
 for(let i=0;i<100;i++){try{await fetch(`http://127.0.0.1:${port}/health`);break}catch{await new Promise(r=>setTimeout(r,50))}}
 if (cloud) {
  const page=await fetch(`http://127.0.0.1:${port}/?acceso=institucional`)
  assert.equal(page.status,200);assert.ok((await page.text()).includes('/assets/'));checks+=2
  await call('/api/network-info',null)
  await call('/api/demo/login',null,{account:'admin-academic',password:'demo2026'},401)
  await call('/api/demo/login',null,{account:'student-mariano',password:'demo2026'},401)
 }
 const login=async account=>(await call('/api/demo/login',null,{account,password})).token
 const admin=await login('admin-academic'), teacher=await login('teacher-marcelo'), library=await login('admin-library')
 await call('/api/demo/login',null,{account:'admin-academic',password:'incorrecta'},401)
 await call('/api/attendance/roster',null,undefined,401)
 const {publicKey,secretKey}=ml_dsa65.keygen()
 const walletPublicKey=Buffer.from(publicKey).toString('base64')
 const proof=m=>({walletPublicKey,holderSignature:Buffer.from(ml_dsa65.sign(Buffer.from(m),secretKey)).toString('base64url')})
 const guest=await call('/api/guests/register',null,{fullName:'Prueba Integral',...proof('guest-register.Prueba Integral')},201)
 const token=guest.token, studentId=guest.actor.studentId
 assert.ok(readFileSync(join(data,'planilla-asistencia.csv'),'utf8').includes('Prueba Integral'));checks++
 await call('/api/guests/restore',null,proof('guest-restore'))
 const payload={kind:'Materia aprobada', title:'Bases de Datos',detail:'Aprobada',studentId}
 await call('/api/credentials',library,payload,403)
 await call('/api/credentials',token,payload,403)
 const issued=await call('/api/credentials',admin,payload,201)
 const credential=issued.credential, holder=credential.holder
 assert.equal(credential.proof.algorithm, 'ML-DSA-65'); checks++
 const issuer=await call('/api/issuer-key',token)
 const canonical=c=>JSON.stringify({claims:c.claims,expiresAt:c.expiresAt,holder:c.holder,id:c.id,issuedAt:c.issuedAt,issuer:c.issuer,type:c.type})
 assert.equal(ml_dsa65.verify(Buffer.from(credential.proof.signature,'base64url'),Buffer.from(canonical(credential)),Buffer.from(issuer.publicKeyPem,'base64')),true); checks++
 const altered={...credential,claims:{...credential.claims,titulo:'Alterado'}}
 assert.equal(ml_dsa65.verify(Buffer.from(credential.proof.signature,'base64url'),Buffer.from(canonical(altered)),Buffer.from(issuer.publicKeyPem,'base64')),false); checks++
 const tamperReq=await call('/api/presentation-requests',teacher,{kind:payload.kind},201)
 await call(`/api/presentation-requests/${tamperReq.code}/respond`,token,{credential:altered,...proof(`${tamperReq.code}.${credential.id}.${holder}`)},422)
 const claim=proof(`claim.${issued.delivery.code}.${holder}`)
 await call(`/api/deliveries/${issued.delivery.code}/claim`,token,claim)
 await call(`/api/deliveries/${issued.delivery.code}/claim`,token,claim,409)
 const req=await call('/api/presentation-requests',teacher,{kind:payload.kind},201)
 const response={credential,...proof(`${req.code}.${credential.id}.${holder}`)}
 const verified=await call(`/api/presentation-requests/${req.code}/respond`,token,response)
 assert.equal(verified.valid,true);checks++
 await call(`/api/presentation-requests/${req.code}/respond`,token,response,410)
 await call(`/api/presentation-requests/${req.code}/result`,teacher)
 await call(`/api/credentials/${credential.id}/revoke`,admin,{})
 const req2=await call('/api/presentation-requests',teacher,{kind:payload.kind},201)
 await call(`/api/presentation-requests/${req2.code}/respond`,token,{credential,...proof(`${req2.code}.${credential.id}.${holder}`)},422)
 const session=await call('/api/attendance/sessions',teacher,{subject:'Seminario de Actualización II'},201)
 const attendance=proof(`attendance.${session.id}.${studentId}`)
 await call(`/api/attendance/sessions/${session.id}/check-in`,token,{...attendance,holderSignature:'invalida'},422)
 await call(`/api/attendance/sessions/${session.id}/check-in`,token,attendance)
 await call(`/api/attendance/sessions/${session.id}/check-in`,token,attendance,409)
 const records=await call(`/api/attendance/sessions/${session.id}/records`,teacher)
 assert.equal(records.length,1); checks++
 await call('/api/attendance/roster',teacher)
 const csv=await call('/api/attendance/export.csv',teacher)
 assert.ok(csv.includes('Prueba Integral'));checks++
 await call(`/api/attendance/sessions/${session.id}/close`,teacher,{})
 await call(`/api/attendance/sessions/${session.id}`,token,undefined,410)
 const reward=await call('/api/rewards/sessions',teacher,{},201)
 const rewardProof=proof(`reward-claim.${reward.code}.${holder}`)
 await call(`/api/rewards/${reward.code}/claim`,token,rewardProof)
 assert.equal((await call(`/api/rewards/${reward.code}/claim`,token,rewardProof)).alreadyClaimed,true);checks++
 // Reset must remain available from the attendance panel, including cloud mode.
 await call('/api/demo/reset',token,{},403)
 await call('/api/demo/reset',admin,{},403)
 await call('/api/demo/reset',teacher,{})
 const inspect=new Database(join(data,'billetera.sqlite'),{readonly:true})
 for(const table of ['credentials','attendance_sessions','attendance_records','presentation_requests','credential_deliveries','reward_sessions','reward_claims','raffle_prize_requests','wallet_bindings']) {
  assert.equal(inspect.prepare(`select count(*) as n from ${table}`).get().n,0,table);checks++
 }
 assert.equal(inspect.prepare('select count(*) as n from students where wallet_public_key is not null').get().n,0);checks++
 assert.equal(inspect.prepare('select count(*) as n from students').get().n,cloud?0:2);checks++
 const emptyRoster=await call('/api/attendance/roster',teacher)
 assert.deepEqual(emptyRoster.dates,[]);checks++
 if(cloud){assert.deepEqual(emptyRoster.students,[]);checks++}
 inspect.close()
 await call('/api/demo/me',token,undefined,401)
 await call('/api/guests/restore',null,proof('guest-restore'),404)
 const restarted=await call('/api/guests/register',null,{fullName:'Prueba Integral',...proof('guest-register.Prueba Integral')},201)
 assert.notEqual(restarted.actor.studentId,studentId);checks++
 await call('/api/demo/me',teacher)
 const signout=await login('admin-gym')
 await call('/api/demo/logout',signout,{})
 await call('/api/demo/me',signout,undefined,401)
 if(cloud) {
  const impostor=await call('/api/guests/register',null,{fullName:'Fotografo',...(()=>{const k=ml_dsa65.keygen();return {walletPublicKey:Buffer.from(k.publicKey).toString('base64'),holderSignature:Buffer.from(ml_dsa65.sign(Buffer.from('guest-register.Fotografo'),k.secretKey)).toString('base64url')}})()},201)
  assert.equal(impostor.actor.role,'student');checks++
  for(let i=0;i<10;i++) await call('/api/demo/login',null,{account:'admin-academic',password:'erronea'},401)
  await call('/api/demo/login',null,{account:'admin-academic',password:'erronea'},429)
 }
 console.log(`${checks} comprobaciones aprobadas. Base temporal aislada.`)
} catch(e) {console.error(logs);throw e} finally {if(server.exitCode === null){server.kill(); await new Promise(r=>server.once('exit',r));}rmSync(data,{recursive:true,force:true})}
