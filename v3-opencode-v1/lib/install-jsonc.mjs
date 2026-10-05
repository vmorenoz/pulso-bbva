import {parse,parseTree,findNodeAtLocation,createScanner,SyntaxKind,modify,applyEdits} from 'jsonc-parser';

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const pluginReference=entry=>Array.isArray(entry)?entry[0]:entry;
export function parseConfig(text,label='OpenCode'){
  const errors=[],value=parse(text,errors,{allowTrailingComma:true});
  if(errors.length||!record(value))throw new Error(`Configuración JSONC inválida: ${label}`);
  // Duplicate keys make ownership ambiguous even if a parser accepts them.
  const tree=parseTree(text,[],{allowTrailingComma:true});
  const visit=node=>{
    if(node.type==='object'){
      const keys=node.children.map(p=>p.children[0].value);
      if(new Set(keys).size!==keys.length)throw new Error(`Claves JSONC duplicadas: ${label}`);
    }
    for(const child of node.children||[])visit(child);
  };
  visit(tree);
  if(value.plugin!==undefined&&(!Array.isArray(value.plugin)||value.plugin.some(x=>typeof x!=='string'&&!(Array.isArray(x)&&x.length===2&&typeof x[0]==='string'&&record(x[1])))))throw new Error(`plugin inválido: ${label}`);
  if(value.mcp!==undefined&&!record(value.mcp))throw new Error(`mcp inválido: ${label}`);
  if(value.default_agent!==undefined&&typeof value.default_agent!=='string')throw new Error(`default_agent inválido: ${label}`);
  return value;
}
export function editConfig(text,location,value){
  // Do not reformat neighboring entries: tuple options/comments are user-owned.
  const next=applyEdits(text,modify(text,location,value,{}));
  parseConfig(next);return next;
}
// Delete individual array elements, from the end, retaining unrelated comments.
export function removePlugins(text,predicate){
  const plugins=parseConfig(text).plugin||[];
  for(let i=plugins.length-1;i>=0;i--)if(predicate(pluginReference(plugins[i]))){
    // jsonc-parser 3.3.1 modify has a last-array-element deletion bug.
    // Use its AST and scanner offsets instead, preserving all comment trivia.
    const array=findNodeAtLocation(parseTree(text,[],{allowTrailingComma:true}),['plugin']),node=array.children[i];
    const scanner=createScanner(text,true),commas=[];scanner.setPosition(array.offset+1);
    let depth=0;
    while(scanner.scan()!==SyntaxKind.EOF&&scanner.getTokenOffset()<array.offset+array.length-1){
      const token=scanner.getToken();
      if(token===SyntaxKind.OpenBracketToken||token===SyntaxKind.OpenBraceToken)depth++;
      else if(token===SyntaxKind.CloseBracketToken||token===SyntaxKind.CloseBraceToken)depth--;
      else if(token===SyntaxKind.CommaToken&&depth===0)commas.push(scanner.getTokenOffset());
    }
    const following=commas.find(x=>x>=node.offset+node.length),preceding=commas.filter(x=>x<node.offset).at(-1);
    const removed=array.children.length===1?commas:[following??preceding].filter(x=>x!==undefined);
    text=applyEdits(text,[{offset:node.offset,length:node.length,content:''},...removed.map(offset=>({offset,length:1,content:''}))]);
    parseConfig(text);
  }
  return text;
}
