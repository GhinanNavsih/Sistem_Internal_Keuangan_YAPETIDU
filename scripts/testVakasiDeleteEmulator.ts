import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
async function main() {
 if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== 'demo-vakasi-delete' || !/^(127\.0\.0\.1|localhost):8188$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !/^(127\.0\.0\.1|localhost):9198$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) throw new Error('Refusing to run outside the demo-vakasi-delete emulators');
 const { adminDb } = await import('../src/lib/firebase-admin');
 const { POST } = await import('../src/app/api/payroll/vakasi-events/route');
 async function user(role:string) { const r=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${role}@example.test`,password:'password123',returnSecureToken:true})}); const u=await r.json(); await adminDb.doc(`users/${u.localId}`).set({role}); return u; }
 const admin=await user('super_admin'); const satker=await user('satker_head_loyalis'); const finance=await user('finance_verifier');
 await adminDb.doc('PayrollPeriods/2026-11').set({attendanceStatus:'open'});
 async function event(id:string, owner:string, status='draft') {await adminDb.doc(`VakasiTambahan/${id}`).set({period:'2026-11',eventName:'Acara Test',eventWorkers:{},status,revision:0,submittedBy:owner});}
 async function del(user:any,id:string,n:number){return POST(new NextRequest('http://localhost/api/payroll/vakasi-events',{method:'POST',headers:{authorization:`Bearer ${user.idToken}`,'content-type':'application/json'},body:JSON.stringify({action:'delete',eventId:id,expectedRevision:0,requestId:`delete_test_${n}000`})}));}
 await event('own',satker.localId); let r=await del(satker,'own',1); assert.equal(r.status,200,await r.text()); assert.equal((await adminDb.doc('VakasiTambahan/own').get()).data()?.status,'voided');
 await event('other',admin.localId); r=await del(satker,'other',2); assert.equal(r.status,403); r=await del(finance,'other',3); assert.equal(r.status,403); r=await del(admin,'other',4); assert.equal(r.status,200,await r.text());

 await adminDb.doc('Employees_Loyalis/Loyalis_1').set({personal_info:{name:'Test',status:'AKTIF'}});
 await adminDb.doc('PayrollSlipStates/2026_11_Loyalis_1').set({employeeId:'Loyalis_1',period:'2026_11',status:'locked',revision:1,earnings:[{label:'Acara Test',amount:50000}],deductions:[],taxes:[]});
 await adminDb.doc('VakasiTambahan/approved').set({period:'2026-11',eventName:'Acara Test',eventWorkers:{Loyalis_1:{employeeName:'Test',employeeCollection:'Employees_Loyalis',payGiven:50000}},status:'approved',revision:0,submittedBy:satker.localId});
 await adminDb.doc('KegiatanSpj/test_projection').set({sourceVakasiEventId:'approved',status:'approved',revision:1});
 r=await del(satker,'approved',5); assert.equal(r.status,409); assert.equal((await adminDb.doc('VakasiTambahan/approved').get()).data()?.status,'approved');
 await adminDb.doc('PayrollSlipStates/2026_11_Loyalis_1').update({status:'draft'});
 r=await del(satker,'approved',6); assert.equal(r.status,200,await r.text());
 assert.equal((await adminDb.doc('VakasiTambahan/approved').get()).data()?.status,'voided');
 assert.equal((await adminDb.doc('KegiatanSpj/test_projection').get()).data()?.status,'voided');
 const slip=(await adminDb.doc('PayrollSlipStates/2026_11_Loyalis_1').get()).data()!;
 assert.ok(!slip.earnings.some((row:{label:string})=>row.label==='Acara Test'));
 const audits=await adminDb.collection('FinancialAuditLogs').where('entityId','==','approved').get();
 assert.ok(audits.docs.some(d=>d.data().action==='VAKASI_EVENT_DELETE'));
 r=await del(satker,'approved',6); assert.equal(r.status,200,await r.text());
 await adminDb.doc('VakasiTambahan/legacy').set({period:'2026-11',eventName:'Legacy',eventWorkers:{Loyalis_1:{employeeName:'Test',employeeCollection:'Employees_Loyalis',payGiven:50000}},revision:0,submittedBy:satker.localId});
 await adminDb.doc('PayrollSlipStates/2026_11_Loyalis_1').update({status:'locked'});
 r=await del(satker,'legacy',7); assert.equal(r.status,409);
 console.log('Vakasi deletion roles, ownership, payroll and audit checks passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
