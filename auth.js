const API_PRIMARY='https://api.smmorbita.ru', API_FALLBACK='https://bba2iub2khhe4eg3fagq.containers.yandexcloud.net', API_BASES=[API_PRIMARY,API_FALLBACK];
const pickApi=()=>{try{const v=localStorage.getItem('smm-api');if(API_BASES.includes(v))return v;}catch{}return API_PRIMARY;};
// Live binding: modules that import API always see the base that last answered.
export let API=pickApi();
const useApi=b=>{API=b;try{localStorage.setItem('smm-api',b);}catch{}};
// Calls to either API address go to the current one first; on a network error (or a GET/login hanging
// for 12 s) they are retried once on the other address, which then becomes the preferred one.
const nativeFetch=window.fetch.bind(window);
window.fetch=async(input,init={})=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:null;
  const base=url&&API_BASES.find(b=>url.startsWith(b+'/'));
  if(!base)return nativeFetch(input,init);
  const path=url.slice(base.length), first=API, other=API_BASES.find(b=>b!==first);
  const method=String(init.method||'GET').toUpperCase(), hangRetry=method==='GET'||method==='HEAD'||path.startsWith('/api/login');
  const outer=init.signal, ctl=new AbortController(); let timedOut=false;
  const onAbort=()=>ctl.abort(outer.reason); if(outer){if(outer.aborted)ctl.abort(outer.reason);else outer.addEventListener('abort',onAbort,{once:true});}
  const timer=hangRetry?setTimeout(()=>{timedOut=true;ctl.abort();},12000):null;
  try{return await nativeFetch(first+path,{...init,signal:ctl.signal});}
  catch(error){
    if(outer&&outer.aborted)throw error;
    if(error&&error.name==='AbortError'&&!timedOut)throw error;
    console.warn('API '+first+' недоступен, пробуем '+other,error&&error.name);
    const response=await nativeFetch(other+path,init);
    useApi(other); return response;
  }finally{if(timer)clearTimeout(timer);if(outer)outer.removeEventListener('abort',onAbort);}
};
export const getToken=()=>{try{const t=JSON.parse(localStorage.getItem('smm-auth')||'null');if(t&&t.exp>Date.now()&&/^[a-f0-9]{64}$/.test(t.token))return t.token;}catch{}return null;};
export const setToken=(token,sec)=>localStorage.setItem('smm-auth',JSON.stringify({token,exp:Date.now()+(sec||28800)*1000-60000}));
export const clearToken=()=>{try{localStorage.removeItem('smm-auth');localStorage.removeItem('smm-role');}catch{}};
