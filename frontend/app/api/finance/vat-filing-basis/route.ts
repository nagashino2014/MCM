import {NextRequest,NextResponse} from 'next/server';
import {requirePermission,authErrorToResponse} from '@/lib/auth/guards';
import {getVatFilingManagementOverview,getManagedVatFilingArchive,listVatFilingSourceCandidates,saveManagedVatFilingSubject,previewManagedVatFilingFact,saveManagedVatFilingFact,sealManagedVatFilingBasis} from '@/lib/finance/vat-filing-management';

export const runtime='nodejs';
export const dynamic='force-dynamic';
function errorResponse(error:unknown){
  const e=error as {status?:number;message?:string;code?:string;issues?:any[];snapshotIds?:string[]};
  if([409,503].includes(e.status??0))return NextResponse.json({error:e.message,code:e.code,issues:e.issues?.map(i=>({code:i.code,message:i.message,sourceId:i.sourceId,reason:i.reason})),snapshotIds:e.snapshotIds},{status:e.status,headers:{'Cache-Control':'no-store'}});
  return authErrorToResponse(error);
}
async function readInput(req:NextRequest){
  const maximum=10*1024*1024,declared=req.headers.get('content-length');
  const invalid=(message:string)=>Object.assign(new Error(message),{status:400});
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maximum))throw invalid('근거 입력은 10MiB 이하로 나누어 검토하세요.');
  if(!req.body)throw invalid('입력 JSON이 필요합니다.');
  const reader=req.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>maximum){await reader.cancel();throw invalid('근거 입력은 10MiB 이하로 나누어 검토하세요.');}chunks.push(next.value);}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw invalid('입력 JSON 형식이 올바르지 않습니다.');}
  }finally{reader.releaseLock();}
}
export async function GET(req:NextRequest){try{
  await requirePermission('finance.view');
  const input=Object.fromEntries(req.nextUrl.searchParams),view=input.view??'overview';
  if(view==='archive')return NextResponse.json(await getManagedVatFilingArchive(input.snapshotId),{headers:{'Cache-Control':'no-store'}});
  if(view==='sources')return NextResponse.json(await listVatFilingSourceCandidates(input),{headers:{'Cache-Control':'no-store'}});
  if(view!=='overview')throw Object.assign(new Error('조회 종류가 올바르지 않습니다.'),{status:400});
  let manage=false;try{await requirePermission('finance.manage');manage=true;}catch(e){if((e as any)?.status!==403)throw e;}
  return NextResponse.json({...await getVatFilingManagementOverview(input),permissions:{manage}},{headers:{'Cache-Control':'no-store'}});
}catch(e){return errorResponse(e);}}
export async function POST(req:NextRequest){try{
  const actor=await requirePermission('finance.manage');
  // 원천 명세는 JSON으로 제한한다. 대형 원문은 문서 전용 업로드에서 처리한다.
  const input=await readInput(req);
  if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('입력 형식이 올바르지 않습니다.'),{status:400});
  const actorId=actor.userId;
  const result=input.action==='save_subject'?await saveManagedVatFilingSubject(input,actorId)
    :input.action==='preview_fact'?await previewManagedVatFilingFact(input)
    :input.action==='save_fact'?await saveManagedVatFilingFact(input,actorId)
    :input.action==='seal'?await sealManagedVatFilingBasis(input,actorId):null;
  if(result===null)throw Object.assign(new Error('지원하지 않는 근거 작업입니다.'),{status:400});
  return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
}catch(e){return errorResponse(e);}}
