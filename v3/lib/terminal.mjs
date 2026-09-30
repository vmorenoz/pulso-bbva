import {emitKeypressEvents,createInterface} from 'node:readline';

/** A two-option inline selector. No alternate screen, dependencies or TUI framework. */
export function select(label,options,{input=process.stdin,output=process.stdout}={}){
  if(!input.isTTY||!output.isTTY)throw new Error('En modo no interactivo indica --runtime; consulta --help.');
  if(process.env.TERM==='dumb')return numericSelect(label,options,input,output);
  return new Promise((resolve,reject)=>{
    let index=0;const raw=input.isRaw;
    const draw=()=>output.write('\r\x1b[2K'+label+': '+options.map((o,i)=>(i===index?'[':' ')+o.label+(i===index?']':' ')).join('  '));
    const cleanup=()=>{input.off('keypress',key);process.off('SIGTERM',terminate);input.off('end',ended);input.off('error',failed);input.setRawMode(!!raw);input.pause();};
    const finish=()=>{cleanup();output.write('\r\x1b[2K'+label+': '+options[index].label+'\n');resolve(options[index].value);};
    const cancel=()=>{cleanup();output.write('\n');reject(Object.assign(new Error('Operación cancelada. No se hicieron cambios.'),{code:'CANCELLED'}));};
    const terminate=()=>cancel(),ended=()=>cancel(),failed=e=>{cleanup();reject(e);};
    const key=(text,k={})=>{
      if(k.ctrl&&k.name==='c'||k.name==='escape')return cancel();
      if(k.name==='return')return finish();
      if(['up','left'].includes(k.name))index=(index+options.length-1)%options.length;
      else if(['down','right','tab'].includes(k.name))index=(index+1)%options.length;
      else if(/^[1-9]$/.test(text||'')&&Number(text)<=options.length)index=Number(text)-1;
      else return;
      draw();
    };
    emitKeypressEvents(input);input.setRawMode(true);input.on('keypress',key);input.once('end',ended);input.once('error',failed);process.once('SIGTERM',terminate);input.resume();draw();
  });
}
function numericSelect(label,options,input,output){
  return new Promise((resolve,reject)=>{
    const rl=createInterface({input,output});let settled=false;
    rl.on('close',()=>{if(!settled){settled=true;reject(Object.assign(new Error('Operación cancelada. No se hicieron cambios.'),{code:'CANCELLED'}));}});
    const ask=()=>rl.question(`${label}: ${options.map((o,i)=>`${i+1}) ${o.label}`).join('  ')}: `,answer=>{
      const i=Number(answer.trim())-1;
      if(Number.isInteger(i)&&i>=0&&i<options.length){settled=true;rl.close();resolve(options[i].value);}
      else{output.write('Selecciona uno de los números indicados.\n');ask();}
    });
    rl.on('SIGINT',()=>{rl.close();reject(Object.assign(new Error('Operación cancelada. No se hicieron cambios.'),{code:'CANCELLED'}));});ask();
  });
}
