// Socket-free document fixture. Execute the actual controller expression in VM;
// canned CDP success objects cannot establish that its JavaScript handles null.
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function evaluateDom(expression,state={}){
 const clicks=[];
 const anchors=(state.links??[]).map(link=>({innerText:link.label,href:link.resolved,getAttribute:name=>name==='href'?link.href:null,click(){clicks.push(link.href);}}));
 const document={body:state.body===null?null:{innerText:state.body??''},title:state.title??'',readyState:state.ready??'complete',
  querySelectorAll(selector){if(selector!=='a[href]')throw Error('unexpected selector');return anchors;},
  querySelector(selector){return selector.startsWith('iframe')?(state.challengeWidget?{}:null):(state.interstitial?{}:null);},
 };
 if(state.exception)Object.defineProperty(document,'body',{get(){throw new TypeError(state.exception);}});
 try{return {result:{value:runInNewContext(expression,{document,location:{href:state.url??'https://www.palegis.us/data'}},{timeout:100})},clicks};}
 catch(error){return {exceptionDetails:{exception:{className:error.name,description:error.name+': '+error.message}},clicks};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {expression,state}=JSON.parse(readFileSync(0,'utf8'));
 process.stdout.write(JSON.stringify(evaluateDom(expression,state)));
}
