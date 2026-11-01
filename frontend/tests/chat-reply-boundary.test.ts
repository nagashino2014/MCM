import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { ChatAccessError, listMessages, postDirectSharedRecordInTransaction, postTextMessage } from "../lib/chat/queries";
import { invalidateDb, withDbWrite } from "../lib/db";

test("독립 PostgreSQL: 공유 브리핑 DM의 타방 답장 인용 차단",async t=>{
  const url=new URL(process.env.INTEL_CHAT_BOUNDARY_TEST_DATABASE_URL!);
  assert.ok(["localhost","127.0.0.1","[::1]"].includes(url.hostname));assert.equal(url.port,"55439");assert.equal(url.pathname,"/intel_chat_boundary_test");assert.equal(url.search,"");
  const adminUrl=new URL(url);adminUrl.pathname="/postgres";
  const admin=new Client({connectionString:adminUrl.toString(),ssl:false});
  try{await admin.connect();if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='intel_chat_boundary_test'")).rowCount)await admin.query("CREATE DATABASE intel_chat_boundary_test");}finally{await admin.end();}
  const db=new Client({connectionString:url.toString(),ssl:false});await db.connect();t.after(async()=>{await invalidateDb();await db.end();});
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await db.query(`CREATE TABLE users(user_id text PRIMARY KEY,name text,status text DEFAULT 'active');
    CREATE TABLE employee_profiles(user_id text,name text,photo_public_path text);
    INSERT INTO users(user_id,name) VALUES('a','비공개발신자'),('b','수신자'),('c','다른대화참여자');
    INSERT INTO employee_profiles(user_id,name) SELECT user_id,name FROM users;`);
  await db.query(await readFile("../infra/aws/145_chat_core.sql","utf8"));
  await db.query("ALTER TABLE chat_messages ADD COLUMN shared_record jsonb");
  Object.assign(process.env,{DATABASE_URL:url.toString(),PGSSL:"disable",NODE_ENV:"test"});delete process.env.MCM_DB_EXPECTED_ROLE;delete process.env.MCM_DB_ROLE_REQUIRED;await invalidateDb();
  const secret="[가상 시험] 공유받지 않은 투자 보고서 제목";
  const privateMessage=await withDbWrite(tx=>postDirectSharedRecordInTransaction(tx,"a","b",`AI 브리핑 공유: ${secret}`,{type:"intel_briefing",id:"fixture_report",title:secret,href:"/sales/rag?briefingId=fixture_report"}));
  const ownRoom=Number((await db.query("INSERT INTO chat_rooms(room_type,dm_key,created_by,created_at) VALUES('dm','dm:b:c','c',now()::text) RETURNING room_id")).rows[0].room_id);
  await db.query("INSERT INTO chat_room_members(room_id,user_id,joined_at) VALUES($1,'b',now()::text),($1,'c',now()::text)",[ownRoom]);
  await t.test("비멤버의 직접 조회와 다른 방 원문 ID를 이용한 새 답장을 모두 차단",async()=>{
    await assert.rejects(listMessages(privateMessage.roomId,"c",{}),ChatAccessError);
    const before=Number((await db.query("SELECT count(*) n FROM chat_messages")).rows[0].n);
    for(const id of [privateMessage.messageId,999999,0,-1,1.5,Number.NaN])await assert.rejects(postTextMessage(ownRoom,"c","무단 인용 시도",id),ChatAccessError);
    assert.equal(Number((await db.query("SELECT count(*) n FROM chat_messages")).rows[0].n),before);
    const allowed=await listMessages(privateMessage.roomId,"b",{});assert.equal(allowed[0].sharedRecord?.title,secret);
  });
  await t.test("이전에 저장된 잘못된 인용도 원문·발신자·문서 제목을 반환하지 않음",async()=>{
    await db.query("INSERT INTO chat_messages(room_id,sender_id,body,reply_to_message_id,created_at) VALUES($1,'c','과거 잘못된 인용',$2,now()::text)",[ownRoom,privateMessage.messageId]);
    const messages=await listMessages(ownRoom,"c",{});assert.equal(messages.length,1);assert.equal(messages[0].replyTo,null);assert.equal(messages[0].replyToMessageId,null);
    const serialized=JSON.stringify(messages);assert.ok(!serialized.includes(secret));assert.ok(!serialized.includes("비공개발신자"));
  });
  await t.test("같은 방의 정상 답장과 삭제된 원문 표시를 유지",async()=>{
    const original=await postTextMessage(ownRoom,"b","정상 공개 대화");const reply=await postTextMessage(ownRoom,"c","정상 답장",original);
    let row=(await listMessages(ownRoom,"c",{})).find(message=>message.messageId===reply)!;
    assert.equal(row.replyTo?.preview,"정상 공개 대화");assert.equal(row.replyTo?.senderName,"수신자");
    await db.query("UPDATE chat_messages SET deleted_at=now()::text WHERE message_id=$1",[original]);
    row=(await listMessages(ownRoom,"c",{})).find(message=>message.messageId===reply)!;
    assert.equal(row.replyTo?.deleted,true);assert.equal(row.replyTo?.preview,"");
    await assert.rejects(postTextMessage(ownRoom,"c","삭제 원문에 새 답장",original),ChatAccessError);
  });
});
