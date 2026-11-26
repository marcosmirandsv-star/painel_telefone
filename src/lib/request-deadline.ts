/** Bounds session lookup, HTTP and body parsing; callers keep their scope/version guards. */
export async function withRequestDeadline<T>(
  operation:(signal:AbortSignal)=>Promise<T>,
  milliseconds=15000,
):Promise<T>{
 const controller=new AbortController()
 let timer:ReturnType<typeof setTimeout>|undefined
 try{
  const timeout=new Promise<never>((_,reject)=>{
   timer=setTimeout(()=>{
    reject(new Error('A consulta dos indicadores demorou além do esperado. Tente atualizar a leitura.'))
    controller.abort()
   },milliseconds)
  })
  return await Promise.race([Promise.resolve().then(()=>operation(controller.signal)),timeout])
 }finally{if(timer!==undefined)clearTimeout(timer)}
}
