export const API='https://bba2iub2khhe4eg3fagq.containers.yandexcloud.net';
export const getToken=()=>{try{const t=JSON.parse(localStorage.getItem('smm-auth')||'null');if(t&&t.exp>Date.now()&&/^[a-f0-9]{64}$/.test(t.token))return t.token;}catch{}return null;};
export const setToken=(token,sec)=>localStorage.setItem('smm-auth',JSON.stringify({token,exp:Date.now()+(sec||28800)*1000-60000}));
export const clearToken=()=>{try{localStorage.removeItem('smm-auth');localStorage.removeItem('smm-role');}catch{}};
