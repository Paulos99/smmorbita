const API_PRIMARY='https://api.smmorbita.ru', API_FALLBACK='https://bba2iub2khhe4eg3fagq.containers.yandexcloud.net', API_BASES=[API_PRIMARY,API_FALLBACK];
const pickApi=()=>{try{const v=localStorage.getItem('smm-api');if(API_BASES.includes(v))return v;}catch{}return API_PRIMARY;};
// Live binding: modules that import API always see the base that last answered.
export let API=pickApi();
const useApi=b=>{API=b;try{localStorage.setItem('smm-api',b);}catch{}};
// Calls to either API address go to the preferred one first. A network error fails over at once; a GET/HEAD
// or login that stays silent for HEDGE_MS also starts the same request on the other address, and the first
// answer wins (a blackholed host must not eat the time the other one needs on slow mobile/VPN links).
// The address that answered becomes the preferred one.
const HEDGE_MS=3500, HARD_MS=30000;
const nativeFetch=window.fetch.bind(window);
window.fetch=async(input,init={})=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:null;
  const base=url&&API_BASES.find(b=>url.startsWith(b+'/'));
  if(!base)return nativeFetch(input,init);
  const path=url.slice(base.length), first=API, other=API_BASES.find(b=>b!==first);
  const method=String(init.method||'GET').toUpperCase(), hedge=method==='GET'||method==='HEAD'||path.startsWith('/api/login');
  const outer=init.signal;
  if(outer&&outer.aborted)throw outer.reason instanceof Error?outer.reason:new DOMException('Aborted','AbortError');
  const ctls=[];
  const attempt=b=>{const ctl=new AbortController();ctls.push({b,ctl});const t=setTimeout(()=>ctl.abort(),HARD_MS);
    return nativeFetch(b+path,{...init,signal:ctl.signal}).then(r=>({b,r}),e=>{throw e;}).finally(()=>clearTimeout(t));};
  const stopAll=keep=>ctls.forEach(c=>{if(c.b!==keep)c.ctl.abort();});
  const onAbort=()=>stopAll(null); if(outer)outer.addEventListener('abort',onAbort,{once:true});
  try{
    const result=await new Promise((resolve,reject)=>{
      let pending=0,started=false,lastErr=null,hedgeTimer=null;
      const launch=b=>{pending++;attempt(b).then(resolve,e=>{lastErr=e;pending--;
        if(outer&&outer.aborted)return reject(e);
        if(!started){startOther();return;}
        if(!pending)reject(lastErr);});};
      const startOther=()=>{if(started)return;started=true;clearTimeout(hedgeTimer);console.warn('API '+first+' не отвечает, пробуем '+other);launch(other);};
      launch(first);
      if(hedge)hedgeTimer=setTimeout(startOther,HEDGE_MS);
    });
    stopAll(result.b); if(result.b!==API)useApi(result.b);
    return result.r;
  }finally{if(outer)outer.removeEventListener('abort',onAbort);}
};
export const getToken=()=>{try{const t=JSON.parse(localStorage.getItem('smm-auth')||'null');if(t&&t.exp>Date.now()&&/^[a-f0-9]{64}$/.test(t.token))return t.token;}catch{}return null;};
export const setToken=(token,sec)=>localStorage.setItem('smm-auth',JSON.stringify({token,exp:Date.now()+(sec||28800)*1000-60000}));
export const clearToken=()=>{try{localStorage.removeItem('smm-auth');localStorage.removeItem('smm-role');}catch{}};
