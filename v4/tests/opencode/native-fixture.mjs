// Public SDK-shaped read-only identity fixture. Not evidence of a live host.
export function primaryClient(directory,{agent='pulso'}={}){
  return {session:{
    async get({path,query}){return {data:{id:path.id,projectID:'native-project',directory:query?.directory||directory}};},
    async message({path}){return {data:{info:{id:path.messageID,sessionID:path.id,role:'assistant',agent},parts:[]}};},
    async messages(){return {data:[]};}
  }};
}
