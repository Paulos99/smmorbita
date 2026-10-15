import {API,getToken,setToken} from './auth.js';
if(getToken())location.replace('./');
const form=document.querySelector('#login-form'),error=document.querySelector('#login-error'),submit=document.querySelector('#submit'),password=document.querySelector('#password'),toggle=document.querySelector('#toggle-password');
const reduceMotion=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
function rejectLogin(message){
  error.textContent=message;
  const card=document.querySelector('.login-card');
  if(!card||reduceMotion)return;
  card.classList.remove('is-shaking');
  void card.offsetWidth;
  card.classList.add('is-shaking');
}
toggle.addEventListener('click',()=>{const reveal=password.type==='password';password.type=reveal?'text':'password';toggle.textContent=reveal?'Скрыть':'Показать';toggle.setAttribute('aria-label',reveal?'Скрыть пароль':'Показать пароль');toggle.setAttribute('aria-pressed',String(reveal));});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(submit.disabled)return;error.textContent='';submit.disabled=true;submit.textContent='Проверяем пропуск…';
  try{const body=JSON.stringify({login:form.login.value,password:password.value});let response,last;for(let i=0;i<3&&!response;i++){if(i)submit.textContent='Повторяем попытку…';const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),15000);try{response=await fetch(API+'/api/login',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body,signal:ctl.signal});}catch(e){last=e;console.warn('login attempt',i+1,'failed',e);if(i<2)await new Promise(r=>setTimeout(r,1000*(i+1)));}finally{clearTimeout(t);}}if(!response)throw last||new Error('network');const data=await response.json();if(!response.ok){rejectLogin(data.error || 'Не удалось войти. Попробуйте снова.');return;}if(!data.token){rejectLogin('Не удалось войти. Попробуйте снова.');return;}setToken(data.token,data.expiresIn);password.value='';location.replace('./');}
  catch(e){console.error('Login failed:',e);rejectLogin('Сервер недоступен из вашей сети. Попробуйте подключиться через Wi-Fi или отключить VPN/блокировщик и войти ещё раз.');}
  finally{submit.disabled=false;submit.replaceChildren(document.createTextNode('Открыть досье '));const arrow=document.createElement('span');arrow.textContent='→';arrow.setAttribute('aria-hidden','true');submit.append(arrow);}
});
