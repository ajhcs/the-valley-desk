// Default invocation has no imported transport, filesystem, timers or credentials.
if(!process.argv.includes('--enable-authenticated-handoff')){
 console.log(JSON.stringify({outcome:'disabled',fetchingEnabled:false,schedulingEnabled:false}));
}else{
 const {parseArgs}=await import('node:util');
 const {values}=parseArgs({options:{'enable-authenticated-handoff':{type:'boolean'},capture:{type:'string'},out:{type:'string'}}});
 const {receivePaBrowserHandoff}=await import('./lib/pa-browser-handoff.mjs');
 const result=await receivePaBrowserHandoff({enabled:true,remoteCapture:values.capture,out:values.out});
 console.log(JSON.stringify({packetSha256:result.manifest.packetSha256,packetDirectory:result.directory,sourceQualified:false,publicationAuthorized:false,successfulUpstreamCheckRenewed:false}));
}
