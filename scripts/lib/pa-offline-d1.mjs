/** Minimal SQLite D1 seam for isolated offline preview; never loads Worker config. */
export function sqliteD1(database){
 const prepare=(sql,values=[])=>({bind(...args){return prepare(sql,args);},async first(){return database.prepare(sql).get(...values)??null;},async all(){return {results:database.prepare(sql).all(...values)};},async run(){const result=database.prepare(sql).run(...values);return {success:true,meta:{changes:Number(result.changes)}};},sql,values});
 return {prepare,async batch(statements){database.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());database.exec('COMMIT');return results;}catch(error){database.exec('ROLLBACK');throw error;}}};
}

/** CLI always uses production storage defaults. Internal storage callbacks allow
 * socket-free fixtures in an explicitly checked private test root, with no
 * command-line or environment mechanism to relax operator root admission. */
export async function previewPaBrowserIntake(values,storage={}){
 const {watchOutputDirectory,boundedWatchFile}=await import('./watch-local-files.mjs');
 const {localOnly}=await import('./pa-retained-collector.mjs');
 const {syncPaDirectory}=await import('./pa-browser-packet-storage.mjs');
 const {mkdtempSync,readdirSync,chmodSync}=await import('node:fs');
 const {join}=await import('node:path');
 const {DatabaseSync}=await import('node:sqlite');
 const outputDirectory=storage.outputDirectory??watchOutputDirectory;
 const root=outputDirectory(localOnly(values.state),undefined,true);
 const directory=mkdtempSync(join(root,'pa-offline-preview-'));chmodSync(directory,0o700);
 (storage.syncDirectory??syncPaDirectory)(root);
 const sql=new DatabaseSync(join(directory,'preview.sqlite'));
 chmodSync(join(directory,'preview.sqlite'),0o600);
 try{
  for(const name of readdirSync(new URL('../../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sql.exec(Buffer.from(boundedWatchFile(new URL('../../migrations/'+name,import.meta.url),500_000)).toString('utf8'));
  const {intakeVerifiedPaBrowserPacket}=await import('./pa-browser-operator.mjs');
  const result=await intakeVerifiedPaBrowserPacket({enabled:true,db:sqliteD1(sql),packetDirectory:values.packet,retentionRoot:values.retention},storage);
  return {offlineOnly:true,sourceQualified:false,databaseDirectory:directory,...result};
 }finally{sql.close();}
}
