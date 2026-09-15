#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { runWatchCollection } from "../src/ingest/watch/collector.ts";
import { resolveEnrolledCollectionSource } from "../src/ingest/watch/collection-storage.ts";

const {values}=parseArgs({options:{db:{type:"string"},"init-local":{type:"boolean"},"collect-public":{type:"boolean"},
  "check-source":{type:"string"}}});
if(!values.db || !isAbsolute(values.db))throw Error("--db must be an absolute local scratch SQLite path");
const root=realpathSync("/mnt/d/tmp/plumbob"),parent=realpathSync(dirname(values.db));
if(parent!==root && !parent.startsWith(root+"/"))throw Error("Local collection database must stay in mounted task scratch");
const path=resolve(parent,values.db.split("/").at(-1));
if(existsSync(path)&&realpathSync(path)!==path)throw Error("Database symlinks are not allowed");
if(values["init-local"] && existsSync(path))throw Error("--init-local requires a new database");
if(!values["init-local"] && !existsSync(path))throw Error("Initialize a disposable database first");
const sqlite=new DatabaseSync(path);
try {
  sqlite.exec("PRAGMA foreign_keys=ON");
  if(values["init-local"]){
    const migrations=new URL("../migrations/",import.meta.url);
    sqlite.exec("BEGIN");
    try{for(const file of readdirSync(migrations).filter(value=>/^\d+.*\.sql$/.test(value)).sort())
      sqlite.exec(readFileSync(new URL(file,migrations),"utf8"));sqlite.exec("COMMIT");
    }catch(error){sqlite.exec("ROLLBACK");throw error;}
  }
  class Statement {
    constructor(statement,values=[]){this.statement=statement;this.values=values;}
    bind(...values){return new Statement(this.statement,values.map(value=>value instanceof ArrayBuffer?new Uint8Array(value):value));}
    async first(){return this.statement.get(...this.values)??null;}
    async all(){return {results:this.statement.all(...this.values)};}
    async run(){return this.statement.run(...this.values);}
  }
  const db={prepare(sql){return new Statement(sqlite.prepare(sql));},async batch(statements){
    sqlite.exec("BEGIN");try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec("COMMIT");return results;}
    catch(error){sqlite.exec("ROLLBACK");throw error;}
  }};
  if(values["check-source"]){
    const source=await resolveEnrolledCollectionSource(db,values["check-source"],new Date().toISOString());
    process.stdout.write(JSON.stringify({ready:!!source,sourceId:values["check-source"],permissionDigest:source?.permissionDigest??null})+"\n");
  }else if(values["collect-public"]){
    process.stdout.write(JSON.stringify(await runWatchCollection(db,{enabled:true}))+"\n");
  }else{
    process.stdout.write(JSON.stringify({mode:"local-status",sources:sqlite.prepare("SELECT id,activation_id,revision FROM watch_collection_sources ORDER BY id").all(),
      state:sqlite.prepare("SELECT * FROM watch_collection_state ORDER BY next_due_at,source_id").all()})+"\n");
  }
}finally{sqlite.close();}
