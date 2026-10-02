// OFFLINE ONLY: fresh SQLite, no env/bindings/remote access, no enrollment.
if(!process.argv.includes('--enable-offline-preview')){
 console.log(JSON.stringify({outcome:'disabled',fetchingEnabled:false,schedulingEnabled:false}));
}else{
 const {parseArgs}=await import('node:util');
 const {values}=parseArgs({options:{'enable-offline-preview':{type:'boolean'},packet:{type:'string'},state:{type:'string'},retention:{type:'string'}}});
 const {previewPaBrowserIntake}=await import('./lib/pa-offline-d1.mjs');
 console.log(JSON.stringify(await previewPaBrowserIntake(values)));
}
