import {handleDiscoveryDirectory, type DirectoryEnvironment} from './discovery-directory-http';
import {handleDiscoveryDirectoryPage} from './discovery-directory-page';

// Only allowlisted generated public artifacts enter the Worker. The selection,
// review authority, retained sources and private generation state stay offline.
export async function handleDirectoryRoutes(request:Request,env:DirectoryEnvironment):Promise<Response>{
  const api=new URL(request.url).pathname.startsWith('/api/');
  const handle=api?handleDiscoveryDirectory:handleDiscoveryDirectoryPage;
  if(env.DISCOVERY_DIRECTORY_ENABLED!=='true')return handle(request,env,undefined,undefined);
  try{
    const [catalog,removals]=await Promise.all([import('../content/discovery-directory-catalog.json'),import('../content/discovery-directory-removals.json')]);
    return handle(request,env,catalog.default,removals.default);
  }catch{return handle(request,env,undefined,undefined);}
}
