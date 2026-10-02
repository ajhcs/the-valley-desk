/** Trusted internal caller only. The approved application boundary supplies its
 * real D1 object and explicit local storage. No token, HTTP endpoint or scheduler.
 * Candidate verification is fixed; callers cannot replace its source binding. */
export async function intakeVerifiedPaBrowserPacket({enabled=false,db,packetDirectory,retentionRoot,clock},storage={}){
 if(enabled!==true)return {outcome:'disabled',fetchingEnabled:false,schedulingEnabled:false};
 if(!db||typeof db.prepare!=='function'||typeof db.batch!=='function')throw Error('trusted-D1-boundary-required');
 const {watchOutputDirectory}=await import('./watch-local-files.mjs');
 const {localOnly,verifyPaRetainedPacket}=await import('./pa-retained-collector.mjs');
 const {privatePaPacketRetainer}=await import('./pa-browser-packet-storage.mjs');
 const {intakePaBrowserOriginal}=await import('../../src/ingest/watch/pa-browser-intake.ts');
 const outputDirectory=storage.outputDirectory??watchOutputDirectory;
 outputDirectory(localOnly(packetDirectory),undefined,true);
 outputDirectory(localOnly(retentionRoot),undefined,true);
 const verified=await verifyPaRetainedPacket(packetDirectory);
 return intakePaBrowserOriginal(db,verified.source,verified.packet,{retain:privatePaPacketRetainer(retentionRoot,storage),clock});
}
